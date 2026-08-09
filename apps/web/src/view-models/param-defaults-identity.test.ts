import { describe, expect, it } from 'vitest'
import type { ConfiguratorSnapshot } from '@arduconfig/ardupilot-core'

import { paramDefaultsIdentity } from './param-defaults-identity'

function snapshot(options: {
  connected?: boolean
  firmwareVersion?: string
  boardType?: number
}): ConfiguratorSnapshot {
  return {
    connection: { kind: options.connected === false ? 'disconnected' : 'connected' },
    hardware: {
      board:
        options.firmwareVersion === undefined && options.boardType === undefined
          ? undefined
          : { firmwareVersion: options.firmwareVersion, boardType: options.boardType }
    }
  } as unknown as ConfiguratorSnapshot
}

describe('paramDefaultsIdentity', () => {
  it('is stable for the same build, so defaults are not refetched on every render', () => {
    const a = paramDefaultsIdentity(snapshot({ firmwareVersion: '4.7.0 (beta)', boardType: 5810 }))
    const b = paramDefaultsIdentity(snapshot({ firmwareVersion: '4.7.0 (beta)', boardType: 5810 }))
    expect(a).toBe(b)
    expect(a).toBeDefined()
  })

  it('changes when the firmware is flashed to another build', () => {
    // The regression: a build whose compiled-in default differs was showing the
    // previous build's defaults, because the cache was never invalidated.
    const before = paramDefaultsIdentity(snapshot({ firmwareVersion: '4.6.3', boardType: 5810 }))
    const after = paramDefaultsIdentity(snapshot({ firmwareVersion: '4.7.0 (beta)', boardType: 5810 }))
    expect(after).not.toBe(before)
  })

  it('changes when the same firmware version is running on a different board', () => {
    // Board-specific defaults are real, so version alone is not a safe key.
    const arkFpv = paramDefaultsIdentity(snapshot({ firmwareVersion: '4.7.0', boardType: 59 }))
    const brotherHobby = paramDefaultsIdentity(snapshot({ firmwareVersion: '4.7.0', boardType: 5810 }))
    expect(arkFpv).not.toBe(brotherHobby)
  })

  it('is undefined while disconnected, so another vehicle inherits nothing', () => {
    expect(paramDefaultsIdentity(snapshot({ connected: false, firmwareVersion: '4.7.0', boardType: 5810 }))).toBeUndefined()
  })

  it('still yields a key when the board never reported its identity', () => {
    // An unidentified board must not read as "same as every other unidentified
    // board is fine" by returning undefined — that is the disconnected signal.
    expect(paramDefaultsIdentity(snapshot({}))).toBeDefined()
  })
})
