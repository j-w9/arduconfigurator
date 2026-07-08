// Pure view-model helpers for the AI Assistant tab.
//
// No React, no runtime, no network — presentation-shaping logic only, so it is
// unit-tested directly (see ai-assistant.test.ts). The provider send loop and
// tool execution live in the hook (use-ai-assistant); the actual tool/provider
// definitions live in @arduconfig/ai-assistant.

import type { ChatMessage, ChatProviderId } from '@arduconfig/ai-assistant'

export interface ProviderMetadata {
  id: ChatProviderId
  label: string
  /** Cloud key required before the model can be reached. */
  needsApiKey: boolean
  /** Sensible default model id for a fresh config. */
  defaultModel: string
  modelPlaceholder: string
  /** Shown when the provider needs an endpoint (Ollama) or supports an override. */
  baseUrlPlaceholder?: string
  /** One-line setup note surfaced under the settings form. */
  note?: string
}

// 'mock' is intentionally omitted from the user-facing picker — it is the
// offline test seam, selected only by e2e via a query flag.
export const PROVIDER_METADATA: readonly ProviderMetadata[] = [
  {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    needsApiKey: true,
    defaultModel: 'claude-sonnet-5',
    modelPlaceholder: 'claude-sonnet-5',
    note: 'Your key is sent only to api.anthropic.com. Direct browser access is enabled for you.'
  },
  {
    id: 'openai',
    label: 'OpenAI (GPT)',
    needsApiKey: true,
    defaultModel: 'gpt-4o',
    modelPlaceholder: 'gpt-4o',
    note: 'Your key is sent only to api.openai.com (or your custom base URL).'
  },
  {
    id: 'ollama',
    label: 'Ollama (local)',
    needsApiKey: false,
    defaultModel: 'llama3.1',
    modelPlaceholder: 'llama3.1',
    baseUrlPlaceholder: 'http://localhost:11434',
    note: 'Runs fully on your machine. Start Ollama with OLLAMA_ORIGINS set to allow this page.'
  }
]

export function providerMetadata(id: ChatProviderId): ProviderMetadata | undefined {
  return PROVIDER_METADATA.find((entry) => entry.id === id)
}

/** Default model for a provider when the user switches providers. */
export function defaultModelFor(id: ChatProviderId): string {
  return providerMetadata(id)?.defaultModel ?? ''
}

export interface ComposerState {
  canSend: boolean
  /** Why sending is blocked, for the composer's disabled hint. Empty when ready. */
  hint: string
}

/** Decide whether the composer can send and, if not, why. */
export function resolveComposerState(inputs: {
  connected: boolean
  configReady: boolean
  streaming: boolean
  draftIsEmpty: boolean
}): ComposerState {
  if (!inputs.configReady) {
    return { canSend: false, hint: 'Add your model provider and key in Settings to start.' }
  }
  if (inputs.streaming) {
    return { canSend: false, hint: 'Waiting for the model…' }
  }
  if (!inputs.connected) {
    // Still allowed — the model can answer general ArduPilot questions offline —
    // but nudge the user that live-state questions need a vehicle.
    return { canSend: !inputs.draftIsEmpty, hint: 'Not connected — connect a vehicle to ask about live state.' }
  }
  return { canSend: !inputs.draftIsEmpty, hint: '' }
}

export interface RenderToolCall {
  id: string
  name: string
  /** True once a matching tool-result message has been recorded. */
  done: boolean
}

export interface RenderTurn {
  key: string
  role: 'user' | 'assistant'
  text: string
  toolCalls: RenderToolCall[]
}

/**
 * Project the canonical ChatMessage[] conversation into renderable turns:
 * user and assistant turns become bubbles; tool-result messages are folded
 * into their originating assistant turn's tool-call chips (marking them done).
 */
export function buildTranscript(messages: readonly ChatMessage[]): RenderTurn[] {
  const resolvedToolCallIds = new Set<string>()
  for (const message of messages) {
    if (message.role === 'tool' && message.toolCallId) {
      resolvedToolCallIds.add(message.toolCallId)
    }
  }

  const turns: RenderTurn[] = []
  let index = 0
  for (const message of messages) {
    if (message.role === 'tool') {
      index += 1
      continue
    }
    turns.push({
      key: `${message.role}-${index}`,
      role: message.role,
      text: message.content,
      toolCalls: (message.toolCalls ?? []).map((call) => ({
        id: call.id,
        name: call.name,
        done: resolvedToolCallIds.has(call.id)
      }))
    })
    index += 1
  }
  return turns
}
