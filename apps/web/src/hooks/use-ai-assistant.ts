import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  buildSystemPrompt,
  buildVehicleGroundingSummary,
  createProvider,
  createToolExecutor,
  isConnectionReady,
  listModels,
  toolsFor,
  parseProposedChanges,
  ChatProviderError,
  type ChatMessage,
  type ChatProviderId,
  type ProviderConnection,
  type SnapshotAccessor
} from '@arduconfig/ai-assistant'
import type {
  ParameterBatchWriteProgress,
  ParameterBatchWriteResult,
  ParameterWriteRequest
} from '@arduconfig/ardupilot-core'

import { defaultModelFor } from '../view-models/ai-assistant'
import { buildProposalReview, type PendingProposal } from '../view-models/ai-assistant-proposal'
import {
  loadAiAssistantConfig,
  saveAiAssistantConfig,
  loadAiAssistantKey,
  persistAiAssistantKey,
  clearAiAssistantKey
} from '../ai-assistant-storage'

// Stateful controller for the AI Assistant tab. Owns the conversation, the
// provider config, the in-memory API key, the streaming send loop, and — in
// slice 2 — a human-gated parameter-change proposal. This is the ONLY place the
// app makes outbound calls to a third-party LLM endpoint.
//
// SAFETY: the propose_param_changes tool never writes. When the model calls it,
// the loop validates + stages a proposal and returns "awaiting approval" to the
// model. A write happens only when the human ticks acknowledge and clicks Apply,
// which delegates to the injected applyChanges (App owns the runtime + backup).

const MAX_TOOL_ITERATIONS = 8

export interface AiAssistantSettings {
  providerId: ChatProviderId
  model: string
  baseUrl: string
  rememberKey: boolean
  /** Offer the propose_param_changes tool (still human-approved). */
  allowProposals: boolean
}

export type { PendingProposal }

export interface AiAssistantController {
  settings: AiAssistantSettings
  apiKey: string
  configReady: boolean
  messages: ChatMessage[]
  status: 'idle' | 'streaming'
  error: string | undefined
  pendingProposal: PendingProposal | undefined
  /** Models the configured key/endpoint exposes; empty until fetched. */
  availableModels: string[]
  modelsStatus: 'idle' | 'loading' | 'error'
  modelsError: string | undefined
  refreshModels: () => void
  setProviderId: (providerId: ChatProviderId) => void
  setModel: (model: string) => void
  setBaseUrl: (baseUrl: string) => void
  setApiKey: (apiKey: string) => void
  setRememberKey: (remember: boolean) => void
  setAllowProposals: (allow: boolean) => void
  send: (text: string) => void
  applyProposal: () => void
  discardProposal: () => void
  stop: () => void
  clear: () => void
}

export interface UseAiAssistantOptions {
  /** Live vehicle-state accessor, e.g. { getSnapshot: () => runtime.getSnapshot() }. */
  accessor: SnapshotAccessor
  /** Applies approved changes through the runtime (App owns backup + setParameters). */
  applyChanges?: (
    requests: ParameterWriteRequest[],
    onProgress?: (progress: ParameterBatchWriteProgress) => void
  ) => Promise<ParameterBatchWriteResult>
  /** Overrides the default provider — e2e passes 'mock' to run offline. */
  forcedProviderId?: ChatProviderId
}

function initialSettings(forcedProviderId?: ChatProviderId): AiAssistantSettings {
  const stored = loadAiAssistantConfig()
  const providerId = forcedProviderId ?? stored?.providerId ?? 'anthropic'
  return {
    providerId,
    // Fall back to the provider id itself when there is no catalog default
    // (the offline 'mock' provider has no metadata but still needs a model).
    model: stored?.model ?? (defaultModelFor(providerId) || providerId),
    baseUrl: stored?.baseUrl ?? '',
    rememberKey: stored?.rememberKey ?? false,
    allowProposals: stored?.allowProposals ?? true
  }
}

export function useAiAssistant(options: UseAiAssistantOptions): AiAssistantController {
  const { accessor, applyChanges, forcedProviderId } = options

  const [settings, setSettings] = useState<AiAssistantSettings>(() => initialSettings(forcedProviderId))
  const [apiKey, setApiKeyState] = useState<string>(() =>
    settings.rememberKey ? loadAiAssistantKey() ?? '' : ''
  )
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [status, setStatus] = useState<'idle' | 'streaming'>('idle')
  const [error, setError] = useState<string | undefined>(undefined)
  const [pendingProposal, setPendingProposal] = useState<PendingProposal | undefined>(undefined)
  const [availableModels, setAvailableModels] = useState<string[]>([])
  const [modelsStatus, setModelsStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [modelsError, setModelsError] = useState<string | undefined>(undefined)

  // Canonical provider-facing history; `messages` mirrors it for rendering.
  const conversationRef = useRef<ChatMessage[]>([])
  const abortRef = useRef<AbortController | undefined>(undefined)

  const commit = useCallback(() => {
    setMessages([...conversationRef.current])
  }, [])

  const connection: ProviderConnection = useMemo(
    () => ({
      providerId: settings.providerId,
      model: settings.model,
      apiKey: apiKey || undefined,
      baseUrl: settings.baseUrl || undefined
    }),
    [settings.providerId, settings.model, settings.baseUrl, apiKey]
  )

  const configReady = isConnectionReady(connection)
  // Cloud providers need a key before their model list can be fetched; Ollama
  // just needs its endpoint; mock has no list to fetch.
  const canFetchModels =
    connection.providerId === 'ollama' ? true : connection.providerId === 'mock' ? false : Boolean(apiKey)

  const connectionForModelsRef = useRef(connection)
  connectionForModelsRef.current = connection
  const modelsRequestRef = useRef(0)

  const refreshModels = useCallback(() => {
    const target = connectionForModelsRef.current
    if (target.providerId !== 'ollama' && target.providerId !== 'mock' && !target.apiKey) return
    const requestId = modelsRequestRef.current + 1
    modelsRequestRef.current = requestId
    setModelsStatus('loading')
    setModelsError(undefined)
    void listModels(target)
      .then((models) => {
        if (modelsRequestRef.current !== requestId) return // superseded
        setAvailableModels(models)
        setModelsStatus('idle')
      })
      .catch((caught: unknown) => {
        if (modelsRequestRef.current !== requestId) return
        setAvailableModels([])
        setModelsStatus('error')
        setModelsError(caught instanceof ChatProviderError ? caught.message : (caught as Error).message)
      })
  }, [])

  // Auto-fetch the model list shortly after the key/endpoint settles, so the
  // picker fills in without a manual step. Debounced so it doesn't fire on every
  // keystroke while pasting a key.
  useEffect(() => {
    if (!canFetchModels) {
      setAvailableModels([])
      setModelsStatus('idle')
      setModelsError(undefined)
      return
    }
    const timer = setTimeout(refreshModels, 700)
    return () => clearTimeout(timer)
  }, [canFetchModels, connection.providerId, connection.apiKey, connection.baseUrl, refreshModels])

  // Refs so the async loop and follow-up runs read current values without
  // re-creating callbacks on every keystroke.
  const connectionRef = useRef(connection)
  connectionRef.current = connection
  const allowProposalsRef = useRef(settings.allowProposals)
  allowProposalsRef.current = settings.allowProposals
  const applyChangesRef = useRef(applyChanges)
  applyChangesRef.current = applyChanges
  const pendingProposalRef = useRef<PendingProposal | undefined>(undefined)
  pendingProposalRef.current = pendingProposal
  const statusRef = useRef(status)
  statusRef.current = status

  // Persist non-secret config whenever it changes.
  useEffect(() => {
    saveAiAssistantConfig({
      providerId: settings.providerId,
      model: settings.model,
      baseUrl: settings.baseUrl || undefined,
      rememberKey: settings.rememberKey,
      allowProposals: settings.allowProposals
    })
  }, [settings.providerId, settings.model, settings.baseUrl, settings.rememberKey, settings.allowProposals])

  const setProviderId = useCallback((providerId: ChatProviderId) => {
    setSettings((prev) => ({ ...prev, providerId, model: defaultModelFor(providerId) }))
  }, [])
  const setModel = useCallback((model: string) => setSettings((prev) => ({ ...prev, model })), [])
  const setBaseUrl = useCallback((baseUrl: string) => setSettings((prev) => ({ ...prev, baseUrl })), [])
  const setAllowProposals = useCallback((allow: boolean) => setSettings((prev) => ({ ...prev, allowProposals: allow })), [])

  const setApiKey = useCallback((nextKey: string) => {
    setApiKeyState(nextKey)
    // Only persist when the user opted in; otherwise the key lives in memory.
    setSettings((prev) => {
      if (prev.rememberKey) {
        if (nextKey) persistAiAssistantKey(nextKey)
        else clearAiAssistantKey()
      }
      return prev
    })
  }, [])

  const setRememberKey = useCallback(
    (remember: boolean) => {
      setSettings((prev) => ({ ...prev, rememberKey: remember }))
      if (remember) {
        if (apiKey) persistAiAssistantKey(apiKey)
      } else {
        clearAiAssistantKey()
      }
    },
    [apiKey]
  )

  // The provider conversation loop: runs turns until the model stops asking for
  // tools. Read-only tools execute inline; propose_param_changes is intercepted
  // and staged (never written). Does NOT manage status/abort — startRun does.
  const driveConversation = useCallback(
    async (controller: AbortController) => {
      const provider = createProvider(connectionRef.current)
      const executor = createToolExecutor(accessor)
      const allowProposals = allowProposalsRef.current
      const system = buildSystemPrompt({
        grounding: buildVehicleGroundingSummary(accessor.getSnapshot()),
        allowProposals
      })
      const tools = toolsFor({ allowProposals })

      for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration += 1) {
        const requestMessages = [...conversationRef.current]
        const assistant: ChatMessage = { role: 'assistant', content: '', toolCalls: [] }
        conversationRef.current = [...conversationRef.current, assistant]
        commit()

        let stopReason: 'end' | 'tool-use' = 'end'
        let streamError: string | undefined

        for await (const event of provider.send({
          system,
          messages: requestMessages,
          tools,
          model: connectionRef.current.model,
          signal: controller.signal
        })) {
          if (event.type === 'text-delta') {
            assistant.content += event.text
            commit()
          } else if (event.type === 'tool-call') {
            assistant.toolCalls = [...(assistant.toolCalls ?? []), event.call]
            commit()
          } else if (event.type === 'done') {
            stopReason = event.stopReason
          } else if (event.type === 'error') {
            streamError = event.message
          }
        }

        if (streamError) {
          setError(streamError)
          break
        }
        if (stopReason !== 'tool-use' || (assistant.toolCalls?.length ?? 0) === 0) {
          break
        }

        for (const call of assistant.toolCalls ?? []) {
          const result =
            call.name === 'propose_param_changes'
              ? stageProposal(call.arguments)
              : executor.execute(call.name, call.arguments)
          conversationRef.current = [
            ...conversationRef.current,
            { role: 'tool', content: JSON.stringify(result), toolCallId: call.id }
          ]
        }
        commit()

        if (iteration === MAX_TOOL_ITERATIONS - 1) {
          setError('Reached the tool-call limit for one turn. Ask a more specific question.')
        }
      }

      // Validate + stage a proposal for human approval. NEVER writes.
      function stageProposal(args: Record<string, unknown>): unknown {
        const parsed = parseProposedChanges(args)
        if ('error' in parsed) {
          return { ok: false, error: parsed.error }
        }
        const review = buildProposalReview(accessor.getSnapshot().parameters, parsed.proposal.changes)
        setPendingProposal({ summary: parsed.proposal.summary, changes: parsed.proposal.changes, review, status: 'pending' })
        return {
          ok: true,
          staged: true,
          message: `Proposal staged for the user to review and approve: ${review.stagedCount} change(s) ready to apply, ${review.invalidCount} invalid, ${review.unchangedCount} already at target. Await the user's explicit Apply — you cannot apply changes yourself.`
        }
      }
    },
    [accessor, commit]
  )

  // Wrap an async run with controller + status/abort lifecycle.
  const startRun = useCallback((seed: (controller: AbortController) => Promise<void>) => {
    const controller = new AbortController()
    abortRef.current = controller
    setStatus('streaming')
    void (async () => {
      try {
        await seed(controller)
      } catch (caught) {
        if (controller.signal.aborted) return
        const message =
          caught instanceof ChatProviderError ? caught.message : `Assistant error: ${(caught as Error).message}`
        setError(message)
      } finally {
        if (abortRef.current === controller) abortRef.current = undefined
        setStatus('idle')
      }
    })()
  }, [])

  const stop = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = undefined
    setStatus('idle')
  }, [])

  const clear = useCallback(() => {
    stop()
    conversationRef.current = []
    setError(undefined)
    setPendingProposal(undefined)
    commit()
  }, [stop, commit])

  const send = useCallback(
    (text: string) => {
      const trimmed = text.trim()
      if (!trimmed || statusRef.current === 'streaming' || !configReady) return
      setError(undefined)
      conversationRef.current = [...conversationRef.current, { role: 'user', content: trimmed }]
      commit()
      startRun((controller) => driveConversation(controller))
    },
    [configReady, commit, startRun, driveConversation]
  )

  const discardProposal = useCallback(() => setPendingProposal(undefined), [])

  const applyProposal = useCallback(() => {
    const proposal = pendingProposalRef.current
    const apply = applyChangesRef.current
    if (!proposal || proposal.status !== 'pending' || !proposal.review.canApply || !apply) return
    if (statusRef.current === 'streaming') return

    const requests: ParameterWriteRequest[] = proposal.review.entries
      .filter((entry) => entry.status === 'staged' && entry.nextValue !== undefined)
      .map((entry) => ({ paramId: entry.id, paramValue: entry.nextValue as number }))
    if (requests.length === 0) return

    setError(undefined)
    setPendingProposal((prev) =>
      prev ? { ...prev, status: 'applying', progress: { completed: 0, total: requests.length, paramId: '' } } : prev
    )

    startRun(async (controller) => {
      let result: ParameterBatchWriteResult
      try {
        result = await apply(requests, (progress) =>
          setPendingProposal((prev) => (prev ? { ...prev, progress } : prev))
        )
      } catch (caught) {
        const message = `Failed to apply changes: ${(caught as Error).message}`
        setPendingProposal((prev) => (prev ? { ...prev, status: 'error', error: message, progress: undefined } : prev))
        setError(message)
        return
      }

      const summary = {
        applied: result.applied.length,
        unconfirmed: result.unconfirmed.length,
        rolledBack: result.rolledBack.length
      }
      setPendingProposal((prev) => (prev ? { ...prev, status: 'applied', result: summary, progress: undefined } : prev))

      // Let the model see the outcome so it can confirm conversationally.
      conversationRef.current = [
        ...conversationRef.current,
        {
          role: 'user',
          content: `[The user reviewed and applied your proposed changes. Result: ${summary.applied} verified, ${summary.unconfirmed} unconfirmed, ${summary.rolledBack} rolled back.]`
        }
      ]
      commit()
      await driveConversation(controller)
    })
  }, [startRun, driveConversation, commit])

  // Abort any in-flight request on unmount.
  useEffect(() => () => abortRef.current?.abort(), [])

  return {
    settings,
    apiKey,
    configReady,
    messages,
    status,
    error,
    pendingProposal,
    availableModels,
    modelsStatus,
    modelsError,
    refreshModels,
    setProviderId,
    setModel,
    setBaseUrl,
    setApiKey,
    setRememberKey,
    setAllowProposals,
    send,
    applyProposal,
    discardProposal,
    stop,
    clear
  }
}
