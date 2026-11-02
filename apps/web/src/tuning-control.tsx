// Value helpers for the Tuning views' typed fields (ANGLE_MAX shown in
// degrees, edited back to centidegrees; bounds; rounding for display).

import type { ParameterState } from '@arduconfig/ardupilot-core'

import { formatNumericDisplayValue } from './parameter-format'

export function tuningInputValue(parameter: ParameterState, editedValues: Record<string, string>): string {
  const rawValue = editedValues[parameter.id]
  if (parameter.id === 'ANGLE_MAX') {
    if (rawValue === undefined) {
      return String(Math.round(parameter.value / 100))
    }
    // Operator cleared the field: applyTuningEditedValue stores '' — keep it
    // blank instead of Number('')→0 snapping the display to "0" mid-edit.
    if (rawValue === '') {
      return ''
    }

    const parsed = Number(rawValue)
    return Number.isFinite(parsed) ? String(Math.round(parsed / 100)) : ''
  }

  // Default (unedited) display: show a rounded value, not the raw float.
  // Many ArduPilot floats arrive as e.g. 0.13500000000000001 — the number
  // field rendered all those digits. formatNumericDisplayValue rounds to a
  // sensible precision and strips trailing zeros while staying a valid
  // numeric string for the <input type="number">.
  if (rawValue !== undefined) {
    return rawValue
  }
  return Number.isFinite(parameter.value)
    ? formatNumericDisplayValue(parameter.value)
    : String(parameter.value)
}

export function applyTuningEditedValue(
  existing: Record<string, string>,
  parameter: ParameterState,
  nextValue: string
): Record<string, string> {
  if (parameter.id === 'ANGLE_MAX') {
    return {
      ...existing,
      [parameter.id]: nextValue.trim().length === 0 ? '' : String(Math.round(Number(nextValue) * 100))
    }
  }

  return {
    ...existing,
    [parameter.id]: nextValue
  }
}

export function tuningControlBounds(parameter: ParameterState): { min?: number; max?: number; step?: number } {
  if (parameter.id === 'ANGLE_MAX') {
    return {
      min: 10,
      max: 80,
      step: 1
    }
  }

  return {
    min: parameter.definition?.minimum,
    max: parameter.definition?.maximum,
    step: parameter.definition?.step ?? 0.01
  }
}

export function clampNumericValue(value: number, minimum?: number, maximum?: number): number {
  let nextValue = value
  if (minimum !== undefined) {
    nextValue = Math.max(minimum, nextValue)
  }
  if (maximum !== undefined) {
    nextValue = Math.min(maximum, nextValue)
  }
  return nextValue
}

export function normalizeTuningNumericValue(parameter: ParameterState, value: number): number {
  const { min, max, step } = tuningControlBounds(parameter)
  const clamped = clampNumericValue(value, min, max)

  if (step === undefined || step <= 0) {
    return clamped
  }

  const rounded = Math.round(clamped / step) * step
  const precision = Math.max(0, Math.ceil(Math.log10(1 / step)))
  return Number(rounded.toFixed(Math.min(precision, 6)))
}
