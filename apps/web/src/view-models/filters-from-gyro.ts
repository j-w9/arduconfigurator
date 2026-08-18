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

/** ArduPilot's prop-size starting points for the gyro filter itself. */
export const GYRO_FILTER_PROP_HINTS = [
  { label: '5 in', hz: 80 },
  { label: '10 in', hz: 40 },
  { label: '20 in +', hz: 20 }
] as const

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
    { id: 'ATC_RAT_RLL_FLTT', rule: 'gyro / 2', value: half },
    { id: 'ATC_RAT_PIT_FLTT', rule: 'gyro / 2', value: half },
    { id: 'ATC_RAT_YAW_FLTT', rule: 'gyro / 2', value: half },
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
