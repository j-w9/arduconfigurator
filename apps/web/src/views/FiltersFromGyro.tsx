import { useMemo, useState, type ReactElement } from 'react'
import { StatusBadge, buttonStyle } from '@arduconfig/ui-kit'

import {
  buildFiltersFromGyro,
  exceedsDTermCeiling,
  GYRO_FILTER_PROP_HINTS,
  type FilterFromGyroRow
} from '../view-models/filters-from-gyro'

/**
 * Enter the gyro cutoff you want; get the filter set ArduPilot derives from it.
 *
 * Every proposal is editable before anything is staged, and staging goes
 * through the normal draft path -- so the values land in the fields above,
 * show as staged, and are written by the same reviewed Apply as any other
 * edit. Nothing here writes to the vehicle.
 *
 * The ratios are ArduPilot's, cited in filters-from-gyro.ts. This app invents
 * none of them.
 */
export interface FiltersFromGyroProps {
  /** Live parameter values, for the "current" column and the default cutoff. */
  liveValues: ReadonlyMap<string, number>
  /** Label for each id, so the rows read as names rather than raw params. */
  labelFor: (paramId: string) => string
  /** Stage the accepted rows as drafts (parent owns the draft set). */
  onStage: (values: { id: string; value: number }[]) => void
  disabled?: boolean
}

export function FiltersFromGyro(props: FiltersFromGyroProps): ReactElement | null {
  const { liveValues, labelFor, onStage, disabled = false } = props

  const liveGyro = liveValues.get('INS_GYRO_FILTER')
  const [gyroInput, setGyroInput] = useState<string>(() => (liveGyro === undefined ? '' : String(liveGyro)))
  // Per-row edits, keyed by param id. Cleared whenever the cutoff changes:
  // an override of the old gyro's numbers is not an answer about the new one.
  const [overrides, setOverrides] = useState<Record<string, string>>({})
  const [staged, setStaged] = useState(false)

  const gyroValue = Number.parseFloat(gyroInput)
  const rows = useMemo(() => buildFiltersFromGyro(gyroValue), [gyroValue])

  // The vehicle has no rate-loop filters at all (pre-connect, or a vehicle
  // that does not report them): nothing to propose.
  if (liveValues.size > 0 && liveValues.get('ATC_RAT_RLL_FLTD') === undefined) {
    return null
  }

  const proposedFor = (row: FilterFromGyroRow): number => {
    const override = overrides[row.id]
    if (override !== undefined && override.trim() !== '') {
      const parsed = Number.parseFloat(override)
      if (Number.isFinite(parsed)) return parsed
    }
    return row.value
  }

  const accepted = rows
    .map((row) => ({ id: row.id, value: proposedFor(row) }))
    .filter((entry) => Number.isFinite(entry.value) && liveValues.get(entry.id) !== entry.value)

  const setGyro = (next: string): void => {
    setGyroInput(next)
    setOverrides({})
    setStaged(false)
  }

  return (
    <section className="bf-gui-box filters-from-gyro" data-testid="filters-from-gyro">
      <div className="bf-gui-box__titlebar">
        <strong>Set filters from the gyro cutoff</strong>
      </div>
      <div className="bf-gui-box__body">
        <div className="filters-from-gyro__entry">
          <label>
            <span>Gyro filter (Hz)</span>
            <input
              type="number"
              inputMode="decimal"
              min={1}
              max={256}
              step={1}
              data-testid="filters-from-gyro-input"
              value={gyroInput}
              onChange={(event) => setGyro(event.target.value)}
              disabled={disabled}
            />
          </label>
          {/* ArduPilot's own starting points, by prop size (Setting the
            * Aircraft Up for Tuning). A button, not an automatic choice: the
            * app does not know what is bolted to the frame. */}
          <div className="filters-from-gyro__hints">
            {GYRO_FILTER_PROP_HINTS.map((hint) => (
              <button
                key={hint.label}
                type="button"
                style={buttonStyle()}
                data-testid={`filters-from-gyro-hint-${hint.hz}`}
                onClick={() => setGyro(String(hint.hz))}
                disabled={disabled}
                title={`ArduPilot's starting point for ${hint.label} props.`}
              >
                {hint.label} · {hint.hz} Hz
              </button>
            ))}
          </div>
        </div>

        {rows.length === 0 ? (
          <p className="hint">Enter a gyro cutoff to see what ArduPilot derives from it.</p>
        ) : (
          <>
            <div className="filters-from-gyro__rows" data-testid="filters-from-gyro-rows">
              {rows.map((row) => {
                const current = liveValues.get(row.id)
                const proposed = proposedFor(row)
                const overCeiling = exceedsDTermCeiling(row.id, proposed, gyroValue)
                return (
                  <div key={row.id} className="filters-from-gyro__row">
                    <div className="filters-from-gyro__name">
                      <strong>{labelFor(row.id)}</strong>
                      <small>
                        {row.id} · {row.rule}
                      </small>
                    </div>
                    <span className="filters-from-gyro__current">
                      {current === undefined ? '—' : `now ${current}`}
                    </span>
                    <input
                      type="number"
                      inputMode="decimal"
                      step={0.1}
                      aria-label={`${row.id} proposed value`}
                      data-testid={`filters-from-gyro-value-${row.id}`}
                      value={overrides[row.id] ?? String(row.value)}
                      onChange={(event) => {
                        setOverrides((previous) => ({ ...previous, [row.id]: event.target.value }))
                        setStaged(false)
                      }}
                      disabled={disabled}
                    />
                    {overCeiling ? (
                      <span className="filters-from-gyro__warning" data-testid={`filters-from-gyro-ceiling-${row.id}`}>
                        above 0.75 × gyro — ArduPilot advises against it
                      </span>
                    ) : null}
                  </div>
                )
              })}
            </div>

            <div className="switch-exercise-controls">
              <button
                type="button"
                style={buttonStyle('primary')}
                data-testid="filters-from-gyro-stage"
                onClick={() => {
                  onStage(accepted)
                  setStaged(true)
                }}
                disabled={disabled || accepted.length === 0}
              >
                {accepted.length === 0 ? 'Nothing to change' : `Stage ${accepted.length} values`}
              </button>
              {staged ? (
                <StatusBadge tone="warning">staged — review and apply above</StatusBadge>
              ) : null}
            </div>
            <p className="hint">
              Staged values land in the fields above as drafts. Nothing is written until you apply them.
            </p>
          </>
        )}
      </div>
    </section>
  )
}
