// Parameter value/range/delta formatters, extracted from App.tsx as part of its
// decomposition. Pure formatting over ArduPilot parameter values and metadata —
// no React, no app state. (The parameter *apply-gate* helpers stay in App.tsx;
// they depend on app-internal guided-action state.)

import type { ParameterState } from '@arduconfig/ardupilot-core'
import type { ParameterDefinition, ParameterValueOption } from '@arduconfig/param-metadata'

import { hasBitmaskFlag } from './selectors/bitmask'

export function formatNumericDisplayValue(value: number): string {
  if (!Number.isFinite(value)) {
    return 'Unknown'
  }

  if (Number.isInteger(value)) {
    return String(value)
  }

  const absoluteValue = Math.abs(value)
  const decimals =
    absoluteValue >= 100 ? 1 :
    absoluteValue >= 10 ? 2 :
    absoluteValue >= 1 ? 3 :
    absoluteValue >= 0.1 ? 4 :
    6

  const normalized = value.toFixed(decimals).replace(/\.?0+$/, '')
  return normalized === '-0' ? '0' : normalized
}

export function formatParameterValue(value: number | undefined, unit: string | undefined = undefined): string {
  if (value === undefined) {
    return 'Unknown'
  }

  const formattedValue = formatNumericDisplayValue(value)
  return unit ? `${formattedValue} ${unit}` : formattedValue
}

export function findParameterOption(definition: ParameterDefinition | undefined, value: number | undefined): ParameterValueOption | undefined {
  if (definition === undefined || value === undefined) {
    return undefined
  }

  return definition.options?.find((option) => Object.is(option.value, value))
}

export function formatParameterDisplayValue(parameter: ParameterState | undefined, value: number | undefined): string {
  if (parameter === undefined) {
    return formatParameterValue(value)
  }

  const option = findParameterOption(parameter.definition, value)
  if (!option) {
    return formatParameterValue(value, parameter.definition?.unit)
  }

  const rawValue = value === undefined ? '' : ` (${formatParameterValue(value, parameter.definition?.unit)})`
  return `${option.label}${rawValue}`
}

/**
 * Same shape as formatParameterDisplayValue, but takes a ParameterDefinition
 * directly so callers with only the draft's `definition` slot (e.g. the
 * Show Changes diff panel and the persistent staged-changes chip) don't
 * have to synthesize a fake ParameterState. Renders the matching option
 * label when the value is on-list, with the raw value in parens; falls
 * back to `formatParameterValue` (value + unit) when there's no option
 * match or no options defined.
 */
export function formatParameterDraftValue(
  definition: ParameterDefinition | undefined,
  value: number | undefined
): string {
  const option = findParameterOption(definition, value)
  if (!option) {
    return formatParameterValue(value, definition?.unit)
  }
  const rawValue = value === undefined ? '' : ` (${formatParameterValue(value, definition?.unit)})`
  return `${option.label}${rawValue}`
}

/**
 * Decode a bitmask parameter value into its set-bit labels, e.g.
 * "GPS, Compass" — for the import/restore review rows, where a raw
 * "5 → 13" tells the operator nothing about which features toggle.
 * Labels come from the definition's options (bit INDEX → label, per the
 * `bitmask: true` contract); set bits without a label render as
 * "bit N" so an undocumented bit is never silently hidden. Returns
 * undefined for non-bitmask definitions or non-finite values, and
 * "none" for 0.
 */
export function describeBitmaskDraftValue(
  definition: ParameterDefinition | undefined,
  value: number | undefined
): string | undefined {
  if (definition?.bitmask !== true || value === undefined || !Number.isFinite(value)) {
    return undefined
  }
  const labelByBit = new Map<number, string>(
    (definition.options ?? []).map((option) => [option.value, option.label])
  )
  const parts: string[] = []
  for (let bit = 0; bit < 32; bit += 1) {
    if (hasBitmaskFlag(value, bit)) {
      parts.push(labelByBit.get(bit) ?? `bit ${bit}`)
    }
  }
  return parts.length > 0 ? parts.join(', ') : 'none'
}

export function formatParameterDelta(delta: number | undefined, unit: string | undefined = undefined): string {
  if (delta === undefined || Object.is(delta, 0)) {
    return 'no change'
  }

  const prefix = delta > 0 ? '+' : ''
  return unit ? `${prefix}${delta} ${unit}` : `${prefix}${delta}`
}

export function formatParameterRange(definition: ParameterDefinition | undefined): string {
  if (definition?.minimum === undefined && definition?.maximum === undefined) {
    return 'No range metadata yet'
  }

  const minimum = definition.minimum === undefined ? 'unbounded' : String(definition.minimum)
  const maximum = definition.maximum === undefined ? 'unbounded' : String(definition.maximum)
  const unitSuffix = definition.unit ? ` ${definition.unit}` : ''
  return `${minimum} to ${maximum}${unitSuffix}`
}

export function formatParameterStep(definition: ParameterDefinition | undefined): string {
  if (definition?.step === undefined) {
    return 'No step metadata yet'
  }

  return definition.unit ? `${definition.step} ${definition.unit}` : String(definition.step)
}

export function normalizeBitmaskValue(rawValue: string | undefined, fallbackValue: number | undefined): number {
  const parsed = rawValue === undefined || rawValue === '' ? Number.NaN : Number(rawValue)
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : fallbackValue ?? 0
}

export function formatAngleMaxDegrees(rawValue: number | undefined): string {
  if (rawValue === undefined || !Number.isFinite(rawValue)) {
    return 'Unknown'
  }

  return `${Math.round(rawValue / 100)} deg`
}
