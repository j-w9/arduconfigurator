import { describe, expect, it } from 'vitest'

import { resolveMotorReverseEligibility } from './motor-reverse'

describe('resolveMotorReverseEligibility', () => {
  it('blocks on a non-DShot protocol regardless of ESC type', () => {
    const result = resolveMotorReverseEligibility({ motPwmType: 0, dshotEscType: 1 })
    expect(result.isDShotProtocol).toBe(false)
    expect(result.canReverse).toBe(false)
    expect(result.blockedReason).toMatch(/DShot/i)
  })

  it('blocks on DShot protocol but SERVO_DSHOT_ESC = None (0)', () => {
    const result = resolveMotorReverseEligibility({ motPwmType: 6, dshotEscType: 0 })
    expect(result.isDShotProtocol).toBe(true)
    expect(result.escTypeConfigured).toBe(false)
    expect(result.canReverse).toBe(false)
    expect(result.blockedReason).toMatch(/SERVO_DSHOT_ESC/)
  })

  it('blocks the same way when SERVO_DSHOT_ESC is undefined (param not synced)', () => {
    const result = resolveMotorReverseEligibility({ motPwmType: 6, dshotEscType: undefined })
    expect(result.canReverse).toBe(false)
    expect(result.escTypeConfigured).toBe(false)
  })

  it('allows reversing once both a DShot protocol and a real ESC type are set', () => {
    const result = resolveMotorReverseEligibility({ motPwmType: 6, dshotEscType: 1 })
    expect(result.isDShotProtocol).toBe(true)
    expect(result.escTypeConfigured).toBe(true)
    expect(result.canReverse).toBe(true)
    expect(result.blockedReason).toBeUndefined()
  })

  it.each([4, 5, 6, 7])('treats MOT_PWM_TYPE=%i as a DShot protocol', (motPwmType) => {
    expect(resolveMotorReverseEligibility({ motPwmType, dshotEscType: 1 }).isDShotProtocol).toBe(true)
  })

  it.each([1, 2, 3, 8])('does not treat MOT_PWM_TYPE=%i as DShot', (motPwmType) => {
    expect(resolveMotorReverseEligibility({ motPwmType, dshotEscType: 1 }).isDShotProtocol).toBe(false)
  })
})
