import type { ReactElement } from 'react'
import { buttonStyle } from '@arduconfig/ui-kit'

import { describeNotchOpts, documentedNotchBandwidth, documentedNotchRef } from '../view-models/filter-planner'

/**
 * The two documented notch suggestions, and what the current values mean.
 *
 * Sits under the Filters grid rather than in a tab of its own. There was
 * briefly a separate "Filter Editor" tab, which meant two Tuning tabs both
 * about filters, editing overlapping parameters, in two different layouts. A
 * noise pass is one job.
 *
 * Nothing here derives a value. Each button FILLS a field the operator can
 * then edit, and both rules are ArduPilot's own.
 */
export interface FilterNotchHelpProps {
  liveValues: ReadonlyMap<string, number>
  editedValues: Record<string, string>
  onSetDraft: (paramId: string, value: string) => void
  disabled?: boolean
}

/** Draft value if staged, else live — what the vehicle would end up with. */
function effective(
  id: string,
  editedValues: Record<string, string>,
  liveValues: ReadonlyMap<string, number>
): number | undefined {
  const draft = editedValues[id]
  if (draft !== undefined && draft.trim() !== '') {
    const parsed = Number.parseFloat(draft)
    if (Number.isFinite(parsed)) return parsed
  }
  return liveValues.get(id)
}

export function FilterNotchHelp(props: FilterNotchHelpProps): ReactElement | null {
  const { liveValues, editedValues, onSetDraft, disabled = false } = props

  const freq = effective('INS_HNTCH_FREQ', editedValues, liveValues)
  const mode = effective('INS_HNTCH_MODE', editedValues, liveValues)
  const ref = effective('INS_HNTCH_REF', editedValues, liveValues)
  const enable = effective('INS_HNTCH_ENABLE', editedValues, liveValues)
  const opts = effective('INS_HNTCH_OPTS', editedValues, liveValues)

  // No notch on this vehicle, nothing to say about it.
  if (freq === undefined && mode === undefined && enable === undefined) return null

  const suggestedBw = freq !== undefined ? documentedNotchBandwidth(freq) : undefined
  const suggestedRef =
    mode !== undefined ? documentedNotchRef(Math.round(mode), liveValues.get('MOT_THST_HOVER')) : undefined
  // A measured RPM source knows the real frequency, so the half-the-centre
  // rule — which covers throttle-mode's inference error — does not apply.
  const measuredSource = mode !== undefined && [2, 3, 4, 5].includes(Math.round(mode))

  return (
    <div className="filter-notch-help" data-testid="filter-notch-help">
      {suggestedBw !== undefined || suggestedRef !== undefined ? (
        <div className="switch-exercise-controls">
          {suggestedBw !== undefined && !measuredSource ? (
            <button
              type="button"
              style={buttonStyle()}
              data-testid="filter-planner-fill-bw"
              onClick={() => onSetDraft('INS_HNTCH_BW', String(suggestedBw))}
              disabled={disabled}
              title="ArduPilot: bandwidth is typically half the base frequency."
            >
              Use BW = {suggestedBw}
            </button>
          ) : null}
          {suggestedRef !== undefined ? (
            <button
              type="button"
              style={buttonStyle()}
              data-testid="filter-planner-fill-ref"
              onClick={() => onSetDraft('INS_HNTCH_REF', String(suggestedRef))}
              disabled={disabled}
              title="ArduPilot: 1 for RPM/ESC-telemetry tracking, hover thrust for throttle mode."
            >
              Use REF = {suggestedRef}
            </button>
          ) : null}
        </div>
      ) : null}

      {measuredSource ? (
        <p className="hint" data-testid="filter-planner-measured-note">
          Half-the-centre is the throttle-mode bandwidth rule. With a measured RPM source the frequency
          is known, a narrower notch is usual, and ArduPilot documents no ratio — so none is proposed.
        </p>
      ) : null}
      {opts !== undefined ? (
        <p className="hint" data-testid="filter-planner-opts-described">
          {describeNotchOpts(Math.round(opts))}
        </p>
      ) : null}
      {enable === 1 && ref === 0 ? (
        <p className="switch-exercise-warning" data-testid="filter-planner-warning">
          INS_HNTCH_REF is 0, which ArduPilot documents as disabling dynamic updates — the notch will not
          track.
        </p>
      ) : null}
    </div>
  )
}
