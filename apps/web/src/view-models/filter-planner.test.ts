import { describe, expect, it } from 'vitest'

import { describeNotchOpts, documentedNotchBandwidth, documentedNotchRef } from './filter-planner'

// These are the only rules the Filter Editor applies, so each one is checked
// against what ArduPilot actually documents rather than against itself.

describe('documentedNotchBandwidth', () => {
  it('is half the base frequency', () => {
    // HarmonicNotchFilter.cpp:78, and the throttle-notch setup page.
    expect(documentedNotchBandwidth(100)).toBe(50)
    expect(documentedNotchBandwidth(80)).toBe(40)
  })

  it('suggests nothing without a usable frequency', () => {
    expect(documentedNotchBandwidth(0)).toBeUndefined()
    expect(documentedNotchBandwidth(Number.NaN)).toBeUndefined()
  })
})

describe('documentedNotchRef', () => {
  it('is 1 for RPM and ESC-telemetry tracking', () => {
    // A REF of zero disables dynamic updates entirely, so this is the
    // difference between a notch that tracks and one that only looks set up.
    expect(documentedNotchRef(2)).toBe(1)
    expect(documentedNotchRef(3)).toBe(1)
    expect(documentedNotchRef(5)).toBe(1)
  })

  it('is the hover thrust for throttle mode, and nothing without one', () => {
    expect(documentedNotchRef(1, 0.35)).toBe(0.35)
    // MOT_THST_HOVER is a float32, so the value the vehicle reports for 0.35
    // is not exactly 0.35 -- the button must not offer that noise.
    expect(documentedNotchRef(1, 0.3499999940395355)).toBe(0.35)
    expect(documentedNotchRef(1)).toBeUndefined()
  })

  it('suggests nothing for modes ArduPilot gives no reference for', () => {
    // Fixed and in-flight FFT do not scale from a reference.
    expect(documentedNotchRef(0, 0.35)).toBeUndefined()
    expect(documentedNotchRef(4, 0.35)).toBeUndefined()
  })
})

describe('describeNotchOpts', () => {
  it('reads a real bitmask back as words', () => {
    // 22 = bits 1, 2, 4 per HarmonicNotchFilter.cpp:134 — taken from an actual
    // 15" build's configuration.
    const described = describeNotchOpts(22)
    expect(described).toContain('Multi-Source')
    expect(described).toContain('Update at loop rate')
    expect(described).toContain('Triple notch')
    expect(described).not.toContain('Double notch')
  })

  it('says so when nothing is set', () => {
    expect(describeNotchOpts(0)).toMatch(/No notch options/)
  })
})
