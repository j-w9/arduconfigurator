// Curated ArduPlane Soaring (SOAR_*) and ADS-B / avoidance (ADSB_* / AVD_*)
// parameter groupings for the PlaneSoaringAdsbSection surface. These are pure
// ArduPilot parameter-id constants — no React, no app state — mirroring the
// tuning-params.ts pattern. Every id here is present in the wired ArduPlane
// catalog (packages/param-metadata/src/arduplane.ts), each sourced verbatim
// from ArduPilot's AP_Soaring / AP_ADSB / AP_Avoidance var_info tables. The
// section drops any id the connected FC does not stream, so a partial
// controller renders only what it has.

// Soaring estimator + behaviour. SOAR_ENABLE gates the whole group's
// visibility (it is the @PARAM_FLAG_ENABLE toggle); the rest tune the thermal
// EKF, the climb-rate trigger, the altitude band, the glide polar, and the
// thermalling/cruise behaviour.
export const PLANE_SOARING_ENABLE_PARAM_ID = 'SOAR_ENABLE'
export const PLANE_SOARING_TRIGGER_PARAM_IDS = ['SOAR_VSPEED', 'SOAR_DIST_AHEAD', 'SOAR_MIN_THML_S', 'SOAR_MIN_CRSE_S'] as const
export const PLANE_SOARING_ESTIMATOR_PARAM_IDS = ['SOAR_Q1', 'SOAR_Q2', 'SOAR_R'] as const
export const PLANE_SOARING_ALTITUDE_PARAM_IDS = ['SOAR_ALT_MIN', 'SOAR_ALT_MAX', 'SOAR_ALT_CUTOFF'] as const
export const PLANE_SOARING_POLAR_PARAM_IDS = ['SOAR_POLAR_CD0', 'SOAR_POLAR_B', 'SOAR_POLAR_K'] as const
export const PLANE_SOARING_BEHAVIOUR_PARAM_IDS = [
  'SOAR_THML_BANK',
  'SOAR_THML_ARSPD',
  'SOAR_CRSE_ARSPD',
  'SOAR_THML_FLAP',
  'SOAR_MAX_DRIFT',
  'SOAR_MAX_RADIUS'
] as const

// ADS-B transponder hardware + identity. ADSB_TYPE gates the whole ADS-B group
// (0 = disabled); the rest configure the hardware list filters and the
// identity/dimension fields broadcast on ADS-B-out.
export const PLANE_ADSB_TYPE_PARAM_ID = 'ADSB_TYPE'
export const PLANE_ADSB_DEVICE_PARAM_IDS = ['ADSB_RF_SELECT', 'ADSB_RF_CAPABLE', 'ADSB_OPTIONS', 'ADSB_LOG'] as const
export const PLANE_ADSB_LIST_PARAM_IDS = ['ADSB_LIST_MAX', 'ADSB_LIST_RADIUS', 'ADSB_LIST_ALT'] as const
export const PLANE_ADSB_IDENTITY_PARAM_IDS = [
  'ADSB_ICAO_ID',
  'ADSB_SQUAWK',
  'ADSB_EMIT_TYPE',
  'ADSB_LEN_WIDTH',
  'ADSB_OFFSET_LAT',
  'ADSB_OFFSET_LON'
] as const

// ADS-B traffic avoidance (AVD_*). AVD_ENABLE turns the avoidance layer on; the
// rest set the warn/fail actions, recovery behaviour, and the time/distance
// horizons. Shown within the ADS-B group (gated on ADSB_TYPE) since avoidance
// only acts on ADS-B-detected traffic.
export const PLANE_AVOIDANCE_PARAM_IDS = [
  'AVD_ENABLE',
  'AVD_F_ACTION',
  'AVD_W_ACTION',
  'AVD_F_RCVRY',
  'AVD_OBS_MAX',
  'AVD_W_TIME',
  'AVD_F_TIME',
  'AVD_W_DIST_XY',
  'AVD_F_DIST_XY',
  'AVD_W_DIST_Z',
  'AVD_F_DIST_Z',
  'AVD_F_ALT_MIN'
] as const

// Full membership set used by the scoped-draft predicate (review/apply scope).
// SOAR_ENABLE and ADSB_TYPE ARE included — unlike the Q_ENABLE airframe toggle
// in plane tuning, these enable switches are part of the same curated surface
// and are edited here (they also gate group visibility at render time).
export const PLANE_SOARING_ADSB_PARAM_IDS = [
  PLANE_SOARING_ENABLE_PARAM_ID,
  ...PLANE_SOARING_TRIGGER_PARAM_IDS,
  ...PLANE_SOARING_ESTIMATOR_PARAM_IDS,
  ...PLANE_SOARING_ALTITUDE_PARAM_IDS,
  ...PLANE_SOARING_POLAR_PARAM_IDS,
  ...PLANE_SOARING_BEHAVIOUR_PARAM_IDS,
  PLANE_ADSB_TYPE_PARAM_ID,
  ...PLANE_ADSB_DEVICE_PARAM_IDS,
  ...PLANE_ADSB_LIST_PARAM_IDS,
  ...PLANE_ADSB_IDENTITY_PARAM_IDS,
  ...PLANE_AVOIDANCE_PARAM_IDS
] as const
