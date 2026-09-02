import { useState, type ReactElement, type ReactNode } from 'react'
import type { ParameterState } from '@arduconfig/ardupilot-core'
import { formatParamNumber, formatParamNumberInput } from '@arduconfig/param-metadata'

import { InfoDot } from './InfoDot'

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
 * Small always-visible line showing the raw ArduPilot parameter name next to
 * its friendly label (e.g. "Vertical speed" / "VSPEED") — the label alone
 * doesn't tell an operator what to search the wiki or the raw Parameters tab
 * for. Skipped when there's no friendly label: in that case `parameter.id` IS
 * already the label text, so showing it again would be a plain duplicate.
 */
function ParamIdHint({ parameter }: { parameter: ParameterState }): ReactElement | null {
  const definition = parameter.definition
  if (!definition) return null

  // The raw name is skipped when there is no friendly label: in that case
  // `parameter.id` IS the label text, so printing it again is a duplicate.
  const showParamId = Boolean(definition.label)
  const description = definition.description?.trim()
  if (!showParamId && !description) return null

  // Range and unit, when the metadata carries them. This is the other half of
  // the question the dot is there to answer -- "what does it do" is only
  // useful next to "what may I set it to".
  const bounds =
    definition.minimum !== undefined && definition.maximum !== undefined
      ? `Range ${definition.minimum} to ${definition.maximum}${definition.unit ? ` ${definition.unit}` : ''}`
      : definition.unit
        ? `Unit: ${definition.unit}`
        : undefined

  // aria-hidden on the raw name: purely decorative metadata, and — since
  // several of these components wrap their control in a <label> — without it
  // the browser folds this text into the <label>'s accessible name (e.g.
  // "Roll Angle P" becomes "Roll Angle PATC_ANG_RLL_P"), breaking any
  // getByLabel(exact) query and any screen-reader announcement of the control.
  // The dot sits outside that, since its tip IS content worth announcing.
  return (
    <span className="scoped-editor-field__meta">
      {showParamId ? (
        <small className="scoped-editor-field__param-id" aria-hidden="true">
          {parameter.id}
        </small>
      ) : null}
      {description ? (
        <InfoDot
          label={`About ${definition.label ?? parameter.id}`}
          testId={`param-info-${parameter.id}`}
          wide
        >
          <span className="info-dot-line">{description}</span>
          {bounds ? <span className="info-dot-line">{bounds}</span> : null}
          {definition.rebootRequired ? (
            <span className="info-dot-line">Takes effect after a reboot.</span>
          ) : null}
        </InfoDot>
      ) : null}
    </span>
  )
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

/**
 * Above this many options a single-select chip grid becomes unusable (e.g.
 * GPS_TYPE, SERVOn_FUNCTION, SERIALn_PROTOCOL, AHRS_ORIENTATION), so chip
 * mode auto-falls back to the native dropdown. Callers can therefore pass
 * `layout="chips"` freely — large enums quietly stay dropdowns.
 */
export const SCOPED_CHIP_MAX_OPTIONS = 8

/**
 * Whether an enum with `optionCount` options should render as the
 * single-select chip grid (true) rather than fall back to the native
 * dropdown (false). Pure so it can be unit-tested off the DOM.
 */
export function shouldRenderOptionChips(optionCount: number): boolean {
  return optionCount > 0 && optionCount <= SCOPED_CHIP_MAX_OPTIONS
}

/**
 * Whether a param's enumerated options are non-exhaustive HINTS rather than a
 * closed enum — true when they cover only a sparse fraction of a wide numeric
 * range (e.g. RELAY_PIN: 36 named GPIO pins scattered across -1..1015, with
 * valid pins like 81 sitting in the gaps). Such params must render as a number
 * field: an exclusive dropdown can't hold a valid unlisted value, so it silently
 * shows the first option ("Disabled") and reads as OFF. A closed enum densely
 * covers its range, so it stays a dropdown. Pure so it can be unit-tested.
 */
export function optionsAreHintList(
  definition: { options?: readonly { value: number }[]; minimum?: number; maximum?: number } | undefined
): boolean {
  const options = definition?.options
  if (!options || options.length === 0 || definition?.minimum === undefined || definition?.maximum === undefined) {
    return false
  }
  const range = definition.maximum - definition.minimum
  // Wide range + sparse coverage ⇒ hints. The thresholds sit far from any real
  // enum (which covers most of its range) and far below RELAY_PIN's ~3.5%.
  return range > 50 && options.length / (range + 1) < 0.25
}

interface ScopedSelectFieldProps extends CommonScopedFieldProps {
  /** `'chips'` renders the box/chip grid (matching ScopedBitmaskField) when
   *  the option count is small enough; otherwise falls back to the native
   *  dropdown. Defaults to `'select'` (native dropdown). */
  layout?: 'select' | 'chips'
  /** When true, an explicit "Custom…" option reveals a plain number input so
   *  an unlisted enum value (e.g. a custom FLTMODEn, like scripting-defined
   *  mode 29) can be typed directly instead of only ever showing as an
   *  inert "N (unlisted)" label with no way to change it to another number.
   *  Opt-in — every other ScopedSelectField usage is unaffected. */
  allowCustomValue?: boolean
}

const CUSTOM_VALUE_SENTINEL = '__custom__'

export function ScopedSelectField(props: ScopedSelectFieldProps) {
  const { parameter, liveValue, editedValues, draftStatusById, onChange, compact = true, layout = 'select', allowCustomValue = false } = props
  const options = parameter.definition?.options ?? []
  if (layout === 'chips' && shouldRenderOptionChips(options.length)) {
    return <ScopedOptionChipsField {...props} />
  }
  const status = statusModifier(draftStatusById, parameter.id)
  const currentValue = editedValues[parameter.id] ?? String(liveValue ?? '')
  const matchesKnownOption = options.some((option) => String(option.value) === currentValue)
  // Sticky "I'm in Custom… mode" flag — without it, typing e.g. "6" (a real
  // FLTMODE value) into the number input would make matchesKnownOption true
  // again and the custom input would vanish out from under the operator's
  // cursor mid-edit. Latch it on first render when the field AUTO-enters custom
  // mode because the live value is already unlisted (e.g. a scripting-defined
  // FLTMODEn=29): otherwise that path — not just the dropdown-initiated one —
  // hits the same mid-edit collapse the flag exists to prevent.
  const [customModeForced, setCustomModeForced] = useState(
    () => allowCustomValue && currentValue !== '' && !matchesKnownOption
  )
  const showCustomInput = allowCustomValue && (customModeForced || (currentValue !== '' && !matchesKnownOption))

  if (allowCustomValue) {
    const fieldLabel = parameter.definition?.label ?? parameter.id
    return (
      <label className={fieldClassName(draftStatusById, parameter.id, compact)}>
        <span>{fieldLabel}</span>
        <ParamIdHint parameter={parameter} />
        <span className="scoped-select-with-custom">
          <select
            data-testid={`scoped-select-${parameter.id}`}
            aria-label={fieldLabel}
            value={showCustomInput ? CUSTOM_VALUE_SENTINEL : currentValue}
            onChange={(event) => {
              if (event.target.value === CUSTOM_VALUE_SENTINEL) {
                setCustomModeForced(true)
              } else {
                setCustomModeForced(false)
                onChange(parameter.id, event.target.value)
              }
            }}
          >
            {options.map((option) => (
              <option key={`${parameter.id}:${option.value}`} value={String(option.value)}>
                {option.label}
              </option>
            ))}
            <option value={CUSTOM_VALUE_SENTINEL}>Custom…</option>
          </select>
          {showCustomInput ? (
            <input
              type="number"
              data-testid={`scoped-select-custom-${parameter.id}`}
              className="scoped-select-with-custom__input"
              value={currentValue}
              aria-label={`Custom ${fieldLabel} value`}
              onChange={(event) => onChange(parameter.id, event.target.value)}
            />
          ) : null}
        </span>
        <StagedWasLine
          status={status}
          liveValue={liveValue}
          options={parameter.definition?.options}
        />
      </label>
    )
  }

  // Surface a value that isn't one of the listed options as its own option, so a
  // native <select> shows the real value instead of silently falling back to the
  // first option (which misreads e.g. an unlisted pin as "Disabled").
  const currentNumber = Number(currentValue)
  const renderedOptions =
    currentValue !== '' && Number.isFinite(currentNumber) && !matchesKnownOption
      ? [...options, { value: currentNumber, label: `${currentValue} (unlisted)` }]
      : options
  const fieldLabel = parameter.definition?.label ?? parameter.id
  return (
    <label className={fieldClassName(draftStatusById, parameter.id, compact)}>
      <span>{fieldLabel}</span>
      <ParamIdHint parameter={parameter} />
      <select aria-label={fieldLabel} value={currentValue} onChange={(event) => onChange(parameter.id, event.target.value)}>
        {renderedOptions.map((valueOption) => (
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
  const fieldLabel = parameter.definition?.label ?? parameter.id
  return (
    <label className={fieldClassName(draftStatusById, parameter.id, compact)}>
      <span>
        {fieldLabel}
        {unit ? <small className="scoped-editor-field__unit"> ({unit})</small> : null}
      </span>
      <ParamIdHint parameter={parameter} />
      <input
        type="number"
        aria-label={fieldLabel}
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
    // When the options are just hints on a wider numeric range (RELAY_PIN and
    // friends), a dropdown can't hold a valid unlisted value — render a number
    // field so the operator can type any pin.
    if (!optionsAreHintList(definition)) {
      return <ScopedSelectField {...props} />
    }
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
      <ParamIdHint parameter={parameter} />
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
      {/* Raw value entry: paste/type a bitmask number directly (e.g. copying a
          value out of another param file). Shares the same edited value as the
          checkboxes above, so they stay in sync automatically. */}
      <label className="scoped-bitmask-raw">
        <span>Value</span>
        <input
          type="number"
          min={0}
          step={1}
          aria-label={`${parameter.id} raw bitmask value`}
          value={edited ?? String(safeCurrent)}
          onChange={(event) => onChange(parameter.id, event.target.value)}
        />
      </label>
      <StagedWasLine status={status} liveValue={liveValue} />
    </div>
  )
}

/**
 * Single-select enum rendered as a grid of clickable highlight-on-select
 * boxes — the same box/chip look as ScopedBitmaskField (shared CSS), but
 * exactly one chip is highlighted at a time. Used for enums with a
 * small/moderate option count; large enums fall back to the native
 * dropdown (callers reach this via ScopedSelectField `layout="chips"`,
 * which gates on SCOPED_CHIP_MAX_OPTIONS, but the guard is repeated here
 * so the component is also safe to use directly).
 */
export function ScopedOptionChipsField(props: CommonScopedFieldProps) {
  const { parameter, liveValue, editedValues, draftStatusById, onChange, compact = true } = props
  const options = parameter.definition?.options ?? []
  if (!shouldRenderOptionChips(options.length)) {
    return <ScopedSelectField {...props} layout="select" />
  }
  const status = statusModifier(draftStatusById, parameter.id)
  const current = editedValues[parameter.id] ?? String(liveValue ?? '')
  return (
    <div
      className={`${fieldClassName(draftStatusById, parameter.id, compact)} scoped-editor-field--chips`}
      data-testid={`scoped-chips-${parameter.id}`}
    >
      <span>{parameter.definition?.label ?? parameter.id}</span>
      <ParamIdHint parameter={parameter} />
      <div className="scoped-option-chips" role="radiogroup">
        {options.map((option) => {
          const selected = String(option.value) === current
          return (
            <button
              type="button"
              key={`${parameter.id}:${option.value}`}
              className={`scoped-option-chip${selected ? ' is-set' : ''}`}
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(parameter.id, String(option.value))}
            >
              {option.label}
            </button>
          )
        })}
      </div>
      <StagedWasLine status={status} liveValue={liveValue} options={options} />
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
        {/* Raw value entry: paste/type a bitmask number directly (e.g. copying a
            value out of another param file) — the checkboxes track it. */}
        <label className="scoped-bitmask-raw">
          <span>Value</span>
          <input
            type="number"
            min={0}
            step={1}
            aria-label={`${parameter.id} raw bitmask value`}
            value={edited ?? String(safeCurrent)}
            onChange={(event) => onChange(parameter.id, event.target.value)}
          />
        </label>
      </div>
      <StagedWasLine status={status} liveValue={liveValue} />
    </details>
  )
}
