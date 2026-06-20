import type { FirmwareMetadataBundle, ParameterValueOption } from './types.js'
import { AHRS_ORIENTATION_OPTIONS } from './shared-enums.js'
import {
  ARDUCOPTER_BATTERY_MONITOR_LABELS,
  ARDUCOPTER_BATTERY_VOLTAGE_SOURCE_LABELS,
  ARDUCOPTER_FLTMODE_CHANNEL_LABELS,
  // GPS enums are vehicle-agnostic — the DroneCAN GPS driver value is 9
  // on every ArduPilot variant — so the same label tables drive the
  // ArduPlane GPS parameter dropdowns. Without these the GPS behavior
  // section in the Ports view rendered empty dropdowns when connected
  // to ArduPlane (caught live on a CubeRed + Here3 bench), even though
  // ArduCopter's catalog had the same parameters fully described.
  ARDUCOPTER_GPS_AUTO_CONFIG_LABELS,
  ARDUCOPTER_GPS_AUTO_SWITCH_LABELS,
  ARDUCOPTER_GPS_PRIMARY_LABELS,
  ARDUCOPTER_GPS_RATE_MS_LABELS,
  ARDUCOPTER_GPS_TYPE_LABELS,
  ARDUCOPTER_LOG_BACKEND_LABELS,
  ARDUCOPTER_MSP_OSD_CELL_COUNT_LABELS,
  ARDUCOPTER_OSD_CHANNEL_LABELS,
  ARDUCOPTER_OSD_SWITCH_METHOD_LABELS,
  ARDUCOPTER_OSD_TYPE_LABELS,
  ARDUCOPTER_RC_OPTIONS_BIT_LABELS,
  ARDUCOPTER_RSSI_TYPE_LABELS,
  ARDUCOPTER_SERIAL_BAUD_LABELS,
  ARDUCOPTER_SERIAL_OPTION_BIT_LABELS,
  ARDUCOPTER_SERIAL_PROTOCOL_LABELS,
  ARDUCOPTER_SERIAL_RTSCTS_LABELS,
  ARDUCOPTER_VTX_ENABLE_LABELS
} from './arducopter-enums.js'
import {
  ARDUPLANE_ADSB_EMIT_TYPE_LABELS,
  ARDUPLANE_ADSB_LEN_WIDTH_LABELS,
  ARDUPLANE_ADSB_LOG_LABELS,
  ARDUPLANE_ADSB_OFFSET_LAT_LABELS,
  ARDUPLANE_ADSB_OFFSET_LON_LABELS,
  ARDUPLANE_ADSB_OPTIONS_BIT_LABELS,
  ARDUPLANE_ADSB_RF_CAPABLE_BIT_LABELS,
  ARDUPLANE_ADSB_RF_SELECT_BIT_LABELS,
  ARDUPLANE_ADSB_TYPE_LABELS,
  ARDUPLANE_AUTOTUNE_AXES_BIT_LABELS,
  ARDUPLANE_AUTOTUNE_OPTIONS_BIT_LABELS,
  ARDUPLANE_Q_AUTOTUNE_AXES_BIT_LABELS,
  ARDUPLANE_ARSPD_SKIP_CAL_LABELS,
  ARDUPLANE_ARSPD_TYPE_LABELS,
  ARDUPLANE_ARSPD_USE_LABELS,
  ARDUPLANE_AVD_F_ACTION_LABELS,
  ARDUPLANE_AVD_F_RCVRY_LABELS,
  ARDUPLANE_AVD_W_ACTION_LABELS,
  ARDUPLANE_SOAR_ENABLE_LABELS,
  ARDUPLANE_BATTERY_FAILSAFE_CRT_ACTION_LABELS,
  ARDUPLANE_BATTERY_FAILSAFE_LOW_ACTION_LABELS,
  ARDUPLANE_FLIGHT_MODE_LABELS,
  ARDUPLANE_FS_LONG_ACTN_LABELS,
  ARDUPLANE_FS_SHORT_ACTN_LABELS,
  ARDUPLANE_Q_FRAME_CLASS_LABELS,
  ARDUPLANE_Q_FRAME_TYPE_LABELS,
  ARDUPLANE_LAND_THEN_NEUTRL_LABELS,
  ARDUPLANE_LAND_TYPE_LABELS,
  ARDUPLANE_Q_M_PWM_TYPE_LABELS,
  ARDUPLANE_RTL_AUTOLAND_LABELS
} from './arduplane-enums.js'

const enabledDisabledOptions: ParameterValueOption[] = [
  { value: 0, label: 'Disabled' },
  { value: 1, label: 'Enabled' }
]

// GPS behavior notes — intentionally duplicated from the ArduCopter catalog
// rather than moved to a shared module: the strings are short, vehicle-
// agnostic, and a shared-notes module would only become worthwhile once
// ArduRover / ArduSub also need the same metadata. Keep this comment if
// that consolidation ever happens so future contributors know where to
// look.
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

const quadplaneEnableNotes = [
  'Set Q_ENABLE to 1 only on QuadPlane airframes (VTOL hybrids with lift motors).',
  'After enabling QuadPlane, reboot the autopilot and re-review the Q_FRAME_CLASS and Q_FRAME_TYPE selections before flight.'
]

const quadplaneGeometryNotes = [
  'These Q_FRAME_* values only apply when Q_ENABLE is set; pure fixed-wing builds can leave them at their defaults.',
  'After changing QuadPlane geometry, reboot and re-verify the lift-motor mapping with props removed.'
]

const quadplaneRatePidNotes = [
  'These are the QuadPlane VTOL rate-controller gains and only apply while the lift motors are active (hover, VTOL transitions, and assist). They are independent of the fixed-wing surface gains.',
  'Change Q_A_RAT_* gains in small steps with a fresh snapshot saved first, and keep roll and pitch close unless the airframe has a deliberate asymmetry.'
]

const fixedWingRatePidNotes = [
  'These are the fixed-wing surface rate-controller gains (RLL_RATE_*, PTCH_RATE_*, YAW_RATE_*). They shape how the ailerons, elevator, and rudder track demanded body rates during forward flight — independent of the QuadPlane Q_A_RAT_* hover gains.',
  'Tune in small steps with a fresh snapshot saved first; the autotune flight modes can set these for you. Defaults fly most airframes safely.'
]

const fixedWingAttitudeNotes = [
  'RLL2SRV_*/PTCH2SRV_* set the fixed-wing attitude time constants and maximum demanded rates, and LIM_* clamp the bank/pitch the autopilot will command. They bound how aggressively the aircraft manoeuvres in the stabilised and auto modes.',
  'Lower the time constant for crisper response, raise it for a softer feel. Keep LIM_ROLL_CD / LIM_PITCH_* within the airframe’s safe envelope.'
]

const airspeedNotes = [
  'These configure the airspeed sensor and the airspeed envelope the automatic throttle / TECS modes fly to. ARSPD_USE must be on (and the sensor calibrated) before AIRSPEED_MIN/MAX/CRUISE have any effect.',
  'AIRSPEED_MIN/MAX/CRUISE are the modern ArduPlane names; older firmware reports the same values as ARSPD_FBW_MIN/ARSPD_FBW_MAX/TRIM_ARSPD_CM (TRIM_ARSPD_CM is in cm/s). Whichever your firmware uses is what is shown.'
]

const cruiseNotes = [
  'Cruise throttle and the throttle limits/slew bound forward-flight power; PTCH_TRIM_DEG (older firmware: TRIM_PITCH_CD, in centidegrees) sets the level-flight pitch offset so the aircraft holds altitude at cruise without constant elevator.',
  'Set TRIM_THROTTLE to the throttle that holds level flight at the cruise airspeed; trim pitch on a calm day in level flight.'
]

const tecsNotes = [
  'TECS is the total-energy speed/height controller used in the automatic throttle modes (AUTO, RTL, FBWB, LOITER, …). It coordinates throttle and pitch to hold the demanded airspeed and altitude; these gains shape its aggressiveness and damping.',
  'Tune TECS only after the fixed-wing rate loop, airspeed calibration, and cruise throttle/pitch trim are sound. The defaults fly most airframes; change one term at a time with a fresh snapshot saved.'
]

const tecsLandingNotes = [
  'TECS_LAND_* tune TECS only during the auto-landing state machine — the cruise tuning above is not touched. Sentinels differ per param: TECS_LAND_THR -1 inherits TRIM_THROTTLE; TECS_LAND_TDAMP / IGAIN / PDAMP inherit their cruise gain at 0 (NOT -1 — a negative there is a real negative gain); a negative TECS_LAND_ARSPD targets the midpoint of AIRSPEED_MIN..AIRSPEED_CRUISE.',
  'Tune at altitude first: set a non-zero HOME_ALT or sufficient field elevation and dry-run a LAND approach so a misadjusted FLARE/PMAX/TCONST surfaces well above the ground. Touch one term per flight.'
]

const tecsTakeoffNotes = [
  'TECS_TKOFF_IGAIN is the TECS integrator gain used only during auto-takeoff. Decoupled from the cruise integrator so the initial climb can be tuned without affecting steady cruise integrator wind-up.',
  'Default 0 inherits TECS_INTEG_GAIN. Raise if the aircraft consistently undershoots the takeoff climb target.'
]

const navNotes = [
  'NAVL1_* tune the L1 navigation controller that tracks waypoint and loiter paths in AUTO/RTL/LOITER. NAVL1_PERIOD is the primary turn-aggressiveness knob (lower = tighter, more aggressive tracking).',
  'Raise NAVL1_PERIOD if the aircraft weaves or overshoots tracks; increase NAVL1_DAMPING in 0.05 steps for path-tracking overshoot.'
]

const missionNotes = [
  'These set the geometry of automatic missions and RTL: how close the aircraft must get to a waypoint before advancing, the default loiter circle radius, and what RTL does when it gets home.',
  'WP_LOITER_RAD / RTL_RADIUS sign sets the loiter direction (negative = counter-clockwise). WP_MAX_RADIUS of 0 lets the aircraft pass a waypoint at any distance once it flies past the perpendicular.'
]

const landingNotes = [
  'These shape the automatic glide-slope landing: the flare (when the aircraft pitches up and cuts throttle to touch down), the optional pre-flare slow-down, throttle slew, and post-touchdown behaviour.',
  'Set LAND_FLARE_ALT/SEC for the airframe’s glide; LAND_PITCH_DEG is the touchdown attitude. Test landings at altitude (raise HOME) before trusting them near the ground.'
]

const mixingNotes = [
  'Control-mixing gains couple one axis into another: rudder mixed with aileron for coordinated turns, throttle into pitch, and the elevon/v-tail output mixing gain. FLAP_* set the auto-deploy flap schedule by airspeed.',
  'Most airframes fly well on defaults. KFF_RDDRMIX is the common one to raise for cleaner coordinated turns; set FLAP_n_SPEED below which FLAP_n_PERCNT of flap deploys.'
]

const soaringNotes = [
  'SOAR_ parameters control ArduPilot Plane autonomous soaring — when SOAR_ENABLE is set the aircraft estimates thermals with an EKF and switches between THERMAL (loiter to climb) and cruise. Soaring works in FBWB, CRUISE, AUTO, and LOITER.',
  'SOAR_VSPEED is the climb-rate trigger; SOAR_Q1/SOAR_Q2/SOAR_R tune the thermal estimator; SOAR_POLAR_* describe the glide polar (set them to your airframe). Set the SOAR_ALT_MIN/MAX/CUTOFF band conservatively before the first autonomous soar.'
]

const adsbNotes = [
  'ADSB_ parameters configure the ADS-B transponder/receiver hardware: ADSB_TYPE selects the device (0 disables ADS-B entirely), the identity/dimension fields are broadcast in ADS-B-out, and the list filters bound how much nearby traffic is tracked.',
  'ICAO id, callsign/squawk, emitter type and dimensions must match the aircraft registration when transmitting. Many fields are only used by ADS-B-out capable hardware.'
]

const avoidanceNotes = [
  'AVD_ parameters are the ADS-B traffic-avoidance layer that acts on detected nearby aircraft. AVD_ENABLE turns it on; the warn (W_) thresholds raise an alert and the fail (F_) thresholds trigger the avoidance action.',
  'AVD_F_ACTION sets what the aircraft does on an imminent collision and AVD_F_RCVRY what it does afterwards. The distance/time horizons are platform-dependent at default; tune them for your airspace and verify behaviour before relying on it.'
]

const quadplaneAnglePidNotes = [
  'Q_A_ANG_* are the VTOL angle-loop P gains that feed the rate controller. Raise them only after the Q_A_RAT_* rate loop is stable in a hover.',
  'These angle gains have no effect on fixed-wing flight; they only shape QuadPlane attitude hold during hover and transition.'
]

const quadplaneFilterNotes = [
  'These VTOL rate-controller filters trade smoothing for response. Lower values add latency but reject more motor and frame noise.',
  'Treat zero carefully: some ArduPilot filter parameters use zero to disable that specific filter path.'
]

const quadplaneMotorNotes = [
  'Q_M_* control the QuadPlane lift-motor outputs and mirror the multirotor motors library. Verify them with props removed before any hover test.',
  'After changing the lift-motor protocol or spin thresholds, reboot and repeat the props-off output check before flight.'
]

const quadplaneMotorPwmTypeNotes = [
  'DShot-based lift-motor protocols do not use the analog all-at-once PWM ESC calibration flow.',
  'After changing the lift-motor output protocol, reboot and repeat output verification with props removed before flight.'
]

const quadplanePositionNotes = [
  'Q_P_* and Q_WP_* shape QuadPlane position-hold and VTOL waypoint behavior (QLOITER, QRTL, and auto VTOL legs). Tighten them gradually after the attitude loops are trustworthy.',
  'Aggressive position gains or speed limits can cause toilet-bowling or overshoot on a hovering QuadPlane; adjust a little at a time with a short controlled test.'
]

const quadplaneAssistNotes = [
  'VTOL assist props a fixed-wing QuadPlane up with the lift motors when the airspeed, attitude, or altitude margin runs out. It is a safety net, not a tuning knob to disable casually.',
  'Set Q_ASSIST_SPEED to a safe margin above the airframe stall speed and verify assist engagement on a controlled transition before relying on it.'
]

const quadplaneAutotuneNotes = [
  'QuadPlane autotune (QAUTOTUNE flight mode) refines the Q_A_RAT_* VTOL gains in the air. Assign an RC aux switch to the QAutoTune function, then fly in QHOVER or QLOITER and engage it — it twitches each selected axis for a few minutes.',
  'To SAVE the tuned VTOL gains keep the QAutoTune switch HIGH and land + disarm; switch out before disarming to discard. Q_AUTOTUNE_AXES selects which VTOL axes are tuned; keep the aggressiveness conservative for the first run, and always have a known-good snapshot saved and a safe hover area first.'
]

const fixedWingAutotuneNotes = [
  'Fixed-wing AUTOTUNE refines the roll and pitch rate/attitude PIDs in the air. Set a flight mode (or an RCx_OPTION aux switch) to AUTOTUNE, then fly the aircraft and make a series of sustained roll and pitch inputs — the autopilot learns the gains while you fly.',
  'AUTOTUNE_LEVEL sets aggressiveness (1 = softest, 10 = most aggressive; 6 is recommended for most planes; 0 keeps RMAX/TCONST and tunes only PIDs). Save a known-good snapshot first. The tuned gains are written when you leave AUTOTUNE mode.'
]

const sensorOrientationNotes = [
  'If the board orientation changes, repeat accelerometer calibration before flight.'
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

const batteryVoltageSourceNotes = [
  'Sag-compensated voltage is usually more useful in flight because it accounts for transient load sag.',
  'Raw voltage can still be useful when comparing power-module calibration against a meter on the bench.'
]

const planeFailsafeActionNotes = [
  'Plane failsafes have separate short and long stages. The short stage is intended to be recoverable; the long stage is the actual recovery action.',
  'Glide is generally safer than Continue on fixed-wing builds without a reliable return path; choose a recovery that matches the airframe.'
]

const planeFailsafeTimeoutNotes = [
  'Plane failsafe timeouts are in seconds. Tighten them only after confirming that the receiver/GCS link can tolerate the configured value without nuisance triggers.',
  'After changing failsafe timeouts, rebench the receiver-loss behavior before flight.'
]

const throttleFailsafeNotes = [
  'THR_FAILSAFE / THR_FS_VALUE on Plane are the equivalents of FS_THR_ENABLE / FS_THR_VALUE on Copter.',
  'After changing throttle-failsafe behavior, recheck the receiver-loss flow with the throttle endpoint before flight.'
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

const advancedReceiverNotes = [
  'These receiver-link settings are more advanced than channel mapping and RSSI. Change them only when the actual radio link requires it.',
  'After changing receiver link timing or options, recheck live RC input and failsafe behavior on the bench.'
]

const rssiNotes = [
  'Only enable RSSI if the receiver or link is actually providing signal-strength data.',
  'Verify the live RSSI reading on the bench before using it as a confidence signal.'
]

const rssiChannelNotes = [
  'Use this only when RSSI is being carried on a dedicated RC channel.',
  'Keep the low/high values matched to the actual receiver output range.'
]

const modeChannelNotes = [
  'Set this to the receiver channel that carries the flight-mode switch. Disable it only if mode selection is handled another way.',
  'After changing the mode channel, rerun the mode-switch exercise before flight.'
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

function enumOptions(labelMap: Record<number, string>): ParameterValueOption[] {
  return Object.entries(labelMap)
    .map(([value, label]) => ({
      value: Number(value),
      label
    }))
    .sort((left, right) => left.value - right.value)
}

// Mirrors the ArduCopter helper of the same name. The Plane catalog deliberately
// re-implements this locally instead of sharing one helper with arducopter.ts so
// that Plane-specific port roles (for example a future tailsitter-only protocol
// table) can diverge without coordinating a cross-firmware refactor first.
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

export const arduplaneMetadata: FirmwareMetadataBundle = {
  firmware: 'ArduPlane',
  appViews: [
    {
      id: 'setup',
      label: 'Setup',
      description: 'Connection, calibration, and guided Plane setup.',
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
      description: 'Plane flight-mode switch assignments and live position.',
      order: 6
    },
    {
      id: 'motors',
      label: 'Motors',
      description: 'Propulsion motors (forward thrust + QuadPlane lift motors): output map, direction tests, ESC protocol.',
      order: 7
    },
    {
      id: 'servos',
      label: 'Servos',
      description: 'Control surfaces (aileron/elevator/rudder/flap) and aux servo outputs — gimbal, parachute, gripper.',
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
      description: 'Plane short/long failsafe, RC, and battery failsafe overview.',
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
      description: 'QuadPlane VTOL rate, attitude, position, and assist tuning.',
      order: 12
    },
    {
      id: 'presets',
      label: 'Presets',
      description: 'Future home for Plane tuning presets (not populated in the first cut).',
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
      description: 'QuadPlane enable and geometry settings.',
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
      description: 'Plane flight-mode assignments and switch setup.',
      order: 8,
      viewId: 'receiver'
    },
    outputs: {
      id: 'outputs',
      label: 'Outputs',
      description: 'Servo, motor, and propulsion-related outputs.',
      order: 9,
      // ArduPlane's 'outputs' category mixes QuadPlane motor PWM
      // (Q_M_*) and control-surface SERVOn_FUNCTION definitions in one
      // bucket. Route to Motors as the default surface; per-param
      // routing to Servos for pure-surface params is a follow-up.
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
      description: 'Plane short/long failsafe and battery failsafe behavior.',
      order: 11,
      viewId: 'failsafe'
    },
    'fixed-wing-pid': {
      id: 'fixed-wing-pid',
      label: 'Fixed-Wing PID Gains',
      description: 'Aileron, elevator, and rudder rate-controller P, I, D, and feedforward gains for forward flight.',
      order: 12,
      viewId: 'tuning'
    },
    'fixed-wing-attitude': {
      id: 'fixed-wing-attitude',
      label: 'Fixed-Wing Attitude',
      description: 'Fixed-wing attitude time constants, maximum demanded rates, and bank/pitch limits.',
      order: 13,
      viewId: 'tuning'
    },
    airspeed: {
      id: 'airspeed',
      label: 'Airspeed',
      description: 'Airspeed sensor type/use and the min/max/cruise airspeed envelope used by the automatic throttle modes.',
      order: 14,
      viewId: 'tuning'
    },
    cruise: {
      id: 'cruise',
      label: 'Cruise & Throttle',
      description: 'Cruise throttle, throttle limits and slew, and the level-flight pitch trim for forward flight.',
      order: 15,
      viewId: 'tuning'
    },
    tecs: {
      id: 'tecs',
      label: 'Auto-Flight Speed/Height',
      description: 'TECS total-energy controller — climb/sink limits, time constant, damping and weighting for the automatic throttle modes.',
      order: 16,
      viewId: 'tuning'
    },
    'tecs-landing': {
      id: 'tecs-landing',
      label: 'TECS Landing',
      description: 'TECS gains and limits that only apply while the auto-landing state machine is active — approach airspeed/throttle, landing damping, flare, and pitch limits.',
      order: 16.3,
      viewId: 'tuning'
    },
    'tecs-takeoff': {
      id: 'tecs-takeoff',
      label: 'TECS Takeoff',
      description: 'TECS integrator decoupled from cruise for the auto-takeoff climb.',
      order: 16.6,
      viewId: 'tuning'
    },
    navigation: {
      id: 'navigation',
      label: 'Navigation (L1)',
      description: 'L1 waypoint/loiter path-tracking controller period, damping, and crosstrack gain.',
      order: 17,
      viewId: 'tuning'
    },
    mission: {
      id: 'mission',
      label: 'Mission & Navigation',
      description: 'Waypoint acceptance/loiter radii and RTL behaviour for automatic missions.',
      order: 18,
      viewId: 'tuning'
    },
    landing: {
      id: 'landing',
      label: 'Auto Landing',
      description: 'Fixed-wing automatic-landing flare, pre-flare, throttle slew, and post-touchdown behaviour.',
      order: 19,
      viewId: 'tuning'
    },
    mixing: {
      id: 'mixing',
      label: 'Control Mixing',
      description: 'Rudder/aileron and throttle/pitch mixing, elevon/V-tail output mixing gain, and the flap-by-airspeed schedule.',
      order: 20,
      viewId: 'tuning'
    },
    'vtol-pid': {
      id: 'vtol-pid',
      label: 'VTOL PID Gains',
      description: 'QuadPlane rate-controller P, I, D, and feedforward gains.',
      order: 21,
      viewId: 'tuning'
    },
    'vtol-attitude': {
      id: 'vtol-attitude',
      label: 'VTOL Attitude',
      description: 'QuadPlane angle-loop gains and attitude response limits.',
      order: 22,
      viewId: 'tuning'
    },
    'vtol-filters': {
      id: 'vtol-filters',
      label: 'VTOL Filters',
      description: 'QuadPlane rate-controller filter and slew settings.',
      order: 23,
      viewId: 'tuning'
    },
    'vtol-position': {
      id: 'vtol-position',
      label: 'VTOL Position',
      description: 'QuadPlane position-hold and VTOL waypoint navigation tuning.',
      order: 24,
      viewId: 'tuning'
    },
    'vtol-assist': {
      id: 'vtol-assist',
      label: 'VTOL Assist',
      description: 'QuadPlane fixed-wing assist thresholds and autotune setup.',
      order: 25,
      viewId: 'tuning'
    },
    logging: {
      id: 'logging',
      label: 'Logging',
      description: 'Onboard log backend, retention, and bitmask configuration.',
      order: 26,
      viewId: 'parameters'
    },
    soaring: {
      id: 'soaring',
      label: 'Soaring',
      description: 'Autonomous thermalling — the SOAR_ enable, vertical-speed trigger, thermal estimator (EKF) tuning, altitude band, glide polar, and thermalling/cruise behaviour.',
      order: 27,
      viewId: 'tuning'
    },
    adsb: {
      id: 'adsb',
      label: 'ADS-B & Avoidance',
      description: 'ADS-B transponder hardware (ADSB_) plus the ADS-B traffic-avoidance behaviour (AVD_) — type, identity, RF select, vehicle list filters, and warn/fail avoidance actions.',
      order: 28,
      viewId: 'tuning'
    }
  },
  presetGroups: {
    'flight-feel': {
      id: 'flight-feel',
      label: 'Flight Feel',
      description: 'Reserved for future Plane stick-feel and rate presets. Empty in the first catalog cut.',
      order: 1
    }
  },
  presets: {},
  parameters: {
    // GPS behavior — vehicle-agnostic in ArduPilot (DroneCAN driver
    // value 9 is identical across Copter / Plane / Rover / Sub), but
    // previously only defined in the ArduCopter catalog. Caught when
    // an ArduPlane 4.6.3 CubeRed had a Here3 on CAN1 and the Ports
    // view's GPS behavior dropdowns rendered empty because the
    // ArduPlane bundle had no metadata for these parameter ids.
    GPS_TYPE: {
      id: 'GPS_TYPE',
      label: 'Primary GPS Type',
      description: 'Driver type used for the primary GPS input.',
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
    Q_ENABLE: {
      id: 'Q_ENABLE',
      label: 'QuadPlane Enable',
      description: 'Enables QuadPlane VTOL behavior on Plane builds. Leave at 0 for pure fixed-wing airframes.',
      category: 'airframe',
      minimum: 0,
      maximum: 1,
      rebootRequired: true,
      notes: quadplaneEnableNotes,
      options: enabledDisabledOptions
    },
    Q_FRAME_CLASS: {
      id: 'Q_FRAME_CLASS',
      label: 'QuadPlane Frame Class',
      description: 'Lift-motor frame class for QuadPlane builds.',
      category: 'airframe',
      minimum: 0,
      maximum: 15,
      rebootRequired: true,
      notes: quadplaneGeometryNotes,
      options: enumOptions(ARDUPLANE_Q_FRAME_CLASS_LABELS)
    },
    Q_FRAME_TYPE: {
      id: 'Q_FRAME_TYPE',
      label: 'QuadPlane Frame Type',
      description: 'Lift-motor geometry within the selected QuadPlane frame class.',
      category: 'airframe',
      minimum: 0,
      maximum: 19,
      rebootRequired: true,
      notes: quadplaneGeometryNotes,
      options: enumOptions(ARDUPLANE_Q_FRAME_TYPE_LABELS)
    },
    TECS_CLMB_MAX: {
      id: 'TECS_CLMB_MAX',
      label: 'Maximum Climb Rate',
      description: 'Maximum demanded climb rate (m/s). Do not set higher than the climb the aircraft can sustain at THR_MAX and cruise airspeed on a low battery.',
      category: 'tecs',
      minimum: 0.1,
      maximum: 20,
      step: 0.1,
      notes: tecsNotes
    },
    TECS_SINK_MIN: {
      id: 'TECS_SINK_MIN',
      label: 'Minimum Sink Rate',
      description: 'Minimum sink rate (m/s) at THR_MIN and cruise airspeed.',
      category: 'tecs',
      minimum: 0.1,
      maximum: 10,
      step: 0.1,
      notes: tecsNotes
    },
    TECS_SINK_MAX: {
      id: 'TECS_SINK_MAX',
      label: 'Maximum Descent Rate',
      description: 'Maximum demanded descent rate (m/s). Do not exceed what the aircraft can hold at THR_MIN, TECS_PITCH_MIN and max airspeed.',
      category: 'tecs',
      minimum: 0,
      maximum: 20,
      step: 0.1,
      notes: tecsNotes
    },
    TECS_TIME_CONST: {
      id: 'TECS_TIME_CONST',
      label: 'Controller Time Constant',
      description: 'TECS control time constant (s). Smaller is faster but risks overshoot and aggressive behaviour.',
      category: 'tecs',
      minimum: 3,
      maximum: 10,
      step: 0.2,
      notes: tecsNotes
    },
    TECS_THR_DAMP: {
      id: 'TECS_THR_DAMP',
      label: 'Throttle Damping',
      description: 'Damping gain for the throttle demand loop. Raise to damp speed/height oscillations with more throttle activity.',
      category: 'tecs',
      minimum: 0.1,
      maximum: 1,
      step: 0.1,
      notes: tecsNotes
    },
    TECS_PTCH_DAMP: {
      id: 'TECS_PTCH_DAMP',
      label: 'Pitch Damping',
      description: 'Damping gain for TECS pitch control. Too high adds oscillation and degrades control.',
      category: 'tecs',
      minimum: 0.1,
      maximum: 1,
      step: 0.1,
      notes: tecsNotes
    },
    TECS_INTEG_GAIN: {
      id: 'TECS_INTEG_GAIN',
      label: 'Integrator Gain',
      description: 'Integrator gain that trims out long-term speed and height errors.',
      category: 'tecs',
      minimum: 0,
      maximum: 0.5,
      step: 0.02,
      notes: tecsNotes
    },
    TECS_SPDWEIGHT: {
      id: 'TECS_SPDWEIGHT',
      label: 'Speed/Height Weighting',
      description: 'Pitch/throttle mix for height vs airspeed errors. 0 = pitch holds altitude, 2 = pitch holds airspeed (gliders), 1 = blended.',
      category: 'tecs',
      minimum: 0,
      maximum: 2,
      step: 0.1,
      notes: tecsNotes
    },
    TECS_PITCH_MAX: {
      id: 'TECS_PITCH_MAX',
      label: 'Maximum Auto Pitch Up',
      description: 'Maximum pitch (deg) in automatic throttle modes; overrides the attitude pitch limit. 0 uses the attitude limit.',
      category: 'tecs',
      minimum: 0,
      maximum: 45,
      step: 1,
      notes: tecsNotes
    },
    TECS_PITCH_MIN: {
      id: 'TECS_PITCH_MIN',
      label: 'Maximum Auto Pitch Down',
      description: 'Minimum pitch (deg, negative) in automatic throttle modes; overrides the attitude pitch limit. 0 uses the attitude limit.',
      category: 'tecs',
      minimum: -45,
      maximum: 0,
      step: 1,
      notes: tecsNotes
    },
    TECS_RLL2THR: {
      id: 'TECS_RLL2THR',
      label: 'Bank-Angle Throttle Compensation',
      description: 'Gain from bank angle to throttle to offset drag in turns. Roughly 10× the sink rate (m/s) caused by a 45° turn.',
      category: 'tecs',
      minimum: 5,
      maximum: 30,
      step: 1,
      notes: tecsNotes
    },
    // Additional TECS cruise params verbatim from ArduPilot
    // libraries/AP_TECS/AP_TECS.cpp var_info[]. Ranges / increments / units
    // come straight from the @Param block on each entry — no invented
    // bounds. Useful for tuning vertical responsiveness (VERT_ACC),
    // filter cross-over (HGT_OMEGA / SPD_OMEGA) and altitude-demand
    // smoothing (HDEM_TCONST) — together they cover the "TECS feels
    // sluggish / spikes" tuning workflow the existing 11 params don't.
    TECS_VERT_ACC: {
      id: 'TECS_VERT_ACC',
      label: 'Vertical Acceleration Limit',
      description: 'Vertical acceleration limit (m/s/s) used by TECS to bound demanded climb and sink rates.',
      category: 'tecs',
      unit: 'm/s/s',
      minimum: 1,
      maximum: 10,
      step: 0.5,
      notes: tecsNotes
    },
    TECS_HGT_OMEGA: {
      id: 'TECS_HGT_OMEGA',
      label: 'Height Filter Frequency',
      description: 'Cross-over frequency of the complementary filter fusing vertical acceleration with height.',
      category: 'tecs',
      unit: 'rad/s',
      minimum: 1,
      maximum: 5,
      step: 0.05,
      notes: tecsNotes
    },
    TECS_SPD_OMEGA: {
      id: 'TECS_SPD_OMEGA',
      label: 'Speed Filter Frequency',
      description: 'Cross-over frequency of the complementary filter fusing longitudinal acceleration with airspeed.',
      category: 'tecs',
      unit: 'rad/s',
      minimum: 0.5,
      maximum: 2,
      step: 0.05,
      notes: tecsNotes
    },
    TECS_HDEM_TCONST: {
      id: 'TECS_HDEM_TCONST',
      label: 'Height Demand Time Constant',
      description: 'Time constant of the altitude-demand low-pass filter. Larger smooths a noisy demand at the cost of lag.',
      category: 'tecs',
      unit: 's',
      // Conformance-audit fix: upstream @Range is 1.0 5.0, @Increment 0.2
      // (the previous 0.1 minimum / 0.1 step were invented and allowed a
      // height-demand filter constant 10x below the documented floor).
      minimum: 1,
      maximum: 5,
      step: 0.2,
      notes: tecsNotes
    },
    TECS_PTCH_FF_V0: {
      id: 'TECS_PTCH_FF_V0',
      label: 'Pitch Feed-Forward Baseline Airspeed',
      description: 'Baseline airspeed (m/s) at which the pitch feed-forward effect is calculated.',
      category: 'tecs',
      unit: 'm/s',
      minimum: 5,
      maximum: 50,
      step: 0.1,
      notes: tecsNotes
    },
    TECS_PTCH_FF_K: {
      id: 'TECS_PTCH_FF_K',
      label: 'Pitch Feed-Forward Gain',
      description: 'Gain (negative) for the pitch feed-forward from airspeed. 0 disables; tune against gentle altitude pulses at cruise.',
      category: 'tecs',
      minimum: -5,
      maximum: 0,
      step: 0.05,
      notes: tecsNotes
    },
    // TECS landing-stage params. Verbatim from AP_TECS.cpp var_info[];
    // these only take effect when the auto-landing state machine is
    // active (Plane mode LAND or VTOL landing). Sentinel semantics are
    // PER-PARAM and matter (conformance-audit fix): LAND_ARSPD uses a
    // NEGATIVE sentinel (midpoint of AIRSPEED_MIN..AIRSPEED_CRUISE, not
    // an inherit); LAND_THR uses -1 (inherit TRIM_THROTTLE); LAND_TDAMP /
    // LAND_IGAIN / LAND_PDAMP use ZERO (inherit the cruise gain) — a -1
    // on those would be a real negative gain.
    TECS_LAND_ARSPD: {
      id: 'TECS_LAND_ARSPD',
      label: 'Landing Approach Airspeed',
      // Upstream AP_TECS.cpp: "If negative then this value is halfway
      // between AIRSPEED_MIN and AIRSPEED_CRUISE speed for fixed wing
      // autolandings." — NOT an inherit-cruise sentinel.
      description: 'Target airspeed (m/s) during landing approach. Negative targets the midpoint between AIRSPEED_MIN and AIRSPEED_CRUISE (a slower approach than cruise).',
      category: 'tecs-landing',
      unit: 'm/s',
      minimum: -1,
      maximum: 127,
      step: 1,
      notes: tecsLandingNotes
    },
    TECS_LAND_THR: {
      id: 'TECS_LAND_THR',
      label: 'Landing Cruise Throttle',
      description: 'Cruise throttle (%) during landing approach. -1 inherits TRIM_THROTTLE.',
      category: 'tecs-landing',
      unit: '%',
      minimum: -1,
      maximum: 100,
      step: 0.1,
      notes: tecsLandingNotes
    },
    TECS_LAND_DAMP: {
      id: 'TECS_LAND_DAMP',
      label: 'Landing Pitch Controller Damping',
      description: 'Pitch-controller damping ratio used during landing approach.',
      category: 'tecs-landing',
      minimum: 0.1,
      maximum: 1,
      step: 0.1,
      notes: tecsLandingNotes
    },
    TECS_LAND_PMAX: {
      id: 'TECS_LAND_PMAX',
      label: 'Landing Maximum Pitch',
      description: 'Maximum pitch-up (deg) allowed during the final stage of landing.',
      category: 'tecs-landing',
      unit: 'deg',
      minimum: -5,
      maximum: 40,
      step: 1,
      notes: tecsLandingNotes
    },
    TECS_LAND_TCONST: {
      id: 'TECS_LAND_TCONST',
      label: 'Landing Time Constant',
      description: 'Pitch-control time constant (s) during landing — smaller is more aggressive.',
      category: 'tecs-landing',
      unit: 's',
      minimum: 1,
      maximum: 5,
      step: 0.2,
      notes: tecsLandingNotes
    },
    TECS_LAND_TDAMP: {
      id: 'TECS_LAND_TDAMP',
      label: 'Landing Throttle Damping',
      // Conformance-audit fix: upstream AP_TECS.cpp @Range is 0.1 1.0 and
      // the inherit sentinel is ZERO ("When set to 0 landing throttle
      // damping is controlled by TECS_THR_DAMP"). The previous entry
      // documented -1 as the sentinel — but upstream only special-cases
      // 0, so a -1 here would be used as a REAL negative damping gain in
      // the auto-land throttle loop. Inverted damping during landing.
      description: 'Throttle-loop damping ratio during landing. 0 inherits TECS_THR_DAMP.',
      category: 'tecs-landing',
      minimum: 0,
      maximum: 1,
      step: 0.1,
      notes: tecsLandingNotes
    },
    TECS_LAND_IGAIN: {
      id: 'TECS_LAND_IGAIN',
      label: 'Landing Integrator Gain',
      description: 'Integrator gain used during landing. 0 inherits TECS_INTEG_GAIN.',
      category: 'tecs-landing',
      minimum: 0,
      maximum: 0.5,
      step: 0.02,
      notes: tecsLandingNotes
    },
    TECS_LAND_PDAMP: {
      id: 'TECS_LAND_PDAMP',
      label: 'Landing Pitch Damping',
      description: 'Pitch-damping ratio during landing. 0 inherits TECS_PTCH_DAMP.',
      category: 'tecs-landing',
      minimum: 0,
      maximum: 1,
      step: 0.1,
      notes: tecsLandingNotes
    },
    TECS_APPR_SMAX: {
      id: 'TECS_APPR_SMAX',
      label: 'Approach Maximum Sink Rate',
      description: 'Maximum sink rate (m/s) during the landing approach. 0 uses TECS_SINK_MAX.',
      category: 'tecs-landing',
      unit: 'm/s',
      minimum: 0,
      maximum: 20,
      step: 0.1,
      notes: tecsLandingNotes
    },
    TECS_FLARE_HGT: {
      id: 'TECS_FLARE_HGT',
      label: 'Flare Holdoff Height',
      description: 'Height (m) at which TECS flares the aircraft for touchdown.',
      category: 'tecs-landing',
      unit: 'm',
      minimum: 0,
      maximum: 15,
      step: 0.1,
      notes: tecsLandingNotes
    },
    // TECS takeoff integrator — separate from cruise so AUTO-takeoff
    // climb can be tuned without disturbing cruise integral wind-up.
    TECS_TKOFF_IGAIN: {
      id: 'TECS_TKOFF_IGAIN',
      label: 'Takeoff Integrator Gain',
      description: 'Integrator gain used during takeoff. 0 inherits TECS_INTEG_GAIN.',
      category: 'tecs-takeoff',
      minimum: 0,
      maximum: 0.5,
      step: 0.02,
      notes: tecsTakeoffNotes
    },
    NAVL1_PERIOD: {
      id: 'NAVL1_PERIOD',
      label: 'L1 Control Period',
      description: 'Period (s) of the L1 navigation loop — the primary turn-aggressiveness control in AUTO. Lower tracks tighter.',
      category: 'navigation',
      minimum: 1,
      maximum: 60,
      step: 1,
      notes: navNotes
    },
    NAVL1_DAMPING: {
      id: 'NAVL1_DAMPING',
      label: 'L1 Damping Ratio',
      description: 'Damping ratio for L1 control. Increase in 0.05 steps if path tracking overshoots.',
      category: 'navigation',
      minimum: 0.6,
      maximum: 1,
      step: 0.05,
      notes: navNotes
    },
    NAVL1_XTRACK_I: {
      id: 'NAVL1_XTRACK_I',
      label: 'L1 Crosstrack Integrator',
      description: 'Crosstrack-error integrator gain; drives the crosstrack error to zero.',
      category: 'navigation',
      minimum: 0,
      maximum: 0.1,
      step: 0.01,
      notes: navNotes
    },
    NAVL1_LIM_BANK: {
      id: 'NAVL1_LIM_BANK',
      label: 'Loiter Bank Angle Limit',
      description: 'Sea-level bank-angle limit (deg) for a continuous loiter, used to bound airframe loading at altitude.',
      category: 'navigation',
      minimum: 0,
      maximum: 89,
      step: 1,
      notes: navNotes
    },
    WP_RADIUS: {
      id: 'WP_RADIUS',
      label: 'Waypoint Radius',
      description: 'Distance (m) from a waypoint at which it is considered reached and the mission advances.',
      category: 'mission',
      minimum: 1,
      maximum: 32767,
      step: 1,
      notes: missionNotes
    },
    WP_MAX_RADIUS: {
      id: 'WP_MAX_RADIUS',
      label: 'Waypoint Maximum Radius',
      description: 'If non-zero, a waypoint is only marked reached within this distance (m); 0 also accepts passing the perpendicular.',
      category: 'mission',
      minimum: 0,
      maximum: 32767,
      step: 1,
      notes: missionNotes
    },
    WP_LOITER_RAD: {
      id: 'WP_LOITER_RAD',
      label: 'Loiter Radius',
      description: 'Default loiter circle radius (m). Negative loiters counter-clockwise.',
      category: 'mission',
      minimum: -32767,
      maximum: 32767,
      step: 1,
      notes: missionNotes
    },
    RTL_RADIUS: {
      id: 'RTL_RADIUS',
      label: 'RTL Loiter Radius',
      description: 'Loiter radius (m) used during RTL. 0 uses WP_LOITER_RAD; negative loiters counter-clockwise.',
      category: 'mission',
      minimum: -32767,
      maximum: 32767,
      step: 1,
      notes: missionNotes
    },
    RTL_AUTOLAND: {
      id: 'RTL_AUTOLAND',
      label: 'RTL Auto Land',
      description: 'What the aircraft does at the end of an RTL (e.g. proceed into a DO_LAND_START landing sequence).',
      category: 'mission',
      options: enumOptions(ARDUPLANE_RTL_AUTOLAND_LABELS),
      notes: missionNotes
    },
    KFF_RDDRMIX: {
      id: 'KFF_RDDRMIX',
      label: 'Rudder Mix',
      description: 'Amount of rudder mixed with aileron to help coordinate turns.',
      category: 'mixing',
      minimum: 0,
      maximum: 1,
      step: 0.01,
      notes: mixingNotes
    },
    KFF_THR2PTCH: {
      id: 'KFF_THR2PTCH',
      label: 'Throttle-to-Pitch Mix',
      description: 'Feedforward from throttle to pitch to counter pitch changes from power.',
      category: 'mixing',
      minimum: -5,
      maximum: 5,
      step: 0.01,
      notes: mixingNotes
    },
    MIXING_GAIN: {
      id: 'MIXING_GAIN',
      label: 'Output Mixing Gain',
      description: 'Mixing gain for elevon / V-tail / flaperon outputs (the manual-mix output scaling).',
      category: 'mixing',
      minimum: 0.5,
      maximum: 1.2,
      step: 0.01,
      notes: mixingNotes
    },
    RUDD_DT_GAIN: {
      id: 'RUDD_DT_GAIN',
      label: 'Rudder Differential-Thrust Gain',
      description: 'Percentage of rudder demand mixed into differential thrust on multi-motor aircraft.',
      category: 'mixing',
      minimum: 0,
      maximum: 100,
      step: 1,
      notes: mixingNotes
    },
    FLAP_1_PERCNT: {
      id: 'FLAP_1_PERCNT',
      label: 'Flap 1 Percentage',
      description: 'Flap deployment percentage applied at or below FLAP_1_SPEED.',
      category: 'mixing',
      minimum: 0,
      maximum: 100,
      step: 1,
      notes: mixingNotes
    },
    FLAP_1_SPEED: {
      id: 'FLAP_1_SPEED',
      label: 'Flap 1 Speed',
      description: 'Airspeed (m/s) at or below which FLAP_1_PERCNT of flap is applied.',
      category: 'mixing',
      minimum: 0,
      maximum: 100,
      step: 1,
      notes: mixingNotes
    },
    FLAP_2_PERCNT: {
      id: 'FLAP_2_PERCNT',
      label: 'Flap 2 Percentage',
      description: 'Flap deployment percentage applied at or below FLAP_2_SPEED (the slower, larger-flap stage).',
      category: 'mixing',
      minimum: 0,
      maximum: 100,
      step: 1,
      notes: mixingNotes
    },
    FLAP_2_SPEED: {
      id: 'FLAP_2_SPEED',
      label: 'Flap 2 Speed',
      description: 'Airspeed (m/s) at or below which FLAP_2_PERCNT of flap is applied.',
      category: 'mixing',
      minimum: 0,
      maximum: 100,
      step: 1,
      notes: mixingNotes
    },
    LAND_TYPE: {
      id: 'LAND_TYPE',
      label: 'Auto-Landing Type',
      description: 'Which automatic-landing approach algorithm to use.',
      category: 'landing',
      options: enumOptions(ARDUPLANE_LAND_TYPE_LABELS),
      notes: landingNotes
    },
    LAND_SLOPE_RCALC: {
      id: 'LAND_SLOPE_RCALC',
      label: 'Slope Re-calc Threshold',
      description: 'Rangefinder altitude correction (m) that triggers a landing-slope recalculation.',
      category: 'landing',
      minimum: 0,
      maximum: 5,
      step: 0.5,
      notes: landingNotes
    },
    LAND_ABORT_DEG: {
      id: 'LAND_ABORT_DEG',
      label: 'Auto-Abort Slope Threshold',
      description: 'Delta degrees above the intended slope that triggers a go-around.',
      category: 'landing',
      minimum: 0,
      maximum: 90,
      step: 0.1,
      notes: landingNotes
    },
    LAND_PITCH_DEG: {
      id: 'LAND_PITCH_DEG',
      label: 'Landing Flare Pitch',
      description: 'Minimum pitch (deg) held during the final landing flare.',
      category: 'landing',
      minimum: -20,
      maximum: 20,
      step: 10,
      notes: landingNotes
    },
    LAND_FLARE_ALT: {
      id: 'LAND_FLARE_ALT',
      label: 'Flare Altitude',
      description: 'Altitude (m) at which heading is locked and the aircraft flares to LAND_PITCH_DEG.',
      category: 'landing',
      minimum: 0,
      maximum: 30,
      step: 0.1,
      notes: landingNotes
    },
    LAND_FLARE_SEC: {
      id: 'LAND_FLARE_SEC',
      label: 'Flare Time',
      description: 'Time (s) before the landing point at which to lock heading and flare with motor stopped.',
      category: 'landing',
      minimum: 0,
      maximum: 10,
      step: 0.1,
      notes: landingNotes
    },
    LAND_PF_ALT: {
      id: 'LAND_PF_ALT',
      label: 'Pre-Flare Altitude',
      description: 'Altitude (m) triggering the pre-flare stage where LAND_PF_ARSPD controls airspeed.',
      category: 'landing',
      minimum: 0,
      maximum: 30,
      step: 0.1,
      notes: landingNotes
    },
    LAND_PF_SEC: {
      id: 'LAND_PF_SEC',
      label: 'Pre-Flare Time',
      description: 'Time-to-ground (s) triggering the pre-flare airspeed-control stage.',
      category: 'landing',
      minimum: 0,
      maximum: 10,
      step: 0.1,
      notes: landingNotes
    },
    LAND_PF_ARSPD: {
      id: 'LAND_PF_ARSPD',
      label: 'Pre-Flare Airspeed',
      description: 'Desired airspeed (m/s) during the pre-flare stage to slow down before the flare.',
      category: 'landing',
      minimum: 0,
      maximum: 30,
      step: 0.1,
      notes: landingNotes
    },
    LAND_THR_SLEW: {
      id: 'LAND_THR_SLEW',
      label: 'Landing Throttle Slew',
      description: 'Throttle change percent per second during an automatic landing (values < 50 not recommended).',
      category: 'landing',
      minimum: 0,
      maximum: 500,
      step: 1,
      notes: landingNotes
    },
    LAND_DISARMDELAY: {
      id: 'LAND_DISARMDELAY',
      label: 'Landing Disarm Delay',
      description: 'Seconds after a completed landing before automatic disarm (0 disables).',
      category: 'landing',
      minimum: 0,
      maximum: 127,
      step: 1,
      notes: landingNotes
    },
    LAND_THEN_NEUTRL: {
      id: 'LAND_THEN_NEUTRL',
      label: 'Servos After Landing',
      description: 'Servo state after an automatic landing and auto-disarm.',
      category: 'landing',
      options: enumOptions(ARDUPLANE_LAND_THEN_NEUTRL_LABELS),
      notes: landingNotes
    },
    LAND_ABORT_THR: {
      id: 'LAND_ABORT_THR',
      label: 'Abort Landing via Throttle',
      description: 'Allow a landing abort to be triggered by raising the throttle stick to ≥ 90%.',
      category: 'landing',
      options: enabledDisabledOptions,
      notes: landingNotes
    },
    LAND_FLAP_PERCNT: {
      id: 'LAND_FLAP_PERCNT',
      label: 'Landing Flap Percentage',
      description: 'Flap percentage applied during the automatic landing approach and flare.',
      category: 'landing',
      minimum: 0,
      maximum: 100,
      step: 1,
      notes: landingNotes
    },
    LAND_FLARE_AIM: {
      id: 'LAND_FLARE_AIM',
      label: 'Flare Aim Adjustment',
      description: 'Percentage that shifts the aim point to account for the flare manoeuvre time.',
      category: 'landing',
      minimum: 0,
      maximum: 100,
      step: 1,
      notes: landingNotes
    },
    LAND_WIND_COMP: {
      id: 'LAND_WIND_COMP',
      label: 'Headwind Compensation',
      description: 'Percentage of the headwind component added to the commanded landing airspeed.',
      category: 'landing',
      minimum: 0,
      maximum: 100,
      step: 1,
      notes: landingNotes
    },
    ARSPD_TYPE: {
      id: 'ARSPD_TYPE',
      label: 'Airspeed Sensor Type',
      description: 'Type of airspeed sensor connected (0 = none / no airspeed sensor).',
      category: 'airspeed',
      options: enumOptions(ARDUPLANE_ARSPD_TYPE_LABELS)
    },
    ARSPD_USE: {
      id: 'ARSPD_USE',
      label: 'Use Airspeed',
      description: 'Whether the airspeed sensor feeds the automatic throttle modes (replaces THR_TRIM control).',
      category: 'airspeed',
      options: enumOptions(ARDUPLANE_ARSPD_USE_LABELS)
    },
    ARSPD_RATIO: {
      id: 'ARSPD_RATIO',
      label: 'Airspeed Ratio',
      description: 'Calibrates pitot pressure to velocity. Higher means a higher reported airspeed.',
      category: 'airspeed',
      minimum: 0,
      step: 0.1,
      notes: airspeedNotes
    },
    ARSPD_AUTOCAL: {
      id: 'ARSPD_AUTOCAL',
      label: 'Automatic Ratio Calibration',
      description: 'Continuously adjusts ARSPD_RATIO in flight from a GPS/wind estimate.',
      category: 'airspeed',
      options: enabledDisabledOptions,
      notes: airspeedNotes
    },
    ARSPD_SKIP_CAL: {
      id: 'ARSPD_SKIP_CAL',
      label: 'Skip Startup Calibration',
      description: 'Controls whether the airspeed offset is re-calibrated at every startup.',
      category: 'airspeed',
      options: enumOptions(ARDUPLANE_ARSPD_SKIP_CAL_LABELS)
    },
    AIRSPEED_MIN: {
      id: 'AIRSPEED_MIN',
      label: 'Minimum Airspeed',
      description: 'Minimum airspeed demanded in automatic throttle modes (m/s). Modern ArduPlane name for ARSPD_FBW_MIN.',
      category: 'airspeed',
      minimum: 5,
      maximum: 100,
      step: 1,
      notes: airspeedNotes
    },
    ARSPD_FBW_MIN: {
      id: 'ARSPD_FBW_MIN',
      label: 'Minimum Airspeed (legacy)',
      description: 'Legacy name (ArduPlane < 4.5) for the minimum demanded airspeed (m/s); modern firmware reports AIRSPEED_MIN.',
      category: 'airspeed',
      minimum: 5,
      maximum: 100,
      step: 1,
      notes: airspeedNotes
    },
    AIRSPEED_MAX: {
      id: 'AIRSPEED_MAX',
      label: 'Maximum Airspeed',
      description: 'Maximum airspeed demanded in automatic throttle modes (m/s). Modern ArduPlane name for ARSPD_FBW_MAX.',
      category: 'airspeed',
      minimum: 5,
      maximum: 100,
      step: 1,
      notes: airspeedNotes
    },
    ARSPD_FBW_MAX: {
      id: 'ARSPD_FBW_MAX',
      label: 'Maximum Airspeed (legacy)',
      description: 'Legacy name (ArduPlane < 4.5) for the maximum demanded airspeed (m/s); modern firmware reports AIRSPEED_MAX.',
      category: 'airspeed',
      minimum: 5,
      maximum: 100,
      step: 1,
      notes: airspeedNotes
    },
    AIRSPEED_CRUISE: {
      id: 'AIRSPEED_CRUISE',
      label: 'Cruise Airspeed',
      description: 'Target cruise airspeed in automatic throttle modes (m/s). Modern ArduPlane name for TRIM_ARSPD_CM.',
      category: 'airspeed',
      minimum: 0,
      step: 0.1,
      notes: airspeedNotes
    },
    TRIM_ARSPD_CM: {
      id: 'TRIM_ARSPD_CM',
      label: 'Cruise Airspeed (legacy, cm/s)',
      description: 'Legacy name (ArduPlane < 4.5) for the target cruise airspeed, in cm/s; modern firmware reports AIRSPEED_CRUISE in m/s.',
      category: 'airspeed',
      minimum: 0,
      step: 10,
      notes: airspeedNotes
    },
    STALL_PREVENTION: {
      id: 'STALL_PREVENTION',
      label: 'Stall Prevention',
      description: 'Limits bank angle and raises the demanded airspeed near the stall to help prevent a stall in auto modes.',
      category: 'airspeed',
      options: enabledDisabledOptions,
      notes: airspeedNotes
    },
    TRIM_THROTTLE: {
      id: 'TRIM_THROTTLE',
      label: 'Cruise Throttle',
      description: 'Throttle percentage used for level flight at the cruise airspeed.',
      category: 'cruise',
      minimum: 0,
      maximum: 100,
      step: 1,
      notes: cruiseNotes
    },
    THR_MIN: {
      id: 'THR_MIN',
      label: 'Minimum Throttle',
      description: 'Minimum throttle percentage the autopilot will command (negative allows reverse thrust where supported).',
      category: 'cruise',
      minimum: -100,
      maximum: 100,
      step: 1,
      notes: cruiseNotes
    },
    THR_MAX: {
      id: 'THR_MAX',
      label: 'Maximum Throttle',
      description: 'Maximum throttle percentage the autopilot will command.',
      category: 'cruise',
      minimum: 0,
      maximum: 100,
      step: 1,
      notes: cruiseNotes
    },
    THR_SLEWRATE: {
      id: 'THR_SLEWRATE',
      label: 'Throttle Slew Rate',
      description: 'Maximum rate of throttle change in percent per second (0 disables the limit).',
      category: 'cruise',
      minimum: 0,
      maximum: 500,
      step: 1,
      notes: cruiseNotes
    },
    THROTTLE_NUDGE: {
      id: 'THROTTLE_NUDGE',
      label: 'Throttle Nudge',
      description: 'Allows the throttle stick to nudge the demanded airspeed/throttle up in automatic modes.',
      category: 'cruise',
      options: enabledDisabledOptions,
      notes: cruiseNotes
    },
    PTCH_TRIM_DEG: {
      id: 'PTCH_TRIM_DEG',
      label: 'Level-Flight Pitch Trim',
      description: 'Pitch offset (degrees) for level flight so the aircraft holds altitude at cruise. Modern name for TRIM_PITCH_CD.',
      category: 'cruise',
      minimum: -45,
      maximum: 45,
      step: 0.1,
      notes: cruiseNotes
    },
    TRIM_PITCH_CD: {
      id: 'TRIM_PITCH_CD',
      label: 'Level-Flight Pitch Trim (legacy, cdeg)',
      description: 'Legacy name (ArduPlane < 4.5) for the level-flight pitch offset, in centidegrees; modern firmware reports PTCH_TRIM_DEG in degrees.',
      category: 'cruise',
      minimum: -4500,
      maximum: 4500,
      step: 10,
      notes: cruiseNotes
    },
    AUTOTUNE_AXES: {
      id: 'AUTOTUNE_AXES',
      label: 'Autotune Axes',
      description: '1-byte bitmap of axes to autotune.',
      category: 'fixed-wing-pid',
      minimum: 0,
      maximum: 7,
      step: 1,
      bitmask: true,
      notes: fixedWingAutotuneNotes,
      options: enumOptions(ARDUPLANE_AUTOTUNE_AXES_BIT_LABELS)
    },
    AUTOTUNE_LEVEL: {
      id: 'AUTOTUNE_LEVEL',
      label: 'Autotune Level',
      description:
        "Level of aggressiveness of pitch and roll PID gains. Lower values result in a 'softer' tune. Level 6 recommended for most planes. A value of 0 means to keep the current values of RMAX and TCONST for the controllers, tuning only the PID values.",
      category: 'fixed-wing-pid',
      minimum: 0,
      maximum: 10,
      step: 1,
      notes: fixedWingAutotuneNotes
    },
    AUTOTUNE_OPTIONS: {
      id: 'AUTOTUNE_OPTIONS',
      label: 'Autotune Options',
      description:
        'Fixed-wing autotune options bitmask. Useful on QuadPlanes with higher INS_GYRO_FILTER settings to prevent these filter values from being set too aggressively during fixed-wing autotune.',
      category: 'fixed-wing-pid',
      minimum: 0,
      maximum: 3,
      step: 1,
      bitmask: true,
      notes: fixedWingAutotuneNotes,
      options: enumOptions(ARDUPLANE_AUTOTUNE_OPTIONS_BIT_LABELS)
    },
    RLL_RATE_P: {
      id: 'RLL_RATE_P',
      label: 'Roll Rate P Gain',
      description: 'Fixed-wing roll-axis (aileron) rate-controller P gain.',
      category: 'fixed-wing-pid',
      minimum: 0,
      maximum: 0.6,
      step: 0.001,
      notes: fixedWingRatePidNotes
    },
    RLL_RATE_I: {
      id: 'RLL_RATE_I',
      label: 'Roll Rate I Gain',
      description: 'Fixed-wing roll-axis rate-controller I gain.',
      category: 'fixed-wing-pid',
      minimum: 0,
      maximum: 0.6,
      step: 0.001,
      notes: fixedWingRatePidNotes
    },
    RLL_RATE_D: {
      id: 'RLL_RATE_D',
      label: 'Roll Rate D Gain',
      description: 'Fixed-wing roll-axis rate-controller D gain.',
      category: 'fixed-wing-pid',
      minimum: 0,
      maximum: 0.1,
      step: 0.0001,
      notes: fixedWingRatePidNotes
    },
    RLL_RATE_FF: {
      id: 'RLL_RATE_FF',
      label: 'Roll Rate Feedforward',
      description: 'Fixed-wing roll-axis rate-controller feedforward gain (the dominant term for surface aircraft).',
      category: 'fixed-wing-pid',
      minimum: 0,
      maximum: 0.6,
      step: 0.001,
      notes: fixedWingRatePidNotes
    },
    RLL_RATE_IMAX: {
      id: 'RLL_RATE_IMAX',
      label: 'Roll Rate I Max',
      description: 'Fixed-wing roll-axis integrator clamp.',
      category: 'fixed-wing-pid',
      minimum: 0,
      maximum: 1,
      step: 0.01,
      notes: fixedWingRatePidNotes
    },
    PTCH_RATE_P: {
      id: 'PTCH_RATE_P',
      label: 'Pitch Rate P Gain',
      description: 'Fixed-wing pitch-axis (elevator) rate-controller P gain.',
      category: 'fixed-wing-pid',
      minimum: 0,
      maximum: 0.6,
      step: 0.001,
      notes: fixedWingRatePidNotes
    },
    PTCH_RATE_I: {
      id: 'PTCH_RATE_I',
      label: 'Pitch Rate I Gain',
      description: 'Fixed-wing pitch-axis rate-controller I gain.',
      category: 'fixed-wing-pid',
      minimum: 0,
      maximum: 0.6,
      step: 0.001,
      notes: fixedWingRatePidNotes
    },
    PTCH_RATE_D: {
      id: 'PTCH_RATE_D',
      label: 'Pitch Rate D Gain',
      description: 'Fixed-wing pitch-axis rate-controller D gain.',
      category: 'fixed-wing-pid',
      minimum: 0,
      maximum: 0.1,
      step: 0.0001,
      notes: fixedWingRatePidNotes
    },
    PTCH_RATE_FF: {
      id: 'PTCH_RATE_FF',
      label: 'Pitch Rate Feedforward',
      description: 'Fixed-wing pitch-axis rate-controller feedforward gain (the dominant term for surface aircraft).',
      category: 'fixed-wing-pid',
      minimum: 0,
      maximum: 0.6,
      step: 0.001,
      notes: fixedWingRatePidNotes
    },
    PTCH_RATE_IMAX: {
      id: 'PTCH_RATE_IMAX',
      label: 'Pitch Rate I Max',
      description: 'Fixed-wing pitch-axis integrator clamp.',
      category: 'fixed-wing-pid',
      minimum: 0,
      maximum: 1,
      step: 0.01,
      notes: fixedWingRatePidNotes
    },
    YAW_RATE_P: {
      id: 'YAW_RATE_P',
      label: 'Yaw Rate P Gain',
      description: 'Fixed-wing yaw-axis (rudder) rate-controller P gain.',
      category: 'fixed-wing-pid',
      minimum: 0,
      maximum: 0.6,
      step: 0.001,
      notes: fixedWingRatePidNotes
    },
    YAW_RATE_I: {
      id: 'YAW_RATE_I',
      label: 'Yaw Rate I Gain',
      description: 'Fixed-wing yaw-axis rate-controller I gain.',
      category: 'fixed-wing-pid',
      minimum: 0,
      maximum: 0.6,
      step: 0.001,
      notes: fixedWingRatePidNotes
    },
    YAW_RATE_D: {
      id: 'YAW_RATE_D',
      label: 'Yaw Rate D Gain',
      description: 'Fixed-wing yaw-axis rate-controller D gain.',
      category: 'fixed-wing-pid',
      minimum: 0,
      maximum: 0.1,
      step: 0.0001,
      notes: fixedWingRatePidNotes
    },
    YAW_RATE_FF: {
      id: 'YAW_RATE_FF',
      label: 'Yaw Rate Feedforward',
      description: 'Fixed-wing yaw-axis rate-controller feedforward gain.',
      category: 'fixed-wing-pid',
      minimum: 0,
      maximum: 0.6,
      step: 0.001,
      notes: fixedWingRatePidNotes
    },
    YAW_RATE_IMAX: {
      id: 'YAW_RATE_IMAX',
      label: 'Yaw Rate I Max',
      description: 'Fixed-wing yaw-axis integrator clamp.',
      category: 'fixed-wing-pid',
      minimum: 0,
      maximum: 1,
      step: 0.01,
      notes: fixedWingRatePidNotes
    },
    RLL2SRV_TCONST: {
      id: 'RLL2SRV_TCONST',
      label: 'Roll Time Constant',
      description: 'Time constant (s) from demanded to achieved roll angle. Lower is crisper; most models fly well around 0.5.',
      category: 'fixed-wing-attitude',
      minimum: 0.4,
      maximum: 1,
      step: 0.1,
      notes: fixedWingAttitudeNotes
    },
    RLL2SRV_RMAX: {
      id: 'RLL2SRV_RMAX',
      label: 'Maximum Roll Rate',
      description: 'Maximum roll rate (deg/s) the attitude controller will demand. 0 disables the limit.',
      category: 'fixed-wing-attitude',
      minimum: 0,
      maximum: 180,
      step: 1,
      notes: fixedWingAttitudeNotes
    },
    PTCH2SRV_TCONST: {
      id: 'PTCH2SRV_TCONST',
      label: 'Pitch Time Constant',
      description: 'Time constant (s) from demanded to achieved pitch angle.',
      category: 'fixed-wing-attitude',
      minimum: 0.4,
      maximum: 1,
      step: 0.1,
      notes: fixedWingAttitudeNotes
    },
    PTCH2SRV_RMAX_UP: {
      id: 'PTCH2SRV_RMAX_UP',
      label: 'Pitch Up Max Rate',
      description: 'Maximum nose-up pitch rate (deg/s) the attitude controller will demand. 0 disables the limit.',
      category: 'fixed-wing-attitude',
      minimum: 0,
      maximum: 100,
      step: 1,
      notes: fixedWingAttitudeNotes
    },
    PTCH2SRV_RMAX_DN: {
      id: 'PTCH2SRV_RMAX_DN',
      label: 'Pitch Down Max Rate',
      description: 'Maximum nose-down pitch rate (deg/s) the attitude controller will demand. 0 disables the limit.',
      category: 'fixed-wing-attitude',
      minimum: 0,
      maximum: 100,
      step: 1,
      notes: fixedWingAttitudeNotes
    },
    PTCH2SRV_RLL: {
      id: 'PTCH2SRV_RLL',
      label: 'Pitch-Roll Compensation',
      description: 'Added pitch to hold altitude through turns. 1.0 is no compensation; raise toward 1.5 for tighter turns.',
      category: 'fixed-wing-attitude',
      minimum: 0.7,
      maximum: 1.5,
      step: 0.05,
      notes: fixedWingAttitudeNotes
    },
    LIM_ROLL_CD: {
      id: 'LIM_ROLL_CD',
      label: 'Maximum Bank Angle (legacy, cd)',
      description: 'Legacy ArduPlane <4.5 name for maximum bank angle, in centidegrees (e.g. 4500 = 45°). Modern firmware reports ROLL_LIMIT_DEG in degrees.',
      category: 'fixed-wing-attitude',
      minimum: 0,
      maximum: 9000,
      step: 10,
      notes: fixedWingAttitudeNotes
    },
    LIM_PITCH_MAX: {
      id: 'LIM_PITCH_MAX',
      label: 'Maximum Pitch Up (legacy, cd)',
      description: 'Legacy ArduPlane <4.5 name for maximum nose-up pitch, in centidegrees. Modern firmware reports PTCH_LIM_MAX_DEG in degrees.',
      category: 'fixed-wing-attitude',
      minimum: 0,
      maximum: 9000,
      step: 10,
      notes: fixedWingAttitudeNotes
    },
    LIM_PITCH_MIN: {
      id: 'LIM_PITCH_MIN',
      label: 'Maximum Pitch Down (legacy, cd)',
      description: 'Legacy ArduPlane <4.5 name for maximum nose-down pitch, in centidegrees (negative, e.g. -2500 = -25°). Modern firmware reports PTCH_LIM_MIN_DEG in degrees.',
      category: 'fixed-wing-attitude',
      minimum: -9000,
      maximum: 0,
      step: 10,
      notes: fixedWingAttitudeNotes
    },
    // ArduPlane 4.5+ renamed the attitude-limit params to degrees-based form.
    // Catalog both names so the curated UI works against any firmware version;
    // alias shim deliberately does NOT mirror these (unit changed cd -> deg,
    // raw value would display 100x wrong).
    ROLL_LIMIT_DEG: {
      id: 'ROLL_LIMIT_DEG',
      label: 'Maximum Bank Angle',
      description: 'Maximum bank the autopilot will command, in degrees. Modern ArduPlane name for LIM_ROLL_CD (which was in centidegrees).',
      category: 'fixed-wing-attitude',
      unit: 'deg',
      minimum: 0,
      maximum: 90,
      step: 1,
      notes: fixedWingAttitudeNotes
    },
    PTCH_LIM_MAX_DEG: {
      id: 'PTCH_LIM_MAX_DEG',
      label: 'Maximum Pitch Up',
      description: 'Maximum nose-up pitch the autopilot will command, in degrees. Modern ArduPlane name for LIM_PITCH_MAX (which was in centidegrees).',
      category: 'fixed-wing-attitude',
      unit: 'deg',
      minimum: 0,
      maximum: 90,
      step: 1,
      notes: fixedWingAttitudeNotes
    },
    PTCH_LIM_MIN_DEG: {
      id: 'PTCH_LIM_MIN_DEG',
      label: 'Maximum Pitch Down',
      description: 'Maximum nose-down pitch the autopilot will command, in degrees (negative). Modern ArduPlane name for LIM_PITCH_MIN.',
      category: 'fixed-wing-attitude',
      unit: 'deg',
      minimum: -90,
      maximum: 0,
      step: 1,
      notes: fixedWingAttitudeNotes
    },
    Q_A_RAT_RLL_P: {
      id: 'Q_A_RAT_RLL_P',
      label: 'VTOL Roll P Gain',
      description: 'QuadPlane roll-axis rate P gain.',
      category: 'vtol-pid',
      minimum: 0,
      maximum: 0.6,
      step: 0.001,
      notes: quadplaneRatePidNotes
    },
    Q_A_RAT_RLL_I: {
      id: 'Q_A_RAT_RLL_I',
      label: 'VTOL Roll I Gain',
      description: 'QuadPlane roll-axis rate I gain.',
      category: 'vtol-pid',
      minimum: 0,
      maximum: 0.6,
      step: 0.001,
      notes: quadplaneRatePidNotes
    },
    Q_A_RAT_RLL_D: {
      id: 'Q_A_RAT_RLL_D',
      label: 'VTOL Roll D Gain',
      description: 'QuadPlane roll-axis rate D gain.',
      category: 'vtol-pid',
      minimum: 0,
      maximum: 0.1,
      step: 0.0001,
      notes: quadplaneRatePidNotes
    },
    Q_A_RAT_RLL_FF: {
      id: 'Q_A_RAT_RLL_FF',
      label: 'VTOL Roll Feedforward',
      description: 'QuadPlane roll-axis rate feedforward gain.',
      category: 'vtol-pid',
      minimum: 0,
      maximum: 0.5,
      step: 0.001,
      notes: quadplaneRatePidNotes
    },
    Q_A_RAT_RLL_IMAX: {
      id: 'Q_A_RAT_RLL_IMAX',
      label: 'VTOL Roll I Max',
      description: 'QuadPlane roll-axis integrator clamp.',
      category: 'vtol-pid',
      minimum: 0,
      maximum: 1,
      step: 0.01,
      notes: quadplaneRatePidNotes
    },
    Q_A_RAT_PIT_P: {
      id: 'Q_A_RAT_PIT_P',
      label: 'VTOL Pitch P Gain',
      description: 'QuadPlane pitch-axis rate P gain.',
      category: 'vtol-pid',
      minimum: 0,
      maximum: 0.6,
      step: 0.001,
      notes: quadplaneRatePidNotes
    },
    Q_A_RAT_PIT_I: {
      id: 'Q_A_RAT_PIT_I',
      label: 'VTOL Pitch I Gain',
      description: 'QuadPlane pitch-axis rate I gain.',
      category: 'vtol-pid',
      minimum: 0,
      maximum: 0.6,
      step: 0.001,
      notes: quadplaneRatePidNotes
    },
    Q_A_RAT_PIT_D: {
      id: 'Q_A_RAT_PIT_D',
      label: 'VTOL Pitch D Gain',
      description: 'QuadPlane pitch-axis rate D gain.',
      category: 'vtol-pid',
      minimum: 0,
      maximum: 0.1,
      step: 0.0001,
      notes: quadplaneRatePidNotes
    },
    Q_A_RAT_PIT_FF: {
      id: 'Q_A_RAT_PIT_FF',
      label: 'VTOL Pitch Feedforward',
      description: 'QuadPlane pitch-axis rate feedforward gain.',
      category: 'vtol-pid',
      minimum: 0,
      maximum: 0.5,
      step: 0.001,
      notes: quadplaneRatePidNotes
    },
    Q_A_RAT_PIT_IMAX: {
      id: 'Q_A_RAT_PIT_IMAX',
      label: 'VTOL Pitch I Max',
      description: 'QuadPlane pitch-axis integrator clamp.',
      category: 'vtol-pid',
      minimum: 0,
      maximum: 1,
      step: 0.01,
      notes: quadplaneRatePidNotes
    },
    Q_A_RAT_YAW_P: {
      id: 'Q_A_RAT_YAW_P',
      label: 'VTOL Yaw P Gain',
      description: 'QuadPlane yaw-axis rate P gain.',
      category: 'vtol-pid',
      minimum: 0,
      maximum: 0.6,
      step: 0.001,
      notes: quadplaneRatePidNotes
    },
    Q_A_RAT_YAW_I: {
      id: 'Q_A_RAT_YAW_I',
      label: 'VTOL Yaw I Gain',
      description: 'QuadPlane yaw-axis rate I gain.',
      category: 'vtol-pid',
      minimum: 0,
      maximum: 0.6,
      step: 0.001,
      notes: quadplaneRatePidNotes
    },
    Q_A_RAT_YAW_D: {
      id: 'Q_A_RAT_YAW_D',
      label: 'VTOL Yaw D Gain',
      description: 'QuadPlane yaw-axis rate D gain.',
      category: 'vtol-pid',
      minimum: 0,
      maximum: 0.1,
      step: 0.0001,
      notes: quadplaneRatePidNotes
    },
    Q_A_RAT_YAW_FF: {
      id: 'Q_A_RAT_YAW_FF',
      label: 'VTOL Yaw Feedforward',
      description: 'QuadPlane yaw-axis rate feedforward gain.',
      category: 'vtol-pid',
      minimum: 0,
      maximum: 0.5,
      step: 0.001,
      notes: quadplaneRatePidNotes
    },
    Q_A_RAT_YAW_IMAX: {
      id: 'Q_A_RAT_YAW_IMAX',
      label: 'VTOL Yaw I Max',
      description: 'QuadPlane yaw-axis integrator clamp.',
      category: 'vtol-pid',
      minimum: 0,
      maximum: 1,
      step: 0.01,
      notes: quadplaneRatePidNotes
    },
    Q_A_ANG_RLL_P: {
      id: 'Q_A_ANG_RLL_P',
      label: 'VTOL Roll Angle P',
      description: 'QuadPlane roll angle-loop P gain feeding the rate controller.',
      category: 'vtol-attitude',
      minimum: 3,
      maximum: 12,
      step: 0.1,
      notes: quadplaneAnglePidNotes
    },
    Q_A_ANG_PIT_P: {
      id: 'Q_A_ANG_PIT_P',
      label: 'VTOL Pitch Angle P',
      description: 'QuadPlane pitch angle-loop P gain feeding the rate controller.',
      category: 'vtol-attitude',
      minimum: 3,
      maximum: 12,
      step: 0.1,
      notes: quadplaneAnglePidNotes
    },
    Q_A_ANG_YAW_P: {
      id: 'Q_A_ANG_YAW_P',
      label: 'VTOL Yaw Angle P',
      description: 'QuadPlane yaw angle-loop P gain feeding the rate controller.',
      category: 'vtol-attitude',
      minimum: 3,
      maximum: 12,
      step: 0.1,
      notes: quadplaneAnglePidNotes
    },
    // QuadPlane attitude rate / accel limits. The legacy entries below match
    // catalog names that ArduPlane older than ~4.4 reported (longer axis
    // suffixes: RLL/PIT/YAW, longer verb prefix: ACCEL). Modern ArduPlane
    // (4.5+) shortened both — RATE_R_MAX / ACC_R_MAX etc. — AND changed the
    // accel unit from cd/s² (max 180000) to deg/s² (max 1800). The runtime
    // alias shim mirrors the RATE form (same unit), but NOT the ACC form
    // (100x wrong otherwise). Both name variants live in the catalog so the
    // operator can edit whichever the FC actually streams.
    Q_A_RATE_RLL_MAX: {
      id: 'Q_A_RATE_RLL_MAX',
      label: 'VTOL Roll Rate Limit (legacy)',
      description: 'Legacy ArduPlane <4.5 name. Modern firmware reports Q_A_RATE_R_MAX.',
      category: 'vtol-attitude',
      unit: 'deg/s',
      minimum: 0,
      maximum: 1080,
      step: 1,
      notes: quadplaneAnglePidNotes
    },
    Q_A_RATE_PIT_MAX: {
      id: 'Q_A_RATE_PIT_MAX',
      label: 'VTOL Pitch Rate Limit (legacy)',
      description: 'Legacy ArduPlane <4.5 name. Modern firmware reports Q_A_RATE_P_MAX.',
      category: 'vtol-attitude',
      unit: 'deg/s',
      minimum: 0,
      maximum: 1080,
      step: 1,
      notes: quadplaneAnglePidNotes
    },
    Q_A_RATE_YAW_MAX: {
      id: 'Q_A_RATE_YAW_MAX',
      label: 'VTOL Yaw Rate Limit (legacy)',
      description: 'Legacy ArduPlane <4.5 name. Modern firmware reports Q_A_RATE_Y_MAX.',
      category: 'vtol-attitude',
      unit: 'deg/s',
      minimum: 0,
      maximum: 1080,
      step: 1,
      notes: quadplaneAnglePidNotes
    },
    Q_A_RATE_R_MAX: {
      id: 'Q_A_RATE_R_MAX',
      label: 'VTOL Roll Rate Limit',
      description: 'Maximum commanded QuadPlane roll rate. Zero leaves the rate uncapped.',
      category: 'vtol-attitude',
      unit: 'deg/s',
      minimum: 0,
      maximum: 1080,
      step: 1,
      notes: quadplaneAnglePidNotes
    },
    Q_A_RATE_P_MAX: {
      id: 'Q_A_RATE_P_MAX',
      label: 'VTOL Pitch Rate Limit',
      description: 'Maximum commanded QuadPlane pitch rate. Zero leaves the rate uncapped.',
      category: 'vtol-attitude',
      unit: 'deg/s',
      minimum: 0,
      maximum: 1080,
      step: 1,
      notes: quadplaneAnglePidNotes
    },
    Q_A_RATE_Y_MAX: {
      id: 'Q_A_RATE_Y_MAX',
      label: 'VTOL Yaw Rate Limit',
      description: 'Maximum commanded QuadPlane yaw rate. Zero leaves the rate uncapped.',
      category: 'vtol-attitude',
      unit: 'deg/s',
      minimum: 0,
      maximum: 1080,
      step: 1,
      notes: quadplaneAnglePidNotes
    },
    Q_A_ACCEL_R_MAX: {
      id: 'Q_A_ACCEL_R_MAX',
      label: 'VTOL Roll Accel Limit (legacy, cd/s²)',
      description: 'Legacy ArduPlane <4.5 name in centidegrees/s². Modern firmware reports Q_A_ACC_R_MAX in deg/s².',
      category: 'vtol-attitude',
      unit: 'cd/s²',
      minimum: 0,
      maximum: 180000,
      step: 100,
      notes: quadplaneAnglePidNotes
    },
    Q_A_ACCEL_P_MAX: {
      id: 'Q_A_ACCEL_P_MAX',
      label: 'VTOL Pitch Accel Limit (legacy, cd/s²)',
      description: 'Legacy ArduPlane <4.5 name in centidegrees/s². Modern firmware reports Q_A_ACC_P_MAX in deg/s².',
      category: 'vtol-attitude',
      unit: 'cd/s²',
      minimum: 0,
      maximum: 180000,
      step: 100,
      notes: quadplaneAnglePidNotes
    },
    Q_A_ACCEL_Y_MAX: {
      id: 'Q_A_ACCEL_Y_MAX',
      label: 'VTOL Yaw Accel Limit (legacy, cd/s²)',
      description: 'Legacy ArduPlane <4.5 name in centidegrees/s². Modern firmware reports Q_A_ACC_Y_MAX in deg/s².',
      category: 'vtol-attitude',
      unit: 'cd/s²',
      minimum: 0,
      maximum: 72000,
      step: 100,
      notes: quadplaneAnglePidNotes
    },
    Q_A_ACC_R_MAX: {
      id: 'Q_A_ACC_R_MAX',
      label: 'VTOL Roll Accel Limit',
      description: 'Maximum QuadPlane roll angular acceleration target used by the response shaper.',
      category: 'vtol-attitude',
      unit: 'deg/s²',
      minimum: 0,
      maximum: 1800,
      step: 1,
      notes: quadplaneAnglePidNotes
    },
    Q_A_ACC_P_MAX: {
      id: 'Q_A_ACC_P_MAX',
      label: 'VTOL Pitch Accel Limit',
      description: 'Maximum QuadPlane pitch angular acceleration target used by the response shaper.',
      category: 'vtol-attitude',
      unit: 'deg/s²',
      minimum: 0,
      maximum: 1800,
      step: 1,
      notes: quadplaneAnglePidNotes
    },
    Q_A_ACC_Y_MAX: {
      id: 'Q_A_ACC_Y_MAX',
      label: 'VTOL Yaw Accel Limit',
      description: 'Maximum QuadPlane yaw angular acceleration target used by the response shaper.',
      category: 'vtol-attitude',
      unit: 'deg/s²',
      minimum: 0,
      maximum: 720,
      step: 1,
      notes: quadplaneAnglePidNotes
    },
    // QuadPlane max-lean-angle was renamed in ArduPlane 4.5 and the unit
    // shifted cdeg -> deg (factor 100). Same shape as the Copter
    // ANGLE_MAX -> ATC_ANGLE_MAX rename. Catalog both forms; alias shim
    // deliberately omitted — a raw value mirror would be 100x off.
    Q_ANGLE_MAX: {
      id: 'Q_ANGLE_MAX',
      label: 'VTOL Lean Angle Max (legacy, cdeg)',
      description: 'Legacy ArduPlane <4.5 name in centidegrees. Modern firmware reports Q_A_ANGLE_MAX in degrees.',
      category: 'vtol-attitude',
      unit: 'cdeg',
      minimum: 1000,
      maximum: 8000,
      step: 10,
      notes: quadplaneAnglePidNotes
    },
    Q_A_ANGLE_MAX: {
      id: 'Q_A_ANGLE_MAX',
      label: 'VTOL Lean Angle Max',
      description: 'Maximum QuadPlane lean angle in VTOL hover and position-hold modes.',
      category: 'vtol-attitude',
      unit: 'deg',
      minimum: 10,
      maximum: 80,
      step: 1,
      notes: quadplaneAnglePidNotes
    },
    Q_A_RAT_RLL_FLTT: {
      id: 'Q_A_RAT_RLL_FLTT',
      label: 'VTOL Roll Target Filter',
      description: 'QuadPlane roll-axis rate target filter frequency.',
      category: 'vtol-filters',
      unit: 'Hz',
      minimum: 0,
      maximum: 100,
      step: 1,
      notes: quadplaneFilterNotes
    },
    Q_A_RAT_RLL_FLTD: {
      id: 'Q_A_RAT_RLL_FLTD',
      label: 'VTOL Roll D Filter',
      description: 'QuadPlane roll-axis rate D-term filter frequency.',
      category: 'vtol-filters',
      unit: 'Hz',
      minimum: 0,
      maximum: 100,
      step: 1,
      notes: quadplaneFilterNotes
    },
    Q_A_RAT_PIT_FLTT: {
      id: 'Q_A_RAT_PIT_FLTT',
      label: 'VTOL Pitch Target Filter',
      description: 'QuadPlane pitch-axis rate target filter frequency.',
      category: 'vtol-filters',
      unit: 'Hz',
      minimum: 0,
      maximum: 100,
      step: 1,
      notes: quadplaneFilterNotes
    },
    Q_A_RAT_PIT_FLTD: {
      id: 'Q_A_RAT_PIT_FLTD',
      label: 'VTOL Pitch D Filter',
      description: 'QuadPlane pitch-axis rate D-term filter frequency.',
      category: 'vtol-filters',
      unit: 'Hz',
      minimum: 0,
      maximum: 100,
      step: 1,
      notes: quadplaneFilterNotes
    },
    Q_A_RAT_YAW_FLTT: {
      id: 'Q_A_RAT_YAW_FLTT',
      label: 'VTOL Yaw Target Filter',
      description: 'QuadPlane yaw-axis rate target filter frequency.',
      category: 'vtol-filters',
      unit: 'Hz',
      minimum: 0,
      maximum: 100,
      step: 1,
      notes: quadplaneFilterNotes
    },
    Q_A_RAT_YAW_FLTE: {
      id: 'Q_A_RAT_YAW_FLTE',
      label: 'VTOL Yaw Error Filter',
      description: 'QuadPlane yaw-axis rate error filter frequency.',
      category: 'vtol-filters',
      unit: 'Hz',
      minimum: 0,
      maximum: 100,
      step: 1,
      notes: quadplaneFilterNotes
    },
    Q_A_RAT_RLL_SMAX: {
      id: 'Q_A_RAT_RLL_SMAX',
      label: 'VTOL Roll Slew Limit',
      description: 'QuadPlane roll-axis rate-controller slew-rate limit.',
      category: 'vtol-filters',
      minimum: 0,
      maximum: 200,
      step: 1,
      notes: quadplaneFilterNotes
    },
    Q_A_RAT_PIT_SMAX: {
      id: 'Q_A_RAT_PIT_SMAX',
      label: 'VTOL Pitch Slew Limit',
      description: 'QuadPlane pitch-axis rate-controller slew-rate limit.',
      category: 'vtol-filters',
      minimum: 0,
      maximum: 200,
      step: 1,
      notes: quadplaneFilterNotes
    },
    Q_A_RAT_YAW_SMAX: {
      id: 'Q_A_RAT_YAW_SMAX',
      label: 'VTOL Yaw Slew Limit',
      description: 'QuadPlane yaw-axis rate-controller slew-rate limit.',
      category: 'vtol-filters',
      minimum: 0,
      maximum: 200,
      step: 1,
      notes: quadplaneFilterNotes
    },
    Q_M_PWM_TYPE: {
      id: 'Q_M_PWM_TYPE',
      label: 'VTOL Motor PWM Type',
      description: 'Lift-motor output protocol for QuadPlane ESC communication.',
      category: 'outputs',
      minimum: 0,
      maximum: 8,
      rebootRequired: true,
      notes: quadplaneMotorPwmTypeNotes,
      options: enumOptions(ARDUPLANE_Q_M_PWM_TYPE_LABELS)
    },
    Q_M_PWM_MIN: {
      id: 'Q_M_PWM_MIN',
      label: 'VTOL Motor PWM Minimum',
      description: 'Minimum PWM value sent to the QuadPlane lift-motor ESCs on PWM-based protocols.',
      category: 'outputs',
      unit: 'us',
      minimum: 0,
      maximum: 2200,
      step: 1,
      notes: quadplaneMotorNotes
    },
    Q_M_PWM_MAX: {
      id: 'Q_M_PWM_MAX',
      label: 'VTOL Motor PWM Maximum',
      description: 'Maximum PWM value sent to the QuadPlane lift-motor ESCs on PWM-based protocols.',
      category: 'outputs',
      unit: 'us',
      minimum: 0,
      maximum: 2200,
      step: 1,
      notes: quadplaneMotorNotes
    },
    Q_M_SPIN_ARM: {
      id: 'Q_M_SPIN_ARM',
      label: 'VTOL Motor Spin Armed',
      description: 'Lift-motor output fraction used immediately after arming a QuadPlane.',
      category: 'outputs',
      minimum: 0,
      maximum: 1,
      step: 0.01,
      notes: quadplaneMotorNotes
    },
    Q_M_SPIN_MIN: {
      id: 'Q_M_SPIN_MIN',
      label: 'VTOL Motor Spin Minimum',
      description: 'Lowest stabilized QuadPlane lift-motor output fraction during hover.',
      category: 'outputs',
      minimum: 0,
      maximum: 1,
      step: 0.01,
      notes: quadplaneMotorNotes
    },
    Q_M_SPIN_MAX: {
      id: 'Q_M_SPIN_MAX',
      label: 'VTOL Motor Spin Maximum',
      description: 'Highest allowed QuadPlane lift-motor output fraction.',
      category: 'outputs',
      minimum: 0,
      maximum: 1,
      step: 0.01,
      notes: quadplaneMotorNotes
    },
    Q_M_THST_HOVER: {
      id: 'Q_M_THST_HOVER',
      label: 'VTOL Hover Thrust',
      description: 'Estimated lift-motor output fraction required to hover the QuadPlane.',
      category: 'outputs',
      minimum: 0.1,
      maximum: 0.8,
      step: 0.01,
      notes: quadplaneMotorNotes
    },
    Q_M_BAT_VOLT_MAX: {
      id: 'Q_M_BAT_VOLT_MAX',
      label: 'VTOL Motor Volt Max',
      description: 'Battery voltage at which lift-motor thrust scaling is fully unscaled. Zero disables voltage scaling.',
      category: 'outputs',
      unit: 'V',
      minimum: 0,
      maximum: 70,
      step: 0.1,
      notes: quadplaneMotorNotes
    },
    Q_M_BAT_VOLT_MIN: {
      id: 'Q_M_BAT_VOLT_MIN',
      label: 'VTOL Motor Volt Min',
      description: 'Battery voltage at which lift-motor thrust scaling reaches its maximum compensation. Zero disables voltage scaling.',
      category: 'outputs',
      unit: 'V',
      minimum: 0,
      maximum: 70,
      step: 0.1,
      notes: quadplaneMotorNotes
    },
    // QuadPlane position controller XY/Z axis labels were renamed to NE/D
    // (NED convention) in ArduPlane 4.5 alongside a controller retune that
    // narrowed safe gain bounds (esp. the Z-accel loop, ~6x lower). Catalog
    // both forms with their own bounds. Alias shim deliberately omitted —
    // a raw value mirror would let a legacy gain (e.g. ACCZ_P=1.0) land at
    // 4x the modern safe max in D_ACC_P and dangerously detune.
    Q_P_POSXY_P: {
      id: 'Q_P_POSXY_P',
      label: 'VTOL Position XY P (legacy)',
      description: 'Legacy ArduPlane <4.5 name. Modern firmware reports Q_P_NE_POS_P (NED axes, retuned bounds).',
      category: 'vtol-position',
      minimum: 0,
      maximum: 2,
      step: 0.01,
      notes: quadplanePositionNotes
    },
    Q_P_NE_POS_P: {
      id: 'Q_P_NE_POS_P',
      label: 'VTOL Position NE P',
      description: 'QuadPlane horizontal (north/east) position-controller P gain.',
      category: 'vtol-position',
      minimum: 0.5,
      maximum: 4,
      step: 0.01,
      notes: quadplanePositionNotes
    },
    Q_P_POSZ_P: {
      id: 'Q_P_POSZ_P',
      label: 'VTOL Position Z P (legacy)',
      description: 'Legacy ArduPlane <4.5 name. Modern firmware reports Q_P_D_POS_P (NED axes, retuned bounds).',
      category: 'vtol-position',
      minimum: 0,
      maximum: 3,
      step: 0.01,
      notes: quadplanePositionNotes
    },
    Q_P_D_POS_P: {
      id: 'Q_P_D_POS_P',
      label: 'VTOL Position D P',
      description: 'QuadPlane vertical (down) position-controller P gain.',
      category: 'vtol-position',
      minimum: 0.5,
      maximum: 4,
      step: 0.01,
      notes: quadplanePositionNotes
    },
    Q_P_VELXY_P: {
      id: 'Q_P_VELXY_P',
      label: 'VTOL Velocity XY P (legacy)',
      description: 'Legacy ArduPlane <4.5 name. Modern firmware reports Q_P_NE_VEL_P (NED axes, retuned bounds).',
      category: 'vtol-position',
      minimum: 0,
      maximum: 6,
      step: 0.01,
      notes: quadplanePositionNotes
    },
    Q_P_NE_VEL_P: {
      id: 'Q_P_NE_VEL_P',
      label: 'VTOL Velocity NE P',
      description: 'QuadPlane horizontal (north/east) velocity-controller P gain.',
      category: 'vtol-position',
      minimum: 0.1,
      maximum: 10,
      step: 0.01,
      notes: quadplanePositionNotes
    },
    Q_P_VELXY_I: {
      id: 'Q_P_VELXY_I',
      label: 'VTOL Velocity XY I (legacy)',
      description: 'Legacy ArduPlane <4.5 name. Modern firmware reports Q_P_NE_VEL_I (NED axes, retuned bounds).',
      category: 'vtol-position',
      minimum: 0,
      maximum: 3,
      step: 0.01,
      notes: quadplanePositionNotes
    },
    Q_P_NE_VEL_I: {
      id: 'Q_P_NE_VEL_I',
      label: 'VTOL Velocity NE I',
      description: 'QuadPlane horizontal (north/east) velocity-controller I gain.',
      category: 'vtol-position',
      minimum: 0.1,
      maximum: 10,
      step: 0.01,
      notes: quadplanePositionNotes
    },
    Q_P_ACCZ_P: {
      id: 'Q_P_ACCZ_P',
      label: 'VTOL Accel Z P (legacy)',
      description: 'Legacy ArduPlane <4.5 name. Modern firmware reports Q_P_D_ACC_P (NED axes, retuned bounds — safe gain ~6x lower).',
      category: 'vtol-position',
      minimum: 0,
      maximum: 1.5,
      step: 0.01,
      notes: quadplanePositionNotes
    },
    Q_P_D_ACC_P: {
      id: 'Q_P_D_ACC_P',
      label: 'VTOL Accel D P',
      description: 'QuadPlane vertical (down) acceleration-controller P gain.',
      category: 'vtol-position',
      minimum: 0.01,
      maximum: 0.25,
      step: 0.01,
      notes: quadplanePositionNotes
    },
    Q_P_ACCZ_I: {
      id: 'Q_P_ACCZ_I',
      label: 'VTOL Accel Z I (legacy)',
      description: 'Legacy ArduPlane <4.5 name. Modern firmware reports Q_P_D_ACC_I (NED axes, retuned bounds — safe gain ~6x lower).',
      category: 'vtol-position',
      minimum: 0,
      maximum: 3,
      step: 0.01,
      notes: quadplanePositionNotes
    },
    Q_P_D_ACC_I: {
      id: 'Q_P_D_ACC_I',
      label: 'VTOL Accel D I',
      description: 'QuadPlane vertical (down) acceleration-controller I gain.',
      category: 'vtol-position',
      minimum: 0,
      maximum: 0.5,
      step: 0.01,
      notes: quadplanePositionNotes
    },
    // QuadPlane waypoint navigation params. ArduPlane 4.5+ shortened the
    // names AND switched the unit from cm-based (cm/s, cm/s², cm) to
    // m-based (m/s, m/s², m) — a 100x value change. Catalog both forms
    // with correct per-form units so the curated UI surfaces whichever
    // name the FC streams. Alias shim deliberately omitted across this
    // whole family — a raw value mirror would be 100x off.
    Q_WP_SPEED: {
      id: 'Q_WP_SPEED',
      label: 'VTOL Waypoint Speed (legacy, cm/s)',
      description: 'Legacy ArduPlane <4.5 name in cm/s. Modern firmware reports Q_WP_SPD in m/s.',
      category: 'vtol-position',
      unit: 'cm/s',
      minimum: 20,
      maximum: 2000,
      step: 10,
      notes: quadplanePositionNotes
    },
    Q_WP_SPD: {
      id: 'Q_WP_SPD',
      label: 'VTOL Waypoint Speed',
      description: 'Target horizontal speed for QuadPlane VTOL waypoint navigation.',
      category: 'vtol-position',
      unit: 'm/s',
      minimum: 0.1,
      maximum: 20,
      step: 0.1,
      notes: quadplanePositionNotes
    },
    Q_WP_SPEED_UP: {
      id: 'Q_WP_SPEED_UP',
      label: 'VTOL Climb Speed (legacy, cm/s)',
      description: 'Legacy ArduPlane <4.5 name in cm/s. Modern firmware reports Q_WP_SPD_UP in m/s.',
      category: 'vtol-position',
      unit: 'cm/s',
      minimum: 10,
      maximum: 1000,
      step: 10,
      notes: quadplanePositionNotes
    },
    Q_WP_SPD_UP: {
      id: 'Q_WP_SPD_UP',
      label: 'VTOL Climb Speed',
      description: 'Target climb speed for QuadPlane VTOL waypoint navigation.',
      category: 'vtol-position',
      unit: 'm/s',
      minimum: 0.1,
      maximum: 10,
      step: 0.1,
      notes: quadplanePositionNotes
    },
    Q_WP_SPEED_DN: {
      id: 'Q_WP_SPEED_DN',
      label: 'VTOL Descent Speed (legacy, cm/s)',
      description: 'Legacy ArduPlane <4.5 name in cm/s. Modern firmware reports Q_WP_SPD_DN in m/s.',
      category: 'vtol-position',
      unit: 'cm/s',
      minimum: 10,
      maximum: 500,
      step: 10,
      notes: quadplanePositionNotes
    },
    Q_WP_SPD_DN: {
      id: 'Q_WP_SPD_DN',
      label: 'VTOL Descent Speed',
      description: 'Target descent speed for QuadPlane VTOL waypoint navigation.',
      category: 'vtol-position',
      unit: 'm/s',
      minimum: 0.1,
      maximum: 10,
      step: 0.1,
      notes: quadplanePositionNotes
    },
    Q_WP_ACCEL: {
      id: 'Q_WP_ACCEL',
      label: 'VTOL Waypoint Accel (legacy, cm/s²)',
      description: 'Legacy ArduPlane <4.5 name in cm/s². Modern firmware reports Q_WP_ACC in m/s².',
      category: 'vtol-position',
      unit: 'cm/s²',
      minimum: 50,
      maximum: 500,
      step: 10,
      notes: quadplanePositionNotes
    },
    Q_WP_ACC: {
      id: 'Q_WP_ACC',
      label: 'VTOL Waypoint Accel',
      description: 'Horizontal acceleration limit for QuadPlane VTOL waypoint navigation.',
      category: 'vtol-position',
      unit: 'm/s²',
      minimum: 0.5,
      maximum: 5,
      step: 0.1,
      notes: quadplanePositionNotes
    },
    Q_WP_RADIUS: {
      id: 'Q_WP_RADIUS',
      label: 'VTOL Waypoint Radius (legacy, cm)',
      description: 'Legacy ArduPlane <4.5 name in cm. Modern firmware reports Q_WP_RADIUS_M in m.',
      category: 'vtol-position',
      unit: 'cm',
      minimum: 5,
      maximum: 1000,
      step: 1,
      notes: quadplanePositionNotes
    },
    Q_WP_RADIUS_M: {
      id: 'Q_WP_RADIUS_M',
      label: 'VTOL Waypoint Radius',
      description: 'Acceptance radius for completing a QuadPlane VTOL waypoint.',
      category: 'vtol-position',
      unit: 'm',
      minimum: 0.05,
      maximum: 10,
      step: 0.1,
      notes: quadplanePositionNotes
    },
    Q_ASSIST_SPEED: {
      id: 'Q_ASSIST_SPEED',
      label: 'VTOL Assist Speed',
      description: 'Airspeed below which the QuadPlane lift motors assist fixed-wing flight. Zero disables airspeed-based assist.',
      category: 'vtol-assist',
      unit: 'm/s',
      minimum: 0,
      maximum: 100,
      step: 0.1,
      notes: quadplaneAssistNotes
    },
    Q_ASSIST_ANGLE: {
      id: 'Q_ASSIST_ANGLE',
      label: 'VTOL Assist Angle',
      description: 'Attitude error above which the QuadPlane lift motors assist recovery. Zero disables angle-based assist.',
      category: 'vtol-assist',
      unit: 'deg',
      minimum: 0,
      maximum: 90,
      step: 1,
      notes: quadplaneAssistNotes
    },
    Q_ASSIST_ALT: {
      id: 'Q_ASSIST_ALT',
      label: 'VTOL Assist Altitude',
      description: 'Altitude above ground below which the QuadPlane lift motors assist. Zero disables altitude-based assist.',
      category: 'vtol-assist',
      unit: 'm',
      minimum: 0,
      maximum: 120,
      step: 1,
      notes: quadplaneAssistNotes
    },
    Q_ASSIST_DELAY: {
      id: 'Q_ASSIST_DELAY',
      label: 'VTOL Assist Delay',
      description: 'Time the assist trigger condition must persist before the lift motors engage.',
      category: 'vtol-assist',
      unit: 's',
      minimum: 0,
      maximum: 2,
      step: 0.1,
      notes: quadplaneAssistNotes
    },
    Q_ASSIST_OPTIONS: {
      id: 'Q_ASSIST_OPTIONS',
      label: 'VTOL Assist Options',
      description: 'Advanced QuadPlane assist behavior bitmask.',
      category: 'vtol-assist',
      minimum: 0,
      maximum: 7,
      step: 1,
      notes: quadplaneAssistNotes
    },
    Q_AUTOTUNE_AXES: {
      id: 'Q_AUTOTUNE_AXES',
      label: 'VTOL Autotune Axes',
      description: '1-byte bitmap of VTOL axes to autotune.',
      category: 'vtol-assist',
      minimum: 0,
      maximum: 15,
      step: 1,
      bitmask: true,
      notes: quadplaneAutotuneNotes,
      options: enumOptions(ARDUPLANE_Q_AUTOTUNE_AXES_BIT_LABELS)
    },
    Q_AUTOTUNE_AGGR: {
      id: 'Q_AUTOTUNE_AGGR',
      label: 'VTOL Autotune Aggressiveness',
      description: 'Autotune aggressiveness. Defines the bounce back used to detect size of the D term.',
      category: 'vtol-assist',
      minimum: 0.05,
      maximum: 0.1,
      step: 0.005,
      notes: quadplaneAutotuneNotes
    },
    Q_AUTOTUNE_MIN_D: {
      id: 'Q_AUTOTUNE_MIN_D',
      label: 'VTOL Autotune Min D',
      description: 'Defines the minimum D gain.',
      category: 'vtol-assist',
      minimum: 0.0001,
      maximum: 0.005,
      step: 0.0001,
      notes: quadplaneAutotuneNotes
    },
    Q_AUTOTUNE_GMBK: {
      id: 'Q_AUTOTUNE_GMBK',
      label: 'VTOL Autotune Gain Margin Backoff',
      description:
        'Fraction by which tuned P and D gains are reduced after rate and angle AutoTune steps complete. This provides extra stability margin by reducing gains slightly from the optimal values found during tuning. A value of 0.0 applies no reduction. A value of 0.25 reduces tuned gains by 25%.',
      category: 'vtol-assist',
      minimum: 0,
      maximum: 0.5,
      step: 0.05,
      notes: quadplaneAutotuneNotes
    },
    AHRS_ORIENTATION: {
      id: 'AHRS_ORIENTATION',
      label: 'Board Orientation',
      description: 'Mounting orientation for the flight controller.',
      category: 'sensors',
      minimum: 0,
      maximum: 102,
      options: AHRS_ORIENTATION_OPTIONS,
      notes: sensorOrientationNotes
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
    ...buildSerialPortParameterDefinitions(8),
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
    BATT_FS_LOW_ACT: {
      id: 'BATT_FS_LOW_ACT',
      label: 'Low Battery Failsafe Action',
      description: 'Action taken when the low battery failsafe threshold is reached.',
      category: 'failsafe',
      minimum: 0,
      maximum: 7,
      options: enumOptions(ARDUPLANE_BATTERY_FAILSAFE_LOW_ACTION_LABELS)
    },
    BATT_FS_CRT_ACT: {
      id: 'BATT_FS_CRT_ACT',
      label: 'Critical Battery Action',
      description: 'Action taken when the critical battery threshold is reached.',
      category: 'failsafe',
      minimum: 0,
      maximum: 7,
      options: enumOptions(ARDUPLANE_BATTERY_FAILSAFE_CRT_ACTION_LABELS)
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
    FS_LONG_ACTN: {
      id: 'FS_LONG_ACTN',
      label: 'Long Failsafe Action',
      description: 'Recovery action taken when the long failsafe timer expires after a sustained RC or GCS loss.',
      category: 'failsafe',
      minimum: 0,
      maximum: 3,
      notes: planeFailsafeActionNotes,
      options: enumOptions(ARDUPLANE_FS_LONG_ACTN_LABELS)
    },
    FS_SHORT_ACTN: {
      id: 'FS_SHORT_ACTN',
      label: 'Short Failsafe Action',
      description: 'Holding action taken when the short failsafe timer expires after a brief link loss.',
      category: 'failsafe',
      minimum: 0,
      maximum: 3,
      notes: planeFailsafeActionNotes,
      options: enumOptions(ARDUPLANE_FS_SHORT_ACTN_LABELS)
    },
    FS_LONG_TIMEOUT: {
      id: 'FS_LONG_TIMEOUT',
      label: 'Long Failsafe Timeout',
      description: 'Seconds of sustained RC or GCS loss before the long failsafe action fires.',
      category: 'failsafe',
      unit: 's',
      minimum: 1,
      maximum: 300,
      step: 1,
      notes: planeFailsafeTimeoutNotes
    },
    FS_SHORT_TIMEOUT: {
      id: 'FS_SHORT_TIMEOUT',
      label: 'Short Failsafe Timeout',
      description: 'Seconds of link loss before the short failsafe action (FS_SHORT_ACTN) fires. FS_LONG_TIMEOUT controls the longer-duration sustained-loss path.',
      category: 'failsafe',
      unit: 's',
      minimum: 1,
      maximum: 100,
      step: 1,
      notes: planeFailsafeTimeoutNotes
    },
    THR_FAILSAFE: {
      id: 'THR_FAILSAFE',
      label: 'Throttle Failsafe Enable',
      description: 'Enable receiver-loss detection by watching the throttle channel falling below THR_FS_VALUE.',
      category: 'failsafe',
      minimum: 0,
      maximum: 1,
      notes: throttleFailsafeNotes,
      options: enabledDisabledOptions
    },
    THR_FS_VALUE: {
      id: 'THR_FS_VALUE',
      label: 'Throttle Failsafe PWM',
      description: 'Throttle channel PWM threshold used to detect receiver-loss throttle failsafe.',
      category: 'failsafe',
      unit: 'us',
      minimum: 925,
      maximum: 1100,
      step: 1,
      notes: throttleFailsafeNotes
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
    RC_SPEED: {
      id: 'RC_SPEED',
      label: 'RC Input Rate (legacy)',
      description: 'Legacy ArduPlane <4.5 servo/ESC output update rate (Hz). Modern firmware reports SERVO_RATE (same unit Hz, narrower 25..400 range — bound shift is why this is NOT alias-mirrored).',
      category: 'radio',
      unit: 'Hz',
      minimum: 1,
      maximum: 500,
      step: 1,
      notes: advancedReceiverNotes
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
    FLTMODE_CH: {
      id: 'FLTMODE_CH',
      label: 'Flight Mode Channel',
      description: 'Receiver channel used to select Plane flight modes.',
      category: 'modes',
      minimum: 0,
      maximum: 16,
      notes: modeChannelNotes,
      options: enumOptions(ARDUCOPTER_FLTMODE_CHANNEL_LABELS)
    },
    FLTMODE1: {
      id: 'FLTMODE1',
      label: 'Flight Mode 1',
      description: 'Mode assigned to the first switch position.',
      category: 'modes',
      options: enumOptions(ARDUPLANE_FLIGHT_MODE_LABELS)
    },
    FLTMODE2: {
      id: 'FLTMODE2',
      label: 'Flight Mode 2',
      description: 'Mode assigned to the second switch position.',
      category: 'modes',
      options: enumOptions(ARDUPLANE_FLIGHT_MODE_LABELS)
    },
    FLTMODE3: {
      id: 'FLTMODE3',
      label: 'Flight Mode 3',
      description: 'Mode assigned to the third switch position.',
      category: 'modes',
      options: enumOptions(ARDUPLANE_FLIGHT_MODE_LABELS)
    },
    FLTMODE4: {
      id: 'FLTMODE4',
      label: 'Flight Mode 4',
      description: 'Mode assigned to the fourth switch position.',
      category: 'modes',
      options: enumOptions(ARDUPLANE_FLIGHT_MODE_LABELS)
    },
    FLTMODE5: {
      id: 'FLTMODE5',
      label: 'Flight Mode 5',
      description: 'Mode assigned to the fifth switch position.',
      category: 'modes',
      options: enumOptions(ARDUPLANE_FLIGHT_MODE_LABELS)
    },
    FLTMODE6: {
      id: 'FLTMODE6',
      label: 'Flight Mode 6',
      description: 'Mode assigned to the sixth switch position.',
      category: 'modes',
      options: enumOptions(ARDUPLANE_FLIGHT_MODE_LABELS)
    },
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
    },
    // ----------------------------------------------------------------------
    // Soaring (SOAR_*). Sourced verbatim from ArduPilot
    // libraries/AP_Soaring/AP_Soaring.cpp var_info[] (@DisplayName /
    // @Description / @Units / @Range / @Values / defaults).
    // ----------------------------------------------------------------------
    SOAR_ENABLE: {
      id: 'SOAR_ENABLE',
      label: 'Is the soaring mode enabled or not',
      description: 'Toggles the soaring mode on and off.',
      category: 'soaring',
      minimum: 0,
      maximum: 1,
      rebootRequired: true,
      notes: soaringNotes,
      options: enumOptions(ARDUPLANE_SOAR_ENABLE_LABELS)
    },
    SOAR_VSPEED: {
      id: 'SOAR_VSPEED',
      label: 'Vertical v-speed',
      description: 'Rate of climb to trigger themalling speed.',
      category: 'soaring',
      unit: 'm/s',
      minimum: 0,
      maximum: 10,
      notes: soaringNotes
    },
    SOAR_Q1: {
      id: 'SOAR_Q1',
      label: 'Process noise',
      description: 'Standard deviation of noise in process for strength.',
      category: 'soaring',
      minimum: 0.0001,
      maximum: 0.01,
      notes: soaringNotes
    },
    SOAR_Q2: {
      id: 'SOAR_Q2',
      label: 'Process noise',
      description: 'Standard deviation of noise in process for position and radius.',
      category: 'soaring',
      minimum: 0.01,
      maximum: 1,
      notes: soaringNotes
    },
    SOAR_R: {
      id: 'SOAR_R',
      label: 'Measurement noise',
      description: 'Standard deviation of noise in measurement.',
      category: 'soaring',
      minimum: 0.01,
      maximum: 1,
      notes: soaringNotes
    },
    SOAR_DIST_AHEAD: {
      id: 'SOAR_DIST_AHEAD',
      label: 'Distance to thermal center',
      description: 'Initial guess of the distance to the thermal center.',
      category: 'soaring',
      unit: 'm',
      minimum: 0,
      maximum: 100,
      notes: soaringNotes
    },
    SOAR_MIN_THML_S: {
      id: 'SOAR_MIN_THML_S',
      label: 'Minimum thermalling time',
      description: 'Minimum number of seconds to spend thermalling.',
      category: 'soaring',
      unit: 's',
      minimum: 0,
      maximum: 600,
      notes: soaringNotes
    },
    SOAR_MIN_CRSE_S: {
      id: 'SOAR_MIN_CRSE_S',
      label: 'Minimum cruising time',
      description: 'Minimum number of seconds to spend cruising.',
      category: 'soaring',
      unit: 's',
      minimum: 0,
      maximum: 600,
      notes: soaringNotes
    },
    SOAR_POLAR_CD0: {
      id: 'SOAR_POLAR_CD0',
      label: 'Zero lift drag coef.',
      description: 'Zero lift drag coefficient.',
      category: 'soaring',
      minimum: 0.005,
      maximum: 0.5,
      notes: soaringNotes
    },
    SOAR_POLAR_B: {
      id: 'SOAR_POLAR_B',
      label: 'Induced drag coeffient',
      description: 'Induced drag coeffient.',
      category: 'soaring',
      minimum: 0.005,
      maximum: 0.05,
      notes: soaringNotes
    },
    SOAR_POLAR_K: {
      id: 'SOAR_POLAR_K',
      label: 'Cl factor',
      description: 'Cl factor 2*m*g/(rho*S).',
      category: 'soaring',
      unit: 'm.m/s/s',
      minimum: 20,
      maximum: 400,
      notes: soaringNotes
    },
    SOAR_ALT_MAX: {
      id: 'SOAR_ALT_MAX',
      label: 'Maximum soaring altitude, relative to the home location',
      description: "Don't thermal any higher than this.",
      category: 'soaring',
      unit: 'm',
      minimum: 0,
      maximum: 5000,
      notes: soaringNotes
    },
    SOAR_ALT_MIN: {
      id: 'SOAR_ALT_MIN',
      label: 'Minimum soaring altitude, relative to the home location',
      description: "Don't get any lower than this.",
      category: 'soaring',
      unit: 'm',
      minimum: 0,
      maximum: 1000,
      notes: soaringNotes
    },
    SOAR_ALT_CUTOFF: {
      id: 'SOAR_ALT_CUTOFF',
      label: 'Maximum power altitude, relative to the home location',
      description: 'Cut off throttle at this alt.',
      category: 'soaring',
      unit: 'm',
      minimum: 0,
      maximum: 5000,
      notes: soaringNotes
    },
    SOAR_MAX_DRIFT: {
      id: 'SOAR_MAX_DRIFT',
      label: '(Optional) Maximum drift distance to allow when thermalling.',
      description: 'Maximum distance of drift during thermalling. Soaring will exit if this distance is exceeded. -1 disables.',
      category: 'soaring',
      minimum: -1,
      maximum: 1000,
      notes: soaringNotes
    },
    SOAR_MAX_RADIUS: {
      id: 'SOAR_MAX_RADIUS',
      label: '(Optional) Maximum distance from home',
      description: 'Maximum distance from home to allow when thermalling. RTL will be triggered when exceeded. -1 disables.',
      category: 'soaring',
      minimum: -1,
      maximum: 1000,
      notes: soaringNotes
    },
    SOAR_THML_BANK: {
      id: 'SOAR_THML_BANK',
      label: 'Thermalling bank angle',
      description: 'This parameter sets the bank angle to use when thermalling. Typically 30 - 45 degrees works well.',
      category: 'soaring',
      unit: 'deg',
      minimum: 20,
      maximum: 50,
      notes: soaringNotes
    },
    SOAR_THML_ARSPD: {
      id: 'SOAR_THML_ARSPD',
      label: 'Specific setting for airspeed when soaring in THERMAL mode.',
      description: 'If non-zero this airspeed will be used when thermalling. A value of 0 will use AIRSPEED_CRUISE.',
      category: 'soaring',
      minimum: 0,
      maximum: 50,
      notes: soaringNotes
    },
    SOAR_CRSE_ARSPD: {
      id: 'SOAR_CRSE_ARSPD',
      label: 'Specific setting for airspeed when soaring in AUTO mode.',
      description: 'If non-zero this airspeed will be used when cruising between thermals in AUTO. If set to -1, airspeed will be selected based on speed-to-fly theory. A value of 0 will use AIRSPEED_CRUISE.',
      category: 'soaring',
      minimum: -1,
      maximum: 50,
      notes: soaringNotes
    },
    SOAR_THML_FLAP: {
      id: 'SOAR_THML_FLAP',
      label: 'Flap percent to be used during thermalling flight.',
      description: 'This sets the flap when in LOITER with soaring active. Overrides the usual auto flap behaviour.',
      category: 'soaring',
      unit: '%',
      minimum: 0,
      maximum: 100,
      notes: soaringNotes
    },
    // ----------------------------------------------------------------------
    // ADS-B transponder (ADSB_*). Sourced verbatim from ArduPilot
    // libraries/AP_ADSB/AP_ADSB.cpp var_info[].
    // ----------------------------------------------------------------------
    ADSB_TYPE: {
      id: 'ADSB_TYPE',
      label: 'ADSB Type',
      description: 'Type of ADS-B hardware for ADSB-in and ADSB-out configuration and operation. If any type is selected then MAVLink based ADSB-in messages will always be enabled.',
      category: 'adsb',
      minimum: 0,
      maximum: 4,
      rebootRequired: true,
      notes: adsbNotes,
      options: enumOptions(ARDUPLANE_ADSB_TYPE_LABELS)
    },
    ADSB_LIST_MAX: {
      id: 'ADSB_LIST_MAX',
      label: 'ADSB vehicle list size',
      description: 'ADSB list size of nearest vehicles. Longer lists take longer to refresh with lower SRx_ADSB values.',
      category: 'adsb',
      minimum: 1,
      maximum: 100,
      step: 1,
      rebootRequired: true,
      notes: adsbNotes
    },
    ADSB_LIST_RADIUS: {
      id: 'ADSB_LIST_RADIUS',
      label: 'ADSB vehicle list radius filter',
      description: 'ADSB vehicle list radius filter. Vehicles detected outside this radius will be completely ignored. They will not show up in the SRx_ADSB stream to the GCS and will not be considered in any avoidance calculations. A value of 0 will disable this filter.',
      category: 'adsb',
      unit: 'm',
      minimum: 0,
      maximum: 100000,
      notes: adsbNotes
    },
    ADSB_ICAO_ID: {
      id: 'ADSB_ICAO_ID',
      label: 'ICAO_ID vehicle identification number',
      description: 'ICAO_ID unique vehicle identification number of this aircraft. This is an integer limited to 24bits. If set to 0 then one will be randomly generated. If set to -1 then static information is not sent, transceiver is assumed pre-programmed.',
      category: 'adsb',
      minimum: -1,
      maximum: 16777215,
      step: 1,
      notes: adsbNotes
    },
    ADSB_EMIT_TYPE: {
      id: 'ADSB_EMIT_TYPE',
      label: 'Emitter type',
      description: 'ADSB classification for the type of vehicle emitting the transponder signal. Default value is 14 (UAV).',
      category: 'adsb',
      minimum: 0,
      maximum: 19,
      notes: adsbNotes,
      options: enumOptions(ARDUPLANE_ADSB_EMIT_TYPE_LABELS)
    },
    ADSB_LEN_WIDTH: {
      id: 'ADSB_LEN_WIDTH',
      label: 'Aircraft length and width',
      description: 'Aircraft length and width dimension options in Length and Width in meters. In most cases use a value of 1 for smallest size.',
      category: 'adsb',
      minimum: 0,
      maximum: 15,
      notes: adsbNotes,
      options: enumOptions(ARDUPLANE_ADSB_LEN_WIDTH_LABELS)
    },
    ADSB_OFFSET_LAT: {
      id: 'ADSB_OFFSET_LAT',
      label: 'GPS antenna lateral offset',
      description: 'GPS antenna lateral offset. This describes the physical location offset from center of the GPS antenna on the aircraft.',
      category: 'adsb',
      minimum: 0,
      maximum: 7,
      notes: adsbNotes,
      options: enumOptions(ARDUPLANE_ADSB_OFFSET_LAT_LABELS)
    },
    ADSB_OFFSET_LON: {
      id: 'ADSB_OFFSET_LON',
      label: 'GPS antenna longitudinal offset',
      description: 'GPS antenna longitudinal offset. This is usually set to 1, Applied By Sensor',
      category: 'adsb',
      minimum: 0,
      maximum: 1,
      notes: adsbNotes,
      options: enumOptions(ARDUPLANE_ADSB_OFFSET_LON_LABELS)
    },
    ADSB_RF_SELECT: {
      id: 'ADSB_RF_SELECT',
      label: 'Transceiver RF selection',
      description: 'Transceiver RF selection for Rx enable and/or Tx enable. This only effects devices that can Tx and/or Rx. Rx-only devices should override this to always be Rx-only.',
      category: 'adsb',
      minimum: 0,
      maximum: 3,
      bitmask: true,
      notes: adsbNotes,
      options: enumOptions(ARDUPLANE_ADSB_RF_SELECT_BIT_LABELS)
    },
    ADSB_SQUAWK: {
      id: 'ADSB_SQUAWK',
      label: 'Squawk code',
      description: 'VFR squawk (Mode 3/A) code is a pre-programmed default code when the pilot is flying VFR and not in contact with ATC. In the USA, the VFR squawk code is octal 1200 (decimal 640) and in most parts of Europe the VFR squawk code is octal 7000. If an invalid octal number is set then it will be reset to 1200.',
      category: 'adsb',
      unit: 'octal',
      minimum: 0,
      maximum: 7777,
      notes: adsbNotes
    },
    ADSB_RF_CAPABLE: {
      id: 'ADSB_RF_CAPABLE',
      label: 'RF capabilities',
      description: 'This describes your hardware RF In/Out capabilities.',
      category: 'adsb',
      minimum: 0,
      maximum: 15,
      bitmask: true,
      notes: adsbNotes,
      options: enumOptions(ARDUPLANE_ADSB_RF_CAPABLE_BIT_LABELS)
    },
    ADSB_LIST_ALT: {
      id: 'ADSB_LIST_ALT',
      label: 'ADSB vehicle list altitude filter',
      description: 'ADSB vehicle list altitude filter. Vehicles detected above this altitude will be completely ignored. They will not show up in the SRx_ADSB stream to the GCS and will not be considered in any avoidance calculations. A value of 0 will disable this filter.',
      category: 'adsb',
      unit: 'm',
      minimum: 0,
      maximum: 32767,
      notes: adsbNotes
    },
    ADSB_OPTIONS: {
      id: 'ADSB_OPTIONS',
      label: 'ADS-B Options',
      description: 'Options for emergency failsafe codes and device capabilities',
      category: 'adsb',
      minimum: 0,
      maximum: 31,
      bitmask: true,
      notes: adsbNotes,
      options: enumOptions(ARDUPLANE_ADSB_OPTIONS_BIT_LABELS)
    },
    ADSB_LOG: {
      id: 'ADSB_LOG',
      label: 'ADS-B logging',
      description: '0: no logging, 1: log only special ID, 2:log all',
      category: 'adsb',
      minimum: 0,
      maximum: 2,
      notes: adsbNotes,
      options: enumOptions(ARDUPLANE_ADSB_LOG_LABELS)
    },
    // ----------------------------------------------------------------------
    // ADS-B traffic avoidance (AVD_*). Sourced verbatim from ArduPilot
    // libraries/AC_Avoidance/AP_Avoidance.cpp var_info[]. The distance and
    // time-horizon defaults are platform-dependent (compile-time macros) and
    // upstream documents no @Range for AVD_, so those params carry units but
    // no min/max bound.
    // ----------------------------------------------------------------------
    AVD_ENABLE: {
      id: 'AVD_ENABLE',
      label: 'Enable Avoidance using ADSB',
      description: 'Enable Avoidance using ADSB.',
      category: 'adsb',
      minimum: 0,
      maximum: 1,
      rebootRequired: true,
      notes: avoidanceNotes,
      options: enabledDisabledOptions
    },
    AVD_F_ACTION: {
      id: 'AVD_F_ACTION',
      label: 'Collision Avoidance Behavior',
      description: 'Specifies aircraft behaviour when a collision is imminent.',
      category: 'adsb',
      minimum: 0,
      maximum: 6,
      notes: avoidanceNotes,
      options: enumOptions(ARDUPLANE_AVD_F_ACTION_LABELS)
    },
    AVD_W_ACTION: {
      id: 'AVD_W_ACTION',
      label: 'Collision Avoidance Behavior - Warn',
      description: 'Specifies aircraft behaviour when a collision may occur.',
      category: 'adsb',
      minimum: 0,
      maximum: 1,
      notes: avoidanceNotes,
      options: enumOptions(ARDUPLANE_AVD_W_ACTION_LABELS)
    },
    AVD_F_RCVRY: {
      id: 'AVD_F_RCVRY',
      label: 'Recovery behaviour after a fail event',
      description: 'Determines what the aircraft will do after a fail event is resolved.',
      category: 'adsb',
      minimum: 0,
      maximum: 3,
      notes: avoidanceNotes,
      options: enumOptions(ARDUPLANE_AVD_F_RCVRY_LABELS)
    },
    AVD_OBS_MAX: {
      id: 'AVD_OBS_MAX',
      label: 'Maximum number of obstacles to track',
      description: 'Maximum number of obstacles to track.',
      category: 'adsb',
      minimum: 1,
      step: 1,
      notes: avoidanceNotes
    },
    AVD_W_TIME: {
      id: 'AVD_W_TIME',
      label: 'Time Horizon Warn',
      description: 'Aircraft velocity vectors are multiplied by this time to determine closest approach. If this results in an approach closer than W_DIST_XY or W_DIST_Z then W_ACTION is undertaken (assuming F_ACTION is not undertaken).',
      category: 'adsb',
      unit: 's',
      minimum: 0,
      notes: avoidanceNotes
    },
    AVD_F_TIME: {
      id: 'AVD_F_TIME',
      label: 'Time Horizon Fail',
      description: 'Aircraft velocity vectors are multiplied by this time to determine closest approach. If this results in an approach closer than F_DIST_XY or F_DIST_Z then F_ACTION is undertaken.',
      category: 'adsb',
      unit: 's',
      minimum: 0,
      notes: avoidanceNotes
    },
    AVD_W_DIST_XY: {
      id: 'AVD_W_DIST_XY',
      label: 'Distance Warn XY',
      description: 'Closest allowed projected distance before W_ACTION is undertaken.',
      category: 'adsb',
      unit: 'm',
      minimum: 0,
      notes: avoidanceNotes
    },
    AVD_F_DIST_XY: {
      id: 'AVD_F_DIST_XY',
      label: 'Distance Fail XY',
      description: 'Closest allowed projected distance before F_ACTION is undertaken.',
      category: 'adsb',
      unit: 'm',
      minimum: 0,
      notes: avoidanceNotes
    },
    AVD_W_DIST_Z: {
      id: 'AVD_W_DIST_Z',
      label: 'Distance Warn Z',
      description: 'Closest allowed projected distance before BEHAVIOUR_W is undertaken.',
      category: 'adsb',
      unit: 'm',
      minimum: 0,
      notes: avoidanceNotes
    },
    AVD_F_DIST_Z: {
      id: 'AVD_F_DIST_Z',
      label: 'Distance Fail Z',
      description: 'Closest allowed projected distance before BEHAVIOUR_F is undertaken.',
      category: 'adsb',
      unit: 'm',
      minimum: 0,
      notes: avoidanceNotes
    },
    AVD_F_ALT_MIN: {
      id: 'AVD_F_ALT_MIN',
      label: 'ADS-B avoidance minimum altitude',
      description: 'Minimum AMSL (above mean sea level) altitude for ADS-B avoidance. If the vehicle is below this altitude, no avoidance action will take place. Useful to prevent ADS-B avoidance from activating while below the tree line or around structures. Default of 0 is no minimum.',
      category: 'adsb',
      unit: 'm',
      minimum: 0,
      notes: avoidanceNotes
    }
  },
  setupSections: [
    {
      id: 'link',
      title: 'Vehicle Link',
      description: 'Bring the Plane online and pull the first parameter snapshot.',
      requiredParameters: [],
      actions: ['request-parameters']
    },
    {
      id: 'airframe',
      title: 'Airframe',
      description: 'Confirm Q_ENABLE for QuadPlane builds; pure fixed-wing builds can leave the QuadPlane parameters at 0.',
      requiredParameters: ['Q_ENABLE']
    },
    {
      id: 'sensors',
      title: 'Sensors',
      description: 'Verify board orientation and compass selection before tuning or arming.',
      requiredParameters: ['AHRS_ORIENTATION', 'COMPASS_USE'],
      actions: ['calibrate-accelerometer', 'calibrate-level', 'calibrate-compass']
    },
    {
      id: 'radio',
      title: 'Radio',
      description: 'Inspect primary RC input and verify the flight-mode channel.',
      requiredParameters: ['FLTMODE_CH'],
      requiredLiveSignals: ['rc-input'],
    },
    {
      id: 'outputs',
      title: 'Outputs',
      description: 'Review control-surface and propulsion output assignments before any props-on testing. Plane output mapping will be expanded in a follow-up PR.',
      requiredParameters: [],
    },
    {
      id: 'power',
      title: 'Battery',
      description: 'Validate battery monitoring before flight.',
      requiredParameters: ['BATT_MONITOR', 'BATT_CAPACITY'],
      // BATT_MONITOR=0 disables battery monitoring entirely (no voltage,
      // current, or battery failsafe). Same present-but-unset trap that
      // bit Copter — the section reading "complete" with monitoring off
      // is misleading.
      requiredNonZeroParameters: ['BATT_MONITOR'],
      requiredLiveSignals: ['battery-telemetry'],
    },
    {
      id: 'failsafe',
      title: 'Failsafe',
      description: 'Review Plane short/long failsafe and battery failsafe behavior.',
      requiredParameters: [
        'THR_FAILSAFE',
        'THR_FS_VALUE',
        'FS_SHORT_ACTN',
        'FS_LONG_ACTN',
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
      description: 'Final pre-flight review and reboot before any powered testing.',
      requiredParameters: [],
      actions: ['reboot-autopilot']
    }
  ]
}
