// Searching parameters with no vehicle attached.
//
// The Parameter Editor reads the connected controller's tree, so with nothing
// connected it had nothing to show and said "No parameters match the current
// filter" -- which is true of the vehicle and false of the question being
// asked. Looking a parameter up is a reading task: what is it called, what does
// it do, what unit, what range, what do its values mean. None of that needs a
// flight controller, and the metadata bundle is already in the browser.
//
// So the same search box answers from the bundle when there is no tree to
// search. It is a REFERENCE: no current values, no drafts, nothing writable --
// there is nothing to write to.

import type { NormalizedFirmwareMetadataBundle } from '@arduconfig/param-metadata'

import { parameterSearchPredicate } from './filtered-parameters'

export interface ParameterReferenceRow {
  id: string
  label?: string
  description?: string
  unit?: string
  category?: string
  /** "3 – 12", "≥ 0", or undefined when the metadata declares no bounds. */
  range?: string
  /** Enum values as "0 — Disabled" lines; undefined for a plain number. */
  options?: string[]
  /** True for a bitmask, whose options are bit indices rather than values. */
  bitmask?: boolean
}

export interface ParameterReferenceResult {
  rows: ParameterReferenceRow[]
  /** How many matched in total, so a capped list can say what it left out. */
  matchCount: number
  /** Everything the bundle knows about, for the "N parameters" summary. */
  totalCount: number
}

/**
 * Rendering every match would put ~1300 rows in the DOM for an empty query.
 * The cap is stated in the UI rather than applied silently -- a truncated list
 * that looks complete is worse than a short one that says it is short.
 */
export const PARAMETER_REFERENCE_LIMIT = 100

function formatRange(minimum?: number, maximum?: number): string | undefined {
  if (minimum !== undefined && maximum !== undefined) return `${minimum} – ${maximum}`
  if (minimum !== undefined) return `≥ ${minimum}`
  if (maximum !== undefined) return `≤ ${maximum}`
  return undefined
}

/**
 * The bundle's parameters, filtered by the search box's own semantics.
 *
 * Uses parameterSearchPredicate rather than its own matching, so wildcards,
 * fuzzy matching and the Exact match box behave identically whether or not a
 * vehicle is attached. A search that works connected has to work disconnected;
 * two different matchers would make the offline list quietly answer a different
 * question.
 */
export function buildParameterReference(inputs: {
  catalog: NormalizedFirmwareMetadataBundle
  search: string
  exactSearch?: boolean
  limit?: number
}): ParameterReferenceResult {
  const { catalog, search, exactSearch = false, limit = PARAMETER_REFERENCE_LIMIT } = inputs
  const definitions = Object.values(catalog.parameters)
  const predicate = parameterSearchPredicate(search, exactSearch)

  const matches = predicate
    ? definitions.filter((definition) => predicate(definition.id, definition.label))
    : definitions

  // Codepoint order, not localeCompare: collation puts BATT_MONITOR before
  // BATT2_MONITOR in some locales and after it in others, and a reference list
  // that reorders itself by browser locale is a reference nobody can point at.
  const sorted = [...matches].sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))

  return {
    rows: sorted.slice(0, limit).map((definition) => ({
      id: definition.id,
      label: definition.label,
      description: definition.description,
      unit: definition.unit,
      category: definition.category,
      range: formatRange(definition.minimum, definition.maximum),
      bitmask: definition.bitmask === true,
      options:
        definition.options && definition.options.length > 0
          ? definition.options.map((option) => `${option.value} — ${option.label}`)
          : undefined
    })),
    matchCount: sorted.length,
    totalCount: definitions.length
  }
}
