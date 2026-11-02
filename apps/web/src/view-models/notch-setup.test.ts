import { describe, expect, it } from 'vitest'

import { buildNotchSetupPlan } from './notch-setup'

const escPlan = { escTelemetry: true, hoverFundamentalHz: 150, hoverThrottle: 0.2, hoverSeconds: 30, notes: [] }
const throttlePlan = { escTelemetry: false, gyroPeakHz: 160, gyroPeakAxis: 'roll', hoverThrottle: 0.2, hoverSeconds: 30, notes: [] }

describe('buildNotchSetupPlan', () => {
  it('ESC telemetry: mode 3, REF 1, floor below the hover frequency and above the gyro filter', () => {
    const plan = buildNotchSetupPlan({ plan: escPlan, liveEscTelemetry: false, gyroFilterHz: 80, hoverThrottle: 0.2, current: {} })
    expect(plan.source).toBe('esc')
    expect(plan.drafts).toEqual({ INS_HNTCH_ENABLE: '1', INS_HNTCH_MODE: '3', INS_HNTCH_REF: '1', INS_HNTCH_FREQ: '120', INS_HNTCH_BW: '60' })
    // 0.8 x 60 Hz would sit under an 80 Hz gyro filter: lifted above it.
    const low = buildNotchSetupPlan({ plan: { ...escPlan, hoverFundamentalHz: 60 }, liveEscTelemetry: false, gyroFilterHz: 80, hoverThrottle: 0.2, current: {} })
    expect(low.drafts.INS_HNTCH_FREQ).toBe('90')
  })

  it('no telemetry: mode 1, REF = hover throttle, FREQ = the hover peak, BW = half', () => {
    const plan = buildNotchSetupPlan({ plan: throttlePlan, liveEscTelemetry: false, gyroFilterHz: 40, hoverThrottle: 0.2, current: {} })
    expect(plan.source).toBe('throttle')
    expect(plan.drafts).toEqual({ INS_HNTCH_ENABLE: '1', INS_HNTCH_MODE: '1', INS_HNTCH_REF: '0.2', INS_HNTCH_FREQ: '160', INS_HNTCH_BW: '80' })
  })

  it('judges the vehicle: a notch set as planned passes every check; a REF of 0 does not track', () => {
    const good = buildNotchSetupPlan({ plan: escPlan, liveEscTelemetry: false, gyroFilterHz: 80, hoverThrottle: 0.2, current: { enable: 1, mode: 3, ref: 1, freq: 120, bw: 60, harmonics: 3, options: 0 } })
    expect(good.checks).toEqual({ enabled: true, referenceRight: true, frequencySane: true, bandwidthSane: true, harmonicsSane: true })
    const untracked = buildNotchSetupPlan({ plan: escPlan, liveEscTelemetry: false, gyroFilterHz: 80, hoverThrottle: 0.2, current: { enable: 1, mode: 3, ref: 0, freq: 120, bw: 60 } })
    expect(untracked.checks.referenceRight).toBe(false)
    const perMotorWide = buildNotchSetupPlan({ plan: escPlan, liveEscTelemetry: false, gyroFilterHz: 80, hoverThrottle: 0.2, current: { enable: 1, mode: 3, ref: 1, freq: 120, bw: 60, options: 2 } })
    expect(perMotorWide.checks.bandwidthSane).toBe(false)
  })

  it('live ESC RPM on the bench counts as a telemetry source before any log', () => {
    const plan = buildNotchSetupPlan({ plan: undefined, liveEscTelemetry: true, gyroFilterHz: 80, hoverThrottle: undefined, current: {} })
    expect(plan.source).toBe('esc')
    expect(plan.drafts.INS_HNTCH_MODE).toBe('3')
    expect(plan.blockers[0]).toMatch(/hover log with ESC telemetry/)
  })
})
