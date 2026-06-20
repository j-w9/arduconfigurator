// Curated AUTOTUNE parameter groupings for the per-vehicle Autotune surfaces.
// These are pure ArduPilot parameter-id constants — no React, no app state —
// mirroring the tuning-params.ts / plane-soaring-adsb-params.ts pattern. Every
// id here is present in the wired catalog (packages/param-metadata/src/
// arducopter.ts and arduplane.ts), each sourced verbatim from ArduPilot's
// AC_AutoTune_Multi var_info table (Copter / QuadPlane) and ArduPlane's
// Parameters.cpp (fixed-wing AUTOTUNE_LEVEL / AUTOTUNE_OPTIONS). The section
// drops any id the connected FC does not stream, so a partial controller
// renders only what it has.

// ArduCopter multirotor AUTOTUNE config params (AC_AutoTune_Multi, registered
// under the AUTOTUNE_ prefix). AUTOTUNE_AXES is the @Bitmask 0:Roll,1:Pitch,
// 2:Yaw,3:YawD; AGGR is the bounce-back aggressiveness; MIN_D the minimum D
// gain floor; GMBK the post-tune gain-margin backoff.
export const AUTOTUNE_COPTER_AXES_PARAM_ID = 'AUTOTUNE_AXES'
export const AUTOTUNE_COPTER_PARAM_IDS = [
  'AUTOTUNE_AXES',
  'AUTOTUNE_AGGR',
  'AUTOTUNE_MIN_D',
  'AUTOTUNE_GMBK'
] as const

// ArduPlane fixed-wing AUTOTUNE config params (ArduPlane/Parameters.cpp).
// AUTOTUNE_LEVEL is the aggressiveness 0-10; AUTOTUNE_OPTIONS the @Bitmask
// (0:Disable FLTD update, 1:Disable FLTT update).
export const AUTOTUNE_PLANE_PARAM_IDS = ['AUTOTUNE_LEVEL', 'AUTOTUNE_OPTIONS'] as const

// QuadPlane VTOL AUTOTUNE config params (the same AC_AutoTune_Multi library,
// reached through the Q_ parent so the names gain the Q_ prefix). Mirrors the
// Copter set 1:1. Gated on Q_ENABLE at render time.
export const AUTOTUNE_QUADPLANE_AXES_PARAM_ID = 'Q_AUTOTUNE_AXES'
export const AUTOTUNE_QUADPLANE_PARAM_IDS = [
  'Q_AUTOTUNE_AXES',
  'Q_AUTOTUNE_AGGR',
  'Q_AUTOTUNE_MIN_D',
  'Q_AUTOTUNE_GMBK'
] as const

// Full membership set used by the plane-side scoped-draft predicate (review/
// apply scope). Disjoint from the plane tuning scope (RLL_/PTCH_/TECS_/Q_A_/
// Q_P_) and the soaring/ADS-B scope.
export const AUTOTUNE_PLANE_REVIEW_PARAM_IDS = [
  ...AUTOTUNE_PLANE_PARAM_IDS,
  ...AUTOTUNE_QUADPLANE_PARAM_IDS
] as const
