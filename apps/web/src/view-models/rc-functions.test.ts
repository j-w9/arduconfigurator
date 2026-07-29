import type { ConfiguratorSnapshot } from '@arduconfig/ardupilot-core'
import { describe, expect, it } from 'vitest'

import {
  buildRcFunctionRows,
  countAssignedRcFunctions,
  rcFunctionConflicts,
  RC_FUNCTION_MAX_CHANNEL,
  RC_FUNCTION_MIN_CHANNEL
} from './rc-functions'

function snapshot(params: Record<string, number>, channels: number[] = []): ConfiguratorSnapshot {
  return {
    parameters: Object.entries(params).map(([id, value]) => ({ id, value })),
    liveVerification: { rcInput: { verified: channels.length > 0, channelCount: channels.length, channels } }
  } as unknown as ConfiguratorSnapshot
}

describe('buildRcFunctionRows', () => {
  it('covers exactly the AUX range — the primary stick axes are never offered', () => {
    const rows = buildRcFunctionRows(snapshot({}), {})
    expect(rows[0].channelNumber).toBe(RC_FUNCTION_MIN_CHANNEL)
    expect(rows[rows.length - 1].channelNumber).toBe(RC_FUNCTION_MAX_CHANNEL)
    // An aux function on a stick axis is a configuration error, not a choice.
    expect(rows.some((row) => row.channelNumber < 5)).toBe(false)
  })

  it('treats 0 as unassigned', () => {
    const rows = buildRcFunctionRows(snapshot({ RC5_OPTION: 0, RC6_OPTION: 153 }), {})
    expect(rows.find((row) => row.channelNumber === 5)?.assigned).toBe(false)
    expect(rows.find((row) => row.channelNumber === 6)?.assigned).toBe(true)
    expect(countAssignedRcFunctions(rows)).toBe(1)
  })

  it('lets a staged edit win over the live value, so a selection shows before Apply', () => {
    const rows = buildRcFunctionRows(snapshot({ RC5_OPTION: 0 }), { RC5_OPTION: '4' })
    expect(rows.find((row) => row.channelNumber === 5)?.value).toBe(4)
    expect(rows.find((row) => row.channelNumber === 5)?.assigned).toBe(true)
  })

  it('flags the same function assigned to two channels', () => {
    // ArduPilot does not define which channel wins, so this is a real
    // misconfiguration rather than a cosmetic nag.
    const rows = buildRcFunctionRows(snapshot({ RC5_OPTION: 4, RC7_OPTION: 4 }), {})
    const conflicts = rcFunctionConflicts(rows)
    expect(conflicts.map((row) => row.channelNumber)).toEqual([5, 7])
    expect(conflicts[0].duplicateChannels).toEqual([7])
  })

  it('does NOT flag several channels all set to Do Nothing as a conflict', () => {
    const rows = buildRcFunctionRows(snapshot({ RC5_OPTION: 0, RC6_OPTION: 0, RC7_OPTION: 0 }), {})
    expect(rcFunctionConflicts(rows)).toEqual([])
  })

  it('surfaces live PWM so the operator can tell which physical switch is which', () => {
    const channels = [1500, 1500, 1000, 1500, 1900, 1100, 0, 0]
    const rows = buildRcFunctionRows(snapshot({}), {}, ).map((row) => row)
    expect(rows.find((row) => row.channelNumber === 5)?.pwm).toBeUndefined()

    const live = buildRcFunctionRows(snapshot({}, channels), {})
    expect(live.find((row) => row.channelNumber === 5)?.pwm).toBe(1900)
    expect(live.find((row) => row.channelNumber === 6)?.pwm).toBe(1100)
    // A zero/absent channel is not a real reading.
    expect(live.find((row) => row.channelNumber === 7)?.pwm).toBeUndefined()
  })
})
