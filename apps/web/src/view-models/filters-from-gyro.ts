// Derive the rate-loop filter frequencies from a chosen gyro filter.
//
// Every ratio here is ArduPilot's own, not this app's and not Mission
// Planner's:
//
//   "each axis' ATC_RAT_xxx_FLTD should be INS_GYRO_FILTER/2 on roll and pitch
//    and INS_GYRO_FILTER/4 on yaw"          -- Aggressive Rate Loop Tuning
//    ...and "Setting it above 0.75 * INS_GYRO_FILTER is not recommended."
//    (https://ardupilot.org/copter/docs/high-loop-rate-tuning.html)
//
//   ATC_RAT_{RLL,PIT,YAW}_FLTT: INS_GYRO_FILTER / 2, ATC_RAT_YAW_FLTE: 2
//    (https://ardupilot.org/copter/docs/setting-up-for-tuning.html)
//
// Nothing beyond those is proposed. Roll/pitch FLTE, for instance, is left
// alone: Mission Planner zeroes it, the ArduPilot docs do not say to, and a
// value this app invented has no business being staged to a flight controller.

/** One proposed filter value, with the rule that produced it. */
export interface FilterFromGyroRow {
  id: string
  /** Where the number comes from, shown next to the field. */
  rule: string
  value: number
}

/** The parameters this helper can propose, in the order it lists them. */
export const FILTERS_FROM_GYRO_PARAM_IDS = [
  'INS_GYRO_FILTER',
  'ATC_RAT_RLL_FLTD',
  'ATC_RAT_PIT_FLTD',
  'ATC_RAT_YAW_FLTD',
  'ATC_RAT_RLL_FLTT',
  'ATC_RAT_PIT_FLTT',
  'ATC_RAT_YAW_FLTT',
  'ATC_RAT_YAW_FLTE'
] as const

/**
 * Prop-size starting points for the cutoff itself.
 *
 * These are the operator's numbers, not ArduPilot's. The docs' table (80 Hz /
 * 40 Hz / 20 Hz for 5, 10, and 20+ inch props) and Mission Planner's curve
 * both filter harder than this; these suit the low-noise FPV builds this app
 * is aimed at, where a higher cutoff keeps the response the airframe can
 * actually use. A starting point either way -- the log is what settles it.
 */
export const GYRO_FILTER_PROP_HINTS = [
  { label: '5 in', hz: 90 },
  { label: '10 in', hz: 60 },
  { label: '15 in', hz: 40 }
] as const

/**
 * Target-filter defaults. Fixed rather than derived -- see the rows below.
 *
 * Roll and pitch sit higher than yaw: they carry the stick demand that the
 * pilot actually flies, and SFD runs them at 50 Hz. Yaw stays at 30 Hz, where
 * the extra smoothing costs nothing anyone can feel.
 */
const TARGET_FILTER_ROLL_PITCH_HZ = 50
const TARGET_FILTER_YAW_HZ = 30

/** One decimal: gyro/4 of an odd cutoff is not a whole number, and FLTD is an AP_Float. */
function round(value: number): number {
  return Math.round(value * 10) / 10
}

/**
 * The filter set ArduPilot's tuning pages derive from a gyro cutoff.
 *
 * Returns [] for a value that is not a usable cutoff, so the caller can render
 * nothing rather than a table of zeroes and NaNs.
 */
export function buildFiltersFromGyro(gyroFilterHz: number): FilterFromGyroRow[] {
  if (!Number.isFinite(gyroFilterHz) || gyroFilterHz <= 0) {
    return []
  }
  const gyro = round(gyroFilterHz)
  const half = round(gyro / 2)
  const quarter = round(gyro / 4)
  return [
    { id: 'INS_GYRO_FILTER', rule: 'the cutoff you entered', value: gyro },
    { id: 'ATC_RAT_RLL_FLTD', rule: 'gyro / 2', value: half },
    { id: 'ATC_RAT_PIT_FLTD', rule: 'gyro / 2', value: half },
    { id: 'ATC_RAT_YAW_FLTD', rule: 'gyro / 4', value: quarter },
    // The target filters are fixed, not ArduPilot's gyro/2. They smooth the
    // pilot's demand rather than a measured signal, so they need not follow the
    // sensor cutoff -- both values sit well above stick bandwidth on every
    // airframe this app is aimed at. Proposed, not imposed: like every row here
    // they are editable before anything is staged.
    { id: 'ATC_RAT_RLL_FLTT', rule: 'fixed at 50 Hz', value: TARGET_FILTER_ROLL_PITCH_HZ },
    { id: 'ATC_RAT_PIT_FLTT', rule: 'fixed at 50 Hz', value: TARGET_FILTER_ROLL_PITCH_HZ },
    { id: 'ATC_RAT_YAW_FLTT', rule: 'fixed at 30 Hz', value: TARGET_FILTER_YAW_HZ },
    { id: 'ATC_RAT_YAW_FLTE', rule: 'fixed at 2 Hz', value: 2 }
  ]
}

/**
 * ArduPilot's documented ceiling for a D-term filter, so an edited value that
 * walks past it can be called out rather than silently staged.
 */
export function exceedsDTermCeiling(paramId: string, value: number, gyroFilterHz: number): boolean {
  if (!/_FLTD$/.test(paramId) || !Number.isFinite(value) || !Number.isFinite(gyroFilterHz) || gyroFilterHz <= 0) {
    return false
  }
  return value > 0.75 * gyroFilterHz
}
