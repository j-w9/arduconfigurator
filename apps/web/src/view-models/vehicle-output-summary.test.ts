import type { ServoOutputAssignment } from '@arduconfig/ardupilot-core'
import { describe, expect, it } from 'vitest'

import { buildVehicleOutputSummary } from './vehicle-output-summary'

let channel = 0
function out(functionValue: number, kind: ServoOutputAssignment['kind'] = 'control-surface'): ServoOutputAssignment {
  channel += 1
  return { kind, functionValue, channelNumber: channel } as unknown as ServoOutputAssignment
}

const groupIds = (vehicle: Parameters<typeof buildVehicleOutputSummary>[0], outputs: ServoOutputAssignment[]) =>
  buildVehicleOutputSummary(vehicle, outputs).groups.map((group) => group.id)

describe('buildVehicleOutputSummary', () => {
  it('counts only configured (non-unused) outputs', () => {
    const summary = buildVehicleOutputSummary('ArduPlane', [out(4), out(0, 'unused'), out(2)])
    expect(summary.configuredCount).toBe(2)
  })

  it('uses a vehicle-appropriate title', () => {
    expect(buildVehicleOutputSummary('ArduPlane', []).title).toBe('Fixed-wing / QuadPlane outputs')
    expect(buildVehicleOutputSummary('ArduRover', []).title).toBe('Rover outputs')
    expect(buildVehicleOutputSummary('ArduSub', []).title).toBe('Sub outputs')
    expect(buildVehicleOutputSummary(undefined, []).title).toBe('Vehicle outputs')
  })

  it('Plane: splits primary flight controls from secondary surfaces from other', () => {
    // 4 = aileron (primary), 2 = flap (secondary), 99 = unknown (other)
    const summary = buildVehicleOutputSummary('ArduPlane', [out(4), out(2), out(99)])
    expect(summary.groups.map((group) => group.id)).toEqual(['primary', 'secondary', 'other'])
    expect(summary.groups[0].outputs.map((output) => output.functionValue)).toEqual([4])
    expect(summary.groups[1].outputs.map((output) => output.functionValue)).toEqual([2])
  })

  it('omits empty role groups', () => {
    // Only a primary aileron — no secondary, no other.
    expect(groupIds('ArduPlane', [out(4)])).toEqual(['primary'])
  })

  it('Rover steering and Sub thrusters land in the primary group', () => {
    expect(groupIds('ArduRover', [out(26)])).toEqual(['primary'])
    expect(buildVehicleOutputSummary('ArduRover', [out(26)]).groups[0].label).toBe('Steering & throttle')
    expect(buildVehicleOutputSummary('ArduSub', [out(33)]).groups[0]).toMatchObject({ id: 'primary', label: 'Thrusters' })
  })

  it('the generic fallback routes every configured output to "Other outputs"', () => {
    const summary = buildVehicleOutputSummary(undefined, [out(4), out(2)])
    expect(summary.groups.map((group) => group.id)).toEqual(['other'])
    expect(summary.groups[0].label).toBe('Other outputs')
  })
})
