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
  error?: string
  fetchedAtMs?: number
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

export interface PreArmStatusState {
  healthy: boolean
  issues: PreArmIssueState[]
  lastUpdatedAtMs?: number
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

export interface ParameterBatchWriteResult {
  applied: ParameterWriteResult[]
  rolledBack: ParameterWriteResult[]
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
  verified: boolean
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
  globalPosition: GlobalPositionTelemetryState
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
   * Optical flow sensor liveness, derived from OPTICAL_FLOW (msgid 100).
   * Phase 1 surfaces only a "pulse on the sensor" check — was a flow
   * message recently received — plus the most recent quality / sensor ID.
   * No flow-rate processing; that lives in the EKF on the autopilot side
   * and the GCS does not need to recompute it.
   */
  opticalFlow: OpticalFlowSensorState
}

export interface OpticalFlowSensorState {
  /** True iff an OPTICAL_FLOW message has arrived within the freshness
   * window (Phase 1: 2s). Drives the header "Flow" chip. */
  verified: boolean
  lastSeenAtMs?: number
  /** Sensor ID from the most recent OPTICAL_FLOW message; FCs with a
   * single flow sensor will always report 0 here. */
  sensorId?: number
  /** Quality 0..255 from the most recent OPTICAL_FLOW message. 0 = bad
   * track (sensor present but no usable optical features), 255 = max. */
  quality?: number
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
// its esc_index. Observe-only telemetry surfaced in the DroneCAN Inspector;
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

export interface ConfiguratorSnapshot {
  connection: TransportStatus
  vehicle?: VehicleIdentity
  hardware: HardwareState
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
