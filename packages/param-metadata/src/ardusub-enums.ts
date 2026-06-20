// ArduSub flight mode labels. Keys are the numeric values reported by
// HEARTBEAT.custom_mode on Sub builds (ArduPilot Sub `mode.h`
// `Mode::Number`). Previously a real Sub fell back to the Copter mode
// table; this gives it correct mode names. The map is intentionally sparse:
// numbers 5, 6, 8, 10-15, 17-18 and 22+ are unassigned in firmware (no Sub
// mode), so they are left as gaps rather than invented.
// sourced from ArduPilot ArduSub/mode.h enum class Mode::Number (master)
export const ARDUSUB_FLIGHT_MODE_LABELS: Record<number, string> = {
  0: 'Stabilize',
  1: 'Acro',
  2: 'Alt Hold',
  3: 'Auto',
  4: 'Guided',
  7: 'Circle',
  9: 'Surface',
  16: 'Pos Hold',
  19: 'Manual',
  20: 'Motor Detect',
  21: 'Surftrak'
}

export function ardusubFlightModeLabel(modeNumber: number | undefined): string | undefined {
  return modeNumber === undefined ? undefined : ARDUSUB_FLIGHT_MODE_LABELS[modeNumber]
}

export function formatArdusubFlightMode(modeNumber: number | undefined): string {
  return ardusubFlightModeLabel(modeNumber) ?? (modeNumber === undefined ? 'Unknown' : `Mode ${modeNumber}`)
}

// ArduSub frame/thruster layout for FRAME_CONFIG.
// Verbatim from ArduPilot ArduSub/Parameters.cpp @Param: FRAME_CONFIG @Values
// (master): 0:BlueROV1, 1:Vectored, 2:Vectored_6DOF, 3:Vectored_6DOF_90,
// 4:SimpleROV-3, 5:SimpleROV-4, 6:SimpleROV-5, 7:Custom. The first cut of the
// catalog was missing 5:SimpleROV-5 and listed Custom at 6 instead of 7 — a
// mislabel for a connected Sub running SimpleROV-5 or a custom motor matrix.
export const ARDUSUB_FRAME_CONFIG_LABELS: Record<number, string> = {
  0: 'BlueROV1',
  1: 'Vectored',
  2: 'Vectored 6DOF',
  3: 'Vectored 6DOF 90°',
  4: 'SimpleROV-3',
  5: 'SimpleROV-4',
  6: 'SimpleROV-5',
  7: 'Custom'
}

// ArduSub joystick button function values for BTNn_FUNCTION / BTNn_SFUNCTION.
// Verbatim from ArduPilot libraries/AP_JSButton/AP_JSButton.cpp @Param: FUNCTION
// / SFUNCTION @Values (master) — the shifted (SFUNCTION) variant shares the
// identical value set. Since a Sub has no RC mode switch, mode selection and
// nearly all in-dive actions are bound to joystick buttons through these
// parameters, so a connected Sub reports up to 32 BTNn_FUNCTION +
// BTNn_SFUNCTION entries that are meaningless without this map. Labels are the
// raw firmware tokens (snake_case) so they match the ArduSub/QGroundControl
// joystick docs verbatim. Numbers are intentionally sparse (the firmware
// leaves 14-20, 28-30, 37-40, 50, 60, 88-90, 97-100 unassigned).
export const ARDUSUB_BUTTON_FUNCTION_LABELS: Record<number, string> = {
  0: 'Disabled',
  1: 'shift',
  2: 'arm_toggle',
  3: 'arm',
  4: 'disarm',
  5: 'mode_manual',
  6: 'mode_stabilize',
  7: 'mode_depth_hold',
  8: 'mode_poshold',
  9: 'mode_auto',
  10: 'mode_circle',
  11: 'mode_guided',
  12: 'mode_acro',
  13: 'mode_surftrak',
  21: 'mount_center',
  22: 'mount_tilt_up',
  23: 'mount_tilt_down',
  24: 'camera_trigger',
  25: 'camera_source_toggle',
  26: 'mount_pan_right',
  27: 'mount_pan_left',
  31: 'lights1_cycle',
  32: 'lights1_brighter',
  33: 'lights1_dimmer',
  34: 'lights2_cycle',
  35: 'lights2_brighter',
  36: 'lights2_dimmer',
  41: 'gain_toggle',
  42: 'gain_inc',
  43: 'gain_dec',
  44: 'trim_roll_inc',
  45: 'trim_roll_dec',
  46: 'trim_pitch_inc',
  47: 'trim_pitch_dec',
  48: 'input_hold_set',
  49: 'roll_pitch_toggle',
  51: 'relay_1_on',
  52: 'relay_1_off',
  53: 'relay_1_toggle',
  54: 'relay_2_on',
  55: 'relay_2_off',
  56: 'relay_2_toggle',
  57: 'relay_3_on',
  58: 'relay_3_off',
  59: 'relay_3_toggle',
  61: 'actuator_1_inc',
  62: 'actuator_1_dec',
  63: 'actuator_1_min',
  64: 'actuator_1_max',
  65: 'actuator_1_center',
  66: 'actuator_2_inc',
  67: 'actuator_2_dec',
  68: 'actuator_2_min',
  69: 'actuator_2_max',
  70: 'actuator_2_center',
  71: 'actuator_3_inc',
  72: 'actuator_3_dec',
  73: 'actuator_3_min',
  74: 'actuator_3_max',
  75: 'actuator_3_center',
  76: 'actuator_1_min_momentary',
  77: 'actuator_1_max_momentary',
  78: 'actuator_1_min_toggle',
  79: 'actuator_1_max_toggle',
  80: 'actuator_2_min_momentary',
  81: 'actuator_2_max_momentary',
  82: 'actuator_2_min_toggle',
  83: 'actuator_2_max_toggle',
  84: 'actuator_3_min_momentary',
  85: 'actuator_3_max_momentary',
  86: 'actuator_3_min_toggle',
  87: 'actuator_3_max_toggle',
  91: 'custom_1',
  92: 'custom_2',
  93: 'custom_3',
  94: 'custom_4',
  95: 'custom_5',
  96: 'custom_6',
  101: 'relay_4_on',
  102: 'relay_4_off',
  103: 'relay_4_toggle',
  104: 'relay_1_momentary',
  105: 'relay_2_momentary',
  106: 'relay_3_momentary',
  107: 'relay_4_momentary',
  108: 'script_1',
  109: 'script_2',
  110: 'script_3',
  111: 'script_4',
  112: 'actuator_4_min',
  113: 'actuator_4_max',
  114: 'actuator_4_center',
  115: 'actuator_4_inc',
  116: 'actuator_4_dec',
  117: 'actuator_4_min_momentary',
  118: 'actuator_4_max_momentary',
  119: 'actuator_4_min_toggle',
  120: 'actuator_4_max_toggle',
  121: 'actuator_5_min',
  122: 'actuator_5_max',
  123: 'actuator_5_center',
  124: 'actuator_5_inc',
  125: 'actuator_5_dec',
  126: 'actuator_5_min_momentary',
  127: 'actuator_5_max_momentary',
  128: 'actuator_5_min_toggle',
  129: 'actuator_5_max_toggle',
  130: 'actuator_6_min',
  131: 'actuator_6_max',
  132: 'actuator_6_center',
  133: 'actuator_6_inc',
  134: 'actuator_6_dec',
  135: 'actuator_6_min_momentary',
  136: 'actuator_6_max_momentary',
  137: 'actuator_6_min_toggle',
  138: 'actuator_6_max_toggle'
}

// ArduSub mission yaw behaviour for WP_YAW_BEHAVIOR.
// Verbatim from ArduPilot ArduSub/Parameters.cpp @Param: WP_YAW_BEHAVIOR @Values.
export const ARDUSUB_WP_YAW_BEHAVIOR_LABELS: Record<number, string> = {
  0: 'Never change yaw',
  1: 'Face next waypoint',
  2: 'Face next waypoint except RTL',
  3: 'Face along GPS course',
  4: 'Correct crosstrack error'
}

// ArduSub terrain-failsafe action for FS_TERRAIN_ENAB.
// Verbatim from ArduPilot ArduSub/Parameters.cpp @Param: FS_TERRAIN_ENAB @Values.
export const ARDUSUB_TERRAIN_FS_LABELS: Record<number, string> = {
  0: 'Disarm',
  1: 'Hold Position',
  2: 'Surface'
}

// ArduSub battery-failsafe action values for BATT_FS_LOW_ACT / BATT_FS_CRT_ACT.
// Verbatim from ArduPilot AP_BattMonitor_Params.cpp @Values{Sub} (low and
// critical share the same set). Sub has no value 1; value 2 is "Disarm" and 3
// is "Enter surface mode" — nothing like the Copter enum, so a connected Sub
// must not be labelled with the Copter map (safety-relevant).
export const ARDUSUB_BATTERY_FAILSAFE_ACTION_LABELS: Record<number, string> = {
  0: 'Warn only',
  2: 'Disarm',
  3: 'Enter surface mode'
}
