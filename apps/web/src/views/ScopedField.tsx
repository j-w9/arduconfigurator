import type { ReactElement, ReactNode } from 'react'
import type { ParameterState } from '@arduconfig/ardupilot-core'
import { formatParamNumber, formatParamNumberInput } from '@arduconfig/param-metadata'

export interface ScopedFieldDraftStatus {
  status: string
}

export type ScopedFieldDraftMap = ReadonlyMap<string, ScopedFieldDraftStatus>

interface CommonScopedFieldProps {
  parameter: ParameterState
  liveValue: number | undefined
  editedValues: Record<string, string>
  draftStatusById: ScopedFieldDraftMap
  onChange: (paramId: string, value: string) => void
  compact?: boolean
}

function statusModifier(map: ScopedFieldDraftMap, paramId: string): string {
  return map.get(paramId)?.status ?? 'unchanged'
}

function fieldClassName(map: ScopedFieldDraftMap, paramId: string, compact: boolean): string {
  return `scoped-editor-field${compact ? ' scoped-editor-field--compact' : ''} scoped-editor-field--${statusModifier(map, paramId)}`
}

/**
 * Render "was: X" small text below a staged editor so the operator can
 * see the live-snapshot value that's about to be overwritten. Returns
 * null for unchanged / invalid fields — only show on actually-staged
 * edits. The value is formatted with the float-noise-stripped helper
 * (anything past ~1e-7 of magnitude is float-encoding noise per the
 * operator's policy).
 */
function StagedWasLine({
  status,
  liveValue,
  options
}: {
  status: string
  liveValue: number | undefined
  options?: readonly { value: number; label: string }[]
}): ReactElement | null {
  if (status !== 'staged') return null
  if (liveValue === undefined) return null
  let display: string
  if (options && options.length > 0) {
    const match = options.find((option) => Object.is(option.value, liveValue))
    display = match ? match.label : formatParamNumber(liveValue)
  } else {
    display = formatParamNumber(liveValue)
  }
  return <small className="scoped-editor-field__was">was {display}</small>
}

export function ScopedSelectField(props: CommonScopedFieldProps) {
  const { parameter, liveValue, editedValues, draftStatusById, onChange, compact = true } = props
  const status = statusModifier(draftStatusById, parameter.id)
  return (
    <label className={fieldClassName(draftStatusById, parameter.id, compact)}>
      <span>{parameter.definition?.label ?? parameter.id}</span>
      <select
        value={editedValues[parameter.id] ?? String(liveValue ?? '')}
        onChange={(event) => onChange(parameter.id, event.target.value)}
      >
        {(parameter.definition?.options ?? []).map((valueOption) => (
          <option key={`${parameter.id}:${valueOption.value}`} value={String(valueOption.value)}>
            {valueOption.label}
          </option>
        ))}
      </select>
      <StagedWasLine
        status={status}
        liveValue={liveValue}
        options={parameter.definition?.options}
      />
    </label>
  )
}

interface ScopedNumberFieldProps extends CommonScopedFieldProps {
  stepFallback?: number
  caption?: ReactNode
}

/**
 * Infer a sensible step when the param metadata doesn't carry one. The
 * default fallback is `1`, which is too coarse for PID gains (typical
 * range 0-0.35) and any other fractional-valued parameter — the operator
 * couldn't nudge a `0.135` rate gain in any reasonable increment without
 * typing the digits manually. Use the documented range to pick: a sub-1
 * range gets thousandths, a sub-10 range gets hundredths, anything
 * larger falls back to the supplied default.
 */
function inferStep(
  minimum: number | undefined,
  maximum: number | undefined,
  fallback: number
): number {
  if (minimum === undefined || maximum === undefined) return fallback
  const range = maximum - minimum
  if (!Number.isFinite(range) || range <= 0) return fallback
  if (range < 1) return 0.001
  if (range < 10) return 0.01
  return fallback
}

export function ScopedNumberField(props: ScopedNumberFieldProps) {
  const { parameter, liveValue, editedValues, draftStatusById, onChange, compact = true, stepFallback = 1, caption } = props
  const status = statusModifier(draftStatusById, parameter.id)
  // Use the noise-stripping formatter for the editor's initial value so
  // the operator doesn't see the float32 mantissa tail (1.5 not
  // 1.5000000596). Once the user starts typing, editedValues takes
  // precedence and we render the raw input verbatim.
  const fallbackValue = formatParamNumberInput(liveValue, parameter.definition?.step !== undefined ? 6 : 6)
  const unit = parameter.definition?.unit
  const step =
    parameter.definition?.step ??
    inferStep(parameter.definition?.minimum, parameter.definition?.maximum, stepFallback)
  return (
    <label className={fieldClassName(draftStatusById, parameter.id, compact)}>
      <span>
        {parameter.definition?.label ?? parameter.id}
        {unit ? <small className="scoped-editor-field__unit"> ({unit})</small> : null}
      </span>
      <input
        type="number"
        min={parameter.definition?.minimum}
        max={parameter.definition?.maximum}
        step={step}
        value={editedValues[parameter.id] ?? fallbackValue}
        onChange={(event) => onChange(parameter.id, event.target.value)}
      />
      <StagedWasLine status={status} liveValue={liveValue} />
      {caption ? <small>{caption}</small> : null}
    </label>
  )
}

/**
 * Auto-dispatch the right scoped widget for a parameter based on its
 * metadata: bitmask -> ScopedBitmaskField, enum options -> ScopedSelectField,
 * otherwise -> ScopedNumberField. Lets section code declare "edit this
 * parameter" without re-implementing the chooser at every site, and closes
 * the missing-dropdown audit gap where a future curated section quietly
 * dropped to a numeric input on a param that does carry enum options.
 */
export function ScopedField(props: ScopedNumberFieldProps) {
  const definition = props.parameter.definition
  const hasOptions = (definition?.options?.length ?? 0) > 0
  if (hasOptions) {
    if (definition?.bitmask === true) {
      return <ScopedBitmaskField {...props} />
    }
    return <ScopedSelectField {...props} />
  }
  return <ScopedNumberField {...props} />
}

/**
 * Render a bitmask parameter as a grid of per-bit checkboxes (instead of a
 * single dropdown). Each option's `value` is the BIT INDEX (0, 1, 2, …);
 * the staged value is the OR of the checked bits. Used by the generic
 * metadata editor for any definition flagged `bitmask`, so bitmask params
 * surface as click boxes everywhere the generic editor renders.
 */
export function ScopedBitmaskField(props: CommonScopedFieldProps) {
  const { parameter, liveValue, editedValues, draftStatusById, onChange, compact = true } = props
  const status = statusModifier(draftStatusById, parameter.id)
  const edited = editedValues[parameter.id]
  const current = edited !== undefined && edited !== '' ? Math.round(Number(edited)) : Math.round(liveValue ?? 0)
  const safeCurrent = Number.isFinite(current) ? current : 0
  const options = parameter.definition?.options ?? []
  return (
    <div
      className={`${fieldClassName(draftStatusById, parameter.id, compact)} scoped-editor-field--bitmask`}
      data-testid={`scoped-bitmask-${parameter.id}`}
    >
      <span>{parameter.definition?.label ?? parameter.id}</span>
      <div className="scoped-bitmask-bits">
        {options.map((option) => {
          const bit = option.value
          const mask = bit >= 0 && bit < 31 ? 1 << bit : 0
          const checked = mask !== 0 && (safeCurrent & mask) !== 0
          return (
            <button
              type="button"
              key={`${parameter.id}:${bit}`}
              className={`scoped-bitmask-bit${checked ? ' is-set' : ''}`}
              aria-pressed={checked}
              onClick={() => onChange(parameter.id, String(((checked ? safeCurrent & ~mask : safeCurrent | mask) >>> 0)))}
            >
              {option.label}
            </button>
          )
        })}
      </div>
      <StagedWasLine status={status} liveValue={liveValue} />
    </div>
  )
}

/**
 * Compact bitmask editor for dense tables (the raw Parameters list): a
 * collapsed <details> summary ("N of M set" + hex) so the row stays short and
 * never overruns the adjacent Actions/Apply column, expanding to the same
 * per-bit checkbox grid as ScopedBitmaskField (single column, scrollable). Used
 * where the always-open inline grid would be too tall / overlap neighbours.
 */
export function ScopedBitmaskPopover(props: CommonScopedFieldProps) {
  const { parameter, liveValue, editedValues, draftStatusById, onChange } = props
  const status = statusModifier(draftStatusById, parameter.id)
  const edited = editedValues[parameter.id]
  const current = edited !== undefined && edited !== '' ? Math.round(Number(edited)) : Math.round(liveValue ?? 0)
  const safeCurrent = Number.isFinite(current) ? current : 0
  const options = parameter.definition?.options ?? []
  const bitMask = (bit: number): number => (bit >= 0 && bit < 31 ? 1 << bit : 0)
  const setCount = options.filter((option) => {
    const mask = bitMask(option.value)
    return mask !== 0 && (safeCurrent & mask) !== 0
  }).length
  return (
    <details
      className={`scoped-bitmask-popover scoped-editor-field--${status}`}
      data-testid={`scoped-bitmask-${parameter.id}`}
    >
      <summary className="scoped-bitmask-popover__summary">
        <span>{setCount > 0 ? `${setCount} of ${options.length} set` : 'None set'}</span>
      </summary>
      <div className="scoped-bitmask-popover__panel">
        <div className="scoped-bitmask-bits scoped-bitmask-bits--single">
          {options.map((option) => {
            const bit = option.value
            const mask = bitMask(bit)
            const checked = mask !== 0 && (safeCurrent & mask) !== 0
            return (
              <button
                type="button"
                key={`${parameter.id}:${bit}`}
                className={`scoped-bitmask-bit${checked ? ' is-set' : ''}`}
                aria-pressed={checked}
                onClick={() => onChange(parameter.id, String(((checked ? safeCurrent & ~mask : safeCurrent | mask) >>> 0)))}
              >
                {option.label}
              </button>
            )
          })}
        </div>
      </div>
      <StagedWasLine status={status} liveValue={liveValue} />
    </details>
  )
}
