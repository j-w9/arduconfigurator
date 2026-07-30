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
  upstream: UpstreamParameterMap,
  /**
   * legacy -> modern parameter renames, so upstream metadata published under
   * the modern name also resolves for a controller streaming the legacy one.
   * Passed IN rather than imported: the alias table lives in ardupilot-core,
   * which depends on this package, so importing it here would invert the
   * layering. Defaults to none, leaving the merge unchanged for callers that
   * do not care.
   */
  legacyAliases: Record<string, string> = {}
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

  // Mirror upstream metadata onto the LEGACY name of any renamed parameter.
  //
  // Upstream ships only the modern name (CAM1_SERVO_ON), but a controller on
  // older firmware streams the legacy one (CAM_SERVO_ON) — so the row rendered
  // with no metadata at all even though the description existed under the other
  // name. The alias table already promises "byId lookups resolve either way";
  // this is what makes that true for metadata as well as values.
  //
  // Only renames the alias table vouches for are mirrored. Renames that also
  // changed units are deliberately absent from it (CAM_DURATION's deci-seconds
  // to seconds, TRIM_ARSPD_CM's cm/s to m/s), because borrowing the modern
  // metadata there would put the wrong unit and range on a legacy value.
  for (const [legacyId, modernId] of Object.entries(legacyAliases)) {
    if (merged[legacyId] || !merged[modernId]) {
      continue
    }
    merged[legacyId] = { ...merged[modernId], id: legacyId }
  }

  return merged
}
