import { useMemo, useState, type ReactElement } from 'react'
import { buttonStyle } from '@arduconfig/ui-kit'

import {
  NOTCH_MODES,
  buildFilterPlan,
  describeNotchOpts,
  documentedNotchBandwidth,
  documentedNotchRef,
  type FilterField
} from '../view-models/filter-planner'

/**
 * The filter set, in one place, all of it manual.
 *
 * This deliberately does NOT derive the rate-loop filters from the gyro
 * filter. Those ratios come from Mission Planner rather than ArduPilot's own
 * documentation, and this surface writes to a flight controller — so they are
 * the operator's to enter.
 *
 * Two suggestions are offered as fill buttons, because ArduPilot documents
 * them: bandwidth at half the notch centre, and the per-mode reference value.
 * Both fill a field the operator can then edit or ignore.
 */
export interface FilterPlannerViewProps {
  liveValues: ReadonlyMap<string, number>
  stagedIds: ReadonlySet<string>
  onStage: (values: Array<{ id: string; value: number }>) => void
  disabled?: boolean
}

const RATE_FILTER_IDS = [
  'ATC_RAT_RLL_FLTT', 'ATC_RAT_RLL_FLTE', 'ATC_RAT_RLL_FLTD',
  'ATC_RAT_PIT_FLTT', 'ATC_RAT_PIT_FLTE', 'ATC_RAT_PIT_FLTD',
  'ATC_RAT_YAW_FLTT', 'ATC_RAT_YAW_FLTE', 'ATC_RAT_YAW_FLTD'
] as const

const GYRO_IDS = ['INS_GYRO_FILTER', 'INS_ACCEL_FILTER'] as const
const NOTCH_IDS = ['INS_HNTCH_ENABLE', 'INS_HNTCH_MODE', 'INS_HNTCH_REF', 'INS_HNTCH_FREQ', 'INS_HNTCH_BW', 'INS_HNTCH_OPTS'] as const
const ALL_IDS = [...GYRO_IDS, ...RATE_FILTER_IDS, ...NOTCH_IDS]

export function FilterPlannerView(props: FilterPlannerViewProps): ReactElement {
  const { liveValues, stagedIds, onStage, disabled = false } = props

  // Seeded from the vehicle, so the form opens on what is actually running and
  // an untouched field stages nothing.
  const [inputs, setInputs] = useState<Record<string, string>>(() =>
    Object.fromEntries(ALL_IDS.map((id) => [id, liveValues.get(id) !== undefined ? String(liveValues.get(id)) : '']))
  )
  const set = (id: string, value: string): void => setInputs((current) => ({ ...current, [id]: value }))

  const fields: FilterField[] = ALL_IDS.map((id) => ({ id, liveValue: liveValues.get(id), input: inputs[id] ?? '' }))
  const plan = useMemo(() => buildFilterPlan(fields), [inputs, liveValues])

  const notchFreq = Number.parseFloat(inputs.INS_HNTCH_FREQ ?? '')
  const notchMode = Number.parseFloat(inputs.INS_HNTCH_MODE ?? '')
  const suggestedBw = documentedNotchBandwidth(notchFreq)
  const suggestedRef = documentedNotchRef(notchMode, liveValues.get('MOT_THST_HOVER'))
  const optsValue = Number.parseFloat(inputs.INS_HNTCH_OPTS ?? '')

  const field = (id: string, label: string): ReactElement => (
    <label key={id} className="scoped-editor-field scoped-editor-field--compact">
      <span>
        {label}
        {stagedIds.has(id) ? <span className="chip">staged</span> : null}
      </span>
      <input
        type="number"
        step="any"
        value={inputs[id] ?? ''}
        data-testid={`filter-planner-${id}`}
        onChange={(event) => set(id, event.target.value)}
        disabled={disabled}
        placeholder={liveValues.get(id) !== undefined ? String(liveValues.get(id)) : '—'}
      />
    </label>
  )

  return (
    <div className="filter-planner" data-testid="filter-planner-panel">
      <p className="initial-tune__lede">
        Every filter in one place. Values are yours to set — nothing is derived, apart from the two
        suggestions below that ArduPilot documents.
      </p>

      <h4>Gyro and accelerometer</h4>
      <div className="initial-tune__inputs">{GYRO_IDS.map((id) => field(id, id.replace('INS_', '')))}</div>

      <h4>Rate loop</h4>
      <div className="initial-tune__inputs">
        {RATE_FILTER_IDS.map((id) => field(id, id.replace('ATC_RAT_', '')))}
      </div>

      <h4>Harmonic notch</h4>
      <div className="initial-tune__inputs">
        <label className="scoped-editor-field scoped-editor-field--compact">
          <span>MODE</span>
          <select
            value={inputs.INS_HNTCH_MODE ?? ''}
            data-testid="filter-planner-INS_HNTCH_MODE-select"
            onChange={(event) => set('INS_HNTCH_MODE', event.target.value)}
            disabled={disabled}
          >
            <option value="">—</option>
            {NOTCH_MODES.map((mode) => (
              <option key={mode.value} value={mode.value}>
                {mode.value} — {mode.label}
              </option>
            ))}
          </select>
        </label>
        {(['INS_HNTCH_ENABLE', 'INS_HNTCH_FREQ', 'INS_HNTCH_BW', 'INS_HNTCH_REF', 'INS_HNTCH_OPTS'] as const).map((id) =>
          field(id, id.replace('INS_HNTCH_', ''))
        )}
      </div>

      {/* The only arithmetic on this page, both sourced, both opt-in. */}
      <div className="switch-exercise-controls">
        {suggestedBw !== undefined ? (
          <button
            type="button"
            style={buttonStyle()}
            data-testid="filter-planner-fill-bw"
            onClick={() => set('INS_HNTCH_BW', String(suggestedBw))}
            disabled={disabled}
            title="ArduPilot: bandwidth is typically half the base frequency."
          >
            Use BW = {suggestedBw} (half of {Math.round(notchFreq)})
          </button>
        ) : null}
        {suggestedRef !== undefined ? (
          <button
            type="button"
            style={buttonStyle()}
            data-testid="filter-planner-fill-ref"
            onClick={() => set('INS_HNTCH_REF', String(suggestedRef))}
            disabled={disabled}
            title="ArduPilot: 1 for RPM/ESC-telemetry tracking, hover thrust for throttle mode."
          >
            Use REF = {suggestedRef}
          </button>
        ) : null}
      </div>

      {Number.isFinite(optsValue) && (inputs.INS_HNTCH_OPTS ?? '') !== '' ? (
        <p className="hint" data-testid="filter-planner-opts-described">
          {describeNotchOpts(optsValue)}
        </p>
      ) : null}

      {plan.errors.map((error) => (
        <p className="switch-exercise-warning" key={error} data-testid="filter-planner-error">
          {error}
        </p>
      ))}
      {plan.warnings.map((warning) => (
        <p className="switch-exercise-warning" key={warning} data-testid="filter-planner-warning">
          {warning}
        </p>
      ))}

      {plan.values.length === 0 ? (
        <p className="success-copy" data-testid="filter-planner-nothing">
          Nothing changed yet.
        </p>
      ) : (
        <button
          type="button"
          style={buttonStyle()}
          data-testid="filter-planner-stage"
          onClick={() => onStage(plan.values)}
          disabled={disabled || plan.errors.length > 0}
          title="Adds these to the tuning review. Nothing is written until you apply it there."
        >
          Stage {plan.values.length} change{plan.values.length === 1 ? '' : 's'}
        </button>
      )}
    </div>
  )
}
