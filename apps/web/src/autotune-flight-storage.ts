// The gains an autotune flight started from, kept across the unplug.
//
// The whole flow is "set it up, fly, come back, plug in" — so the before-state
// has to survive the reconnect it is built around. Same reasoning and the same
// board-identity key as setup-progress-storage: a fingerprint from a different
// airframe would report a tune that never happened.

import type { ConfiguratorSnapshot } from '@arduconfig/ardupilot-core'

import type { AutotuneGains } from './view-models/autotune-flight'

const STORAGE_KEY_PREFIX = 'arduconfig:autotune-flight:'

/**
 * Stale after a month. A fingerprint older than that is comparing today's
 * aircraft against one that has probably been rebuilt, and a "tune completed"
 * derived from it would be meaningless.
 */
const MAX_AGE_MS = 31 * 24 * 60 * 60 * 1000

export interface StoredAutotuneFlight {
  axisMask: number
  gains: AutotuneGains
  startedAtMs: number
}

/** Board identity, so one craft's fingerprint is never read for another. */
function storageKey(snapshot: ConfiguratorSnapshot): string | undefined {
  const board = snapshot.hardware.board
  if (!board || !snapshot.vehicle) {
    return undefined
  }
  if (board.uid) {
    return `${STORAGE_KEY_PREFIX}uid:${board.uid}`
  }
  return `${STORAGE_KEY_PREFIX}board:${snapshot.vehicle.vehicle}:${board.boardType}:${board.vendorId}:${board.productId}`
}

export function loadAutotuneFlight(snapshot: ConfiguratorSnapshot): StoredAutotuneFlight | undefined {
  const key = storageKey(snapshot)
  if (!key || typeof window === 'undefined') return undefined
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return undefined
    const parsed = JSON.parse(raw) as StoredAutotuneFlight
    if (
      typeof parsed?.axisMask !== 'number' ||
      typeof parsed?.startedAtMs !== 'number' ||
      typeof parsed?.gains !== 'object'
    ) {
      return undefined
    }
    if (Date.now() - parsed.startedAtMs > MAX_AGE_MS) {
      window.localStorage.removeItem(key)
      return undefined
    }
    return parsed
  } catch {
    // Unreadable storage is the same as none — never a reason to fail the tab.
    return undefined
  }
}

export function saveAutotuneFlight(snapshot: ConfiguratorSnapshot, flight: StoredAutotuneFlight): void {
  const key = storageKey(snapshot)
  if (!key || typeof window === 'undefined') return
  try {
    window.localStorage.setItem(key, JSON.stringify(flight))
  } catch {
    /* quota or a private window; the flow degrades to "no before-state" */
  }
}

export function clearAutotuneFlight(snapshot: ConfiguratorSnapshot): void {
  const key = storageKey(snapshot)
  if (!key || typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(key)
  } catch {
    /* nothing to do */
  }
}
