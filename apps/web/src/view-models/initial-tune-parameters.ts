// Starting-point tuning values derived from the airframe, not from a guess.
//
// This is a faithful port of Mission Planner's "Initial Parameters" screen
// (GCSViews/ConfigurationView/ConfigInitialParams.cs, ArduPilot/MissionPlanner
// @ master). The curve fits below are THEIRS, copied coefficient for
// coefficient rather than re-derived, because the whole value of this feature
// is agreeing with the number a pilot would have got from the tool they
// already trust. Anywhere this file deviates it is noted explicitly.
//
// What it does NOT do, deliberately, because Mission Planner does not either:
// it sets no rate PID gains. `ATC_RAT_*_P/I/D` are left alone. What it sets is
// the frame around them — filter frequencies, acceleration limits, thrust
// expo, and the battery voltage points — which is what actually depends on
// prop size and pack. Setting P/I/D from a prop diameter would be inventing
// numbers.
//
// Pure: airframe facts in, parameter list out. No runtime, no MAVLink, no DOM.

/**
 * Cell voltages by chemistry.
 *
 * Mission Planner's table (ConfigInitialParams.cs:245-268) had Li-ion at
 * 4.1 V / 2.8 V per cell, which is neither the cell's charge voltage nor its
 * discharge floor: a Li-ion cell charges to 4.2 V and is specified down to
 * 2.5-2.7 V. Those numbers set MOT_BAT_VOLT_MAX/MIN, which scale the thrust
 * compensation across the pack's range, so a max that is 0.1 V/cell low tells
 * the mixer the pack is flatter than it is from the moment it is unplugged
 * from the charger.
 *
 * High-voltage variants of both chemistries charge to 4.35 V/cell and are
 * offered separately rather than folded in -- the difference is the whole
 * point of buying them, and guessing it wrong in either direction is a real
 * error at the top of the pack.
 */
export const BATTERY_CHEMISTRIES = {
  LiPo: { label: 'LiPo', maxCellV: 4.2, minCellV: 3.3 },
  'LiPo HV': { label: 'LiPo HV', maxCellV: 4.35, minCellV: 3.3 },
  'Li-ion': { label: 'Li-ion', maxCellV: 4.2, minCellV: 2.7 },
  'Li-ion HV': { label: 'Li-ion HV', maxCellV: 4.35, minCellV: 2.7 }
} as const

export type BatteryChemistry = keyof typeof BATTERY_CHEMISTRIES

export interface InitialTuneInputs {
  /** Prop diameter in inches. Every airframe-dependent value keys off this. */
  propSizeInches: number
  batteryCells: number
  chemistry: BatteryChemistry
  /**
   * T-Motor (or similarly flat-response) ESCs.
   *
   * Overrides the computed expo with a flat 0.2 — ConfigInitialParams.cs:149,
   * applied AFTER calc_values(), and it also pins the PWM range.
   */
  tmotorEscs?: boolean
  /** Also stage the suggested battery-failsafe and fence values. */
  suggestedSafety?: boolean
  /**
   * Firmware major version. 4.x uses the split FLTD/FLTE/FLTT filter
   * parameters; 3.x had a single FILT per axis. Unknown is treated as 4.x,
   * which is what anything this app connects to in practice runs.
   */
  firmwareMajor?: number
  /**
   * Whether the vehicle exposes `<prefix>_ACCEL_P_MAX`. Newer firmware renamed
   * these to `_ACC_P_MAX` and changed the UNITS by a factor of 100, so getting
   * this wrong is not cosmetic — it is a 100x error on an acceleration limit.
   */
  hasAccelPMax?: boolean
  /**
   * Whether the vehicle still has the pre-4.2 `ACRO_YAW_P`. Defaults false:
   * anything this app connects to in practice has `ACRO_Y_RATE` instead.
   */
  hasAcroYawP?: boolean
  /** 'ATC'/'MOT' for Copter, 'Q_A'/'Q_M' for QuadPlane — :151-157. */
  quadplane?: boolean
}

export interface InitialTuneParameter {
  id: string
  value: number
  /** Why this value, in one line, for the review list. */
  reason: string
}

/**
 * Mission Planner's RoundTo with a negative precision — :74-86.
 *
 * Rounds to the nearest 10^|precision| (so -2 means the nearest 100), via a
 * half-up add-then-truncate. Reimplemented rather than reached for
 * `Math.round(x / 100) * 100` because the two disagree on exact halves, and
 * disagreeing with Mission Planner on a published number is the one thing this
 * file is trying not to do.
 */
export function roundTo(value: number, precision: number): number {
  if (precision >= 0) {
    return Math.round(value)
  }
  const factor = Math.pow(10, Math.abs(precision))
  const shifted = value + (5 * factor) / 10
  return Math.round(shifted - (shifted % factor))
}

export interface InitialTuneResult {
  parameters: InitialTuneParameter[]
  /** Refusals, so the caller can explain rather than silently produce nothing. */
  error?: string
}

/**
 * Compute the starting-point parameters for an airframe.
 *
 * Mirrors calc_values() (:88-121) then the staging list (:160-228).
 */
export function buildInitialTuneParameters(inputs: InitialTuneInputs): InitialTuneResult {
  const {
    propSizeInches,
    batteryCells,
    chemistry,
    tmotorEscs = false,
    suggestedSafety = false,
    firmwareMajor = 4,
    hasAccelPMax = true,
    hasAcroYawP = false,
    quadplane = false
  } = inputs

  // Same two guards Mission Planner puts in front of the calculation
  // (:133-145). Both are load-bearing: a prop size of 0 sends the power fits
  // to nonsense, and a cell count of 0 collapses every voltage to zero, which
  // would disarm-lock the vehicle rather than protect it.
  if (!Number.isFinite(propSizeInches) || propSizeInches <= 0) {
    return { parameters: [], error: 'Prop size must be larger than zero.' }
  }
  if (!Number.isFinite(batteryCells) || batteryCells < 1) {
    return { parameters: [], error: 'Battery cell count must be at least 1.' }
  }

  const prop = propSizeInches
  const { maxCellV, minCellV } = BATTERY_CHEMISTRIES[chemistry]

  // --- calc_values() ------------------------------------------------------
  const atcAccelYMax = Math.max(8000, roundTo(-900 * prop + 36000, -2))
  const acroYawP = (0.5 * atcAccelYMax) / 4500
  const atcAccelPMax = Math.max(
    10000,
    roundTo(
      -2.613267 * Math.pow(prop, 3) + 343.39216 * Math.pow(prop, 2) - 15083.7121 * prop + 235771,
      -2
    )
  )
  const atcAccelRMax = atcAccelPMax
  const insGyroFilter = Math.max(20, Math.round(289.22 * Math.pow(prop, -0.838)))

  const halfGyro = Math.max(10, insGyroFilter / 2)
  const quarterGyro = Math.round((insGyroFilter / 4) * 10) / 10
  const insAccelFilter = 10
  const atcThrMixMan = 0.1
  // T-Motor ESCs override the fit entirely (:149) — applied after the
  // calculation, so it wins.
  const motThstExpo = tmotorEscs ? 0.2 : Math.min(Math.round((0.15686 * Math.log(prop) + 0.23693) * 100) / 100, 0.8)
  const motThstHover = 0.2

  const battArmVolt = (batteryCells - 1) * 0.1 + (minCellV + 0.3) * batteryCells
  const battCrtVolt = (minCellV + 0.2) * batteryCells
  const battLowVolt = (minCellV + 0.3) * batteryCells
  const motBatVoltMax = maxCellV * batteryCells
  const motBatVoltMin = minCellV * batteryCells

  const atc = quadplane ? 'Q_A' : 'ATC'
  const mot = quadplane ? 'Q_M' : 'MOT'

  const parameters: InitialTuneParameter[] = []
  const add = (id: string, value: number, reason: string): void => {
    parameters.push({ id, value, reason })
  }

  // ACRO_YAW_P does not exist on Copter 4.2 or later. ArduCopter converts it
  // to ACRO_Y_RATE (a rate in deg/s) with a x45 factor -- Parameters.cpp's
  // acro_rpy_conversion_info, convert_old_parameter(&info, 45.0) -- so the
  // equivalent of Mission Planner's value is that value times 45. Staging the
  // old name against modern firmware produced a row the vehicle rejected.
  if (hasAcroYawP) {
    add('ACRO_YAW_P', acroYawP, 'Half the yaw acceleration limit, in stick terms')
  } else {
    add('ACRO_Y_RATE', round2(acroYawP * 45), 'Acro yaw rate — the 4.2+ name for the same setting (x45)')
  }

  if (hasAccelPMax) {
    add(`${atc}_ACCEL_P_MAX`, atcAccelPMax, `Pitch acceleration limit for a ${prep(prop)} prop`)
    add(`${atc}_ACCEL_R_MAX`, atcAccelRMax, `Roll acceleration limit for a ${prep(prop)} prop`)
    add(`${atc}_ACCEL_Y_MAX`, atcAccelYMax, `Yaw acceleration limit for a ${prep(prop)} prop`)
  } else {
    // Renamed AND rescaled by 100 on newer firmware (:170-174).
    add(`${atc}_ACC_P_MAX`, atcAccelPMax / 100, `Pitch acceleration limit for a ${prep(prop)} prop`)
    add(`${atc}_ACC_R_MAX`, atcAccelRMax / 100, `Roll acceleration limit for a ${prep(prop)} prop`)
    add(`${atc}_ACC_Y_MAX`, atcAccelYMax / 100, `Yaw acceleration limit for a ${prep(prop)} prop`)
  }

  if (firmwareMajor >= 4) {
    const filterReason = 'Half the gyro filter, so the rate loop sees a settled signal'
    add(`${atc}_RAT_PIT_FLTD`, halfGyro, filterReason)
    add(`${atc}_RAT_PIT_FLTE`, 0, 'No error filtering on pitch')
    add(`${atc}_RAT_PIT_FLTT`, halfGyro, filterReason)
    add(`${atc}_RAT_RLL_FLTD`, halfGyro, filterReason)
    add(`${atc}_RAT_RLL_FLTE`, 0, 'No error filtering on roll')
    add(`${atc}_RAT_RLL_FLTT`, halfGyro, filterReason)
    // Mission Planner writes 0 here. ArduPilot's own Aggressive Rate Loop
    // Tuning page does not: "each axis' ATC_RAT_xxx_FLTD should be
    // INS_GYRO_FILTER/2 on roll and pitch and INS_GYRO_FILTER/4 on yaw" -- yaw
    // filtered harder than the others, not switched off. A zero here also
    // disagreed with what the Filters tab derives from the same cutoff.
    add(`${atc}_RAT_YAW_FLTD`, quarterGyro, 'A quarter of the gyro filter — yaw D is filtered harder than roll and pitch')
    add(`${atc}_RAT_YAW_FLTE`, 2, 'Yaw error filter, fixed at 2 Hz')
    add(`${atc}_RAT_YAW_FLTT`, halfGyro, filterReason)
  } else {
    // 3.x had one filter per axis (:193-196). Note yaw takes the FLTE value,
    // not the FLTD one — that asymmetry is Mission Planner's, and it is right:
    // 3.x's single FILT is the error filter.
    add(`${atc}_RAT_PIT_FILT`, halfGyro, 'Rate filter (3.x single-filter firmware)')
    add(`${atc}_RAT_RLL_FILT`, halfGyro, 'Rate filter (3.x single-filter firmware)')
    add(`${atc}_RAT_YAW_FILT`, 2, 'Yaw rate filter (3.x single-filter firmware)')
  }

  add(`${atc}_THR_MIX_MAN`, atcThrMixMan, 'Manual-flight throttle-vs-attitude priority')
  add('INS_ACCEL_FILTER', insAccelFilter, 'Accelerometer filter, fixed at 10 Hz')
  add('INS_GYRO_FILTER', insGyroFilter, `Gyro filter for a ${prep(prop)} prop — bigger props, lower cutoff`)
  add(`${mot}_THST_EXPO`, motThstExpo, tmotorEscs ? 'Flat response, as T-Motor ESCs linearise thrust themselves' : 'Thrust curve for this prop size')
  add(`${mot}_THST_HOVER`, motThstHover, 'Hover thrust starting guess — the FC learns the real value in flight')

  add('BATT_ARM_VOLT', round2(battArmVolt), 'Refuse to arm below this pack voltage')
  add('BATT_CRT_VOLT', round2(battCrtVolt), 'Critical pack voltage')
  add('BATT_LOW_VOLT', round2(battLowVolt), 'Low pack voltage')
  add(`${mot}_BAT_VOLT_MAX`, round2(motBatVoltMax), `${batteryCells}S ${chemistry} fully charged`)
  add(`${mot}_BAT_VOLT_MIN`, round2(motBatVoltMin), `${batteryCells}S ${chemistry} empty`)

  if (tmotorEscs) {
    add(`${mot}_PWM_MIN`, 1100, 'T-Motor ESC PWM range')
    add(`${mot}_PWM_MAX`, 1940, 'T-Motor ESC PWM range')
  }

  // Mission Planner gates these on firmware 4.x and not-Plane (:218). The
  // not-Plane half is why they are skipped for a QuadPlane here.
  if (suggestedSafety && firmwareMajor >= 4 && !quadplane) {
    add('BATT_FS_CRT_ACT', 1, 'Land on a critical battery')
    add('BATT_FS_LOW_ACT', 2, 'Return to launch on a low battery')
    add('FENCE_ACTION', 3, 'Return to launch when the fence is breached')
    add('FENCE_ALT_MAX', 120, 'Maximum altitude, 120 m')
    add('FENCE_ENABLE', 1, 'Turn the geofence on')
    add('FENCE_RADIUS', 150, 'Fence radius, 150 m')
    add('FENCE_TYPE', 7, 'Altitude, circle and polygon fences')
  }

  return { parameters }
}

/** "9in"/"9.5in" without a trailing .0 on whole sizes. */
function prep(prop: number): string {
  return `${Number.isInteger(prop) ? prop : prop.toFixed(1)}in`
}

/** Voltages are compared against live values with a tolerance; keep them tidy. */
function round2(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * Whether a parameter id is one this screen can stage.
 *
 * Used only to badge the task card with a staged count. It is a MEMBERSHIP
 * test over the union of everything the builder can emit — across both
 * prefixes, both firmware filter generations and both accel spellings —
 * rather than a re-run of the calculation, because the card must not depend on
 * whatever prop size happens to be typed into the form at the time.
 */
export function isInitialTuneParamId(id: string): boolean {
  if (id === 'ACRO_YAW_P' || id === 'ACRO_Y_RATE' || id === 'INS_ACCEL_FILTER' || id === 'INS_GYRO_FILTER') return true
  if (/^BATT_(ARM|CRT|LOW)_VOLT$/.test(id)) return true
  if (/^(BATT_FS_(CRT|LOW)_ACT|FENCE_(ACTION|ALT_MAX|ENABLE|RADIUS|TYPE))$/.test(id)) return true
  if (/^(ATC|Q_A)_(ACCEL|ACC)_[PRY]_MAX$/.test(id)) return true
  if (/^(ATC|Q_A)_RAT_(PIT|RLL|YAW)_(FLTD|FLTE|FLTT|FILT)$/.test(id)) return true
  if (/^(ATC|Q_A)_THR_MIX_MAN$/.test(id)) return true
  if (/^(MOT|Q_M)_(THST_EXPO|THST_HOVER|BAT_VOLT_MAX|BAT_VOLT_MIN|PWM_MIN|PWM_MAX)$/.test(id)) return true
  return false
}
