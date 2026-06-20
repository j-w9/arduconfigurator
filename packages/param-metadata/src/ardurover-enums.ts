// ArduRover flight mode labels. Keys are the numeric values reported by
// HEARTBEAT.custom_mode and the MODE<n> parameter family on Rover/Boat
// builds (ArduPilot Rover `mode.h` `Mode::Number`). Rover and Sub were
// previously detected but fell back to the Copter mode table, so a real
// Rover showed Copter mode names — this is the real-vehicle fix. Numbers 2,
// 13 and 14 are intentionally unassigned in firmware (no Rover mode), so they
// are left as gaps rather than invented.
// sourced from ArduPilot Rover/mode.h enum class Mode::Number (master)
export const ARDUROVER_FLIGHT_MODE_LABELS: Record<number, string> = {
  0: 'Manual',
  1: 'Acro',
  3: 'Steering',
  4: 'Hold',
  5: 'Loiter',
  6: 'Follow',
  7: 'Simple',
  8: 'Dock',
  9: 'Circle',
  10: 'Auto',
  11: 'RTL',
  12: 'SmartRTL',
  15: 'Guided',
  16: 'Initialising'
}

export function arduroverFlightModeLabel(modeNumber: number | undefined): string | undefined {
  return modeNumber === undefined ? undefined : ARDUROVER_FLIGHT_MODE_LABELS[modeNumber]
}

export function formatArduroverFlightMode(modeNumber: number | undefined): string {
  return arduroverFlightModeLabel(modeNumber) ?? (modeNumber === undefined ? 'Unknown' : `Mode ${modeNumber}`)
}

// WindVane direction-sensor type for WNDVN_TYPE.
// Verbatim from ArduPilot libraries/AP_WindVane/AP_WindVane.cpp @Param: TYPE
// @Values (registered under the "WNDVN_" prefix by Rover/Parameters.cpp
// AP_SUBGROUPINFO(windvane, "WNDVN_", ...)).
export const ARDUROVER_WNDVN_TYPE_LABELS: Record<number, string> = {
  0: 'None',
  1: 'Heading when armed',
  2: 'RC input offset heading when armed',
  3: 'Analog',
  4: 'NMEA',
  10: 'SITL true',
  11: 'SITL apparent'
}

// WindVane speed-sensor type for WNDVN_SPEED_TYPE.
// Verbatim from AP_WindVane.cpp @Param: SPEED_TYPE @Values.
export const ARDUROVER_WNDVN_SPEED_TYPE_LABELS: Record<number, string> = {
  0: 'None',
  1: 'Airspeed library',
  2: 'Modern Devices Wind Sensor',
  3: 'RPM library',
  4: 'NMEA',
  10: 'SITL true',
  11: 'SITL apparent'
}

// WindVane calibration trigger for WNDVN_CAL.
// Verbatim from AP_WindVane.cpp @Param: CAL @Values.
export const ARDUROVER_WNDVN_CAL_LABELS: Record<number, string> = {
  0: 'None',
  1: 'Calibrate direction',
  2: 'Calibrate speed'
}

// Analog input pin values shared by WNDVN_DIR_PIN / WNDVN_SPEED_PIN /
// WNDVN_TEMP_PIN. Verbatim from AP_WindVane.cpp @Values for those pins.
export const ARDUROVER_WNDVN_ANALOG_PIN_LABELS: Record<number, string> = {
  11: 'Pixracer',
  13: 'Pixhawk ADC4',
  14: 'Pixhawk ADC3',
  15: 'Pixhawk ADC6/Pixhawk2 ADC',
  50: 'AUX1',
  51: 'AUX2',
  52: 'AUX3',
  53: 'AUX4',
  54: 'AUX5',
  55: 'AUX6',
  103: 'Pixhawk SBUS'
}

// ArduRover battery-failsafe action values for BATT_FS_LOW_ACT / BATT_FS_CRT_ACT.
// Verbatim from ArduPilot AP_BattMonitor_Params.cpp @Values{Rover} (low and
// critical share the same set). Differs from the Copter enum (value 2 is "Hold"
// on Rover, "RTL" on Copter), so a connected Rover must not use the Copter map.
export const ARDUROVER_BATTERY_FAILSAFE_ACTION_LABELS: Record<number, string> = {
  0: 'Warn only',
  1: 'RTL',
  2: 'Hold',
  3: 'SmartRTL',
  4: 'SmartRTL or Hold',
  5: 'Terminate',
  6: 'Loiter or Hold'
}
