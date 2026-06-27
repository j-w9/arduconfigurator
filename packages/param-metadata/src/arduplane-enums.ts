// ArduPlane flight mode labels. Sourced from ArduPilot's mode_reason / Plane
// firmware mode tables. Keys are the numeric mode values reported by
// HEARTBEAT.custom_mode and the FLTMODE<n> parameter family on Plane builds.
//
// This module is the first piece of multi-firmware metadata in the catalog and
// is currently consumed only via direct imports for follow-up work (Modes view
// firmware-aware label resolution). The arducopter metadata bundle remains the
// default for now.
// sourced from ArduPilot ArduPlane/mode.h enum Mode::Number (master)
export const ARDUPLANE_FLIGHT_MODE_LABELS: Record<number, string> = {
  0: 'Manual',
  1: 'Circle',
  2: 'Stabilize',
  3: 'Training',
  4: 'Acro',
  5: 'FBWA',
  6: 'FBWB',
  7: 'Cruise',
  8: 'Autotune',
  10: 'Auto',
  11: 'RTL',
  12: 'Loiter',
  13: 'Takeoff',
  14: 'Avoid ADS-B',
  15: 'Guided',
  16: 'Initialising',
  17: 'QStabilize',
  18: 'QHover',
  19: 'QLoiter',
  20: 'QLand',
  21: 'QRTL',
  22: 'QAutotune',
  23: 'QAcro',
  24: 'Thermal',
  25: 'Loiter alt to QLand',
  26: 'Autoland'
}

export function arduplaneFlightModeLabel(modeNumber: number | undefined): string | undefined {
  return modeNumber === undefined ? undefined : ARDUPLANE_FLIGHT_MODE_LABELS[modeNumber]
}

export function formatArduplaneFlightMode(modeNumber: number | undefined): string {
  return arduplaneFlightModeLabel(modeNumber) ?? (modeNumber === undefined ? 'Unknown' : `Mode ${modeNumber}`)
}

// ArduPlane long-failsafe action values for the FS_LONG_ACTN parameter. The
// long failsafe fires after FS_LONG_TIMEOUT seconds without a valid RC/GCS link.
// sourced from ArduPilot ArduPlane/Parameters.cpp @Param: FS_LONG_ACTN @Values
export const ARDUPLANE_FS_LONG_ACTN_LABELS: Record<number, string> = {
  0: 'Continue',
  1: 'RTL',
  2: 'Glide',
  3: 'Deploy Parachute',
  4: 'Auto',
  5: 'AUTOLAND'
}

// ArduPlane short-failsafe action values for the FS_SHORT_ACTN parameter. The
// short failsafe fires after FS_SHORT_TIMEOUT seconds of a lost link and is
// intended as a recoverable holding action.
// sourced from ArduPilot ArduPlane/Parameters.cpp @Param: FS_SHORT_ACTN @Values
export const ARDUPLANE_FS_SHORT_ACTN_LABELS: Record<number, string> = {
  0: 'Circle / no change (if already in Auto, Guided or Loiter)',
  1: 'Circle',
  2: 'FBWA at zero throttle',
  3: 'Disable',
  4: 'FBWB'
}

// ArduPlane battery-failsafe action values for BATT_FS_LOW_ACT / BATT_FS_CRT_ACT.
// Verbatim from ArduPilot AP_BattMonitor_Params.cpp @Values{Plane}. These differ
// from the Copter set (e.g. value 2 is "Land" on Plane but "RTL" on Copter), so
// a connected Plane MUST NOT be labelled with the Copter enum. Low and critical
// differ only at value 5.
export const ARDUPLANE_BATTERY_FAILSAFE_LOW_ACTION_LABELS: Record<number, string> = {
  0: 'Warn only',
  1: 'RTL',
  2: 'Land',
  3: 'Terminate',
  4: 'QLand',
  5: 'Parachute release',
  6: 'Loiter to QLand',
  7: 'AUTOLAND or RTL'
}

export const ARDUPLANE_BATTERY_FAILSAFE_CRT_ACTION_LABELS: Record<number, string> = {
  0: 'Warn only',
  1: 'RTL',
  2: 'Land',
  3: 'Terminate',
  4: 'QLand',
  5: 'Parachute',
  6: 'Loiter to QLand',
  7: 'AUTOLAND or RTL'
}

export function arduplaneLongFailsafeActionLabel(value: number | undefined): string | undefined {
  return value === undefined ? undefined : ARDUPLANE_FS_LONG_ACTN_LABELS[value]
}

export function arduplaneShortFailsafeActionLabel(value: number | undefined): string | undefined {
  return value === undefined ? undefined : ARDUPLANE_FS_SHORT_ACTN_LABELS[value]
}

export function formatArduplaneLongFailsafeAction(value: number | undefined): string {
  return arduplaneLongFailsafeActionLabel(value) ?? (value === undefined ? 'Unknown' : `Action ${value}`)
}

export function formatArduplaneShortFailsafeAction(value: number | undefined): string {
  return arduplaneShortFailsafeActionLabel(value) ?? (value === undefined ? 'Unknown' : `Action ${value}`)
}

// ArduPlane QuadPlane frame class values for the Q_FRAME_CLASS parameter. The
// numeric values mirror ArduCopter's FRAME_CLASS table where the geometries
// overlap, since QuadPlane reuses the multirotor mixer.
export const ARDUPLANE_Q_FRAME_CLASS_LABELS: Record<number, string> = {
  0: 'Undefined',
  1: 'Quad',
  2: 'Hexa',
  3: 'Octa',
  4: 'OctaQuad',
  5: 'Y6',
  7: 'Tri',
  10: 'Tailsitter',
  12: 'DodecaHexa',
  14: 'Deca',
  15: 'Scripting Matrix'
}

// ArduPlane QuadPlane frame type values for the Q_FRAME_TYPE parameter. The
// numeric values mirror ArduCopter's FRAME_TYPE table for the geometries that
// QuadPlane supports.
export const ARDUPLANE_Q_FRAME_TYPE_LABELS: Record<number, string> = {
  0: 'Plus',
  1: 'X',
  2: 'V',
  3: 'H',
  4: 'V-Tail',
  5: 'A-Tail',
  10: 'Y6B',
  11: 'Y6F',
  12: 'BetaFlight X',
  13: 'DJI X',
  14: 'Clockwise X',
  15: 'I',
  18: 'BetaFlight X Reversed',
  19: 'Y4'
}

// Q_TILT_TYPE — tiltrotor mechanism geometry (ArduPlane tiltrotor.cpp).
export const ARDUPLANE_Q_TILT_TYPE_LABELS: Record<number, string> = {
  0: 'Continuous',
  1: 'Binary',
  2: 'Vectored Yaw',
  3: 'Bicopter'
}

// Q_TILT_MASK — bitmask of which motors tilt for forward flight (bit 0 = motor 1).
export const ARDUPLANE_Q_TILT_MASK_BIT_LABELS: Record<number, string> = {
  0: 'Motor 1',
  1: 'Motor 2',
  2: 'Motor 3',
  3: 'Motor 4',
  4: 'Motor 5',
  5: 'Motor 6',
  6: 'Motor 7',
  7: 'Motor 8'
}

// Q_TRANS_FAIL_ACT — action when the forward-transition failure timer elapses.
export const ARDUPLANE_Q_TRANS_FAIL_ACT_LABELS: Record<number, string> = {
  [-1]: 'Warn only',
  0: 'QLand',
  1: 'QRTL'
}

// Q_RTL_MODE — how an RTL behaves on a QuadPlane.
export const ARDUPLANE_Q_RTL_MODE_LABELS: Record<number, string> = {
  0: 'Disabled',
  1: 'Enabled (QRTL near home)',
  2: 'VTOL approach',
  3: 'QRTL always'
}

// Q_TAILSIT_ENABLE — tailsitter functionality (ArduPlane tailsitter.cpp).
export const ARDUPLANE_Q_TAILSIT_ENABLE_LABELS: Record<number, string> = {
  0: 'Disable',
  1: 'Enable',
  2: 'Enable Always'
}

// Q_TAILSIT_INPUT — stick-input convention bitmask when hovering.
export const ARDUPLANE_Q_TAILSIT_INPUT_BIT_LABELS: Record<number, string> = {
  0: 'Plane Mode',
  1: 'Body-frame Roll'
}

// Q_TAILSIT_MOTMX — motors kept active in forward flight (copter tailsitter).
export const ARDUPLANE_Q_TAILSIT_MOTMX_BIT_LABELS: Record<number, string> = {
  0: 'Motor 1',
  1: 'Motor 2',
  2: 'Motor 3',
  3: 'Motor 4',
  4: 'Motor 5',
  5: 'Motor 6',
  6: 'Motor 7',
  7: 'Motor 8'
}

// Q_TAILSIT_GSCMSK — gain-scaling methods applied (bitmask).
export const ARDUPLANE_Q_TAILSIT_GSCMSK_BIT_LABELS: Record<number, string> = {
  0: 'Throttle',
  1: 'Attitude/Throttle',
  2: 'Disk Theory',
  3: 'Altitude correction'
}

export function formatArduplaneQFrameClass(value: number | undefined): string {
  return ARDUPLANE_Q_FRAME_CLASS_LABELS[value ?? Number.NaN] ?? (value === undefined ? 'Unknown' : `Frame class ${value}`)
}

export function formatArduplaneQFrameType(value: number | undefined): string {
  return ARDUPLANE_Q_FRAME_TYPE_LABELS[value ?? Number.NaN] ?? (value === undefined ? 'Unknown' : `Frame type ${value}`)
}

// ArduPlane QuadPlane lift-motor PWM protocol values for the Q_M_PWM_TYPE
// parameter. The numeric values mirror ArduCopter's MOT_PWM_TYPE table because
// QuadPlane reuses the multirotor motors library for its lift-motor outputs.
export const ARDUPLANE_Q_M_PWM_TYPE_LABELS: Record<number, string> = {
  0: 'Normal',
  1: 'OneShot',
  2: 'OneShot125',
  3: 'Brushed',
  4: 'DShot150',
  5: 'DShot300',
  6: 'DShot600',
  7: 'DShot1200',
  8: 'PWMRange'
}

export function formatArduplaneQMotorPwmType(value: number | undefined): string {
  return ARDUPLANE_Q_M_PWM_TYPE_LABELS[value ?? Number.NaN] ?? (value === undefined ? 'Unknown' : `Motor PWM type ${value}`)
}

// ArduPlane airspeed-sensor type for ARSPD_TYPE. Verbatim from ArduPilot
// AP_Airspeed_Params.cpp @Values{Plane}.
export const ARDUPLANE_ARSPD_TYPE_LABELS: Record<number, string> = {
  0: 'None',
  1: 'I2C-MS4525D0',
  2: 'Analog',
  3: 'I2C-MS5525',
  4: 'I2C-MS5525 (0x76)',
  5: 'I2C-MS5525 (0x77)',
  6: 'I2C-SDP3X',
  7: 'I2C-DLVR-5in',
  8: 'DroneCAN',
  9: 'I2C-DLVR-10in',
  10: 'I2C-DLVR-20in',
  11: 'I2C-DLVR-30in',
  12: 'I2C-DLVR-60in',
  13: 'NMEA water speed',
  14: 'MSP',
  15: 'ASP5033',
  16: 'ExternalAHRS',
  17: 'AUAV-10in',
  18: 'AUAV-5in',
  19: 'AUAV-30in',
  100: 'SITL'
}

// ARSPD_USE: whether airspeed feeds the automatic throttle modes.
export const ARDUPLANE_ARSPD_USE_LABELS: Record<number, string> = {
  0: 'Do not use',
  1: 'Use',
  2: 'Use when zero throttle'
}

// ARSPD_SKIP_CAL: startup offset-calibration behaviour.
export const ARDUPLANE_ARSPD_SKIP_CAL_LABELS: Record<number, string> = {
  0: 'Calibrate on startup',
  1: 'Do not require offset calibration before flight',
  2: 'Do not calibrate on startup'
}

// RTL_AUTOLAND: what ArduPlane does at the end of an RTL. Verbatim from
// ArduPlane/Parameters.cpp @Values.
export const ARDUPLANE_RTL_AUTOLAND_LABELS: Record<number, string> = {
  0: 'Disabled',
  1: 'Fly HOME then land (DO_LAND_START)',
  2: 'Go directly to landing sequence (DO_LAND_START)',
  3: 'Only for go-around',
  4: 'Go directly to landing sequence (DO_RETURN_PATH_START)'
}

// LAND_THEN_NEUTRL: servo state after an automatic landing + disarm.
export const ARDUPLANE_LAND_THEN_NEUTRL_LABELS: Record<number, string> = {
  0: 'Disabled',
  1: 'Servos to neutral',
  2: 'Servos to zero PWM'
}

// LAND_TYPE: which automatic-landing algorithm to use.
export const ARDUPLANE_LAND_TYPE_LABELS: Record<number, string> = {
  0: 'Standard glide slope',
  1: 'Deepstall'
}

// ADSB_TYPE: ADS-B transceiver hardware. Verbatim from AP_ADSB/AP_ADSB.cpp
// @Values (master).
export const ARDUPLANE_ADSB_TYPE_LABELS: Record<number, string> = {
  0: 'Disabled',
  1: 'uAvionix-MAVLink',
  2: 'Sagetech',
  3: 'uAvionix-UCP',
  4: 'Sagetech MX Series'
}

// ADSB_EMIT_TYPE: aircraft emitter classification advertised by the
// transponder. Verbatim from AP_ADSB/AP_ADSB.cpp @Values.
export const ARDUPLANE_ADSB_EMIT_TYPE_LABELS: Record<number, string> = {
  0: 'NoInfo',
  1: 'Light',
  2: 'Small',
  3: 'Large',
  4: 'HighVortexlarge',
  5: 'Heavy',
  6: 'HighlyManuv',
  7: 'Rotocraft',
  8: 'RESERVED',
  9: 'Glider',
  10: 'LightAir',
  11: 'Parachute',
  12: 'UltraLight',
  13: 'RESERVED',
  14: 'UAV',
  15: 'Space',
  16: 'RESERVED',
  17: 'EmergencySurface',
  18: 'ServiceSurface',
  19: 'PointObstacle'
}

// ADSB_LEN_WIDTH: airframe length/width bucket reported to ground stations.
// Verbatim from AP_ADSB/AP_ADSB.cpp @Values.
export const ARDUPLANE_ADSB_LEN_WIDTH_LABELS: Record<number, string> = {
  0: 'NO_DATA',
  1: 'L15W23',
  2: 'L25W28P5',
  3: 'L25W34',
  4: 'L35W33',
  5: 'L35W38',
  6: 'L45W39P5',
  7: 'L45W45',
  8: 'L55W45',
  9: 'L55W52',
  10: 'L65W59P5',
  11: 'L65W67',
  12: 'L75W72P5',
  13: 'L75W80',
  14: 'L85W80',
  15: 'L85W90'
}

// ADSB_OFFSET_LAT: GPS antenna lateral offset from the airframe centerline.
// Verbatim from AP_ADSB/AP_ADSB.cpp @Values.
export const ARDUPLANE_ADSB_OFFSET_LAT_LABELS: Record<number, string> = {
  0: 'NoData',
  1: 'Left2m',
  2: 'Left4m',
  3: 'Left6m',
  4: 'Center',
  5: 'Right2m',
  6: 'Right4m',
  7: 'Right6m'
}

// ADSB_OFFSET_LON: GPS antenna longitudinal offset. Verbatim from
// AP_ADSB/AP_ADSB.cpp @Values.
export const ARDUPLANE_ADSB_OFFSET_LON_LABELS: Record<number, string> = {
  0: 'NO_DATA',
  1: 'AppliedBySensor'
}

// ADSB_LOG: ADS-B logging verbosity. Verbatim from AP_ADSB/AP_ADSB.cpp @Values.
export const ARDUPLANE_ADSB_LOG_LABELS: Record<number, string> = {
  0: 'no logging',
  1: 'log only special ID',
  2: 'log all'
}

// ADSB_RF_SELECT: receive/transmit enable bits. Bit indices, verbatim from
// AP_ADSB/AP_ADSB.cpp @Bitmask.
export const ARDUPLANE_ADSB_RF_SELECT_BIT_LABELS: Record<number, string> = {
  0: 'Rx',
  1: 'Tx'
}

// ADSB_RF_CAPABLE: hardware RF in/out capability advertisement. Bit indices,
// verbatim from AP_ADSB/AP_ADSB.cpp @Bitmask.
export const ARDUPLANE_ADSB_RF_CAPABLE_BIT_LABELS: Record<number, string> = {
  0: 'UAT_in',
  1: '1090ES_in',
  2: 'UAT_out',
  3: '1090ES_out'
}

// ADSB_OPTIONS: emergency failsafe codes and device-capability options. Bit
// indices, verbatim from AP_ADSB/AP_ADSB.cpp @Bitmask.
export const ARDUPLANE_ADSB_OPTIONS_BIT_LABELS: Record<number, string> = {
  0: 'Ping200X Send GPS',
  1: 'Squawk 7400 on RC failsafe',
  2: 'Squawk 7400 on GCS failsafe',
  3: 'Sagetech MXS use External Config',
  4: 'Transmit in traditional Mode 3A/C only and inhibit Mode-S and ES (ADSB) transmissions'
}

// SOAR_ENABLE: soaring (autonomous thermalling) master switch. Verbatim from
// AP_Soaring/AP_Soaring.cpp @Values.
export const ARDUPLANE_SOAR_ENABLE_LABELS: Record<number, string> = {
  0: 'Disable',
  1: 'Enable'
}

// AVD_F_ACTION: imminent-collision avoidance behaviour. Verbatim from
// AC_Avoidance/AP_Avoidance.cpp @Values.
export const ARDUPLANE_AVD_F_ACTION_LABELS: Record<number, string> = {
  0: 'None',
  1: 'Report',
  2: 'Climb Or Descend',
  3: 'Move Horizontally',
  4: 'Move Perpendicularly in 3D',
  5: 'RTL',
  6: 'Hover'
}

// AVD_W_ACTION: possible-collision (warn) behaviour. Verbatim from
// AC_Avoidance/AP_Avoidance.cpp @Values.
export const ARDUPLANE_AVD_W_ACTION_LABELS: Record<number, string> = {
  0: 'None',
  1: 'Report'
}

// AVD_F_RCVRY: recovery behaviour after a fail event resolves. Verbatim from
// AC_Avoidance/AP_Avoidance.cpp @Values.
export const ARDUPLANE_AVD_F_RCVRY_LABELS: Record<number, string> = {
  0: 'Remain in AVOID_ADSB',
  1: 'Resume previous flight mode',
  2: 'RTL',
  3: 'Resume if AUTO else Loiter'
}

// Q_AUTOTUNE_AXES: which VTOL axes the QuadPlane AutoTune (QAUTOTUNE) mode
// refines. The QuadPlane uses the shared AC_AutoTune_Multi library, so the
// bitmask is verbatim from libraries/AC_AutoTune/AC_AutoTune_Multi.cpp
// var_info[] @Bitmask (0:Roll,1:Pitch,2:Yaw,3:YawD).
export const ARDUPLANE_Q_AUTOTUNE_AXES_BIT_LABELS: Record<number, string> = {
  0: 'Roll',
  1: 'Pitch',
  2: 'Yaw',
  3: 'YawD'
}

// AUTOTUNE_AXES: which axes the fixed-wing AutoTune mode refines. Verbatim
// from ArduPlane/Parameters.cpp var_info @Bitmask (0:Roll,1:Pitch,2:Yaw).
// Distinct from Q_AUTOTUNE_AXES (the QuadPlane VTOL set, which also has YawD).
export const ARDUPLANE_AUTOTUNE_AXES_BIT_LABELS: Record<number, string> = {
  0: 'Roll',
  1: 'Pitch',
  2: 'Yaw'
}

// AUTOTUNE_OPTIONS: fixed-wing AutoTune options. Verbatim from
// ArduPlane/Parameters.cpp @Bitmask.
export const ARDUPLANE_AUTOTUNE_OPTIONS_BIT_LABELS: Record<number, string> = {
  0: 'Disable FLTD update by Autotune',
  1: 'Disable FLTT update by Autotune'
}
