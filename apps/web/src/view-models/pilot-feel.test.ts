import { describe, expect, it } from 'vitest'

import { accelDegS2, inputExpo, matchingChoice, RESPONSE_TC_CHOICES, secondsToRate, stickCurve, yawRateOutrunsAccel } from './pilot-feel'

describe('pilot feel', () => {
  it('input_expo matches AP_Math: full stick is full rate, expo softens the centre', () => {
    expect(inputExpo(1, 0.3)).toBeCloseTo(1)
    expect(inputExpo(0.5, 0)).toBeCloseTo(0.5)
    // (1 - 0.3) * 0.5 / (1 - 0.3 * 0.5) = 0.35 / 0.85
    expect(inputExpo(0.5, 0.3)).toBeCloseTo(0.4118, 3)
    expect(inputExpo(-0.5, 0.3)).toBeCloseTo(-0.4118, 3)
  })

  it('stick curve runs 0 to the max rate', () => {
    const curve = stickCurve(360, 0.3, 11)
    expect(curve[0]).toEqual({ stick: 0, rate: 0 })
    expect(curve[10].rate).toBeCloseTo(360)
  })

  it('accel limits: the old ATC_ACCEL_* are centidegrees', () => {
    expect(accelDegS2('ATC_ACCEL_R_MAX', 110000)).toBe(1100)
    expect(accelDegS2('ATC_ACC_R_MAX', 1100)).toBe(1100)
    expect(accelDegS2('ATC_ACC_R_MAX', 0)).toBeUndefined()
  })

  it('time to full rate, and the documented yaw rule', () => {
    expect(secondsToRate(360, 1440)).toBeCloseTo(0.25)
    expect(yawRateOutrunsAccel(180, 360)).toBe(false) // 0.5 s: the doc's target
    expect(yawRateOutrunsAccel(180, 180)).toBe(true) // 1 s
  })

  it('names a value only when it sits on a choice', () => {
    expect(matchingChoice(RESPONSE_TC_CHOICES, 0.15)?.label).toBe('Medium')
    expect(matchingChoice(RESPONSE_TC_CHOICES, 0.17)).toBeUndefined()
  })
})
