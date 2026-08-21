import { describe, expect, it } from 'vitest'

import { buildFiltersFromGyro, exceedsDTermCeiling, GYRO_FILTER_PROP_HINTS } from './filters-from-gyro'

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

  it('proposes fixed target filters and pins the yaw error filter at 2 Hz', () => {
    // The target filters smooth the pilot's demand rather than a measured
    // signal, so they do not track the gyro cutoff: 30 Hz whatever it is.
    // (ArduPilot's own pages say gyro/2 here; this is the operator's call, and
    // every row stays editable before staging.) The yaw error filter is
    // ArduPilot's fixed 2 Hz -- Setting the Aircraft Up for Tuning.
    for (const gyro of [40, 80, 120]) {
      const values = byId(gyro)
      // Roll and pitch carry the stick demand, so they sit higher than yaw.
      expect(values.ATC_RAT_RLL_FLTT).toBe(50)
      expect(values.ATC_RAT_PIT_FLTT).toBe(50)
      expect(values.ATC_RAT_YAW_FLTT).toBe(30)
      expect(values.ATC_RAT_YAW_FLTE).toBe(2)
    }
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

describe('GYRO_FILTER_PROP_HINTS', () => {
  it('offers three prop-size starting points', () => {
    // These are this app's numbers, higher than ArduPilot's 80/40/20 table and
    // Mission Planner's curve, aimed at low-noise FPV builds. Pinned so a
    // change to them is a deliberate one.
    expect(GYRO_FILTER_PROP_HINTS.map((hint) => [hint.label, hint.hz])).toEqual([
      ['5 in', 90],
      ['10 in', 60],
      ['15 in', 40]
    ])
  })

  it('derives a sane filter set from each of them', () => {
    for (const hint of GYRO_FILTER_PROP_HINTS) {
      const values = Object.fromEntries(buildFiltersFromGyro(hint.hz).map((row) => [row.id, row.value]))
      expect(values.ATC_RAT_RLL_FLTD).toBe(hint.hz / 2)
      expect(values.ATC_RAT_YAW_FLTD).toBe(hint.hz / 4)
      // The target filters are fixed, so they do not move with the hint.
      expect(values.ATC_RAT_RLL_FLTT).toBe(50)
      // Nothing the helper proposes may land on the wrong side of the ceiling.
      expect(exceedsDTermCeiling('ATC_RAT_RLL_FLTD', values.ATC_RAT_RLL_FLTD, hint.hz)).toBe(false)
    }
  })
})
