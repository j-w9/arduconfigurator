// Durable AMC guided-mode progress.
//
// Two things are worth surviving a reload, and they are different in kind.
//
// The declaration is the operator's own work: twenty-one fields describing the
// aircraft, which nothing else in the app knows and which a reflexive F5 would
// otherwise throw away.
//
// Whether a step is *done* is mostly not stored at all -- it is read back from
// the vehicle, because "the parameters this step sets already have these
// values" is a fact that stays true without being remembered, and a stored
// checklist would go stale the moment anything else wrote a parameter. The
// exception is the steps that set nothing: assembling the frame, checking a
// propeller direction. Those have no evidence in the parameters, so the
// operator's "reviewed" is the only record there can be, and it is kept.
//
// Safety model, following setup-progress-storage.ts: the key prefers the
// board's per-unit uid, so a declaration cannot be restored onto a different
// aircraft. A declaration made before connecting is kept in its own slot and
// is never applied to a vehicle silently -- the operator is offered it.

import type { ConfiguratorSnapshot } from '@arduconfig/ardupilot-core'

const STORAGE_KEY_PREFIX = 'arduconfig.amc-progress.'

/** The slot for work done before a vehicle was attached. */
export const UNATTACHED_KEY = `${STORAGE_KEY_PREFIX}unattached`

export interface StoredAmcProgress {
  version: 1
  savedAtMs: number
  /** Which sequence the declaration was made against. */
  vehicleKind: string
  /** Declared component fields, by the form's own keys. */
  declaration: Record<string, string>
  /** Steps the operator marked reviewed, by .param filename. */
  reviewed: string[]
}

/**
 * Where this vehicle's progress lives, or the unattached slot.
 *
 * Unlike the guided-setup key this never returns undefined: the declaration is
 * useful before a vehicle is connected, and losing it on reload would be the
 * same annoyance whether or not a link happened to be up.
 */
export function deriveAmcProgressKey(snapshot: ConfiguratorSnapshot | undefined): string {
  const board = snapshot?.hardware.board
  if (snapshot?.connection.kind !== 'connected' || !board || !snapshot.vehicle) {
    return UNATTACHED_KEY
  }
  if (board.uid) {
    return `${STORAGE_KEY_PREFIX}uid:${board.uid}`
  }
  // Two identical boards can collide here. That is tolerable: the worst case is
  // a declaration offered for the wrong airframe of the same model, and every
  // value it produces still goes through the draft bar before it is written.
  return `${STORAGE_KEY_PREFIX}board:${snapshot.vehicle.vehicle}:${board.boardType}:${board.vendorId}:${board.productId}`
}

function resolveStorage(storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>) {
  if (storage) return storage
  try {
    return typeof window !== 'undefined' ? window.localStorage : undefined
  } catch {
    // Some embedding contexts throw on localStorage access entirely.
    return undefined
  }
}

export function loadAmcProgress(
  key: string,
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
): StoredAmcProgress | undefined {
  const store = resolveStorage(storage)
  if (!store) return undefined
  try {
    const raw = store.getItem(key)
    if (!raw) return undefined
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return undefined
    const record = parsed as Partial<StoredAmcProgress>
    if (record.version !== 1 || typeof record.declaration !== 'object' || record.declaration === null) {
      return undefined
    }
    // Anything stored is data the page wrote, but it has been through a
    // round-trip and another version of this app may have written it, so each
    // field is checked rather than trusted.
    const declaration: Record<string, string> = {}
    for (const [field, value] of Object.entries(record.declaration)) {
      if (typeof value === 'string') declaration[field] = value
    }
    return {
      version: 1,
      savedAtMs: typeof record.savedAtMs === 'number' ? record.savedAtMs : 0,
      vehicleKind: typeof record.vehicleKind === 'string' ? record.vehicleKind : '',
      declaration,
      reviewed: Array.isArray(record.reviewed) ? record.reviewed.filter((s): s is string => typeof s === 'string') : []
    }
  } catch {
    return undefined
  }
}

export function saveAmcProgress(
  key: string,
  progress: Omit<StoredAmcProgress, 'version' | 'savedAtMs'>,
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
): void {
  const store = resolveStorage(storage)
  if (!store) return
  // Nothing to remember is worth forgetting, so an empty declaration with no
  // reviewed steps clears the slot rather than leaving an empty record behind.
  if (Object.keys(progress.declaration).length === 0 && progress.reviewed.length === 0) {
    try {
      store.removeItem(key)
    } catch {
      // A full or blocked store is not worth failing the screen over.
    }
    return
  }
  try {
    store.setItem(
      key,
      JSON.stringify({ version: 1, savedAtMs: Date.now(), ...progress } satisfies StoredAmcProgress)
    )
  } catch {
    // Same: the tab works without persistence, it just forgets.
  }
}

export function clearAmcProgress(key: string, storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>): void {
  const store = resolveStorage(storage)
  if (!store) return
  try {
    store.removeItem(key)
  } catch {
    // Nothing to do; the next save will overwrite.
  }
}
