import type { GuidedActionId, LiveSignalId, ParameterDefinition, SetupSectionDefinition } from '@arduconfig/param-metadata'
import type { TransportStatus } from '@arduconfig/transport'

export type SetupStatus = 'attention' | 'in-progress' | 'complete'
export type ParameterSyncStatus = 'idle' | 'awaiting-vehicle' | 'requesting' | 'streaming' | 'complete'
export type GuidedActionStatus = 'idle' | 'requested' | 'running' | 'succeeded' | 'failed'
export type MotorTestStatus = 'idle' | 'requested' | 'running' | 'succeeded' | 'failed'

/**
 * MAV_STATE decoded into a stable, operator-readable label.
 * 'unknown' covers codes outside the documented range so
 * a malformed / future enum value doesn't get silently dropped or
 * misread as a known state.
 */
export type VehicleSystemStatus =
  | 'uninit'
  | 'boot'
  | 'calibrating'
  | 'standby'
  | 'active'
  | 'critical'
  | 'emergency'
  | 'poweroff'
  | 'flight-termination'
  | 'unknown'

export interface VehicleIdentity {
  firmware: 'ArduPilot' | 'Unknown'
  vehicle: 'ArduCopter' | 'ArduPlane' | 'ArduRover' | 'ArduSub' | 'Unknown'
  systemId: number
  componentId: number
  armed: boolean
  flightMode: string
  /**
   * Decoded HEARTBEAT.system_status. Surfaces CRITICAL / EMERGENCY /
   * FLIGHT_TERMINATION states the operator must see, which require the
   * safety-critical half of the MAV_STATE enum to be decoded.
   */
  systemStatus: VehicleSystemStatus
}

export interface HardwareBoardState {
  boardVersion: number
  boardType: number
  vendorId: number
  productId: number
  uid?: string
  ftpSupported: boolean
  /** Decoded flight firmware version, e.g. "4.5.3 (official)", from
   *  AUTOPILOT_VERSION.flight_sw_version. Undefined until that arrives. */
  firmwareVersion?: string
  /** Parsed major/minor/patch of the flight firmware version, for version
   *  gating (e.g. 4.6 vs 4.7 param divergence). Undefined until reported. */
  firmwareVersionParts?: { major: number; minor: number; patch: number }
  /** Firmware build git hash (ASCII) from flight_custom_version, if any. */
  firmwareGitHash?: string
  /**
   * The board's own name from the boot banner, e.g. "BROTHERHOBBYH743".
   *
   * The firmware's answer, as opposed to boardType looked up in our own table —
   * a board we have not catalogued has a name here and only a number there.
   */
  reportedBoardName?: string
  /**
   * Full firmware string from the banner, e.g. "ArduCopter V4.7.0-beta7-SFD".
   * Keeps the fork/vendor suffix the decoded version discards.
   */
  reportedFirmwareString?: string
  lastUpdatedAtMs: number
}

export interface BoardSerialPortMapping {
  serialPortNumber: number
  hardwarePort: string
  txActive: boolean
  rxActive: boolean
  txBytes?: number
  rxBytes?: number
  txBufferDrops?: number
  rxBufferDrops?: number
}

export type BoardFileStatus = 'idle' | 'loading' | 'ready' | 'unsupported' | 'missing' | 'error'

export interface BoardFileState {
  status: BoardFileStatus
  path: string
  mappings: BoardSerialPortMapping[]
  rawText?: string
  /**
   * The body of the PREVIOUS fetch, kept so per-port counters can be
   * differenced over a known window.
   *
   * @SYS/uarts.txt mixes units: RX/TX are "the change since last call"
   * (AP_HAL/UARTDriver.h StatsTracker) while FE/OE/NE are cumulative since
   * boot. Anything comparing errors to bytes needs two samples to put both on
   * the same footing; with one sample the error ratio is meaningless and
   * swings with how much traffic happened to arrive between reads.
   */
  previousRawText?: string
  error?: string
  fetchedAtMs?: number
  /** When the sample now in `previousRawText` was taken. */
  previousFetchedAtMs?: number
}

export interface HardwareState {
  board?: HardwareBoardState
  uartsFile: BoardFileState
  /**
   * Number of physical PWM outputs the autopilot exposes — parsed from the
   * boot banner "RCOut: PWM:1-N" STATUSTEXT. ArduPilot always allocates
   * SERVOn_FUNCTION params up to MAX_SERVO (typically 16), but only the
   * channels listed here are wired to actual hardware on this board. The
   * Outputs overview surfaces this number so the operator can tell which
   * SERVOn slots correspond to real PWM pins. Undefined until the boot
   * banner arrives (early after connect, or after a reboot).
   */
  pwmOutputCount?: number
}

export interface StatusTextEntry {
  severity: 'info' | 'warning' | 'error'
  text: string
  /**
   * Wall-clock receipt time (ms since epoch). Used to correlate a recent
   * STATUSTEXT with a command-ACK rejection that arrived alongside it.
   * Optional for backward compatibility with consumers that predate it.
   */
  receivedAtMs?: number
}

export interface PreArmIssueState {
  text: string
  severity: StatusTextEntry['severity']
  firstSeenAtMs: number
  lastSeenAtMs: number
}

/**
 * The live pre-arm verdict carried by SYS_STATUS's MAV_SYS_STATUS_PREARM_CHECK
 * bit (0x10000000), which is the ONLY signal that tells us pre-arm checks have
 * started passing again. STATUSTEXT can't: ArduPilot re-emits a *failing*
 * pre-arm reason at most every PREARM_DISPLAY_PERIOD (30 s,
 * libraries/AP_Arming/AP_Arming.cpp) and emits nothing at all on the
 * fail→pass transition, so a text-only view stays wrong for up to a minute.
 *
 * The bit is refreshed every time AP_Arming::update() re-runs the checks (1 Hz)
 * via AP_Notify::flags.pre_arm_check, and GCS.cpp folds it into every
 * SYS_STATUS (libraries/GCS_MAVLink/GCS.cpp, "give GCS status of prearm
 * checks"). We already request SYS_STATUS at 2 Hz, so this resolves in ~0.5 s.
 */
export interface PreArmLiveCheckState {
  /** MAV_SYS_STATUS_PREARM_CHECK set in `sensorsPresent` — firmware reports it at all. */
  present: boolean
  /**
   * Set in `sensorsEnabled`, which ArduPilot only does when
   * `AP::arming().get_enabled_checks()` is non-zero. With ARMING_CHECK=0 the
   * health bit is meaningless, so the verdict is not usable.
   */
  enabled: boolean
  /**
   * Health bit — checks currently pass (or the vehicle is armed, which implies
   * they did). Only meaningful when `present && enabled`.
   */
  passing: boolean
  /** When the SYS_STATUS carrying this verdict arrived (ms since epoch). */
  lastSeenAtMs: number
}

export interface PreArmStatusState {
  healthy: boolean
  issues: PreArmIssueState[]
  lastUpdatedAtMs?: number
  /**
   * Present only while a fresh SYS_STATUS verdict is in hand. When it is
   * usable it — not the latched issue list — decides `healthy`, because the
   * issue texts are a log of what was last *reported*, not of what is still
   * true. Absent on firmware that doesn't report the bit, with checks
   * disabled, or when SYS_STATUS has gone quiet.
   */
  liveCheck?: PreArmLiveCheckState
}

export interface ParameterState {
  id: string
  value: number
  index: number
  count: number
  /**
   * MAV_PARAM_TYPE reported by the FC in PARAM_VALUE. The parameter
   * protocol requires PARAM_SET to echo this exact type back; undefined
   * only when the value was never streamed (PARAM_SET then falls back to
   * REAL32, ArduPilot's universal on-wire encoding).
   */
  paramType?: number
  definition?: ParameterDefinition
  /**
   * Set on alias-mirror entries: mirrors a real arrival's value/index/count
   * under a renamed counterpart id so lookups via either name resolve.
   * Holds the on-wire id the FC actually streamed; consumers iterating all
   * params check it to skip mirrors. Undefined on real arrivals.
   */
  aliasedFrom?: string
}

export interface ParameterWriteOptions {
  verifyTimeoutMs?: number
  tolerance?: number
}

export interface ParameterWriteRequest {
  paramId: string
  paramValue: number
}

export interface ParameterWriteResult {
  paramId: string
  previousValue?: number
  requestedValue: number
  confirmedValue: number
  confirmedAtMs: number
}

/**
 * A staged write that was SENT but whose verified read-back never matched the
 * requested value before the timeout — while the link stayed alive (other
 * writes in the same batch kept succeeding). This is the signature of a
 * firmware-managed / live value the FC re-derives (e.g. BAROn_GND_PRESS) or a
 * value the FC silently clamped/rejected: it can never be confirmed, so the
 * batch records it and moves on instead of rolling back the verified writes.
 */
export interface ParameterUnconfirmedWrite {
  paramId: string
  requestedValue: number
  reason: string
}

export interface ParameterBatchWriteResult {
  applied: ParameterWriteResult[]
  rolledBack: ParameterWriteResult[]
  /** Sent-but-unverifiable writes (link alive); see ParameterUnconfirmedWrite. */
  unconfirmed: ParameterUnconfirmedWrite[]
}

/**
 * Progress callback payload for a batch parameter write. Emitted once per
 * processed request (including no-op writes that were already at the target
 * value) so the UI can show "Applying… (N/M)" instead of a frozen "Applying…"
 * while a large show-all → write-all batch grinds through one verified write
 * at a time.
 */
export interface ParameterBatchWriteProgress {
  /** Number of requests processed so far (1-based, includes skips). */
  completed: number
  /** Total number of requests in the batch. */
  total: number
  /** The parameter id that was just processed. */
  paramId: string
}

export interface ParameterSyncState {
  status: ParameterSyncStatus
  downloaded: number
  total: number
  duplicateFrames: number
  progress: number | null
  targetSystemId?: number
  targetComponentId?: number
  requestedAtMs?: number
  completedAtMs?: number
}

export interface GuidedActionState {
  actionId: GuidedActionId
  status: GuidedActionStatus
  summary: string
  instructions: string[]
  statusTexts: string[]
  ctaLabel?: string
  /**
   * 0–100 progress for actions that stream it (currently onboard mag cal
   * via MAG_CAL_PROGRESS). Undefined when the action does not report a
   * percentage; consumers should only surface a bar while `status` is
   * `running`.
   */
  progressPct?: number
  startedAtMs?: number
  updatedAtMs?: number
  completedAtMs?: number
}

export interface RcInputState {
  verified: boolean
  channelCount: number
  channels: number[]
  rssi?: number
  lastSeenAtMs?: number
}

export interface BatteryTelemetryState {
  /** Pack VOLTAGE is being reported (SYS_STATUS voltage above 1 V). */
  verified: boolean
  /**
   * Pack CURRENT is being reported, independently of the voltage.
   *
   * The two are separate sensors and separate SYS_STATUS fields. An analog
   * current sensor reads its own offset with no pack attached at all, which is
   * exactly the reading the current calibration's zero step needs -- gating it
   * on pack voltage made "unplug the pack" and "read the current" mutually
   * exclusive.
   */
  currentVerified: boolean
  voltageMv?: number
  voltageV?: number
  currentA?: number
  remainingPercent?: number
  lastSeenAtMs?: number
}

export interface AttitudeTelemetryState {
  verified: boolean
  rollDeg?: number
  pitchDeg?: number
  yawDeg?: number
  /**
   * Attitude quaternion (w, x, y, z) straight from ATTITUDE_QUATERNION — the
   * body→NED rotation, free of the Euler singularity near ±90° pitch. Present
   * only once that message has been received; the craft view prefers it over
   * the Euler angles for orientation.
   */
  quaternion?: { w: number; x: number; y: number; z: number }
  lastSeenAtMs?: number
}

/**
 * GPS receiver state from GPS_RAW_INT — "is a module actually talking?", which
 * is a different question from "do we have a position". A GPS with swapped
 * TX/RX (or landed on I2C pins) never produces this at all, while a healthy
 * GPS indoors produces it continuously with fixType 0/1 and few satellites.
 * Reporting only the position state conflated the two and showed a
 * never-connected GPS as "configured".
 */
export interface GpsReceiverState {
  /** True once any GPS_RAW_INT has arrived — the module is talking. */
  detected: boolean
  /** MAV_GPS_FIX_TYPE: 0 no GPS, 1 no fix, 2 = 2D, 3 = 3D, 4+ augmented. */
  fixType?: number
  satellitesVisible?: number
  lastSeenAtMs?: number
}

/**
 * Live output PWM, from SERVO_OUTPUT_RAW.
 *
 * `pwm` is indexed 0-based for SERVO1..SERVOn. A value of 0 means the output
 * is not being driven, which is a real answer and distinct from "no such
 * output" — the vehicle zero-fills the extension fields it does not use.
 */
export interface ServoOutputsState {
  /** True once any SERVO_OUTPUT_RAW has arrived this session. */
  detected: boolean
  /** PWM microseconds per output, index 0 = SERVO1. */
  pwm: number[]
  /** Most recent arrival, for a staleness indicator. */
  lastSeenAtMs?: number
}

export interface GlobalPositionTelemetryState {
  verified: boolean
  latitudeDeg?: number
  longitudeDeg?: number
  altitudeM?: number
  relativeAltitudeM?: number
  groundSpeedMs?: number
  headingDeg?: number
  lastSeenAtMs?: number
}

/**
 * Barometer state from the SYS_STATUS sensor bitmask
 * (`MAV_SYS_STATUS_SENSOR_ABSOLUTE_PRESSURE`). This is streamed ~1 Hz
 * independent of GPS/EKF, so it reflects a bench FC truthfully — unlike
 * `GLOBAL_POSITION_INT` altitude, which ArduPilot withholds until the
 * EKF has a position solution.
 */
export interface BaroSensorState {
  /** present && healthy — the FC has a working sensor right now. */
  verified: boolean
  /** A driver is bound (sensor advertised as present in SYS_STATUS). */
  present: boolean
  /** The bound sensor is reading sanely (SYS_STATUS health bit). */
  healthy: boolean
  lastSeenAtMs?: number
}

/**
 * Any hardware sensor's state derived from the `SYS_STATUS`
 * onboard-control-sensors bitmask (streamed ~1 Hz, independent of
 * GPS/EKF). Shares the baro state shape; reused for gyro/accel so a
 * present+healthy IMU is not mis-shown as absent just because the
 * derived `ATTITUDE`/AHRS stream lagged.
 */
export type SensorBitState = BaroSensorState

export interface LiveVerificationState {
  satisfiedSignals: LiveSignalId[]
  rcInput: RcInputState
  batteryTelemetry: BatteryTelemetryState
  attitudeTelemetry: AttitudeTelemetryState
  /** Primary IMU temperature (°C) from SCALED_IMU — for the thermal-calibration
   *  (TCAL) live readout. undefined until a reading arrives. */
  imuTemperatureC?: number
  /**
   * What each output is being driven to right now, from SERVO_OUTPUT_RAW.
   *
   * SERVOn_FUNCTION says what an output is FOR and the min/trim/max say what
   * it may do; neither says what it IS doing. This is the only thing that
   * does, which is what makes it the readout you want when a surface will not
   * move and the configuration looks fine.
   */
  servoOutputs: ServoOutputsState
  globalPosition: GlobalPositionTelemetryState
  gpsReceiver: GpsReceiverState
  baroSensor: BaroSensorState
  /** 3D gyro present/health from SYS_STATUS. */
  gyroSensor: SensorBitState
  /** 3D accel present/health from SYS_STATUS. */
  accelSensor: SensorBitState
  /**
   * 3D mag present/health from SYS_STATUS. Used ONLY to
   * augment the Mag header chip (active on param-enabled OR this) — the
   * compass-calibration / Setup gating still keys on the param-derived
   * enabled-compass count and is unchanged.
   */
  magSensor: SensorBitState
  /**
   * GPS present/health from the EKF-independent SYS_STATUS bitmask
   * (MAV_SYS_STATUS_SENSOR_GPS). A DroneCAN GPS with GPS_TYPE=0 (FC
   * autoselect) and no satellite fix indoors reports present+enabled
   * here even though GLOBAL_POSITION_INT is withheld and GPS_TYPE
   * reads 0 — so this is the truthful "is a GPS configured" signal,
   * mirroring the baro/gyro/accel/mag chips.
   */
  gpsSensor: SensorBitState
  /**
   * True while the configurator is STREAMING A SYNTHETIC GPS (GPS_INPUT) at a
   * fixed operator-chosen location, for compass calibration without a physical
   * GPS.
   *
   * In the snapshot, not just behind runtime.isFakeGpsActive(), because while it
   * runs the Status card and flight deck show a 3D fix with satellites at a
   * place the vehicle is not — and nothing snapshot-driven could render a
   * warning reactively, so the fabrication was indistinguishable from a real
   * fix if the component that started it unmounted or the page reloaded.
   */
  fakeGpsActive: boolean
  /**
   * Optical flow sensor liveness AND its last reading, derived from
   * OPTICAL_FLOW (msgid 100). The "pulse on the sensor" check drives the
   * header Flow chip; the flow rates / ground distance are what the
   * Status & Info card actually prints, because "configured" and "healthy"
   * are adjectives an operator cannot act on — a number they can watch
   * change while they wave a hand under the craft is.
   *
   * Still no EKF-innovation processing: that lives on the autopilot and
   * the GCS has no business recomputing it.
   */
  opticalFlow: OpticalFlowSensorState
  /**
   * Downward rangefinder liveness AND its last reading, derived from
   * DISTANCE_SENSOR (msgid 132). See RangefinderSensorState for why that
   * message and not RANGEFINDER (msgid 173).
   */
  rangefinder: RangefinderSensorState
  /**
   * Per-ESC telemetry, keyed by ESC number as an operator counts them
   * (1-based), derived from ESC_TELEMETRY_1_TO_4 / _5_TO_8 / _9_TO_12.
   * Empty when the vehicle has never reported any — which, per
   * EscTelemetryMessage, means it genuinely has none rather than that we are
   * still waiting.
   */
  escTelemetry: EscTelemetryState
}

/**
 * ESC telemetry as the Motor Test tab consumes it.
 *
 * `everReported` exists to separate the two states an operator has to act on
 * differently: "this vehicle does not send ESC telemetry at all" (no
 * bidirectional DShot, no telemetry wire — a setup problem) versus "it did,
 * and has gone quiet" (a wiring or ESC fault). Both look like an empty table.
 */
export interface EscTelemetryState {
  /** True once any ESC_TELEMETRY message has arrived this session. */
  everReported: boolean
  /** Most recent arrival of any ESC_TELEMETRY message. */
  lastSeenAtMs?: number
  /** One entry per ESC that has reported, ordered by ESC number. */
  escs: EscTelemetryReading[]
}

export interface EscTelemetryReading {
  /** 1-based ESC number, matching how the Motor Test tab labels motors. */
  escNumber: number
  /** When this specific ESC last appeared in a message. Per-ESC rather than
   * per-message because ArduPilot skips an all-stale group of four, so one
   * dead ESC in a group of live ones still ages out on its own. */
  lastSeenAtMs: number
  /** Mechanical RPM, already divided by SERVO_BLH_POLES on the vehicle. */
  rpm: number
  /** Volts, converted from the wire's centivolts. */
  voltageV: number
  /** Amps, converted from the wire's centiamps. */
  currentA: number
  /** Consumed capacity, mAh. */
  consumedMah: number
  temperatureC: number
  /** Telemetry packets the FC has received from this ESC; wraps at 65535.
   * A count that never moves means the ESC slot is being reported but the
   * ESC itself is not answering. */
  count: number
}

export interface OpticalFlowSensorState {
  /** True once an OPTICAL_FLOW message has ever arrived. Deliberately NOT
   * self-expiring: consumers compare `lastSeenAtMs` against their own
   * freshness window, and the sticky flag is what lets the UI tell
   * "reported, then went silent" apart from "never reported at all" —
   * two different faults with the same live symptom. */
  verified: boolean
  lastSeenAtMs?: number
  /** Sensor ID from the most recent OPTICAL_FLOW message; FCs with a
   * single flow sensor will always report 0 here. */
  sensorId?: number
  /** Quality 0..255 from the most recent OPTICAL_FLOW message. 0 = bad
   * track (sensor present but no usable optical features), 255 = max. */
  quality?: number
  /** Flow rate about the sensor X axis, rad/s (OPTICAL_FLOW extension). */
  flowRateX?: number
  /** Flow rate about the sensor Y axis, rad/s (OPTICAL_FLOW extension). */
  flowRateY?: number
  /** Ground distance (HAGL) the FC attached to the flow report, metres.
   * ArduPilot sends 0 when AHRS has no HAGL estimate, and the MAVLink spec
   * reserves negative for "unknown" — so this is context, never a
   * substitute for the rangefinder card's own reading. */
  groundDistanceM?: number
}

/**
 * Latest DISTANCE_SENSOR (msgid 132) reading for the primary rangefinder.
 *
 * Why DISTANCE_SENSOR and not RANGEFINDER (msgid 173), from
 * libraries/GCS_MAVLink/GCS_Common.cpp:
 *   - `send_distance_sensor()` walks every rangefinder backend and returns
 *     early on `!sensor->has_data()`. So a lidar that is configured but not
 *     actually talking emits NOTHING, which makes silence a truthful fault
 *     signal. `send_rangefinder()` has no such guard and will happily keep
 *     publishing a stale distance for a dead sensor.
 *   - DISTANCE_SENSOR carries signal_quality, min/max range, orientation and
 *     an instance id. RANGEFINDER carries distance + voltage only.
 *   - DISTANCE_SENSOR is a member of STREAM_EXTRA3
 *     (GCS_MAVLink_Parameters.cpp); RANGEFINDER is in no stream group at all
 *     and is additionally compiled out unless
 *     AP_MAVLINK_MSG_RANGEFINDER_SENDING_ENABLED.
 * Both still require an explicit SET_MESSAGE_INTERVAL from us — see
 * LIVE_TELEMETRY_REQUESTS in runtime.ts.
 */
export interface RangefinderSensorState {
  /** True once a DISTANCE_SENSOR for a rangefinder instance has ever
   * arrived. Sticky for the same reason as OpticalFlowSensorState.verified. */
  verified: boolean
  lastSeenAtMs?: number
  /** Onboard sensor id (== backend instance; 0 is RNGFND1). */
  sensorId?: number
  /** The live reading in metres — the headline number on the card. */
  distanceM?: number
  /** Configured measurable range in metres (RNGFNDn_MIN / _MAX), so the UI
   * can say "1.42 m of 0.20–7.00 m" instead of an unanchored figure. */
  minDistanceM?: number
  maxDistanceM?: number
  /** MAV_SENSOR_ORIENTATION; 25 = ROTATION_PITCH_270 = downward. */
  orientation?: number
  /** MAV_DISTANCE_SENSOR type (0 laser, 1 ultrasound, 2 infrared, 3 radar). */
  sensorType?: number
  /** Raw signal_quality with ArduPilot's sentinels intact: 0 = the driver
   * does not report quality, 1 = invalid signal, 2..100 = percent. The UI
   * must branch on these rather than printing "0%". */
  signalQuality?: number
}

export interface MotorTestState {
  status: MotorTestStatus
  summary: string
  instructions: string[]
  allOutputsSelected?: boolean
  /** All motors spinning at the SAME time (vs allOutputsSelected = one at
   *  a time in sequence). Drives completion timing (concurrent, not
   *  per-motor) and the summary copy. */
  simultaneousOutputs?: boolean
  selectedOutputChannel?: number
  selectedOutputCount?: number
  selectedMotorNumber?: number
  throttlePercent?: number
  durationSeconds?: number
  startedAtMs?: number
  updatedAtMs?: number
  completedAtMs?: number
}

/**
 * Outcome of an operator-initiated motor-test abort. Callers that chain
 * another spin behind the stop (the guided-identify advance) MUST NOT
 * start the next motor unless the abort was acknowledged — an unACKed
 * stop means we have no evidence the previous motor was commanded down,
 * and a fresh DO_MOTOR_TEST would then be racing an unknown FC state.
 */
export interface MotorTestStopResult {
  /** True when an abort command was actually put on the wire. False when
   *  there was no active test to stop (nothing to prove, nothing racing). */
  sent: boolean
  /** True when the autopilot COMMAND_ACKed the zero-throttle abort. Always
   *  true when `sent` is false, so `sent && !acknowledged` is the single
   *  "the stop is unproven" condition. */
  acknowledged: boolean
}

export interface MotorTestRequest {
  outputChannel?: number
  /** Spin every mapped motor ONE AT A TIME in test-order sequence. */
  runAllOutputs?: boolean
  /** Spin every mapped motor SIMULTANEOUSLY (Mission Planner's "Test all
   *  motors"): one DO_MOTOR_TEST per motor fired back-to-back. ArduPilot's
   *  _output_test_seq writes only the matching motor and never zeroes the
   *  others, so each motor keeps spinning until the shared timeout — they
   *  run together. Mutually exclusive with runAllOutputs. */
  runAllOutputsSimultaneous?: boolean
  throttlePercent: number
  durationSeconds: number
}

export interface SetupSectionState {
  id: string
  title: string
  description: string
  status: SetupStatus
  notes: string[]
  actions: GuidedActionId[]
  definition: SetupSectionDefinition
  parameters: ParameterState[]
}

export type CanNodeHealth = 'ok' | 'warning' | 'error' | 'critical' | 'unknown'

export type CanNodeMode =
  | 'operational'
  | 'initialization'
  | 'maintenance'
  | 'software_update'
  | 'offline'
  | 'unknown'

// A peripheral discovered on the autopilot's DroneCAN bus, seen via the
// MAVLink-UAVCAN bridge as a sibling MAVLink component (component_id ==
// UAVCAN node_id). Populated from UAVCAN_NODE_STATUS (310) for liveness
// and UAVCAN_NODE_INFO (311) for identity. Phase 1 surfaces nodes as
// read-only peripherals; per-node parameters are a later phase.
export interface CanNodeState {
  /** MAVLink component_id, which the bridge keeps equal to the UAVCAN node_id. */
  componentId: number
  /** Node name from UAVCAN_NODE_INFO; undefined until that message arrives (the
   * bridge emits it on discovery and reboot, and on explicit request). */
  name?: string
  health: CanNodeHealth
  mode: CanNodeMode
  /** Seconds since node start-up, from the most recent UAVCAN_NODE_STATUS. */
  uptimeSec?: number
  /** Vendor-defined status code from UAVCAN_NODE_STATUS, opaque to the bridge. */
  vendorStatusCode?: number
  /** Hex string of the 16-byte hardware unique ID. */
  hwUniqueId?: string
  hwVersion?: { major: number; minor: number }
  swVersion?: { major: number; minor: number; vcsCommit: number }
  /** Source of the freshest signal — full UAVCAN status, or fallback heartbeat. */
  lastSeenSource: 'uavcan-node-status' | 'heartbeat'
  firstSeenAtMs: number
  lastSeenAtMs: number
}

// CAN tab state. Populated only while the configurator has asked the
// autopilot to forward CAN traffic via MAV_CMD_CAN_FORWARD. Outside of
// the active session this stays in `idle`.

export type CanBusStatus = 'idle' | 'requesting' | 'active' | 'stopping' | 'error'

export interface DronecanParamValueState {
  tag: 'empty' | 'int64' | 'real32' | 'bool' | 'string'
  int64?: string  // serialized bigint (snapshot is JSON-safe)
  real32?: number
  bool?: boolean
  string?: string
}

export interface DronecanParamEntry {
  index: number
  name: string
  value: DronecanParamValueState
  defaultValue?: DronecanParamValueState
  minValue?: DronecanParamValueState
  maxValue?: DronecanParamValueState
  lastFetchedAtMs: number
}

export type DronecanParamFetchStatus = 'idle' | 'fetching' | 'complete' | 'stalled'

export interface DronecanInspectedNode {
  nodeId: number
  /** Set from UAVCAN_NODE_STATUS (DT 341) — same tag set as CanNodeState. */
  health: CanNodeHealth
  mode: CanNodeMode
  subMode?: number
  uptimeSec?: number
  vendorStatusCode?: number
  /** Set from a successful GetNodeInfo response (service 1). */
  name?: string
  hwVersion?: { major: number; minor: number }
  swVersion?: { major: number; minor: number; vcsCommit: number; imageCrc?: string }
  hwUniqueId?: string  // hex
  parameters: DronecanParamEntry[]
  paramFetch: {
    status: DronecanParamFetchStatus
    nextIndex: number
    lastAttemptAtMs?: number
    error?: string
  }
  firstSeenAtMs: number
  lastSeenAtMs: number
}

// Latest observed uavcan.equipment.esc.Status (DT 1034) for one ESC, keyed by
// its esc_index. Observe-only telemetry surfaced in the CAN tab;
// values are snapshot-safe numbers (NaN is normalized to undefined so the
// JSON snapshot round-trips and the UI can show "—" for unreported fields).
export interface DronecanEscTelemetry {
  /** Zero-based ESC index (the cmd[] slot in RawCommand). */
  escIndex: number
  /** DroneCAN node id that broadcast this Status. */
  nodeId: number
  rpm: number
  /** Volts; undefined when the node sent NaN. */
  voltage?: number
  /** Amps (negative under regen braking); undefined when NaN. */
  current?: number
  /** Degrees Celsius (converted from the wire's Kelvin); undefined when NaN. */
  temperatureC?: number
  /** Raw temperature in Kelvin; undefined when NaN. */
  temperatureK?: number
  errorCount: number
  powerRatingPct: number
  lastSeenAtMs: number
}

// Live state of a DroneCAN node firmware update (the GCS acts as the file
// server over the CAN_FORWARD tunnel: it sends BeginFirmwareUpdate, then
// answers the node's file.Read requests with chunks of the selected image).
// Only one update runs at a time. Snapshot-safe (all plain numbers/strings).
export type DronecanFirmwareUpdateStatus = 'starting' | 'in_progress' | 'completed' | 'error'

export interface DronecanFirmwareUpdateState {
  /** Node being updated. */
  nodeId: number
  /** Display name of the selected image file. */
  fileName: string
  /** Total bytes in the selected image. */
  fileSize: number
  /** High-water mark of bytes served to the node (progress = served / size). */
  bytesServed: number
  status: DronecanFirmwareUpdateStatus
  /** Set when status === 'error'; also used to carry the success note. */
  error?: string
  startedAtMs: number
  /** Last time the node read a chunk or the begin request was (re)sent. */
  updatedAtMs: number
}

export interface CanBusState {
  status: CanBusStatus
  /** Active bus index when status === 'active'. */
  bus?: number
  /** In-flight (or just-finished) DroneCAN node firmware update, if any. */
  firmwareUpdate?: DronecanFirmwareUpdateState
  /** Sticky error message after a refused start/stop. Cleared on retry. */
  error?: string
  /** Count of CAN_FRAME messages observed in this session. UI uses it as
   *  a "bus is alive" cue when zero nodes have been discovered yet. */
  framesReceived: number
  lastFrameAtMs?: number
  nodes: DronecanInspectedNode[]
  /** Latest ESC telemetry per esc_index (uavcan.equipment.esc.Status). */
  escTelemetry: DronecanEscTelemetry[]
}

/**
 * What is left on screen after the link goes away. The parameter table is kept
 * (a board that watchdog-resets would otherwise blank the whole app every few
 * seconds, and the values are still the last truth we had), but it is NOT live
 * — every consumer that can act on the vehicle stays gated on
 * `connection.kind === 'connected'`, and the UI must say plainly that what is
 * shown is a snapshot of a link that has dropped.
 */
export interface StaleLinkState {
  /** When the link dropped. */
  sinceMs: number
  /** Identity of the vehicle the retained values came from. */
  vehicle?: VehicleIdentity
  /** Parameters actually received before the drop, and the FC-reported total. */
  downloaded: number
  total: number
}

/** One flight mode as the vehicle itself describes it. */
export interface AvailableFlightMode {
  /** The number written into FLTMODEn. */
  customMode: number
  /** Name as the firmware spells it, e.g. "Fiber". */
  name: string
  /** MAV_STANDARD_MODE, 0 when flight-stack specific. */
  standardMode: number
  /** MAV_MODE_PROPERTY bits. */
  properties: number
}

export interface ConfiguratorSnapshot {
  connection: TransportStatus
  vehicle?: VehicleIdentity
  hardware: HardwareState
  /**
   * Present only while showing retained values from a dropped link. Absent
   * whenever the data on screen is live (or there is nothing to show).
   */
  staleLink?: StaleLinkState
  /**
   * Flight modes the connected vehicle reports it has (AVAILABLE_MODES).
   *
   * Empty when the firmware does not answer — callers fall back to the static
   * per-vehicle mode table. Non-empty, this is authoritative: it is the only
   * source that knows about a fork's custom modes or a Lua-registered one.
   */
  availableModes: AvailableFlightMode[]
  parameterStats: {
    downloaded: number
    total: number
    duplicateFrames: number
    status: ParameterSyncStatus
    progress: number | null
    requestedAtMs?: number
    completedAtMs?: number
  }
  parameters: ParameterState[]
  setupSections: SetupSectionState[]
  guidedActions: Record<GuidedActionId, GuidedActionState>
  motorTest: MotorTestState
  liveVerification: LiveVerificationState
  preArmStatus: PreArmStatusState
  statusTexts: StatusTextEntry[]
  canNodes: CanNodeState[]
  canBus: CanBusState
}
