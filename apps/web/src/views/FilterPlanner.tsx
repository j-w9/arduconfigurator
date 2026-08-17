import type { ReactElement, ReactNode } from 'react'
import { buttonStyle } from '@arduconfig/ui-kit'
import type { ParameterState } from '@arduconfig/ardupilot-core'

import { describeNotchOpts, documentedNotchBandwidth, documentedNotchRef } from '../view-models/filter-planner'

/**
 * Every filter in one place.
 *
 * The fields are NOT hand-rolled number inputs. They go through the app's
 * shared metadata renderer, which is what gives each parameter its real
 * editor -- a per-bit checkbox grid for a bitmask like INS_HNTCH_OPTS, a
 * select for an enum like INS_HNTCH_MODE, a number with an inferred step
 * otherwise -- plus the "i" bubble naming the raw parameter and linking to its
 * wiki page. An earlier version of this view reimplemented all of that badly:
 * OPTS was a bare number box and MODE was a hand-written <select> that had to
 * be kept in step with the firmware by hand.
 *
 * Nothing here derives a value. The two buttons below the notch block are the
 * only arithmetic, they are the two rules ArduPilot documents, and they stage
 * a draft the operator can then edit like any other.
 */
export interface FilterPlannerViewProps {
  /** Filter parameters the vehicle actually reports, already ordered. */
  gyroParameters: readonly ParameterState[]
  rateParameters: readonly ParameterState[]
  notchParameters: readonly ParameterState[]
  /** The shared metadata field renderer — bitmask/enum/number + info bubble. */
  renderField: (parameter: ParameterState) => ReactNode
  /** Current values, for the documented suggestions and the warnings. */
  liveValues: ReadonlyMap<string, number>
  editedValues: Record<string, string>
  onSetDraft: (paramId: string, value: string) => void
  disabled?: boolean
}

/** Draft value if staged, else the live one — what the vehicle would end up with. */
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

export function FilterPlannerView(props: FilterPlannerViewProps): ReactElement {
  const {
    gyroParameters,
    rateParameters,
    notchParameters,
    renderField,
    liveValues,
    editedValues,
    onSetDraft,
    disabled = false
  } = props

  const freq = effective('INS_HNTCH_FREQ', editedValues, liveValues)
  const mode = effective('INS_HNTCH_MODE', editedValues, liveValues)
  const ref = effective('INS_HNTCH_REF', editedValues, liveValues)
  const enable = effective('INS_HNTCH_ENABLE', editedValues, liveValues)
  const opts = effective('INS_HNTCH_OPTS', editedValues, liveValues)

  const suggestedBw = freq !== undefined ? documentedNotchBandwidth(freq) : undefined
  const suggestedRef =
    mode !== undefined ? documentedNotchRef(Math.round(mode), liveValues.get('MOT_THST_HOVER')) : undefined
  // A measured RPM source knows the real frequency, so the half-the-centre
  // rule -- which exists to cover throttle-mode's inference error -- does not
  // apply and no bandwidth is proposed.
  const measuredSource = mode !== undefined && [2, 3, 4, 5].includes(Math.round(mode))

  return (
    <div className="filter-planner" data-testid="filter-planner-panel">
      <p className="initial-tune__lede">
        Every filter parameter in one place. Values are yours to set — the only arithmetic offered is
        the two rules ArduPilot documents.
      </p>

      <details className="metadata-settings-section" open data-testid="filter-planner-section-gyro">
        <summary className="metadata-settings-section__header">
          <strong>Gyro &amp; accelerometer</strong>
          <p>The sensor-side low-pass filters everything downstream sees.</p>
        </summary>
        <div className="scoped-editor-grid">{gyroParameters.map((parameter) => renderField(parameter))}</div>
      </details>

      <details className="metadata-settings-section" open data-testid="filter-planner-section-rate">
        <summary className="metadata-settings-section__header">
          <strong>Rate loop</strong>
          <p>Target, error and D-term filters per axis. Zero is valid and disables that path.</p>
        </summary>
        <div className="scoped-editor-grid">{rateParameters.map((parameter) => renderField(parameter))}</div>
      </details>

      <details className="metadata-settings-section" open data-testid="filter-planner-section-notch">
        <summary className="metadata-settings-section__header">
          <strong>Harmonic notch</strong>
          <p>Motor-frequency noise. The centre comes from an FFT, ESC telemetry or RPM — not from the gyro filter.</p>
        </summary>
        <div className="scoped-editor-grid">{notchParameters.map((parameter) => renderField(parameter))}</div>

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
            INS_HNTCH_REF is 0, which ArduPilot documents as disabling dynamic updates — the notch will
            not track.
          </p>
        ) : null}
      </details>
    </div>
  )
}
