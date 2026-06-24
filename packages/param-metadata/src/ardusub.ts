import type { FirmwareMetadataBundle, ParameterValueOption } from './types.js'
import { AHRS_ORIENTATION_OPTIONS } from './shared-enums.js'
import {
  ARDUCOPTER_BATTERY_MONITOR_LABELS,
  ARDUCOPTER_BATTERY_VOLTAGE_SOURCE_LABELS,
  ARDUCOPTER_LOG_BACKEND_LABELS,
  ARDUCOPTER_OSD_CHANNEL_LABELS,
  ARDUCOPTER_OSD_SWITCH_METHOD_LABELS,
  ARDUCOPTER_OSD_TYPE_LABELS,
  ARDUCOPTER_RSSI_TYPE_LABELS,
  ARDUCOPTER_SERIAL_BAUD_LABELS,
  ARDUCOPTER_SERIAL_OPTION_BIT_LABELS,
  ARDUCOPTER_SERIAL_PROTOCOL_LABELS,
  ARDUCOPTER_SERIAL_RTSCTS_LABELS,
  ARDUCOPTER_VTX_ENABLE_LABELS
} from './arducopter-enums.js'
import {
  ARDUSUB_BATTERY_FAILSAFE_ACTION_LABELS,
  ARDUSUB_BUTTON_FUNCTION_LABELS,
  ARDUSUB_FRAME_CONFIG_LABELS,
  ARDUSUB_TERRAIN_FS_LABELS,
  ARDUSUB_WP_YAW_BEHAVIOR_LABELS
} from './ardusub-enums.js'

// First cut of the ArduSub catalog. Sub is joystick-driven (no RC mode
// switch / frame-class motor matrix), so the Sub-specific surface is the
// frame configuration, joystick gains, depth/pilot behavior, the Sub
// attitude controller, and the dive-specific failsafes (leak, internal
// pressure/temperature). Firmware-identical families
// (serial/battery/compass/GPS/RC/OSD/RSSI/VTX/logging) are reused from
// arducopter-enums exactly as the Plane/Rover bundles do.

function enumOptions(labelMap: Record<number, string>): ParameterValueOption[] {
  return Object.entries(labelMap)
    .map(([value, label]) => ({ value: Number(value), label }))
    .sort((left, right) => left.value - right.value)
}

const enabledDisabledOptions: ParameterValueOption[] = [
  { value: 0, label: 'Disabled' },
  { value: 1, label: 'Enabled' }
]

// sourced from ArduPilot ArduSub/Parameters.cpp @Param: FS_LEAK_ENABLE @Values
const ARDUSUB_LEAK_ACTION_LABELS: Record<number, string> = {
  0: 'Disabled',
  1: 'Warn only',
  2: 'Enter surface mode'
}

// sourced from ArduPilot ArduSub/Parameters.cpp @Param: FS_PRESS_ENABLE /
// FS_TEMP_ENABLE @Values (both share 0:Disabled,1:Warn only)
const ARDUSUB_PRESS_TEMP_FS_LABELS: Record<number, string> = {
  0: 'Disabled',
  1: 'Warn only'
}

// sourced from ArduPilot ArduSub/Parameters.cpp @Param: FS_GCS_ENABLE @Values
const ARDUSUB_GCS_FS_LABELS: Record<number, string> = {
  0: 'Disabled',
  1: 'Warn only',
  2: 'Disarm',
  3: 'Enter depth hold mode',
  4: 'Enter surface mode'
}

// sourced from ArduPilot ArduSub/Parameters.cpp @Param: FS_PILOT_INPUT @Values
const ARDUSUB_PILOT_INPUT_FS_LABELS: Record<number, string> = {
  0: 'Disabled',
  1: 'Warn only',
  2: 'Disarm'
}

// sourced from ArduPilot ArduSub/Parameters.cpp @Param: FS_CRASH_CHECK @Values
const ARDUSUB_CRASH_CHECK_FS_LABELS: Record<number, string> = {
  0: 'Disabled',
  1: 'Warn only',
  2: 'Disarm'
}

const serialProtocolNotes = ['Reboot required after changing a serial protocol assignment.']
const serialBaudNotes = ['Baud is a coded value (for example 115 = 115200).']
const serialOptionsNotes = ['Advanced UART option bitmask; leave at 0 unless a peripheral needs inversion/half-duplex.']
const serialFlowControlNotes = ['RTS/CTS hardware flow control; most peripherals use 0 (disabled).']
const frameConfigNotes = [
  'FRAME_CONFIG must match the physical thruster layout. Vectored frames give full horizontal control; 6DOF adds independent vertical/lateral control.',
  'Reboot the autopilot after changing the frame configuration.'
]
const frameStarterCautions = [
  'Changing FRAME_CONFIG reconfigures thruster mixing and takes effect after a reboot.',
  'This only selects the thruster layout — finish joystick, sensor, and tuning setup afterward.',
  'A pre-apply snapshot is captured automatically so you can roll back to the previous setup if needed.'
]
const joystickGainNotes = [
  'JS_GAIN_DEFAULT is the throttle/thruster authority applied at the default gain step. Pilots step between JS_GAIN_MIN and JS_GAIN_MAX in JS_GAIN_STEPS increments from the controller.'
]
const depthNotes = [
  'SURFACE_DEPTH is the depth (cm, negative) treated as "at the surface" for arming and surface-failsafe logic.'
]
const buttonNotes = [
  'A Sub has no RC mode switch — modes and in-dive actions (arm/disarm, mount, lights, gain, actuators, relays) are bound to joystick buttons via BTNn_FUNCTION.',
  'BTNn_SFUNCTION is the alternate action used while the "shift" button (function 1) is held.'
]
const depthControlNotes = [
  'The vertical (depth) position controller used by Depth Hold and Auto: an outer position loop feeds a velocity loop feeds an acceleration loop.',
  'ArduPilot renamed this family — modern firmware reports PSC_D_POS/VEL/ACC_* (and PSC_JERK_D); older firmware reports PSC_POSZ/VELZ/ACCZ_* (and PSC_JERK_Z). Whichever your firmware uses is what is shown. Tune the inner (accel) loop first.'
]
const attitudeNotes = [
  'Sub attitude rate-controller gains. Tune in a stable hover (Depth Hold) after the frame configuration and thruster directions are confirmed.'
]

function serialPortDisplayName(portNumber: number): string {
  switch (portNumber) {
    case 0:
      return 'USB / Console'
    case 1:
      return 'Telemetry 1'
    case 2:
      return 'Telemetry 2'
    case 3:
      return 'GPS / UART3'
    default:
      return `Serial ${portNumber}`
  }
}

function buildSerialPortParameterDefinitions(maxPortNumber: number): FirmwareMetadataBundle['parameters'] {
  const definitions: FirmwareMetadataBundle['parameters'] = {}

  for (let portNumber = 0; portNumber <= maxPortNumber; portNumber += 1) {
    const portLabel = serialPortDisplayName(portNumber)

    definitions[`SERIAL${portNumber}_PROTOCOL`] = {
      id: `SERIAL${portNumber}_PROTOCOL`,
      label: `${portLabel} Protocol`,
      description: `Assigned serial protocol for ${portLabel}.`,
      category: 'ports',
      minimum: -1,
      maximum: 50,
      rebootRequired: true,
      notes: serialProtocolNotes,
      options: enumOptions(ARDUCOPTER_SERIAL_PROTOCOL_LABELS)
    }

    definitions[`SERIAL${portNumber}_BAUD`] = {
      id: `SERIAL${portNumber}_BAUD`,
      label: `${portLabel} Baud`,
      description: `Configured baud rate for ${portLabel}.`,
      category: 'ports',
      minimum: 1,
      maximum: 12500,
      notes: serialBaudNotes,
      options: enumOptions(ARDUCOPTER_SERIAL_BAUD_LABELS)
    }

    // SERIAL0 (Console UART) has no _OPTIONS register on real ArduPilot
    // firmware — only PROTOCOL + BAUD. Emitting it here would surface a
    // ghost entry under the raw Parameters tab that never matches anything
    // the FC streams. Only emit OPTIONS for SERIAL1..N.
    if (portNumber > 0) {
      definitions[`SERIAL${portNumber}_OPTIONS`] = {
        id: `SERIAL${portNumber}_OPTIONS`,
        label: `${portLabel} Serial Options`,
        description: `Advanced UART option bitmask for ${portLabel}.`,
        category: 'ports',
        minimum: 0,
        maximum: 8191,
        bitmask: true,
        rebootRequired: true,
        notes: serialOptionsNotes,
        options: enumOptions(ARDUCOPTER_SERIAL_OPTION_BIT_LABELS)
      }
    }

    if (portNumber > 0 && portNumber <= 6) {
      definitions[`BRD_SER${portNumber}_RTSCTS`] = {
        id: `BRD_SER${portNumber}_RTSCTS`,
        label: `${portLabel} Flow Control`,
        description: `RTS/CTS flow-control behavior for ${portLabel}.`,
        category: 'ports',
        minimum: 0,
        maximum: 3,
        rebootRequired: true,
        notes: serialFlowControlNotes,
        options: enumOptions(ARDUCOPTER_SERIAL_RTSCTS_LABELS)
      }
    }
  }

  return definitions
}

// ArduSub registers BTN0_ .. BTN31_ (32 JSButton subgroups) in
// ArduSub/Parameters.cpp, each exposing FUNCTION + SFUNCTION. Build all 64
// entries from the shared button-function @Values map so every joystick
// binding a connected Sub reports gets a real label.
const ARDUSUB_BUTTON_COUNT = 32

function buildJoystickButtonParameterDefinitions(): FirmwareMetadataBundle['parameters'] {
  const definitions: FirmwareMetadataBundle['parameters'] = {}
  const options = enumOptions(ARDUSUB_BUTTON_FUNCTION_LABELS)

  for (let buttonNumber = 0; buttonNumber < ARDUSUB_BUTTON_COUNT; buttonNumber += 1) {
    definitions[`BTN${buttonNumber}_FUNCTION`] = {
      id: `BTN${buttonNumber}_FUNCTION`,
      label: `Button ${buttonNumber} Function`,
      description: `Action bound to joystick button ${buttonNumber}.`,
      category: 'joystick',
      notes: buttonNotes,
      options
    }
    definitions[`BTN${buttonNumber}_SFUNCTION`] = {
      id: `BTN${buttonNumber}_SFUNCTION`,
      label: `Button ${buttonNumber} Shifted Function`,
      description: `Action bound to joystick button ${buttonNumber} while the shift button is held.`,
      category: 'joystick',
      notes: buttonNotes,
      options
    }
  }

  return definitions
}

export const ardusubMetadata: FirmwareMetadataBundle = {
  firmware: 'ArduSub',
  appViews: [
    { id: 'setup', label: 'Setup', description: 'Connection, calibration, and guided Sub setup.', order: 1 },
    { id: 'ports', label: 'Ports', description: 'Serial roles, GPS links, and peripheral setup.', order: 2 },
    { id: 'vtx', label: 'VTX', description: 'Video transmitter control, channel, and power setup.', order: 3 },
    { id: 'osd', label: 'OSD', description: 'Display backend, screen mode, and overlay switching.', order: 4 },
    { id: 'receiver', label: 'Receiver', description: 'Joystick/RC mapping and ranges.', order: 5 },
    { id: 'modes', label: 'Modes', description: 'Sub mode behavior and live state.', order: 6 },
    { id: 'motors', label: 'Motors', description: 'Thruster output assignments and frame config.', order: 7 },
    { id: 'servos', label: 'Servos', description: 'Auxiliary servo outputs — gimbal, gripper, manipulator, etc.', order: 7.5 },
    { id: 'power', label: 'Power', description: 'Battery, failsafe, and pre-arm review.', order: 8 },
    { id: 'failsafe', label: 'Failsafe', description: 'Leak, pressure, temperature, GCS, and battery failsafe overview.', order: 9 },
    { id: 'logs', label: 'Logs', description: 'Onboard log backend, retention, and replay summary.', order: 10 },
    { id: 'snapshots', label: 'Snapshots', description: 'Capture, compare, and restore known-good parameter sets.', order: 11 },
    { id: 'tuning', label: 'Tuning', description: 'Sub attitude, pilot, and waypoint-navigation tuning.', order: 12 },
    { id: 'presets', label: 'Presets', description: 'Future home for Sub tuning presets (not populated in the first cut).', order: 13 },
    { id: 'config', label: 'Config', description: 'Baseline misc — board orientation, arming behavior, system identity, statistics.', order: 13.5 },
    { id: 'parameters', label: 'Parameters', description: 'Low-level parameter editing and backup work.', order: 14 }
  ],
  categories: {
    frame: { id: 'frame', label: 'Frame Config', description: 'Thruster frame configuration.', order: 1, viewId: 'motors' },
    joystick: { id: 'joystick', label: 'Joystick', description: 'Pilot joystick gain and control behavior.', order: 2, viewId: 'receiver' },
    pilot: { id: 'pilot', label: 'Pilot & Depth', description: 'Vertical speed, acceleration, and surface depth.', order: 3, viewId: 'tuning' },
    sensors: { id: 'sensors', label: 'Sensors', description: 'Board orientation and sensor-related setup.', order: 4, viewId: 'setup' },
    ports: { id: 'ports', label: 'Ports', description: 'Serial roles, baud rates, and peripheral transport settings.', order: 5, viewId: 'ports' },
    vtx: { id: 'vtx', label: 'VTX', description: 'Video transmitter control settings.', order: 6, viewId: 'vtx' },
    osd: { id: 'osd', label: 'OSD', description: 'On-screen display backend and switching.', order: 7, viewId: 'osd' },
    radio: { id: 'radio', label: 'Receiver', description: 'RC input mapping and ranges.', order: 8, viewId: 'receiver' },
    attitude: { id: 'attitude', label: 'Attitude Tuning', description: 'Sub attitude rate and angle controller gains.', order: 9, viewId: 'tuning' },
    navigation: { id: 'navigation', label: 'Navigation', description: 'Waypoint speed/acceleration behavior.', order: 10, viewId: 'tuning' },
    depth: { id: 'depth', label: 'Depth & Position Control', description: 'Vertical (depth) position/velocity/acceleration controller used by Depth Hold and Auto.', order: 11, viewId: 'tuning' },
    power: { id: 'power', label: 'Power', description: 'Battery monitoring and arming voltage.', order: 12, viewId: 'power' },
    failsafe: { id: 'failsafe', label: 'Failsafe', description: 'Leak, pressure, temperature, GCS, and battery failsafe behavior.', order: 13, viewId: 'failsafe' },
    logging: { id: 'logging', label: 'Logging', description: 'Dataflash backend and retention.', order: 14, viewId: 'parameters' }
  },
  presetGroups: {
    'starter-config': {
      id: 'starter-config',
      label: 'Starter Config',
      description: 'One-tap thruster-layout selection to bootstrap a fresh board — sets the frame configuration only.',
      order: 0
    }
  },
  presets: {
    'starter-vectored': {
      id: 'starter-vectored',
      label: 'Vectored',
      description: 'Standard vectored frame — full horizontal control (e.g. BlueROV2 layout).',
      groupId: 'starter-config',
      order: 0,
      values: [{ paramId: 'FRAME_CONFIG', value: 1 }],
      tags: ['frame', 'vectored', 'starter'],
      cautions: frameStarterCautions
    },
    'starter-vectored-6dof': {
      id: 'starter-vectored-6dof',
      label: 'Vectored 6DOF',
      description: 'Vectored frame with independent vertical/lateral control (8-thruster 6DOF).',
      groupId: 'starter-config',
      order: 1,
      values: [{ paramId: 'FRAME_CONFIG', value: 2 }],
      tags: ['frame', 'vectored', '6dof', 'starter'],
      cautions: frameStarterCautions
    },
    'starter-bluerov1': {
      id: 'starter-bluerov1',
      label: 'BlueROV1',
      description: 'Original BlueROV1 thruster layout.',
      groupId: 'starter-config',
      order: 2,
      values: [{ paramId: 'FRAME_CONFIG', value: 0 }],
      tags: ['frame', 'bluerov', 'starter'],
      cautions: frameStarterCautions
    },
    'starter-simplerov-4': {
      id: 'starter-simplerov-4',
      label: 'SimpleROV-4',
      description: 'Four-thruster SimpleROV layout.',
      groupId: 'starter-config',
      order: 3,
      values: [{ paramId: 'FRAME_CONFIG', value: 5 }],
      tags: ['frame', 'simplerov', 'starter'],
      cautions: frameStarterCautions
    }
  },
  parameters: {
    ...buildSerialPortParameterDefinitions(8),
    ...buildJoystickButtonParameterDefinitions(),

    FRAME_CONFIG: { id: 'FRAME_CONFIG', label: 'Frame Configuration', description: 'Thruster layout of the Sub. Set this according to your vehicle/motor configuration.', category: 'frame', rebootRequired: true, notes: frameConfigNotes, options: enumOptions(ARDUSUB_FRAME_CONFIG_LABELS) },

    JS_GAIN_DEFAULT: { id: 'JS_GAIN_DEFAULT', label: 'Joystick Default Gain', description: 'Default gain at boot; must be within [JS_GAIN_MIN, JS_GAIN_MAX].', category: 'joystick', minimum: 0.1, maximum: 1, step: 0.01, notes: joystickGainNotes },
    JS_GAIN_MAX: { id: 'JS_GAIN_MAX', label: 'Joystick Max Gain', description: 'Highest selectable gain step.', category: 'joystick', minimum: 0.2, maximum: 1, step: 0.01, notes: joystickGainNotes },
    JS_GAIN_MIN: { id: 'JS_GAIN_MIN', label: 'Joystick Min Gain', description: 'Lowest selectable gain step.', category: 'joystick', minimum: 0.1, maximum: 0.8, step: 0.01, notes: joystickGainNotes },
    JS_GAIN_STEPS: { id: 'JS_GAIN_STEPS', label: 'Joystick Gain Steps', description: 'Number of gain increments between min and max (1 = always use JS_GAIN_DEFAULT).', category: 'joystick', minimum: 1, maximum: 10, step: 1 },
    JS_THR_GAIN: { id: 'JS_THR_GAIN', label: 'Joystick Throttle Gain', description: 'Scalar applied to the throttle channel; scaled with the current joystick gain.', category: 'joystick', minimum: 0.5, maximum: 4, step: 0.1 },
    JS_LIGHTS_STEPS: { id: 'JS_LIGHTS_STEPS', label: 'Lights Brightness Steps', description: 'Number of brightness steps between minimum and maximum light output.', category: 'joystick', unit: 'PWM', minimum: 1, maximum: 10, step: 1 },

    PILOT_SPEED_UP: { id: 'PILOT_SPEED_UP', label: 'Ascend Speed', description: 'Maximum vertical ascending speed the pilot may request.', category: 'pilot', unit: 'cm/s', minimum: 20, maximum: 500, step: 10 },
    PILOT_SPEED_DN: { id: 'PILOT_SPEED_DN', label: 'Descend Speed', description: 'Maximum vertical descending speed the pilot may request; 0 = use PILOT_SPEED_UP.', category: 'pilot', unit: 'cm/s', minimum: 20, maximum: 500, step: 10 },
    PILOT_SPEED: { id: 'PILOT_SPEED', label: 'Horizontal Speed', description: 'Maximum horizontal speed the pilot may request.', category: 'pilot', unit: 'cm/s', minimum: 10, maximum: 500, step: 10 },
    PILOT_ACCEL_Z: { id: 'PILOT_ACCEL_Z', label: 'Vertical Acceleration', description: 'Vertical acceleration used when the pilot is controlling altitude.', category: 'pilot', unit: 'cm/s/s', minimum: 50, maximum: 500, step: 10 },
    PILOT_THR_FILT: { id: 'PILOT_THR_FILT', label: 'Throttle Filter Cutoff', description: 'Throttle filter cutoff frequency, active whenever altitude control is inactive; 0 = disable.', category: 'pilot', unit: 'Hz', minimum: 0, maximum: 10, step: 0.5 },
    SURFACE_DEPTH: { id: 'SURFACE_DEPTH', label: 'Surface Depth', description: 'Depth the external pressure sensor reads when the vehicle is considered at the surface.', category: 'pilot', unit: 'cm', minimum: -100, maximum: 0, step: 1, notes: depthNotes },
    SURFACE_MAX_THR: { id: 'SURFACE_MAX_THR', label: 'Surface Maximum Throttle', description: 'Maximum upward throttle near the surface; throttle scales linearly from full to this value as the vehicle approaches the surface (attenuation starts 1 m from surface).', category: 'pilot', minimum: 0, maximum: 1, step: 0.01 },

    ATC_RAT_RLL_P: { id: 'ATC_RAT_RLL_P', label: 'Roll Rate P', description: 'Roll rate-controller proportional gain.', category: 'attitude', minimum: 0, maximum: 0.5, step: 0.005, notes: attitudeNotes },
    ATC_RAT_RLL_I: { id: 'ATC_RAT_RLL_I', label: 'Roll Rate I', description: 'Roll rate-controller integral gain.', category: 'attitude', minimum: 0, maximum: 0.5, step: 0.005, notes: attitudeNotes },
    ATC_RAT_RLL_D: { id: 'ATC_RAT_RLL_D', label: 'Roll Rate D', description: 'Roll rate-controller derivative gain.', category: 'attitude', minimum: 0, maximum: 0.05, step: 0.001, notes: attitudeNotes },
    ATC_RAT_PIT_P: { id: 'ATC_RAT_PIT_P', label: 'Pitch Rate P', description: 'Pitch rate-controller proportional gain.', category: 'attitude', minimum: 0, maximum: 0.5, step: 0.005, notes: attitudeNotes },
    ATC_RAT_PIT_I: { id: 'ATC_RAT_PIT_I', label: 'Pitch Rate I', description: 'Pitch rate-controller integral gain.', category: 'attitude', minimum: 0, maximum: 0.5, step: 0.005, notes: attitudeNotes },
    ATC_RAT_PIT_D: { id: 'ATC_RAT_PIT_D', label: 'Pitch Rate D', description: 'Pitch rate-controller derivative gain.', category: 'attitude', minimum: 0, maximum: 0.05, step: 0.001, notes: attitudeNotes },
    ATC_RAT_YAW_P: { id: 'ATC_RAT_YAW_P', label: 'Yaw Rate P', description: 'Yaw rate-controller proportional gain.', category: 'attitude', minimum: 0, maximum: 1, step: 0.005, notes: attitudeNotes },
    ATC_RAT_YAW_I: { id: 'ATC_RAT_YAW_I', label: 'Yaw Rate I', description: 'Yaw rate-controller integral gain.', category: 'attitude', minimum: 0, maximum: 1, step: 0.005, notes: attitudeNotes },
    ATC_ANG_RLL_P: { id: 'ATC_ANG_RLL_P', label: 'Roll Angle P', description: 'Roll angle-to-rate proportional gain.', category: 'attitude', minimum: 0, maximum: 12, step: 0.1 },
    ATC_ANG_PIT_P: { id: 'ATC_ANG_PIT_P', label: 'Pitch Angle P', description: 'Pitch angle-to-rate proportional gain.', category: 'attitude', minimum: 0, maximum: 12, step: 0.1 },
    ATC_ANG_YAW_P: { id: 'ATC_ANG_YAW_P', label: 'Yaw Angle P', description: 'Yaw angle-to-rate proportional gain.', category: 'attitude', minimum: 0, maximum: 12, step: 0.1 },
    ATC_RAT_RLL_FF: { id: 'ATC_RAT_RLL_FF', label: 'Roll Rate FF', description: 'Roll rate-controller feed-forward gain.', category: 'attitude', minimum: 0, maximum: 1, step: 0.001, notes: attitudeNotes },
    ATC_RAT_RLL_IMAX: { id: 'ATC_RAT_RLL_IMAX', label: 'Roll Rate IMAX', description: 'Maximum integrator authority for the roll rate loop.', category: 'attitude', minimum: 0, maximum: 1, step: 0.01, notes: attitudeNotes },
    ATC_RAT_RLL_FLTT: { id: 'ATC_RAT_RLL_FLTT', label: 'Roll Rate Target Filter', description: 'Roll rate-controller target low-pass filter frequency (Hz).', category: 'attitude', minimum: 0, maximum: 200, step: 1, notes: attitudeNotes },
    ATC_RAT_RLL_FLTE: { id: 'ATC_RAT_RLL_FLTE', label: 'Roll Rate Error Filter', description: 'Roll rate-controller error low-pass filter frequency (Hz).', category: 'attitude', minimum: 0, maximum: 200, step: 1, notes: attitudeNotes },
    ATC_RAT_RLL_FLTD: { id: 'ATC_RAT_RLL_FLTD', label: 'Roll Rate D Filter', description: 'Roll rate-controller derivative-term low-pass filter frequency (Hz).', category: 'attitude', minimum: 0, maximum: 200, step: 1, notes: attitudeNotes },
    ATC_RAT_RLL_SMAX: { id: 'ATC_RAT_RLL_SMAX', label: 'Roll Rate Slew Limit', description: 'Upper limit on the slew rate from the combined roll P and D terms (0 = disabled).', category: 'attitude', minimum: 0, maximum: 200, step: 1, notes: attitudeNotes },
    ATC_RAT_PIT_FF: { id: 'ATC_RAT_PIT_FF', label: 'Pitch Rate FF', description: 'Pitch rate-controller feed-forward gain.', category: 'attitude', minimum: 0, maximum: 1, step: 0.001, notes: attitudeNotes },
    ATC_RAT_PIT_IMAX: { id: 'ATC_RAT_PIT_IMAX', label: 'Pitch Rate IMAX', description: 'Maximum integrator authority for the pitch rate loop.', category: 'attitude', minimum: 0, maximum: 1, step: 0.01, notes: attitudeNotes },
    ATC_RAT_PIT_FLTT: { id: 'ATC_RAT_PIT_FLTT', label: 'Pitch Rate Target Filter', description: 'Pitch rate-controller target low-pass filter frequency (Hz).', category: 'attitude', minimum: 0, maximum: 200, step: 1, notes: attitudeNotes },
    ATC_RAT_PIT_FLTE: { id: 'ATC_RAT_PIT_FLTE', label: 'Pitch Rate Error Filter', description: 'Pitch rate-controller error low-pass filter frequency (Hz).', category: 'attitude', minimum: 0, maximum: 200, step: 1, notes: attitudeNotes },
    ATC_RAT_PIT_FLTD: { id: 'ATC_RAT_PIT_FLTD', label: 'Pitch Rate D Filter', description: 'Pitch rate-controller derivative-term low-pass filter frequency (Hz).', category: 'attitude', minimum: 0, maximum: 200, step: 1, notes: attitudeNotes },
    ATC_RAT_PIT_SMAX: { id: 'ATC_RAT_PIT_SMAX', label: 'Pitch Rate Slew Limit', description: 'Upper limit on the slew rate from the combined pitch P and D terms (0 = disabled).', category: 'attitude', minimum: 0, maximum: 200, step: 1, notes: attitudeNotes },
    ATC_RAT_YAW_FF: { id: 'ATC_RAT_YAW_FF', label: 'Yaw Rate FF', description: 'Yaw rate-controller feed-forward gain.', category: 'attitude', minimum: 0, maximum: 1, step: 0.001, notes: attitudeNotes },
    ATC_RAT_YAW_IMAX: { id: 'ATC_RAT_YAW_IMAX', label: 'Yaw Rate IMAX', description: 'Maximum integrator authority for the yaw rate loop.', category: 'attitude', minimum: 0, maximum: 1, step: 0.01, notes: attitudeNotes },
    ATC_RAT_YAW_FLTT: { id: 'ATC_RAT_YAW_FLTT', label: 'Yaw Rate Target Filter', description: 'Yaw rate-controller target low-pass filter frequency (Hz).', category: 'attitude', minimum: 0, maximum: 200, step: 1, notes: attitudeNotes },
    ATC_RAT_YAW_FLTE: { id: 'ATC_RAT_YAW_FLTE', label: 'Yaw Rate Error Filter', description: 'Yaw rate-controller error low-pass filter frequency (Hz).', category: 'attitude', minimum: 0, maximum: 200, step: 1, notes: attitudeNotes },
    ATC_RAT_YAW_FLTD: { id: 'ATC_RAT_YAW_FLTD', label: 'Yaw Rate D Filter', description: 'Yaw rate-controller derivative-term low-pass filter frequency (Hz).', category: 'attitude', minimum: 0, maximum: 200, step: 1, notes: attitudeNotes },
    ATC_RAT_YAW_SMAX: { id: 'ATC_RAT_YAW_SMAX', label: 'Yaw Rate Slew Limit', description: 'Upper limit on the slew rate from the combined yaw P and D terms (0 = disabled).', category: 'attitude', minimum: 0, maximum: 200, step: 1, notes: attitudeNotes },

    PSC_D_POS_P: { id: 'PSC_D_POS_P', label: 'Depth Position P', description: 'Vertical position controller P gain (modern name; older firmware: PSC_POSZ_P).', category: 'depth', minimum: 0.5, maximum: 4, step: 0.01, notes: depthControlNotes },
    PSC_POSZ_P: { id: 'PSC_POSZ_P', label: 'Depth Position P (legacy)', description: 'Legacy name for the vertical position P gain; modern firmware reports PSC_D_POS_P.', category: 'depth', minimum: 0.5, maximum: 4, step: 0.01, notes: depthControlNotes },
    PSC_D_VEL_P: { id: 'PSC_D_VEL_P', label: 'Depth Velocity P', description: 'Vertical velocity controller P gain (modern name; older firmware: PSC_VELZ_P).', category: 'depth', minimum: 1, maximum: 10, step: 0.1, notes: depthControlNotes },
    PSC_D_VEL_I: { id: 'PSC_D_VEL_I', label: 'Depth Velocity I', description: 'Vertical velocity controller I gain (modern name; older firmware: PSC_VELZ_I).', category: 'depth', minimum: 0, maximum: 10, step: 0.1, notes: depthControlNotes },
    PSC_D_VEL_D: { id: 'PSC_D_VEL_D', label: 'Depth Velocity D', description: 'Vertical velocity controller D gain (modern name; older firmware: PSC_VELZ_D).', category: 'depth', minimum: 0, maximum: 2, step: 0.01, notes: depthControlNotes },
    PSC_D_VEL_IMAX: { id: 'PSC_D_VEL_IMAX', label: 'Depth Velocity IMAX', description: 'Vertical velocity controller integrator maximum.', category: 'depth', minimum: 1, maximum: 10, step: 0.1, notes: depthControlNotes },
    PSC_D_VEL_FLTE: { id: 'PSC_D_VEL_FLTE', label: 'Depth Velocity Error Filter', description: 'Vertical velocity controller error filter frequency (Hz).', category: 'depth', minimum: 0, maximum: 100, step: 1, notes: depthControlNotes },
    PSC_D_VEL_FLTD: { id: 'PSC_D_VEL_FLTD', label: 'Depth Velocity D Filter', description: 'Vertical velocity controller derivative-input filter frequency (Hz).', category: 'depth', minimum: 0, maximum: 100, step: 1, notes: depthControlNotes },
    PSC_VELZ_P: { id: 'PSC_VELZ_P', label: 'Depth Velocity P (legacy)', description: 'Legacy name for the vertical velocity P gain; modern firmware reports PSC_D_VEL_P.', category: 'depth', minimum: 1, maximum: 10, step: 0.1, notes: depthControlNotes },
    PSC_VELZ_I: { id: 'PSC_VELZ_I', label: 'Depth Velocity I (legacy)', description: 'Legacy name for the vertical velocity I gain; modern firmware reports PSC_D_VEL_I.', category: 'depth', minimum: 0, maximum: 10, step: 0.1, notes: depthControlNotes },
    PSC_VELZ_D: { id: 'PSC_VELZ_D', label: 'Depth Velocity D (legacy)', description: 'Legacy name for the vertical velocity D gain; modern firmware reports PSC_D_VEL_D.', category: 'depth', minimum: 0, maximum: 2, step: 0.01, notes: depthControlNotes },
    PSC_D_ACC_P: { id: 'PSC_D_ACC_P', label: 'Depth Accel P', description: 'Vertical acceleration controller P gain (modern name; older firmware: PSC_ACCZ_P).', category: 'depth', minimum: 0.01, maximum: 0.25, step: 0.001, notes: depthControlNotes },
    PSC_D_ACC_I: { id: 'PSC_D_ACC_I', label: 'Depth Accel I', description: 'Vertical acceleration controller I gain (modern name; older firmware: PSC_ACCZ_I).', category: 'depth', minimum: 0, maximum: 0.5, step: 0.001, notes: depthControlNotes },
    PSC_D_ACC_D: { id: 'PSC_D_ACC_D', label: 'Depth Accel D', description: 'Vertical acceleration controller D gain (modern name; older firmware: PSC_ACCZ_D).', category: 'depth', minimum: 0, maximum: 0.1, step: 0.001, notes: depthControlNotes },
    PSC_D_ACC_IMAX: { id: 'PSC_D_ACC_IMAX', label: 'Depth Accel IMAX', description: 'Vertical acceleration controller integrator maximum.', category: 'depth', minimum: 0, maximum: 1, step: 0.01, notes: depthControlNotes },
    PSC_D_ACC_FLTT: { id: 'PSC_D_ACC_FLTT', label: 'Depth Accel Target Filter', description: 'Vertical acceleration controller target filter frequency (Hz).', category: 'depth', minimum: 1, maximum: 50, step: 1, notes: depthControlNotes },
    PSC_D_ACC_FLTE: { id: 'PSC_D_ACC_FLTE', label: 'Depth Accel Error Filter', description: 'Vertical acceleration controller error filter frequency (Hz).', category: 'depth', minimum: 1, maximum: 100, step: 1, notes: depthControlNotes },
    PSC_D_ACC_FLTD: { id: 'PSC_D_ACC_FLTD', label: 'Depth Accel D Filter', description: 'Vertical acceleration controller derivative filter frequency (Hz).', category: 'depth', minimum: 1, maximum: 100, step: 1, notes: depthControlNotes },
    PSC_D_ACC_SMAX: { id: 'PSC_D_ACC_SMAX', label: 'Depth Accel Slew Limit', description: 'Vertical acceleration controller slew-rate limit (0 = disabled).', category: 'depth', minimum: 0, maximum: 100, step: 0.1, notes: depthControlNotes },
    PSC_ACCZ_P: { id: 'PSC_ACCZ_P', label: 'Depth Accel P (legacy)', description: 'Legacy name for the vertical acceleration P gain; modern firmware reports PSC_D_ACC_P.', category: 'depth', minimum: 0.01, maximum: 0.25, step: 0.001, notes: depthControlNotes },
    PSC_ACCZ_I: { id: 'PSC_ACCZ_I', label: 'Depth Accel I (legacy)', description: 'Legacy name for the vertical acceleration I gain; modern firmware reports PSC_D_ACC_I.', category: 'depth', minimum: 0, maximum: 0.5, step: 0.001, notes: depthControlNotes },
    PSC_ACCZ_D: { id: 'PSC_ACCZ_D', label: 'Depth Accel D (legacy)', description: 'Legacy name for the vertical acceleration D gain; modern firmware reports PSC_D_ACC_D.', category: 'depth', minimum: 0, maximum: 0.1, step: 0.001, notes: depthControlNotes },
    PSC_JERK_D: { id: 'PSC_JERK_D', label: 'Depth Jerk Limit', description: 'Jerk limit for the vertical kinematic input shaping (m/s/s/s). Modern name; older firmware: PSC_JERK_Z.', category: 'depth', minimum: 1, maximum: 50, step: 1, notes: depthControlNotes },
    PSC_JERK_Z: { id: 'PSC_JERK_Z', label: 'Depth Jerk Limit (legacy)', description: 'Legacy name for the vertical jerk limit; modern firmware reports PSC_JERK_D.', category: 'depth', minimum: 1, maximum: 50, step: 1, notes: depthControlNotes },
    // Sub waypoint nav family renamed in lock-step with the Plane Q_WP_*
    // refactor (4.5+): WPNAV_* -> WP_*, AND unit changed cm-based -> m-based
    // (100x value shift). Catalog both forms with their own units. Alias
    // shim deliberately omitted across this whole family — a raw value
    // mirror would be 100x off.
    WPNAV_SPEED: { id: 'WPNAV_SPEED', label: 'Waypoint Speed (legacy, cm/s)', description: 'Legacy ArduSub <4.5 name in cm/s. Modern firmware reports WP_SPD in m/s.', category: 'navigation', unit: 'cm/s', minimum: 20, maximum: 1000, step: 10 },
    WP_SPD: { id: 'WP_SPD', label: 'Waypoint Speed', description: 'Horizontal target speed between waypoints.', category: 'navigation', unit: 'm/s', minimum: 0.1, maximum: 20, step: 0.1 },
    WPNAV_SPEED_UP: { id: 'WPNAV_SPEED_UP', label: 'Waypoint Ascend Speed (legacy, cm/s)', description: 'Legacy ArduSub <4.5 name in cm/s. Modern firmware reports WP_SPD_UP in m/s.', category: 'navigation', unit: 'cm/s', minimum: 10, maximum: 1000, step: 10 },
    WP_SPD_UP: { id: 'WP_SPD_UP', label: 'Waypoint Ascend Speed', description: 'Vertical ascent speed target in Auto.', category: 'navigation', unit: 'm/s', minimum: 0.1, maximum: 10, step: 0.1 },
    WPNAV_SPEED_DN: { id: 'WPNAV_SPEED_DN', label: 'Waypoint Descend Speed (legacy, cm/s)', description: 'Legacy ArduSub <4.5 name in cm/s. Modern firmware reports WP_SPD_DN in m/s.', category: 'navigation', unit: 'cm/s', minimum: 10, maximum: 500, step: 10 },
    WP_SPD_DN: { id: 'WP_SPD_DN', label: 'Waypoint Descend Speed', description: 'Vertical descent speed target in Auto.', category: 'navigation', unit: 'm/s', minimum: 0.1, maximum: 10, step: 0.1 },
    WPNAV_ACCEL: { id: 'WPNAV_ACCEL', label: 'Waypoint Acceleration (legacy, cm/s²)', description: 'Legacy ArduSub <4.5 name in cm/s². Modern firmware reports WP_ACC in m/s².', category: 'navigation', unit: 'cm/s²', minimum: 50, maximum: 500, step: 10 },
    WP_ACC: { id: 'WP_ACC', label: 'Waypoint Acceleration', description: 'Horizontal acceleration between waypoints.', category: 'navigation', unit: 'm/s²', minimum: 0.5, maximum: 5, step: 0.1 },
    WPNAV_RADIUS: { id: 'WPNAV_RADIUS', label: 'Waypoint Radius (legacy, cm)', description: 'Legacy ArduSub <4.5 name in cm. Modern firmware reports WP_RADIUS_M in m.', category: 'navigation', unit: 'cm', minimum: 10, maximum: 1000, step: 10 },
    WP_RADIUS_M: { id: 'WP_RADIUS_M', label: 'Waypoint Radius', description: 'Acceptance radius for completing a waypoint.', category: 'navigation', unit: 'm', minimum: 0.05, maximum: 10, step: 0.05 },
    WP_YAW_BEHAVIOR: { id: 'WP_YAW_BEHAVIOR', label: 'Mission Yaw Behavior', description: 'How the autopilot controls yaw during missions and RTL.', category: 'navigation', options: enumOptions(ARDUSUB_WP_YAW_BEHAVIOR_LABELS) },
    XTRACK_ANG_LIM: { id: 'XTRACK_ANG_LIM', label: 'Crosstrack Angle Limit', description: 'Maximum angle between the current track and desired heading during waypoint navigation.', category: 'navigation', unit: 'deg', minimum: 10, maximum: 90, step: 1 },

    BATT_MONITOR: { id: 'BATT_MONITOR', label: 'Battery Monitor', description: 'Battery monitoring backend.', category: 'power', rebootRequired: true, options: enumOptions(ARDUCOPTER_BATTERY_MONITOR_LABELS) },
    BATT_CAPACITY: { id: 'BATT_CAPACITY', label: 'Battery Capacity', description: 'Pack capacity in mAh.', category: 'power', minimum: 0, maximum: 100000, step: 50 },
    BATT_ARM_VOLT: { id: 'BATT_ARM_VOLT', label: 'Arming Voltage', description: 'Minimum pack voltage required to arm.', category: 'power', minimum: 0, maximum: 60, step: 0.1 },
    BATT_FS_VOLTSRC: { id: 'BATT_FS_VOLTSRC', label: 'Failsafe Voltage Source', description: 'Whether failsafe uses raw or sag-compensated voltage.', category: 'power', options: enumOptions(ARDUCOPTER_BATTERY_VOLTAGE_SOURCE_LABELS) },
    BATT_LOW_VOLT: { id: 'BATT_LOW_VOLT', label: 'Low Voltage', description: 'Pack voltage that triggers the low-battery failsafe.', category: 'failsafe', minimum: 0, maximum: 60, step: 0.1 },
    BATT_FS_LOW_ACT: { id: 'BATT_FS_LOW_ACT', label: 'Low Battery Action', description: 'Action taken on the low-battery failsafe.', category: 'failsafe', options: enumOptions(ARDUSUB_BATTERY_FAILSAFE_ACTION_LABELS) },
    BATT_CRT_VOLT: { id: 'BATT_CRT_VOLT', label: 'Critical Voltage', description: 'Pack voltage that triggers the critical-battery failsafe.', category: 'failsafe', minimum: 0, maximum: 60, step: 0.1 },
    BATT_FS_CRT_ACT: { id: 'BATT_FS_CRT_ACT', label: 'Critical Battery Action', description: 'Action taken on the critical-battery failsafe.', category: 'failsafe', options: enumOptions(ARDUSUB_BATTERY_FAILSAFE_ACTION_LABELS) },

    FS_LEAK_ENABLE: { id: 'FS_LEAK_ENABLE', label: 'Leak Failsafe', description: 'Action when a leak sensor trips — the most safety-critical Sub failsafe.', category: 'failsafe', options: enumOptions(ARDUSUB_LEAK_ACTION_LABELS) },
    FS_PRESS_ENABLE: { id: 'FS_PRESS_ENABLE', label: 'Internal Pressure Failsafe', description: 'Action when internal pressure exceeds FS_PRESS_MAX (enclosure breach indicator).', category: 'failsafe', options: enumOptions(ARDUSUB_PRESS_TEMP_FS_LABELS) },
    FS_PRESS_MAX: { id: 'FS_PRESS_MAX', label: 'Max Internal Pressure', description: 'Internal pressure (Pa) above which the pressure failsafe fires.', category: 'failsafe', minimum: 0, maximum: 200000, step: 1000 },
    FS_TEMP_ENABLE: { id: 'FS_TEMP_ENABLE', label: 'Internal Temperature Failsafe', description: 'Action when internal temperature exceeds FS_TEMP_MAX.', category: 'failsafe', options: enumOptions(ARDUSUB_PRESS_TEMP_FS_LABELS) },
    FS_TEMP_MAX: { id: 'FS_TEMP_MAX', label: 'Max Internal Temperature', description: 'Internal temperature (°C) above which the temperature failsafe fires.', category: 'failsafe', minimum: 0, maximum: 120, step: 1 },
    FS_GCS_ENABLE: { id: 'FS_GCS_ENABLE', label: 'GCS Failsafe', description: 'Action when the surface/ground-station link is lost.', category: 'failsafe', options: enumOptions(ARDUSUB_GCS_FS_LABELS) },
    FS_PILOT_INPUT: { id: 'FS_PILOT_INPUT', label: 'Pilot Input Failsafe', description: 'Action when no pilot (joystick) input is received for FS_PILOT_TIMEOUT.', category: 'failsafe', options: enumOptions(ARDUSUB_PILOT_INPUT_FS_LABELS) },
    FS_PILOT_TIMEOUT: { id: 'FS_PILOT_TIMEOUT', label: 'Pilot Input Timeout', description: 'Maximum interval between received pilot inputs before the pilot-input failsafe triggers.', category: 'failsafe', unit: 's', minimum: 0.1, maximum: 3, step: 0.1 },
    FS_CRASH_CHECK: { id: 'FS_CRASH_CHECK', label: 'Crash Check', description: 'Action when a crash/entanglement is detected.', category: 'failsafe', options: enumOptions(ARDUSUB_CRASH_CHECK_FS_LABELS) },
    FS_TERRAIN_ENAB: { id: 'FS_TERRAIN_ENAB', label: 'Terrain Failsafe', description: 'Action to take if terrain information is lost during Auto mode.', category: 'failsafe', options: enumOptions(ARDUSUB_TERRAIN_FS_LABELS) },

    RSSI_TYPE: { id: 'RSSI_TYPE', label: 'RSSI Type', description: 'Signal-strength input source.', category: 'radio', options: enumOptions(ARDUCOPTER_RSSI_TYPE_LABELS) },
    RCMAP_ROLL: { id: 'RCMAP_ROLL', label: 'Roll/Lateral Channel', description: 'RC/joystick channel mapped to roll/lateral.', category: 'radio', minimum: 1, maximum: 16, step: 1 },
    RCMAP_PITCH: { id: 'RCMAP_PITCH', label: 'Pitch/Forward Channel', description: 'RC/joystick channel mapped to pitch/forward.', category: 'radio', minimum: 1, maximum: 16, step: 1 },
    RCMAP_THROTTLE: { id: 'RCMAP_THROTTLE', label: 'Throttle/Vertical Channel', description: 'RC/joystick channel mapped to vertical throttle.', category: 'radio', minimum: 1, maximum: 16, step: 1 },
    RCMAP_YAW: { id: 'RCMAP_YAW', label: 'Yaw Channel', description: 'RC/joystick channel mapped to yaw.', category: 'radio', minimum: 1, maximum: 16, step: 1 },

    AHRS_ORIENTATION: { id: 'AHRS_ORIENTATION', label: 'Board Orientation', description: 'Mounting orientation of the autopilot relative to the sub.', category: 'sensors', minimum: 0, maximum: 102, options: AHRS_ORIENTATION_OPTIONS },
    COMPASS_USE: { id: 'COMPASS_USE', label: 'Use Compass 1', description: 'Use the first compass for yaw.', category: 'sensors', options: enabledDisabledOptions },
    COMPASS_USE2: { id: 'COMPASS_USE2', label: 'Use Compass 2', description: 'Use the second compass for yaw.', category: 'sensors', options: enabledDisabledOptions },
    COMPASS_USE3: { id: 'COMPASS_USE3', label: 'Use Compass 3', description: 'Use the third compass for yaw.', category: 'sensors', options: enabledDisabledOptions },

    VTX_ENABLE: { id: 'VTX_ENABLE', label: 'VTX Control', description: 'Enable MAVLink/SmartAudio video-transmitter control.', category: 'vtx', options: enumOptions(ARDUCOPTER_VTX_ENABLE_LABELS) },
    OSD_TYPE: { id: 'OSD_TYPE', label: 'OSD Backend', description: 'On-screen display backend.', category: 'osd', options: enumOptions(ARDUCOPTER_OSD_TYPE_LABELS) },
    OSD_CHAN: { id: 'OSD_CHAN', label: 'OSD Screen Channel', description: 'Channel used to switch OSD screens.', category: 'osd', options: enumOptions(ARDUCOPTER_OSD_CHANNEL_LABELS) },
    OSD_SW_METHOD: { id: 'OSD_SW_METHOD', label: 'OSD Switch Method', description: 'How the OSD screen-switch channel is interpreted.', category: 'osd', options: enumOptions(ARDUCOPTER_OSD_SWITCH_METHOD_LABELS) },

    LOG_BACKEND_TYPE: { id: 'LOG_BACKEND_TYPE', label: 'Log Backend', description: 'Where dataflash logs are written.', category: 'logging', options: enumOptions(ARDUCOPTER_LOG_BACKEND_LABELS) },
    LOG_BITMASK: { id: 'LOG_BITMASK', label: 'Log Bitmask', description: 'Bitmask selecting which message groups are logged.', category: 'logging', minimum: 0, maximum: 65535, step: 1 },
    LOG_FILE_DSRMROT: { id: 'LOG_FILE_DSRMROT', label: 'Rotate Log On Disarm', description: 'Start a new log file each time the sub disarms.', category: 'logging', options: enabledDisabledOptions },
    LOG_DISARMED: { id: 'LOG_DISARMED', label: 'Log While Disarmed', description: 'Continue logging while the sub is disarmed.', category: 'logging', options: enabledDisabledOptions }
  },
  setupSections: [
    {
      id: 'link',
      title: 'Vehicle Link',
      description: 'Bring the Sub online and pull the first parameter snapshot.',
      requiredParameters: [],
      actions: ['request-parameters']
    },
    {
      id: 'frame',
      title: 'Frame',
      description: 'Confirm FRAME_CONFIG matches the physical thruster layout before any wet test.',
      requiredParameters: ['FRAME_CONFIG']
    },
    {
      id: 'sensors',
      title: 'Sensors',
      description: 'Verify board orientation and compass selection before tuning or diving.',
      requiredParameters: ['AHRS_ORIENTATION', 'COMPASS_USE'],
      actions: ['calibrate-accelerometer', 'calibrate-level', 'calibrate-compass']
    },
    {
      id: 'controls',
      title: 'Controls',
      description: 'Confirm joystick gain range before powered thruster testing.',
      requiredParameters: ['JS_GAIN_DEFAULT'],
      requiredLiveSignals: ['rc-input'],
    },
    {
      id: 'power',
      title: 'Battery',
      description: 'Validate battery monitoring before diving.',
      requiredParameters: ['BATT_MONITOR', 'BATT_CAPACITY'],
      // BATT_MONITOR=0 disables battery monitoring entirely. Same trap as
      // Copter / Plane / Rover — the section reading "complete" with
      // monitoring off is misleading (and arguably more dangerous on Sub
      // where losing track of battery underwater is a recoverable but
      // urgent failure mode).
      requiredNonZeroParameters: ['BATT_MONITOR'],
      requiredLiveSignals: ['battery-telemetry'],
    },
    {
      id: 'failsafe',
      title: 'Failsafe',
      description: 'Review the leak, internal pressure/temperature, GCS, and battery failsafes — the leak failsafe is the most safety-critical Sub setting.',
      requiredParameters: [
        'FS_LEAK_ENABLE',
        'FS_PRESS_ENABLE',
        'FS_GCS_ENABLE',
        'BATT_FS_VOLTSRC',
        'BATT_LOW_VOLT',
        'BATT_FS_LOW_ACT',
        'BATT_CRT_VOLT',
        'BATT_FS_CRT_ACT'
      ],
      requiredLiveSignals: ['battery-telemetry'],
    },
    {
      id: 'verify',
      title: 'Verify',
      description: 'Final pre-dive review and reboot before any powered testing.',
      requiredParameters: [],
      actions: ['reboot-autopilot']
    }
  ]
}
