// ArduPilot parameter renames (legacy ↔ modern). One param, two names across
// firmware versions; the FC streams exactly one, and the configurator mirrors it
// under the other so byId lookups resolve either way. Centralised here so both
// the runtime (which builds the mirror entries) and the UI (which shows "old
// name: X" in the parameter detail) share one source of truth.

// legacy -> modern.
export const LEGACY_PARAM_ALIASES: Record<string, string> = {
  // ArduPilot 4.5+ GPS family rename.
  GPS_TYPE: 'GPS1_TYPE',
  GPS_TYPE2: 'GPS2_TYPE',
  GPS_RATE_MS: 'GPS1_RATE_MS',
  GPS_GNSS_MODE: 'GPS1_GNSS_MODE',
  // ArduPlane 4.5+ airspeed-bounds rename (same m/s unit). NOT included:
  // TRIM_ARSPD_CM / AIRSPEED_CRUISE — that rename changed cm/s -> m/s.
  ARSPD_FBW_MIN: 'AIRSPEED_MIN',
  ARSPD_FBW_MAX: 'AIRSPEED_MAX',
  // QuadPlane attitude rate limits (axis-name abbreviation, same deg/s unit).
  // NOT included: Q_A_ACCEL_* -> Q_A_ACC_*, which also changed units.
  Q_A_RATE_RLL_MAX: 'Q_A_RATE_R_MAX',
  Q_A_RATE_PIT_MAX: 'Q_A_RATE_P_MAX',
  Q_A_RATE_YAW_MAX: 'Q_A_RATE_Y_MAX',
  // Rover 4.3 cornering-limit rehome (same g unit/range).
  TURN_MAX_G: 'ATC_TURN_MAX_G',
  // ArduPilot 4.5+ MAVLink identifier rename (same range, no unit), plus the
  // MODE_CH -> FLTMODE_CH flight-mode channel rename.
  SYSID_THISMAV: 'MAV_SYSID',
  SYSID_MYGCS: 'MAV_GCS_SYSID',
  MODE_CH: 'FLTMODE_CH',
  // ArduPilot 4.5+ per-instance camera rename. Verified against AP_Camera.cpp's
  // own conversion table (k_param_camera_key indices 2 and 3): these two are
  // pure renames of the same INT16 PWM value.
  //
  // NOT included: CAM_DURATION -> CAM1_DURATION. That conversion also changes
  // units — AP_Camera.cpp converts "CAM_DURATION (in deci-seconds) to
  // CAM1_DURATION (in seconds)" with a *0.1 factor — so aliasing it would show
  // a seconds range/unit against a deci-second value. Same reason
  // TRIM_ARSPD_CM and Q_A_ACCEL_* are excluded above. CAM_DURATION is curated
  // directly instead, with its real deci-second metadata.
  CAM_SERVO_ON: 'CAM1_SERVO_ON',
  CAM_SERVO_OFF: 'CAM1_SERVO_OFF'
}

// modern -> legacy (the reverse map).
export const MODERN_TO_LEGACY_ALIASES: Record<string, string> = Object.fromEntries(
  Object.entries(LEGACY_PARAM_ALIASES).map(([legacy, modern]) => [modern, legacy])
)

export interface ParameterAlias {
  /** The other name for this parameter. */
  name: string
  /** True when `name` is the LEGACY (older) name — i.e. the id passed in is the
   *  modern one. False when `name` is the modern name (the id passed in is old). */
  aliasIsLegacy: boolean
}

/**
 * The alternate (renamed) form of a parameter id, or undefined when it has no
 * known rename. Works whichever name the FC happens to stream.
 */
export function parameterAlias(paramId: string): ParameterAlias | undefined {
  const modern = LEGACY_PARAM_ALIASES[paramId]
  if (modern !== undefined) {
    return { name: modern, aliasIsLegacy: false }
  }
  const legacy = MODERN_TO_LEGACY_ALIASES[paramId]
  if (legacy !== undefined) {
    return { name: legacy, aliasIsLegacy: true }
  }
  return undefined
}
