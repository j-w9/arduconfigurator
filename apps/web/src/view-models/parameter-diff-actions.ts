// Shared logic for the two parameter-diff review surfaces: the Parameters tab's
// staged/invalid grids and the Snapshots restore preview.
//
// Both render the same shape — groups of ParameterDraftEntry rows with per-row
// and per-group actions — and both had grown their own copy of the same
// decisions. That divergence was not free: the Parameters tab decided whether a
// row could be overridden by STRING-MATCHING the reason text the core writes
// ("Value is below the documented minimum of…"), so rewording a message in
// parameter-drafts.ts would have silently removed its Override button, while
// Snapshots used the `overridable` flag the core actually exposes.
//
// Pure functions over draft entries — no React, no app state.

import type { ParameterDraftEntry, ParameterDraftGroup } from '@arduconfig/ardupilot-core'

/**
 * Invalid rows an operator's "Override and write anyway" can actually rescue,
 * excluding any that are already overridden.
 *
 * `overridable` comes from the core's own validation (true for the
 * metadata-derived rejections — below-minimum, above-maximum, enum-mismatch;
 * false for a missing param or a non-numeric value, which no override fixes).
 * Reading the flag instead of the message means the two surfaces cannot drift
 * from each other or from the validator.
 */
export function overridableInvalidParamIds(
  entries: readonly ParameterDraftEntry[],
  alreadyOverridden: ReadonlySet<string>
): string[] {
  return entries
    .filter((entry) => entry.status === 'invalid' && entry.overridable === true && !alreadyOverridden.has(entry.id))
    .map((entry) => entry.id)
}

/** Whether a single row should offer the override affordance at all. */
export function isOverridableInvalidEntry(entry: ParameterDraftEntry): boolean {
  return entry.status === 'invalid' && entry.overridable === true
}

/** Every param id in a group — the unit both surfaces drop/stage by. */
export function paramIdsForGroup(group: ParameterDraftGroup): string[] {
  return group.entries.map((entry) => entry.id)
}

/**
 * Draft values for the rows in a group that can actually be staged, keyed for
 * mergeDrafts. Rows without a resolved next value (an unparseable or missing
 * entry) are skipped rather than staged as empty strings.
 */
export function stageableDraftValues(entries: readonly ParameterDraftEntry[]): Record<string, string> {
  return Object.fromEntries(
    entries
      .filter((entry) => entry.nextValue !== undefined)
      .map((entry) => [entry.id, String(entry.nextValue)])
  )
}
