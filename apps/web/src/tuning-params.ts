// Tuning-tab parameter groupings, extracted from App.tsx as the first slice of
// its decomposition. These are pure ArduPilot parameter-id constants and the
// axis groupings the Tuning workbench renders from — no React, no app state — so
// they live on their own and App.tsx imports what it needs.

// ArduCopter 4.5+ renamed and re-unit'd the lean-angle and angular-accel
// limits (ANGLE_MAX cdeg -> ATC_ANGLE_MAX deg; ATC_ACCEL_*_MAX cd/s² ->
// ATC_ACC_*_MAX deg/s²). List both forms — the tuning view drops missing
// ids, so only the variant the connected FC actually streams renders.
export const TUNING_FLIGHT_FEEL_PARAM_IDS = ['ATC_INPUT_TC', 'ATC_ANGLE_MAX', 'ANGLE_MAX', 'PILOT_Y_RATE', 'PILOT_Y_EXPO'] as const
export const TUNING_ACCEL_LIMIT_PARAM_IDS = ['ATC_ACC_R_MAX', 'ATC_ACCEL_R_MAX', 'ATC_ACC_P_MAX', 'ATC_ACCEL_P_MAX', 'ATC_ACC_Y_MAX', 'ATC_ACCEL_Y_MAX'] as const
export const TUNING_ACRO_PARAM_IDS = ['ACRO_RP_RATE', 'ACRO_Y_RATE', 'ACRO_RP_EXPO', 'ACRO_Y_EXPO'] as const
export const TUNING_PID_GAIN_PARAM_IDS = [
  'ATC_RAT_RLL_P',
  'ATC_RAT_RLL_I',
  'ATC_RAT_RLL_D',
  'ATC_RAT_RLL_FF',
  'ATC_RAT_PIT_P',
  'ATC_RAT_PIT_I',
  'ATC_RAT_PIT_D',
  'ATC_RAT_PIT_FF',
  'ATC_RAT_YAW_P',
  'ATC_RAT_YAW_I',
  'ATC_RAT_YAW_D',
  'ATC_RAT_YAW_FF'
] as const
export const TUNING_ADVANCED_PID_PARAM_IDS = [
  'ATC_RAT_RLL_D_FF',
  'ATC_RAT_RLL_IMAX',
  'ATC_RAT_RLL_PDMX',
  'ATC_RAT_RLL_SMAX',
  'ATC_RAT_PIT_D_FF',
  'ATC_RAT_PIT_IMAX',
  'ATC_RAT_PIT_PDMX',
  'ATC_RAT_PIT_SMAX',
  'ATC_RAT_YAW_D_FF',
  'ATC_RAT_YAW_IMAX',
  'ATC_RAT_YAW_PDMX',
  'ATC_RAT_YAW_SMAX'
] as const
export const TUNING_ALL_PID_PARAM_IDS = [...TUNING_PID_GAIN_PARAM_IDS, ...TUNING_ADVANCED_PID_PARAM_IDS] as const
export const TUNING_FILTER_PARAM_IDS = [
  'ATC_RAT_RLL_FLTT',
  'ATC_RAT_RLL_FLTE',
  'ATC_RAT_RLL_FLTD',
  'ATC_RAT_PIT_FLTT',
  'ATC_RAT_PIT_FLTE',
  'ATC_RAT_PIT_FLTD',
  'ATC_RAT_YAW_FLTT',
  'ATC_RAT_YAW_FLTE',
  'ATC_RAT_YAW_FLTD'
] as const
export const TUNING_RATE_PARAM_IDS = [...TUNING_FLIGHT_FEEL_PARAM_IDS, ...TUNING_ACCEL_LIMIT_PARAM_IDS, ...TUNING_ACRO_PARAM_IDS] as const
export const TUNING_PARAM_IDS = [...TUNING_RATE_PARAM_IDS, ...TUNING_ALL_PID_PARAM_IDS, ...TUNING_FILTER_PARAM_IDS] as const
export const TUNING_PID_AXIS_GROUPS = [
  {
    id: 'roll',
    label: 'Roll',
    paramIds: ['ATC_RAT_RLL_P', 'ATC_RAT_RLL_I', 'ATC_RAT_RLL_D', 'ATC_RAT_RLL_FF'] as const
  },
  {
    id: 'pitch',
    label: 'Pitch',
    paramIds: ['ATC_RAT_PIT_P', 'ATC_RAT_PIT_I', 'ATC_RAT_PIT_D', 'ATC_RAT_PIT_FF'] as const
  },
  {
    id: 'yaw',
    label: 'Yaw',
    paramIds: ['ATC_RAT_YAW_P', 'ATC_RAT_YAW_I', 'ATC_RAT_YAW_D', 'ATC_RAT_YAW_FF'] as const
  }
] as const
export const TUNING_FILTER_AXIS_GROUPS = [
  {
    id: 'roll',
    label: 'Roll',
    paramIds: ['ATC_RAT_RLL_FLTT', 'ATC_RAT_RLL_FLTE', 'ATC_RAT_RLL_FLTD'] as const
  },
  {
    id: 'pitch',
    label: 'Pitch',
    paramIds: ['ATC_RAT_PIT_FLTT', 'ATC_RAT_PIT_FLTE', 'ATC_RAT_PIT_FLTD'] as const
  },
  {
    id: 'yaw',
    label: 'Yaw',
    paramIds: ['ATC_RAT_YAW_FLTT', 'ATC_RAT_YAW_FLTE', 'ATC_RAT_YAW_FLTD'] as const
  }
] as const
export const TUNING_ADVANCED_PID_AXIS_GROUPS = [
  {
    id: 'roll',
    label: 'Roll',
    paramIds: ['ATC_RAT_RLL_D_FF', 'ATC_RAT_RLL_IMAX', 'ATC_RAT_RLL_PDMX', 'ATC_RAT_RLL_SMAX'] as const
  },
  {
    id: 'pitch',
    label: 'Pitch',
    paramIds: ['ATC_RAT_PIT_D_FF', 'ATC_RAT_PIT_IMAX', 'ATC_RAT_PIT_PDMX', 'ATC_RAT_PIT_SMAX'] as const
  },
  {
    id: 'yaw',
    label: 'Yaw',
    paramIds: ['ATC_RAT_YAW_D_FF', 'ATC_RAT_YAW_IMAX', 'ATC_RAT_YAW_PDMX', 'ATC_RAT_YAW_SMAX'] as const
  }
] as const
// ArduPlane curated tuning surface. These are the fixed-wing attitude / speed
// / navigation params an operator actually tunes, grouped by concern. Every id
// here is present in the wired ArduPlane catalog (packages/param-metadata/src/
// arduplane.ts) — the section drops any id the connected FC does not stream, so
// a partial controller renders only what it has. QuadPlane (Q_A_* / Q_P_*)
// groups are gated on Q_ENABLE at render time, not removed from the set.
export const TUNING_PLANE_RATE_GROUPS = [
  {
    id: 'roll',
    label: 'Roll Rate',
    paramIds: ['RLL_RATE_P', 'RLL_RATE_I', 'RLL_RATE_D', 'RLL_RATE_FF', 'RLL_RATE_IMAX'] as const
  },
  {
    id: 'pitch',
    label: 'Pitch Rate',
    paramIds: ['PTCH_RATE_P', 'PTCH_RATE_I', 'PTCH_RATE_D', 'PTCH_RATE_FF', 'PTCH_RATE_IMAX'] as const
  }
] as const
export const TUNING_PLANE_ATTITUDE_PARAM_IDS = [
  'RLL2SRV_TCONST',
  'RLL2SRV_RMAX',
  'PTCH2SRV_TCONST',
  'PTCH2SRV_RLL'
] as const
// TECS cruise — the always-on speed/height controller in the auto-throttle
// modes. Includes the four advanced cruise params (VERT_ACC, HGT_OMEGA,
// SPD_OMEGA, HDEM_TCONST) and pitch-feedforward (PTCH_FF_V0 / PTCH_FF_K)
// that the bundle gained alongside the existing 11.
export const TUNING_PLANE_TECS_PARAM_IDS = [
  'TECS_CLMB_MAX',
  'TECS_SINK_MIN',
  'TECS_SINK_MAX',
  'TECS_TIME_CONST',
  'TECS_THR_DAMP',
  'TECS_PTCH_DAMP',
  'TECS_INTEG_GAIN',
  'TECS_SPDWEIGHT',
  'TECS_PITCH_MAX',
  'TECS_PITCH_MIN',
  'TECS_RLL2THR',
  'TECS_VERT_ACC',
  'TECS_HGT_OMEGA',
  'TECS_SPD_OMEGA',
  'TECS_HDEM_TCONST',
  'TECS_PTCH_FF_V0',
  'TECS_PTCH_FF_K'
] as const
// TECS landing-stage gains — only take effect during the auto-landing
// state machine, separated so the operator can tune approach behaviour
// without nudging cruise TECS.
export const TUNING_PLANE_TECS_LANDING_PARAM_IDS = [
  'TECS_LAND_ARSPD',
  'TECS_LAND_THR',
  'TECS_LAND_DAMP',
  'TECS_LAND_PMAX',
  'TECS_LAND_TCONST',
  'TECS_LAND_TDAMP',
  'TECS_LAND_IGAIN',
  'TECS_LAND_PDAMP',
  'TECS_APPR_SMAX',
  'TECS_FLARE_HGT'
] as const
// TECS takeoff integrator — decoupled from cruise so the initial climb
// can be tuned in isolation.
export const TUNING_PLANE_TECS_TAKEOFF_PARAM_IDS = ['TECS_TKOFF_IGAIN'] as const
// L1 navigation tuning — period + damping drive turn aggressiveness and
// path-tracking overshoot. XTRACK_I trims long-term cross-track error;
// LIM_BANK bounds airframe loading in continuous loiter at altitude.
export const TUNING_PLANE_NAV_PARAM_IDS = [
  'NAVL1_PERIOD',
  'NAVL1_DAMPING',
  'NAVL1_XTRACK_I',
  'NAVL1_LIM_BANK'
] as const
export const TUNING_PLANE_VTOL_RATE_GROUPS = [
  {
    id: 'q-roll',
    label: 'VTOL Roll',
    paramIds: ['Q_A_RAT_RLL_P', 'Q_A_RAT_RLL_I', 'Q_A_RAT_RLL_D'] as const
  },
  {
    id: 'q-pitch',
    label: 'VTOL Pitch',
    paramIds: ['Q_A_RAT_PIT_P', 'Q_A_RAT_PIT_I', 'Q_A_RAT_PIT_D'] as const
  },
  {
    id: 'q-yaw',
    label: 'VTOL Yaw',
    paramIds: ['Q_A_RAT_YAW_P', 'Q_A_RAT_YAW_I', 'Q_A_RAT_YAW_D'] as const
  }
] as const
export const TUNING_PLANE_VTOL_ANGLE_PARAM_IDS = ['Q_A_ANG_RLL_P', 'Q_A_ANG_PIT_P', 'Q_A_ANG_YAW_P'] as const
export const TUNING_PLANE_VTOL_POSITION_PARAM_IDS = ['Q_P_POSXY_P', 'Q_P_VELXY_P', 'Q_P_POSZ_P', 'Q_P_ACCZ_P'] as const
// QuadPlane forward/back transition timing + VTOL RTL behaviour (all QuadPlanes).
export const TUNING_PLANE_TRANSITION_PARAM_IDS = [
  'Q_TRANSITION_MS',
  'Q_TRANS_DECEL',
  'Q_TRANS_FAIL',
  'Q_TRANS_FAIL_ACT',
  'Q_RTL_MODE'
] as const
// Tiltrotor mechanism. Q_TILT_ENABLE is included (it's the in-group toggle); the
// group self-gates the rest of the controls on it being on.
export const TUNING_PLANE_TILTROTOR_PARAM_IDS = [
  'Q_TILT_ENABLE',
  'Q_TILT_MASK',
  'Q_TILT_TYPE',
  'Q_TILT_MAX',
  'Q_TILT_RATE_UP',
  'Q_TILT_RATE_DN',
  'Q_TILT_YAW_ANGLE',
  'Q_TILT_FIX_ANGLE',
  'Q_TILT_FIX_GAIN',
  'Q_TILT_WING_FLAP'
] as const
// Tailsitter geometry + tuning. Q_TAILSIT_ENABLE is the in-group toggle; the
// group self-gates the rest on a tailsitter being detected.
export const TUNING_PLANE_TAILSITTER_PARAM_IDS = [
  'Q_TAILSIT_ENABLE',
  'Q_TAILSIT_ANGLE',
  'Q_TAILSIT_ANG_VT',
  'Q_TAILSIT_INPUT',
  'Q_TAILSIT_RLL_MX',
  'Q_TAILSIT_MOTMX',
  'Q_TAILSIT_VFGAIN',
  'Q_TAILSIT_VHGAIN',
  'Q_TAILSIT_VHPOW',
  'Q_TAILSIT_GSCMAX',
  'Q_TAILSIT_GSCMIN',
  'Q_TAILSIT_GSCMSK',
  'Q_TAILSIT_RAT_FW',
  'Q_TAILSIT_RAT_VT',
  'Q_TAILSIT_THR_VT',
  'Q_TAILSIT_VT_R_P',
  'Q_TAILSIT_VT_P_P',
  'Q_TAILSIT_VT_Y_P'
] as const
// Full membership set used by the scoped-draft predicate (review/apply scope).
// Q_ENABLE itself is NOT included — it is an airframe toggle owned by Setup, not
// a tuning value, and the VTOL groups only gate visibility on it.
export const TUNING_PLANE_PARAM_IDS = [
  ...TUNING_PLANE_RATE_GROUPS.flatMap((group) => group.paramIds),
  ...TUNING_PLANE_ATTITUDE_PARAM_IDS,
  ...TUNING_PLANE_TECS_PARAM_IDS,
  ...TUNING_PLANE_TECS_LANDING_PARAM_IDS,
  ...TUNING_PLANE_TECS_TAKEOFF_PARAM_IDS,
  ...TUNING_PLANE_NAV_PARAM_IDS,
  ...TUNING_PLANE_VTOL_RATE_GROUPS.flatMap((group) => group.paramIds),
  ...TUNING_PLANE_VTOL_ANGLE_PARAM_IDS,
  ...TUNING_PLANE_VTOL_POSITION_PARAM_IDS,
  ...TUNING_PLANE_TRANSITION_PARAM_IDS,
  ...TUNING_PLANE_TILTROTOR_PARAM_IDS,
  ...TUNING_PLANE_TAILSITTER_PARAM_IDS
] as const
// ArduRover curated tuning surface. These are the ground-vehicle steering /
// speed / navigation params an operator actually tunes, grouped by concern.
// Every id here is present in the wired ArduRover catalog (packages/
// param-metadata/src/ardurover.ts) — the section drops any id the connected FC
// does not stream, so a partial controller renders only what it has. The legacy
// pre-4.3 ids the catalog still carries (NAVL1_*, TURN_MAX_G, WP_OVERSHOOT) are
// intentionally NOT surfaced here: the catalog flags them as retired in favor
// of the modern AR_AttitudeControl / s-curve params, which is what this curated
// surface exposes.
export const TUNING_ROVER_STEERING_PARAM_IDS = [
  'ATC_STR_RAT_P',
  'ATC_STR_RAT_I',
  'ATC_STR_RAT_D',
  'ATC_STR_RAT_FF',
  'ATC_STR_RAT_IMAX',
  'ATC_STR_RAT_MAX'
] as const
export const TUNING_ROVER_SPEED_PARAM_IDS = [
  'ATC_SPEED_P',
  'ATC_SPEED_I',
  'ATC_SPEED_D',
  'ATC_SPEED_FF',
  'ATC_SPEED_IMAX',
  'CRUISE_SPEED',
  'CRUISE_THROTTLE'
] as const
export const TUNING_ROVER_NAV_PARAM_IDS = ['WP_SPEED', 'WP_RADIUS'] as const
export const TUNING_ROVER_TURN_PARAM_IDS = [
  'ATC_TURN_MAX_G',
  'TURN_RADIUS',
  'ATC_ACCEL_MAX',
  'ATC_DECEL_MAX'
] as const
// Sailboat sailing trim & limits — only relevant when SAIL_ENABLE=1 (the
// toggle is in the list so the user can flip it from this card). Verbatim
// from ArduPilot Rover/sailboat.cpp Sailboat var_info[] under the "SAIL_"
// prefix.
export const TUNING_ROVER_SAIL_PARAM_IDS = [
  'SAIL_ENABLE',
  'SAIL_ANGLE_MIN',
  'SAIL_ANGLE_MAX',
  'SAIL_ANGLE_IDEAL',
  'SAIL_HEEL_MAX',
  'SAIL_NO_GO_ANGLE',
  'SAIL_WNDSPD_MIN',
  'SAIL_XTRACK_MAX',
  'SAIL_LOIT_RADIUS'
] as const
// Sail-heel PID — the AR_AttitudeControl-class controller that holds the
// boat below SAIL_HEEL_MAX by easing the mainsheet. Verbatim from
// AR_AttitudeControl.cpp _sailboat_heel_pid AP_SUBGROUPINFO("_SAIL_", …).
export const TUNING_ROVER_SAIL_HEEL_PID_PARAM_IDS = [
  'ATC_SAIL_P',
  'ATC_SAIL_I',
  'ATC_SAIL_D',
  'ATC_SAIL_FF',
  'ATC_SAIL_IMAX',
  'ATC_SAIL_FLTT',
  'ATC_SAIL_FLTE',
  'ATC_SAIL_FLTD',
  'ATC_SAIL_SMAX'
] as const
// Wind vane subsystem — sensor type + calibration + filtering. Pin
// configuration (DIR_PIN / SPEED_PIN / TEMP_PIN / *_V_MIN / *_V_MAX)
// belongs in setup wiring, not tuning, so it is intentionally NOT
// surfaced here. WNDVN_CAL is the calibration trigger; the operator
// flips it momentarily and the FC writes back.
export const TUNING_ROVER_WINDVANE_PARAM_IDS = [
  'WNDVN_TYPE',
  'WNDVN_SPEED_TYPE',
  'WNDVN_DIR_FILT',
  'WNDVN_SPEED_FILT',
  'WNDVN_TRUE_FILT',
  'WNDVN_DIR_OFS',
  'WNDVN_DIR_DZ',
  'WNDVN_SPEED_MIN',
  'WNDVN_CAL'
] as const
// Full membership set used by the scoped-draft predicate (review/apply scope).
// SAIL_ENABLE / WNDVN_* are tuned via the same scoped flow as the rest of the
// Rover tuning surface so an enable → tune → apply cycle is one transaction.
export const TUNING_ROVER_PARAM_IDS = [
  ...TUNING_ROVER_STEERING_PARAM_IDS,
  ...TUNING_ROVER_SPEED_PARAM_IDS,
  ...TUNING_ROVER_NAV_PARAM_IDS,
  ...TUNING_ROVER_TURN_PARAM_IDS,
  ...TUNING_ROVER_SAIL_PARAM_IDS,
  ...TUNING_ROVER_SAIL_HEEL_PID_PARAM_IDS,
  ...TUNING_ROVER_WINDVANE_PARAM_IDS
] as const
// ArduSub curated tuning surface. ArduSub is an attitude + depth-hold vehicle:
// it tunes the per-axis attitude rate controllers, the attitude angle P gains,
// and the vertical (depth) position/velocity/acceleration controllers. There is
// no fixed-wing/steering analog, and the catalog carries no horizontal-position
// PSC params (PSC_POSXY_*/PSC_VELXY_*), so none are surfaced — only ids present
// in the wired ArduSub catalog (packages/param-metadata/src/ardusub.ts) appear.
// The section drops any id the connected FC does not stream, so a partial
// controller renders only what it has.
//
// Yaw has no rate D term in the Sub catalog (ATC_RAT_YAW_D is absent), so the
// yaw group omits it. The vertical controllers list BOTH the modern PSC_D_*
// names and the legacy PSC_*Z names — modern firmware streams the former, older
// firmware the latter, and the resolver shows whichever the FC actually reports.
export const TUNING_SUB_RATE_GROUPS = [
  {
    id: 'roll',
    label: 'Roll Rate',
    paramIds: ['ATC_RAT_RLL_P', 'ATC_RAT_RLL_I', 'ATC_RAT_RLL_D', 'ATC_RAT_RLL_FF', 'ATC_RAT_RLL_IMAX'] as const
  },
  {
    id: 'pitch',
    label: 'Pitch Rate',
    paramIds: ['ATC_RAT_PIT_P', 'ATC_RAT_PIT_I', 'ATC_RAT_PIT_D', 'ATC_RAT_PIT_FF', 'ATC_RAT_PIT_IMAX'] as const
  },
  {
    id: 'yaw',
    label: 'Yaw Rate',
    paramIds: ['ATC_RAT_YAW_P', 'ATC_RAT_YAW_I', 'ATC_RAT_YAW_FF', 'ATC_RAT_YAW_IMAX'] as const
  }
] as const
export const TUNING_SUB_ANGLE_PARAM_IDS = ['ATC_ANG_RLL_P', 'ATC_ANG_PIT_P', 'ATC_ANG_YAW_P'] as const
export const TUNING_SUB_DEPTH_PARAM_IDS = [
  'PSC_D_POS_P',
  'PSC_POSZ_P',
  'PSC_D_VEL_P',
  'PSC_VELZ_P',
  'PSC_D_VEL_I',
  'PSC_VELZ_I',
  'PSC_D_VEL_D',
  'PSC_VELZ_D',
  'PSC_D_ACC_P',
  'PSC_ACCZ_P',
  'PSC_D_ACC_I',
  'PSC_ACCZ_I',
  'PSC_D_ACC_D',
  'PSC_ACCZ_D'
] as const
// Sub pilot envelope — how fast and how hard the pilot stick demand is
// allowed to push the vehicle. SURFACE_DEPTH / SURFACE_MAX_THR shape
// the near-surface throttle attenuation that protects the operator
// when the Sub breaches. Verbatim from ArduSub/Parameters.cpp.
export const TUNING_SUB_PILOT_PARAM_IDS = [
  'PILOT_SPEED_UP',
  'PILOT_SPEED_DN',
  'PILOT_SPEED',
  'PILOT_ACCEL_Z',
  'PILOT_THR_FILT',
  'SURFACE_DEPTH',
  'SURFACE_MAX_THR'
] as const
// Sub joystick gain ladder — the surface-side gain step controller. The
// operator selects a step between JS_GAIN_MIN and JS_GAIN_MAX in
// JS_GAIN_STEPS increments; JS_GAIN_DEFAULT picks the boot step.
// JS_THR_GAIN and JS_LIGHTS_STEPS are the throttle-channel scalar and
// the light-step count. Joystick BUTTON bindings (BTNn_FUNCTION /
// SFUNCTION) are NOT in this list — those are receiver-view material,
// not tuning.
export const TUNING_SUB_JOYSTICK_PARAM_IDS = [
  'JS_GAIN_DEFAULT',
  'JS_GAIN_MAX',
  'JS_GAIN_MIN',
  'JS_GAIN_STEPS',
  'JS_THR_GAIN',
  'JS_LIGHTS_STEPS'
] as const
// Full membership set used by the scoped-draft predicate (review/apply scope).
export const TUNING_SUB_PARAM_IDS = [
  ...TUNING_SUB_RATE_GROUPS.flatMap((group) => group.paramIds),
  ...TUNING_SUB_ANGLE_PARAM_IDS,
  ...TUNING_SUB_DEPTH_PARAM_IDS,
  ...TUNING_SUB_PILOT_PARAM_IDS,
  ...TUNING_SUB_JOYSTICK_PARAM_IDS
] as const
export const TUNING_ROLL_PITCH_LINK_MAP = {
  ATC_RAT_RLL_P: 'ATC_RAT_PIT_P',
  ATC_RAT_RLL_I: 'ATC_RAT_PIT_I',
  ATC_RAT_RLL_D: 'ATC_RAT_PIT_D',
  ATC_RAT_RLL_FF: 'ATC_RAT_PIT_FF',
  ATC_RAT_RLL_D_FF: 'ATC_RAT_PIT_D_FF',
  ATC_RAT_RLL_IMAX: 'ATC_RAT_PIT_IMAX',
  ATC_RAT_RLL_PDMX: 'ATC_RAT_PIT_PDMX',
  ATC_RAT_RLL_SMAX: 'ATC_RAT_PIT_SMAX',
  ATC_RAT_RLL_FLTT: 'ATC_RAT_PIT_FLTT',
  ATC_RAT_RLL_FLTE: 'ATC_RAT_PIT_FLTE',
  ATC_RAT_RLL_FLTD: 'ATC_RAT_PIT_FLTD'
} as const
