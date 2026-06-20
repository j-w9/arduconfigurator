import type { ParameterDefinition, ParameterValueOption } from './types.js'

// Compact, hand-authored-agnostic shape produced by the upstream importer
// (scripts/import-ardupilot-params.mjs) from ArduPilot's apm.pdef.json. Only
// the fields that enrich the UI are kept; everything is optional because
// upstream coverage varies per parameter.
export interface UpstreamParameter {
  label?: string
  description?: string
  unit?: string
  minimum?: number
  maximum?: number
  options?: ParameterValueOption[]
  bitmask?: boolean
  rebootRequired?: boolean
}

export type UpstreamParameterMap = Record<string, UpstreamParameter>

// Parameters that exist upstream but aren't in the curated catalog land in
// this category. It isn't declared by any vehicle bundle, so the catalog's
// fallbackCategoryDefinition routes it to the Parameters view — making the
// full ArduPilot parameter set browsable + fuzzy-searchable with real
// labels/descriptions/ranges, while curated params keep their placement.
export const UPSTREAM_PARAMETER_CATEGORY = 'advanced'

function isNonEmptyString(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

/**
 * Overlay imported ArduPilot upstream metadata onto the hand-authored
 * catalog. Curated definitions always win — upstream only FILLS GAPS on
 * params the catalog already defines (a missing unit / range / option list /
 * description) and ADDS params the catalog doesn't cover at all (placed in
 * the `advanced` category). This keeps the curated UX intact while expanding
 * coverage to the whole parameter tree.
 */
export function mergeUpstreamParameters(
  handAuthored: Record<string, ParameterDefinition>,
  upstream: UpstreamParameterMap
): Record<string, ParameterDefinition> {
  const merged: Record<string, ParameterDefinition> = { ...handAuthored }

  for (const [id, up] of Object.entries(upstream)) {
    const existing = merged[id]
    if (existing) {
      // Fill only what the curated definition is missing.
      const takesUpstreamOptions = !existing.options && Array.isArray(up.options) && up.options.length > 0
      merged[id] = {
        ...existing,
        unit: existing.unit ?? up.unit,
        minimum: existing.minimum ?? up.minimum,
        maximum: existing.maximum ?? up.maximum,
        description: isNonEmptyString(existing.description) ? existing.description : up.description ?? existing.description,
        options: existing.options ?? (takesUpstreamOptions ? up.options : undefined),
        bitmask: takesUpstreamOptions ? up.bitmask : existing.bitmask,
        rebootRequired: existing.rebootRequired ?? up.rebootRequired
      }
      continue
    }

    // Upstream-only parameter — add it so it's editable + searchable.
    merged[id] = {
      id,
      label: isNonEmptyString(up.label) ? up.label : id,
      description: up.description ?? '',
      category: UPSTREAM_PARAMETER_CATEGORY,
      unit: up.unit,
      minimum: up.minimum,
      maximum: up.maximum,
      options: up.options,
      bitmask: up.bitmask,
      rebootRequired: up.rebootRequired
    }
  }

  return merged
}
