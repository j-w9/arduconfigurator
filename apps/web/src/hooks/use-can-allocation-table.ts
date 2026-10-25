// The node ID allocation table, remembered in this browser: a node gets the ID
// it had last time, session to session -- what someone building a fleet wants.
// Seeds the allocator when it is switched on; saves what it hands out.

import { useCallback, useEffect } from 'react'
import type { DronecanAllocatorState } from '@arduconfig/ardupilot-core'

const STORAGE_KEY = 'arduconfig:can-node-allocations'

type Entry = { nodeId: number; uniqueId: string }

function load(): Entry[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '[]') as unknown
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is Entry => typeof entry?.nodeId === 'number' && typeof entry?.uniqueId === 'string')
      : []
  } catch {
    return []
  }
}

function save(entries: readonly Entry[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
  } catch {
    // Remembering it is a convenience.
  }
}

export function useCanAllocationTable(options: {
  backend: { setCanNodeAllocator(enabled: boolean, seed?: readonly Entry[]): void; forgetCanNodeAllocations(): void } | undefined
  allocator: DronecanAllocatorState | undefined
}): { toggle: (enabled: boolean) => void; forget: () => void } {
  const { backend, allocator } = options

  // Save what has been handed out (merged over what was remembered).
  const allocatedKey = allocator?.entries
    .filter((entry) => entry.source === 'allocated')
    .map((entry) => `${entry.uniqueId}:${entry.nodeId}`)
    .join(',')
  useEffect(() => {
    if (!allocator || !allocatedKey) return
    const merged = new Map(load().map((entry) => [entry.uniqueId, entry.nodeId]))
    for (const entry of allocator.entries) {
      if (entry.source === 'allocated') merged.set(entry.uniqueId, entry.nodeId)
    }
    save([...merged].map(([uniqueId, nodeId]) => ({ uniqueId, nodeId })))
    // allocatedKey stands for the entries.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allocatedKey])

  const toggle = useCallback(
    (enabled: boolean) => backend?.setCanNodeAllocator(enabled, enabled ? load() : undefined),
    [backend]
  )
  const forget = useCallback(() => {
    save([])
    backend?.forgetCanNodeAllocations()
  }, [backend])
  return { toggle, forget }
}
