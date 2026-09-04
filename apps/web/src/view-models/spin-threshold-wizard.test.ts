import { describe, expect, it } from 'vitest'

import {
  SPIN_ARM_MAX,
  SPIN_WIZARD_START,
  confirmSpinWizard,
  createIdleSpinWizardState,
  deriveSpinThresholds,
  describeSpinThresholdProblem,
  spinValueToThrottlePercent,
  setSpinWizardValue,
  startSpinWizard
} from './spin-threshold-wizard'

/** Climb until the operator says every motor is turning at `breakAway`. */
const climbTo = (breakAway: number) =>
  confirmSpinWizard(setSpinWizardValue(startSpinWizard(), breakAway))

describe('spin threshold wizard', () => {
  it('starts below any real break-away point', () => {
    expect(createIdleSpinWizardState().currentValue).toBe(SPIN_WIZARD_START)
    expect(startSpinWizard()).toMatchObject({ status: 'stepping', currentValue: 0.01 })
  })

  it('takes the value the operator drags to', () => {
    expect(setSpinWizardValue(startSpinWizard(), 0.07).currentValue).toBe(0.07)
  })

  it('rounds to the parameters own increment rather than carrying slider noise', () => {
    expect(setSpinWizardValue(startSpinWizard(), 0.0734).currentValue).toBe(0.07)
  })

  it('adds margin twice: once for ARM, again for MIN', () => {
    const state = climbTo(0.06)
    expect(state.observedValue).toBe(0.06)
    expect(deriveSpinThresholds(state.observedValue!)).toMatchObject({
      spinArm: 0.09,
      spinMin: 0.12,
      clamped: false
    })
  })

  it('always yields ARM below MIN, which is what firmware requires', () => {
    for (let observed = 0.01; observed <= 0.2; observed = Math.round((observed + 0.01) * 100) / 100) {
      const { spinArm, spinMin } = deriveSpinThresholds(observed)
      expect(spinArm, `observed ${observed}`).toBeLessThan(spinMin)
      expect(describeSpinThresholdProblem(spinArm, spinMin)).toBeUndefined()
    }
  })

  it('clamps to the firmware ranges and says it did', () => {
    // A build breaking away at 0.19 would otherwise want ARM 0.22 / MIN 0.25.
    const r = deriveSpinThresholds(0.19)
    expect(r.spinArm).toBeLessThanOrEqual(SPIN_ARM_MAX)
    expect(r.clamped).toBe(true)
  })

  it('clamps the slider to what firmware will accept', () => {
    expect(setSpinWizardValue(startSpinWizard(), 0.9).currentValue).toBe(SPIN_ARM_MAX)
    expect(setSpinWizardValue(startSpinWizard(), -1).currentValue).toBe(0)
  })

  it('rejects an edited pair firmware would refuse to arm on', () => {
    expect(describeSpinThresholdProblem(0.12, 0.09)).toMatch(/must stay below/)
    expect(describeSpinThresholdProblem(0.10, 0.10)).toMatch(/must stay below/)
    expect(describeSpinThresholdProblem(0.3, 0.35)).toMatch(/MOT_SPIN_ARM must be between/)
    expect(describeSpinThresholdProblem(0.05, 0.3)).toMatch(/MOT_SPIN_MIN must be between/)
    expect(describeSpinThresholdProblem(0.05, 0.09)).toBeUndefined()
  })

  it('commands the motor test on the same scale the parameters use', () => {
    // motor_test.cpp maps THROTTLE_PERCENT linearly across pwm_min..pwm_max,
    // which is the normalised range these parameters express.
    expect(spinValueToThrottlePercent(0.01)).toBe(1)
    expect(spinValueToThrottlePercent(0.07)).toBe(7)
    expect(spinValueToThrottlePercent(0.2)).toBe(20)
  })
})
