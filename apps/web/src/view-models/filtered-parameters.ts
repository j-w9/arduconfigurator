// Parameter-table search/filter for the raw Parameters view.
//
// Hides alias-mirror rows, then applies the search query (glob when it
// contains *​/?, otherwise fuzzy-scored + relevance-sorted).

import type { ConfiguratorSnapshot, ParameterState } from '@arduconfig/ardupilot-core'
import { fuzzyScoreFields, normalizeFirmwareMetadata } from '@arduconfig/param-metadata'

export interface FilteredParametersInputs {
  snapshot: ConfiguratorSnapshot
  parameterSearch: string
  metadataCatalog: ReturnType<typeof normalizeFirmwareMetadata>
}

/**
 * The search-box semantics as a reusable predicate: glob when the query
 * contains * / ? (anchored, case-insensitive), fuzzy otherwise. Returns
 * null for an empty query ("no filter"). Used by the staged-review list
 * so the same search box filters both the table and the import review;
 * otherwise wildcard search appears broken because the review list
 * ignores it.
 */
export function parameterSearchPredicate(
  parameterSearch: string
): ((id: string, label: string | undefined) => boolean) | null {
  const query = parameterSearch.trim()
  if (!query) {
    return null
  }
  if (query.includes('*') || query.includes('?')) {
    const pattern = globToRegExp(query)
    return (id, label) => pattern.test(id) || pattern.test(label ?? '')
  }
  return (id, label) => fuzzyScoreFields(query, [id, label]) !== null
}

/** Translate a * / ? glob into an anchored case-insensitive RegExp. */
function globToRegExp(query: string): RegExp {
  // Escape regex metachars, then translate * → .* and ? → . — case
  // insensitive so 'arming_*' matches 'ARMING_CHECK'. Anchor with
  // ^…$ so the glob behaves like a whole-token match (a bare '*'
  // matches everything, '*VOLT*' is contains-style).
  return new RegExp(
    '^' +
      query
        .replace(/[\\^$.+(){}[\]|]/g, '\\$&')
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.') +
      '$',
    'i'
  )
}

export function buildFilteredParameters(inputs: FilteredParametersInputs): ParameterState[] {
  const { snapshot, parameterSearch, metadataCatalog } = inputs

    // Hide alias-mirror entries from the raw Parameters table so an
    // aliased pair (SYSID_THISMAV / MAV_SYSID, GPS_TYPE / GPS1_TYPE,
    // MODE_CH / FLTMODE_CH, etc.) renders as ONE row — the on-wire name
    // the FC streams — not two duplicate rows with the same value. byId
    // lookups in curated views still resolve via the mirror; only the
    // iterate-all-params view filters it out.
    const realParameters = snapshot.parameters.filter((parameter) => parameter.aliasedFrom === undefined)
    const query = parameterSearch.trim()
    if (!query) {
      return realParameters
    }
    // Wildcard mode: when the query contains '*' (or '?') treat it as a
    // glob — '*' = zero+ chars, '?' = exactly one char. This lets the
    // operator do `ARMING_*`, `*VOLT*`, `BATT?_MONITOR` etc. without
    // remembering fuzzy-match scoring quirks. Falls back to the existing
    // fuzzy matcher when no wildcards are present.
    if (query.includes('*') || query.includes('?')) {
      const pattern = globToRegExp(query)
      return realParameters.filter((parameter) => {
        const label = metadataCatalog.parameters[parameter.id]?.label ?? parameter.definition?.label ?? ''
        return pattern.test(parameter.id) || pattern.test(label)
      })
    }
    // Fuzzy match on id + label, then sort by relevance (best first). An
    // exact substring still wins via the matcher's high base score, so
    // typing a full id keeps it at the top.
    const scored: { parameter: ParameterState; score: number }[] = []
    for (const parameter of realParameters) {
      // Prefer the (upstream-enriched) catalog label so fuzzy search can
      // match on real names for params the runtime attached no definition to.
      const label = metadataCatalog.parameters[parameter.id]?.label ?? parameter.definition?.label
      const score = fuzzyScoreFields(query, [parameter.id, label])
      if (score !== null) {
        scored.push({ parameter, score })
      }
    }
    scored.sort((left, right) => right.score - left.score || left.parameter.id.localeCompare(right.parameter.id))
    return scored.map((entry) => entry.parameter)
}
