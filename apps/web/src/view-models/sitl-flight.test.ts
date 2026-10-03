import { describe, expect, it } from 'vitest'

import {
  DEFAULT_TAKEOFF_ALTITUDE_M,
  DESCEND_MODE,
  FLIGHT_MODES,
  GUIDED_MODE,
  canTakeOff,
  flightModesFor,
  modeLabel,
  takeOffSequence
} from './sitl-flight'

describe('the modes on offer', () => {
  it('does not share mode numbers between vehicles', () => {
    // ArduPilot's mode numbers are per-vehicle: 5 is Loiter on Copter and
    // FBWA on Plane. A shared table would put a fixed wing into the wrong
    // mode and look like it worked.
    expect(FLIGHT_MODES.copter.find((m) => m.value === 5)?.label).toBe('Loiter')
    expect(FLIGHT_MODES.plane.find((m) => m.value === 5)?.label).toBe('FBWA')
  })

  it('names each mode once per vehicle', () => {
    for (const [vehicle, modes] of Object.entries(FLIGHT_MODES)) {
      expect(new Set(modes.map((m) => m.value)).size, vehicle).toBe(modes.length)
      expect(new Set(modes.map((m) => m.label)).size, vehicle).toBe(modes.length)
    }
  })

  it('offers guided and a way down for every vehicle it offers modes for', () => {
    for (const vehicle of Object.keys(FLIGHT_MODES)) {
      expect(GUIDED_MODE[vehicle], vehicle).toBeTypeOf('number')
      expect(DESCEND_MODE[vehicle], vehicle).toBeTypeOf('number')
      const values = FLIGHT_MODES[vehicle].map((m) => m.value)
      expect(values, vehicle).toContain(GUIDED_MODE[vehicle])
      expect(values, vehicle).toContain(DESCEND_MODE[vehicle])
    }
  })

  it('has nothing for a vehicle it does not know', () => {
    expect(flightModesFor('rover')).toEqual([])
  })
})

describe('taking off', () => {
  it('goes guided, then arms, then climbs — in that order', () => {
    // Copter refuses NAV_TAKEOFF unless it is already armed AND already in
    // GUIDED. Any other order is three commands and no takeoff.
    expect(takeOffSequence('copter', 15)).toEqual([
      { kind: 'mode', value: 4 },
      { kind: 'arm' },
      { kind: 'takeoff', altitudeMetres: 15 }
    ])
  })

  it('is not offered for a fixed wing', () => {
    // A plane needs a runway roll or a hand launch; one button would be a
    // button that usually fails.
    expect(canTakeOff('plane')).toBe(false)
    expect(takeOffSequence('plane', 15)).toEqual([])
  })

  it('is not offered for a vehicle with no modes at all', () => {
    expect(canTakeOff('rover')).toBe(false)
    expect(takeOffSequence('rover', 15)).toEqual([])
  })

  it('climbs to a sensible height by default', () => {
    expect(DEFAULT_TAKEOFF_ALTITUDE_M).toBeGreaterThan(5)
    expect(DEFAULT_TAKEOFF_ALTITUDE_M).toBeLessThan(121)
  })
})

describe('naming a mode', () => {
  it('uses the vehicle’s own name for the number', () => {
    expect(modeLabel('copter', 5)).toBe('Loiter')
    expect(modeLabel('plane', 5)).toBe('FBWA')
  })

  it('still says something for a mode it does not list', () => {
    expect(modeLabel('copter', 17)).toBe('Mode 17')
  })

  it('names Circle, which is how a simulated vehicle is made to move', () => {
    expect(modeLabel('copter', 7)).toBe('Circle')
  })

  it('says nothing rather than zero when there is no mode yet', () => {
    // 0 is Stabilize, so an undefined mode must not fall through to it.
    expect(modeLabel('copter', undefined)).toBe('—')
  })
})
