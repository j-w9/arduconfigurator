import { useState } from 'react'
import { Panel, buttonStyle } from '@arduconfig/ui-kit'

import type { ChatProviderId } from '@arduconfig/ai-assistant'
import {
  PROVIDER_METADATA,
  providerMetadata,
  resolveComposerState,
  type RenderTurn
} from '../view-models/ai-assistant'
import type { PendingProposal, ProposalReviewEntry } from '../view-models/ai-assistant-proposal'

// Presentational AI Assistant tab. App owns the conversation, provider config,
// and the send loop (via useAiAssistant); this view only renders and dispatches
// callbacks. No runtime / transport / MAVLink imports, per the "Adding a View"
// pattern. The composer's draft text is local UI state — nothing more.
//
// Read-only slice: the model can inspect the vehicle but cannot change it, so
// the surface is a chat + a settings form, with no apply/confirm affordances.

export interface AiAssistantViewProps {
  connected: boolean
  configReady: boolean
  status: 'idle' | 'streaming'
  error?: string
  transcript: readonly RenderTurn[]
  // Settings (controlled).
  providerId: ChatProviderId
  model: string
  baseUrl: string
  apiKey: string
  rememberKey: boolean
  allowProposals: boolean
  onProviderChange: (providerId: ChatProviderId) => void
  onModelChange: (model: string) => void
  onBaseUrlChange: (baseUrl: string) => void
  onApiKeyChange: (apiKey: string) => void
  onRememberKeyChange: (remember: boolean) => void
  onAllowProposalsChange: (allow: boolean) => void
  // Proposal (slice 2). Present only when the model has staged a change.
  proposal?: PendingProposal
  /** Why applying is blocked right now (armed/disconnected/syncing), if at all. */
  writeBlockReason?: string
  onApplyProposal: () => void
  onDiscardProposal: () => void
  // Conversation actions.
  onSend: (text: string) => void
  onStop: () => void
  onClear: () => void
}

function formatValue(value: number | undefined): string {
  if (value === undefined) return '—'
  return Number.isInteger(value) ? String(value) : Number(value.toFixed(4)).toString()
}

function SettingsForm(props: AiAssistantViewProps) {
  const meta = providerMetadata(props.providerId)
  return (
    <div className="bf-note" data-testid="ai-assistant-settings">
      <div className="ai-assistant__settings-grid">
        <label>
          <span>Provider</span>
          <select
            data-testid="ai-assistant-provider-select"
            value={props.providerId}
            onChange={(event) => props.onProviderChange(event.target.value as ChatProviderId)}
          >
            {PROVIDER_METADATA.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Model</span>
          <input
            data-testid="ai-assistant-model-input"
            type="text"
            value={props.model}
            placeholder={meta?.modelPlaceholder}
            onChange={(event) => props.onModelChange(event.target.value)}
          />
        </label>
        {meta?.needsApiKey ? (
          <label>
            <span>API key</span>
            <input
              data-testid="ai-assistant-key-input"
              type="password"
              autoComplete="off"
              value={props.apiKey}
              placeholder="Paste your key"
              onChange={(event) => props.onApiKeyChange(event.target.value)}
            />
          </label>
        ) : null}
        {meta?.baseUrlPlaceholder !== undefined || !meta?.needsApiKey ? (
          <label>
            <span>Base URL{meta?.needsApiKey ? ' (optional)' : ''}</span>
            <input
              data-testid="ai-assistant-baseurl-input"
              type="text"
              value={props.baseUrl}
              placeholder={meta?.baseUrlPlaceholder ?? 'Default'}
              onChange={(event) => props.onBaseUrlChange(event.target.value)}
            />
          </label>
        ) : null}
      </div>
      {meta?.needsApiKey ? (
        <label className="ai-assistant__remember">
          <input
            data-testid="ai-assistant-remember-key"
            type="checkbox"
            checked={props.rememberKey}
            onChange={(event) => props.onRememberKeyChange(event.target.checked)}
          />
          <span>
            Remember this key on this device. It is stored in your browser’s local storage in plain
            text — anyone with access to this browser (or a script injected into this page) could read
            it. Leave off to keep it in memory only (cleared on reload).
          </span>
        </label>
      ) : null}
      {meta?.note ? <p className="ai-assistant__note">{meta.note}</p> : null}
      <label className="ai-assistant__remember">
        <input
          data-testid="ai-assistant-allow-proposals"
          type="checkbox"
          checked={props.allowProposals}
          onChange={(event) => props.onAllowProposalsChange(event.target.checked)}
        />
        <span>
          Let the assistant propose parameter changes. Proposals are never applied automatically —
          you review a diff and approve each apply. Turn off for read-only Q&amp;A.
        </span>
      </label>
    </div>
  )
}

function ProposalRow(props: { entry: ProposalReviewEntry }) {
  const { entry } = props
  const invalid = entry.status === 'invalid'
  const unchanged = entry.status === 'unchanged'
  return (
    <div
      className={`ai-assistant__proposal-row${invalid ? ' ai-assistant__proposal-row--invalid' : ''}`}
      data-testid={`ai-assistant-proposal-row-${entry.id}`}
      data-status={entry.status}
    >
      <div className="ai-assistant__proposal-row-head">
        <code>{entry.id}</code>
        <span className="ai-assistant__proposal-change">
          {formatValue(entry.currentValue)} → <strong>{formatValue(entry.nextValue ?? entry.currentValue)}</strong>
          {entry.unit ? ` ${entry.unit}` : ''}
        </span>
      </div>
      {entry.label ? <p className="ai-assistant__proposal-label">{entry.label}</p> : null}
      {entry.why ? <p className="ai-assistant__proposal-why">{entry.why}</p> : null}
      {invalid && entry.reason ? <p className="ai-assistant__proposal-invalid">{entry.reason}</p> : null}
      {unchanged ? <p className="ai-assistant__proposal-invalid">Already at this value.</p> : null}
    </div>
  )
}

function ProposalCard(props: {
  proposal: PendingProposal
  writeBlockReason?: string
  onApply: () => void
  onDiscard: () => void
}) {
  const { proposal, writeBlockReason, onApply, onDiscard } = props
  const { review, status } = proposal
  const [acknowledged, setAcknowledged] = useState(false)
  const applying = status === 'applying'
  const applied = status === 'applied'
  const canApply = review.canApply && !writeBlockReason && acknowledged && !applying && !applied

  return (
    <div className="ai-assistant__proposal" data-testid="ai-assistant-proposal" data-status={status}>
      <div className="ai-assistant__proposal-header">
        <strong>Proposed change{review.stagedCount === 1 ? '' : 's'}</strong>
        {proposal.summary ? <span className="ai-assistant__proposal-summary">{proposal.summary}</span> : null}
      </div>

      <div className="ai-assistant__proposal-rows">
        {review.entries.map((entry) => (
          <ProposalRow key={entry.id} entry={entry} />
        ))}
      </div>

      {applied && proposal.result ? (
        <div className="bf-note bf-note--success" data-testid="ai-assistant-proposal-result">
          <p>
            Applied: {proposal.result.applied} verified
            {proposal.result.unconfirmed > 0 ? `, ${proposal.result.unconfirmed} unconfirmed` : ''}
            {proposal.result.rolledBack > 0 ? `, ${proposal.result.rolledBack} rolled back` : ''}. A backup was
            saved to Snapshots before the write.
          </p>
        </div>
      ) : proposal.status === 'error' && proposal.error ? (
        <div className="bf-note bf-note--warning" data-testid="ai-assistant-proposal-result">
          <p>{proposal.error}</p>
        </div>
      ) : (
        <>
          {review.invalidCount > 0 ? (
            <p className="ai-assistant__hint">
              {review.invalidCount} change{review.invalidCount === 1 ? '' : 's'} can’t be applied (invalid or out of
              range) — fix or ask the assistant to revise before applying.
            </p>
          ) : null}
          {writeBlockReason ? <p className="ai-assistant__hint">{writeBlockReason}</p> : null}
          {review.canApply && !writeBlockReason ? (
            <label className="ai-assistant__proposal-ack">
              <input
                data-testid="ai-assistant-proposal-ack"
                type="checkbox"
                checked={acknowledged}
                disabled={applying}
                onChange={(event) => setAcknowledged(event.target.checked)}
              />
              <span>I’ve reviewed these changes and want to write them to the flight controller.</span>
            </label>
          ) : null}
          <div className="ai-assistant__proposal-actions">
            <button
              type="button"
              style={buttonStyle('primary')}
              data-testid="ai-assistant-proposal-apply"
              disabled={!canApply}
              onClick={onApply}
            >
              {applying
                ? `Applying… (${proposal.progress?.completed ?? 0}/${proposal.progress?.total ?? review.stagedCount})`
                : `Apply ${review.stagedCount} change${review.stagedCount === 1 ? '' : 's'}`}
            </button>
            <button
              type="button"
              style={buttonStyle('secondary')}
              data-testid="ai-assistant-proposal-discard"
              disabled={applying}
              onClick={onDiscard}
            >
              Discard
            </button>
          </div>
        </>
      )}
    </div>
  )
}

function ToolChip(props: { name: string; done: boolean }) {
  return (
    <span
      className={`ai-assistant__tool-chip${props.done ? ' ai-assistant__tool-chip--done' : ''}`}
      data-testid="ai-assistant-tool-chip"
      data-tool={props.name}
      data-done={props.done ? 'true' : 'false'}
    >
      {props.done ? '✓' : '…'} {props.name}
    </span>
  )
}

function Composer(props: { view: AiAssistantViewProps }) {
  const { view } = props
  const [draft, setDraft] = useState('')
  const composer = resolveComposerState({
    connected: view.connected,
    configReady: view.configReady,
    streaming: view.status === 'streaming',
    draftIsEmpty: draft.trim().length === 0
  })

  const submit = () => {
    if (!composer.canSend) return
    view.onSend(draft)
    setDraft('')
  }

  return (
    <div className="ai-assistant__composer">
      <textarea
        data-testid="ai-assistant-input"
        rows={2}
        value={draft}
        placeholder="Ask about your vehicle’s configuration…"
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            submit()
          }
        }}
      />
      <div className="ai-assistant__composer-actions">
        {view.status === 'streaming' ? (
          <button type="button" style={buttonStyle('secondary')} data-testid="ai-assistant-stop" onClick={view.onStop}>
            Stop
          </button>
        ) : (
          <button
            type="button"
            style={buttonStyle('primary')}
            data-testid="ai-assistant-send"
            disabled={!composer.canSend}
            onClick={submit}
          >
            Send
          </button>
        )}
      </div>
      {composer.hint ? <p className="ai-assistant__hint">{composer.hint}</p> : null}
    </div>
  )
}

export function AiAssistantView(props: AiAssistantViewProps) {
  return (
    <Panel
      title="AI Assistant"
      subtitle="Bring your own model (Claude, GPT, or a local Ollama) to discuss your vehicle’s current configuration. Read-only — the assistant can inspect parameters and telemetry but cannot change anything yet."
    >
      <div data-testid="ai-assistant-view" className="ai-assistant">
        <details className="ai-assistant__settings-disclosure" open={!props.configReady}>
          <summary>Model &amp; provider settings</summary>
          <SettingsForm {...props} />
        </details>

        {props.error ? (
          <div className="bf-note bf-note--warning" data-testid="ai-assistant-error">
            <p>{props.error}</p>
          </div>
        ) : null}

        <div className="ai-assistant__transcript" data-testid="ai-assistant-transcript">
          {props.transcript.length === 0 ? (
            <p className="ai-assistant__empty" data-testid="ai-assistant-empty">
              {props.configReady
                ? props.connected
                  ? 'Ask a question about your connected vehicle — for example, “Why won’t it arm?” or “Is my battery failsafe set up?”'
                  : 'Configured. Connect a vehicle to ask about its live state, or ask a general ArduPilot question.'
                : 'Add your model provider and key above to get started.'}
            </p>
          ) : (
            props.transcript.map((turn) => (
              <div
                key={turn.key}
                className={`ai-assistant__turn ai-assistant__turn--${turn.role}`}
                data-testid="ai-assistant-message"
                data-role={turn.role}
              >
                {turn.text ? <p className="ai-assistant__turn-text">{turn.text}</p> : null}
                {turn.toolCalls.length > 0 ? (
                  <div className="ai-assistant__tool-chips">
                    {turn.toolCalls.map((call) => (
                      <ToolChip key={call.id} name={call.name} done={call.done} />
                    ))}
                  </div>
                ) : null}
              </div>
            ))
          )}
        </div>

        {props.proposal ? (
          <ProposalCard
            proposal={props.proposal}
            writeBlockReason={props.writeBlockReason}
            onApply={props.onApplyProposal}
            onDiscard={props.onDiscardProposal}
          />
        ) : null}

        <Composer view={props} />

        {props.transcript.length > 0 ? (
          <button
            type="button"
            style={buttonStyle('secondary')}
            data-testid="ai-assistant-clear"
            onClick={props.onClear}
          >
            Clear conversation
          </button>
        ) : null}
      </div>
    </Panel>
  )
}
