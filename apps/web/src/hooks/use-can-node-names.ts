// Persistent, operator-assigned names for DroneCAN nodes. Keyed by the node's
// 16-byte hardware unique ID (hwUniqueId from UAVCAN_NODE_INFO) so a name sticks
// to the physical device across reboots, dynamic node-id changes, and sessions —
// independent of which aircraft it's on. Stored in localStorage.

import { useCallback, useEffect, useState } from 'react'

const STORAGE_KEY = 'arduconfig.can-node-names.v1'

/**
 * Parse the stored name map defensively: keep only string→non-empty-string
 * entries, lower-case the UID keys, and fall back to an empty map on anything
 * malformed. Pure, so it can be unit-tested without localStorage.
 */
export function parseStoredCanNodeNames(raw: string | null): Record<string, string> {
  if (!raw) {
    return {}
  }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') {
      return {}
    }
    const result: Record<string, string> = {}
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'string' && value.trim().length > 0) {
        result[key.toLowerCase()] = value.trim()
      }
    }
    return result
  } catch {
    return {}
  }
}

export interface CanNodeNames {
  /** Resolve a custom name for a node UID, or undefined if none is set. */
  getName: (hwUniqueId: string | undefined) => string | undefined
  /** Set (or, with an empty name, clear) the custom name for a node UID. */
  setName: (hwUniqueId: string, name: string) => void
}

export function useCanNodeNames(): CanNodeNames {
  const [names, setNames] = useState<Record<string, string>>(() =>
    parseStoredCanNodeNames(typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null)
  )

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(names))
    } catch {
      // Ignore quota / unavailable storage — names just won't persist.
    }
  }, [names])

  const getName = useCallback(
    (hwUniqueId: string | undefined) => (hwUniqueId ? names[hwUniqueId.toLowerCase()] : undefined),
    [names]
  )

  const setName = useCallback((hwUniqueId: string, name: string) => {
    const key = hwUniqueId.toLowerCase()
    const trimmed = name.trim()
    setNames((current) => {
      const next = { ...current }
      if (trimmed) {
        next[key] = trimmed
      } else {
        delete next[key]
      }
      return next
    })
  }, [])

  return { getName, setName }
}
