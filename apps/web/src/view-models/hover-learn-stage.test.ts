import { describe, expect, it } from 'vitest'
import type { ConfiguratorSnapshot } from '@arduconfig/ardupilot-core'

import { MOT_THST_HOVER_DEFAULT, deriveHoverLearnState } from './hover-learn-stage'

function snapshot(
  values: Record<string, number>,
  vehicle?: { armed: boolean; flightMode: string }
): ConfiguratorSnapshot {
  return {
    parameters: Object.entries(values).map(([id, value]) => ({ id, value })),
    vehicle
  } as unknown as ConfiguratorSnapshot
}

/** A fork board that supports the sequence but has flown nothing. */
const FRESH = { ACC_ZBIAS_LEARN: 0, MOT_HOVER_LEARN: 2, MOT_THST_HOVER: MOT_THST_HOVER_DEFAULT }

describe('deriveHoverLearnState', () => {
  it('reads a learned hover throttle as flight 1 done', () => {
    expect(deriveHoverLearnState(snapshot({ ...FRESH, MOT_THST_HOVER: 0.42 })).stage).toBe(
      'flight-1-review'
    )
  })

  it('reads an untouched hover throttle as flight 1 still to fly', () => {
    expect(deriveHoverLearnState(snapshot(FRESH)).stage).toBe('flight-1')
  })

  // The old behaviour sent the operator up for a flight on the strength of a
  // parameter it had never seen: an absent MOT_THST_HOVER equals the default
  // under `=== undefined ? ... : value !== default` arithmetic.
  it('does not claim flight 1 is unflown when MOT_THST_HOVER was never reported', () => {
    const state = deriveHoverLearnState(snapshot({ ACC_ZBIAS_LEARN: 0, MOT_HOVER_LEARN: 2 }))
    expect(state.stage).toBe('unknown')
    expect(state.hoverThrottle).toBeUndefined()
  })

  it('still reports flight 2 for a vehicle past flight 1 with no hover throttle reported', () => {
    expect(deriveHoverLearnState(snapshot({ ACC_ZBIAS_LEARN: 1 })).stage).toBe('flight-2')
  })

  it('flags a mode that can learn no hover throttle, but only in the air', () => {
    const flying = (mode: string): string | undefined =>
      deriveHoverLearnState(snapshot(FRESH, { armed: true, flightMode: mode })).blindMode

    expect(flying('Stabilize')).toBe('Stabilize')
    expect(flying('Acro')).toBe('Acro')
    expect(flying('Drift')).toBe('Drift')
    expect(flying('AltHold')).toBeUndefined()
    expect(flying('Loiter')).toBeUndefined()

    // Disarmed, the selected mode says nothing — every bench copter sits in
    // whatever the switch happens to select.
    expect(
      deriveHoverLearnState(snapshot(FRESH, { armed: false, flightMode: 'Stabilize' })).blindMode
    ).toBeUndefined()
    expect(deriveHoverLearnState(snapshot(FRESH)).blindMode).toBeUndefined()
  })

  it('hides itself on firmware without the fork Z-bias parameter', () => {
    expect(deriveHoverLearnState(snapshot({ MOT_THST_HOVER: 0.42 })).supported).toBe(false)
  })
})
