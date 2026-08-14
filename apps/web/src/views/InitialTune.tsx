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
 * Presentational only: it takes the facts about the aircraft, shows what would
 * change, and hands the list up. It never writes — staging goes through the
 * same draft/review/apply path as every other tuning change, so a batch of a
 * dozen parameters is reviewed before it reaches a flight controller like
 * anything else.
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
  disabled?: boolean
}

const PROP_PRESETS = [3, 5, 7, 9, 10, 12, 15, 18, 22] as const

export function InitialTuneView(props: InitialTuneViewProps): ReactElement {
  const {
    liveValues,
    stagedIds,
    onStage,
    quadplane = false,
    firmwareMajor = 4,
    hasAccelPMax = true,
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
        quadplane
      }),
    [propText, cellsText, chemistry, tmotorEscs, suggestedSafety, firmwareMajor, hasAccelPMax, quadplane]
  )

  // Only the rows that would actually move. A table where most rows say
  // "unchanged" hides the handful that matter.
  const changes = result.parameters.filter((parameter) => {
    const live = liveValues.get(parameter.id)
    return live === undefined || Math.abs(live - parameter.value) > 1e-6
  })

  return (
    <div className="initial-tune" data-testid="initial-tune-panel">
      <p className="initial-tune__lede">
        A starting point, not a tune. These values come from the airframe — prop size sets the filter
        frequencies and acceleration limits, the pack sets the voltage points. They get you to a first
        hover that is safe to fly; Autotune and Log Tuning do the rest.
      </p>
      <p className="initial-tune__lede initial-tune__lede--muted">
        Same formulas as Mission Planner’s Initial Parameters screen. <strong>No PID gains are
        set</strong> — prop diameter says nothing about P, I or D.
      </p>

      <div className="initial-tune__inputs">
        <label>
          <span>Prop diameter (in)</span>
          <input
            type="number"
            min={1}
            step={0.5}
            value={propText}
            data-testid="initial-tune-prop"
            onChange={(event) => setPropText(event.target.value)}
            disabled={disabled}
          />
          <span className="initial-tune__presets">
            {PROP_PRESETS.map((size) => (
              <button
                key={size}
                type="button"
                className={Number.parseFloat(propText) === size ? 'on' : undefined}
                data-testid={`initial-tune-prop-${size}`}
                onClick={() => setPropText(String(size))}
                disabled={disabled}
              >
                {size}&quot;
              </button>
            ))}
          </span>
        </label>

        <label>
          <span>Battery cells (S)</span>
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
                {key} ({BATTERY_CHEMISTRIES[key].minCellV}–{BATTERY_CHEMISTRIES[key].maxCellV} V/cell)
              </option>
            ))}
          </select>
        </label>

        <label className="initial-tune__check">
          <input
            type="checkbox"
            checked={tmotorEscs}
            data-testid="initial-tune-tmotor"
            onChange={(event) => setTmotorEscs(event.target.checked)}
            disabled={disabled}
          />
          <span>
            T-Motor ESCs
            <em>Flat thrust expo (0.2) and their 1100–1940 PWM range.</em>
          </span>
        </label>

        <label className="initial-tune__check">
          <input
            type="checkbox"
            checked={suggestedSafety}
            data-testid="initial-tune-safety"
            onChange={(event) => setSuggestedSafety(event.target.checked)}
            disabled={disabled}
          />
          <span>
            Suggested failsafes and fence
            <em>Battery failsafe actions, 120 m / 150 m fence.</em>
          </span>
        </label>
      </div>

      {result.error ? (
        <p className="switch-exercise-warning" data-testid="initial-tune-error">
          {result.error}
        </p>
      ) : (
        <>
          <div className="wrap">
            <table className="initial-tune__table" data-testid="initial-tune-table">
              <thead>
                <tr>
                  <th>Parameter</th>
                  <th className="num">Now</th>
                  <th className="num">Suggested</th>
                  <th>Why</th>
                </tr>
              </thead>
              <tbody>
                {changes.map((parameter) => {
                  const live = liveValues.get(parameter.id)
                  return (
                    <tr key={parameter.id} data-testid={`initial-tune-row-${parameter.id}`}>
                      <td>
                        <strong>{parameter.id}</strong>
                        {stagedIds.has(parameter.id) ? <span className="chip">staged</span> : null}
                      </td>
                      <td className="num">{live === undefined ? '—' : formatValue(live)}</td>
                      <td className="num">{formatValue(parameter.value)}</td>
                      <td className="initial-tune__why">{parameter.reason}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {changes.length === 0 ? (
            <p className="success-copy" data-testid="initial-tune-nothing">
              Every suggested value already matches the vehicle. Nothing to stage.
            </p>
          ) : (
            <button
              type="button"
              style={buttonStyle()}
              data-testid="initial-tune-stage"
              onClick={() => onStage(changes.map(({ id, value }) => ({ id, value })))}
              disabled={disabled}
            >
              Stage {changes.length} change{changes.length === 1 ? '' : 's'} for review
            </button>
          )}
          <p className="hint">
            Staged, not written. They join the tuning review with everything else, and nothing reaches
            the vehicle until you apply it there.
          </p>
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
