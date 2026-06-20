// Pure selection logic for the staged-parameter review list's bulk-drop
// checkboxes (ParametersSection). Extracted so the shift-click range rule
// is unit-testable off the component: a plain click toggles one id; a
// shift-click extends from the LAST toggled id (the anchor) to the
// clicked id, setting every row in between to the clicked row's new
// checked state — the file-manager convention.

/**
 * Compute the next selection after a click on `targetId`.
 *
 * - No shift, or no/unknown anchor → toggle `targetId` alone.
 * - Shift with a valid anchor → every id between anchor and target
 *   (inclusive) becomes `checked` (the target's new state).
 *
 * Ids not present in `orderedIds` are treated as unanchored clicks.
 */
export function applyDraftSelectionClick(
  current: ReadonlySet<string>,
  orderedIds: readonly string[],
  targetId: string,
  options: { shiftKey: boolean; anchorId: string | null }
): Set<string> {
  const next = new Set(current)
  const checked = !current.has(targetId)

  const anchorIndex = options.anchorId === null ? -1 : orderedIds.indexOf(options.anchorId)
  const targetIndex = orderedIds.indexOf(targetId)

  if (!options.shiftKey || anchorIndex < 0 || targetIndex < 0) {
    if (checked) {
      next.add(targetId)
    } else {
      next.delete(targetId)
    }
    return next
  }

  const [from, to] = anchorIndex <= targetIndex ? [anchorIndex, targetIndex] : [targetIndex, anchorIndex]
  for (let index = from; index <= to; index += 1) {
    if (checked) {
      next.add(orderedIds[index])
    } else {
      next.delete(orderedIds[index])
    }
  }
  return next
}

/** Drop selection entries whose id is no longer in the staged list. */
export function pruneDraftSelection(
  current: ReadonlySet<string>,
  orderedIds: readonly string[]
): ReadonlySet<string> {
  const staged = new Set(orderedIds)
  const pruned = [...current].filter((id) => staged.has(id))
  return pruned.length === current.size ? current : new Set(pruned)
}
