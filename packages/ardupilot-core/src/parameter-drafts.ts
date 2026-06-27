import type { ParameterDefinition } from '@arduconfig/param-metadata'

import { approximatelyEqualParameterValue } from './runtime-helpers.js'
import type { ParameterState } from './types.js'

export type ParameterDraftStatus = 'unchanged' | 'staged' | 'invalid'

export interface ParameterDraftEntry {
  id: string
  label: string
  category: string
  definition?: ParameterDefinition
  rawValue: string
  currentValue?: number
  nextValue?: number
  delta?: number
  status: ParameterDraftStatus
  reason?: string
  /** True when this draft was rescued from `invalid` by an operator
   *  "Override and write anyway" choice — currently only used for the
   *  enum-mismatch reason, since metadata can lag the firmware and a
   *  legitimate value can be flagged as outside-enum even when the FC
   *  would accept it. Min/max violations are NOT overridable here. */
  override?: boolean
}

export interface ParameterDraftSummary {
  totalEntries: number
  stagedCount: number
  invalidCount: number
  stagedCategories: string[]
}

export interface ParameterDraftGroup {
  category: string
  entries: ParameterDraftEntry[]
}

const DEFAULT_STAGEABLE_STATUSES: ParameterDraftStatus[] = ['staged']

export function deriveParameterDraftEntries(
  parameters: ParameterState[],
  draftValues: Record<string, string>,
  enumOverrides?: ReadonlySet<string>
): ParameterDraftEntry[] {
  const parameterById = new Map(parameters.map((parameter) => [parameter.id, parameter]))

  return Object.entries(draftValues)
    .map(([paramId, rawValue]) =>
      deriveParameterDraftEntry(parameterById.get(paramId), rawValue, paramId, enumOverrides?.has(paramId) === true)
    )
    .sort(compareParameterDraftEntries)
}

export function summarizeParameterDraftEntries(entries: ParameterDraftEntry[]): ParameterDraftSummary {
  const stagedEntries = entries.filter((entry) => entry.status === 'staged')
  const stagedCategories = [...new Set(stagedEntries.map((entry) => entry.category))].sort((left, right) =>
    left.localeCompare(right)
  )

  return {
    totalEntries: entries.length,
    stagedCount: stagedEntries.length,
    invalidCount: entries.filter((entry) => entry.status === 'invalid').length,
    stagedCategories
  }
}

export function groupParameterDraftEntries(
  entries: ParameterDraftEntry[],
  statuses: readonly ParameterDraftStatus[] = DEFAULT_STAGEABLE_STATUSES
): ParameterDraftGroup[] {
  const allowedStatuses = new Set(statuses)
  const grouped = new Map<string, ParameterDraftEntry[]>()

  entries
    .filter((entry) => allowedStatuses.has(entry.status))
    .forEach((entry) => {
      const existing = grouped.get(entry.category)
      if (existing) {
        existing.push(entry)
      } else {
        grouped.set(entry.category, [entry])
      }
    })

  return [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([category, categoryEntries]) => ({
      category,
      entries: [...categoryEntries].sort(compareParameterDraftEntries)
    }))
}

/**
 * `enumOverride` is the legacy parameter name — semantically it's now a
 * "bypass METADATA validation" flag. Setting it true skips the strict
 * enum match AND the documented min/max range checks. Used by the
 * UI's "Override and write anyway" button when the metadata's
 * documented bounds are tighter than the firmware actually accepts
 * (the original case was enum lag; user-reported SERIAL7_BAUD =
 * 12500000 above documented max 12500 extended it to ranges).
 * Kept named `enumOverride` to avoid a cross-package rename — every
 * call site already passes a single boolean.
 */
function deriveParameterDraftEntry(
  parameter: ParameterState | undefined,
  rawValue: string,
  paramId: string,
  enumOverride: boolean = false
): ParameterDraftEntry {
  const label = parameter?.definition?.label ?? paramId
  const category = parameter?.definition?.category ?? 'uncategorized'
  const trimmedValue = rawValue.trim()

  if (parameter === undefined) {
    return {
      id: paramId,
      label,
      category,
      rawValue,
      status: 'invalid',
      reason: 'Parameter is not present in the synced snapshot.'
    }
  }

  if (trimmedValue.length === 0) {
    return {
      id: paramId,
      label,
      category,
      definition: parameter.definition,
      rawValue,
      currentValue: parameter.value,
      status: 'invalid',
      reason: 'Enter a numeric value before staging this parameter.'
    }
  }

  const parsedValue = Number(trimmedValue)
  if (!Number.isFinite(parsedValue)) {
    return {
      id: paramId,
      label,
      category,
      definition: parameter.definition,
      rawValue,
      currentValue: parameter.value,
      status: 'invalid',
      reason: 'Only finite numeric values can be written to the controller.'
    }
  }

  // Min/max range checks. Override behaves the same as the enum-mismatch
  // override below: when the metadata's documented range doesn't match
  // the firmware's actual accepted range (often the metadata is the
  // limiting factor — e.g., SERIAL7_BAUD documents 12500 but real high-
  // bandwidth links accept higher), the operator's explicit "Override
  // and write anyway" carries the value through.
  if (parameter.definition?.minimum !== undefined && parsedValue < parameter.definition.minimum) {
    if (!enumOverride) {
      return {
        id: paramId,
        label,
        category,
        definition: parameter.definition,
        rawValue,
        currentValue: parameter.value,
        nextValue: parsedValue,
        status: 'invalid',
        reason: `Value is below the documented minimum of ${parameter.definition.minimum}.`
      }
    }
  }

  if (parameter.definition?.maximum !== undefined && parsedValue > parameter.definition.maximum) {
    if (!enumOverride) {
      return {
        id: paramId,
        label,
        category,
        definition: parameter.definition,
        rawValue,
        currentValue: parameter.value,
        nextValue: parsedValue,
        status: 'invalid',
        reason: `Value is above the documented maximum of ${parameter.definition.maximum}.`
      }
    }
  }

  // Strict "matches one option" check applies only to mutually-exclusive
  // enums. For bitmask params (definition.bitmask === true) the `options`
  // list enumerates BIT INDICES, and the stored value is an OR of any
  // subset of bits — so the value is virtually NEVER going to equal one
  // of the option values. Refusing it here marked legitimate bitmask
  // combinations (Compass bit in ARMING_CHECK, multi-bit SERIALn_OPTIONS)
  // as "outside the known enum values". Skip for bitmask; min/max already
  // bound the legal range.
  if (
    parameter.definition?.options &&
    parameter.definition.options.length > 0 &&
    !parameter.definition.bitmask
  ) {
    const matchesOption = parameter.definition.options.some((option) => Object.is(option.value, parsedValue))
    if (!matchesOption) {
      if (enumOverride) {
        // Operator chose "Override and write anyway" — usually because the
        // metadata enum is lagging firmware. Fall through to the normal
        // staged-or-unchanged path so the value can be written.
      } else {
        return {
          id: paramId,
          label,
          category,
          definition: parameter.definition,
          rawValue,
          currentValue: parameter.value,
          nextValue: parsedValue,
          status: 'invalid',
          reason: 'Value is outside the known enum values for this parameter.'
        }
      }
    }
  }

  // Compare with the SAME tolerance the write path uses (relative 1e-6 +
  // absolute floor) rather than exact bit-equality: MAVLink params are 32-bit
  // floats on the wire, so an imported/preset 0.135 differs from the FC's
  // 0.13500000536441803 by ~5e-9 — exact equality flagged hundreds of those as
  // "changes" that the write then skipped, a misleading + slow review. Staging
  // now matches what would actually be written.
  if (approximatelyEqualParameterValue(parsedValue, parameter.value)) {
    return {
      id: paramId,
      label,
      category,
      definition: parameter.definition,
      rawValue,
      currentValue: parameter.value,
      nextValue: parsedValue,
      delta: 0,
      status: 'unchanged',
      reason: 'Draft matches the current controller value.'
    }
  }

  return {
    id: paramId,
    label,
    category,
    definition: parameter.definition,
    rawValue,
    currentValue: parameter.value,
    nextValue: parsedValue,
    delta: parsedValue - parameter.value,
    status: 'staged',
    override: enumOverride
  }
}

function compareParameterDraftEntries(left: ParameterDraftEntry, right: ParameterDraftEntry): number {
  if (left.category !== right.category) {
    return left.category.localeCompare(right.category)
  }

  return left.id.localeCompare(right.id)
}
