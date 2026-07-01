import { describe, expect, it } from 'vitest'

import {
  evaluateRcDirection,
  latchRcDirection,
  RC_DIRECTION_MOVE_THRESHOLD_US,
  type RcDirectionResult
} from './receiver-direction-check'

const CENTERED = { trim: 1500, min: 1000, max: 2000, reversed: false }

describe('evaluateRcDirection (centred axes)', () => {
  it('is idle until the stick clearly leaves its trim', () => {
    expect(evaluateRcDirection({ axisId: 'roll', pwm: 1500, ...CENTERED })).toBe('idle')
    expect(
      evaluateRcDirection({ axisId: 'roll', pwm: 1500 + RC_DIRECTION_MOVE_THRESHOLD_US - 1, ...CENTERED })
    ).toBe('idle')
  })

  it('is idle when the channel has no telemetry', () => {
    expect(evaluateRcDirection({ axisId: 'roll', pwm: undefined, ...CENTERED })).toBe('idle')
  })

  it('roll-right reading high is correct (not reversed) and reversed when the channel is inverted', () => {
    expect(evaluateRcDirection({ axisId: 'roll', pwm: 1900, ...CENTERED, reversed: false })).toBe('correct')
    expect(evaluateRcDirection({ axisId: 'roll', pwm: 1900, ...CENTERED, reversed: true })).toBe('reversed')
  })

  it('roll-right reading low means the channel needs reversing (and is correct once reversed)', () => {
    expect(evaluateRcDirection({ axisId: 'roll', pwm: 1100, ...CENTERED, reversed: false })).toBe('reversed')
    expect(evaluateRcDirection({ axisId: 'roll', pwm: 1100, ...CENTERED, reversed: true })).toBe('correct')
  })

  it('pitch-up is the classic Mode-2 case: stick-back reads low, so reversed=1 is correct', () => {
    // Mode-2 TX: pulling back (pitch up) drives the wire LOW.
    expect(evaluateRcDirection({ axisId: 'pitch', pwm: 1100, ...CENTERED, reversed: true })).toBe('correct')
    expect(evaluateRcDirection({ axisId: 'pitch', pwm: 1100, ...CENTERED, reversed: false })).toBe('reversed')
  })

  it('yaw-right matches the roll sign convention', () => {
    expect(evaluateRcDirection({ axisId: 'yaw', pwm: 1900, ...CENTERED, reversed: false })).toBe('correct')
    expect(evaluateRcDirection({ axisId: 'yaw', pwm: 1100, ...CENTERED, reversed: false })).toBe('reversed')
  })
})

describe('evaluateRcDirection (throttle, measured from a resting baseline)', () => {
  it('is idle with no captured baseline — cannot tell rest from a reversed-radio push', () => {
    expect(evaluateRcDirection({ axisId: 'throttle', pwm: 1100, ...CENTERED })).toBe('idle')
    expect(evaluateRcDirection({ axisId: 'throttle', pwm: 1900, ...CENTERED })).toBe('idle')
  })

  it('is idle at rest, so a resting (low) throttle NEVER falsely reads reversed (the flyaway bug)', () => {
    // Regression: a fixed mid-range (1500) reference read a resting ~1100 throttle
    // as a decisive "down" movement and reported it reversed, pointing the operator
    // at a hazardous RC3_REVERSED=1 write. With a baseline, rest is simply idle.
    expect(evaluateRcDirection({ axisId: 'throttle', pwm: 1100, ...CENTERED, restReference: 1100 })).toBe('idle')
  })

  it('normal wire (rests low): pushing up reads correct; RC3_REVERSED=1 inverts it', () => {
    const base = { axisId: 'throttle' as const, ...CENTERED, restReference: 1100 }
    expect(evaluateRcDirection({ ...base, pwm: 1900, reversed: false })).toBe('correct')
    expect(evaluateRcDirection({ ...base, pwm: 1900, reversed: true })).toBe('reversed')
  })

  it('reversed wire (rests high): the up-push drops the pwm — flagged reversed, correct once RC3_REVERSED=1', () => {
    const base = { axisId: 'throttle' as const, ...CENTERED, restReference: 1900 }
    expect(evaluateRcDirection({ ...base, pwm: 1100, reversed: false })).toBe('reversed')
    expect(evaluateRcDirection({ ...base, pwm: 1100, reversed: true })).toBe('correct')
  })
})

describe('latchRcDirection', () => {
  it('keeps the last decisive verdict through a momentary idle (stick re-centred)', () => {
    const seq: RcDirectionResult[] = ['idle', 'reversed', 'idle', 'idle']
    expect(seq.reduce(latchRcDirection, 'idle' as RcDirectionResult)).toBe('reversed')
  })

  it('lets a later decisive sample supersede the previous one (after a reverse toggle)', () => {
    expect(latchRcDirection('reversed', 'correct')).toBe('correct')
  })
})
