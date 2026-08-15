import { describe, expect, it } from 'vitest'

import { buildServoLiveOutput, livePwmForOutput } from './servo-live-output'

describe('buildServoLiveOutput', () => {
  it('places a live value inside its configured range', () => {
    expect(buildServoLiveOutput({ pwm: 1500, min: 1000, max: 2000 })).toMatchObject({
      pwm: 1500,
      fraction: 0.5,
      undriven: false,
      atLimit: false
    })
  })

  it('treats zero as NOT DRIVEN, not as a very low PWM', () => {
    // The distinction that matters: the firmware zero-fills outputs it is not
    // driving. Rendering that as "hard against the minimum" sends someone
    // hunting a range problem that does not exist.
    const result = buildServoLiveOutput({ pwm: 0, min: 1000, max: 2000 })
    expect(result.undriven).toBe(true)
    expect(result.fraction).toBeUndefined()
    expect(result.atLimit).toBe(false)
  })

  it('flags an output sitting on or past a limit', () => {
    expect(buildServoLiveOutput({ pwm: 1000, min: 1000, max: 2000 }).atLimit).toBe(true)
    expect(buildServoLiveOutput({ pwm: 2000, min: 1000, max: 2000 }).atLimit).toBe(true)
    // Beyond the configured range is the case most worth seeing, so it must
    // flag rather than clamp quietly.
    expect(buildServoLiveOutput({ pwm: 2200, min: 1000, max: 2000 })).toMatchObject({
      atLimit: true,
      fraction: 1
    })
    expect(buildServoLiveOutput({ pwm: 1001, min: 1000, max: 2000 }).atLimit).toBe(false)
  })

  it('shows the value but no bar when the range is unknown or degenerate', () => {
    // A bar drawn from a guessed range looks authoritative and would be wrong.
    // Asserted field-by-field: toMatchObject treats an ABSENT key and an
    // explicit undefined as different, so a `fraction: undefined` expectation
    // would fail against an object that simply omits it.
    expect(buildServoLiveOutput({ pwm: 1500 }).pwm).toBe(1500)
    expect(buildServoLiveOutput({ pwm: 1500 }).fraction).toBeUndefined()
    expect(buildServoLiveOutput({ pwm: 1500, min: 1500, max: 1500 }).fraction).toBeUndefined()
    expect(buildServoLiveOutput({ pwm: 1500, min: 2000, max: 1000 }).fraction).toBeUndefined()
  })

  it('reports nothing at all when the output is not being reported', () => {
    expect(buildServoLiveOutput({})).toEqual({ undriven: false, atLimit: false })
    expect(buildServoLiveOutput({ pwm: Number.NaN }).pwm).toBeUndefined()
  })

  it('maps 1-based outputs onto the 0-based live array', () => {
    const pwm = [1100, 1200, 1300]
    expect(livePwmForOutput(pwm, 1)).toBe(1100)
    expect(livePwmForOutput(pwm, 3)).toBe(1300)
    // Past the end is undefined, not 0: "not reported" and "not driven" are
    // different answers and only one is a fault.
    expect(livePwmForOutput(pwm, 4)).toBeUndefined()
    expect(livePwmForOutput(pwm, 0)).toBeUndefined()
  })
})
