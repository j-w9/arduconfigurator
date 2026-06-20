import { Panel, StatusBadge, buttonStyle } from '@arduconfig/ui-kit'
import type { ParameterState } from '@arduconfig/ardupilot-core'

import { ScopedField, type ScopedFieldDraftMap } from './ScopedField'

export interface FailsafeViewRow {
  source: string
  paramId: string
  formatted: string
  isSynced: boolean
  /** The live parameter, when present, so the row renders an inline editor.
   *  Absent (not synced) rows fall back to the read-only formatted value. */
  parameter?: ParameterState
}

export interface FailsafeViewProps {
  rcFailsafeLabel: string
  rcFailsafeThresholdText: string
  batteryLowLabel: string
  batteryLowThresholdText: string
  batteryCriticalLabel: string
  batteryCriticalThresholdText: string
  rows: readonly FailsafeViewRow[]
  onOpenPower: () => void
  // Staged-write editing (same draft model as every other param tab).
  editedValues: Record<string, string>
  onEditChange: (paramId: string, value: string) => void
  draftStatusById: ScopedFieldDraftMap
  stagedCount: number
  invalidCount: number
  draftCount: number
  canApply: boolean
  isApplying: boolean
  isBusy: boolean
  onApply: () => void
  onRevert: () => void
}

export function FailsafeView(props: FailsafeViewProps) {
  const {
    rcFailsafeLabel,
    rcFailsafeThresholdText,
    batteryLowLabel,
    batteryLowThresholdText,
    batteryCriticalLabel,
    batteryCriticalThresholdText,
    rows,
    onOpenPower,
    editedValues,
    onEditChange,
    draftStatusById,
    stagedCount,
    invalidCount,
    draftCount,
    canApply,
    isApplying,
    isBusy,
    onApply,
    onRevert
  } = props

  return (
    <div id="setup-panel-failsafe">
      <Panel
        title="Failsafe"
        subtitle="RC, battery, and advanced failsafe parameters."
      >
        <div className="modes-stack">
          <div className="modes-status">
            <article className="modes-status__card">
              <span>RC failsafe</span>
              <strong data-testid="failsafe-rc-label">{rcFailsafeLabel}</strong>
              <small>{rcFailsafeThresholdText}</small>
            </article>
            <article className="modes-status__card">
              <span>Battery low</span>
              <strong data-testid="failsafe-battery-low-label">{batteryLowLabel}</strong>
              <small>{batteryLowThresholdText}</small>
            </article>
            <article className="modes-status__card">
              <span>Battery critical</span>
              <strong data-testid="failsafe-battery-critical-label">{batteryCriticalLabel}</strong>
              <small>{batteryCriticalThresholdText}</small>
            </article>
          </div>

          <div className="config-grid" data-testid="failsafe-editor-grid">
            {rows.map((row) => (
              <article
                key={row.paramId}
                className="config-section"
                data-testid={`failsafe-row-${row.paramId}`}
              >
                <div className="config-section__header">
                  <span className="config-section__kicker">{row.source}</span>
                  <code>{row.paramId}</code>
                </div>
                {row.parameter ? (
                  <ScopedField
                    parameter={row.parameter}
                    liveValue={row.parameter.value}
                    editedValues={editedValues}
                    draftStatusById={draftStatusById}
                    onChange={onEditChange}
                    stepFallback={row.parameter.definition?.step ?? 1}
                  />
                ) : (
                  <div className="scoped-editor-field scoped-editor-field--compact">
                    <span>{row.paramId}</span>
                    <p className="scoped-editor-field__readonly">{row.formatted}</p>
                    <StatusBadge tone="warning">not synced</StatusBadge>
                  </div>
                )}
              </article>
            ))}
          </div>

          <div className="scoped-editor-footer" data-testid="failsafe-editor-footer">
            <div className="scoped-editor-footer__counts">
              <span>{stagedCount} staged</span>
              <span>{invalidCount} invalid</span>
            </div>
            <button
              type="button"
              data-testid="failsafe-save"
              style={buttonStyle('primary')}
              onClick={onApply}
              disabled={isBusy || stagedCount === 0 || invalidCount > 0 || !canApply}
            >
              {isApplying ? 'Applying…' : `Save Failsafe (${stagedCount})`}
            </button>
            <button
              type="button"
              style={buttonStyle()}
              onClick={onRevert}
              disabled={isBusy || draftCount === 0}
            >
              Revert
            </button>
          </div>

          <section
            className="failsafe-placeholder failsafe-servo-position"
            data-testid="failsafe-servo-position-placeholder"
            aria-label="Servo failsafe positions"
          >
            <header className="failsafe-placeholder__header">
              <div>
                <strong>Servo failsafe positions</strong>
                <p>
                  Per-channel servo PWM target when an active failsafe triggers — a Mission Planner / BF style
                  per-output failsafe-position editor (e.g. centre rudder + cut throttle on RC loss). Will edit
                  SERVOn_FUNCTION sibling params for the failsafe pose; landing here under Failsafe instead of
                  Servos so all loss-of-link behavior stays in one tab.
                </p>
              </div>
              <StatusBadge tone="warning">planned</StatusBadge>
            </header>
            <p className="failsafe-placeholder__note">
              Placeholder only. Until this ships, set per-servo failsafe positions via the autopilot&apos;s
              Parameters tab.
            </p>
          </section>

          <div className="modes-help">
            <p>
              Battery and RC-loss thresholds can also be edited in the Power view; changes here and there share the
              same staged-write model.
            </p>
            <button
              type="button"
              style={buttonStyle()}
              data-testid="failsafe-go-to-power"
              onClick={onOpenPower}
            >
              Open Power
            </button>
          </div>
        </div>
      </Panel>
    </div>
  )
}
