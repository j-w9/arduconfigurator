import type { AvailableFlightMode, ParameterState } from '@arduconfig/ardupilot-core'
import type { ParameterValueOption } from '@arduconfig/param-metadata'

// Flight-mode choices for the FLTMODEn selects, preferring what the vehicle
// says it can fly over what our catalogue happens to know.
//
// A curated table can only ever describe the firmware it was written against.
// A fork that adds a mode, or a Lua script that registers one, is invisible to
// it — the operator sees a bare number in the dropdown, or cannot select the
// mode at all. AVAILABLE_MODES has the vehicle enumerate its own modes by name
// and number, so the list matches the aircraft in front of you.
//
// The catalogue is still the fallback: firmware that does not answer (or
// answers before the enumeration completes) must keep working exactly as before.

/** Modes ArduPilot advertises but an operator cannot put on a switch. */
const MAV_MODE_PROPERTY_NOT_USER_SELECTABLE = 1

export interface FlightModeOptionInputs {
  /** From the snapshot; empty when the vehicle has not answered. */
  availableModes: readonly AvailableFlightMode[]
  /** The catalogue's options for this parameter, used as the fallback. */
  catalogOptions: readonly ParameterValueOption[] | undefined
  /** Current value, so a mode already assigned never vanishes from its select. */
  currentValue?: number
}

/**
 * Build the option list for one FLTMODEn select.
 *
 * Vehicle-reported modes win when present. Anything the vehicle marks
 * not-user-selectable is dropped — advertising a mode an operator cannot
 * actually assign is worse than not listing it.
 *
 * The currently-assigned value is always retained even if it is not in either
 * list, because a select that silently drops the value it is showing looks like
 * the parameter changed by itself.
 */
export function buildFlightModeOptions(input: FlightModeOptionInputs): ParameterValueOption[] {
  const selectable = input.availableModes.filter(
    (mode) => (mode.properties & MAV_MODE_PROPERTY_NOT_USER_SELECTABLE) === 0
  )

  if (selectable.length === 0) {
    return withCurrentValue([...(input.catalogOptions ?? [])], input.currentValue, input.catalogOptions)
  }

  const options = selectable
    .slice()
    .sort((left, right) => left.customMode - right.customMode)
    .map((mode) => ({
      value: mode.customMode,
      // Prefer the catalogue's wording where the same mode exists in both, so
      // familiar modes keep the names the rest of the app uses, and only the
      // ones we do not know about read as the firmware spells them.
      label: labelFor(mode, input.catalogOptions)
    }))

  return withCurrentValue(options, input.currentValue, input.catalogOptions)
}

function labelFor(
  mode: AvailableFlightMode,
  catalogOptions: readonly ParameterValueOption[] | undefined
): string {
  const known = catalogOptions?.find((option) => option.value === mode.customMode)
  if (known) {
    return known.label
  }
  return mode.name.length > 0 ? mode.name : `Mode ${mode.customMode}`
}

/**
 * Keep the assigned value present. A value in neither list is shown as a bare
 * mode number rather than dropped — the operator can then see what is actually
 * set, which is the whole point of the field.
 */
function withCurrentValue(
  options: ParameterValueOption[],
  currentValue: number | undefined,
  catalogOptions: readonly ParameterValueOption[] | undefined
): ParameterValueOption[] {
  if (currentValue === undefined || options.some((option) => option.value === currentValue)) {
    return options
  }
  const known = catalogOptions?.find((option) => option.value === currentValue)
  return [...options, { value: currentValue, label: known?.label ?? `Mode ${currentValue}` }].sort(
    (left, right) => left.value - right.value
  )
}

/**
 * Apply the merged options to a FLTMODEn parameter's definition, leaving every
 * other part of the definition untouched.
 */
export function withFlightModeOptions(
  parameter: ParameterState | undefined,
  availableModes: readonly AvailableFlightMode[]
): ParameterState | undefined {
  if (!parameter) {
    return parameter
  }
  const options = buildFlightModeOptions({
    availableModes,
    catalogOptions: parameter.definition?.options,
    currentValue: parameter.value
  })
  if (!parameter.definition) {
    return parameter
  }
  return { ...parameter, definition: { ...parameter.definition, options } }
}
