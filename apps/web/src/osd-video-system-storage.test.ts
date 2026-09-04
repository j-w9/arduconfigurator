import { beforeEach, describe, expect, it } from 'vitest'

import { osdVideoSystemFromTxtRes, readStoredOsdPreview, writeStoredOsdPreview } from './osd-video-system-storage'

// This workspace runs vitest under the `node` environment, where a global
// `localStorage` exists but its methods do not -- so a typeof check passes and
// the call then throws. That is exactly the shape the module has to survive in
// a locked-down browser too, and the try/catch in it does; here we install a
// working in-memory stub so the round-trip behaviour itself can be asserted.
beforeEach(() => {
  const store = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
      clear: () => store.clear()
    }
  })
})

/*
 * The seeding rule, pinned against ArduPilot's own parameter definition:
 * AP_OSD_Screen.cpp declares OSDn_TXT_RES as `@Values: 0:30x16,1:50x18,2:60x22`.
 */
describe('OSD preview seeded from the aircraft', () => {
  it('maps every TXT_RES value ArduPilot defines', () => {
    expect(osdVideoSystemFromTxtRes(0)).toBe('analog')
    expect(osdVideoSystemFromTxtRes(1)).toBe('hdzero')
    expect(osdVideoSystemFromTxtRes(2)).toBe('dji_o3')
  })

  it('has no opinion when the parameter is absent or out of range', () => {
    // A board whose build omits the MSP DisplayPort OSD has no TXT_RES at all;
    // guessing a grid from nothing would be worse than leaving the default.
    expect(osdVideoSystemFromTxtRes(undefined)).toBeUndefined()
    expect(osdVideoSystemFromTxtRes(7)).toBeUndefined()
  })
})

describe('OSD preview choice, remembered per aircraft', () => {
  it('round-trips a stored choice', () => {
    const key = 'arduconfigurator.osd-video-system.uid:test-a'
    writeStoredOsdPreview(key, { version: 1, videoSystem: 'walksnail', analogSubMode: 'ntsc' })
    expect(readStoredOsdPreview(key)).toEqual({ version: 1, videoSystem: 'walksnail', analogSubMode: 'ntsc' })
  })

  it('keeps two aircraft apart', () => {
    const a = 'arduconfigurator.osd-video-system.uid:test-b'
    const b = 'arduconfigurator.osd-video-system.uid:test-c'
    writeStoredOsdPreview(a, { version: 1, videoSystem: 'walksnail', analogSubMode: 'ntsc' })
    writeStoredOsdPreview(b, { version: 1, videoSystem: 'dji_o3', analogSubMode: 'ntsc' })
    expect(readStoredOsdPreview(a)?.videoSystem).toBe('walksnail')
    expect(readStoredOsdPreview(b)?.videoSystem).toBe('dji_o3')
  })

  it('treats a corrupt or unversioned entry as no preference', () => {
    // Never throw out of the OSD tab because localStorage holds junk.
    const key = 'arduconfigurator.osd-video-system.uid:test-d'
    localStorage.setItem(key, 'not json')
    expect(readStoredOsdPreview(key)).toBeUndefined()
    localStorage.setItem(key, JSON.stringify({ version: 99, videoSystem: 'walksnail' }))
    expect(readStoredOsdPreview(key)).toBeUndefined()
  })

  it('returns nothing without a key, rather than sharing one bucket', () => {
    expect(readStoredOsdPreview(undefined)).toBeUndefined()
  })
})
