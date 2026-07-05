// AP_RC_Logic — the "RC logic / range-function engine" parameter family (RCL_*).
// Betaflight/INAV-style Modes/Adjustments for ArduPilot: a flat table of terms
// that activate AUX functions from RC channel PWM ranges. The firmware is the
// source of truth (development/ardupilot libraries/AP_RC_Logic/README.md) — this
// mirrors that schema so the RC Mixer tab can bind to it.
//
// Schema (subgroup "RCL" on AP_Vehicle, index 33):
//   RCL_ENABLE                         Int8   0=off 1=on (detection gate)
//   RCL<n>_FUNC  (n = 1..12)           Int16  target AUX_FUNC (0 = row disabled)
//   RCL<n>_OPT                         Int16  bits 0-1 source type, 2 combine(AND), 3 negate
//   RCL<n>_SRC                         Int16  range: RC ch 1-16; link: AUX_FUNC; condition: id
//   RCL<n>_MIN / _MAX                  Int16  range PWM bounds (800..2200)
//   RCL<n>_VAL                         Int8   continuous-adjust value channel (0=none, reserved)

import type { FirmwareMetadataBundle, ParameterDefinition, ParameterValueOption } from './types.js'

/** UI/category id — routes the RCL family to the RC Mixer view. */
export const RC_LOGIC_CATEGORY = 'rc-mixer'

/** Table size — matches AP_RC_LOGIC_NUM_TERMS (default 12). */
export const RC_LOGIC_NUM_TERMS = 12

/** OPT bit layout (mirrors AP_RC_Logic.cpp @Bitmask). Source type is the 2-bit
 *  field in bits 0-1: 0=range, 1=link, 2=condition. */
export const RC_LOGIC_OPT_SOURCE_TYPE_MASK = 0x3
export const RC_LOGIC_OPT_COMBINE_AND_BIT = 2
export const RC_LOGIC_OPT_NEGATE_BIT = 3

export enum RcLogicSourceType {
  Range = 0,
  Link = 1,
  Condition = 2
}

/** Full ArduCopter AUX_FUNC value list (from RC_Channel.cpp RCn_OPTION @Values,
 *  Copter-applicable). RCL<n>_FUNC reuses this exact list (@CopyFieldsFrom
 *  RC1_OPTION in the firmware). */
export const RC_LOGIC_AUX_FUNCTION_OPTIONS: readonly ParameterValueOption[] = [
  { value: 0, label: "Do Nothing" },
  { value: 2, label: "FLIP Mode" },
  { value: 3, label: "Simple Mode" },
  { value: 4, label: "RTL" },
  { value: 5, label: "Save Trim" },
  { value: 7, label: "Save WP" },
  { value: 9, label: "Camera Trigger" },
  { value: 10, label: "RangeFinder Enable" },
  { value: 11, label: "Fence Enable" },
  { value: 13, label: "Super Simple Mode" },
  { value: 14, label: "Acro Trainer" },
  { value: 15, label: "Sprayer Enable" },
  { value: 16, label: "AUTO Mode" },
  { value: 17, label: "AUTOTUNE Mode" },
  { value: 18, label: "LAND Mode" },
  { value: 19, label: "Gripper" },
  { value: 21, label: "Parachute Enable" },
  { value: 22, label: "Parachute Release" },
  { value: 23, label: "Parachute 3pos" },
  { value: 24, label: "Auto Mission Reset" },
  { value: 25, label: "AttCon Feed Forward" },
  { value: 26, label: "AttCon Accel Limits" },
  { value: 27, label: "Retract Mount1" },
  { value: 28, label: "Relay1 On/Off" },
  { value: 29, label: "Landing Gear" },
  { value: 30, label: "Lost Copter Sound" },
  { value: 31, label: "Motor Emergency Stop" },
  { value: 32, label: "Motor Interlock" },
  { value: 33, label: "BRAKE Mode" },
  { value: 34, label: "Relay2 On/Off" },
  { value: 35, label: "Relay3 On/Off" },
  { value: 36, label: "Relay4 On/Off" },
  { value: 37, label: "THROW Mode" },
  { value: 38, label: "ADSB Avoidance Enable" },
  { value: 39, label: "PrecLoiter Enable" },
  { value: 40, label: "Proximity Avoidance Enable" },
  { value: 41, label: "ArmDisarm (4.1 and lower)" },
  { value: 42, label: "SMARTRTL Mode" },
  { value: 43, label: "InvertedFlight Enable" },
  { value: 44, label: "Winch Enable" },
  { value: 45, label: "Winch Control" },
  { value: 46, label: "RC Override Enable" },
  { value: 47, label: "User Function 1" },
  { value: 48, label: "User Function 2" },
  { value: 49, label: "User Function 3" },
  { value: 52, label: "ACRO Mode" },
  { value: 55, label: "GUIDED Mode" },
  { value: 56, label: "LOITER Mode" },
  { value: 57, label: "FOLLOW Mode" },
  { value: 58, label: "Clear Waypoints" },
  { value: 60, label: "ZigZag Mode" },
  { value: 61, label: "ZigZag SaveWP" },
  { value: 62, label: "Compass Learn" },
  { value: 65, label: "GPS Disable" },
  { value: 66, label: "Relay5 On/Off" },
  { value: 67, label: "Relay6 On/Off" },
  { value: 68, label: "STABILIZE Mode" },
  { value: 69, label: "POSHOLD Mode" },
  { value: 70, label: "ALTHOLD Mode" },
  { value: 71, label: "FLOWHOLD Mode" },
  { value: 72, label: "CIRCLE Mode" },
  { value: 73, label: "DRIFT Mode" },
  { value: 75, label: "SurfaceTrackingUpDown" },
  { value: 76, label: "STANDBY Mode" },
  { value: 78, label: "RunCam Control" },
  { value: 79, label: "RunCam OSD Control" },
  { value: 80, label: "VisOdom Align" },
  { value: 81, label: "Disarm" },
  { value: 83, label: "ZigZag Auto" },
  { value: 84, label: "AirMode" },
  { value: 85, label: "Generator" },
  { value: 90, label: "EKF Source Set" },
  { value: 94, label: "VTX Power" },
  { value: 99, label: "AUTO RTL" },
  { value: 100, label: "KillIMU1" },
  { value: 101, label: "KillIMU2" },
  { value: 102, label: "Camera Mode Toggle" },
  { value: 103, label: "EKF lane switch attempt" },
  { value: 104, label: "EKF yaw reset" },
  { value: 105, label: "GPS Disable Yaw" },
  { value: 109, label: "use Custom Controller" },
  { value: 110, label: "KillIMU3" },
  { value: 111, label: "Loweheiser starter" },
  { value: 112, label: "SwitchExternalAHRS" },
  { value: 113, label: "Retract Mount2" },
  { value: 151, label: "TURTLE Mode" },
  { value: 152, label: "SIMPLE heading reset" },
  { value: 153, label: "ArmDisarm (4.2 and higher)" },
  { value: 154, label: "ArmDisarm with AirMode  (4.2 and higher)" },
  { value: 158, label: "Optflow Calibration" },
  { value: 159, label: "Force IS_Flying" },
  { value: 161, label: "Turbine Start(heli)" },
  { value: 162, label: "FFT Tune" },
  { value: 163, label: "Mount Yaw Lock" },
  { value: 164, label: "Pause Stream Logging" },
  { value: 165, label: "Arm/Emergency Motor Stop" },
  { value: 166, label: "Camera Record Video" },
  { value: 167, label: "Camera Zoom" },
  { value: 168, label: "Camera Manual Focus" },
  { value: 169, label: "Camera Auto Focus" },
  { value: 171, label: "Calibrate Compasses" },
  { value: 172, label: "Battery MPPT Enable" },
  { value: 174, label: "Camera Image Tracking" },
  { value: 175, label: "Camera Lens" },
  { value: 177, label: "Mount LRF enable" },
  { value: 178, label: "FlightMode Pause/Resume" },
  { value: 180, label: "Test autotuned gains after tune is complete" },
  { value: 182, label: "AHRS AutoTrim" },
  { value: 185, label: "Mount Roll/Pitch Lock" },
  { value: 186, label: "Mount POI Lock" },
  { value: 187, label: "EKF Reset" },
  { value: 212, label: "Mount1 Roll" },
  { value: 213, label: "Mount1 Pitch" },
  { value: 214, label: "Mount1 Yaw" },
  { value: 215, label: "Mount2 Roll" },
  { value: 216, label: "Mount2 Pitch" },
  { value: 217, label: "Mount2 Yaw" },
  { value: 218, label: "Loweheiser throttle" },
  { value: 219, label: "Transmitter Tuning" }
]

function termParameterDefinitions(n: number): Record<string, ParameterDefinition> {
  const prefix = `RCL${n}_`
  return {
    [`${prefix}FUNC`]: {
      id: `${prefix}FUNC`,
      label: `Term ${n} · function`,
      description:
        'Auxiliary function this table row activates (0 disables the row). Same value list as an RC channel option (RCn_OPTION).',
      category: RC_LOGIC_CATEGORY,
      options: RC_LOGIC_AUX_FUNCTION_OPTIONS as ParameterValueOption[]
    },
    [`${prefix}OPT`]: {
      id: `${prefix}OPT`,
      label: `Term ${n} · options`,
      description:
        'Packed term options: bits 0-1 source type (0 range, 1 link, 2 condition), bit 2 combine (0 OR / 1 AND), bit 3 negate.',
      category: RC_LOGIC_CATEGORY,
      minimum: 0,
      maximum: 15,
      step: 1,
      bitmask: true,
      options: [
        { value: 0, label: 'Source type bit 0' },
        { value: 1, label: 'Source type bit 1' },
        { value: 2, label: 'Combine (AND)' },
        { value: 3, label: 'Negate' }
      ]
    },
    [`${prefix}SRC`]: {
      id: `${prefix}SRC`,
      label: `Term ${n} · source`,
      description:
        'Term source. Range term: RC channel 1-16. Link term: the watched AUX function. Condition term: a condition id.',
      category: RC_LOGIC_CATEGORY,
      minimum: 0,
      maximum: 255,
      step: 1
    },
    [`${prefix}MIN`]: {
      id: `${prefix}MIN`,
      label: `Term ${n} · range low`,
      description: 'Lower PWM bound for a range term — active when MIN ≤ channel PWM ≤ MAX.',
      category: RC_LOGIC_CATEGORY,
      unit: 'PWM',
      minimum: 800,
      maximum: 2200,
      step: 1
    },
    [`${prefix}MAX`]: {
      id: `${prefix}MAX`,
      label: `Term ${n} · range high`,
      description: 'Upper PWM bound for a range term — active when MIN ≤ channel PWM ≤ MAX.',
      category: RC_LOGIC_CATEGORY,
      unit: 'PWM',
      minimum: 800,
      maximum: 2200,
      step: 1
    },
    [`${prefix}VAL`]: {
      id: `${prefix}VAL`,
      label: `Term ${n} · value channel`,
      description: 'Value-source channel for continuous adjustments (0 = none). Reserved for a future phase.',
      category: RC_LOGIC_CATEGORY,
      minimum: 0,
      maximum: 16,
      step: 1
    }
  }
}

/** RCL_ENABLE + RCL1..N_* term parameters. */
export function buildRcLogicParameterDefinitions(): FirmwareMetadataBundle['parameters'] {
  const defs: Record<string, ParameterDefinition> = {
    RCL_ENABLE: {
      id: 'RCL_ENABLE',
      label: 'RC logic engine',
      description:
        'Enable the RC logic / range-function engine — activates ArduPilot AUX functions from RC channel PWM ranges (Betaflight-style Modes/Adjustments).',
      category: RC_LOGIC_CATEGORY,
      options: [
        { value: 0, label: 'Disabled' },
        { value: 1, label: 'Enabled' }
      ]
    }
  }
  for (let n = 1; n <= RC_LOGIC_NUM_TERMS; n += 1) {
    Object.assign(defs, termParameterDefinitions(n))
  }
  return defs
}
