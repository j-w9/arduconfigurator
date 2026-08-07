// Persistence + interaction state for the Status & Info dashboard arrangement.
//
// Storage is per browser (localStorage), namespaced and versioned exactly like
// `arduconfig.can-node-names.v1`: the version is part of the KEY, so shipping a
// new default arrangement is a one-line bump that makes every stale saved
// layout simply not be found. Unreadable or untrusted values fall back to the
// default silently — see `parseStoredStatusDashboardLayout`. The v1 key from
// the zone model is left alone rather than migrated: a v1 layout has no columns
// to migrate, so those operators get the (unchanged) default back and rearrange
// once on the much freer model.
//
// Customisation is a POINTER-WIDTH affordance, not a desktop-only one. Below
// the width at which the workspace collapses to a single column (1024px, the
// existing `.setup-bench__workspace` breakpoint) a stored arrangement is
// IGNORED and the default stacking order renders instead: a multi-column
// arrangement has no meaning in one column, and a drag gesture on a phone
// fights the scroll. At or above it, touch and pen drags work exactly like
// mouse drags — a landscape tablet is a real target for this page.

import { useCallback, useEffect, useMemo, useState } from 'react'

import {
  STATUS_DASHBOARD_STORAGE_KEY,
  applyStatusDashboardDrop,
  defaultStatusDashboardLayout,
  isDefaultStatusDashboardLayout,
  moveStatusDashboardCard,
  nudgeStatusDashboardCard,
  nudgeStatusDashboardCardWidth,
  parseStoredStatusDashboardLayout,
  reconcileStatusDashboardLayout,
  resizeStatusDashboardCard,
  resizeStatusDashboardColumn,
  shiftStatusDashboardCardColumn,
  tidyStatusDashboardLayout,
  toggleStatusDashboardColumnFlow,
  type StatusDashboardCardSpec,
  type StatusDashboardDropTarget,
  type StatusDashboardLayout
} from '../view-models/status-dashboard-layout'

/** Width below which the Status workspace is a single column; see styles.css. */
export const STATUS_DASHBOARD_CUSTOMISE_MIN_WIDTH_PX = 1025

function readStoredLayout(): StatusDashboardLayout | undefined {
  try {
    if (typeof localStorage === 'undefined') {
      return undefined
    }
    return parseStoredStatusDashboardLayout(localStorage.getItem(STATUS_DASHBOARD_STORAGE_KEY))
  } catch {
    // Storage disabled entirely (some embedded contexts throw on access).
    return undefined
  }
}

function useIsWideEnough(): boolean {
  const [wide, setWide] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return true
    }
    return window.matchMedia(`(min-width: ${STATUS_DASHBOARD_CUSTOMISE_MIN_WIDTH_PX}px)`).matches
  })

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return
    }
    const query = window.matchMedia(`(min-width: ${STATUS_DASHBOARD_CUSTOMISE_MIN_WIDTH_PX}px)`)
    const onChange = (): void => setWide(query.matches)
    onChange()
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  return wide
}

export interface StatusDashboardLayoutController {
  /** The arrangement to render. Always exactly the cards that exist right now. */
  layout: StatusDashboardLayout
  /** False on narrow viewports: hide handles and render the default order. */
  customisable: boolean
  /** True when the operator has changed something, so "Reset layout" is useful. */
  customised: boolean
  moveCard: (id: string, columnId: string, index: number) => void
  /** Commit a resolved drop target — a move, a new column, or a new band. */
  dropCard: (id: string, target: StatusDashboardDropTarget) => void
  nudgeCard: (id: string, delta: -1 | 1) => void
  shiftCardColumn: (id: string, delta: -1 | 1) => void
  nudgeCardWidth: (id: string, delta: -1 | 1) => void
  resizeColumn: (columnId: string, span: number) => void
  toggleColumnFlow: (columnId: string) => void
  resizeCard: (id: string, heightRows: number | undefined) => void
  tidyLayout: () => void
  resetLayout: () => void
}

export function useStatusDashboardLayout(
  specs: readonly StatusDashboardCardSpec[]
): StatusDashboardLayoutController {
  const customisable = useIsWideEnough()
  const [stored, setStored] = useState<StatusDashboardLayout | undefined>(readStoredLayout)

  // Reconcile on every render against the cards that are actually present:
  // conditional sensor cards appear and disappear as the operator configures
  // them, and a saved layout must degrade to something sane either way.
  const layout = useMemo(
    () => (customisable ? reconcileStatusDashboardLayout(stored, specs) : defaultStatusDashboardLayout(specs)),
    [customisable, stored, specs]
  )

  const persist = useCallback((next: StatusDashboardLayout) => {
    setStored(next)
    try {
      localStorage.setItem(STATUS_DASHBOARD_STORAGE_KEY, JSON.stringify(next))
    } catch {
      // Quota or unavailable storage — the arrangement just won't outlive the tab.
    }
  }, [])

  const apply = useCallback(
    (transform: (current: StatusDashboardLayout) => StatusDashboardLayout) => {
      const next = transform(layout)
      if (next !== layout) {
        persist(next)
      }
    },
    [layout, persist]
  )

  const moveCard = useCallback(
    (id: string, columnId: string, index: number) =>
      apply((current) => moveStatusDashboardCard(current, id, columnId, index)),
    [apply]
  )

  const dropCard = useCallback(
    (id: string, target: StatusDashboardDropTarget) =>
      apply((current) => applyStatusDashboardDrop(current, id, target)),
    [apply]
  )

  const nudgeCard = useCallback(
    (id: string, delta: -1 | 1) => apply((current) => nudgeStatusDashboardCard(current, id, delta)),
    [apply]
  )

  const shiftCardColumn = useCallback(
    (id: string, delta: -1 | 1) => apply((current) => shiftStatusDashboardCardColumn(current, id, delta)),
    [apply]
  )

  const nudgeCardWidth = useCallback(
    (id: string, delta: -1 | 1) => apply((current) => nudgeStatusDashboardCardWidth(current, id, delta)),
    [apply]
  )

  const resizeColumn = useCallback(
    (columnId: string, span: number) => apply((current) => resizeStatusDashboardColumn(current, columnId, span)),
    [apply]
  )

  const toggleColumnFlow = useCallback(
    (columnId: string) => apply((current) => toggleStatusDashboardColumnFlow(current, columnId)),
    [apply]
  )

  const resizeCard = useCallback(
    (id: string, heightRows: number | undefined) =>
      apply((current) => resizeStatusDashboardCard(current, id, heightRows)),
    [apply]
  )

  const tidyLayout = useCallback(() => apply((current) => tidyStatusDashboardLayout(current)), [apply])

  const resetLayout = useCallback(() => {
    setStored(undefined)
    try {
      localStorage.removeItem(STATUS_DASHBOARD_STORAGE_KEY)
    } catch {
      // Ignore — the in-memory reset above already took effect.
    }
  }, [])

  const customised = useMemo(
    () => customisable && stored !== undefined && !isDefaultStatusDashboardLayout(layout, specs),
    [customisable, stored, layout, specs]
  )

  return {
    layout,
    customisable,
    customised,
    moveCard,
    dropCard,
    nudgeCard,
    shiftCardColumn,
    nudgeCardWidth,
    resizeColumn,
    toggleColumnFlow,
    resizeCard,
    tidyLayout,
    resetLayout
  }
}
