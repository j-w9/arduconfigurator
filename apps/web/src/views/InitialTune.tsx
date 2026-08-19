import { useMemo, useState, type ReactElement } from 'react'
import { buttonStyle } from '@arduconfig/ui-kit'

import {
  BATTERY_CHEMISTRIES,
  buildInitialTuneParameters,
  type BatteryChemistry
} from '../view-models/initial-tune-parameters'

/**
 * Starting-point tuning for a new airframe.
 *
 * Three inputs, one table, one button. An earlier version explained itself at
 * length — two paragraphs of preamble, a prose reason on every row, a caption
 * under each checkbox — and the explaining crowded out the thing being
 * explained. The per-row reasoning is still there, on hover, where it costs
 * nothing to ignore.
 *
 * Presentational only: it never writes. Staging goes through the same
 * draft/review/apply path as every other tuning change.
 */
export interface InitialTuneViewProps {
  /** Live values, so the table can show what each parameter is moving FROM. */
  liveValues: ReadonlyMap<string, number>
  /** Which of these are already staged, for the "staged" marks. */
  stagedIds: ReadonlySet<string>
  onStage: (parameters: Array<{ id: string; value: number }>) => void
  /** Vehicle facts the computation needs; supplied by App from the snapshot. */
  quadplane?: boolean
  firmwareMajor?: number
  hasAccelPMax?: boolean
  /** Pre-4.2 firmware that still has ACRO_YAW_P rather than ACRO_Y_RATE. */
  hasAcroYawP?: boolean
  disabled?: boolean
}

export function InitialTuneView(props: InitialTuneViewProps): ReactElement {
  const {
    liveValues,
    stagedIds,
    onStage,
    quadplane = false,
    firmwareMajor = 4,
    hasAccelPMax = true,
    hasAcroYawP = false,
    disabled = false
  } = props

  const [propText, setPropText] = useState('9')
  const [cellsText, setCellsText] = useState('4')
  const [chemistry, setChemistry] = useState<BatteryChemistry>('LiPo')
  const [tmotorEscs, setTmotorEscs] = useState(false)
  const [suggestedSafety, setSuggestedSafety] = useState(false)

  const result = useMemo(
    () =>
      buildInitialTuneParameters({
        propSizeInches: Number.parseFloat(propText),
        batteryCells: Number.parseFloat(cellsText),
        chemistry,
        tmotorEscs,
        suggestedSafety,
        firmwareMajor,
        hasAccelPMax,
        hasAcroYawP,
        quadplane
      }),
    [propText, cellsText, chemistry, tmotorEscs, suggestedSafety, firmwareMajor, hasAccelPMax, hasAcroYawP, quadplane]
  )

  // Only the rows that would actually move. A table where most rows say
  // "unchanged" hides the handful that matter.
  //
  // Connected, a row the vehicle does not report is dropped rather than
  // offered: it can only ever stage as invalid, and one such row blocks the
  // whole batch. Disconnected there is nothing to check against, so the full
  // list is shown.
  const connected = liveValues.size > 0
  const changes = result.parameters.filter((parameter) => {
    const live = liveValues.get(parameter.id)
    if (live === undefined) {
      return !connected
    }
    return Math.abs(live - parameter.value) > 1e-6
  })

  return (
    <div className="initial-tune" data-testid="initial-tune-panel">
      <p className="initial-tune__lede">
        Starting values for a new airframe — enough for a first safe hover. Sets no PID gains;
        Autotune does those.
      </p>

      <div className="initial-tune__inputs">
        <label>
          <span>Prop (in)</span>
          <input
            type="number"
            min={1}
            step={0.5}
            value={propText}
            data-testid="initial-tune-prop"
            onChange={(event) => setPropText(event.target.value)}
            disabled={disabled}
          />
        </label>

        <label>
          <span>Cells</span>
          <input
            type="number"
            min={1}
            step={1}
            value={cellsText}
            data-testid="initial-tune-cells"
            onChange={(event) => setCellsText(event.target.value)}
            disabled={disabled}
          />
        </label>

        <label>
          <span>Chemistry</span>
          <select
            value={chemistry}
            data-testid="initial-tune-chemistry"
            onChange={(event) => setChemistry(event.target.value as BatteryChemistry)}
            disabled={disabled}
          >
            {(Object.keys(BATTERY_CHEMISTRIES) as BatteryChemistry[]).map((key) => (
              <option key={key} value={key}>
                {BATTERY_CHEMISTRIES[key].label}
              </option>
            ))}
          </select>
        </label>

        <label className="initial-tune__check" title="Flat thrust expo (0.20) and the 1100–1940 PWM range.">
          <input
            type="checkbox"
            checked={tmotorEscs}
            data-testid="initial-tune-tmotor"
            onChange={(event) => setTmotorEscs(event.target.checked)}
            disabled={disabled}
          />
          <span>T-Motor ESCs</span>
        </label>

        <label
          className="initial-tune__check"
          title="Battery failsafe actions plus a 120 m / 150 m fence."
        >
          <input
            type="checkbox"
            checked={suggestedSafety}
            data-testid="initial-tune-safety"
            onChange={(event) => setSuggestedSafety(event.target.checked)}
            disabled={disabled}
          />
          <span>Failsafes &amp; fence</span>
        </label>
      </div>

      {result.error ? (
        <p className="switch-exercise-warning" data-testid="initial-tune-error">
          {result.error}
        </p>
      ) : changes.length === 0 ? (
        <p className="success-copy" data-testid="initial-tune-nothing">
          Everything already matches. Nothing to stage.
        </p>
      ) : (
        <>
          <div className="wrap">
            <table className="initial-tune__table" data-testid="initial-tune-table">
              <thead>
                <tr>
                  <th>Parameter</th>
                  <th className="num">Now</th>
                  <th className="num">New</th>
                </tr>
              </thead>
              <tbody>
                {changes.map((parameter) => {
                  const live = liveValues.get(parameter.id)
                  return (
                    <tr
                      key={parameter.id}
                      data-testid={`initial-tune-row-${parameter.id}`}
                      /* The reasoning stays available without taking a column
                         of its own on every row. */
                      title={parameter.reason}
                    >
                      <td>
                        {parameter.id}
                        {stagedIds.has(parameter.id) ? <span className="chip">staged</span> : null}
                      </td>
                      <td className="num">{live === undefined ? '—' : formatValue(live)}</td>
                      <td className="num">{formatValue(parameter.value)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <button
            type="button"
            style={buttonStyle()}
            data-testid="initial-tune-stage"
            onClick={() => onStage(changes.map(({ id, value }) => ({ id, value })))}
            disabled={disabled}
            title="Adds these to the tuning review. Nothing is written until you apply it there."
          >
            Stage {changes.length} change{changes.length === 1 ? '' : 's'}
          </button>
        </>
      )}
    </div>
  )
}

/** Trim float noise without hiding a genuinely small value. */
function formatValue(value: number): string {
  if (Number.isInteger(value)) return String(value)
  return String(Math.round(value * 1000) / 1000)
}
