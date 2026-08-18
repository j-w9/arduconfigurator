import { describe, expect, it } from 'vitest'

import { buildFiltersFromGyro, exceedsDTermCeiling } from './filters-from-gyro'

const byId = (gyro: number): Record<string, number> =>
  Object.fromEntries(buildFiltersFromGyro(gyro).map((row) => [row.id, row.value]))

describe('buildFiltersFromGyro', () => {
  it('halves the gyro cutoff for roll and pitch D, quarters it for yaw', () => {
    // ArduPilot, Aggressive Rate Loop Tuning: "each axis' ATC_RAT_xxx_FLTD
    // should be INS_GYRO_FILTER/2 on roll and pitch and INS_GYRO_FILTER/4 on
    // yaw."
    const values = byId(40)
    expect(values.ATC_RAT_RLL_FLTD).toBe(20)
    expect(values.ATC_RAT_PIT_FLTD).toBe(20)
    expect(values.ATC_RAT_YAW_FLTD).toBe(10)
  })

  it('halves it for every target filter and pins the yaw error filter at 2 Hz', () => {
    // ArduPilot, Setting the Aircraft Up for Tuning.
    const values = byId(80)
    expect(values.ATC_RAT_RLL_FLTT).toBe(40)
    expect(values.ATC_RAT_PIT_FLTT).toBe(40)
    expect(values.ATC_RAT_YAW_FLTT).toBe(40)
    expect(values.ATC_RAT_YAW_FLTE).toBe(2)
  })

  it('passes the entered cutoff through as INS_GYRO_FILTER', () => {
    expect(byId(20).INS_GYRO_FILTER).toBe(20)
  })

  it('proposes nothing this app invented', () => {
    // Roll/pitch FLTE is deliberately absent: Mission Planner zeroes it, the
    // ArduPilot docs do not say to, and an invented value has no business
    // being staged to a flight controller.
    const ids = buildFiltersFromGyro(40).map((row) => row.id)
    expect(ids).not.toContain('ATC_RAT_RLL_FLTE')
    expect(ids).not.toContain('ATC_RAT_PIT_FLTE')
    expect(ids).not.toContain('INS_ACCEL_FILTER')
  })

  it('keeps one decimal for a cutoff that does not quarter evenly', () => {
    expect(byId(30).ATC_RAT_YAW_FLTD).toBe(7.5)
    expect(byId(35).ATC_RAT_YAW_FLTD).toBe(8.8)
  })

  it('returns nothing for a value that is not a usable cutoff', () => {
    expect(buildFiltersFromGyro(0)).toEqual([])
    expect(buildFiltersFromGyro(-10)).toEqual([])
    expect(buildFiltersFromGyro(Number.NaN)).toEqual([])
  })
})

describe('exceedsDTermCeiling', () => {
  it('flags a D filter above 0.75 x the gyro cutoff', () => {
    // "Setting it above 0.75 * INS_GYRO_FILTER is not recommended."
    expect(exceedsDTermCeiling('ATC_RAT_RLL_FLTD', 31, 40)).toBe(true)
    expect(exceedsDTermCeiling('ATC_RAT_RLL_FLTD', 30, 40)).toBe(false)
  })

  it('applies only to D filters', () => {
    expect(exceedsDTermCeiling('ATC_RAT_RLL_FLTT', 39, 40)).toBe(false)
    expect(exceedsDTermCeiling('INS_GYRO_FILTER', 40, 40)).toBe(false)
  })

  it('says nothing without a usable gyro cutoff', () => {
    expect(exceedsDTermCeiling('ATC_RAT_RLL_FLTD', 30, 0)).toBe(false)
    expect(exceedsDTermCeiling('ATC_RAT_RLL_FLTD', 30, Number.NaN)).toBe(false)
  })
})
