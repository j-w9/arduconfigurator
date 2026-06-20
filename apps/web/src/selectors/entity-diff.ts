import {
  deriveParameterDraftEntries,
  groupParameterDraftEntries,
  type ParameterDraftEntry,
  type ParameterState
} from '@arduconfig/ardupilot-core'

/**
 * A stable string fingerprint of a diff, used to detect when a saved
 * entity's pending changes have actually changed. Moved verbatim from
 * App.tsx (its only call sites were the three diff-signature memos this
 * selector now subsumes).
 */
function createDraftSignature(entries: readonly ParameterDraftEntry[]): string {
  if (entries.length === 0) {
    return 'none'
  }

  return JSON.stringify(
    entries.map((entry) => ({
      id: entry.id,
      status: entry.status,
      currentValue: entry.currentValue,
      nextValue: entry.nextValue,
      rawValue: entry.rawValue,
      reason: entry.reason
    }))
  )
}

export interface EntityDiff {
  /** Every parameter that differs from the live vehicle for this entity. */
  entries: ParameterDraftEntry[]
  /** The staged entries grouped for display. */
  groups: ReturnType<typeof groupParameterDraftEntries>
  /** The subset of {@link EntityDiff.entries} staged for write. */
  changed: ParameterDraftEntry[]
  /** The subset of {@link EntityDiff.entries} that fails validation. */
  invalid: ParameterDraftEntry[]
  /** Stable fingerprint of the full diff. */
  signature: string
}

/**
 * The diff sub-chain App.tsx repeats for the snapshot / provisioning /
 * tuning / preset "selected entity" surfaces: resolve the entity's
 * restore draft values against the live snapshot into draft entries,
 * then split / group / fingerprint them.
 *
 * Behaviorally identical to the five chained `useMemo`s it replaces —
 * same `deriveParameterDraftEntries` resolution, same `['staged']`
 * grouping, same staged/invalid predicates, same signature. The
 * entity-specific head (which saved entity is selected and how its
 * draft values are derived) and any entity-only tail (e.g. snapshot's
 * reboot-sensitive count) stay at the call site.
 */
export function selectEntityDiff(
  snapshotParameters: ParameterState[],
  draftValues: Record<string, string> | undefined
): EntityDiff {
  const entries = deriveParameterDraftEntries(snapshotParameters, draftValues ?? {})
  return {
    entries,
    groups: groupParameterDraftEntries(entries, ['staged']),
    changed: entries.filter((entry) => entry.status === 'staged'),
    invalid: entries.filter((entry) => entry.status === 'invalid'),
    signature: createDraftSignature(entries)
  }
}
