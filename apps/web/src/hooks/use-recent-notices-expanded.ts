// Durable expand-in-place state for the Recent Notices feed.
//
// The panel shipped (PR #160) collapsed-by-default and NOT persisted, on the
// theory that Status & Info is already a long page so extra height should be
// asked for every time. The operator pushed back — "eh, idk about collapsed by
// default" — and the reason is obvious in use: someone who wants to read the
// FC's STATUSTEXT feed wants to read it on every visit, not re-click Expand
// after every reload and every reconnect-triggered refresh.
//
// The compromise this hook implements: collapsed is still what a fresh profile
// gets, so the page-length win holds for everyone who never touches the
// control and nothing regresses for them. But the choice, once made, sticks —
// expanded survives reloads until it is collapsed again.
//
// This is display state only. It never gates, derives, or writes a parameter.

import { useCallback, useEffect, useState } from 'react'

// Namespaced like every other persisted local preference here
// (arduconfig:gps-coord-format, arduconfig:transport-mode, …).
const RECENT_NOTICES_EXPANDED_STORAGE_KEY = 'arduconfig:recent-notices-expanded'

// Versioned the way setup-progress-storage.ts versions its payload — a field
// inside the JSON rather than a suffix on the key, so a stale value is REJECTED
// on read instead of being orphaned in storage forever under a dead key. Bump
// this whenever "expanded" stops meaning what it means today (a third height,
// a per-view height, a docked/undocked mode) so old profiles fall back to the
// safe default instead of restoring something nonsensical.
const RECENT_NOTICES_EXPANDED_VERSION = 1

interface StoredNoticesExpanded {
  version: number
  expanded: boolean
}

/**
 * localStorage, or undefined when it is unavailable. Access itself can throw
 * (embedded contexts, some private-mode configurations, storage disabled by
 * policy), so even reaching for the object is guarded — a throw here would
 * white-screen the whole app at first render, which is a wildly
 * disproportionate outcome for a panel height.
 */
function resolveStorage(): Pick<Storage, 'getItem' | 'setItem'> | undefined {
  if (typeof window === 'undefined') {
    return undefined
  }

  try {
    return window.localStorage
  } catch {
    return undefined
  }
}

/**
 * Stored preference, or false (collapsed) for anything we cannot positively
 * read as "expanded": missing key, unparseable JSON, wrong shape, wrong
 * version. Silent by design — there is no user-actionable failure here, and
 * a console error on every load would be noise in the one place operators are
 * told to look for real problems.
 */
function readStoredExpanded(): boolean {
  const storage = resolveStorage()
  if (!storage) {
    return false
  }

  try {
    const raw = storage.getItem(RECENT_NOTICES_EXPANDED_STORAGE_KEY)
    if (!raw) {
      return false
    }

    const parsed = JSON.parse(raw) as StoredNoticesExpanded | null
    if (parsed?.version !== RECENT_NOTICES_EXPANDED_VERSION || typeof parsed.expanded !== 'boolean') {
      return false
    }

    return parsed.expanded
  } catch {
    return false
  }
}

/**
 * [expanded, toggle] for the inline Recent Notices list height, persisted
 * across reloads. When storage is unavailable the state still works for the
 * life of the tab — it just does not outlive it, which is exactly the
 * behaviour the panel had before this hook.
 */
export function useRecentNoticesExpanded(): [boolean, () => void] {
  // Lazy initialiser: read once at mount, not on every render, and before the
  // first paint so an expanded panel never flashes collapsed first.
  const [expanded, setExpanded] = useState<boolean>(readStoredExpanded)

  useEffect(() => {
    const storage = resolveStorage()
    if (!storage) {
      return
    }

    try {
      storage.setItem(
        RECENT_NOTICES_EXPANDED_STORAGE_KEY,
        JSON.stringify({ version: RECENT_NOTICES_EXPANDED_VERSION, expanded } satisfies StoredNoticesExpanded)
      )
    } catch {
      // Quota exhausted or storage disabled mid-session: the height still
      // applies to this tab, it just will not be remembered.
    }
  }, [expanded])

  const toggle = useCallback(() => {
    setExpanded((current) => !current)
  }, [])

  return [expanded, toggle]
}
