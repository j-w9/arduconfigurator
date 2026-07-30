// Bulk-selection state for a parameter-diff review list.
//
// The Parameters tab has had shift-click range selection and a "Drop selected"
// bulk action for a while; the Snapshots restore preview never did, so
// abandoning part of a restore meant one row at a time. The rules are identical
// on both surfaces — the same anchor semantics, the same need to forget ids that
// have left the list — so they live here rather than being written twice.
//
// The pure rules stay in view-models/draft-selection.ts (unit-tested off React);
// this owns the React state, the anchor ref, and the pruning effect.

import { useCallback, useEffect, useRef, useState } from 'react'

import { applyDraftSelectionClick, pruneDraftSelection } from '../view-models/draft-selection'

export interface UseDraftSelectionResult {
  selectedIds: ReadonlySet<string>
  /** Click a row's checkbox. Shift extends from the last clicked row. */
  handleSelectionClick: (id: string, shiftKey: boolean) => void
  /** Select every currently-listed row, or clear the selection. */
  setAllSelected: (selected: boolean) => void
  /** Forget specific ids — used when rows are dropped by another control, so a
   *  following "Drop selected (n)" count cannot include rows already gone. */
  forgetIds: (ids: readonly string[]) => void
  /** Clear everything, including the shift-click anchor. */
  clearSelection: () => void
  /** True when every listed row is selected (drives the select-all checkbox). */
  allSelected: boolean
}

/**
 * @param orderedIds every row currently in the list, in display order. Shift-click
 * ranges are computed against this order, and any selected id NOT in it is
 * pruned — rows leave the list via apply/drop/discard, and a stale id would make
 * the "Drop selected (n)" count lie.
 */
export function useDraftSelection(orderedIds: readonly string[]): UseDraftSelectionResult {
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(() => new Set())
  const anchorRef = useRef<string | null>(null)

  useEffect(() => {
    setSelectedIds((current) => pruneDraftSelection(current, orderedIds))
  }, [orderedIds])

  const handleSelectionClick = useCallback(
    (id: string, shiftKey: boolean) => {
      setSelectedIds((current) =>
        applyDraftSelectionClick(current, orderedIds, id, { shiftKey, anchorId: anchorRef.current })
      )
      anchorRef.current = id
    },
    [orderedIds]
  )

  const setAllSelected = useCallback(
    (selected: boolean) => {
      setSelectedIds(selected ? new Set(orderedIds) : new Set())
      anchorRef.current = null
    },
    [orderedIds]
  )

  const forgetIds = useCallback((ids: readonly string[]) => {
    setSelectedIds((current) => {
      if (current.size === 0) {
        return current
      }
      const next = new Set(current)
      ids.forEach((id) => next.delete(id))
      return next.size === current.size ? current : next
    })
  }, [])

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set())
    anchorRef.current = null
  }, [])

  return {
    selectedIds,
    handleSelectionClick,
    setAllSelected,
    forgetIds,
    clearSelection,
    allSelected: orderedIds.length > 0 && selectedIds.size === orderedIds.length
  }
}
