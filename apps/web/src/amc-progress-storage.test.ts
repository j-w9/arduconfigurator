import { describe, expect, it } from 'vitest'

import {
  UNATTACHED_KEY,
  clearAmcProgress,
  deriveAmcProgressKey,
  loadAmcProgress,
  saveAmcProgress
} from './amc-progress-storage'

/** A localStorage stand-in, so the tests do not depend on a browser. */
function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial))
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
    size: () => map.size,
    raw: (key: string) => map.get(key)
  }
}

const snapshot = (over: Record<string, unknown> = {}) =>
  ({
    connection: { kind: 'connected' },
    vehicle: { vehicle: 'ArduCopter' },
    hardware: { board: { boardType: 5, vendorId: 1, productId: 2, ...(over.board as object) } },
    ...over
  }) as never

describe('deriveAmcProgressKey', () => {
  it('prefers the board uid, which is unique per unit', () => {
    const key = deriveAmcProgressKey(snapshot({ board: { uid: 'abc123', boardType: 5, vendorId: 1, productId: 2 } }))
    expect(key).toContain('uid:abc123')
  })

  it('falls back to the board identity when there is no uid', () => {
    const key = deriveAmcProgressKey(snapshot())
    expect(key).toContain('board:ArduCopter:5:1:2')
  })

  it('keeps work done before connecting in its own slot', () => {
    expect(deriveAmcProgressKey(undefined)).toBe(UNATTACHED_KEY)
    expect(deriveAmcProgressKey(snapshot({ connection: { kind: 'disconnected' } }))).toBe(UNATTACHED_KEY)
  })

  it('does not mix two aircraft', () => {
    const one = deriveAmcProgressKey(snapshot({ board: { uid: 'one' } }))
    const two = deriveAmcProgressKey(snapshot({ board: { uid: 'two' } }))
    expect(one).not.toBe(two)
  })
})

describe('storing progress', () => {
  it('round-trips a declaration and the reviewed steps', () => {
    const store = fakeStorage()
    saveAmcProgress('k', { vehicleKind: 'ArduCopter', declaration: { 'Propellers/Specifications/Diameter_inches': '10' }, reviewed: ['05_board_orientation.param'] }, store)
    const back = loadAmcProgress('k', store)
    expect(back?.declaration).toEqual({ 'Propellers/Specifications/Diameter_inches': '10' })
    expect(back?.reviewed).toEqual(['05_board_orientation.param'])
    expect(back?.vehicleKind).toBe('ArduCopter')
  })

  it('forgets rather than storing nothing', () => {
    const store = fakeStorage()
    saveAmcProgress('k', { vehicleKind: 'ArduCopter', declaration: { a: '1' }, reviewed: [] }, store)
    expect(store.size()).toBe(1)
    saveAmcProgress('k', { vehicleKind: 'ArduCopter', declaration: {}, reviewed: [] }, store)
    expect(store.size()).toBe(0)
  })

  it('returns nothing for a slot that was never written', () => {
    expect(loadAmcProgress('missing', fakeStorage())).toBeUndefined()
  })

  it('survives a corrupted or foreign record', () => {
    // Another version of the app, a half-written value, or someone editing
    // localStorage by hand. None of it should take the tab down.
    for (const raw of ['not json', '{}', '[]', 'null', '{"version":99}', '{"version":1}']) {
      expect(loadAmcProgress('k', fakeStorage({ k: raw }))).toBeUndefined()
    }
  })

  it('drops fields that are not strings rather than trusting the record', () => {
    const store = fakeStorage({
      k: JSON.stringify({ version: 1, savedAtMs: 1, vehicleKind: 'ArduCopter', declaration: { good: 'x', bad: 7 }, reviewed: ['a', 3] })
    })
    const back = loadAmcProgress('k', store)
    expect(back?.declaration).toEqual({ good: 'x' })
    expect(back?.reviewed).toEqual(['a'])
  })

  it('clears a slot on request', () => {
    const store = fakeStorage()
    saveAmcProgress('k', { vehicleKind: 'ArduCopter', declaration: { a: '1' }, reviewed: [] }, store)
    clearAmcProgress('k', store)
    expect(loadAmcProgress('k', store)).toBeUndefined()
  })

  it('does not throw when storage refuses to co-operate', () => {
    const hostile = {
      getItem: () => { throw new Error('blocked') },
      setItem: () => { throw new Error('full') },
      removeItem: () => { throw new Error('blocked') }
    }
    expect(() => saveAmcProgress('k', { vehicleKind: 'x', declaration: { a: '1' }, reviewed: [] }, hostile)).not.toThrow()
    expect(loadAmcProgress('k', hostile)).toBeUndefined()
    expect(() => clearAmcProgress('k', hostile)).not.toThrow()
  })
})
