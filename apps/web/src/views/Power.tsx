import type { ReactNode } from 'react'
import { StatusBadge, buttonStyle } from '@arduconfig/ui-kit'
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
  parameterNotice: PowerParameterNotice | null
  liveMetrics: PowerLiveMetrics
  configPills: PowerConfigPills
  fields: readonly PowerFieldSpec[]
  editedValues: Record<string, string>
  onEditChange: (paramId: string, value: string) => void
  draftStatusById: ScopedFieldDraftMap
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

/**
 * The battery panel, rendered inside Config's Power card.
 *
 * It carries no heading of its own. The card above it is titled "Battery" with
 * an "i" for the guidance, and the health badge sits on that title line only
 * when the battery needs attention -- this used to stack "Battery & power",
 * "Battery", "Battery monitor" and "Battery configuration" over one set of
 * four fields.
 */
export function PowerView(props: PowerViewProps) {
  const {
    parameterNotice,
    liveMetrics,
    configPills,
    fields,
    editedValues,
    onEditChange,
    draftStatusById,
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
    <div id="setup-panel-power" className="power-panel">
      {parameterNotice ? (
        <div className="parameter-review__notice">
          <StatusBadge tone={parameterNotice.tone}>{parameterNotice.toneLabel}</StatusBadge>
          <p>{parameterNotice.text}</p>
        </div>
      ) : null}

      {/* The live readout, with the monitor source as its last item (it was a
          pill on a line of its own under the strip). */}
      <div className="power-live-strip" data-testid="power-live-metrics">
        <span><label>Voltage</label> <strong>{liveMetrics.voltageText}</strong></span>
        <span><label>Current</label> <strong>{liveMetrics.currentText}</strong></span>
        <span><label>Remaining</label> <strong>{liveMetrics.remainingText}</strong></span>
        <span><label>Capacity</label> <strong>{liveMetrics.capacityText}</strong></span>
        <span data-testid="power-monitor-source"><label>Monitor</label> <strong>{configPills.monitor}</strong></span>
      </div>

      <div className="scoped-editor-grid" data-testid="power-fields">
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
              layout="chips"
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

      {/* Battery parameters apply on their own (they are not in Config's
          scope), so this bar stays -- but only once something is staged. */}
      {draftItems.length > 0 ? (
        <div className="power-panel__review" data-testid="power-review">
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
          <div className="switch-exercise-controls">
            <button
              style={buttonStyle('primary')}
              onClick={onApply}
              disabled={isBusy || stagedCount === 0 || invalidCount > 0 || !canApply}
              data-testid="power-apply"
            >
              {isApplying ? 'Applying…' : `Apply Power Changes (${stagedCount})`}
            </button>
            <button
              style={buttonStyle()}
              onClick={onDiscard}
              disabled={isBusy || draftCount === 0}
              data-testid="power-discard"
            >
              Discard Power Changes
            </button>
          </div>
        </div>
      ) : null}

      {additionalSettingsSlot}
    </div>
  )
}
