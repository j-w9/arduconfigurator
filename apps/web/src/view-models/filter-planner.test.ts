import { describe, expect, it } from 'vitest'

import {
  buildFilterPlan,
  describeNotchOpts,
  documentedNotchBandwidth,
  documentedNotchRef
} from './filter-planner'

describe('buildFilterPlan', () => {
  it('stages only what the operator actually changed', () => {
    const plan = buildFilterPlan([
      { id: 'ATC_RAT_RLL_FLTD', liveValue: 20, input: '40' },
      { id: 'ATC_RAT_PIT_FLTD', liveValue: 20, input: '20' },
      { id: 'ATC_RAT_YAW_FLTD', liveValue: 0, input: '' }
    ])
    expect(plan.values).toEqual([{ id: 'ATC_RAT_RLL_FLTD', value: 40 }])
  })

  it('invents nothing — a blank field stages nothing', () => {
    // The whole point of the rework: no ratio is applied behind the operator's
    // back, so an untouched field produces no write.
    expect(buildFilterPlan([{ id: 'INS_ACCEL_FILTER', input: '' }]).values).toEqual([])
  })

  it('reports an unparseable entry rather than skipping it silently', () => {
    const plan = buildFilterPlan([{ id: 'ATC_RAT_RLL_FLTD', input: 'abc' }])
    expect(plan.values).toEqual([])
    expect(plan.errors[0]).toMatch(/not a number/)
  })

  it('warns when the notch is enabled with a reference of zero', () => {
    // ArduPilot: "a reference value of zero disables dynamic updates". The
    // notch looks configured and tracks nothing.
    const plan = buildFilterPlan([
      { id: 'INS_HNTCH_ENABLE', liveValue: 0, input: '1' },
      { id: 'INS_HNTCH_REF', liveValue: 1, input: '0' }
    ])
    expect(plan.warnings.some((warning) => /disabling dynamic updates/.test(warning))).toBe(true)
  })

  it('warns rather than refuses on an implausibly high notch centre', () => {
    // Reported, not enforced — the operator may be running a faster gyro rate.
    const plan = buildFilterPlan([{ id: 'INS_HNTCH_FREQ', liveValue: 40, input: '600' }])
    expect(plan.values).toHaveLength(1)
    expect(plan.warnings.some((warning) => /below half the gyro backend rate/.test(warning))).toBe(true)
  })
})

describe('the documented suggestions', () => {
  it('gives half the centre frequency as the bandwidth', () => {
    // HarmonicNotchFilter.cpp:78 and the throttle-notch setup page.
    expect(documentedNotchBandwidth(100)).toBe(50)
    expect(documentedNotchBandwidth(0)).toBeUndefined()
  })

  it('gives REF = 1 for RPM and ESC-telemetry tracking', () => {
    expect(documentedNotchRef(2)).toBe(1)
    expect(documentedNotchRef(3)).toBe(1)
    expect(documentedNotchRef(5)).toBe(1)
  })

  it('gives REF = hover thrust for throttle mode, and nothing without it', () => {
    expect(documentedNotchRef(1, 0.32)).toBe(0.32)
    expect(documentedNotchRef(1)).toBeUndefined()
  })

  it('suggests no REF where ArduPilot documents none', () => {
    // Fixed and in-flight FFT do not scale from a reference.
    expect(documentedNotchRef(0, 0.3)).toBeUndefined()
    expect(documentedNotchRef(4, 0.3)).toBeUndefined()
  })

  it('names the option bits', () => {
    // 22 = bits 1, 2, 4 per HarmonicNotchFilter.cpp:134.
    const described = describeNotchOpts(22)
    expect(described).toContain('Multi-Source')
    expect(described).toContain('Update at loop rate')
    expect(described).toContain('Triple notch')
    expect(describeNotchOpts(0)).toMatch(/No notch options/)
  })
})
