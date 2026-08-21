import { describe, expect, it } from 'vitest'

import {
  BATTERY_CHEMISTRIES,
  buildInitialTuneParameters,
  roundTo,
  type InitialTuneInputs
} from './initial-tune-parameters'

// The point of these is AGREEMENT WITH MISSION PLANNER, not internal
// consistency. Expected values are worked from the coefficients in
// ConfigInitialParams.cs by hand rather than captured from this
// implementation's own output, because a snapshot of the code under test
// proves only that it did not change — not that it was right.

const base: InitialTuneInputs = {
  propSizeInches: 9,
  batteryCells: 4,
  chemistry: 'LiPo'
}

const value = (result: ReturnType<typeof buildInitialTuneParameters>, id: string): number | undefined =>
  result.parameters.find((parameter) => parameter.id === id)?.value

describe('buildInitialTuneParameters', () => {
  it("matches Mission Planner's defaults for a 9in 4S LiPo", () => {
    // Mission Planner opens on exactly these (Activate(), :56-57), so this is
    // the case most users will actually see.
    const result = buildInitialTuneParameters(base)

    // -900*9 + 36000 = 27900, already a round hundred.
    expect(value(result, 'ATC_ACCEL_Y_MAX')).toBe(27900)
    // 0.5 * 27900 / 4500
    expect(value(result, 'ACRO_Y_RATE')).toBeCloseTo(3.1 * 45, 6)
    // 289.22 * 9^-0.838 = 46.03... -> 46
    expect(value(result, 'INS_GYRO_FILTER')).toBe(46)
    // max(10, 46/2)
    expect(value(result, 'ATC_RAT_PIT_FLTD')).toBe(23)
    expect(value(result, 'ATC_RAT_PIT_FLTT')).toBe(23)
    // 0.15686*ln(9) + 0.23693 = 0.5816... -> 0.58
    expect(value(result, 'MOT_THST_EXPO')).toBe(0.58)
    // 4S LiPo: 4.2*4 and 3.3*4
    expect(value(result, 'MOT_BAT_VOLT_MAX')).toBeCloseTo(16.8, 6)
    expect(value(result, 'MOT_BAT_VOLT_MIN')).toBeCloseTo(13.2, 6)
    // (4-1)*0.1 + (3.3+0.3)*4 = 0.3 + 14.4
    expect(value(result, 'BATT_ARM_VOLT')).toBeCloseTo(14.7, 6)
    // (3.3+0.2)*4
    expect(value(result, 'BATT_CRT_VOLT')).toBeCloseTo(14.0, 6)
    expect(value(result, 'BATT_LOW_VOLT')).toBeCloseTo(14.4, 6)
  })

  it('lowers the gyro filter as props get bigger', () => {
    // The single most important behaviour: a 5in racer and a 22in cinelifter
    // must not be filtered the same. 289.22 * p^-0.838 is monotonically
    // decreasing, and the floor is 20 Hz.
    const five = value(buildInitialTuneParameters({ ...base, propSizeInches: 5 }), 'INS_GYRO_FILTER')!
    const nine = value(buildInitialTuneParameters(base), 'INS_GYRO_FILTER')!
    const twentyTwo = value(buildInitialTuneParameters({ ...base, propSizeInches: 22 }), 'INS_GYRO_FILTER')!
    expect(five).toBeGreaterThan(nine)
    expect(nine).toBeGreaterThan(twentyTwo)
    expect(twentyTwo).toBeGreaterThanOrEqual(20)
  })

  it('holds the documented floors instead of running off the end of the fits', () => {
    // Both accel limits are fits that leave the sensible range at large props,
    // and the max() floors are the only thing stopping them.
    //
    // They bottom out at very different points, which is worth knowing before
    // trusting either far from a normal airframe. The yaw fit is linear and
    // crosses zero at 40in. The pitch fit is a CUBIC that decays slowly, is
    // still at ~14600 by 40in, briefly flattens (13400 at 50in), and only
    // falls under the floor near 56in. Outside roughly 5-25in neither is a
    // model of anything — they are curve fits over the props people fly.
    const fortyInch = buildInitialTuneParameters({ ...base, propSizeInches: 40 })
    expect(value(fortyInch, 'ATC_ACCEL_Y_MAX')).toBe(8000)
    expect(value(fortyInch, 'INS_GYRO_FILTER')).toBe(20)

    const absurd = buildInitialTuneParameters({ ...base, propSizeInches: 60 })
    expect(value(absurd, 'ATC_ACCEL_P_MAX')).toBe(10000)
    expect(value(absurd, 'ATC_ACCEL_Y_MAX')).toBe(8000)
  })

  it('keeps the accel limits positive across every realistic prop size', () => {
    // The floors exist so a big airframe never gets a zero or negative
    // acceleration limit, which would be an unflyable vehicle rather than a
    // badly tuned one.
    for (const propSizeInches of [3, 5, 7, 9, 12, 15, 18, 22, 26, 30]) {
      const result = buildInitialTuneParameters({ ...base, propSizeInches })
      expect(value(result, 'ATC_ACCEL_P_MAX')!, `${propSizeInches}in pitch`).toBeGreaterThanOrEqual(10000)
      expect(value(result, 'ATC_ACCEL_Y_MAX')!, `${propSizeInches}in yaw`).toBeGreaterThanOrEqual(8000)
      expect(value(result, 'INS_GYRO_FILTER')!, `${propSizeInches}in gyro`).toBeGreaterThanOrEqual(20)
    }
  })

  it('caps thrust expo at 0.80 however large the prop', () => {
    expect(value(buildInitialTuneParameters({ ...base, propSizeInches: 60 }), 'MOT_THST_EXPO')).toBe(0.8)
  })

  it('gives T-Motor ESCs a flat expo and their PWM range', () => {
    // The override lands AFTER the curve fit, so it must win rather than be
    // averaged with it.
    const result = buildInitialTuneParameters({ ...base, tmotorEscs: true })
    expect(value(result, 'MOT_THST_EXPO')).toBe(0.2)
    expect(value(result, 'MOT_PWM_MIN')).toBe(1100)
    expect(value(result, 'MOT_PWM_MAX')).toBe(1940)
  })

  it('rescales the acceleration limits by 100 on firmware that renamed them', () => {
    // The rename came with a unit change. Getting this wrong is a 100x error
    // on an acceleration limit, not a cosmetic difference.
    const renamed = buildInitialTuneParameters({ ...base, hasAccelPMax: false })
    expect(value(renamed, 'ATC_ACCEL_P_MAX')).toBeUndefined()
    expect(value(renamed, 'ATC_ACC_P_MAX')).toBe(value(buildInitialTuneParameters(base), 'ATC_ACCEL_P_MAX')! / 100)
  })

  it('uses the single-filter names on 3.x, with yaw taking the error filter', () => {
    const old = buildInitialTuneParameters({ ...base, firmwareMajor: 3 })
    expect(value(old, 'ATC_RAT_PIT_FILT')).toBe(23)
    // Deliberately 2, not 0 — 3.x's single FILT is the error filter, so it
    // takes FLTE's value rather than FLTD's.
    expect(value(old, 'ATC_RAT_YAW_FILT')).toBe(2)
    expect(value(old, 'ATC_RAT_PIT_FLTD')).toBeUndefined()
  })

  it('prefixes a QuadPlane Q_A/Q_M and leaves the acro yaw rate alone', () => {
    const qp = buildInitialTuneParameters({ ...base, quadplane: true })
    expect(value(qp, 'Q_A_RAT_PIT_FLTD')).toBe(23)
    expect(value(qp, 'Q_M_THST_EXPO')).toBe(0.58)
    expect(value(qp, 'ATC_RAT_PIT_FLTD')).toBeUndefined()
    // The acro yaw setting is unprefixed in Mission Planner for every vehicle.
    expect(value(qp, 'ACRO_Y_RATE')).toBeCloseTo(3.1 * 45, 6)
  })

  it('never stages a rate PID gain', () => {
    // The line this feature must not cross. Prop diameter says nothing about
    // P, I or D, and inventing them is how a first flight ends badly.
    const ids = buildInitialTuneParameters({ ...base, suggestedSafety: true }).parameters.map((p) => p.id)
    for (const id of ids) {
      expect(id).not.toMatch(/_RAT_(RLL|PIT|YAW)_(P|I|D)$/)
    }
  })

  it('adds the safety block only when asked, and never to a QuadPlane', () => {
    expect(value(buildInitialTuneParameters(base), 'FENCE_ENABLE')).toBeUndefined()
    expect(value(buildInitialTuneParameters({ ...base, suggestedSafety: true }), 'FENCE_ENABLE')).toBe(1)
    // Mission Planner gates this on "not Plane".
    expect(
      value(buildInitialTuneParameters({ ...base, suggestedSafety: true, quadplane: true }), 'FENCE_ENABLE')
    ).toBeUndefined()
    // And on 4.x.
    expect(
      value(buildInitialTuneParameters({ ...base, suggestedSafety: true, firmwareMajor: 3 }), 'FENCE_ENABLE')
    ).toBeUndefined()
  })

  it('carries the chemistry through to the voltage points', () => {
    const ion = buildInitialTuneParameters({ ...base, chemistry: 'Li-ion', batteryCells: 6 })
    expect(value(ion, 'MOT_BAT_VOLT_MAX')).toBeCloseTo(BATTERY_CHEMISTRIES['Li-ion'].maxCellV * 6, 6)
    expect(value(ion, 'MOT_BAT_VOLT_MIN')).toBeCloseTo(BATTERY_CHEMISTRIES['Li-ion'].minCellV * 6, 6)
    const hv = buildInitialTuneParameters({ ...base, chemistry: 'LiPo HV' })
    expect(value(hv, 'MOT_BAT_VOLT_MAX')).toBeCloseTo(4.35 * 4, 6)
  })

  it('uses real cell voltages for the two Li-ion chemistries', () => {
    // Mission Planner had Li-ion at 4.1 V / 2.8 V per cell. A Li-ion cell
    // charges to 4.2 V (4.35 V for the HV variant) and runs down to 2.7 V;
    // these feed MOT_BAT_VOLT_MAX/MIN, which scale thrust compensation across
    // the pack, so being 0.1 V/cell low is not cosmetic.
    const ion = buildInitialTuneParameters({ ...base, chemistry: 'Li-ion', batteryCells: 6 })
    expect(value(ion, 'MOT_BAT_VOLT_MAX')).toBeCloseTo(25.2, 6)
    expect(value(ion, 'MOT_BAT_VOLT_MIN')).toBeCloseTo(16.2, 6)

    const ionHv = buildInitialTuneParameters({ ...base, chemistry: 'Li-ion HV', batteryCells: 6 })
    expect(value(ionHv, 'MOT_BAT_VOLT_MAX')).toBeCloseTo(4.35 * 6, 6)
    expect(value(ionHv, 'MOT_BAT_VOLT_MIN')).toBeCloseTo(16.2, 6)

    // Both HV variants charge higher than their standard counterparts, which
    // is the entire reason for offering them separately.
    expect(BATTERY_CHEMISTRIES['LiPo HV'].maxCellV).toBeGreaterThan(BATTERY_CHEMISTRIES.LiPo.maxCellV)
    expect(BATTERY_CHEMISTRIES['Li-ion HV'].maxCellV).toBeGreaterThan(BATTERY_CHEMISTRIES['Li-ion'].maxCellV)
  })

  it('stages ACRO_Y_RATE rather than the parameter 4.2 removed', () => {
    // ArduCopter converts ACRO_YAW_P to ACRO_Y_RATE with a x45 factor
    // (Parameters.cpp acro_rpy_conversion_info). Staging the old name against
    // modern firmware produced a row the vehicle rejected, and one invalid row
    // blocks the whole batch.
    const modern = buildInitialTuneParameters(base)
    expect(value(modern, 'ACRO_YAW_P')).toBeUndefined()
    expect(value(modern, 'ACRO_Y_RATE')).toBeCloseTo(3.1 * 45, 6)

    // A vehicle that really does have the old parameter still gets it.
    const old = buildInitialTuneParameters({ ...base, hasAcroYawP: true })
    expect(value(old, 'ACRO_YAW_P')).toBeCloseTo(3.1, 10)
    expect(value(old, 'ACRO_Y_RATE')).toBeUndefined()
  })

  it('filters yaw D at a quarter of the gyro cutoff rather than switching it off', () => {
    // Mission Planner writes 0 here. ArduPilot's Aggressive Rate Loop Tuning
    // page says gyro/4 on yaw -- filtered harder than roll and pitch, not
    // disabled -- and a 0 also disagreed with what the Filters tab derives from
    // the same cutoff.
    const result = buildInitialTuneParameters({ ...base, propSizeInches: 9 })
    const gyro = value(result, 'INS_GYRO_FILTER')!
    expect(value(result, 'ATC_RAT_YAW_FLTD')).toBeCloseTo(gyro / 4, 6)
    expect(value(result, 'ATC_RAT_RLL_FLTD')).toBeCloseTo(gyro / 2, 6)
  })

  it('refuses nonsense inputs with a reason rather than emitting zeros', () => {
    // A zero cell count would otherwise collapse every voltage to 0, which
    // reads as "no protection" rather than "bad input".
    expect(buildInitialTuneParameters({ ...base, propSizeInches: 0 })).toMatchObject({
      parameters: [],
      error: /larger than zero/
    })
    expect(buildInitialTuneParameters({ ...base, batteryCells: 0 }).error).toMatch(/at least 1/)
    expect(buildInitialTuneParameters({ ...base, propSizeInches: Number.NaN }).error).toBeTruthy()
  })

  it('every staged value carries a reason', () => {
    // The list is written to a flight controller; a bare number with no
    // explanation is not reviewable.
    for (const parameter of buildInitialTuneParameters({ ...base, suggestedSafety: true }).parameters) {
      expect(parameter.reason.length, `${parameter.id} needs a reason`).toBeGreaterThan(8)
      expect(Number.isFinite(parameter.value), `${parameter.id} must be finite`).toBe(true)
    }
  })

  it('rounds half-up to the nearest hundred, as Mission Planner does', () => {
    expect(roundTo(27850, -2)).toBe(27900)
    expect(roundTo(27849, -2)).toBe(27800)
    expect(roundTo(123.4, 0)).toBe(123)
  })
})
