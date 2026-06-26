export interface HeartbeatMessage {
  type: 'HEARTBEAT'
  autopilot: number
  vehicleType: number
  baseMode: number
  customMode: number
  systemStatus: number
  mavlinkVersion: number
}

export interface ParamValueMessage {
  type: 'PARAM_VALUE'
  paramId: string
  paramValue: number
  paramType: number
  paramCount: number
  paramIndex: number
}

export interface StatusTextMessage {
  type: 'STATUSTEXT'
  severity: number
  text: string
  statusId: number
  chunkSequence: number
}

export interface RcChannelsMessage {
  type: 'RC_CHANNELS'
  timeBootMs: number
  channelCount: number
  channels: number[]
  rssi: number
}

export interface SysStatusMessage {
  type: 'SYS_STATUS'
  sensorsPresent: number
  sensorsEnabled: number
  sensorsHealth: number
  load: number
  voltageBatteryMv: number
  currentBatteryCa: number
  batteryRemaining: number
  dropRateComm: number
  errorsComm: number
  errorsCount1: number
  errorsCount2: number
  errorsCount3: number
  errorsCount4: number
  sensorsPresentExtended: number
  sensorsEnabledExtended: number
  sensorsHealthExtended: number
}

export interface GlobalPositionIntMessage {
  type: 'GLOBAL_POSITION_INT'
  timeBootMs: number
  latitudeE7: number
  longitudeE7: number
  altitudeMm: number
  relativeAltitudeMm: number
  velocityXcms: number
  velocityYcms: number
  velocityZcms: number
  headingCdeg: number
}

export interface AttitudeMessage {
  type: 'ATTITUDE'
  timeBootMs: number
  rollRad: number
  pitchRad: number
  yawRad: number
  rollSpeedRadS: number
  pitchSpeedRadS: number
  yawSpeedRadS: number
}

export interface FileTransferProtocolMessage {
  type: 'FILE_TRANSFER_PROTOCOL'
  targetNetwork: number
  targetSystem: number
  targetComponent: number
  payload: Uint8Array
}

export interface ParamRequestListMessage {
  type: 'PARAM_REQUEST_LIST'
  targetSystem: number
  targetComponent: number
}

export interface ParamSetMessage {
  type: 'PARAM_SET'
  targetSystem: number
  targetComponent: number
  paramId: string
  paramValue: number
  paramType: number
}

export interface CommandAckMessage {
  type: 'COMMAND_ACK'
  command: number
  result: number
  progress: number
  resultParam2: number
  targetSystem: number
  targetComponent: number
}

export interface CommandLongMessage {
  type: 'COMMAND_LONG'
  command: number
  targetSystem: number
  targetComponent: number
  confirmation: number
  params: [number, number, number, number, number, number, number]
}

/**
 * GCS → vehicle: inject a GPS reading over MAVLink (msgid 232). When a GPS
 * backend is set to type 14 (MAV), ArduPilot consumes this as a real GPS, which
 * lets the EKF acquire a position and complete yaw alignment with no physical
 * GPS — the prerequisite for onboard compass calibration. Streamed at a few Hz
 * for the duration of the calibration. lat/lon are degrees * 1e7.
 */
export interface GpsInputMessage {
  type: 'GPS_INPUT'
  gpsId: number
  /** GPS_INPUT_IGNORE_FLAGS bitmask for fields the autopilot should ignore. */
  ignoreFlags: number
  fixType: number
  latitudeE7: number
  longitudeE7: number
  altitudeM: number
  hdop: number
  vdop: number
  satellitesVisible: number
}

export interface AutopilotVersionMessage {
  type: 'AUTOPILOT_VERSION'
  capabilities: bigint
  flightSwVersion: number
  middlewareSwVersion: number
  osSwVersion: number
  boardVersion: number
  flightCustomVersion: Uint8Array
  middlewareCustomVersion: Uint8Array
  osCustomVersion: Uint8Array
  vendorId: number
  productId: number
  uid: bigint
  uid2?: Uint8Array
}

/** GCS → vehicle: request the list of available onboard dataflash logs. */
export interface LogRequestListMessage {
  type: 'LOG_REQUEST_LIST'
  targetSystem: number
  targetComponent: number
  /** First log id to list (0-based). */
  start: number
  /** Last log id to list (0xffff for "all"). */
  end: number
}

/** Vehicle → GCS: one onboard log's metadata. */
export interface LogEntryMessage {
  type: 'LOG_ENTRY'
  /** UTC timestamp of the log, seconds since epoch (0 if unknown). */
  timeUtc: number
  /** Log size in bytes. */
  size: number
  /** Log id. */
  id: number
  /** Total number of logs present. */
  numLogs: number
  /** Highest log id present. */
  lastLogNum: number
}

/** GCS → vehicle: request a byte range of a specific log. */
export interface LogRequestDataMessage {
  type: 'LOG_REQUEST_DATA'
  targetSystem: number
  targetComponent: number
  /** Log id to read. */
  id: number
  /** Byte offset into the log. */
  ofs: number
  /** Number of bytes to read (0xffffffff for "to the end"). */
  count: number
}

/** Vehicle → GCS: a chunk of log bytes (up to 90 bytes per frame). */
export interface LogDataMessage {
  type: 'LOG_DATA'
  /** Log id this chunk belongs to. */
  id: number
  /** Byte offset of this chunk within the log. */
  ofs: number
  /** Number of valid bytes in {@link LogDataMessage.data}. */
  count: number
  /** The chunk payload (length 90; only the first `count` bytes are valid). */
  data: Uint8Array
}

/** GCS → vehicle: stop streaming log data and resume normal operation. */
export interface LogRequestEndMessage {
  type: 'LOG_REQUEST_END'
  targetSystem: number
  targetComponent: number
}

/** Vehicle → GCS: onboard magnetometer-calibration progress. */
export interface MagCalProgressMessage {
  type: 'MAG_CAL_PROGRESS'
  /** Compass being calibrated (0-based). */
  compassId: number
  /** Bitmask of compasses being calibrated. */
  calMask: number
  /** MAG_CAL_STATUS enum (e.g. 1 RUNNING_STEP_ONE, 2 RUNNING_STEP_TWO). */
  calStatus: number
  /** Attempt number. */
  attempt: number
  /** Completion percentage 0..100. */
  completionPct: number
  /** Bitmask of sphere sections seen (10 bytes / 80 sections). */
  completionMask: Uint8Array
  /** Body-frame direction the vehicle should be rotated toward. */
  directionX: number
  directionY: number
  directionZ: number
}

/** Vehicle → GCS: onboard magnetometer-calibration result. */
export interface MagCalReportMessage {
  type: 'MAG_CAL_REPORT'
  compassId: number
  calMask: number
  /** MAG_CAL_STATUS — 4 SUCCESS, 5 FAILED, 6 BAD_ORIENTATION. */
  calStatus: number
  /** 1 if the result was auto-saved to parameters. */
  autosaved: number
  fitness: number
  ofsX: number
  ofsY: number
  ofsZ: number
  diagX: number
  diagY: number
  diagZ: number
  offdiagX: number
  offdiagY: number
  offdiagZ: number
  /** MAVLink extension fields (0 when the autopilot omits them). */
  orientationConfidence: number
  oldOrientation: number
  newOrientation: number
  scaleFactor: number
}

export interface OpticalFlowMessage {
  type: 'OPTICAL_FLOW'
  /** Timestamp (UNIX epoch microseconds or microseconds since system boot). */
  timeUsec: bigint
  /** Optical flow sensor index (FCs that wire two flow sensors emit one
   * stream per sensor with distinct IDs). */
  sensorId: number
  /** Raw flow in sensor X direction (dpix = decipixels / framerate). */
  flowX: number
  /** Raw flow in sensor Y direction (dpix). */
  flowY: number
  /** Angular-speed-compensated flow in metres per second, X axis. */
  flowCompMx: number
  /** Angular-speed-compensated flow in metres per second, Y axis. */
  flowCompMy: number
  /** Reported ground distance in metres; negative = unknown. */
  groundDistance: number
  /** 0 = bad, 255 = max-quality optical flow track. */
  quality: number
  /** Flow rate about the X axis (rad/s); 0 when the extension fields are
   * omitted by an older sender. */
  flowRateX: number
  /** Flow rate about the Y axis (rad/s); 0 when the extension fields are
   * omitted by an older sender. */
  flowRateY: number
}

export interface UavcanNodeStatusMessage {
  type: 'UAVCAN_NODE_STATUS'
  /** Timestamp (UNIX epoch microseconds or microseconds since system boot). */
  timeUsec: bigint
  /** Time since node start-up, in seconds. */
  uptimeSec: number
  /** UAVCAN_NODE_HEALTH — 0 OK, 1 WARNING, 2 ERROR, 3 CRITICAL. */
  health: number
  /** UAVCAN_NODE_MODE — 0 OPERATIONAL, 1 INITIALIZATION, 2 MAINTENANCE, 3 SOFTWARE_UPDATE, 7 OFFLINE. */
  mode: number
  /** Vendor-defined sub-mode (currently unused per the MAVLink spec). */
  subMode: number
  /** Vendor-specific status code, opaque to the bridge. */
  vendorSpecificStatusCode: number
}

export interface UavcanNodeInfoMessage {
  type: 'UAVCAN_NODE_INFO'
  /** Timestamp (UNIX epoch microseconds or microseconds since system boot). */
  timeUsec: bigint
  /** Time since node start-up, in seconds. */
  uptimeSec: number
  /** UTF-8 node name string (e.g. "org.cubepilot.here3"); truncated to 80 chars by the bridge. */
  name: string
  hwVersionMajor: number
  hwVersionMinor: number
  /** 16-byte hardware UID. */
  hwUniqueId: Uint8Array
  swVersionMajor: number
  swVersionMinor: number
  /** Software VCS revision identifier (e.g. git short commit hash); 0 when unknown. */
  swVcsCommit: number
}

// Raw CAN frame forwarded by the autopilot via MAV_CMD_CAN_FORWARD.
// MAVLink stays alive on the same channel — Mission Planner uses this
// exact mechanism for its DroneCAN inspector. The frame's `id` is the
// raw 29-bit extended CAN ID; downstream DroneCAN code in this repo
// peels the source node, message/service type, and tail byte out of
// the payload bytes.
export interface CanFrameMessage {
  type: 'CAN_FRAME'
  /** GCS target system, preserved from the MAVLink envelope. */
  targetSystem: number
  /** GCS target component, preserved from the MAVLink envelope. */
  targetComponent: number
  /** ArduPilot CAN port: 1 = CAN1, 2 = CAN2. */
  bus: number
  /** Useful payload length, 0..8. Bytes beyond this index in data[]
   * are zero-padded. */
  len: number
  /** 29-bit extended CAN frame ID (DroneCAN always uses extended). */
  id: number
  /** Up to 8 bytes of frame payload (the high bytes are zero-padded). */
  data: Uint8Array
}

/**
 * GCS → vehicle: provision a MAVLink2 signing key (msgid 256). Sent only
 * over a trusted/direct link (USB or wired). A secret_key of all zeros with
 * a zero initial_timestamp disables signing on the target, per the MAVLink
 * spec. Wire byte order (size-sorted): initial_timestamp(uint64),
 * target_system(uint8), target_component(uint8), secret_key[32].
 */
export interface SetupSigningMessage {
  type: 'SETUP_SIGNING'
  targetSystem: number
  targetComponent: number
  /** 32-byte shared secret. */
  secretKey: Uint8Array
  /**
   * Initial timestamp the vehicle should seed its RX replay window with,
   * in 10-microsecond units since 2015-01-01 UTC (same epoch the codec
   * uses for outbound frame timestamps).
   */
  initialTimestamp: bigint
}

export type MavlinkMessage =
  | HeartbeatMessage
  | RcChannelsMessage
  | SysStatusMessage
  | OpticalFlowMessage
  | CanFrameMessage
  | GlobalPositionIntMessage
  | AttitudeMessage
  | FileTransferProtocolMessage
  | ParamValueMessage
  | StatusTextMessage
  | ParamRequestListMessage
  | ParamSetMessage
  | CommandAckMessage
  | CommandLongMessage
  | GpsInputMessage
  | AutopilotVersionMessage
  | LogRequestListMessage
  | LogEntryMessage
  | LogRequestDataMessage
  | LogDataMessage
  | LogRequestEndMessage
  | MagCalProgressMessage
  | MagCalReportMessage
  | UavcanNodeStatusMessage
  | UavcanNodeInfoMessage
  | SetupSigningMessage

export interface MavlinkEnvelope {
  header: {
    systemId: number
    componentId: number
    sequence: number
  }
  message: MavlinkMessage
  timestampMs?: number
}
