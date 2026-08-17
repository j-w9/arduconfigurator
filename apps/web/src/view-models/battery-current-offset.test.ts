import { describe, expect, it } from 'vitest'

import { computeCurrentOffset, computeCurrentPerVolt } from './battery-current-offset'

describe('computeCurrentOffset', () => {
  it('reduces to plain zeroing when the meter reads 0 A', () => {
    // The old behaviour, preserved exactly: offset' = offset + reported/perVolt.
    const result = computeCurrentOffset({ offsetV: 0.5, perVolt: 20, reportedA: 2, actualA: 0 })
    expect(result).toMatchObject({ ok: true, offsetV: 0.6, shiftA: 2 })
  })

  it('calibrates against a real, non-zero meter reading', () => {
    // The case the old guard refused outright: a bench aircraft genuinely
    // drawing 0.4 A while the sensor claims 1.4 A.
    const result = computeCurrentOffset({ offsetV: 0.5, perVolt: 20, reportedA: 1.4, actualA: 0.4 })
    expect(result.ok).toBe(true)
    expect(result.ok === true && result.offsetV).toBeCloseTo(0.55, 10)
    expect(result.ok === true && result.shiftA).toBeCloseTo(1.0, 10)
  })

  it('corrects in the other direction when the sensor under-reads', () => {
    const result = computeCurrentOffset({ offsetV: 0.5, perVolt: 20, reportedA: 0.2, actualA: 1.2 })
    expect(result.ok === true && result.offsetV).toBeCloseTo(0.45, 10)
  })

  it('is a no-op when the sensor already agrees with the meter', () => {
    const result = computeCurrentOffset({ offsetV: 0.5, perVolt: 20, reportedA: 0.4, actualA: 0.4 })
    expect(result.ok === true && result.offsetV).toBeCloseTo(0.5, 10)
    expect(result.ok === true && result.shiftA).toBeCloseTo(0, 10)
  })

  it('refuses a per-volt that cannot be inverted', () => {
    // Dividing by this converts an amp error into a volt shift; zero or
    // negative makes the sensor model meaningless, not merely imprecise.
    expect(computeCurrentOffset({ offsetV: 0.5, perVolt: 0, reportedA: 1, actualA: 0 }).ok).toBe(false)
    expect(computeCurrentOffset({ offsetV: 0.5, perVolt: -3, reportedA: 1, actualA: 0 }).ok).toBe(false)
  })

  it('refuses a negative or unparseable meter reading', () => {
    expect(computeCurrentOffset({ offsetV: 0.5, perVolt: 20, reportedA: 1, actualA: -1 }).ok).toBe(false)
    expect(computeCurrentOffset({ offsetV: 0.5, perVolt: 20, reportedA: 1, actualA: Number.NaN }).ok).toBe(false)
  })

  it('waits rather than guessing when telemetry or parameters are missing', () => {
    expect(computeCurrentOffset({ perVolt: 20, reportedA: 1, actualA: 0 }).ok).toBe(false)
    expect(computeCurrentOffset({ offsetV: 0.5, reportedA: 1, actualA: 0 }).ok).toBe(false)
    expect(computeCurrentOffset({ offsetV: 0.5, perVolt: 20, actualA: 0 }).ok).toBe(false)
  })
})

describe('computeCurrentPerVolt', () => {
  it('scales by the ratio of measured to reported', () => {
    expect(computeCurrentPerVolt({ perVolt: 20, reportedA: 10, measuredA: 12 })).toEqual({ ok: true, perVolt: 24 })
  })

  it('refuses when there is no reported current to scale against', () => {
    // The bug this guards: the reported value used to be read LIVE at click
    // time. Once the motors stopped it fell to ~0, so the ratio was noise and
    // the button went dead unless the field was re-edited mid-spin.
    const result = computeCurrentPerVolt({ perVolt: 20, reportedA: 0, measuredA: 12 })
    expect(result).toMatchObject({ ok: false })
    expect(result.ok === false && result.reason).toMatch(/load step/i)
  })

  it('refuses a missing or non-positive meter reading', () => {
    expect(computeCurrentPerVolt({ perVolt: 20, reportedA: 10, measuredA: 0 }).ok).toBe(false)
    expect(computeCurrentPerVolt({ perVolt: 20, reportedA: 10, measuredA: Number.NaN }).ok).toBe(false)
  })
})
