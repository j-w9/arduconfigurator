import { describe, expect, it } from 'vitest'

import type { ConfiguratorSnapshot } from '@arduconfig/ardupilot-core'

import type { RcMixerAssignment } from './rc-mixer'
import { auxFunctionLabel, deriveExternalChannelClaims, deriveRcLogicChannelClaims } from './channel-usage'

function snapshot(values: Record<string, number>): ConfiguratorSnapshot {
  return {
    parameters: Object.entries(values).map(([id, value]) => ({ id, value }))
  } as unknown as ConfiguratorSnapshot
}

function assignment(channel: number, functionId: number): RcMixerAssignment {
  return { id: `rcl-${channel}`, channel, functionId, lowPwm: 1700, highPwm: 2100, inverted: false }
}

describe('deriveExternalChannelClaims', () => {
  it('flags the flight-mode channel', () => {
    const claims = deriveExternalChannelClaims(snapshot({ FLTMODE_CH: 7 }))
    expect(claims.get(7)).toEqual(['Flight mode switch'])
  })

  it('labels an RCn_OPTION aux function by name (arm, VTX power)', () => {
    const claims = deriveExternalChannelClaims(snapshot({ RC6_OPTION: 153, RC8_OPTION: 94 }))
    expect(claims.get(6)).toEqual(['ArmDisarm (4.2 and higher)'])
    expect(claims.get(8)).toEqual(['VTX Power'])
  })

  it('combines both claims when a channel is the mode switch AND has an option', () => {
    const claims = deriveExternalChannelClaims(snapshot({ FLTMODE_CH: 5, RC5_OPTION: 153 }))
    expect(claims.get(5)).toEqual(['Flight mode switch', 'ArmDisarm (4.2 and higher)'])
  })

  it('ignores channels with no claim (RCn_OPTION = 0 or absent)', () => {
    const claims = deriveExternalChannelClaims(snapshot({ RC9_OPTION: 0 }))
    expect(claims.has(9)).toBe(false)
  })
})

describe('deriveRcLogicChannelClaims', () => {
  it('lists the RCL function(s) each channel drives, skipping pending (FUNC=0) rows', () => {
    const claims = deriveRcLogicChannelClaims([assignment(6, 153), assignment(8, 94), assignment(10, 0)])
    expect(claims.get(6)).toEqual(['ArmDisarm (4.2 and higher)'])
    expect(claims.get(8)).toEqual(['VTX Power'])
    expect(claims.has(10)).toBe(false)
  })

  it('de-dupes repeated function labels on one channel', () => {
    const claims = deriveRcLogicChannelClaims([assignment(7, 94), assignment(7, 94)])
    expect(claims.get(7)).toEqual(['VTX Power'])
  })
})

describe('auxFunctionLabel', () => {
  it('resolves known values and falls back for unknown ones', () => {
    expect(auxFunctionLabel(153)).toBe('ArmDisarm (4.2 and higher)')
    expect(auxFunctionLabel(99999)).toBe('Option 99999')
  })
})
