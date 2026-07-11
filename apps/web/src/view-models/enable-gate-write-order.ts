import type { ParameterDraftEntry } from '@arduconfig/ardupilot-core'

/**
 * Reorder a batch of parameter-write drafts so any enable-gate parameter (one
 * whose definition sets `enableGate`, e.g. RCL3_FUNC) is written before the
 * dependent siblings sharing its `<GROUP>_` prefix (RCL3_MIN/MAX/OPT/SRC).
 *
 * ArduPilot hides an enable-gated sub-tree until the gate is set, and does not
 * reliably echo a PARAM_SET to a hidden sub-param. Because `runtime.setParameters`
 * writes serially and confirms each write's readback before the next, ordering
 * the gate first means the term is live (gate confirmed) by the time its
 * dependents are written — so they echo immediately instead of racing a
 * disabled term and timing out on verification.
 *
 * The reorder is minimal: each gate group clusters at the gate's position with
 * the gate first; params outside any present gate group keep their original
 * relative order. A gate whose group has no dependents in the batch, or a
 * dependent whose gate is NOT in the batch (already enabled on the FC), is left
 * where it is.
 */
export function orderDraftsByEnableGate(
  drafts: readonly ParameterDraftEntry[]
): ParameterDraftEntry[] {
  const groupPrefixOf = (id: string): string | undefined => {
    const underscore = id.lastIndexOf('_')
    return underscore > 0 ? id.slice(0, underscore + 1) : undefined
  }

  // Prefix -> index of the enable-gate param actually present in this batch.
  const gateIndexByPrefix = new Map<string, number>()
  drafts.forEach((draft, index) => {
    if (draft.definition?.enableGate) {
      const prefix = groupPrefixOf(draft.id)
      if (prefix !== undefined) {
        gateIndexByPrefix.set(prefix, index)
      }
    }
  })
  if (gateIndexByPrefix.size === 0) {
    return [...drafts]
  }

  const keyed = drafts.map((draft, index) => {
    if (draft.definition?.enableGate) {
      return { draft, sortPos: index, rank: 0, index }
    }
    const prefix = groupPrefixOf(draft.id)
    const gateIndex = prefix !== undefined ? gateIndexByPrefix.get(prefix) : undefined
    if (gateIndex !== undefined) {
      // Dependent of a gate present in this batch — cluster it right after its
      // gate (sortPos = gate index, rank 1 so the gate at rank 0 comes first).
      return { draft, sortPos: gateIndex, rank: 1, index }
    }
    return { draft, sortPos: index, rank: 0, index }
  })

  keyed.sort((a, b) => a.sortPos - b.sortPos || a.rank - b.rank || a.index - b.index)
  return keyed.map((entry) => entry.draft)
}
