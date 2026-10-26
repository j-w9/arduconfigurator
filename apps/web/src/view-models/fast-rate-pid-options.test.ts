import { describe, expect, it } from 'vitest'

import { fastRatePidOptions, gyroRateHzFromIndex } from './fast-rate-pid-options'

describe('fastRatePidOptions', () => {
  it('a 4 kHz gyro offers a 4, 2 or 1 kHz PID loop', () => {
    const options = fastRatePidOptions({ gyroRateIndex: 2, loopRateHz: 400, currentDivisor: 1 })
    expect(options?.map((o) => [o.value, o.label])).toEqual([
      [1, '4 kHz'],
      [2, '2 kHz'],
      [4, '1 kHz']
    ])
  })

  it('an 8 kHz gyro adds 8 kHz; a 1 kHz gyro offers only 1 kHz', () => {
    expect(fastRatePidOptions({ gyroRateIndex: 3, loopRateHz: 400, currentDivisor: 1 })?.map((o) => o.label)).toEqual([
      '8 kHz',
      '4 kHz',
      '2 kHz',
      '1 kHz'
    ])
    expect(fastRatePidOptions({ gyroRateIndex: 0, loopRateHz: 400, currentDivisor: 1 })?.map((o) => o.label)).toEqual(['1 kHz'])
  })

  it('keeps a divisor already set outside the list, labelled by its rate', () => {
    const options = fastRatePidOptions({ gyroRateIndex: 2, loopRateHz: 400, currentDivisor: 3 })
    expect(options?.find((o) => o.value === 3)?.label).toBe('1333 Hz')
  })

  it('names the cap when the main loop rate limits the divisor', () => {
    // 2 kHz gyro, 400 Hz loop: cap = 5. Divisor 8 is clamped to 5 = 400 Hz.
    const options = fastRatePidOptions({ gyroRateIndex: 1, loopRateHz: 400, currentDivisor: 8 })
    const eight = options?.find((o) => o.value === 8)
    expect(eight?.label).toBe('400 Hz')
    expect(eight?.description).toContain('capped to 5')
  })

  it('returns nothing without a known gyro rate', () => {
    expect(fastRatePidOptions({ gyroRateIndex: undefined, loopRateHz: 400, currentDivisor: 1 })).toBeUndefined()
    expect(gyroRateHzFromIndex(7)).toBeUndefined()
  })
})
