import type { FirmwareMetadataBundle, ParameterValueOption } from './types.js'
import { AHRS_ORIENTATION_OPTIONS } from './shared-enums.js'
import {
  ARDUCOPTER_AUTOTUNE_AXES_BIT_LABELS,
  ARDUCOPTER_BATTERY_FAILSAFE_ACTION_LABELS,
  ARDUCOPTER_BATTERY_MONITOR_LABELS,
  ARDUCOPTER_BATTERY_VOLTAGE_SOURCE_LABELS,
  ARDUCOPTER_FLTMODE_CHANNEL_LABELS,
  ARDUCOPTER_FLIGHT_MODE_LABELS,
  ARDUCOPTER_FRAME_CLASS_LABELS,
  ARDUCOPTER_FRAME_TYPE_LABELS,
  ARDUCOPTER_FS_EKF_ACTION_LABELS,
  ARDUCOPTER_FS_GCS_LABELS,
  ARDUCOPTER_GPS_AUTO_CONFIG_LABELS,
  ARDUCOPTER_GPS_AUTO_SWITCH_LABELS,
  ARDUCOPTER_GPS_PRIMARY_LABELS,
  ARDUCOPTER_GPS_RATE_MS_LABELS,
  ARDUCOPTER_GPS_TYPE_LABELS,
  ARDUCOPTER_LOG_BACKEND_LABELS,
  ARDUCOPTER_MSP_OSD_CELL_COUNT_LABELS,
  ARDUCOPTER_MOT_PWM_TYPE_LABELS,
  ARDUCOPTER_NOTIFICATION_LED_BRIGHTNESS_LABELS,
  ARDUCOPTER_NOTIFICATION_LED_OVERRIDE_LABELS,
  ARDUCOPTER_OSD_CHANNEL_LABELS,
  ARDUCOPTER_OSD_SWITCH_METHOD_LABELS,
  ARDUCOPTER_OSD_TYPE_LABELS,
  ARDUCOPTER_DSHOT_RATE_LABELS,
  ARDUCOPTER_BLH_AUTO_LABELS,
  ARDUCOPTER_OUTPUT_CHANNEL_BIT_LABELS,
  ARDUCOPTER_RC_OPTIONS_BIT_LABELS,
  ARDUCOPTER_ARMING_CHECK_BIT_LABELS,
  ARDUCOPTER_ARMING_REQUIRE_LABELS,
  ARDUCOPTER_ARMING_RUDDER_LABELS,
  ARDUCOPTER_SCHED_LOOP_RATE_LABELS,
  ARDUCOPTER_INS_GYRO_RATE_LABELS,
  ARDUCOPTER_INS_USE_LABELS,
  ARDUCOPTER_FS_OPTIONS_BIT_LABELS,
  ARDUCOPTER_RSSI_TYPE_LABELS,
  ARDUCOPTER_SERIAL_BAUD_LABELS,
  ARDUCOPTER_SERIAL_OPTION_BIT_LABELS,
  ARDUCOPTER_SERIAL_PROTOCOL_LABELS,
  ARDUCOPTER_SERIAL_RTSCTS_LABELS,
  ARDUCOPTER_SERVO_FUNCTION_LABELS,
  ARDUCOPTER_THROTTLE_FAILSAFE_LABELS,
  ARDUCOPTER_VTX_ENABLE_LABELS,
} from './arducopter-enums.js'

const enabledDisabledOptions: ParameterValueOption[] = [
  { value: 0, label: 'Disabled' },
  { value: 1, label: 'Enabled' }
]

const rcEndpointNotes = [
  'Receiver endpoint changes should be followed by another live RC range verification pass.'
]

const rcMapNotes = [
  'Changing RCMAP_* requires a reboot before the new mapping is fully applied.',
  'After changing RC mapping, repeat RC endpoint capture before flight.'
]

const serialProtocolNotes = [
  'Changing a serial port protocol usually requires a reboot before the new port role is fully applied.',
  'After changing a port role, reconnect the peripheral and verify telemetry before flight.'
]

const serialBaudNotes = [
  'Baud-rate changes should be matched to the connected peripheral before reconnecting.'
]

const serialFlowControlNotes = [
  'Only enable RTS/CTS flow control if the connected peripheral and wiring support it.'
]

const serialOptionsNotes = [
  'Serial options expose board-level UART behavior such as half-duplex, inversion, and DMA quirks.',
  'Change these only when the connected receiver, VTX, or peripheral explicitly needs a specific option combination.'
]

const gpsTypeNotes = [
  'After changing GPS driver types, reconnect the sensor and verify lock/telemetry before flight.'
]

const gpsAutoConfigNotes = [
  'Automatic GPS configuration is usually helpful, but it can overwrite manual receiver settings on the attached module.',
  'Reboot and verify live GPS telemetry after changing this behavior.'
]

const gpsSwitchingNotes = [
  'Primary/secondary GPS behavior matters most on dual-GPS setups; keep it simple unless you are actually using redundancy.',
  'If blending or automatic switching is enabled, verify which GPS is primary before flight.'
]

const gpsRateNotes = [
  'Higher GPS update rates can help responsiveness but also increase bus load and CPU work on some targets.',
  'Only raise the GPS rate if the attached module and link can sustain it cleanly.'
]

const vtxEnableNotes = [
  'Use this only when a compatible VTX control path is actually connected and assigned on a serial port.',
  'After enabling VTX control, verify the actual channel, power, and pit behavior on the bench before flight.'
]

const vtxFrequencyNotes = [
  'Use a legal frequency for your region and confirm the actual transmitted channel with the VTX or goggles on the bench.',
  'Changing VTX frequency or power is a bench setup task; avoid guessing in the field.'
]

const vtxPowerNotes = [
  'Keep VTX power conservative during bench setup and only raise it once cooling airflow and legal constraints are understood.',
  'If the VTX has discrete power tables, confirm the requested level matches the hardware-reported level.'
]

const vtxOptionNotes = [
  'This is an advanced VTX behavior bitmask. Leave it alone unless the target VTX protocol expects a specific option combination.',
  'Bench-check pit mode and unlock behavior after changing advanced VTX options.'
]

const osdTypeNotes = [
  'Choose the backend that matches the actual FPV display path, then verify the live overlay in goggles or on the bench display before flight.',
  'Changing the OSD backend usually requires a reboot before the new display path is active.'
]

const osdSwitchNotes = [
  'Only assign an OSD screen-switch channel if the pilot actually needs multiple pages in flight.',
  'After changing OSD switching behavior, verify the page-switch action on the bench before flight.'
]

const mspOsdNotes = [
  'MSP and DisplayPort overlays depend on a matching serial-port role and baud rate on the linked UART.',
  'If the FPV overlay is missing or garbled, verify both the serial protocol assignment and the selected OSD backend.'
]

const osdElementNotes = [
  'OSD element placement is measured in character cells on the active video format. Confirm the layout in goggles or on a bench display before flight.',
  'Set the matching enable flag to 0 to hide the element entirely; the X/Y coordinates remain for when it is re-enabled.'
]

const loggingBackendNotes = [
  'Onboard SD-card logging (the File backend) is typically the right choice for FPV freestyle; MAVLink-only streams logs to the GCS and depends on the radio link.',
  'After changing the logging backend, verify a fresh log file is created on the next arm before relying on it for post-flight review.'
]

const loggingBitmaskNotes = [
  'LOG_BITMASK selects which message families are written to the log. Leaving it at the firmware default is safe; only narrow it for log-size pressure.',
  'Some advanced tooling (replay, autotune review) expects specific bits enabled. Confirm requirements before disabling categories.'
]

const loggingBehaviorNotes = [
  'These options control when logs are written and how the SD card is managed. Keep at least a few free megabytes available so a flight is never lost to a full card.',
  'Replay logging substantially increases log size; only enable it when you intend to use the captured logs for offline replay.'
]

const autotuneNotes = [
  'AUTOTUNE refines the rate-controller PIDs in the air. Assign an RC aux switch to the AutoTune function (or select the AUTOTUNE flight mode), then fly in AltHold and engage it — the copter twitches each selected axis for a few minutes per axis.',
  'To SAVE the tuned gains keep the AutoTune switch HIGH and land + disarm. To discard, switch AutoTune off before disarming. Always save a known-good tuning snapshot first and start over open space.'
]

const batteryMonitorNotes = [
  'Changing the battery monitor source typically requires a reboot before live telemetry matches the new configuration.',
  'Use a live powered session to confirm that the selected battery monitor is actually producing telemetry.'
]

const batteryCapacityNotes = [
  'Match this to the pack capacity that the vehicle will actually fly with.',
  'After changing battery capacity, verify the live remaining-percent estimate on a fully charged pack.'
]

const batteryThresholdNotes = [
  'Set this to zero only if you intentionally want to disable that threshold-based trigger.',
  'Verify the live battery telemetry and your actual cell count before tightening battery failsafe thresholds.'
]

const batteryArmNotes = [
  'Use this to prevent arming when the pack is already too depleted for a safe flight.',
  'Set to zero to disable the corresponding pre-arm battery check.'
]

const batteryVoltageSourceNotes = [
  'Sag-compensated voltage is usually more useful in flight because it accounts for transient load sag.',
  'Raw voltage can still be useful when comparing power-module calibration against a meter on the bench.'
]

const rcFailsafeThresholdNotes = [
  'Set this slightly above the receiver PWM value seen during radio-loss failsafe, then verify it on the bench.',
  'After changing the threshold, recheck throttle failsafe behavior before flight.'
]

const modeChannelNotes = [
  'Set this to the receiver channel that carries the flight-mode switch. Disable it only if mode selection is handled another way.',
  'After changing the mode channel, rerun the mode-switch exercise before flight.'
]

const rssiNotes = [
  'Only enable RSSI if the receiver or link is actually providing signal-strength data.',
  'Verify the live RSSI reading on the bench before using it as a confidence signal.'
]

const rssiChannelNotes = [
  'Use this only when RSSI is being carried on a dedicated RC channel.',
  'Keep the low/high values matched to the actual receiver output range.'
]

const advancedReceiverNotes = [
  'These receiver-link settings are more advanced than channel mapping and RSSI. Change them only when the actual radio link requires it.',
  'After changing receiver link timing or options, recheck live RC input and failsafe behavior on the bench.'
]

const advancedFailsafeNotes = [
  'These settings change how long the controller waits and how it behaves when RC or battery problems occur.',
  'After changing advanced failsafe behavior, recheck pre-arm state and do another bench review before flight.'
]

const disarmDelayNotes = [
  'This controls how long the vehicle waits before auto-disarming after landing or inactivity.',
  'Keep it long enough to avoid nuisance disarms during setup, but not so long that a landed vehicle stays armed unnecessarily.'
]

const notificationLedNotes = [
  'Notification LED drivers only work when the chosen LED type matches the actual hardware and any required output assignment.',
  'After changing LED types or string length, bench-check the indicator behavior before flight.'
]

const notificationBuzzNotes = [
  'Only enable buzzer drivers that are actually present on the target hardware.',
  'Bench-check the buzzer output after changing notification behavior so the aircraft still has an audible locate/failsafe alert.'
]

const flightFeelNotes = [
  'Make small changes, fly-test, and keep a known-good backup before pushing responsiveness further.',
  'These controls are intended to stay beginner-safe; use Expert mode for deeper controller tuning.'
]

const acroRateNotes = [
  'Rates and expo are best adjusted a little at a time, with a short hover or line-of-sight test between changes.',
  'This first tuning surface intentionally stops at rates and expo so the setup workflow stays approachable.'
]

const pidTuningNotes = [
  'Rate P, I, D, and feedforward changes should be made in small increments with a fresh snapshot saved first.',
  'Keep roll and pitch gains close unless you have a specific asymmetry that requires a deliberate split.'
]

const filterTuningNotes = [
  'Lower filter values increase smoothing and latency; higher values preserve response but can let more noise through.',
  'Treat zero values carefully because some ArduPilot filter parameters use zero to disable that specific filter path.'
]

const presetPrerequisites = [
  'Finish receiver, output, failsafe, and power setup before applying a tuning preset.',
  'Apply one preset family at a time and do a short test flight before stacking more changes.'
]

const flightFeelPresetCautions = [
  'These presets adjust angle-mode stick feel and yaw handling only; they do not retune the underlying rate controller.',
  'A pre-apply snapshot is captured automatically so you can roll back to the previous known-good setup if needed.'
]

const acroRatePresetCautions = [
  'These presets change acro stick sensitivity only; they do not change PID/controller gains.',
  'Start with the balanced preset unless you already know you want either a softer or more aggressive rate profile.'
]

const multirotorPresetFrameClasses = [1, 2, 3, 4, 5, 7, 9, 10, 12, 14] as const

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

function enumOptions(labelMap: Record<number, string>): ParameterValueOption[] {
  return Object.entries(labelMap)
    .map(([value, label]) => ({
      value: Number(value),
      label
    }))
    .sort((left, right) => left.value - right.value)
}

type OsdElementDescriptor = {
  paramSuffix: string
  label: string
}

const osdLayoutElements: readonly OsdElementDescriptor[] = [
  { paramSuffix: 'BAT_VOLT', label: 'Battery Voltage' },
  { paramSuffix: 'RSSI', label: 'RC RSSI' },
  { paramSuffix: 'ALTITUDE', label: 'Altitude' },
  { paramSuffix: 'THROTTLE', label: 'Throttle' },
  { paramSuffix: 'CURRENT', label: 'Battery Current' },
  { paramSuffix: 'HEADING', label: 'Heading' },
  { paramSuffix: 'GSPEED', label: 'Ground Speed' },
  { paramSuffix: 'HOME', label: 'Home Arrow' },
  { paramSuffix: 'HORIZON', label: 'Artificial Horizon' },
  { paramSuffix: 'FLTMODE', label: 'Flight Mode' }
]

function buildOsdElementParameterDefinitions(screenNumber: number): FirmwareMetadataBundle['parameters'] {
  const definitions: FirmwareMetadataBundle['parameters'] = {}
  const screenLabel = `OSD${screenNumber}`

  for (const element of osdLayoutElements) {
    const baseId = `${screenLabel}_${element.paramSuffix}`

    definitions[`${baseId}_EN`] = {
      id: `${baseId}_EN`,
      label: `${screenLabel} ${element.label} Enabled`,
      description: `Whether the ${element.label.toLowerCase()} element is drawn on ${screenLabel}.`,
      category: 'osd',
      minimum: 0,
      maximum: 1,
      notes: osdElementNotes,
      options: enabledDisabledOptions
    }

    // X / Y ranges match ArduPilot upstream (0-59 X, 0-21 Y) so HD
     // backends (50x18 / 60x22 grids) can address every cell. A narrower
     // 30x16 PAL cap would reject legitimate HD-layout positions as
     // out-of-range during drag-to-position or direct parameter writes,
     // even though the firmware accepts them fine.
    definitions[`${baseId}_X`] = {
      id: `${baseId}_X`,
      label: `${screenLabel} ${element.label} Column`,
      description: `Horizontal character-cell position for the ${element.label.toLowerCase()} element on ${screenLabel}.`,
      category: 'osd',
      minimum: 0,
      maximum: 59,
      step: 1,
      notes: osdElementNotes
    }

    definitions[`${baseId}_Y`] = {
      id: `${baseId}_Y`,
      label: `${screenLabel} ${element.label} Row`,
      description: `Vertical character-cell position for the ${element.label.toLowerCase()} element on ${screenLabel}.`,
      category: 'osd',
      minimum: 0,
      maximum: 21,
      step: 1,
      notes: osdElementNotes
    }
  }

  return definitions
}

// Per-screen "Screen Options" (the Mission Planner OSD Screen Options panel):
// enable, HD text resolution, font, RC switch range, and ESC telemetry index.
// Kept numeric (with accurate ranges, no fabricated enum labels) so the editor
// never writes a wrong option to real hardware.
function buildOsdScreenOptionDefinitions(screenNumber: number): FirmwareMetadataBundle['parameters'] {
  const screenLabel = `OSD${screenNumber}`
  return {
    [`${screenLabel}_ENABLE`]: {
      id: `${screenLabel}_ENABLE`,
      label: `${screenLabel} Enabled`,
      description: `Whether ${screenLabel} is available as a selectable OSD screen.`,
      category: 'osd',
      minimum: 0,
      maximum: 1,
      notes: osdElementNotes,
      options: enabledDisabledOptions
    },
    [`${screenLabel}_TXT_RES`]: {
      id: `${screenLabel}_TXT_RES`,
      label: `${screenLabel} Text Resolution`,
      description: `Character-grid resolution for ${screenLabel} on HD digital OSD systems (e.g. 50x18 vs 60x22). Ignored by analog MAX7456.`,
      category: 'osd',
      minimum: 0,
      maximum: 2,
      step: 1,
      notes: osdElementNotes
    },
    [`${screenLabel}_FONT`]: {
      id: `${screenLabel}_FONT`,
      label: `${screenLabel} Font`,
      description: `Font index used for ${screenLabel}.`,
      category: 'osd',
      minimum: 0,
      maximum: 21,
      step: 1,
      notes: osdElementNotes
    },
    [`${screenLabel}_CHAN_MIN`]: {
      id: `${screenLabel}_CHAN_MIN`,
      label: `${screenLabel} Channel Min`,
      description: `Lower RC PWM bound (us) of the switch range that selects ${screenLabel}.`,
      category: 'osd',
      minimum: 900,
      maximum: 2100,
      step: 1,
      unit: 'us',
      notes: osdSwitchNotes
    },
    [`${screenLabel}_CHAN_MAX`]: {
      id: `${screenLabel}_CHAN_MAX`,
      label: `${screenLabel} Channel Max`,
      description: `Upper RC PWM bound (us) of the switch range that selects ${screenLabel}.`,
      category: 'osd',
      minimum: 900,
      maximum: 2100,
      step: 1,
      unit: 'us',
      notes: osdSwitchNotes
    },
    [`${screenLabel}_ESC_IDX`]: {
      id: `${screenLabel}_ESC_IDX`,
      label: `${screenLabel} ESC Index`,
      description: `Which ESC's telemetry the ${screenLabel} ESC elements show (0 = average/all).`,
      category: 'osd',
      minimum: 0,
      maximum: 32,
      step: 1,
      notes: osdElementNotes
    }
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
        // SERIALn_OPTIONS is a real bitmask (InvertRX / InvertTX /
        // HalfDuplex / Swap / NoTransmit / NoReceive / NoStartstop / …)
        // — the option list enumerates BIT INDICES, not mutually-
        // exclusive values. Without `bitmask: true` the deriveParameterDraftEntry
        // strict-enum check rejects any multi-bit value (e.g. 5 = bits
        // 0+2) as "outside the known enum values"; flagging it as bitmask
        // makes the catalog match reality and lets ScopedBitmaskField
        // render the proper per-bit checkbox grid.
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

// ArduPilot exposes up to 32 SERVOn outputs depending on the board. Generate
// SERVOn_FUNCTION / SERVOn_MIN / SERVOn_MAX / SERVOn_TRIM / SERVOn_REVERSED
// metadata for every potential channel so the curated UI has labels and
// bounds even on high-output boards. The runtime filters channels by what
// the FC actually reports (see deriveServoOutputAssignments), so this is
// pure metadata coverage — no behavior change for low-output boards.
function buildServoChannelParameterDefinitions(maxChannelNumber: number): FirmwareMetadataBundle['parameters'] {
  const definitions: FirmwareMetadataBundle['parameters'] = {}

  for (let channelNumber = 1; channelNumber <= maxChannelNumber; channelNumber += 1) {
    definitions[`SERVO${channelNumber}_FUNCTION`] = {
      id: `SERVO${channelNumber}_FUNCTION`,
      label: `Output ${channelNumber} Function`,
      description: `Assigned function for output channel ${channelNumber}.`,
      category: 'outputs',
      notes: ['After remapping outputs, confirm the new assignment with a guarded motor or output review before flight.'],
      options: enumOptions(ARDUCOPTER_SERVO_FUNCTION_LABELS)
    }
    definitions[`SERVO${channelNumber}_MIN`] = {
      id: `SERVO${channelNumber}_MIN`,
      label: `Output ${channelNumber} PWM Min`,
      description: `Minimum PWM value (microseconds) for output channel ${channelNumber}.`,
      category: 'outputs',
      unit: 'us',
      minimum: 800,
      maximum: 2200,
      step: 1
    }
    definitions[`SERVO${channelNumber}_MAX`] = {
      id: `SERVO${channelNumber}_MAX`,
      label: `Output ${channelNumber} PWM Max`,
      description: `Maximum PWM value (microseconds) for output channel ${channelNumber}.`,
      category: 'outputs',
      unit: 'us',
      minimum: 800,
      maximum: 2200,
      step: 1
    }
    definitions[`SERVO${channelNumber}_TRIM`] = {
      id: `SERVO${channelNumber}_TRIM`,
      label: `Output ${channelNumber} PWM Trim`,
      description: `Centre/idle PWM value (microseconds) for output channel ${channelNumber}.`,
      category: 'outputs',
      unit: 'us',
      minimum: 800,
      maximum: 2200,
      step: 1
    }
    definitions[`SERVO${channelNumber}_REVERSED`] = {
      id: `SERVO${channelNumber}_REVERSED`,
      label: `Output ${channelNumber} Reversed`,
      description: `Whether the output direction on channel ${channelNumber} is inverted.`,
      category: 'outputs',
      minimum: 0,
      maximum: 1,
      options: [
        { value: 0, label: 'Normal' },
        { value: 1, label: 'Reversed' }
      ]
    }
  }

  return definitions
}

export const arducopterMetadata: FirmwareMetadataBundle = {
  firmware: 'ArduCopter',
  appViews: [
    {
      id: 'setup',
      label: 'Setup',
      description: 'Connection, calibration, and guided setup.',
      order: 1
    },
    {
      id: 'ports',
      label: 'Ports',
      description: 'Serial roles, GPS links, and peripheral setup.',
      order: 2
    },
    {
      id: 'vtx',
      label: 'VTX',
      description: 'Video transmitter control, channel, and power setup.',
      order: 3
    },
    {
      id: 'osd',
      label: 'OSD',
      description: 'FPV display backend, screen mode, and overlay switching.',
      order: 4
    },
    {
      id: 'receiver',
      label: 'Receiver',
      description: 'RC mapping, ranges, and flight modes.',
      order: 5
    },
    {
      id: 'modes',
      label: 'Modes',
      description: 'Flight-mode switch assignments and live position.',
      order: 6
    },
    {
      id: 'motors',
      label: 'Motors',
      description: 'Frame class, motor map, direction tests, ESC protocol, and verification review.',
      order: 7
    },
    {
      id: 'servos',
      label: 'Servos',
      description: 'Peripheral servo function assignments — gimbal, parachute, gripper, and other aux outputs.',
      order: 7.5
    },
    {
      id: 'power',
      label: 'Power',
      description: 'Battery, failsafe, and pre-arm review.',
      order: 8
    },
    {
      id: 'failsafe',
      label: 'Failsafe',
      description: 'RC, battery, and advanced failsafe overview.',
      order: 9
    },
    {
      id: 'logs',
      label: 'Logs',
      description: 'Onboard log backend, retention, and replay summary.',
      order: 10
    },
    {
      id: 'snapshots',
      label: 'Snapshots',
      description: 'Capture, compare, and restore known-good parameter sets.',
      order: 11
    },
    {
      id: 'tuning',
      label: 'Tuning',
      description: 'Beginner-safe flight-feel and acro-rate tuning.',
      order: 12
    },
    {
      id: 'presets',
      label: 'Presets',
      description: 'Curated, explainable tuning bundles with automatic backup.',
      order: 13
    },
    {
      id: 'config',
      label: 'Config',
      description: 'Baseline misc — board orientation, arming behavior, system identity, statistics.',
      order: 13.5
    },
    {
      id: 'parameters',
      label: 'Parameters',
      description: 'Low-level parameter editing and backup work.',
      order: 14
    }
  ],
  categories: {
    airframe: {
      id: 'airframe',
      label: 'Airframe',
      description: 'Frame geometry, type, and mounting configuration.',
      order: 1,
      viewId: 'motors'
    },
    sensors: {
      id: 'sensors',
      label: 'Sensors',
      description: 'Board orientation and sensor-related setup.',
      order: 2,
      viewId: 'setup'
    },
    ports: {
      id: 'ports',
      label: 'Ports',
      description: 'Serial roles, baud rates, and peripheral transport settings.',
      order: 3,
      viewId: 'ports'
    },
    peripherals: {
      id: 'peripherals',
      label: 'Peripherals',
      description: 'GPS and other externally attached peripherals.',
      order: 4,
      viewId: 'ports'
    },
    vtx: {
      id: 'vtx',
      label: 'VTX',
      description: 'Video transmitter control, frequency, and power settings.',
      order: 5,
      viewId: 'vtx'
    },
    osd: {
      id: 'osd',
      label: 'OSD',
      description: 'FPV overlay backend, switching, and display configuration.',
      order: 6,
      viewId: 'osd'
    },
    radio: {
      id: 'radio',
      label: 'Receiver',
      description: 'RC mapping, ranges, and calibration values.',
      order: 7,
      viewId: 'receiver'
    },
    modes: {
      id: 'modes',
      label: 'Modes',
      description: 'Flight-mode assignments and switch setup.',
      order: 8,
      viewId: 'receiver'
    },
    outputs: {
      id: 'outputs',
      label: 'Outputs',
      description: 'Motor, servo, and propulsion-related outputs.',
      order: 9,
      // The 'outputs' param category routes to the Motors nav tab when
      // the user clicks "edit in tab" from Parameters. Motor outputs
      // dominate the category; aux servo outputs surface naturally in
      // the same shell.
      viewId: 'motors'
    },
    power: {
      id: 'power',
      label: 'Power',
      description: 'Battery sensing and power monitoring.',
      order: 10,
      viewId: 'power'
    },
    failsafe: {
      id: 'failsafe',
      label: 'Failsafe',
      description: 'Throttle, battery, and failsafe behavior.',
      order: 11,
      viewId: 'failsafe'
    },
    tuning: {
      id: 'tuning',
      label: 'Flight Feel',
      description: 'Simple multirotor handling adjustments for angle mode and general stick feel.',
      order: 12,
      viewId: 'tuning'
    },
    acro: {
      id: 'acro',
      label: 'Acro Rates',
      description: 'Acro roll, pitch, and yaw rates plus expo.',
      order: 13,
      viewId: 'tuning'
    },
    pid: {
      id: 'pid',
      label: 'PID Gains',
      description: 'Rate-controller P, I, D, and feedforward gains.',
      order: 14,
      viewId: 'tuning'
    },
    filters: {
      id: 'filters',
      label: 'Filters',
      description: 'Rate-controller filter and bandwidth settings.',
      order: 15,
      viewId: 'tuning'
    },
    logging: {
      id: 'logging',
      label: 'Logging',
      description: 'Onboard log backend, retention, and bitmask configuration.',
      order: 16,
      viewId: 'parameters'
    }
  },
  presetGroups: {
    'flight-feel': {
      id: 'flight-feel',
      label: 'Flight Feel',
      description: 'Preset bundles for angle-mode feel, smoothing, and general yaw response.',
      order: 1
    },
    'acro-rates': {
      id: 'acro-rates',
      label: 'Acro Rates',
      description: 'Preset bundles for acro roll, pitch, and yaw stick sensitivity.',
      order: 2
    }
  },
  presets: {
    'flight-feel-cinematic': {
      id: 'flight-feel-cinematic',
      label: 'Cinematic Glide',
      description: 'Maximum smoothing with low lean angle and slow yaw for cinematic, drift-free shots.',
      groupId: 'flight-feel',
      order: 0,
      values: [
        { paramId: 'ATC_INPUT_TC', value: 0.5 },
        { paramId: 'ANGLE_MAX', value: 2500 },
        { paramId: 'PILOT_Y_RATE', value: 100 },
        { paramId: 'PILOT_Y_EXPO', value: 0.25 }
      ],
      note: 'For deliberately slow, smooth FPV cinematography. Combine with a soft acro/rate profile if the airframe will be flown manually.',
      tags: ['cinematic', 'smooth', 'video'],
      prerequisites: presetPrerequisites,
      cautions: flightFeelPresetCautions,
      compatibility: {
        frameClasses: [...multirotorPresetFrameClasses]
      }
    },
    'flight-feel-soft': {
      id: 'flight-feel-soft',
      label: 'Smooth Explorer',
      description: 'Softer angle-mode response, lower lean angle, and gentler yaw authority for relaxed cruising.',
      groupId: 'flight-feel',
      order: 1,
      values: [
        { paramId: 'ATC_INPUT_TC', value: 0.3 },
        { paramId: 'ANGLE_MAX', value: 3500 },
        { paramId: 'PILOT_Y_RATE', value: 160 },
        { paramId: 'PILOT_Y_EXPO', value: 0.18 }
      ],
      note: 'Good first preset for a larger or heavier multirotor when you want a calm self-leveling feel.',
      tags: ['baseline', 'smooth', 'cinematic'],
      prerequisites: presetPrerequisites,
      cautions: flightFeelPresetCautions,
      compatibility: {
        frameClasses: [...multirotorPresetFrameClasses]
      }
    },
    'flight-feel-balanced': {
      id: 'flight-feel-balanced',
      label: 'Balanced Baseline',
      description: 'Moderate smoothing and lean angle for an all-around starting point.',
      groupId: 'flight-feel',
      order: 2,
      values: [
        { paramId: 'ATC_INPUT_TC', value: 0.22 },
        { paramId: 'ANGLE_MAX', value: 4200 },
        { paramId: 'PILOT_Y_RATE', value: 200 },
        { paramId: 'PILOT_Y_EXPO', value: 0.1 }
      ],
      note: 'Use this first if you are not yet sure whether the vehicle should feel softer or more immediate.',
      tags: ['baseline', 'balanced'],
      prerequisites: presetPrerequisites,
      cautions: flightFeelPresetCautions,
      compatibility: {
        frameClasses: [...multirotorPresetFrameClasses]
      }
    },
    'flight-feel-crisp': {
      id: 'flight-feel-crisp',
      label: 'Crisp Response',
      description: 'Lower smoothing, steeper lean angle, and firmer yaw response for a more immediate feel.',
      groupId: 'flight-feel',
      order: 3,
      values: [
        { paramId: 'ATC_INPUT_TC', value: 0.14 },
        { paramId: 'ANGLE_MAX', value: 5000 },
        { paramId: 'PILOT_Y_RATE', value: 260 },
        { paramId: 'PILOT_Y_EXPO', value: 0.04 }
      ],
      note: 'Use only after confirming the vehicle is already well-behaved on a calmer baseline.',
      tags: ['responsive', 'sport'],
      prerequisites: presetPrerequisites,
      cautions: flightFeelPresetCautions,
      compatibility: {
        frameClasses: [...multirotorPresetFrameClasses]
      }
    },
    'acro-rates-gentle': {
      id: 'acro-rates-gentle',
      label: 'Gentle Acro',
      description: 'Lower acro rates with more expo for easier center-stick precision.',
      groupId: 'acro-rates',
      order: 1,
      values: [
        { paramId: 'ACRO_RP_RATE', value: 220 },
        { paramId: 'ACRO_Y_RATE', value: 180 },
        { paramId: 'ACRO_RP_EXPO', value: 0.18 },
        { paramId: 'ACRO_Y_EXPO', value: 0.14 }
      ],
      note: 'A conservative acro preset for pilots moving over from stabilized flight or flying tighter spaces.',
      tags: ['acro', 'gentle', 'training'],
      prerequisites: presetPrerequisites,
      cautions: acroRatePresetCautions,
      compatibility: {
        frameClasses: [...multirotorPresetFrameClasses]
      }
    },
    'acro-rates-balanced': {
      id: 'acro-rates-balanced',
      label: 'Balanced Acro',
      description: 'Moderate acro rates with a small amount of expo for a versatile FPV baseline.',
      groupId: 'acro-rates',
      order: 2,
      values: [
        { paramId: 'ACRO_RP_RATE', value: 320 },
        { paramId: 'ACRO_Y_RATE', value: 240 },
        { paramId: 'ACRO_RP_EXPO', value: 0.1 },
        { paramId: 'ACRO_Y_EXPO', value: 0.08 }
      ],
      note: 'A good general-purpose rate baseline for most small and mid-size multirotors.',
      tags: ['acro', 'baseline', 'balanced'],
      prerequisites: presetPrerequisites,
      cautions: acroRatePresetCautions,
      compatibility: {
        frameClasses: [...multirotorPresetFrameClasses]
      }
    },
    'acro-rates-sport': {
      id: 'acro-rates-sport',
      label: 'Sport Acro',
      description: 'Higher acro rates with low expo for sharper flips, rolls, and snap response.',
      groupId: 'acro-rates',
      order: 3,
      values: [
        { paramId: 'ACRO_RP_RATE', value: 420 },
        { paramId: 'ACRO_Y_RATE', value: 300 },
        { paramId: 'ACRO_RP_EXPO', value: 0.04 },
        { paramId: 'ACRO_Y_EXPO', value: 0.03 }
      ],
      note: 'Aggressive freestyle baseline; start lower unless you already know the airframe can handle it.',
      tags: ['acro', 'sport', 'responsive'],
      prerequisites: presetPrerequisites,
      cautions: acroRatePresetCautions,
      compatibility: {
        frameClasses: [...multirotorPresetFrameClasses]
      }
    },
    'acro-rates-race': {
      id: 'acro-rates-race',
      label: 'Race Acro',
      description: 'High rotation rates with linear (zero-expo) stick response for FPV race lines.',
      groupId: 'acro-rates',
      order: 4,
      values: [
        { paramId: 'ACRO_RP_RATE', value: 540 },
        { paramId: 'ACRO_Y_RATE', value: 380 },
        { paramId: 'ACRO_RP_EXPO', value: 0 },
        { paramId: 'ACRO_Y_EXPO', value: 0 }
      ],
      note: 'For pilots already comfortable with Sport Acro who want a linear, race-style stick response. Expect noticeably more sensitivity around center.',
      tags: ['acro', 'race', 'aggressive', 'fpv'],
      prerequisites: presetPrerequisites,
      cautions: [
        ...acroRatePresetCautions,
        'Linear (zero-expo) rates leave no center-stick deadband softening, so accidental stick input directly drives full rate. Test on a familiar airframe before flying lines.'
      ],
      compatibility: {
        frameClasses: [...multirotorPresetFrameClasses]
      }
    }
  },
  parameters: {
    FRAME_CLASS: {
      id: 'FRAME_CLASS',
      label: 'Frame Class',
      description: 'Primary airframe class for the vehicle.',
      category: 'airframe',
      minimum: 0,
      maximum: 17,
      rebootRequired: true,
      notes: ['After changing frame geometry, refresh outputs and re-check motor direction before flight.'],
      options: enumOptions(ARDUCOPTER_FRAME_CLASS_LABELS)
    },
    FRAME_TYPE: {
      id: 'FRAME_TYPE',
      label: 'Frame Type',
      description: 'Specific motor geometry within the selected frame class.',
      category: 'airframe',
      minimum: 0,
      maximum: 19,
      rebootRequired: true,
      notes: ['Frame-type changes should be followed by a reboot and another output review.'],
      options: enumOptions(ARDUCOPTER_FRAME_TYPE_LABELS)
    },
    AHRS_ORIENTATION: {
      id: 'AHRS_ORIENTATION',
      label: 'Board Orientation',
      description: 'Mounting orientation for the flight controller.',
      category: 'sensors',
      minimum: 0,
      maximum: 102,
      options: AHRS_ORIENTATION_OPTIONS,
      notes: ['If the board orientation changes, repeat accelerometer calibration before flight.']
    },
    COMPASS_USE: {
      id: 'COMPASS_USE',
      label: 'Compass Enabled',
      description: 'Primary compass enable state.',
      category: 'sensors',
      minimum: 0,
      maximum: 1,
      options: enabledDisabledOptions
    },
    COMPASS_USE2: {
      id: 'COMPASS_USE2',
      label: 'Compass 2 Enabled',
      description: 'Secondary compass enable state.',
      category: 'sensors',
      minimum: 0,
      maximum: 1,
      options: enabledDisabledOptions
    },
    COMPASS_USE3: {
      id: 'COMPASS_USE3',
      label: 'Compass 3 Enabled',
      description: 'Tertiary compass enable state.',
      category: 'sensors',
      minimum: 0,
      maximum: 1,
      options: enabledDisabledOptions
    },
    // MAVLink system / GCS identifiers. The ArduPilot master branch renamed
    // these to MAV_SYSID / MAV_GCS_SYSID (same range 1..255, no unit change),
    // but the rename has NOT yet shipped in stable releases — real ArduCopter
    // 4.6 still streams SYSID_THISMAV / SYSID_MYGCS on the wire (verified on
    // a real Radix 2 HD running 4.6.3 on 2026-05-27). The catalog carries
    // both forms so a future stable release that ships the rename also
    // resolves; the runtime alias shim mirrors raw values between them. The
    // legacy entries deliberately do NOT carry a "(legacy)" tag — almost
    // every user today is on a release that streams these names, and
    // labelling them legacy would mislabel the param the user is editing.
    // These are the params a fleet operator most often wants to bump (e.g.
    // when running multiple vehicles on the same shared SiK / radio link).
    SYSID_THISMAV: {
      id: 'SYSID_THISMAV',
      label: 'MAVLink System ID',
      description: 'Unique MAVLink system identifier for this autopilot. Each vehicle on a shared link needs a different value. ArduPilot master renamed this to MAV_SYSID; rename not yet in stable as of 4.6.',
      category: 'sensors',
      minimum: 1,
      maximum: 255,
      step: 1,
      notes: ['Default is 1. Bump to a unique value (2, 3, …) when multiple vehicles share the same telemetry link or the operator needs to address a specific airframe.']
    },
    MAV_SYSID: {
      id: 'MAV_SYSID',
      label: 'MAVLink System ID (master)',
      description: 'ArduPilot master rename for SYSID_THISMAV (same range 1..255). Not yet in stable as of 4.6 — stable firmware streams SYSID_THISMAV.',
      category: 'sensors',
      minimum: 1,
      maximum: 255,
      step: 1,
      notes: ['Default is 1. Bump to a unique value (2, 3, …) when multiple vehicles share the same telemetry link or the operator needs to address a specific airframe.']
    },
    SYSID_MYGCS: {
      id: 'SYSID_MYGCS',
      label: 'Ground Station System ID',
      description: 'System ID of the ground station this autopilot accepts commands from. ArduPilot master renamed this to MAV_GCS_SYSID; rename not yet in stable as of 4.6.',
      category: 'sensors',
      minimum: 1,
      maximum: 255,
      step: 1,
      notes: ['Default 255 accepts commands from any GCS. Tighten this to a specific value to restrict who can send commands to the vehicle.']
    },
    MAV_GCS_SYSID: {
      id: 'MAV_GCS_SYSID',
      label: 'Ground Station System ID (master)',
      description: 'ArduPilot master rename for SYSID_MYGCS (same range 1..255). Not yet in stable as of 4.6 — stable firmware streams SYSID_MYGCS.',
      category: 'sensors',
      minimum: 1,
      maximum: 255,
      step: 1,
      notes: ['Default 255 accepts commands from any GCS. Tighten this to a specific value to restrict who can send commands to the vehicle.']
    },
    // Calibration-output params. The autopilot writes AHRS_TRIM_X/Y after a
    // successful level calibration, and COMPASS_OFS_* after a compass cal —
    // surfacing them in the curated UI lets the operator confirm that a cal
    // run actually landed plausible values (typical accel trims are tiny
    // radians; healthy compass offsets are well within +/-400 mGauss).
    AHRS_TRIM_X: {
      id: 'AHRS_TRIM_X',
      label: 'Board Roll Trim (X)',
      description: 'Roll trim (radians) — written by the level calibration.',
      category: 'sensors',
      unit: 'rad',
      minimum: -0.1745,
      maximum: 0.1745,
      step: 0.0001,
      notes: ['Updated automatically by level calibration. Editing manually is unusual; re-run level cal if you want a fresh value.']
    },
    AHRS_TRIM_Y: {
      id: 'AHRS_TRIM_Y',
      label: 'Board Pitch Trim (Y)',
      description: 'Pitch trim (radians) — written by the level calibration.',
      category: 'sensors',
      unit: 'rad',
      minimum: -0.1745,
      maximum: 0.1745,
      step: 0.0001,
      notes: ['Updated automatically by level calibration. Editing manually is unusual; re-run level cal if you want a fresh value.']
    },
    COMPASS_OFS_X: {
      id: 'COMPASS_OFS_X',
      label: 'Compass 1 X Offset',
      description: 'Primary compass X-axis offset (mGauss) — written by compass calibration.',
      category: 'sensors',
      unit: 'mGauss',
      minimum: -1000,
      maximum: 1000,
      step: 1,
      notes: ['Updated automatically by compass calibration. Healthy offsets are well within +/-400 mGauss; large values suggest magnetic interference or a bad cal.']
    },
    COMPASS_OFS_Y: {
      id: 'COMPASS_OFS_Y',
      label: 'Compass 1 Y Offset',
      description: 'Primary compass Y-axis offset (mGauss) — written by compass calibration.',
      category: 'sensors',
      unit: 'mGauss',
      minimum: -1000,
      maximum: 1000,
      step: 1
    },
    COMPASS_OFS_Z: {
      id: 'COMPASS_OFS_Z',
      label: 'Compass 1 Z Offset',
      description: 'Primary compass Z-axis offset (mGauss) — written by compass calibration.',
      category: 'sensors',
      unit: 'mGauss',
      minimum: -1000,
      maximum: 1000,
      step: 1
    },
    ...buildSerialPortParameterDefinitions(8),
    GPS_TYPE: {
      id: 'GPS_TYPE',
      label: 'Primary GPS Type',
      description: 'Driver type used for the primary GPS/peripheral input.',
      category: 'peripherals',
      minimum: 0,
      maximum: 25,
      rebootRequired: true,
      notes: gpsTypeNotes,
      options: enumOptions(ARDUCOPTER_GPS_TYPE_LABELS)
    },
    GPS_TYPE2: {
      id: 'GPS_TYPE2',
      label: 'Secondary GPS Type',
      description: 'Driver type used for the secondary GPS/peripheral input.',
      category: 'peripherals',
      minimum: 0,
      maximum: 25,
      rebootRequired: true,
      notes: ['Disable this if no secondary GPS is attached. Reboot after changes before verifying redundancy.', ...gpsTypeNotes],
      options: enumOptions(ARDUCOPTER_GPS_TYPE_LABELS)
    },
    GPS_AUTO_CONFIG: {
      id: 'GPS_AUTO_CONFIG',
      label: 'GPS Auto Configure',
      description: 'Automatic configuration behavior for attached GPS modules.',
      category: 'peripherals',
      minimum: 0,
      maximum: 3,
      rebootRequired: true,
      notes: gpsAutoConfigNotes,
      options: enumOptions(ARDUCOPTER_GPS_AUTO_CONFIG_LABELS)
    },
    GPS_AUTO_SWITCH: {
      id: 'GPS_AUTO_SWITCH',
      label: 'GPS Auto Switch',
      description: 'How the controller chooses between the primary and secondary GPS on dual-GPS setups.',
      category: 'peripherals',
      minimum: 0,
      maximum: 4,
      notes: gpsSwitchingNotes,
      options: enumOptions(ARDUCOPTER_GPS_AUTO_SWITCH_LABELS)
    },
    GPS_PRIMARY: {
      id: 'GPS_PRIMARY',
      label: 'Primary GPS Select',
      description: 'Preferred GPS when multiple GPS units are configured.',
      category: 'peripherals',
      minimum: 0,
      maximum: 1,
      notes: gpsSwitchingNotes,
      options: enumOptions(ARDUCOPTER_GPS_PRIMARY_LABELS)
    },
    GPS_RATE_MS: {
      id: 'GPS_RATE_MS',
      label: 'GPS Update Rate',
      description: 'Requested GPS update period for supported serial GPS modules.',
      category: 'peripherals',
      unit: 'ms',
      minimum: 50,
      maximum: 200,
      step: 1,
      rebootRequired: true,
      notes: gpsRateNotes,
      options: enumOptions(ARDUCOPTER_GPS_RATE_MS_LABELS)
    },
    // New 4.5+ per-instance GPS params. The legacy GPS_TYPE / GPS_TYPE2 /
    // GPS_RATE_MS resolutions are still curated above and stay readable via
    // the runtime's bidirectional alias shim (see runtime.ts). These entries
    // catalogue the genuinely-new fields (antenna position, timing delay)
    // that have no legacy equivalent.
    GPS1_POS_X: {
      id: 'GPS1_POS_X',
      label: 'GPS 1 Antenna Position X',
      description: 'Forward antenna offset of GPS 1 from the body-frame origin (positive = nose).',
      category: 'peripherals',
      unit: 'm',
      minimum: -5,
      maximum: 5,
      step: 0.01,
      notes: ['Body-frame meters. Set this if the GPS antenna sits significantly off-centre — the EKF compensates for the lever arm.']
    },
    GPS1_POS_Y: {
      id: 'GPS1_POS_Y',
      label: 'GPS 1 Antenna Position Y',
      description: 'Right antenna offset of GPS 1 from the body-frame origin (positive = right).',
      category: 'peripherals',
      unit: 'm',
      minimum: -5,
      maximum: 5,
      step: 0.01
    },
    GPS1_POS_Z: {
      id: 'GPS1_POS_Z',
      label: 'GPS 1 Antenna Position Z',
      description: 'Down antenna offset of GPS 1 from the body-frame origin (positive = down).',
      category: 'peripherals',
      unit: 'm',
      minimum: -5,
      maximum: 5,
      step: 0.01
    },
    GPS1_DELAY_MS: {
      id: 'GPS1_DELAY_MS',
      label: 'GPS 1 Fix Delay',
      description: 'Fix-latency offset (ms) applied to GPS 1 measurements before EKF fusion.',
      category: 'peripherals',
      unit: 'ms',
      minimum: 0,
      maximum: 250,
      step: 1,
      notes: ['Leave at 0 unless you have measured an actual hardware delay. Most modern receivers report timing accurately and do not need this.']
    },
    GPS2_POS_X: {
      id: 'GPS2_POS_X',
      label: 'GPS 2 Antenna Position X',
      description: 'Forward antenna offset of GPS 2 from the body-frame origin (positive = nose).',
      category: 'peripherals',
      unit: 'm',
      minimum: -5,
      maximum: 5,
      step: 0.01
    },
    GPS2_POS_Y: {
      id: 'GPS2_POS_Y',
      label: 'GPS 2 Antenna Position Y',
      description: 'Right antenna offset of GPS 2 from the body-frame origin (positive = right).',
      category: 'peripherals',
      unit: 'm',
      minimum: -5,
      maximum: 5,
      step: 0.01
    },
    GPS2_POS_Z: {
      id: 'GPS2_POS_Z',
      label: 'GPS 2 Antenna Position Z',
      description: 'Down antenna offset of GPS 2 from the body-frame origin (positive = down).',
      category: 'peripherals',
      unit: 'm',
      minimum: -5,
      maximum: 5,
      step: 0.01
    },
    OSD_TYPE: {
      id: 'OSD_TYPE',
      label: 'OSD Backend',
      description: 'Display backend used for the FPV on-screen display.',
      category: 'osd',
      minimum: 0,
      maximum: 5,
      rebootRequired: true,
      notes: osdTypeNotes,
      options: enumOptions(ARDUCOPTER_OSD_TYPE_LABELS)
    },
    OSD_CHAN: {
      id: 'OSD_CHAN',
      label: 'OSD Screen Channel',
      description: 'Receiver channel used to switch between OSD pages.',
      category: 'osd',
      minimum: 0,
      maximum: 16,
      notes: osdSwitchNotes,
      options: enumOptions(ARDUCOPTER_OSD_CHANNEL_LABELS)
    },
    OSD_SW_METHOD: {
      id: 'OSD_SW_METHOD',
      label: 'OSD Switch Method',
      description: 'How the selected OSD channel chooses or advances through pages.',
      category: 'osd',
      minimum: 0,
      maximum: 2,
      notes: osdSwitchNotes,
      options: enumOptions(ARDUCOPTER_OSD_SWITCH_METHOD_LABELS)
    },
    ...buildOsdElementParameterDefinitions(1),
    ...buildOsdElementParameterDefinitions(2),
    ...buildOsdElementParameterDefinitions(3),
    ...buildOsdElementParameterDefinitions(4),
    ...buildOsdScreenOptionDefinitions(1),
    ...buildOsdScreenOptionDefinitions(2),
    ...buildOsdScreenOptionDefinitions(3),
    ...buildOsdScreenOptionDefinitions(4),
    MSP_OPTIONS: {
      id: 'MSP_OPTIONS',
      label: 'MSP Options',
      description: 'Advanced MSP and DisplayPort behavior bitmask.',
      category: 'osd',
      minimum: 0,
      maximum: 7,
      notes: mspOsdNotes
    },
    MSP_OSD_NCELLS: {
      id: 'MSP_OSD_NCELLS',
      label: 'MSP Cell Count',
      description: 'Battery cell-count value sent to MSP-capable FPV displays.',
      category: 'osd',
      minimum: 0,
      maximum: 14,
      notes: mspOsdNotes,
      options: enumOptions(ARDUCOPTER_MSP_OSD_CELL_COUNT_LABELS)
    },
    VTX_ENABLE: {
      id: 'VTX_ENABLE',
      label: 'VTX Control',
      description: 'Enables ArduPilot control of a supported video transmitter.',
      category: 'vtx',
      notes: vtxEnableNotes,
      options: enumOptions(ARDUCOPTER_VTX_ENABLE_LABELS)
    },
    VTX_FREQ: {
      id: 'VTX_FREQ',
      label: 'VTX Frequency',
      description: 'Requested VTX output frequency.',
      category: 'vtx',
      unit: 'MHz',
      minimum: 0,
      maximum: 6000,
      step: 1,
      notes: vtxFrequencyNotes
    },
    VTX_POWER: {
      id: 'VTX_POWER',
      label: 'VTX Power',
      description: 'Requested VTX output power.',
      category: 'vtx',
      unit: 'mW',
      minimum: 0,
      maximum: 5000,
      step: 1,
      notes: vtxPowerNotes
    },
    VTX_MAX_POWER: {
      id: 'VTX_MAX_POWER',
      label: 'VTX Max Power',
      description: 'Upper power limit allowed for VTX control requests.',
      category: 'vtx',
      unit: 'mW',
      minimum: 0,
      maximum: 5000,
      step: 1,
      notes: vtxPowerNotes
    },
    VTX_OPTIONS: {
      id: 'VTX_OPTIONS',
      label: 'VTX Advanced Options',
      description: 'Advanced VTX behavior bitmask.',
      category: 'vtx',
      minimum: 0,
      maximum: 255,
      step: 1,
      notes: vtxOptionNotes
    },
    BATT_MONITOR: {
      id: 'BATT_MONITOR',
      label: 'Battery Monitor',
      description: 'Battery sensing source configuration.',
      category: 'power',
      minimum: 0,
      maximum: 24,
      rebootRequired: true,
      notes: batteryMonitorNotes,
      options: enumOptions(ARDUCOPTER_BATTERY_MONITOR_LABELS)
    },
    BATT_CAPACITY: {
      id: 'BATT_CAPACITY',
      label: 'Battery Capacity',
      description: 'Nominal battery capacity used for failsafe and remaining estimate.',
      category: 'power',
      unit: 'mAh',
      minimum: 0,
      step: 1,
      notes: batteryCapacityNotes
    },
    BATT_ARM_VOLT: {
      id: 'BATT_ARM_VOLT',
      label: 'Arm Voltage Threshold',
      description: 'Battery voltage that must be present before the vehicle is allowed to arm.',
      category: 'power',
      unit: 'V',
      minimum: 0,
      step: 0.1,
      notes: batteryArmNotes
    },
    BATT_ARM_MAH: {
      id: 'BATT_ARM_MAH',
      label: 'Arm Capacity Threshold',
      description: 'Remaining battery capacity required before the vehicle is allowed to arm.',
      category: 'power',
      unit: 'mAh',
      minimum: 0,
      step: 1,
      notes: batteryArmNotes
    },
    DISARM_DELAY: {
      id: 'DISARM_DELAY',
      label: 'Auto Disarm Delay',
      description: 'Delay before the vehicle automatically disarms after landing or inactivity.',
      category: 'power',
      unit: 's',
      minimum: 0,
      maximum: 127,
      step: 1,
      notes: disarmDelayNotes
    },
    BATT_FS_VOLTSRC: {
      id: 'BATT_FS_VOLTSRC',
      label: 'Failsafe Voltage Source',
      description: 'Voltage source used when evaluating battery failsafe thresholds.',
      category: 'failsafe',
      minimum: 0,
      maximum: 1,
      notes: batteryVoltageSourceNotes,
      options: enumOptions(ARDUCOPTER_BATTERY_VOLTAGE_SOURCE_LABELS)
    },
    BATT_LOW_VOLT: {
      id: 'BATT_LOW_VOLT',
      label: 'Low Battery Voltage',
      description: 'Voltage threshold that triggers the low battery failsafe action.',
      category: 'failsafe',
      unit: 'V',
      minimum: 0,
      step: 0.1,
      notes: batteryThresholdNotes
    },
    BATT_LOW_MAH: {
      id: 'BATT_LOW_MAH',
      label: 'Low Battery Capacity',
      description: 'Remaining capacity threshold that triggers the low battery failsafe action.',
      category: 'failsafe',
      unit: 'mAh',
      minimum: 0,
      step: 1,
      notes: batteryThresholdNotes
    },
    BATT_LOW_TIMER: {
      id: 'BATT_LOW_TIMER',
      label: 'Low Battery Hold Time',
      description: 'Time the low-battery threshold must remain active before the low-battery failsafe triggers.',
      category: 'failsafe',
      unit: 's',
      minimum: 0,
      maximum: 120,
      step: 1,
      notes: advancedFailsafeNotes
    },
    BATT_FS_LOW_ACT: {
      id: 'BATT_FS_LOW_ACT',
      label: 'Low Battery Failsafe Action',
      description: 'Action taken when the low battery failsafe threshold is reached.',
      category: 'failsafe',
      minimum: 0,
      maximum: 7,
      options: enumOptions(ARDUCOPTER_BATTERY_FAILSAFE_ACTION_LABELS)
    },
    BATT_CRT_VOLT: {
      id: 'BATT_CRT_VOLT',
      label: 'Critical Battery Voltage',
      description: 'Voltage threshold that triggers the critical battery failsafe action.',
      category: 'failsafe',
      unit: 'V',
      minimum: 0,
      step: 0.1,
      notes: batteryThresholdNotes
    },
    BATT_CRT_MAH: {
      id: 'BATT_CRT_MAH',
      label: 'Critical Battery Capacity',
      description: 'Remaining capacity threshold that triggers the critical battery failsafe action.',
      category: 'failsafe',
      unit: 'mAh',
      minimum: 0,
      step: 1,
      notes: batteryThresholdNotes
    },
    BATT_FS_CRT_ACT: {
      id: 'BATT_FS_CRT_ACT',
      label: 'Critical Battery Action',
      description: 'Action taken when the critical battery threshold is reached.',
      category: 'failsafe',
      minimum: 0,
      maximum: 7,
      options: enumOptions(ARDUCOPTER_BATTERY_FAILSAFE_ACTION_LABELS)
    },
    ATC_INPUT_TC: {
      id: 'ATC_INPUT_TC',
      label: 'Stick Feel Smoothing',
      description: 'Input shaping time constant for roll and pitch demand. Lower values feel crisper; higher values feel softer.',
      category: 'tuning',
      unit: 's',
      minimum: 0,
      maximum: 1,
      step: 0.01,
      notes: flightFeelNotes
    },
    // Max-lean-angle. The ArduPilot master branch renamed ANGLE_MAX (cdeg)
    // -> ATC_ANGLE_MAX (deg, factor 100), but the rename has NOT yet shipped
    // in stable releases — real ArduCopter 4.6 still streams ANGLE_MAX in
    // cdeg on the wire (verified on a real Radix 2 HD on 2026-05-27). The
    // catalog carries both forms so a future stable release that ships the
    // rename also resolves, and the curated Tuning view filters by id so
    // only the variant the FC actually streams renders (no duplicates).
    // Alias shim deliberately omitted — a raw value mirror would be 100x
    // off across the unit change.
    ANGLE_MAX: {
      id: 'ANGLE_MAX',
      label: 'Max Lean Angle',
      description: 'Maximum commanded lean angle in self-leveling modes (cdeg). ArduPilot master renamed this to ATC_ANGLE_MAX in degrees; rename not yet in stable as of 4.6.',
      category: 'tuning',
      unit: 'cdeg',
      minimum: 1000,
      maximum: 8000,
      step: 100,
      notes: ['This value is stored in centidegrees. A value of 4500 means 45 degrees of maximum lean.', ...flightFeelNotes]
    },
    ATC_ANGLE_MAX: {
      id: 'ATC_ANGLE_MAX',
      label: 'Max Lean Angle (master)',
      description: 'ArduPilot master rename for ANGLE_MAX, with the unit shifted cdeg -> deg (factor 100). Not yet in stable as of 4.6 — stable firmware streams ANGLE_MAX in cdeg.',
      category: 'tuning',
      unit: 'deg',
      minimum: 10,
      maximum: 80,
      step: 1,
      notes: flightFeelNotes
    },
    PILOT_Y_RATE: {
      id: 'PILOT_Y_RATE',
      label: 'Yaw Rate',
      description: 'Maximum yaw rate command used for pilot input outside acro tuning.',
      category: 'tuning',
      unit: 'deg/s',
      minimum: 1,
      maximum: 500,
      step: 1,
      notes: flightFeelNotes
    },
    PILOT_Y_EXPO: {
      id: 'PILOT_Y_EXPO',
      label: 'Yaw Expo',
      description: 'Softens yaw response near center stick while preserving full authority at the ends.',
      category: 'tuning',
      minimum: 0,
      maximum: 1,
      step: 0.01,
      notes: flightFeelNotes
    },
    FLTMODE1: {
      id: 'FLTMODE1',
      label: 'Flight Mode 1',
      description: 'Mode assigned to the first switch position.',
      category: 'modes',
      options: enumOptions(ARDUCOPTER_FLIGHT_MODE_LABELS)
    },
    FLTMODE2: {
      id: 'FLTMODE2',
      label: 'Flight Mode 2',
      description: 'Mode assigned to the second switch position.',
      category: 'modes',
      options: enumOptions(ARDUCOPTER_FLIGHT_MODE_LABELS)
    },
    FLTMODE3: {
      id: 'FLTMODE3',
      label: 'Flight Mode 3',
      description: 'Mode assigned to the third switch position.',
      category: 'modes',
      options: enumOptions(ARDUCOPTER_FLIGHT_MODE_LABELS)
    },
    FLTMODE4: {
      id: 'FLTMODE4',
      label: 'Flight Mode 4',
      description: 'Mode assigned to the fourth switch position.',
      category: 'modes',
      options: enumOptions(ARDUCOPTER_FLIGHT_MODE_LABELS)
    },
    FLTMODE5: {
      id: 'FLTMODE5',
      label: 'Flight Mode 5',
      description: 'Mode assigned to the fifth switch position.',
      category: 'modes',
      options: enumOptions(ARDUCOPTER_FLIGHT_MODE_LABELS)
    },
    FLTMODE6: {
      id: 'FLTMODE6',
      label: 'Flight Mode 6',
      description: 'Mode assigned to the sixth switch position.',
      category: 'modes',
      options: enumOptions(ARDUCOPTER_FLIGHT_MODE_LABELS)
    },
    FLTMODE_CH: {
      id: 'FLTMODE_CH',
      label: 'Flight Mode Channel',
      description: 'Receiver channel used to select flight modes.',
      category: 'modes',
      minimum: 0,
      maximum: 16,
      notes: modeChannelNotes,
      options: enumOptions(ARDUCOPTER_FLTMODE_CHANNEL_LABELS)
    },
    MODE_CH: {
      id: 'MODE_CH',
      label: 'Legacy Mode Channel',
      description: 'Legacy mode-channel parameter used on some older setups and firmware variants.',
      category: 'modes',
      minimum: 0,
      maximum: 16,
      notes: ['Prefer FLTMODE_CH when both parameters are present on the target.', ...modeChannelNotes],
      options: enumOptions(ARDUCOPTER_FLTMODE_CHANNEL_LABELS)
    },
    FS_THR_ENABLE: {
      id: 'FS_THR_ENABLE',
      label: 'Throttle Failsafe',
      description: 'Throttle failsafe enable behavior.',
      category: 'failsafe',
      minimum: 0,
      maximum: 7,
      options: enumOptions(ARDUCOPTER_THROTTLE_FAILSAFE_LABELS)
    },
    FS_THR_VALUE: {
      id: 'FS_THR_VALUE',
      label: 'Throttle Failsafe PWM',
      description: 'PWM threshold used to detect receiver-loss throttle failsafe.',
      category: 'failsafe',
      unit: 'us',
      minimum: 910,
      maximum: 1100,
      step: 1,
      notes: rcFailsafeThresholdNotes
    },
    RC_FS_TIMEOUT: {
      id: 'RC_FS_TIMEOUT',
      label: 'RC Failsafe Timeout',
      description: 'Time ArduPilot waits after losing valid RC input before triggering RC failsafe behavior.',
      category: 'failsafe',
      unit: 's',
      minimum: 0.1,
      maximum: 10,
      step: 0.1,
      notes: advancedFailsafeNotes
    },
    FS_OPTIONS: {
      id: 'FS_OPTIONS',
      label: 'Advanced Failsafe Options',
      description: 'Advanced failsafe behavior bitmask.',
      category: 'failsafe',
      minimum: 0,
      maximum: 65535,
      step: 1,
      bitmask: true,
      options: enumOptions(ARDUCOPTER_FS_OPTIONS_BIT_LABELS),
      notes: advancedFailsafeNotes
    },
    ARMING_CHECK: {
      id: 'ARMING_CHECK',
      label: 'Pre-arm checks',
      description:
        'Which pre-arm safety checks must pass before the vehicle will arm. "All checks" (bit 0) runs every check; clear it to pick individual checks. Disabling checks is a flight-safety risk — only do so deliberately on the bench.',
      category: 'failsafe',
      minimum: 0,
      maximum: 1048575,
      step: 1,
      bitmask: true,
      options: enumOptions(ARDUCOPTER_ARMING_CHECK_BIT_LABELS)
    },
    ARMING_REQUIRE: {
      id: 'ARMING_REQUIRE',
      label: 'Arming required (legacy)',
      description: 'Legacy ArduCopter parameter — removed in modern Copter firmware because motors always require arming on a multirotor (you cannot disarm and have motors spin). Retained for defensive coverage on very old (pre-4.0) builds. Modern firmware will not report this param. Plane and Rover still expose it.',
      category: 'failsafe',
      minimum: 0,
      maximum: 2,
      options: enumOptions(ARDUCOPTER_ARMING_REQUIRE_LABELS)
    },
    ARMING_RUDDER: {
      id: 'ARMING_RUDDER',
      label: 'Rudder arm/disarm',
      description: 'Whether the rudder stick (yaw) can arm and/or disarm the vehicle.',
      category: 'failsafe',
      minimum: 0,
      maximum: 2,
      options: enumOptions(ARDUCOPTER_ARMING_RUDDER_LABELS)
    },
    SCHED_LOOP_RATE: {
      id: 'SCHED_LOOP_RATE',
      label: 'Main loop rate',
      description: 'Scheduler / PID main loop frequency. Copter defaults to 400 Hz; lower rates ease CPU load on slow boards. Reboot required.',
      category: 'tuning',
      minimum: 50,
      maximum: 400,
      rebootRequired: true,
      options: enumOptions(ARDUCOPTER_SCHED_LOOP_RATE_LABELS)
    },
    INS_GYRO_RATE: {
      id: 'INS_GYRO_RATE',
      label: 'Gyro update rate',
      description: 'IMU gyro sample rate. Higher rates feed faster gyro data to the filters but cost CPU and need capable hardware. Reboot required.',
      category: 'tuning',
      minimum: 0,
      maximum: 3,
      rebootRequired: true,
      options: enumOptions(ARDUCOPTER_INS_GYRO_RATE_LABELS)
    },
    INS_FAST_SAMPLE: {
      id: 'INS_FAST_SAMPLE',
      label: 'Fast sampling (IMU mask)',
      description: 'Bitmask of which IMUs run fast gyro sampling. Bit 0 = first IMU. Most setups leave this at 1.',
      category: 'tuning',
      minimum: 0,
      maximum: 7,
      step: 1
    },
    AUTOTUNE_AXES: {
      id: 'AUTOTUNE_AXES',
      label: 'AutoTune Axes',
      description: '1-byte bitmap of axes to autotune.',
      category: 'tuning',
      minimum: 0,
      maximum: 15,
      step: 1,
      bitmask: true,
      notes: autotuneNotes,
      options: enumOptions(ARDUCOPTER_AUTOTUNE_AXES_BIT_LABELS)
    },
    AUTOTUNE_AGGR: {
      id: 'AUTOTUNE_AGGR',
      label: 'AutoTune Aggressiveness',
      description: 'Autotune aggressiveness. Defines the bounce back used to detect size of the D term.',
      category: 'tuning',
      minimum: 0.05,
      maximum: 0.1,
      // Hundredths (0.01) so a typed value like 0.07 / 0.08 isn't rejected
      // by the browser's number-input step validation — the previous 0.005
      // forced the operator to pick from 0.050, 0.055, 0.060, ... which
      // confused operators expecting 0.06, 0.07, 0.08 to "just work".
      step: 0.01,
      notes: autotuneNotes
    },
    AUTOTUNE_MIN_D: {
      id: 'AUTOTUNE_MIN_D',
      label: 'AutoTune Minimum D',
      description: 'Defines the minimum D gain.',
      category: 'tuning',
      minimum: 0.0001,
      maximum: 0.005,
      step: 0.0001,
      notes: autotuneNotes
    },
    AUTOTUNE_GMBK: {
      id: 'AUTOTUNE_GMBK',
      label: 'AutoTune Gain Margin Backoff',
      description:
        'Fraction by which tuned P and D gains are reduced after rate and angle AutoTune steps complete. This provides extra stability margin by reducing gains slightly from the optimal values found during tuning. A value of 0.0 applies no reduction. A value of 0.25 reduces tuned gains by 25%.',
      category: 'tuning',
      minimum: 0,
      maximum: 0.5,
      step: 0.05,
      notes: autotuneNotes
    },
    INS_USE: {
      id: 'INS_USE',
      label: 'Use IMU 1',
      description: 'Whether the first IMU is used by the EKF/AHRS.',
      category: 'sensors',
      minimum: 0,
      maximum: 1,
      rebootRequired: true,
      options: enumOptions(ARDUCOPTER_INS_USE_LABELS)
    },
    INS_USE2: {
      id: 'INS_USE2',
      label: 'Use IMU 2',
      description: 'Whether the second IMU is used by the EKF/AHRS.',
      category: 'sensors',
      minimum: 0,
      maximum: 1,
      rebootRequired: true,
      options: enumOptions(ARDUCOPTER_INS_USE_LABELS)
    },
    INS_USE3: {
      id: 'INS_USE3',
      label: 'Use IMU 3',
      description: 'Whether the third IMU is used by the EKF/AHRS.',
      category: 'sensors',
      minimum: 0,
      maximum: 1,
      rebootRequired: true,
      options: enumOptions(ARDUCOPTER_INS_USE_LABELS)
    },
    // GCS and EKF failsafe metadata. These entries are the basis for surfacing
    // GCS- and EKF-failsafe rows in the Failsafe view in a follow-up PR; the
    // current Failsafe view intentionally omits them until they land in the
    // catalog.
    FS_GCS_ENABLE: {
      id: 'FS_GCS_ENABLE',
      label: 'GCS Failsafe',
      description: 'What the copter does when the ground-station telemetry link drops out.',
      category: 'failsafe',
      minimum: 0,
      maximum: 7,
      notes: advancedFailsafeNotes,
      options: enumOptions(ARDUCOPTER_FS_GCS_LABELS)
    },
    FS_EKF_ACTION: {
      id: 'FS_EKF_ACTION',
      label: 'EKF Failsafe Action',
      description: 'Action taken when the EKF flags position or velocity variance over the threshold.',
      category: 'failsafe',
      minimum: 1,
      maximum: 3,
      notes: advancedFailsafeNotes,
      options: enumOptions(ARDUCOPTER_FS_EKF_ACTION_LABELS)
    },
    FS_EKF_THRESH: {
      id: 'FS_EKF_THRESH',
      label: 'EKF Failsafe Threshold',
      description: 'Compass and velocity-Z variance level that trips the EKF failsafe; lower values trigger sooner.',
      category: 'failsafe',
      minimum: 0,
      maximum: 1,
      step: 0.1,
      notes: advancedFailsafeNotes
    },
    RCMAP_ROLL: {
      id: 'RCMAP_ROLL',
      label: 'Roll Channel Map',
      description: 'Receiver channel mapped to roll input.',
      category: 'radio',
      minimum: 1,
      maximum: 16,
      step: 1,
      rebootRequired: true,
      notes: rcMapNotes
    },
    RCMAP_PITCH: {
      id: 'RCMAP_PITCH',
      label: 'Pitch Channel Map',
      description: 'Receiver channel mapped to pitch input.',
      category: 'radio',
      minimum: 1,
      maximum: 16,
      step: 1,
      rebootRequired: true,
      notes: rcMapNotes
    },
    RCMAP_THROTTLE: {
      id: 'RCMAP_THROTTLE',
      label: 'Throttle Channel Map',
      description: 'Receiver channel mapped to throttle input.',
      category: 'radio',
      minimum: 1,
      maximum: 16,
      step: 1,
      rebootRequired: true,
      notes: rcMapNotes
    },
    RCMAP_YAW: {
      id: 'RCMAP_YAW',
      label: 'Yaw Channel Map',
      description: 'Receiver channel mapped to yaw input.',
      category: 'radio',
      minimum: 1,
      maximum: 16,
      step: 1,
      rebootRequired: true,
      notes: rcMapNotes
    },
    RSSI_TYPE: {
      id: 'RSSI_TYPE',
      label: 'RSSI Source',
      description: 'Signal-strength source used for RSSI reporting.',
      category: 'radio',
      minimum: 0,
      maximum: 4,
      notes: rssiNotes,
      options: enumOptions(ARDUCOPTER_RSSI_TYPE_LABELS)
    },
    RSSI_CHANNEL: {
      id: 'RSSI_CHANNEL',
      label: 'RSSI Channel',
      description: 'Receiver channel used when RSSI is carried on a dedicated RC PWM channel.',
      category: 'radio',
      minimum: 0,
      maximum: 16,
      step: 1,
      notes: rssiChannelNotes
    },
    RSSI_CHAN_LOW: {
      id: 'RSSI_CHAN_LOW',
      label: 'RSSI Low PWM',
      description: 'PWM value treated as minimum RSSI when using a dedicated RSSI channel.',
      category: 'radio',
      unit: 'us',
      minimum: 800,
      maximum: 2200,
      step: 1,
      notes: rssiChannelNotes
    },
    RSSI_CHAN_HIGH: {
      id: 'RSSI_CHAN_HIGH',
      label: 'RSSI High PWM',
      description: 'PWM value treated as maximum RSSI when using a dedicated RSSI channel.',
      category: 'radio',
      unit: 'us',
      minimum: 800,
      maximum: 2200,
      step: 1,
      notes: rssiChannelNotes
    },
    RC_SPEED: {
      id: 'RC_SPEED',
      label: 'RC Input Rate',
      description: 'Maximum RC input update rate accepted from the receiver link.',
      category: 'radio',
      unit: 'Hz',
      minimum: 1,
      maximum: 500,
      step: 1,
      notes: advancedReceiverNotes
    },
    RC_OPTIONS: {
      id: 'RC_OPTIONS',
      label: 'Receiver Options',
      description: 'Advanced RC input and receiver-behavior bitmask.',
      category: 'radio',
      minimum: 0,
      maximum: 65535,
      step: 1,
      bitmask: true,
      options: enumOptions(ARDUCOPTER_RC_OPTIONS_BIT_LABELS),
      notes: advancedReceiverNotes
    },
    RC1_MIN: {
      id: 'RC1_MIN',
      label: 'RC1 Minimum',
      description: 'Minimum calibrated value for roll input.',
      category: 'radio',
      minimum: 800,
      maximum: 2200,
      step: 1,
      notes: rcEndpointNotes
    },
    RC1_MAX: {
      id: 'RC1_MAX',
      label: 'RC1 Maximum',
      description: 'Maximum calibrated value for roll input.',
      category: 'radio',
      minimum: 800,
      maximum: 2200,
      step: 1,
      notes: rcEndpointNotes
    },
    RC1_TRIM: {
      id: 'RC1_TRIM',
      label: 'RC1 Trim',
      description: 'Center trim value for roll input.',
      category: 'radio',
      minimum: 800,
      maximum: 2200,
      step: 1,
      notes: rcEndpointNotes
    },
    RC2_MIN: {
      id: 'RC2_MIN',
      label: 'RC2 Minimum',
      description: 'Minimum calibrated value for pitch input.',
      category: 'radio',
      minimum: 800,
      maximum: 2200,
      step: 1,
      notes: rcEndpointNotes
    },
    RC2_MAX: {
      id: 'RC2_MAX',
      label: 'RC2 Maximum',
      description: 'Maximum calibrated value for pitch input.',
      category: 'radio',
      minimum: 800,
      maximum: 2200,
      step: 1,
      notes: rcEndpointNotes
    },
    RC2_TRIM: {
      id: 'RC2_TRIM',
      label: 'RC2 Trim',
      description: 'Center trim value for pitch input.',
      category: 'radio',
      minimum: 800,
      maximum: 2200,
      step: 1,
      notes: rcEndpointNotes
    },
    RC3_MIN: {
      id: 'RC3_MIN',
      label: 'RC3 Minimum',
      description: 'Minimum calibrated value for throttle input.',
      category: 'radio',
      minimum: 800,
      maximum: 2200,
      step: 1,
      notes: rcEndpointNotes
    },
    RC3_MAX: {
      id: 'RC3_MAX',
      label: 'RC3 Maximum',
      description: 'Maximum calibrated value for throttle input.',
      category: 'radio',
      minimum: 800,
      maximum: 2200,
      step: 1,
      notes: rcEndpointNotes
    },
    RC3_TRIM: {
      id: 'RC3_TRIM',
      label: 'RC3 Trim',
      description: 'Center trim value for throttle input.',
      category: 'radio',
      minimum: 800,
      maximum: 2200,
      step: 1,
      notes: rcEndpointNotes
    },
    RC4_MIN: {
      id: 'RC4_MIN',
      label: 'RC4 Minimum',
      description: 'Minimum calibrated value for yaw input.',
      category: 'radio',
      minimum: 800,
      maximum: 2200,
      step: 1,
      notes: rcEndpointNotes
    },
    RC4_MAX: {
      id: 'RC4_MAX',
      label: 'RC4 Maximum',
      description: 'Maximum calibrated value for yaw input.',
      category: 'radio',
      minimum: 800,
      maximum: 2200,
      step: 1,
      notes: rcEndpointNotes
    },
    RC4_TRIM: {
      id: 'RC4_TRIM',
      label: 'RC4 Trim',
      description: 'Center trim value for yaw input.',
      category: 'radio',
      minimum: 800,
      maximum: 2200,
      step: 1,
      notes: rcEndpointNotes
    },
    ACRO_RP_RATE: {
      id: 'ACRO_RP_RATE',
      label: 'Acro Roll/Pitch Rate',
      description: 'Maximum roll and pitch rate used in Acro mode.',
      category: 'acro',
      unit: 'deg/s',
      minimum: 1,
      maximum: 1080,
      step: 1,
      notes: acroRateNotes
    },
    ACRO_Y_RATE: {
      id: 'ACRO_Y_RATE',
      label: 'Acro Yaw Rate',
      description: 'Maximum yaw rate used in Acro mode.',
      category: 'acro',
      unit: 'deg/s',
      minimum: 1,
      maximum: 1080,
      step: 1,
      notes: acroRateNotes
    },
    ACRO_RP_EXPO: {
      id: 'ACRO_RP_EXPO',
      label: 'Acro Roll/Pitch Expo',
      description: 'Softens roll and pitch response near center stick in Acro mode.',
      category: 'acro',
      minimum: 0,
      maximum: 1,
      step: 0.01,
      notes: acroRateNotes
    },
    ACRO_Y_EXPO: {
      id: 'ACRO_Y_EXPO',
      label: 'Acro Yaw Expo',
      description: 'Softens yaw response near center stick in Acro mode.',
      category: 'acro',
      minimum: 0,
      maximum: 1,
      step: 0.01,
      notes: acroRateNotes
    },
    // Angular acceleration limits. The ArduPilot master branch renamed
    // ATC_ACCEL_*_MAX -> ATC_ACC_*_MAX with the unit shifted cd/s² -> deg/s²
    // (factor 100), but the rename has NOT yet shipped in stable releases —
    // real ArduCopter 4.6 still streams ATC_ACCEL_R/P/Y_MAX in cd/s² on the
    // wire (verified on a real Radix 2 HD on 2026-05-27). The catalog
    // carries both forms so a future stable release that ships the rename
    // also resolves. Unit is cd/s² to match the cd/s² bounds.
    // Alias shim deliberately omitted — a raw value mirror would be 100x
    // off (e.g. 110000 cd/s² -> 1100 deg/s², well above the 1800 safe max).
    ATC_ACCEL_R_MAX: {
      id: 'ATC_ACCEL_R_MAX',
      label: 'Roll Accel Limit',
      description: 'Maximum roll angular acceleration target used by the controller response shaper (cd/s²). ArduPilot master renamed this to ATC_ACC_R_MAX in deg/s²; rename not yet in stable as of 4.6.',
      category: 'tuning',
      unit: 'cd/s²',
      minimum: 1000,
      maximum: 220000,
      step: 100,
      notes: acroRateNotes
    },
    ATC_ACC_R_MAX: {
      id: 'ATC_ACC_R_MAX',
      label: 'Roll Accel Limit (master)',
      description: 'ArduPilot master rename for ATC_ACCEL_R_MAX with the unit shifted cd/s² -> deg/s² (factor 100). Not yet in stable as of 4.6 — stable firmware streams ATC_ACCEL_R_MAX in cd/s².',
      category: 'tuning',
      unit: 'deg/s²',
      minimum: 0,
      maximum: 1800,
      step: 1,
      notes: acroRateNotes
    },
    ATC_ACCEL_P_MAX: {
      id: 'ATC_ACCEL_P_MAX',
      label: 'Pitch Accel Limit',
      description: 'Maximum pitch angular acceleration target used by the controller response shaper (cd/s²). ArduPilot master renamed this to ATC_ACC_P_MAX in deg/s²; rename not yet in stable as of 4.6.',
      category: 'tuning',
      unit: 'cd/s²',
      minimum: 1000,
      maximum: 220000,
      step: 100,
      notes: acroRateNotes
    },
    ATC_ACC_P_MAX: {
      id: 'ATC_ACC_P_MAX',
      label: 'Pitch Accel Limit (master)',
      description: 'ArduPilot master rename for ATC_ACCEL_P_MAX with the unit shifted cd/s² -> deg/s² (factor 100). Not yet in stable as of 4.6 — stable firmware streams ATC_ACCEL_P_MAX in cd/s².',
      category: 'tuning',
      unit: 'deg/s²',
      minimum: 0,
      maximum: 1800,
      step: 1,
      notes: acroRateNotes
    },
    ATC_ACCEL_Y_MAX: {
      id: 'ATC_ACCEL_Y_MAX',
      label: 'Yaw Accel Limit',
      description: 'Maximum yaw angular acceleration target used by the controller response shaper (cd/s²). ArduPilot master renamed this to ATC_ACC_Y_MAX in deg/s²; rename not yet in stable as of 4.6.',
      category: 'tuning',
      unit: 'cd/s²',
      minimum: 1000,
      maximum: 220000,
      step: 100,
      notes: acroRateNotes
    },
    ATC_ACC_Y_MAX: {
      id: 'ATC_ACC_Y_MAX',
      label: 'Yaw Accel Limit (master)',
      description: 'ArduPilot master rename for ATC_ACCEL_Y_MAX with the unit shifted cd/s² -> deg/s² (factor 100). Not yet in stable as of 4.6 — stable firmware streams ATC_ACCEL_Y_MAX in cd/s².',
      category: 'tuning',
      unit: 'deg/s²',
      minimum: 0,
      maximum: 720,
      step: 1,
      notes: acroRateNotes
    },
    ATC_RAT_RLL_P: {
      id: 'ATC_RAT_RLL_P',
      label: 'Roll P Gain',
      description: 'Roll-axis rate P gain.',
      category: 'pid',
      minimum: 0,
      maximum: 1.5,
      step: 0.001,
      notes: pidTuningNotes
    },
    ATC_RAT_RLL_I: {
      id: 'ATC_RAT_RLL_I',
      label: 'Roll I Gain',
      description: 'Roll-axis rate I gain.',
      category: 'pid',
      minimum: 0,
      maximum: 1.5,
      step: 0.001,
      notes: pidTuningNotes
    },
    ATC_RAT_RLL_D: {
      id: 'ATC_RAT_RLL_D',
      label: 'Roll D Gain',
      description: 'Roll-axis rate D gain.',
      category: 'pid',
      minimum: 0,
      maximum: 0.1,
      step: 0.0001,
      notes: pidTuningNotes
    },
    ATC_RAT_RLL_FF: {
      id: 'ATC_RAT_RLL_FF',
      label: 'Roll Feedforward',
      description: 'Roll-axis rate feedforward gain.',
      category: 'pid',
      minimum: 0,
      maximum: 1,
      step: 0.001,
      notes: pidTuningNotes
    },
    ATC_RAT_RLL_D_FF: {
      id: 'ATC_RAT_RLL_D_FF',
      label: 'Roll D Feedforward',
      description: 'Roll-axis derivative feedforward term.',
      category: 'pid',
      minimum: 0,
      maximum: 0.1,
      step: 0.0001,
      notes: pidTuningNotes
    },
    ATC_RAT_RLL_IMAX: {
      id: 'ATC_RAT_RLL_IMAX',
      label: 'Roll I Max',
      description: 'Roll-axis integrator clamp.',
      category: 'pid',
      minimum: 0,
      maximum: 1,
      step: 0.01,
      notes: pidTuningNotes
    },
    ATC_RAT_RLL_PDMX: {
      id: 'ATC_RAT_RLL_PDMX',
      label: 'Roll PD Max',
      description: 'Roll-axis combined P and D output ceiling.',
      category: 'pid',
      minimum: 0,
      maximum: 1,
      step: 0.01,
      notes: pidTuningNotes
    },
    ATC_RAT_RLL_SMAX: {
      id: 'ATC_RAT_RLL_SMAX',
      label: 'Roll Slew Limit',
      description: 'Roll-axis slew-rate limit for the rate controller.',
      category: 'pid',
      minimum: 0,
      maximum: 200,
      step: 1,
      notes: pidTuningNotes
    },
    ATC_RAT_PIT_P: {
      id: 'ATC_RAT_PIT_P',
      label: 'Pitch P Gain',
      description: 'Pitch-axis rate P gain.',
      category: 'pid',
      minimum: 0,
      maximum: 1.5,
      step: 0.001,
      notes: pidTuningNotes
    },
    ATC_RAT_PIT_I: {
      id: 'ATC_RAT_PIT_I',
      label: 'Pitch I Gain',
      description: 'Pitch-axis rate I gain.',
      category: 'pid',
      minimum: 0,
      maximum: 1.5,
      step: 0.001,
      notes: pidTuningNotes
    },
    ATC_RAT_PIT_D: {
      id: 'ATC_RAT_PIT_D',
      label: 'Pitch D Gain',
      description: 'Pitch-axis rate D gain.',
      category: 'pid',
      minimum: 0,
      maximum: 0.1,
      step: 0.0001,
      notes: pidTuningNotes
    },
    ATC_RAT_PIT_FF: {
      id: 'ATC_RAT_PIT_FF',
      label: 'Pitch Feedforward',
      description: 'Pitch-axis rate feedforward gain.',
      category: 'pid',
      minimum: 0,
      maximum: 1,
      step: 0.001,
      notes: pidTuningNotes
    },
    ATC_RAT_PIT_D_FF: {
      id: 'ATC_RAT_PIT_D_FF',
      label: 'Pitch D Feedforward',
      description: 'Pitch-axis derivative feedforward term.',
      category: 'pid',
      minimum: 0,
      maximum: 0.1,
      step: 0.0001,
      notes: pidTuningNotes
    },
    ATC_RAT_PIT_IMAX: {
      id: 'ATC_RAT_PIT_IMAX',
      label: 'Pitch I Max',
      description: 'Pitch-axis integrator clamp.',
      category: 'pid',
      minimum: 0,
      maximum: 1,
      step: 0.01,
      notes: pidTuningNotes
    },
    ATC_RAT_PIT_PDMX: {
      id: 'ATC_RAT_PIT_PDMX',
      label: 'Pitch PD Max',
      description: 'Pitch-axis combined P and D output ceiling.',
      category: 'pid',
      minimum: 0,
      maximum: 1,
      step: 0.01,
      notes: pidTuningNotes
    },
    ATC_RAT_PIT_SMAX: {
      id: 'ATC_RAT_PIT_SMAX',
      label: 'Pitch Slew Limit',
      description: 'Pitch-axis slew-rate limit for the rate controller.',
      category: 'pid',
      minimum: 0,
      maximum: 200,
      step: 1,
      notes: pidTuningNotes
    },
    ATC_RAT_YAW_P: {
      id: 'ATC_RAT_YAW_P',
      label: 'Yaw P Gain',
      description: 'Yaw-axis rate P gain.',
      category: 'pid',
      minimum: 0,
      maximum: 1.5,
      step: 0.001,
      notes: pidTuningNotes
    },
    ATC_RAT_YAW_I: {
      id: 'ATC_RAT_YAW_I',
      label: 'Yaw I Gain',
      description: 'Yaw-axis rate I gain.',
      category: 'pid',
      minimum: 0,
      maximum: 1.5,
      step: 0.001,
      notes: pidTuningNotes
    },
    ATC_RAT_YAW_D: {
      id: 'ATC_RAT_YAW_D',
      label: 'Yaw D Gain',
      description: 'Yaw-axis rate D gain.',
      category: 'pid',
      minimum: 0,
      maximum: 0.1,
      step: 0.0001,
      notes: pidTuningNotes
    },
    ATC_RAT_YAW_FF: {
      id: 'ATC_RAT_YAW_FF',
      label: 'Yaw Feedforward',
      description: 'Yaw-axis rate feedforward gain.',
      category: 'pid',
      minimum: 0,
      maximum: 1,
      step: 0.001,
      notes: pidTuningNotes
    },
    ATC_RAT_YAW_D_FF: {
      id: 'ATC_RAT_YAW_D_FF',
      label: 'Yaw D Feedforward',
      description: 'Yaw-axis derivative feedforward term.',
      category: 'pid',
      minimum: 0,
      maximum: 0.1,
      step: 0.0001,
      notes: pidTuningNotes
    },
    ATC_RAT_YAW_IMAX: {
      id: 'ATC_RAT_YAW_IMAX',
      label: 'Yaw I Max',
      description: 'Yaw-axis integrator clamp.',
      category: 'pid',
      minimum: 0,
      maximum: 1,
      step: 0.01,
      notes: pidTuningNotes
    },
    ATC_RAT_YAW_PDMX: {
      id: 'ATC_RAT_YAW_PDMX',
      label: 'Yaw PD Max',
      description: 'Yaw-axis combined P and D output ceiling.',
      category: 'pid',
      minimum: 0,
      maximum: 1,
      step: 0.01,
      notes: pidTuningNotes
    },
    ATC_RAT_YAW_SMAX: {
      id: 'ATC_RAT_YAW_SMAX',
      label: 'Yaw Slew Limit',
      description: 'Yaw-axis slew-rate limit for the rate controller.',
      category: 'pid',
      minimum: 0,
      maximum: 200,
      step: 1,
      notes: pidTuningNotes
    },
    ATC_RAT_RLL_FLTT: {
      id: 'ATC_RAT_RLL_FLTT',
      label: 'Roll Target Filter',
      description: 'Roll-axis target filter frequency.',
      category: 'filters',
      unit: 'Hz',
      minimum: 0,
      maximum: 200,
      step: 1,
      notes: filterTuningNotes
    },
    ATC_RAT_RLL_FLTE: {
      id: 'ATC_RAT_RLL_FLTE',
      label: 'Roll Error Filter',
      description: 'Roll-axis error filter frequency.',
      category: 'filters',
      unit: 'Hz',
      minimum: 0,
      maximum: 200,
      step: 1,
      notes: filterTuningNotes
    },
    ATC_RAT_RLL_FLTD: {
      id: 'ATC_RAT_RLL_FLTD',
      label: 'Roll D Filter',
      description: 'Roll-axis D-term filter frequency.',
      category: 'filters',
      unit: 'Hz',
      minimum: 0,
      maximum: 200,
      step: 1,
      notes: filterTuningNotes
    },
    ATC_RAT_PIT_FLTT: {
      id: 'ATC_RAT_PIT_FLTT',
      label: 'Pitch Target Filter',
      description: 'Pitch-axis target filter frequency.',
      category: 'filters',
      unit: 'Hz',
      minimum: 0,
      maximum: 200,
      step: 1,
      notes: filterTuningNotes
    },
    ATC_RAT_PIT_FLTE: {
      id: 'ATC_RAT_PIT_FLTE',
      label: 'Pitch Error Filter',
      description: 'Pitch-axis error filter frequency.',
      category: 'filters',
      unit: 'Hz',
      minimum: 0,
      maximum: 200,
      step: 1,
      notes: filterTuningNotes
    },
    ATC_RAT_PIT_FLTD: {
      id: 'ATC_RAT_PIT_FLTD',
      label: 'Pitch D Filter',
      description: 'Pitch-axis D-term filter frequency.',
      category: 'filters',
      unit: 'Hz',
      minimum: 0,
      maximum: 200,
      step: 1,
      notes: filterTuningNotes
    },
    ATC_RAT_YAW_FLTT: {
      id: 'ATC_RAT_YAW_FLTT',
      label: 'Yaw Target Filter',
      description: 'Yaw-axis target filter frequency.',
      category: 'filters',
      unit: 'Hz',
      minimum: 0,
      maximum: 200,
      step: 1,
      notes: filterTuningNotes
    },
    ATC_RAT_YAW_FLTE: {
      id: 'ATC_RAT_YAW_FLTE',
      label: 'Yaw Error Filter',
      description: 'Yaw-axis error filter frequency.',
      category: 'filters',
      unit: 'Hz',
      minimum: 0,
      maximum: 200,
      step: 1,
      notes: filterTuningNotes
    },
    ATC_RAT_YAW_FLTD: {
      id: 'ATC_RAT_YAW_FLTD',
      label: 'Yaw D Filter',
      description: 'Yaw-axis D-term filter frequency.',
      category: 'filters',
      unit: 'Hz',
      minimum: 0,
      maximum: 200,
      step: 1,
      notes: filterTuningNotes
    },
    MOT_PWM_TYPE: {
      id: 'MOT_PWM_TYPE',
      label: 'Motor PWM Type',
      description: 'Motor output protocol for ESC communication.',
      category: 'outputs',
      minimum: 0,
      maximum: 8,
      rebootRequired: true,
      notes: [
        'DShot-based protocols do not use the normal all-at-once PWM ESC calibration flow.',
        'After changing the motor output protocol, reboot and repeat output verification before flight.'
      ],
      options: enumOptions(ARDUCOPTER_MOT_PWM_TYPE_LABELS)
    },
    SERVO_DSHOT_RATE: {
      id: 'SERVO_DSHOT_RATE',
      label: 'DShot Rate',
      description: 'How often DShot ESC frames are sent, as a multiple of the main loop rate. Higher rates need a capable FC + ESC.',
      category: 'outputs',
      minimum: 0,
      maximum: 7,
      rebootRequired: true,
      options: enumOptions(ARDUCOPTER_DSHOT_RATE_LABELS)
    },
    SERVO_BLH_AUTO: {
      id: 'SERVO_BLH_AUTO',
      label: 'BLHeli auto-enable',
      description: 'Auto-enable BLHeli/DShot passthrough + telemetry on all DShot outputs. Required for bidirectional DShot (bdshot) and is set automatically when you enable bdshot.',
      category: 'outputs',
      minimum: 0,
      maximum: 1,
      rebootRequired: true,
      options: enumOptions(ARDUCOPTER_BLH_AUTO_LABELS)
    },
    SERVO_BLH_MASK: {
      id: 'SERVO_BLH_MASK',
      label: 'BLHeli pass-thru outputs',
      description: 'Per-output bitmask of channels with BLHeli pass-thru (ESC configuration) enabled. This is in addition to any outputs auto-enabled by BLHeli auto-enable.',
      category: 'outputs',
      minimum: 0,
      maximum: 255,
      rebootRequired: true,
      bitmask: true,
      options: enumOptions(ARDUCOPTER_OUTPUT_CHANNEL_BIT_LABELS)
    },
    SERVO_BLH_BDMASK: {
      id: 'SERVO_BLH_BDMASK',
      label: 'Bidirectional DShot (bdshot) outputs',
      description: 'Per-output bitmask of channels running bidirectional DShot (RPM telemetry). Most boards support bdshot on the first 4 outputs only; some support 8. Requires a DShot protocol + BLHeli auto-enable.',
      category: 'outputs',
      minimum: 0,
      maximum: 255,
      rebootRequired: true,
      bitmask: true,
      options: enumOptions(ARDUCOPTER_OUTPUT_CHANNEL_BIT_LABELS)
    },
    SERVO_BLH_RVMASK: {
      id: 'SERVO_BLH_RVMASK',
      label: 'Reverse motor direction (per output)',
      description: 'Per-output bitmask: check an output to reverse that motor’s spin direction via DShot (BLHeli/AM32) without swapping wires. Takes effect immediately on DShot ESCs.',
      category: 'outputs',
      minimum: 0,
      maximum: 255,
      bitmask: true,
      options: enumOptions(ARDUCOPTER_OUTPUT_CHANNEL_BIT_LABELS)
    },
    SERVO_BLH_POLES: {
      id: 'SERVO_BLH_POLES',
      label: 'Motor magnet poles',
      description: 'Number of motor magnet poles, used to convert ESC eRPM telemetry to real RPM. Most 5”-class motors have 14 poles.',
      category: 'outputs',
      minimum: 2,
      maximum: 64,
      step: 1
    },
    MOT_PWM_MIN: {
      id: 'MOT_PWM_MIN',
      label: 'Motor PWM Minimum',
      description: 'Minimum PWM value sent to the ESCs when using PWM-based protocols.',
      category: 'outputs',
      minimum: 0,
      maximum: 2200,
      step: 1,
      notes: ['Review with the ESC calibration workflow whenever analog PWM endpoints change.']
    },
    MOT_PWM_MAX: {
      id: 'MOT_PWM_MAX',
      label: 'Motor PWM Maximum',
      description: 'Maximum PWM value sent to the ESCs when using PWM-based protocols.',
      category: 'outputs',
      minimum: 0,
      maximum: 2200,
      step: 1,
      notes: ['Review with the ESC calibration workflow whenever analog PWM endpoints change.']
    },
    MOT_SPIN_ARM: {
      id: 'MOT_SPIN_ARM',
      label: 'Motor Spin Armed',
      description: 'Motor output fraction used immediately after arming.',
      category: 'outputs',
      minimum: 0,
      maximum: 1,
      step: 0.01,
      notes: ['Review spin thresholds after ESC calibration or protocol changes.']
    },
    MOT_SPIN_MIN: {
      id: 'MOT_SPIN_MIN',
      label: 'Motor Spin Minimum',
      description: 'Lowest stabilized motor output fraction during flight.',
      category: 'outputs',
      minimum: 0,
      maximum: 1,
      step: 0.01,
      notes: ['This should stay above MOT_SPIN_ARM for a clean idle-to-flight transition.']
    },
    MOT_SPIN_MAX: {
      id: 'MOT_SPIN_MAX',
      label: 'Motor Spin Maximum',
      description: 'Highest allowed motor output fraction.',
      category: 'outputs',
      minimum: 0,
      maximum: 1,
      step: 0.01,
      notes: ['Leave headroom below 1.0 if the propulsion setup saturates early.']
    },
    NTF_LED_TYPES: {
      id: 'NTF_LED_TYPES',
      label: 'Notification LED Drivers',
      description: 'Enabled notification LED driver bitmask.',
      category: 'outputs',
      minimum: 0,
      maximum: 8191,
      notes: notificationLedNotes
    },
    NTF_LED_LEN: {
      id: 'NTF_LED_LEN',
      label: 'Notification LED Length',
      description: 'Configured pixel count for addressable notification LEDs.',
      category: 'outputs',
      minimum: 1,
      maximum: 256,
      step: 1,
      rebootRequired: true,
      notes: notificationLedNotes
    },
    NTF_LED_BRIGHT: {
      id: 'NTF_LED_BRIGHT',
      label: 'Notification LED Brightness',
      description: 'Global brightness level for supported notification LEDs.',
      category: 'outputs',
      minimum: 0,
      maximum: 3,
      notes: notificationLedNotes,
      options: enumOptions(ARDUCOPTER_NOTIFICATION_LED_BRIGHTNESS_LABELS)
    },
    NTF_LED_OVERRIDE: {
      id: 'NTF_LED_OVERRIDE',
      label: 'Notification LED Source',
      description: 'Alternate source for notification LED state and color control.',
      category: 'outputs',
      minimum: 0,
      maximum: 3,
      notes: notificationLedNotes,
      options: enumOptions(ARDUCOPTER_NOTIFICATION_LED_OVERRIDE_LABELS)
    },
    NTF_BUZZ_TYPES: {
      id: 'NTF_BUZZ_TYPES',
      label: 'Notification Buzzer Drivers',
      description: 'Enabled buzzer driver bitmask.',
      category: 'outputs',
      minimum: 0,
      maximum: 7,
      notes: notificationBuzzNotes
    },
    NTF_BUZZ_VOLUME: {
      id: 'NTF_BUZZ_VOLUME',
      label: 'Notification Buzzer Volume',
      description: 'Volume percentage used by supported buzzer drivers.',
      category: 'outputs',
      unit: '%',
      minimum: 0,
      maximum: 100,
      step: 1,
      notes: notificationBuzzNotes
    },
    ...buildServoChannelParameterDefinitions(32),
    LOG_BACKEND_TYPE: {
      id: 'LOG_BACKEND_TYPE',
      label: 'Log Backend',
      description: 'Where the autopilot writes the onboard flight log.',
      category: 'logging',
      minimum: 0,
      maximum: 4,
      rebootRequired: true,
      notes: loggingBackendNotes,
      options: enumOptions(ARDUCOPTER_LOG_BACKEND_LABELS)
    },
    LOG_BITMASK: {
      id: 'LOG_BITMASK',
      label: 'Log Bitmask',
      description: 'Advanced bitmask selecting which message families are written to the log.',
      category: 'logging',
      minimum: 0,
      maximum: 0xFFFFFFFF,
      notes: loggingBitmaskNotes
    },
    LOG_FILE_DSRMROT: {
      id: 'LOG_FILE_DSRMROT',
      label: 'Rotate Log on Disarm',
      description: 'Start a fresh log file each time the vehicle disarms.',
      category: 'logging',
      minimum: 0,
      maximum: 1,
      notes: loggingBehaviorNotes,
      options: enabledDisabledOptions
    },
    LOG_FILE_MB_FREE: {
      id: 'LOG_FILE_MB_FREE',
      label: 'Minimum Free Space',
      description: 'Reserve a minimum amount of free space on the SD card by deleting the oldest logs.',
      category: 'logging',
      unit: 'MB',
      minimum: 0,
      maximum: 8192,
      step: 1,
      notes: loggingBehaviorNotes
    },
    LOG_REPLAY: {
      id: 'LOG_REPLAY',
      label: 'Replay Logging',
      description: 'Enable replay-quality logging for offline EKF and controller replay.',
      category: 'logging',
      minimum: 0,
      maximum: 1,
      notes: loggingBehaviorNotes,
      options: enabledDisabledOptions
    },
    LOG_DISARMED: {
      id: 'LOG_DISARMED',
      label: 'Log While Disarmed',
      description: 'Continue writing log data while the vehicle is disarmed.',
      category: 'logging',
      minimum: 0,
      maximum: 1,
      notes: loggingBehaviorNotes,
      options: enabledDisabledOptions
    }
  },
  setupSections: [
    {
      id: 'link',
      title: 'Vehicle Link',
      description: 'Bring the vehicle online and pull the first parameter snapshot.',
      requiredParameters: [],
      actions: ['request-parameters']
    },
    {
      id: 'airframe',
      title: 'Airframe',
      description: 'Verify the frame class and geometry before motor output setup.',
      requiredParameters: ['FRAME_CLASS', 'FRAME_TYPE'],
      // FRAME_CLASS=0 means "no frame picked" — ArduPilot logs "Frame:
      // UNSUPPORTED", refuses every calibration COMMAND, and won't arm. Require
      // it non-zero so a present-but-zero param doesn't read as complete.
      requiredNonZeroParameters: ['FRAME_CLASS']
    },
    {
      id: 'outputs',
      title: 'Outputs',
      description: 'Review the primary motor and peripheral output assignments before any props-on testing.',
      requiredParameters: ['SERVO1_FUNCTION', 'SERVO2_FUNCTION', 'SERVO3_FUNCTION', 'SERVO4_FUNCTION'],
      // At least one SERVOn_FUNCTION must be assigned (non-zero), else
      // nothing is wired to motors. Covers the first 8 channels (the slots
      // ArduPilot auto-populates from FRAME_CLASS); higher channels are
      // aux/peripherals.
      requiredAnyNonZeroParameters: [
        'SERVO1_FUNCTION',
        'SERVO2_FUNCTION',
        'SERVO3_FUNCTION',
        'SERVO4_FUNCTION',
        'SERVO5_FUNCTION',
        'SERVO6_FUNCTION',
        'SERVO7_FUNCTION',
        'SERVO8_FUNCTION'
      ]
    },
    {
      id: 'accelerometer',
      title: 'Accelerometer Calibration',
      description: 'Complete 6-pose IMU calibration before tuning or arming.',
      requiredParameters: ['AHRS_ORIENTATION'],
      completionStatusTexts: ['Accelerometer calibration complete.'],
      // INS_ACCOFFS_X/Y/Z are written by the 6-pose accel cal; a non-zero
      // value on any axis is evidence the cal has run on this FC, so the
      // section reads complete across reconnects.
      completionEvidenceNonZeroParameters: ['INS_ACCOFFS_X', 'INS_ACCOFFS_Y', 'INS_ACCOFFS_Z'],
      actions: ['calibrate-accelerometer']
    },
    {
      id: 'level',
      title: 'Level Calibration',
      description: 'Trim the flight controller against a known-level surface. Run this whenever the FC is repositioned on the frame.',
      requiredParameters: ['AHRS_TRIM_X', 'AHRS_TRIM_Y'],
      completionStatusTexts: ['Board level calibration complete.'],
      // Level cal writes AHRS_TRIM_X / AHRS_TRIM_Y; either being non-zero is
      // evidence the cal ran, so the section reads complete across reconnects.
      completionEvidenceNonZeroParameters: ['AHRS_TRIM_X', 'AHRS_TRIM_Y'],
      actions: ['calibrate-level']
    },
    {
      id: 'compass',
      title: 'Compass Calibration',
      description: 'Confirm the compass is enabled and calibrated.',
      requiredParameters: ['COMPASS_USE'],
      completionStatusTexts: ['Compass calibration complete.'],
      // Compass cal writes COMPASS_OFS_X/Y/Z; any non-zero offset is evidence
      // the cal ran, so the section reads complete across reconnects.
      completionEvidenceNonZeroParameters: ['COMPASS_OFS_X', 'COMPASS_OFS_Y', 'COMPASS_OFS_Z'],
      actions: ['calibrate-compass']
    },
    {
      id: 'radio',
      title: 'Radio',
      description: 'Inspect primary RC channel calibration.',
      requiredParameters: [
        'RCMAP_ROLL',
        'RCMAP_PITCH',
        'RCMAP_THROTTLE',
        'RCMAP_YAW',
        'RC1_MIN',
        'RC1_MAX',
        'RC1_TRIM',
        'RC2_MIN',
        'RC2_MAX',
        'RC2_TRIM',
        'RC3_MIN',
        'RC3_MAX',
        'RC3_TRIM',
        'RC4_MIN',
        'RC4_MAX',
        'RC4_TRIM'
      ],
      requiredLiveSignals: ['rc-input'],
    },
    {
      id: 'failsafe',
      title: 'Failsafe',
      description: 'Review throttle and battery failsafe behavior.',
      requiredParameters: [
        'FS_THR_ENABLE',
        'FS_THR_VALUE',
        'BATT_FS_VOLTSRC',
        'BATT_LOW_VOLT',
        'BATT_LOW_MAH',
        'BATT_FS_LOW_ACT',
        'BATT_CRT_VOLT',
        'BATT_CRT_MAH',
        'BATT_FS_CRT_ACT'
      ],
      requiredLiveSignals: ['rc-input', 'battery-telemetry'],
    },
    {
      id: 'modes',
      title: 'Flight Modes',
      description: 'Check the first three mapped flight modes.',
      requiredParameters: ['FLTMODE1', 'FLTMODE2', 'FLTMODE3'],
      requiredLiveSignals: ['rc-input'],
    },
    {
      id: 'power',
      title: 'Battery',
      description: 'Validate battery monitoring before flight.',
      requiredParameters: ['BATT_MONITOR', 'BATT_CAPACITY', 'BATT_ARM_VOLT', 'BATT_ARM_MAH'],
      // BATT_MONITOR=0 disables battery monitoring entirely — no voltage,
      // no current, no battery failsafe. The autopilot still reports the
      // param (so the bare presence check passes), but the section is the
      // opposite of complete in that state.
      requiredNonZeroParameters: ['BATT_MONITOR'],
      requiredLiveSignals: ['battery-telemetry'],
      actions: ['reboot-autopilot']
    }
  ]
}
