import type { ReactNode } from 'react'
import { Panel, StatusBadge, buttonStyle } from '@arduconfig/ui-kit'
import type { ParameterState } from '@arduconfig/ardupilot-core'

import { ScopedField, ScopedSelectField, type ScopedFieldDraftMap } from './ScopedField'

export type PowerStatusTone = 'success' | 'warning' | 'danger' | 'neutral'

export interface PowerLiveMetrics {
  voltageText: string
  currentText: string
  remainingText: string
  capacityText: string
}

export interface PowerConfigPills {
  monitor: string
  // Failsafe-action pills (voltageSource / lowAction / criticalAction /
  // throttleFailsafe / throttleFailsafePwm) used to live here too; they
  // moved to the Failsafe tab so all loss-of-link behavior clusters in
  // one place. Power keeps only the monitor-source pill — the rest of
  // the battery-setup story is read directly from the inline scoped
  // editors below.
}

export interface PowerFieldSpec {
  parameter: ParameterState
  liveValue: number | undefined
  kind: 'select' | 'number'
  stepFallback?: number
}

export interface PowerDraftItem {
  id: string
  label: string
  status: string
  badgeTone: PowerStatusTone
  summary: string
}

export interface PowerParameterNotice {
  tone: PowerStatusTone
  toneLabel: string
  text: string
}

export interface PowerViewProps {
  isBatteryVerified: boolean
  batteryHealthLabel: string
  batteryHealthTone: PowerStatusTone
  parameterNotice: PowerParameterNotice | null
  liveMetrics: PowerLiveMetrics
  configPills: PowerConfigPills
  fields: readonly PowerFieldSpec[]
  editedValues: Record<string, string>
  onEditChange: (paramId: string, value: string) => void
  draftStatusById: ScopedFieldDraftMap
  scopedReviewStatusLabel: string
  scopedReviewTone: PowerStatusTone
  draftItems: readonly PowerDraftItem[]
  stagedCount: number
  draftCount: number
  invalidCount: number
  canApply: boolean
  isApplying: boolean
  isBusy: boolean
  onApply: () => void
  onDiscard: () => void
  additionalSettingsSlot: ReactNode
}

export function PowerView(props: PowerViewProps) {
  const {
    isBatteryVerified,
    batteryHealthLabel,
    batteryHealthTone,
    parameterNotice,
    liveMetrics,
    configPills,
    fields,
    editedValues,
    onEditChange,
    draftStatusById,
    scopedReviewStatusLabel,
    scopedReviewTone,
    draftItems,
    stagedCount,
    draftCount,
    invalidCount,
    canApply,
    isApplying,
    isBusy,
    onApply,
    onDiscard,
    additionalSettingsSlot
  } = props

  return (
    <div id="setup-panel-power">
      <Panel
        title="Battery"
        subtitle="Live battery telemetry plus monitor / capacity / arming setup. Loss-of-link and battery failsafe live on the Failsafe tab."
      >
        <div className="telemetry-stack">
          <div className="telemetry-header">
            <div>
              <h3>Battery monitor</h3>
              <p>
                {isBatteryVerified
                  ? 'Live power telemetry is present, so the battery setup can move beyond parameter-only review.'
                  : 'Battery monitor telemetry has not been verified yet. Keep the power train and battery sensing path active.'}
              </p>
            </div>
            <StatusBadge tone={batteryHealthTone}>{batteryHealthLabel}</StatusBadge>
          </div>

          {parameterNotice ? (
            <div className="parameter-review__notice">
              <StatusBadge tone={parameterNotice.tone}>{parameterNotice.toneLabel}</StatusBadge>
              <p>{parameterNotice.text}</p>
            </div>
          ) : null}

          <div className="power-live-strip" data-testid="power-live-metrics">
            <span><label>Voltage</label> <strong>{liveMetrics.voltageText}</strong></span>
            <span><label>Current</label> <strong>{liveMetrics.currentText}</strong></span>
            <span><label>Remaining</label> <strong>{liveMetrics.remainingText}</strong></span>
            <span><label>Capacity</label> <strong>{liveMetrics.capacityText}</strong></span>
          </div>

          <div className="config-pills">
            <span>Battery monitor: {configPills.monitor}</span>
          </div>

          <div className="scoped-review-card">
            <div className="switch-exercise-card__header">
              <div>
                <strong>Battery configuration</strong>
                <p>
                  Keep routine battery-monitor changes local to this view. Apply them here, then verify live telemetry and pre-arm state
                  before first flight. Loss-of-link, throttle, and battery failsafe live on the Failsafe tab.
                </p>
              </div>
              <StatusBadge tone={scopedReviewTone}>{scopedReviewStatusLabel}</StatusBadge>
            </div>

            <div className="scoped-editor-grid">
              {fields.map((field) =>
                field.kind === 'select' ? (
                  <ScopedSelectField
                    key={field.parameter.id}
                    parameter={field.parameter}
                    liveValue={field.liveValue}
                    editedValues={editedValues}
                    onChange={onEditChange}
                    draftStatusById={draftStatusById}
                    compact={false}
                  />
                ) : (
                  <ScopedField
                    key={field.parameter.id}
                    parameter={field.parameter}
                    liveValue={field.liveValue}
                    editedValues={editedValues}
                    onChange={onEditChange}
                    draftStatusById={draftStatusById}
                    compact={false}
                    stepFallback={field.stepFallback ?? 1}
                  />
                )
              )}
            </div>

            <ul className="output-note-list">
              <li>After changing the battery monitor source or arming gates, verify live telemetry and re-check pre-arm before first flight.</li>
              <li>Voltage/mAh failsafe triggers and throttle/loss-of-link actions live on the Failsafe tab.</li>
            </ul>

            {draftItems.length > 0 ? (
              <div className="scoped-draft-list">
                {draftItems.map((draft) => (
                  <article key={draft.id} className={`scoped-draft-item scoped-draft-item--${draft.status}`}>
                    <div className="scoped-draft-item__header">
                      <strong>{draft.label}</strong>
                      <StatusBadge tone={draft.badgeTone}>{draft.status}</StatusBadge>
                    </div>
                    <p>{draft.id}</p>
                    <small>{draft.summary}</small>
                  </article>
                ))}
              </div>
            ) : (
              <p className="success-copy">No power or failsafe changes are staged right now.</p>
            )}

            <div className="switch-exercise-controls">
              <button
                style={buttonStyle('primary')}
                onClick={onApply}
                disabled={isBusy || stagedCount === 0 || invalidCount > 0 || !canApply}
              >
                {isApplying ? 'Applying…' : `Apply Power Changes (${stagedCount})`}
              </button>
              <button
                style={buttonStyle()}
                onClick={onDiscard}
                disabled={isBusy || draftCount === 0}
              >
                Discard Power Changes
              </button>
            </div>
          </div>

          {additionalSettingsSlot}

          {/* Pre-arm status lives on the Status & Info tab now (Statistics box) —
              no longer duplicated here. */}
          <p className="telemetry-note">
            The setup checklist treats these sections as truly complete only when both the configuration values and the live telemetry agree.
            Pre-arm status is shown on the Status &amp; Info tab.
          </p>
        </div>
      </Panel>
    </div>
  )
}
