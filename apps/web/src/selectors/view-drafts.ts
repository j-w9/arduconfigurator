import { type ParameterDraftEntry } from '@arduconfig/ardupilot-core'

export interface ViewDrafts {
  /** Draft entries in this view's scope. */
  entries: ParameterDraftEntry[]
  /** The subset of {@link ViewDrafts.entries} that is staged for write. */
  staged: ParameterDraftEntry[]
  /** The subset of {@link ViewDrafts.entries} that fails validation. */
  invalid: ParameterDraftEntry[]
}

/**
 * The per-view draft triple App.tsx repeats ~15 times: narrow the global
 * draft-entry list to the parameters a view owns, then split that into
 * the staged and invalid subsets.
 *
 * Behaviorally identical to the three chained `useMemo`s it replaces —
 * same scope predicate, same source list, and the staged/invalid arrays
 * are still derived from the scoped `entries`, so they recompute exactly
 * when `parameterDraftEntries` changes (the only input). Collapsing the
 * three memos into one call removes the intermediate bindings without
 * changing what is computed or when.
 */
export function selectViewDrafts(
  parameterDraftEntries: readonly ParameterDraftEntry[],
  isInScope: (id: string) => boolean
): ViewDrafts {
  const entries = parameterDraftEntries.filter((entry) => isInScope(entry.id))
  return {
    entries,
    staged: entries.filter((entry) => entry.status === 'staged'),
    invalid: entries.filter((entry) => entry.status === 'invalid')
  }
}
