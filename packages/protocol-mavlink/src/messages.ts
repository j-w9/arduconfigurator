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

/**
 * What the flight controller is actually driving each output to.
 *
 * The point of having it: SERVOn_FUNCTION says what an output is FOR, and the
 * trim/min/max say what it is allowed to do, but neither says what it is doing
 * right now. Only this does, which is what makes it the message you want when
 * a surface is not moving and nothing in the configuration looks wrong.
 *
 * `servos` is 1-based by index (servos[0] is SERVO1). Outputs 9-16 are MAVLink
 * extension fields, so a vehicle that sends only the first eight is decoded
 * normally and simply reports eight — hence the length, rather than a fixed 16.
 */
export interface ServoOutputRawMessage {
  type: 'SERVO_OUTPUT_RAW'
  /** Microseconds since boot. uint32 here, NOT the uint64 most messages use. */
  timeUsec: number
  /** Output bank: 0 for servos 1-8, 1 for 9-16. */
  port: number
  /** PWM microseconds per output, in channel order. */
  servos: number[]
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

/**
 * GPS_RAW_INT (msgid 24) — the RAW receiver report, decoded for the fields that
 * answer "is a GPS actually talking to the FC?": fix type and satellite count.
 *
 * GLOBAL_POSITION_INT alone cannot answer that. It only appears once the EKF
 * has a position, so a correctly-wired GPS sitting indoors without a fix looks
 * identical to a GPS that was never wired up at all — which is how a miswired
 * unit (TX/RX swapped, or landed on I2C pins) read as "configured" in the UI.
 * GPS_RAW_INT arrives as soon as the driver is talking to a module, fix or no
 * fix, so the two cases finally separate.
 *
 * Base payload only (30 bytes); the v2 extension fields (alt_ellipsoid,
 * h/v/vel/hdg accuracy, yaw) are on the wire but not decoded.
 */
export interface GpsRawIntMessage {
  type: 'GPS_RAW_INT'
  timeUsec: number
  fixType: number
  latitudeE7: number
  longitudeE7: number
  altitudeMm: number
  eph: number
  epv: number
  vel: number
  cog: number
  satellitesVisible: number
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

/**
 * Scaled IMU (msgid 26) — we decode only the fields we use: the boot timestamp
 * and the IMU temperature (0.01 °C). Streamed for the thermal-calibration (TCAL)
 * live-temperature readout. Acc/gyro/mag are present on the wire but not decoded.
 */
export interface ScaledImuMessage {
  type: 'SCALED_IMU'
  timeBootMs: number
  /** IMU temperature in centidegrees Celsius; 0 = not reported. */
  temperatureCdeg: number
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

/**
 * Vehicle attitude as a quaternion (msgid 31) — the same attitude as ATTITUDE
 * but without the Euler singularity near ±90° pitch. q is (w, x, y, z), the
 * rotation from the body frame to the NED earth frame (1,0,0,0 = level).
 */
export interface AttitudeQuaternionMessage {
  type: 'ATTITUDE_QUATERNION'
  timeBootMs: number
  qw: number
  qx: number
  qy: number
  qz: number
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

export interface ParamRequestReadMessage {
  type: 'PARAM_REQUEST_READ'
  targetSystem: number
  targetComponent: number
  // Reading by index (paramIndex >= 0) leaves paramId empty; reading by name
  // sets paramIndex to -1 and populates paramId. The parameter-sync gap-fill
  // uses the by-index form to refetch exactly the indices a lossy stream dropped.
  paramId: string
  paramIndex: number
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

/**
 * GCS → vehicle: erase every dataflash log on the card.
 *
 * Irreversible, and the vehicle acknowledges nothing — AP_Logger just starts
 * erasing. Callers have to treat "sent" as the whole story and re-list to see
 * the result.
 */
export interface LogEraseMessage {
  type: 'LOG_ERASE'
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

/**
 * DISTANCE_SENSOR (msgid 132) — one message per rangefinder instance.
 *
 * ArduPilot emits this from `GCS_MAVLINK::send_distance_sensor()`
 * (libraries/GCS_MAVLink/GCS_Common.cpp), which iterates every rangefinder
 * backend and skips any whose `has_data()` is false. That skip is the whole
 * reason this message — rather than RANGEFINDER (msgid 173) — is the one we
 * decode: a configured-but-not-talking lidar produces NO DISTANCE_SENSOR at
 * all, so silence is a truthful "wired wrong / broken" signal. RANGEFINDER
 * has no such guard, carries no signal-quality field, and only ever covers
 * the single ROTATION_PITCH_270 instance.
 *
 * Proximity backends share the message: AP_Proximity sends its sectors with
 * `id >= PROXIMITY_SENSOR_ID_START` (10, AP_Proximity.h), which is how a
 * consumer separates real rangefinder instances (id == instance, 0..9) from
 * 360° proximity sectors.
 */
export interface DistanceSensorMessage {
  type: 'DISTANCE_SENSOR'
  /** Milliseconds since vehicle boot. */
  timeBootMs: number
  /** Minimum measurable distance, centimetres (RNGFNDn_MIN × 100). */
  minDistanceCm: number
  /** Maximum measurable distance, centimetres (RNGFNDn_MAX × 100). */
  maxDistanceCm: number
  /** The live reading, centimetres. This is the number the operator wants. */
  currentDistanceCm: number
  /** MAV_DISTANCE_SENSOR enum (0 laser, 1 ultrasound, 2 infrared, 3 radar). */
  sensorType: number
  /** Onboard sensor ID. For rangefinders this equals the backend instance
   * (0 = RNGFND1); values >= 10 are AP_Proximity sectors, not rangefinders. */
  id: number
  /** MAV_SENSOR_ORIENTATION; 25 = ROTATION_PITCH_270 = downward-facing. */
  orientation: number
  /** Measurement variance in cm²; 0 = unknown. */
  covariance: number
  /** Horizontal field of view (rad); 0 when unknown. Extension field. */
  horizontalFov: number
  /** Vertical field of view (rad); 0 when unknown. Extension field. */
  verticalFov: number
  /**
   * Signal quality as a percentage, with two reserved sentinels that
   * ArduPilot sets deliberately (GCS_Common.cpp): 0 = unknown/unset (the
   * driver does not report quality at all), 1 = invalid signal, 2..100 =
   * a real quality percentage. Extension field, so it is 0 on a truncated
   * payload too — which is why "0" must never be rendered as "0% quality".
   */
  signalQuality: number
}

/**
 * ESC_TELEMETRY_1_TO_4 / _5_TO_8 / _9_TO_12 (ardupilotmega.xml 11030-11032).
 *
 * One message per group of four ESCs, all three sharing an identical 44-byte
 * layout (the C library even static_asserts that). `groupStartIndex` carries
 * which group arrived so a consumer can map slot -> ESC number without
 * re-deriving it from the message id.
 *
 * Two ArduPilot behaviours make absence meaningful rather than ambiguous, and
 * both are why the UI can honestly say "no data" instead of "waiting":
 *
 *  - AP_ESC_Telem::send_esc_telemetry_mavlink returns immediately when
 *    `_have_data` is false, i.e. the vehicle has never received ESC telemetry
 *    in this boot. No bidirectional DShot and no telemetry wire means no
 *    messages at all, ever.
 *  - Within a send, any group of four whose entries are all stale is skipped.
 *
 * `rpm` is real RPM, not eRPM, despite the XML's "RPM (eRPM)" wording: the
 * value comes from AP_ESC_Telem::get_rpm(), which has already divided the
 * ESC's electrical RPM by SERVO_BLH_POLES (AP_BLHeli.cpp:1544). A wrong pole
 * count therefore shows up here as an RPM wrong by exactly that factor.
 */
/**
 * One entry of the vehicle's own flight-mode list (AVAILABLE_MODES).
 *
 * The point of consuming this is that a static table can only ever describe the
 * firmware it was written against. A fork with an extra mode, or a Lua script
 * that registers one, is invisible to a hardcoded map — the operator sees a
 * bare number, or nothing at all, in a mode dropdown. Here the vehicle names
 * its own modes, so whatever it can actually fly is what gets offered.
 */
export interface AvailableModeMessage {
  type: 'AVAILABLE_MODE'
  /** How many modes the vehicle will send in total, from the same message. */
  numberModes: number
  /** 1-based position in that list. */
  modeIndex: number
  /** MAV_STANDARD_MODE, or 0 when the mode is flight-stack specific. */
  standardMode: number
  /** The number written into FLTMODEn — 31 for a fork's Fiber, say. */
  customMode: number
  /** MAV_MODE_PROPERTY bits (e.g. advanced / not-user-selectable). */
  properties: number
  /** Human name as the firmware spells it, e.g. "Fiber", "VALT Hold". */
  name: string
}

/**
 * Sequence counter for the mode list. The vehicle bumps it whenever its modes
 * change, so a cached enumeration can be invalidated without re-reading it.
 */
export interface AvailableModesMonitorMessage {
  type: 'AVAILABLE_MODES_MONITOR'
  sequence: number
}

export interface EscTelemetryMessage {
  type: 'ESC_TELEMETRY'
  /**
   * Zero-based index of the first ESC in this group: 0 for _1_TO_4, 4 for
   * _5_TO_8, 8 for _9_TO_12. Slot j in the arrays below is ESC number
   * groupStartIndex + j + 1 as an operator counts them.
   *
   * Note this is before SERVO_ESC_TELEM_OFFSET (AP_ESC_Telem.cpp:39), which
   * lets an operator re-number high outputs down for GCS display.
   */
  groupStartIndex: number
  /** Per-ESC temperature in whole degrees C. */
  temperatureC: readonly number[]
  /** Per-ESC voltage in centivolts (cV) as sent — divide by 100 for volts. */
  voltageCv: readonly number[]
  /** Per-ESC current in centiamps (cA) as sent — divide by 100 for amps. */
  currentCa: readonly number[]
  /** Per-ESC consumed capacity, mAh. */
  totalCurrentMah: readonly number[]
  /** Per-ESC mechanical RPM (already pole-corrected by the firmware). */
  rpm: readonly number[]
  /** Per-ESC count of telemetry packets received; wraps at 65535. */
  count: readonly number[]
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
  | ServoOutputRawMessage
  | SysStatusMessage
  | OpticalFlowMessage
  | DistanceSensorMessage
  | AvailableModeMessage
  | AvailableModesMonitorMessage
  | EscTelemetryMessage
  | CanFrameMessage
  | GpsRawIntMessage
  | GlobalPositionIntMessage
  | AttitudeMessage
  | ScaledImuMessage
  | AttitudeQuaternionMessage
  | FileTransferProtocolMessage
  | ParamValueMessage
  | ParamRequestReadMessage
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
  | LogEraseMessage
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
  /**
   * On-the-wire frame size in bytes (header + payload + checksum + any
   * signature), set by the v2 codec on decode. Optional so non-v2 / stub
   * codecs (and hand-built envelopes in tests) need not populate it; the
   * MAVLink inspector reads it for per-source bandwidth accounting.
   */
  byteLength?: number
}
