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

describe('evaluateRcDirection (throttle, measured from mid-range)', () => {
  it('throttle-up reading high is correct, and reversed inverts that', () => {
    expect(evaluateRcDirection({ axisId: 'throttle', pwm: 1900, ...CENTERED, reversed: false })).toBe('correct')
    expect(evaluateRcDirection({ axisId: 'throttle', pwm: 1900, ...CENTERED, reversed: true })).toBe('reversed')
  })

  it('throttle-up reading low needs reversing (correct once reversed)', () => {
    expect(evaluateRcDirection({ axisId: 'throttle', pwm: 1100, ...CENTERED, reversed: false })).toBe('reversed')
    expect(evaluateRcDirection({ axisId: 'throttle', pwm: 1100, ...CENTERED, reversed: true })).toBe('correct')
  })

  it('uses mid-range, not trim, so an off-centre throttle trim does not skew it', () => {
    // trim deliberately near min; mid-range is 1500, pwm 1700 is clearly "up".
    expect(evaluateRcDirection({ axisId: 'throttle', pwm: 1700, trim: 1100, min: 1000, max: 2000, reversed: false })).toBe(
      'correct'
    )
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
