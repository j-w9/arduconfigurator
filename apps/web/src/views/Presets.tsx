import { useState } from 'react'

import { Panel, StatusBadge, buttonStyle } from '@arduconfig/ui-kit'

export type PresetsStatusTone = 'success' | 'warning' | 'danger' | 'neutral'

export interface PresetsNotice {
  tone: PresetsStatusTone
  toneLabel: string
  text: string
}

export interface PresetsFollowUp {
  requiresReboot: boolean
  text: string
}

export interface PresetsCard {
  id: string
  label: string
  description: string
  paramCount: number
  tags: readonly string[]
  note?: string
  changedCount: number
  invalidCount: number
  badgeLabel: string
  badgeTone: PresetsStatusTone
  isActive: boolean
}

export interface PresetsGroup {
  id: string
  label: string
  description: string
  cardCount: number
  cards: readonly PresetsCard[]
}

export interface PresetsDiffEntry {
  id: string
  label: string
  fromToText: string
  deltaText: string
}

export interface PresetsDiffGroup {
  category: string
  categoryLabel: string
  changedCount: number
  entries: readonly PresetsDiffEntry[]
}

export interface PresetsInvalidEntry {
  id: string
  label: string
  rawValue: string
  reason: string
}

export interface PresetsSelected {
  label: string
  description: string
  groupLabel: string
  applicabilityStatus: string
  applicabilityTone: PresetsStatusTone
  applicabilityReasons: readonly string[]
  paramCount: number
  changedCount: number
  unchangedCount: number
  unknownCount: number
  tags: readonly string[]
  note?: string
  prerequisites: readonly string[]
  cautions: readonly string[]
  diffGroups: readonly PresetsDiffGroup[]
  invalidEntries: readonly PresetsInvalidEntry[]
}

export interface PresetsViewProps {
  headerTone: PresetsStatusTone
  headerBadgeLabel: string
  notice: PresetsNotice | null
  followUp: PresetsFollowUp | null
  familiesCount: number
  totalCount: number
  changedCount: number
  autoBackupCount: number
  groups: readonly PresetsGroup[]
  selected: PresetsSelected | null
  applyAcknowledged: boolean
  onAcknowledgedChange: (acknowledged: boolean) => void
  onSelectPreset: (presetId: string) => void
  onApplyPreset: () => void
  onStageDraft: () => void
  isApplying: boolean
  isBusy: boolean
  canApply: boolean
  applicabilityBlocked: boolean
  hasChanges: boolean
  hasInvalid: boolean
  /** Reset every parameter to firmware defaults. Surfaces a confirm-gated
   *  "Erase all settings" control; hidden when omitted. */
  onEraseSettings?: () => void
  isErasing?: boolean
  eraseDisabledReason?: string
  /** When set, replaces the empty stat grid + group list with an honest banner
   *  explaining why no curated presets are available for this vehicle. The
   *  Erase-all-settings control still renders. */
  libraryRestrictedNote?: string
}

export function PresetsView(props: PresetsViewProps) {
  const {
    headerTone,
    headerBadgeLabel,
    notice,
    followUp,
    familiesCount,
    totalCount,
    changedCount,
    autoBackupCount,
    groups,
    selected,
    applyAcknowledged,
    onAcknowledgedChange,
    onSelectPreset,
    onApplyPreset,
    onStageDraft,
    isApplying,
    isBusy,
    canApply,
    applicabilityBlocked,
    hasChanges,
    hasInvalid,
    onEraseSettings,
    isErasing = false,
    eraseDisabledReason,
    libraryRestrictedNote
  } = props

  // Two-step confirm for the destructive reset-to-defaults action.
  const [eraseArmed, setEraseArmed] = useState(false)

  return (
    <section className="grid one-up">
      <Panel
        title="Presets"
        subtitle="Curated tuning bundles for common setups."
      >
        <div className="telemetry-stack">
          <div className="telemetry-header">
            <div>
              <h3>Preset library</h3>
              <p>
                Presets stay intentionally narrow: they touch only the small, high-value tuning controls already exposed in this product. Every
                apply requires diff review, and a pre-apply snapshot is captured automatically before any write is sent.
              </p>
            </div>
            <StatusBadge tone={headerTone}>{headerBadgeLabel}</StatusBadge>
          </div>

          {notice ? (
            <div className="parameter-review__notice">
              <StatusBadge tone={notice.tone}>{notice.toneLabel}</StatusBadge>
              <p>{notice.text}</p>
            </div>
          ) : null}

          {onEraseSettings ? (
            <div className="presets-erase" data-testid="presets-erase">
              <div className="presets-erase__copy">
                <strong>Erase all settings</strong>
                <p>
                  Resets every parameter to firmware defaults, then reboots. This wipes your entire configuration — capture a snapshot first if you might want it back.
                </p>
              </div>
              {eraseArmed ? (
                <div className="button-row" data-testid="presets-erase-confirm-row">
                  <button
                    type="button"
                    style={buttonStyle()}
                    className="presets-erase__danger-btn"
                    data-testid="presets-erase-confirm"
                    disabled={isErasing || isBusy}
                    onClick={() => {
                      setEraseArmed(false)
                      onEraseSettings()
                    }}
                  >
                    {isErasing ? 'Erasing…' : 'Confirm: erase everything'}
                  </button>
                  <button
                    type="button"
                    style={buttonStyle()}
                    data-testid="presets-erase-cancel"
                    disabled={isErasing}
                    onClick={() => setEraseArmed(false)}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  style={buttonStyle()}
                  className="presets-erase__danger-btn"
                  data-testid="presets-erase-button"
                  disabled={isErasing || isBusy || Boolean(eraseDisabledReason)}
                  title={eraseDisabledReason}
                  onClick={() => setEraseArmed(true)}
                >
                  Erase all settings
                </button>
              )}
            </div>
          ) : null}

          {followUp ? (
            <div className="parameter-follow-up">
              <StatusBadge tone={followUp.requiresReboot ? 'warning' : 'neutral'}>
                {followUp.requiresReboot ? 'reboot' : 'refresh'}
              </StatusBadge>
              <p>{followUp.text}</p>
              <small>Use the header session strip to complete the pending reboot or refresh after a preset apply.</small>
            </div>
          ) : null}

          {libraryRestrictedNote ? (
            <div className="parameter-review__notice" data-testid="presets-library-restricted">
              <StatusBadge tone="neutral">unavailable</StatusBadge>
              <p>{libraryRestrictedNote}</p>
            </div>
          ) : (
            <div className="telemetry-metric-grid">
              <article className="telemetry-metric-card">
                <span>Preset families</span>
                <strong>{familiesCount}</strong>
              </article>
              <article className="telemetry-metric-card">
                <span>Total presets</span>
                <strong>{totalCount}</strong>
              </article>
              <article className="telemetry-metric-card">
                <span>Changed vs live</span>
                <strong>{changedCount}</strong>
              </article>
              <article className="telemetry-metric-card">
                <span>Auto backups</span>
                <strong>{autoBackupCount}</strong>
              </article>
            </div>
          )}

          {libraryRestrictedNote ? null : groups.length > 0 ? (
            <div className="preset-group-grid">
              {groups.map((group) => (
                <section key={group.id} className="preset-group">
                  <header className="preset-group__header">
                    <div>
                      <strong>{group.label}</strong>
                      <p>{group.description}</p>
                    </div>
                    <StatusBadge tone="neutral">{group.cardCount} presets</StatusBadge>
                  </header>

                  <div className="preset-card-grid">
                    {group.cards.map((card) => (
                      <button
                        key={card.id}
                        type="button"
                        data-testid={`preset-card-${card.id}`}
                        className={`preset-card${card.isActive ? ' is-active' : ''}`}
                        onClick={() => onSelectPreset(card.id)}
                      >
                        <div className="preset-card__header">
                          <div>
                            <strong>{card.label}</strong>
                            <small>{card.description}</small>
                          </div>
                          <StatusBadge tone={card.badgeTone}>{card.badgeLabel}</StatusBadge>
                        </div>

                        <div className="config-pills">
                          <span>{card.paramCount} params</span>
                          {card.tags.slice(0, 3).map((tag) => (
                            <span key={`${card.id}:${tag}`}>#{tag}</span>
                          ))}
                        </div>

                        {card.note ? <p>{card.note}</p> : null}
                      </button>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <p className="telemetry-note">No presets are defined in the current firmware metadata bundle yet.</p>
          )}

          {selected ? (
            <div className="preset-selected">
              <div className="telemetry-header">
                <div>
                  <h3>{selected.label}</h3>
                  <p>{selected.description}</p>
                </div>
                <div className="preset-selected__badges">
                  <StatusBadge tone="neutral">{selected.groupLabel}</StatusBadge>
                  <StatusBadge tone={selected.applicabilityTone}>{selected.applicabilityStatus}</StatusBadge>
                </div>
              </div>

              <div className="telemetry-metric-grid">
                <article className="telemetry-metric-card">
                  <span>Touched params</span>
                  <strong>{selected.paramCount}</strong>
                </article>
                <article className="telemetry-metric-card">
                  <span>Changed on live</span>
                  <strong>{selected.changedCount}</strong>
                </article>
                <article className="telemetry-metric-card">
                  <span>Already matched</span>
                  <strong>{selected.unchangedCount}</strong>
                </article>
                <article className="telemetry-metric-card">
                  <span>Unknown on live</span>
                  <strong>{selected.unknownCount}</strong>
                </article>
              </div>

              <div className="config-pills">
                <span>{selected.groupLabel}</span>
                {selected.tags.map((tag) => (
                  <span key={`selected:tag:${tag}`}>#{tag}</span>
                ))}
              </div>

              {selected.note ? <p className="snapshot-selected__note">{selected.note}</p> : null}

              {selected.prerequisites.length > 0 ? (
                <div className="preset-notes">
                  <strong>Before you apply</strong>
                  <ul className="output-note-list">
                    {selected.prerequisites.map((item) => (
                      <li key={`prereq:${item}`}>{item}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {selected.applicabilityReasons.length > 0 ? (
                <div className={`parameter-follow-up${applicabilityBlocked ? ' parameter-follow-up--warning' : ''}`}>
                  <StatusBadge tone={selected.applicabilityTone}>{selected.applicabilityStatus}</StatusBadge>
                  <p>{selected.applicabilityReasons.join(' ')}</p>
                </div>
              ) : null}

              {selected.cautions.length > 0 ? (
                <div className="preset-notes">
                  <strong>Cautions</strong>
                  <ul className="output-note-list">
                    {selected.cautions.map((item) => (
                      <li key={`caution:${item}`}>{item}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {selected.unknownCount > 0 ? (
                <div className="parameter-follow-up parameter-follow-up--warning">
                  <StatusBadge tone="warning">partial</StatusBadge>
                  <p>
                    {selected.unknownCount} preset parameter(s) do not exist in the current live metadata set and will be ignored.
                  </p>
                </div>
              ) : null}

              {hasChanges ? (
                <div className="parameter-diff-grid">
                  {selected.diffGroups.map((group) => (
                    <section key={group.category} className="parameter-diff-group">
                      <header>
                        <strong>{group.categoryLabel}</strong>
                        <span>{group.changedCount} changed</span>
                      </header>

                      {group.entries.map((entry) => (
                        <div key={entry.id} className="parameter-diff-item">
                          <span>
                            <strong>{entry.id}</strong>
                            <small>{entry.label}</small>
                          </span>
                          <span className="parameter-diff-values">{entry.fromToText}</span>
                          <span className="parameter-diff-delta">{entry.deltaText}</span>
                        </div>
                      ))}
                    </section>
                  ))}
                </div>
              ) : (
                <p className="telemetry-note">
                  This preset already matches the currently synced values, so there is nothing to apply right now.
                </p>
              )}

              {hasInvalid ? (
                <div className="parameter-diff-grid parameter-diff-grid--invalid">
                  <section className="parameter-diff-group parameter-diff-group--invalid">
                    <header>
                      <strong>Invalid preset values</strong>
                      <span>{selected.invalidEntries.length} blocked</span>
                    </header>

                    {selected.invalidEntries.map((entry) => (
                      <div key={entry.id} className="parameter-diff-item">
                        <span>
                          <strong>{entry.id}</strong>
                          <small>{entry.label}</small>
                        </span>
                        <span className="parameter-diff-values">{entry.rawValue || 'Empty draft'}</span>
                        <span className="parameter-diff-delta">{entry.reason}</span>
                      </div>
                    ))}
                  </section>
                </div>
              ) : null}

              <div className="parameter-follow-up parameter-follow-up--warning">
                <StatusBadge tone="warning">backup</StatusBadge>
                <p>
                  Applying a preset writes only the diff shown above, verifies every write, and automatically captures a pre-apply snapshot in the
                  Snapshots library before sending anything to the controller.
                </p>
              </div>

              <label className="snapshot-restore-ack">
                <input
                  data-testid="preset-apply-ack"
                  type="checkbox"
                  checked={applyAcknowledged}
                  onChange={(event) => onAcknowledgedChange(event.target.checked)}
                  disabled={isBusy || !hasChanges}
                />
                <span>I reviewed this preset diff and want ArduConfigurator to capture a backup and apply these changes to the live controller.</span>
              </label>

              <div className="switch-exercise-controls">
                <button
                  data-testid="apply-preset-button"
                  style={buttonStyle('primary')}
                  onClick={onApplyPreset}
                  disabled={isBusy || !hasChanges || hasInvalid || applicabilityBlocked || !applyAcknowledged || !canApply}
                >
                  {isApplying ? 'Applying…' : `Apply Selected (${selected.changedCount})`}
                </button>
                <button
                  style={buttonStyle()}
                  onClick={onStageDraft}
                  disabled={isBusy || !hasChanges || applicabilityBlocked}
                >
                  Load as Manual Tuning Draft
                </button>
              </div>
            </div>
          ) : null}

          <p className="telemetry-note">
            Presets are designed to stay explainable and reversible. They are not broad tune dumps, and they intentionally stop at the first small
            set of flight-feel and rate/expo controls.
          </p>
        </div>
      </Panel>
    </section>
  )
}
