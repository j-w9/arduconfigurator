import type { FirmwareMetadataBundle, ParameterValueOption } from './types.js'
import { AHRS_ORIENTATION_OPTIONS } from './shared-enums.js'
import { buildMountParameterDefinitions } from './shared-mount.js'
import { buildRangefinderParameterDefinitions } from './shared-rangefinder.js'
import {
  ARDUCOPTER_BATTERY_MONITOR_LABELS,
  ARDUCOPTER_BATTERY_VOLTAGE_SOURCE_LABELS,
  ARDUCOPTER_FLTMODE_CHANNEL_LABELS,
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
  ARDUROVER_BATTERY_FAILSAFE_ACTION_LABELS,
  ARDUROVER_FLIGHT_MODE_LABELS,
  ARDUROVER_WNDVN_ANALOG_PIN_LABELS,
  ARDUROVER_WNDVN_CAL_LABELS,
  ARDUROVER_WNDVN_SPEED_TYPE_LABELS,
  ARDUROVER_WNDVN_TYPE_LABELS
} from './ardurover-enums.js'

// First cut of the ArduRover catalog. Like the ArduPlane bundle it reuses
// the genuinely firmware-identical families (serial, battery, compass,
// GPS, RC, OSD, RSSI, VTX, logging) and re-implements the small helpers
// locally so Rover-specific roles can diverge without a cross-firmware
// refactor. Rover-specific surface is the mode family + the steering /
// speed / cruise / navigation / motor control parameters. Deeper Rover
// tuning and the sail/boat-only knobs are intentionally a follow-up.

function enumOptions(labelMap: Record<number, string>): ParameterValueOption[] {
  return Object.entries(labelMap)
    .map(([value, label]) => ({ value: Number(value), label }))
    .sort((left, right) => left.value - right.value)
}

const enabledDisabledOptions: ParameterValueOption[] = [
  { value: 0, label: 'Disabled' },
  { value: 1, label: 'Enabled' }
]

// sourced from ArduPilot Rover/Parameters.cpp @Param: FS_ACTION @Values
const ARDUROVER_FS_ACTION_LABELS: Record<number, string> = {
  0: 'Nothing',
  1: 'RTL',
  2: 'Hold',
  3: 'SmartRTL or RTL',
  4: 'SmartRTL or Hold',
  5: 'Terminate',
  6: 'Loiter or Hold'
}

// sourced from ArduPilot Rover/Parameters.cpp @Param: FS_CRASH_CHECK @Values
const ARDUROVER_FS_CRASH_CHECK_LABELS: Record<number, string> = {
  0: 'Disabled',
  1: 'Hold',
  2: 'HoldAndDisarm'
}

// sourced from ArduPilot Rover/Parameters.cpp @Param: FS_EKF_ACTION @Values
const ARDUROVER_FS_EKF_ACTION_LABELS: Record<number, string> = {
  0: 'Disabled',
  1: 'Hold',
  2: 'ReportOnly'
}

// sourced from ArduPilot Rover/Parameters.cpp @Param: FS_THR_ENABLE @Values
const ARDUROVER_FS_THR_ENABLE_LABELS: Record<number, string> = {
  0: 'Disabled',
  1: 'Enabled',
  2: 'Enabled Continue with Mission in Auto'
}

// sourced from ArduPilot Rover/Parameters.cpp @Param: FS_GCS_ENABLE @Values
const ARDUROVER_GCS_FS_LABELS: Record<number, string> = {
  0: 'Disabled',
  1: 'Enabled',
  2: 'Enabled Continue with Mission in Auto'
}

const ARDUROVER_PILOT_STEER_TYPE_LABELS: Record<number, string> = {
  0: 'Default',
  1: 'Two paddles (input separately)',
  2: 'Direction reversed when backing up',
  3: 'Direction unchanged when backing up'
}

const ARDUROVER_FRAME_CLASS_LABELS: Record<number, string> = {
  0: 'Undefined',
  1: 'Rover',
  2: 'Boat',
  3: 'BalanceBot'
}

const frameStarterCautions = [
  'FRAME_CLASS selects the vehicle type (ground rover, boat, or balance bot) and takes effect after a reboot.',
  'This only selects the vehicle class — finish motor/steering, sensor, and tuning setup afterward.',
  'A pre-apply snapshot is captured automatically so you can roll back to the previous setup if needed.'
]

const modeChannelNotes = [
  'The RC channel that selects the active drive mode via MODE1–MODE6.',
  'Rover defaults this to channel 8; match it to the switch wired on the transmitter.'
]
const serialProtocolNotes = ['Reboot required after changing a serial protocol assignment.']
const serialBaudNotes = ['Baud is a coded value (for example 115 = 115200).']
const serialOptionsNotes = ['Advanced UART option bitmask; leave at 0 unless a peripheral needs inversion/half-duplex.']
const serialFlowControlNotes = ['RTS/CTS hardware flow control; most peripherals use 0 (disabled).']
const steeringRateNotes = [
  'Steering-rate controller gains. Raise P until the rover tracks heading crisply without weaving, then add I to remove steady-state error.'
]
const speedThrottleNotes = [
  'Throttle/speed controller gains converting a target ground speed into throttle. Tune after the steering loop is stable.'
]
const cruiseNotes = [
  'CRUISE_SPEED with CRUISE_THROTTLE establishes the speed↔throttle relationship the speed controller feeds forward from. Set them from a real flat-ground run.'
]
const sailNotes = [
  'Sailboat support (SAIL_ENABLE=1). SAIL_ANGLE_MIN/MAX set the mainsheet travel; SAIL_ANGLE_IDEAL is the target sail-to-apparent-wind angle the auto-trim aims for; SAIL_NO_GO_ANGLE is the closest upwind angle the boat will sail before tacking.',
  'SAIL_HEEL_MAX caps heel via the ATC_SAIL_* heel PID. SAIL_WNDSPD_MIN motors below that apparent wind speed (if a motor is fitted). SAIL_XTRACK_MAX defines the tacking corridor; SAIL_LOIT_RADIUS sizes the loiter circle in sailing modes.'
]
const sailHeelNotes = [
  'Heel-angle PID controller (ATC_SAIL_*) used in auto sail-trim modes to keep heel below SAIL_HEEL_MAX. Base AC_PID library does not document gain ranges, so only the source-documented slew limit and filter carry editor bounds.'
]
const windVaneNotes = [
  'WNDVN_TYPE selects the wind-direction sensor (3=Analog, 4=NMEA, etc.); WNDVN_SPEED_TYPE selects the wind-speed sensor. Analog vanes use WNDVN_DIR_PIN with WNDVN_DIR_V_MIN/MAX scaling and WNDVN_DIR_OFS for the headwind offset.',
  'Set WNDVN_CAL=1 (direction) or 2 (speed) to start calibration. Filters (WNDVN_DIR_FILT / WNDVN_SPEED_FILT / WNDVN_TRUE_FILT) take a frequency in Hz; -1 disables the filter.'
]
const roverNavNotes = [
  'Waypoint navigation tuning for Auto mode: WP_ACCEL/WP_JERK shape how smoothly the rover changes speed between waypoints, and the L1 controller (NAVL1_*) sets path-tracking aggressiveness.',
  'Raise NAVL1_PERIOD if the rover weaves on a straight leg; lower it (carefully) for tighter corners. ATC_TURN_MAX_G caps cornering lateral g.'
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
      // 12.5 MBaud is encoded as the direct rate 12500000; the ceiling must
      // allow it or selecting the top baud option reads back as invalid.
      maximum: 12500000,
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

function buildModeParameterDefinitions(): FirmwareMetadataBundle['parameters'] {
  const definitions: FirmwareMetadataBundle['parameters'] = {
    MODE_CH: {
      id: 'MODE_CH',
      label: 'Mode Channel',
      description: 'Receiver channel used to select Rover drive modes.',
      category: 'modes',
      minimum: 0,
      maximum: 16,
      notes: modeChannelNotes,
      options: enumOptions(ARDUCOPTER_FLTMODE_CHANNEL_LABELS)
    }
  }
  for (let slot = 1; slot <= 6; slot += 1) {
    definitions[`MODE${slot}`] = {
      id: `MODE${slot}`,
      label: `Drive Mode ${slot}`,
      description: `Mode assigned to switch position ${slot}.`,
      category: 'modes',
      options: enumOptions(ARDUROVER_FLIGHT_MODE_LABELS)
    }
  }
  return definitions
}

export const arduroverMetadata: FirmwareMetadataBundle = {
  firmware: 'ArduRover',
  appViews: [
    { id: 'setup', label: 'Setup', description: 'Connection, calibration, and guided Rover setup.', order: 1 },
    { id: 'ports', label: 'Ports', description: 'Serial roles, GPS links, and peripheral setup.', order: 2 },
    { id: 'vtx', label: 'VTX', description: 'Video transmitter control, channel, and power setup.', order: 3 },
    { id: 'osd', label: 'OSD', description: 'FPV display backend, screen mode, and overlay switching.', order: 4 },
    { id: 'receiver', label: 'Receiver', description: 'RC mapping, ranges, and drive modes.', order: 5 },
    { id: 'modes', label: 'Modes', description: 'Rover drive-mode switch assignments and live position.', order: 6 },
    { id: 'motors', label: 'Motors', description: 'Throttle / skid-motor output assignments and drive-config motor behavior.', order: 7 },
    { id: 'servos', label: 'Servos', description: 'Steering servo and aux peripheral servo outputs.', order: 7.5 },
    { id: 'power', label: 'Power', description: 'Battery, failsafe, and pre-arm review.', order: 8 },
    { id: 'failsafe', label: 'Failsafe', description: 'Rover throttle/GCS failsafe and battery failsafe overview.', order: 9 },
    { id: 'logs', label: 'Logs', description: 'Onboard log backend, retention, and replay summary.', order: 10 },
    { id: 'snapshots', label: 'Snapshots', description: 'Capture, compare, and restore known-good parameter sets.', order: 11 },
    { id: 'tuning', label: 'Tuning', description: 'Steering-rate, speed/throttle, navigation, and sailing tuning.', order: 12 },
    { id: 'presets', label: 'Presets', description: 'Future home for Rover tuning presets (not populated in the first cut).', order: 13 },
    { id: 'config', label: 'Config', description: 'Baseline misc — board orientation, arming behavior, system identity, statistics.', order: 13.5 },
    { id: 'parameters', label: 'Parameters', description: 'Low-level parameter editing and backup work.', order: 14 }
  ],
  categories: {
    drive: { id: 'drive', label: 'Drive Config', description: 'Cruise speed/throttle and pilot steering behavior.', order: 1, viewId: 'motors' },
    sensors: { id: 'sensors', label: 'Sensors', description: 'Board orientation and sensor-related setup.', order: 2, viewId: 'setup' },
    ports: { id: 'ports', label: 'Ports', description: 'Serial roles, baud rates, and peripheral transport settings.', order: 3, viewId: 'ports' },
    vtx: { id: 'vtx', label: 'VTX', description: 'Video transmitter control settings.', order: 4, viewId: 'vtx' },
    osd: { id: 'osd', label: 'OSD', description: 'On-screen display backend and switching.', order: 5, viewId: 'osd' },
    radio: { id: 'radio', label: 'Receiver', description: 'RC input mapping and ranges.', order: 6, viewId: 'receiver' },
    modes: { id: 'modes', label: 'Modes', description: 'Drive-mode switch assignments.', order: 7, viewId: 'receiver' },
    motors: { id: 'motors', label: 'Motors & Outputs', description: 'Throttle limits and motor output behavior.', order: 8, viewId: 'motors' },
    gimbal: { id: 'gimbal', label: 'Gimbal / Mount', description: 'Camera gimbal/mount driver, control mode, and per-axis angle limits (MNT1/MNT2).', order: 8.5, viewId: 'motors' },
    rangefinder: { id: 'rangefinder', label: 'Rangefinder / Lidar', description: 'Rangefinder driver, orientation, range limits, and mounting offsets (RNGFND1).', order: 8.6, viewId: 'motors' },
    steering: { id: 'steering', label: 'Steering Tuning', description: 'Steering-rate and steering-angle controller gains.', order: 9, viewId: 'tuning' },
    speed: { id: 'speed', label: 'Speed Tuning', description: 'Throttle/speed controller gains.', order: 10, viewId: 'tuning' },
    navigation: { id: 'navigation', label: 'Navigation', description: 'Waypoint and turn behavior.', order: 11, viewId: 'tuning' },
    sailing: { id: 'sailing', label: 'Sailing', description: 'Sailboat trim angles, heel limit, and the sail-heel controller.', order: 11.4, viewId: 'tuning' },
    windvane: { id: 'windvane', label: 'Wind Vane', description: 'Wind direction/speed sensor selection, scaling, and filtering.', order: 11.6, viewId: 'tuning' },
    power: { id: 'power', label: 'Power', description: 'Battery monitoring and arming voltage.', order: 12, viewId: 'power' },
    failsafe: { id: 'failsafe', label: 'Failsafe', description: 'Throttle, GCS, and battery failsafe behavior.', order: 13, viewId: 'failsafe' },
    logging: { id: 'logging', label: 'Logging', description: 'Dataflash backend and retention.', order: 14, viewId: 'parameters' }
  },
  presetGroups: {
    'starter-config': {
      id: 'starter-config',
      label: 'Starter Config',
      description: 'One-tap vehicle-class selection to bootstrap a fresh board — sets the frame class only.',
      order: 0
    }
  },
  presets: {
    'starter-rover': {
      id: 'starter-rover',
      label: 'Rover',
      description: 'Standard wheeled/tracked ground rover.',
      groupId: 'starter-config',
      order: 0,
      values: [{ paramId: 'FRAME_CLASS', value: 1 }],
      tags: ['frame', 'rover', 'starter'],
      cautions: frameStarterCautions
    },
    'starter-boat': {
      id: 'starter-boat',
      label: 'Boat',
      description: 'Surface watercraft (enables boat-specific behavior such as loiter-at-station).',
      groupId: 'starter-config',
      order: 1,
      values: [{ paramId: 'FRAME_CLASS', value: 2 }],
      tags: ['frame', 'boat', 'starter'],
      cautions: frameStarterCautions
    },
    'starter-balancebot': {
      id: 'starter-balancebot',
      label: 'Balance Bot',
      description: 'Two-wheeled self-balancing rover.',
      groupId: 'starter-config',
      order: 2,
      values: [{ paramId: 'FRAME_CLASS', value: 3 }],
      tags: ['frame', 'balancebot', 'starter'],
      cautions: frameStarterCautions
    }
  },
  parameters: {
    ...buildSerialPortParameterDefinitions(8),
    ...buildModeParameterDefinitions(),
    ...buildMountParameterDefinitions(1),
    ...buildMountParameterDefinitions(2),
    ...buildRangefinderParameterDefinitions(1),

    AHRS_ORIENTATION: {
      id: 'AHRS_ORIENTATION',
      label: 'Board Orientation',
      description: 'Mounting orientation of the autopilot relative to the rover.',
      category: 'sensors',
      minimum: 0,
      maximum: 102,
      options: AHRS_ORIENTATION_OPTIONS
    },
    COMPASS_USE: { id: 'COMPASS_USE', label: 'Use Compass 1', description: 'Use the first compass for yaw.', category: 'sensors', options: enabledDisabledOptions },
    COMPASS_USE2: { id: 'COMPASS_USE2', label: 'Use Compass 2', description: 'Use the second compass for yaw.', category: 'sensors', options: enabledDisabledOptions },
    COMPASS_USE3: { id: 'COMPASS_USE3', label: 'Use Compass 3', description: 'Use the third compass for yaw.', category: 'sensors', options: enabledDisabledOptions },
    GPS_TYPE: { id: 'GPS_TYPE', label: 'GPS 1 Type', description: 'Driver for the primary GPS.', category: 'sensors', minimum: 0, maximum: 25 },
    GPS_TYPE2: { id: 'GPS_TYPE2', label: 'GPS 2 Type', description: 'Driver for the secondary GPS.', category: 'sensors', minimum: 0, maximum: 25 },

    FRAME_CLASS: { id: 'FRAME_CLASS', label: 'Vehicle Class', description: 'Base vehicle type — ground rover, boat, or balance bot. Selects the motor/steering mixing model.', category: 'drive', rebootRequired: true, options: enumOptions(ARDUROVER_FRAME_CLASS_LABELS) },
    CRUISE_SPEED: { id: 'CRUISE_SPEED', label: 'Cruise Speed', description: 'Target ground speed (m/s) used as the reference for the speed↔throttle relationship.', category: 'drive', minimum: 0, maximum: 100, step: 0.1, notes: cruiseNotes },
    CRUISE_THROTTLE: { id: 'CRUISE_THROTTLE', label: 'Cruise Throttle', description: 'Throttle percentage that produces CRUISE_SPEED on flat ground.', category: 'drive', minimum: 0, maximum: 100, step: 1, notes: cruiseNotes },
    PILOT_STEER_TYPE: { id: 'PILOT_STEER_TYPE', label: 'Pilot Steer Type', description: 'How manual steering input maps to the steering output.', category: 'drive', options: enumOptions(ARDUROVER_PILOT_STEER_TYPE_LABELS) },

    ATC_STR_RAT_P: { id: 'ATC_STR_RAT_P', label: 'Steering Rate P', description: 'Steering-rate controller proportional gain.', category: 'steering', minimum: 0, maximum: 2, step: 0.001, notes: steeringRateNotes },
    ATC_STR_RAT_I: { id: 'ATC_STR_RAT_I', label: 'Steering Rate I', description: 'Steering-rate controller integral gain.', category: 'steering', minimum: 0, maximum: 2, step: 0.001, notes: steeringRateNotes },
    ATC_STR_RAT_D: { id: 'ATC_STR_RAT_D', label: 'Steering Rate D', description: 'Steering-rate controller derivative gain.', category: 'steering', minimum: 0, maximum: 0.5, step: 0.001, notes: steeringRateNotes },
    ATC_STR_RAT_FF: { id: 'ATC_STR_RAT_FF', label: 'Steering Rate FF', description: 'Steering-rate controller feed-forward gain.', category: 'steering', minimum: 0, maximum: 3, step: 0.001 },
    ATC_STR_RAT_IMAX: { id: 'ATC_STR_RAT_IMAX', label: 'Steering Rate IMAX', description: 'Maximum integrator authority for the steering-rate loop.', category: 'steering', minimum: 0, maximum: 1, step: 0.01 },
    ATC_STR_RAT_MAX: { id: 'ATC_STR_RAT_MAX', label: 'Steering Rate Max', description: 'Maximum commanded steering rate (deg/s); 0 = no limit.', category: 'steering', minimum: 0, maximum: 1000, step: 1 },
    ATC_STR_ANG_P: { id: 'ATC_STR_ANG_P', label: 'Steering Angle P', description: 'Heading-angle to steering-rate proportional gain.', category: 'steering', minimum: 0, maximum: 10, step: 0.01 },
    ATC_STR_RAT_FLTT: { id: 'ATC_STR_RAT_FLTT', label: 'Steering Rate Target Filter', description: 'Steering-rate controller target low-pass filter frequency (Hz).', category: 'steering', minimum: 0, maximum: 100, step: 0.1, notes: steeringRateNotes },
    ATC_STR_RAT_FLTE: { id: 'ATC_STR_RAT_FLTE', label: 'Steering Rate Error Filter', description: 'Steering-rate controller error low-pass filter frequency (Hz).', category: 'steering', minimum: 0, maximum: 100, step: 0.1, notes: steeringRateNotes },
    ATC_STR_RAT_FLTD: { id: 'ATC_STR_RAT_FLTD', label: 'Steering Rate D Filter', description: 'Steering-rate controller derivative-term low-pass filter frequency (Hz).', category: 'steering', minimum: 0, maximum: 100, step: 0.1, notes: steeringRateNotes },
    ATC_STR_RAT_SMAX: { id: 'ATC_STR_RAT_SMAX', label: 'Steering Rate Slew Limit', description: 'Upper limit on the slew rate from the combined steering P and D terms (0 = disabled).', category: 'steering', minimum: 0, maximum: 200, step: 0.5, notes: steeringRateNotes },
    ATC_STR_ACC_MAX: { id: 'ATC_STR_ACC_MAX', label: 'Steering Accel Max', description: 'Maximum steering angular acceleration (deg/s/s); 0 = no limit.', category: 'steering', minimum: 0, maximum: 1000, step: 0.1 },
    ATC_STR_DEC_MAX: { id: 'ATC_STR_DEC_MAX', label: 'Steering Decel Max', description: 'Maximum steering angular deceleration (deg/s/s); 0 = no limit.', category: 'steering', minimum: 0, maximum: 1000, step: 0.1 },

    ATC_SPEED_P: { id: 'ATC_SPEED_P', label: 'Speed P', description: 'Throttle/speed controller proportional gain.', category: 'speed', minimum: 0, maximum: 2, step: 0.001, notes: speedThrottleNotes },
    ATC_SPEED_I: { id: 'ATC_SPEED_I', label: 'Speed I', description: 'Throttle/speed controller integral gain.', category: 'speed', minimum: 0, maximum: 2, step: 0.001, notes: speedThrottleNotes },
    ATC_SPEED_D: { id: 'ATC_SPEED_D', label: 'Speed D', description: 'Throttle/speed controller derivative gain.', category: 'speed', minimum: 0, maximum: 0.5, step: 0.001, notes: speedThrottleNotes },
    ATC_SPEED_IMAX: { id: 'ATC_SPEED_IMAX', label: 'Speed IMAX', description: 'Maximum integrator authority for the speed loop.', category: 'speed', minimum: 0, maximum: 1, step: 0.01 },
    ATC_ACCEL_MAX: { id: 'ATC_ACCEL_MAX', label: 'Acceleration Max', description: 'Maximum commanded acceleration (m/s/s); 0 = no limit.', category: 'speed', minimum: 0, maximum: 10, step: 0.1 },
    ATC_DECEL_MAX: { id: 'ATC_DECEL_MAX', label: 'Deceleration Max', description: 'Maximum commanded deceleration (m/s/s); 0 = use ATC_ACCEL_MAX.', category: 'speed', minimum: 0, maximum: 10, step: 0.1 },
    ATC_BRAKE: { id: 'ATC_BRAKE', label: 'Brake Enable', description: 'Allow reverse throttle to actively brake the rover.', category: 'speed', options: enabledDisabledOptions },
    ATC_SPEED_FF: { id: 'ATC_SPEED_FF', label: 'Speed FF', description: 'Throttle/speed controller feed-forward gain.', category: 'speed', minimum: 0, maximum: 0.5, step: 0.001, notes: speedThrottleNotes },
    ATC_SPEED_FLTT: { id: 'ATC_SPEED_FLTT', label: 'Speed Target Filter', description: 'Speed controller target low-pass filter frequency (Hz).', category: 'speed', minimum: 0, maximum: 100, step: 0.1, notes: speedThrottleNotes },
    ATC_SPEED_FLTE: { id: 'ATC_SPEED_FLTE', label: 'Speed Error Filter', description: 'Speed controller error low-pass filter frequency (Hz).', category: 'speed', minimum: 0, maximum: 100, step: 0.1, notes: speedThrottleNotes },
    ATC_SPEED_FLTD: { id: 'ATC_SPEED_FLTD', label: 'Speed D Filter', description: 'Speed controller derivative-term low-pass filter frequency (Hz).', category: 'speed', minimum: 0, maximum: 100, step: 0.1, notes: speedThrottleNotes },
    ATC_SPEED_SMAX: { id: 'ATC_SPEED_SMAX', label: 'Speed Slew Limit', description: 'Upper limit on the slew rate from the combined speed P and D terms (0 = disabled).', category: 'speed', minimum: 0, maximum: 200, step: 0.5, notes: speedThrottleNotes },
    ATC_STOP_SPEED: { id: 'ATC_STOP_SPEED', label: 'Stop Speed', description: 'Motor output is zeroed once vehicle speed falls below this value (m/s).', category: 'speed', minimum: 0, maximum: 0.5, step: 0.01, notes: speedThrottleNotes },
    SPEED_MAX: { id: 'SPEED_MAX', label: 'Maximum Speed', description: 'Maximum speed (m/s) at full throttle; 0 = estimate from CRUISE_SPEED/CRUISE_THROTTLE.', category: 'speed', minimum: 0, maximum: 30, step: 0.1, notes: speedThrottleNotes },

    WP_SPEED: { id: 'WP_SPEED', label: 'Waypoint Speed', description: 'Target speed (m/s) between waypoints in Auto; 0 = use CRUISE_SPEED.', category: 'navigation', minimum: 0, maximum: 100, step: 0.1 },
    WP_RADIUS: { id: 'WP_RADIUS', label: 'Waypoint Radius', description: 'Distance (m) from a waypoint at which it is considered reached.', category: 'navigation', minimum: 0, maximum: 100, step: 0.1 },
    // Rover 4.3 nav controller refactor: the L1 nav controller (NAVL1_*) and
    // overshoot-permissive cornering (WP_OVERSHOOT) were retired in favor of
    // the s-curve kinematic path planner driven by WP_ACCEL / WP_JERK. The
    // separate top-level TURN_MAX_G was rehomed under the AR_AttitudeControl
    // class as ATC_TURN_MAX_G (same unit, same range — alias-safe). Keep the
    // legacy IDs so curated UX still renders if an older firmware reports
    // them, but flag them so it's obvious which one matches your firmware.
    WP_OVERSHOOT: { id: 'WP_OVERSHOOT', label: 'Waypoint Overshoot (legacy)', description: 'Legacy Rover <4.3 cross-track overshoot allowance (m). Removed in 4.3 s-curve refactor; modern firmware shapes corners with WP_ACCEL / WP_JERK instead.', category: 'navigation', minimum: 0, maximum: 10, step: 0.1 },
    TURN_RADIUS: { id: 'TURN_RADIUS', label: 'Turn Radius', description: 'Minimum turning radius (m) of the vehicle at low speed.', category: 'navigation', minimum: 0, maximum: 10, step: 0.1 },
    TURN_MAX_G: { id: 'TURN_MAX_G', label: 'Turn Max G (legacy)', description: 'Legacy Rover <4.3 name. Modern firmware reports ATC_TURN_MAX_G (same unit g, same range).', category: 'navigation', minimum: 0.1, maximum: 10, step: 0.1 },
    NAVL1_PERIOD: { id: 'NAVL1_PERIOD', label: 'L1 Period (legacy)', description: 'Legacy Rover <4.3 L1-nav-controller period (s). L1 nav was retired in 4.3 in favor of the s-curve kinematic path planner — no direct replacement; tune WP_ACCEL / WP_JERK instead.', category: 'navigation', minimum: 1, maximum: 60, step: 1, notes: roverNavNotes },
    NAVL1_DAMPING: { id: 'NAVL1_DAMPING', label: 'L1 Damping (legacy)', description: 'Legacy Rover <4.3 L1-nav-controller damping. L1 nav was retired in 4.3; tune the s-curve planner (WP_ACCEL/JERK) instead.', category: 'navigation', minimum: 0.6, maximum: 1, step: 0.05, notes: roverNavNotes },
    NAVL1_XTRACK_I: { id: 'NAVL1_XTRACK_I', label: 'L1 Crosstrack Integrator (legacy)', description: 'Legacy Rover <4.3 L1 crosstrack-integrator gain. L1 nav was retired in 4.3 — crosstrack is now controlled by the s-curve planner.', category: 'navigation', minimum: 0, maximum: 0.1, step: 0.01, notes: roverNavNotes },
    WP_ACCEL: { id: 'WP_ACCEL', label: 'Waypoint Acceleration', description: 'Acceleration (m/s/s) used between waypoints; 0 = use ATC_ACCEL_MAX.', category: 'navigation', minimum: 0, maximum: 100, step: 0.1, notes: roverNavNotes },
    WP_JERK: { id: 'WP_JERK', label: 'Waypoint Jerk', description: 'Rate of change of acceleration (m/s/s/s) between waypoints; 0 = same as acceleration.', category: 'navigation', minimum: 0, maximum: 100, step: 0.1, notes: roverNavNotes },
    ATC_TURN_MAX_G: { id: 'ATC_TURN_MAX_G', label: 'Turn Max G', description: 'Maximum cornering lateral acceleration (g). Modern AR_AttitudeControl name; older firmware reports TURN_MAX_G with the same unit and range.', category: 'navigation', minimum: 0.1, maximum: 10, step: 0.01, notes: roverNavNotes },

    // Sailboat family — verbatim from ArduPilot Rover/sailboat.cpp Sailboat
    // var_info[], registered under the "SAIL_" prefix by Rover/Parameters.cpp
    // AP_SUBGROUPINFO(sailboat, "SAIL_", ...). @Range / @Increment / defaults
    // sourced directly from that table; no invented bounds.
    SAIL_ENABLE: { id: 'SAIL_ENABLE', label: 'Enable Sailboat', description: 'This enables Sailboat functionality.', category: 'sailing', rebootRequired: true, notes: sailNotes, options: enabledDisabledOptions },
    SAIL_ANGLE_MIN: { id: 'SAIL_ANGLE_MIN', label: 'Sail Min Angle', description: 'Mainsheet tight, angle between centerline and boom.', category: 'sailing', unit: 'deg', minimum: 0, maximum: 90, step: 1, notes: sailNotes },
    SAIL_ANGLE_MAX: { id: 'SAIL_ANGLE_MAX', label: 'Sail Max Angle', description: 'Mainsheet loose, angle between centerline and boom. For direct-control rotating masts, the rotation angle at SERVOx_MAX/_MIN; this value can exceed 90 degrees if the linkages can physically rotate the mast past that angle.', category: 'sailing', unit: 'deg', minimum: 0, maximum: 90, step: 1, notes: sailNotes },
    SAIL_ANGLE_IDEAL: { id: 'SAIL_ANGLE_IDEAL', label: 'Sail Ideal Angle', description: 'Ideal angle between sail and apparent wind.', category: 'sailing', unit: 'deg', minimum: 0, maximum: 90, step: 1, notes: sailNotes },
    SAIL_HEEL_MAX: { id: 'SAIL_HEEL_MAX', label: 'Sailing Maximum Heel Angle', description: 'When in auto sail trim modes the heel will be limited to this value using PID control.', category: 'sailing', unit: 'deg', minimum: 0, maximum: 90, step: 1, notes: sailNotes },
    SAIL_NO_GO_ANGLE: { id: 'SAIL_NO_GO_ANGLE', label: 'Sailing No-Go Zone Angle', description: 'The typical closest angle to the wind the vehicle will sail at; the vehicle will sail at this angle when going upwind.', category: 'sailing', unit: 'deg', minimum: 0, maximum: 90, step: 1, notes: sailNotes },
    SAIL_WNDSPD_MIN: { id: 'SAIL_WNDSPD_MIN', label: 'Sailboat Minimum Wind Speed', description: 'Minimum wind speed to continue sailing in; at lower wind speeds the sailboat will motor if one is fitted.', category: 'sailing', unit: 'm/s', minimum: 0, maximum: 5, step: 0.1, notes: sailNotes },
    SAIL_XTRACK_MAX: { id: 'SAIL_XTRACK_MAX', label: 'Sailing Max Cross Track Error', description: 'The sailboat will tack when it reaches this cross-track error, defining a corridor 2x this value wide; 0 disables.', category: 'sailing', unit: 'm', minimum: 5, maximum: 25, step: 1, notes: sailNotes },
    SAIL_LOIT_RADIUS: { id: 'SAIL_LOIT_RADIUS', label: 'Sailing Loiter Radius', description: 'When in sailing modes the vehicle will keep moving within this loiter radius.', category: 'sailing', unit: 'm', minimum: 0, maximum: 20, step: 1, notes: sailNotes },

    // Sail-heel PID — produces ATC_SAIL_* via AR_AttitudeControl.cpp
    // AP_SUBGROUPINFO(_sailboat_heel_pid, "_SAIL_", ...) nested under the
    // "ATC_" group. The base AC_PID library documents NO @Range for the
    // gain terms, so P/I/D/FF/IMAX/FLT* carry no editor bounds (avoid
    // inventing them); only SMAX has the source-documented @Range 0 200.
    ATC_SAIL_P: { id: 'ATC_SAIL_P', label: 'Sail Heel P', description: 'Sail-heel controller proportional gain.', category: 'sailing', step: 0.001, notes: sailHeelNotes },
    ATC_SAIL_I: { id: 'ATC_SAIL_I', label: 'Sail Heel I', description: 'Sail-heel controller integral gain.', category: 'sailing', step: 0.001, notes: sailHeelNotes },
    ATC_SAIL_D: { id: 'ATC_SAIL_D', label: 'Sail Heel D', description: 'Sail-heel controller derivative gain.', category: 'sailing', step: 0.001, notes: sailHeelNotes },
    ATC_SAIL_FF: { id: 'ATC_SAIL_FF', label: 'Sail Heel FF', description: 'Sail-heel controller feed-forward gain.', category: 'sailing', step: 0.001, notes: sailHeelNotes },
    ATC_SAIL_IMAX: { id: 'ATC_SAIL_IMAX', label: 'Sail Heel IMAX', description: 'Maximum integrator authority for the sail-heel loop.', category: 'sailing', step: 0.01, notes: sailHeelNotes },
    ATC_SAIL_FLTT: { id: 'ATC_SAIL_FLTT', label: 'Sail Heel Target Filter', description: 'Sail-heel controller target low-pass filter frequency (Hz).', category: 'sailing', unit: 'Hz', step: 0.1, notes: sailHeelNotes },
    ATC_SAIL_FLTE: { id: 'ATC_SAIL_FLTE', label: 'Sail Heel Error Filter', description: 'Sail-heel controller error low-pass filter frequency (Hz).', category: 'sailing', unit: 'Hz', step: 0.1, notes: sailHeelNotes },
    ATC_SAIL_FLTD: { id: 'ATC_SAIL_FLTD', label: 'Sail Heel D Filter', description: 'Sail-heel controller derivative-term low-pass filter frequency (Hz).', category: 'sailing', unit: 'Hz', step: 0.1, notes: sailHeelNotes },
    ATC_SAIL_SMAX: { id: 'ATC_SAIL_SMAX', label: 'Sail Heel Slew Limit', description: 'Upper limit on the slew rate from the combined sail-heel P and D terms (0 = disabled).', category: 'sailing', minimum: 0, maximum: 200, step: 0.5, notes: sailHeelNotes },

    // Wind Vane family — verbatim from ArduPilot
    // libraries/AP_WindVane/AP_WindVane.cpp var_info[], registered under the
    // "WNDVN_" prefix (NOT "WNDVNE_") by Rover/Parameters.cpp
    // AP_SUBGROUPINFO(windvane, "WNDVN_", ...). Filter defaults are -1-aware
    // (a value of -1 disables the filter), so no minimum is asserted on the
    // *_FILT params.
    WNDVN_TYPE: { id: 'WNDVN_TYPE', label: 'Wind Vane Type', description: 'Wind direction sensor type.', category: 'windvane', rebootRequired: true, notes: windVaneNotes, options: enumOptions(ARDUROVER_WNDVN_TYPE_LABELS) },
    WNDVN_DIR_PIN: { id: 'WNDVN_DIR_PIN', label: 'Wind Vane Direction Pin', description: 'Analog input pin to read as wind vane direction.', category: 'windvane', minimum: -1, maximum: 127, notes: windVaneNotes, options: enumOptions(ARDUROVER_WNDVN_ANALOG_PIN_LABELS) },
    WNDVN_DIR_V_MIN: { id: 'WNDVN_DIR_V_MIN', label: 'Wind Vane Voltage Minimum', description: 'Minimum voltage supplied by analog wind vane. When using pin 103, the maximum value of the parameter is 3.3V.', category: 'windvane', unit: 'V', minimum: 0, maximum: 5, step: 0.01, notes: windVaneNotes },
    WNDVN_DIR_V_MAX: { id: 'WNDVN_DIR_V_MAX', label: 'Wind Vane Voltage Maximum', description: 'Maximum voltage supplied by analog wind vane. When using pin 103, the maximum value of the parameter is 3.3V.', category: 'windvane', unit: 'V', minimum: 0, maximum: 5, step: 0.01, notes: windVaneNotes },
    WNDVN_DIR_OFS: { id: 'WNDVN_DIR_OFS', label: 'Wind Vane Headwind Offset', description: 'Angle offset when the analog wind vane is indicating a headwind, i.e. 0 degrees relative to vehicle.', category: 'windvane', unit: 'deg', minimum: 0, maximum: 360, step: 1, notes: windVaneNotes },
    WNDVN_DIR_FILT: { id: 'WNDVN_DIR_FILT', label: 'Wind Vane Direction Filter', description: 'Apparent wind vane direction low-pass filter frequency; a value of -1 disables the filter.', category: 'windvane', unit: 'Hz', step: 0.1, notes: windVaneNotes },
    WNDVN_CAL: { id: 'WNDVN_CAL', label: 'Wind Vane Calibration', description: 'Start wind vane calibration by setting this to 1 (direction) or 2 (speed).', category: 'windvane', notes: windVaneNotes, options: enumOptions(ARDUROVER_WNDVN_CAL_LABELS) },
    WNDVN_DIR_DZ: { id: 'WNDVN_DIR_DZ', label: 'Wind Vane Deadzone', description: 'Wind vane deadzone when using an analog sensor.', category: 'windvane', unit: 'deg', minimum: 0, maximum: 360, step: 1, notes: windVaneNotes },
    WNDVN_SPEED_MIN: { id: 'WNDVN_SPEED_MIN', label: 'Wind Vane Cutoff Wind Speed', description: 'Wind vane direction is ignored when apparent wind speed is below this value (if a wind-speed sensor is present).', category: 'windvane', unit: 'm/s', minimum: 0, maximum: 5, step: 0.1, notes: windVaneNotes },
    WNDVN_SPEED_TYPE: { id: 'WNDVN_SPEED_TYPE', label: 'Wind Speed Sensor Type', description: 'Wind speed sensor type.', category: 'windvane', rebootRequired: true, notes: windVaneNotes, options: enumOptions(ARDUROVER_WNDVN_SPEED_TYPE_LABELS) },
    WNDVN_SPEED_PIN: { id: 'WNDVN_SPEED_PIN', label: 'Wind Speed Sensor Pin', description: 'Wind speed analog input pin for the Modern Devices Wind Sensor rev. p.', category: 'windvane', minimum: -1, maximum: 127, notes: windVaneNotes, options: enumOptions(ARDUROVER_WNDVN_ANALOG_PIN_LABELS) },
    WNDVN_TEMP_PIN: { id: 'WNDVN_TEMP_PIN', label: 'Wind Speed Temp Pin', description: 'Wind speed sensor analog temperature input pin for the Modern Devices Wind Sensor rev. p; set to -1 to disable temperature readings.', category: 'windvane', minimum: -1, maximum: 127, notes: windVaneNotes, options: enumOptions(ARDUROVER_WNDVN_ANALOG_PIN_LABELS) },
    WNDVN_SPEED_OFS: { id: 'WNDVN_SPEED_OFS', label: 'Wind Speed Voltage Offset', description: 'Wind speed sensor analog voltage offset at zero wind speed.', category: 'windvane', unit: 'V', minimum: 0, maximum: 3.3, step: 0.01, notes: windVaneNotes },
    WNDVN_SPEED_FILT: { id: 'WNDVN_SPEED_FILT', label: 'Wind Speed Filter', description: 'Apparent wind speed low-pass filter frequency; a value of -1 disables the filter.', category: 'windvane', unit: 'Hz', step: 0.1, notes: windVaneNotes },
    WNDVN_TRUE_FILT: { id: 'WNDVN_TRUE_FILT', label: 'True Wind Filter', description: 'True wind speed and direction low-pass filter frequency; a value of -1 disables the filter.', category: 'windvane', unit: 'Hz', step: 0.1, notes: windVaneNotes },

    MOT_THR_MIN: { id: 'MOT_THR_MIN', label: 'Throttle Minimum', description: 'Minimum throttle percentage applied when moving (deadzone compensation).', category: 'motors', minimum: 0, maximum: 100, step: 1 },
    MOT_THR_MAX: { id: 'MOT_THR_MAX', label: 'Throttle Maximum', description: 'Maximum throttle percentage the controller may command.', category: 'motors', minimum: 0, maximum: 100, step: 1 },
    MOT_SLEWRATE: { id: 'MOT_SLEWRATE', label: 'Throttle Slew Rate', description: 'Maximum throttle change per second (% / s); 0 = no limit.', category: 'motors', minimum: 0, maximum: 1000, step: 1 },
    MOT_PWM_TYPE: { id: 'MOT_PWM_TYPE', label: 'Motor PWM Type', description: 'Output signal type for the throttle/steering motors.', category: 'motors', minimum: 0, maximum: 8 },

    BATT_MONITOR: { id: 'BATT_MONITOR', label: 'Battery Monitor', description: 'Battery monitoring backend.', category: 'power', rebootRequired: true, options: enumOptions(ARDUCOPTER_BATTERY_MONITOR_LABELS) },
    BATT_CAPACITY: { id: 'BATT_CAPACITY', label: 'Battery Capacity', description: 'Pack capacity in mAh.', category: 'power', minimum: 0, maximum: 100000, step: 50 },
    BATT_ARM_VOLT: { id: 'BATT_ARM_VOLT', label: 'Arming Voltage', description: 'Minimum pack voltage required to arm.', category: 'power', minimum: 0, maximum: 60, step: 0.1 },
    BATT_FS_VOLTSRC: { id: 'BATT_FS_VOLTSRC', label: 'Failsafe Voltage Source', description: 'Whether failsafe uses raw or sag-compensated voltage.', category: 'power', options: enumOptions(ARDUCOPTER_BATTERY_VOLTAGE_SOURCE_LABELS) },
    BATT_LOW_VOLT: { id: 'BATT_LOW_VOLT', label: 'Low Voltage', description: 'Pack voltage that triggers the low-battery failsafe.', category: 'failsafe', minimum: 0, maximum: 60, step: 0.1 },
    BATT_FS_LOW_ACT: { id: 'BATT_FS_LOW_ACT', label: 'Low Battery Action', description: 'Action taken on the low-battery failsafe.', category: 'failsafe', options: enumOptions(ARDUROVER_BATTERY_FAILSAFE_ACTION_LABELS) },
    BATT_CRT_VOLT: { id: 'BATT_CRT_VOLT', label: 'Critical Voltage', description: 'Pack voltage that triggers the critical-battery failsafe.', category: 'failsafe', minimum: 0, maximum: 60, step: 0.1 },
    BATT_FS_CRT_ACT: { id: 'BATT_FS_CRT_ACT', label: 'Critical Battery Action', description: 'Action taken on the critical-battery failsafe.', category: 'failsafe', options: enumOptions(ARDUROVER_BATTERY_FAILSAFE_ACTION_LABELS) },

    FS_ACTION: { id: 'FS_ACTION', label: 'Failsafe Action', description: 'What the rover does when a throttle/GCS failsafe fires.', category: 'failsafe', options: enumOptions(ARDUROVER_FS_ACTION_LABELS) },
    FS_THR_ENABLE: { id: 'FS_THR_ENABLE', label: 'Throttle Failsafe', description: 'Enable the RC throttle failsafe.', category: 'failsafe', options: enumOptions(ARDUROVER_FS_THR_ENABLE_LABELS) },
    FS_THR_VALUE: { id: 'FS_THR_VALUE', label: 'Throttle Failsafe PWM', description: 'Throttle PWM below this value triggers the failsafe.', category: 'failsafe', minimum: 910, maximum: 1100, step: 1 },
    FS_TIMEOUT: { id: 'FS_TIMEOUT', label: 'Failsafe Timeout', description: 'Seconds a failsafe condition must persist before the action fires.', category: 'failsafe', minimum: 0.1, maximum: 30, step: 0.1 },
    FS_GCS_ENABLE: { id: 'FS_GCS_ENABLE', label: 'GCS Failsafe', description: 'Enable the ground-station link failsafe.', category: 'failsafe', options: enumOptions(ARDUROVER_GCS_FS_LABELS) },
    FS_CRASH_CHECK: { id: 'FS_CRASH_CHECK', label: 'Crash Check Action', description: 'Action when a crash/stuck condition is detected.', category: 'failsafe', options: enumOptions(ARDUROVER_FS_CRASH_CHECK_LABELS) },
    FS_EKF_ACTION: { id: 'FS_EKF_ACTION', label: 'EKF Failsafe Action', description: 'Action on an EKF (state estimate) failsafe.', category: 'failsafe', options: enumOptions(ARDUROVER_FS_EKF_ACTION_LABELS) },

    RSSI_TYPE: { id: 'RSSI_TYPE', label: 'RSSI Type', description: 'Signal-strength input source.', category: 'radio', options: enumOptions(ARDUCOPTER_RSSI_TYPE_LABELS) },
    RCMAP_ROLL: { id: 'RCMAP_ROLL', label: 'Steering Channel', description: 'RC channel mapped to steering.', category: 'radio', minimum: 1, maximum: 16, step: 1 },
    RCMAP_THROTTLE: { id: 'RCMAP_THROTTLE', label: 'Throttle Channel', description: 'RC channel mapped to throttle.', category: 'radio', minimum: 1, maximum: 16, step: 1 },

    VTX_ENABLE: { id: 'VTX_ENABLE', label: 'VTX Control', description: 'Enable MAVLink/SmartAudio video-transmitter control.', category: 'vtx', options: enumOptions(ARDUCOPTER_VTX_ENABLE_LABELS) },
    OSD_TYPE: { id: 'OSD_TYPE', label: 'OSD Backend', description: 'On-screen display backend.', category: 'osd', options: enumOptions(ARDUCOPTER_OSD_TYPE_LABELS) },
    OSD_CHAN: { id: 'OSD_CHAN', label: 'OSD Screen Channel', description: 'RC channel used to switch OSD screens.', category: 'osd', options: enumOptions(ARDUCOPTER_OSD_CHANNEL_LABELS) },
    OSD_SW_METHOD: { id: 'OSD_SW_METHOD', label: 'OSD Switch Method', description: 'How the OSD screen-switch channel is interpreted.', category: 'osd', options: enumOptions(ARDUCOPTER_OSD_SWITCH_METHOD_LABELS) },

    LOG_BACKEND_TYPE: { id: 'LOG_BACKEND_TYPE', label: 'Log Backend', description: 'Where dataflash logs are written.', category: 'logging', options: enumOptions(ARDUCOPTER_LOG_BACKEND_LABELS) },
    LOG_BITMASK: { id: 'LOG_BITMASK', label: 'Log Bitmask', description: 'Bitmask selecting which message groups are logged.', category: 'logging', minimum: 0, maximum: 65535, step: 1 },
    LOG_FILE_DSRMROT: { id: 'LOG_FILE_DSRMROT', label: 'Rotate Log On Disarm', description: 'Start a new log file each time the rover disarms.', category: 'logging', options: enabledDisabledOptions },
    LOG_DISARMED: { id: 'LOG_DISARMED', label: 'Log While Disarmed', description: 'Continue logging while the rover is disarmed.', category: 'logging', options: enabledDisabledOptions }
  },
  setupSections: [
    {
      id: 'link',
      title: 'Vehicle Link',
      description: 'Bring the Rover online and pull the first parameter snapshot.',
      requiredParameters: [],
      actions: ['request-parameters']
    },
    {
      id: 'sensors',
      title: 'Sensors',
      description: 'Verify board orientation and compass selection before tuning or driving.',
      requiredParameters: ['AHRS_ORIENTATION', 'COMPASS_USE'],
      actions: ['calibrate-accelerometer', 'calibrate-level', 'calibrate-compass']
    },
    {
      id: 'radio',
      title: 'Radio',
      description: 'Inspect primary RC input and verify the drive-mode channel.',
      requiredParameters: ['MODE_CH'],
      requiredLiveSignals: ['rc-input'],
    },
    {
      id: 'drive',
      title: 'Drive Config',
      description: 'Confirm cruise speed/throttle and pilot steering behavior before any motion.',
      requiredParameters: ['CRUISE_SPEED', 'CRUISE_THROTTLE']
    },
    {
      id: 'power',
      title: 'Battery',
      description: 'Validate battery monitoring before driving.',
      requiredParameters: ['BATT_MONITOR', 'BATT_CAPACITY'],
      // BATT_MONITOR=0 disables battery monitoring entirely. Same trap as
      // Copter / Plane — the section reading "complete" with monitoring
      // off is misleading.
      requiredNonZeroParameters: ['BATT_MONITOR'],
      requiredLiveSignals: ['battery-telemetry'],
    },
    {
      id: 'failsafe',
      title: 'Failsafe',
      description: 'Review Rover throttle/GCS failsafe and battery failsafe behavior.',
      requiredParameters: [
        'FS_THR_ENABLE',
        'FS_THR_VALUE',
        'FS_ACTION',
        'BATT_FS_VOLTSRC',
        'BATT_LOW_VOLT',
        'BATT_FS_LOW_ACT',
        'BATT_CRT_VOLT',
        'BATT_FS_CRT_ACT'
      ],
      requiredLiveSignals: ['rc-input', 'battery-telemetry'],
    },
    {
      id: 'verify',
      title: 'Verify',
      description: 'Final pre-drive review and reboot before any powered testing.',
      requiredParameters: [],
      actions: ['reboot-autopilot']
    }
  ]
}
