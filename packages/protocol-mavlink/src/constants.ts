export const MAVLINK_V2_STX = 0xfd
export const MAVLINK_V2_HEADER_LENGTH = 10
export const MAVLINK_V2_CHECKSUM_LENGTH = 2
export const MAVLINK_V2_SIGNATURE_LENGTH = 13
export const MAVLINK_V2_INCOMPAT_FLAG_SIGNED = 0x01

export const MAVLINK_MESSAGE_IDS = {
  HEARTBEAT: 0,
  SYS_STATUS: 1,
  OPTICAL_FLOW: 100,
  DISTANCE_SENSOR: 132,
  CAN_FRAME: 386,
  CANFD_FRAME: 387,
  GPS_RAW_INT: 24,
  GLOBAL_POSITION_INT: 33,
  PARAM_REQUEST_READ: 20,
  PARAM_REQUEST_LIST: 21,
  PARAM_VALUE: 22,
  PARAM_SET: 23,
  ATTITUDE: 30,
  ATTITUDE_QUATERNION: 31,
  SCALED_IMU: 26,
  RC_CHANNELS: 65,
  FILE_TRANSFER_PROTOCOL: 110,
  COMMAND_ACK: 77,
  COMMAND_LONG: 76,
  AUTOPILOT_VERSION: 148,
  STATUSTEXT: 253,
  LOG_REQUEST_LIST: 117,
  LOG_ENTRY: 118,
  LOG_REQUEST_DATA: 119,
  LOG_DATA: 120,
  LOG_REQUEST_END: 122,
  MAG_CAL_PROGRESS: 191,
  MAG_CAL_REPORT: 192,
  UAVCAN_NODE_STATUS: 310,
  UAVCAN_NODE_INFO: 311,
  SETUP_SIGNING: 256,
  GPS_INPUT: 232,
  // ESC telemetry, four ESCs per message (ardupilotmega.xml 11030-11032).
  // ArduPilot sends nothing at all until it has had ESC data at least once
  // (AP_ESC_Telem::send_esc_telemetry_mavlink returns early on !_have_data),
  // and skips any group of four whose entries are all stale — so absence is a
  // truthful "no ESC telemetry", not a dropped frame.
  ESC_TELEMETRY_1_TO_4: 11030,
  ESC_TELEMETRY_5_TO_8: 11031,
  ESC_TELEMETRY_9_TO_12: 11032,
  // Mode enumeration. Lets a GCS learn the modes a build actually has —
  // including fork-custom and Lua-scripted ones — by name and number, instead
  // of matching against a hardcoded table that can only ever know upstream's.
  AVAILABLE_MODES: 435,
  // Bumped by the vehicle when its mode list changes, so a cached enumeration
  // can be invalidated without polling the list itself.
  AVAILABLE_MODES_MONITOR: 437
} as const

export const MAVLINK_MESSAGE_CRCS: Record<number, number> = {
  [MAVLINK_MESSAGE_IDS.HEARTBEAT]: 50,
  [MAVLINK_MESSAGE_IDS.SYS_STATUS]: 124,
  [MAVLINK_MESSAGE_IDS.OPTICAL_FLOW]: 175,
  // crc_extra 85 (c_library_v2 mavlink_msg_distance_sensor.h:
  // MAVLINK_MSG_ID_DISTANCE_SENSOR_CRC 85). Decode-only — nothing in the
  // configurator ever sends a DISTANCE_SENSOR to the vehicle; the encoder
  // exists purely so the mock scenario can play one back.
  [MAVLINK_MESSAGE_IDS.DISTANCE_SENSOR]: 85,
  [MAVLINK_MESSAGE_IDS.CAN_FRAME]: 132,
  [MAVLINK_MESSAGE_IDS.CANFD_FRAME]: 4,
  [MAVLINK_MESSAGE_IDS.GPS_RAW_INT]: 24,
  [MAVLINK_MESSAGE_IDS.GLOBAL_POSITION_INT]: 104,
  // crc_extra 214 (c_library_v2 mavlink_msg_param_request_read.h).
  [MAVLINK_MESSAGE_IDS.PARAM_REQUEST_READ]: 214,
  [MAVLINK_MESSAGE_IDS.PARAM_REQUEST_LIST]: 159,
  [MAVLINK_MESSAGE_IDS.PARAM_VALUE]: 220,
  [MAVLINK_MESSAGE_IDS.PARAM_SET]: 168,
  [MAVLINK_MESSAGE_IDS.ATTITUDE]: 39,
  // crc_extra 246 (c_library_v2 mavlink_msg_attitude_quaternion.h).
  [MAVLINK_MESSAGE_IDS.ATTITUDE_QUATERNION]: 246,
  // crc_extra 170 (pymavlink ardupilotmega SCALED_IMU) — decode-only, for IMU temp.
  [MAVLINK_MESSAGE_IDS.SCALED_IMU]: 170,
  [MAVLINK_MESSAGE_IDS.RC_CHANNELS]: 118,
  [MAVLINK_MESSAGE_IDS.FILE_TRANSFER_PROTOCOL]: 84,
  [MAVLINK_MESSAGE_IDS.COMMAND_ACK]: 143,
  [MAVLINK_MESSAGE_IDS.COMMAND_LONG]: 152,
  [MAVLINK_MESSAGE_IDS.AUTOPILOT_VERSION]: 178,
  [MAVLINK_MESSAGE_IDS.STATUSTEXT]: 83,
  [MAVLINK_MESSAGE_IDS.LOG_REQUEST_LIST]: 128,
  [MAVLINK_MESSAGE_IDS.LOG_ENTRY]: 56,
  [MAVLINK_MESSAGE_IDS.LOG_REQUEST_DATA]: 116,
  [MAVLINK_MESSAGE_IDS.LOG_DATA]: 134,
  [MAVLINK_MESSAGE_IDS.LOG_REQUEST_END]: 203,
  [MAVLINK_MESSAGE_IDS.MAG_CAL_PROGRESS]: 92,
  [MAVLINK_MESSAGE_IDS.MAG_CAL_REPORT]: 36,
  [MAVLINK_MESSAGE_IDS.UAVCAN_NODE_STATUS]: 28,
  [MAVLINK_MESSAGE_IDS.UAVCAN_NODE_INFO]: 95,
  // crc_extra from the MAVLink common dialect (c_library_v2
  // mavlink_msg_setup_signing.h: MAVLINK_MSG_ID_SETUP_SIGNING_CRC 71).
  [MAVLINK_MESSAGE_IDS.SETUP_SIGNING]: 71,
  // crc_extra 151 (c_library_v2 mavlink_msg_gps_input.h).
  [MAVLINK_MESSAGE_IDS.GPS_INPUT]: 151,
  // The three ESC_TELEMETRY messages share a payload layout but NOT a
  // crc_extra — it is derived from the message name, which differs. Values
  // read from the generated ardupilotmega headers
  // (MAVLINK_MSG_ID_ESC_TELEMETRY_*_CRC), not computed here.
  [MAVLINK_MESSAGE_IDS.ESC_TELEMETRY_1_TO_4]: 144,
  [MAVLINK_MESSAGE_IDS.ESC_TELEMETRY_5_TO_8]: 133,
  [MAVLINK_MESSAGE_IDS.ESC_TELEMETRY_9_TO_12]: 85,
  // crc_extra from the generated development-dialect headers
  // (MAVLINK_MSG_ID_AVAILABLE_MODES_CRC / _MONITOR_CRC), not computed here.
  [MAVLINK_MESSAGE_IDS.AVAILABLE_MODES]: 134,
  [MAVLINK_MESSAGE_IDS.AVAILABLE_MODES_MONITOR]: 30
}

export const MAVLINK_PAYLOAD_LENGTHS: Record<number, number> = {
  [MAVLINK_MESSAGE_IDS.HEARTBEAT]: 9,
  [MAVLINK_MESSAGE_IDS.SYS_STATUS]: 43,
  [MAVLINK_MESSAGE_IDS.OPTICAL_FLOW]: 34,
  // time_boot_ms(4) + min/max/current_distance(3×2=6) + type(1) + id(1) +
  // orientation(1) + covariance(1) + horizontal_fov(4) + vertical_fov(4) +
  // quaternion[4](16) + signal_quality(1) = 39 (MAVLINK_MSG_ID_DISTANCE_SENSOR_LEN).
  [MAVLINK_MESSAGE_IDS.DISTANCE_SENSOR]: 39,
  [MAVLINK_MESSAGE_IDS.CAN_FRAME]: 16,
  [MAVLINK_MESSAGE_IDS.CANFD_FRAME]: 72,
  [MAVLINK_MESSAGE_IDS.GPS_RAW_INT]: 30,
  [MAVLINK_MESSAGE_IDS.GLOBAL_POSITION_INT]: 28,
  // param_index(2) + target_system(1) + target_component(1) + param_id[16] = 20.
  [MAVLINK_MESSAGE_IDS.PARAM_REQUEST_READ]: 20,
  [MAVLINK_MESSAGE_IDS.PARAM_REQUEST_LIST]: 2,
  [MAVLINK_MESSAGE_IDS.PARAM_VALUE]: 25,
  [MAVLINK_MESSAGE_IDS.PARAM_SET]: 23,
  [MAVLINK_MESSAGE_IDS.ATTITUDE]: 28,
  // time_boot_ms(4) + q1..q4(16) + rollspeed/pitchspeed/yawspeed(12) = 32.
  [MAVLINK_MESSAGE_IDS.ATTITUDE_QUATERNION]: 32,
  // time_boot_ms(4) + xacc..zmag(9×2=18) + temperature(2) = 24.
  [MAVLINK_MESSAGE_IDS.SCALED_IMU]: 24,
  [MAVLINK_MESSAGE_IDS.RC_CHANNELS]: 42,
  [MAVLINK_MESSAGE_IDS.FILE_TRANSFER_PROTOCOL]: 254,
  [MAVLINK_MESSAGE_IDS.COMMAND_ACK]: 10,
  [MAVLINK_MESSAGE_IDS.COMMAND_LONG]: 33,
  [MAVLINK_MESSAGE_IDS.AUTOPILOT_VERSION]: 78,
  [MAVLINK_MESSAGE_IDS.STATUSTEXT]: 54,
  [MAVLINK_MESSAGE_IDS.LOG_REQUEST_LIST]: 6,
  [MAVLINK_MESSAGE_IDS.LOG_ENTRY]: 14,
  [MAVLINK_MESSAGE_IDS.LOG_REQUEST_DATA]: 12,
  [MAVLINK_MESSAGE_IDS.LOG_DATA]: 97,
  [MAVLINK_MESSAGE_IDS.LOG_REQUEST_END]: 2,
  [MAVLINK_MESSAGE_IDS.MAG_CAL_PROGRESS]: 27,
  [MAVLINK_MESSAGE_IDS.MAG_CAL_REPORT]: 54,
  [MAVLINK_MESSAGE_IDS.UAVCAN_NODE_STATUS]: 17,
  [MAVLINK_MESSAGE_IDS.UAVCAN_NODE_INFO]: 116,
  // initial_timestamp(8) + target_system(1) + target_component(1) + secret_key(32)
  [MAVLINK_MESSAGE_IDS.SETUP_SIGNING]: 42,
  // GPS_INPUT without the yaw extension: 63 bytes (see encodeGpsInputPayload).
  [MAVLINK_MESSAGE_IDS.GPS_INPUT]: 63,
  // voltage/current/totalcurrent/rpm/count (5 x uint16[4] = 40) +
  // temperature (uint8[4] = 4) = 44. No extension fields, so MIN_LEN == LEN.
  [MAVLINK_MESSAGE_IDS.ESC_TELEMETRY_1_TO_4]: 44,
  [MAVLINK_MESSAGE_IDS.ESC_TELEMETRY_5_TO_8]: 44,
  [MAVLINK_MESSAGE_IDS.ESC_TELEMETRY_9_TO_12]: 44,
  // custom_mode(4) + properties(4) + number_modes(1) + mode_index(1) +
  // standard_mode(1) + mode_name(35) = 46. No extension fields.
  [MAVLINK_MESSAGE_IDS.AVAILABLE_MODES]: 46,
  [MAVLINK_MESSAGE_IDS.AVAILABLE_MODES_MONITOR]: 1
}

export const MAVLINK_MIN_PAYLOAD_LENGTHS: Record<number, number> = {
  [MAVLINK_MESSAGE_IDS.HEARTBEAT]: 9,
  [MAVLINK_MESSAGE_IDS.SYS_STATUS]: 31,
  [MAVLINK_MESSAGE_IDS.OPTICAL_FLOW]: 26,
  // MAVLINK_MSG_ID_DISTANCE_SENSOR_MIN_LEN = 14: everything from
  // horizontal_fov onwards (incl. signal_quality) is a v2 extension field.
  // ArduPilot's own send truncates trailing zeros, so a downward lidar with
  // no FOV, no quaternion and signal_quality 0 arrives as a 14-byte payload —
  // requiring more here would drop exactly the frames we care about.
  [MAVLINK_MESSAGE_IDS.DISTANCE_SENSOR]: 14,
  [MAVLINK_MESSAGE_IDS.CAN_FRAME]: 16,
  [MAVLINK_MESSAGE_IDS.CANFD_FRAME]: 72,
  [MAVLINK_MESSAGE_IDS.GLOBAL_POSITION_INT]: 28,
  [MAVLINK_MESSAGE_IDS.PARAM_REQUEST_READ]: 20,
  [MAVLINK_MESSAGE_IDS.PARAM_REQUEST_LIST]: 2,
  [MAVLINK_MESSAGE_IDS.PARAM_VALUE]: 25,
  [MAVLINK_MESSAGE_IDS.PARAM_SET]: 23,
  [MAVLINK_MESSAGE_IDS.ATTITUDE]: 28,
  // time_boot_ms(4) + q1..q4(16) + rollspeed/pitchspeed/yawspeed(12) = 32.
  [MAVLINK_MESSAGE_IDS.ATTITUDE_QUATERNION]: 32,
  // time_boot_ms(4) + xacc..zmag(9×2=18) = 22. `temperature` is a v2 extension
  // field, excluded from the min length (ArduPilot: SCALED_IMU_MIN_LEN = 22) — a
  // sender may truncate it when zero, so the min must not require it.
  [MAVLINK_MESSAGE_IDS.SCALED_IMU]: 22,
  [MAVLINK_MESSAGE_IDS.RC_CHANNELS]: 42,
  [MAVLINK_MESSAGE_IDS.FILE_TRANSFER_PROTOCOL]: 254,
  [MAVLINK_MESSAGE_IDS.COMMAND_ACK]: 3,
  [MAVLINK_MESSAGE_IDS.COMMAND_LONG]: 33,
  [MAVLINK_MESSAGE_IDS.AUTOPILOT_VERSION]: 60,
  [MAVLINK_MESSAGE_IDS.STATUSTEXT]: 51,
  [MAVLINK_MESSAGE_IDS.LOG_REQUEST_LIST]: 6,
  [MAVLINK_MESSAGE_IDS.LOG_ENTRY]: 14,
  [MAVLINK_MESSAGE_IDS.LOG_REQUEST_DATA]: 12,
  [MAVLINK_MESSAGE_IDS.LOG_DATA]: 97,
  [MAVLINK_MESSAGE_IDS.LOG_REQUEST_END]: 2,
  [MAVLINK_MESSAGE_IDS.MAG_CAL_PROGRESS]: 27,
  [MAVLINK_MESSAGE_IDS.MAG_CAL_REPORT]: 44,
  [MAVLINK_MESSAGE_IDS.UAVCAN_NODE_STATUS]: 17,
  [MAVLINK_MESSAGE_IDS.UAVCAN_NODE_INFO]: 116,
  [MAVLINK_MESSAGE_IDS.SETUP_SIGNING]: 42,
  [MAVLINK_MESSAGE_IDS.GPS_INPUT]: 63,
  [MAVLINK_MESSAGE_IDS.ESC_TELEMETRY_1_TO_4]: 44,
  [MAVLINK_MESSAGE_IDS.ESC_TELEMETRY_5_TO_8]: 44,
  [MAVLINK_MESSAGE_IDS.ESC_TELEMETRY_9_TO_12]: 44,
  [MAVLINK_MESSAGE_IDS.AVAILABLE_MODES]: 46,
  [MAVLINK_MESSAGE_IDS.AVAILABLE_MODES_MONITOR]: 1
}

export const MAVLINK_PROTOCOL_VERSION = 3

export const MAV_AUTOPILOT = {
  ARDUPILOTMEGA: 3,
  INVALID: 8
} as const

export const MAV_TYPE = {
  GENERIC: 0,
  FIXED_WING: 1,
  QUADROTOR: 2,
  // Coaxial helicopter — an ArduCopter airframe class.
  COAXIAL: 3,
  HELICOPTER: 4,
  // Antenna tracker — ANTENNA_TRACKER firmware (common.xml). Not yet
  // wired into vehicle classification.
  ANTENNA_TRACKER: 5,
  // Ground control station — the configurator's own type in the outbound
  // GCS HEARTBEAT broadcast (minimal.xml MAV_TYPE_GCS = 6). Never expected
  // inbound from an FC.
  GCS: 6,
  // Airship — ArduBlimp firmware. Not yet wired into classification.
  AIRSHIP: 7,
  // ArduRover reports GROUND_ROVER (land) or SURFACE_BOAT (water);
  // ArduSub reports SUBMARINE.
  GROUND_ROVER: 10,
  SURFACE_BOAT: 11,
  SUBMARINE: 12,
  HEXAROTOR: 13,
  OCTOROTOR: 14,
  TRICOPTER: 15,
  // VTOL / QuadPlane family. ArduPlane's HEARTBEAT.type comes solely from
  // the user-settable Q_MAV_TYPE parameter (QuadPlane::get_mav_type(),
  // ArduPlane/quadplane.cpp): FIXED_WING when Q_MAV_TYPE=0 (the default),
  // else the raw value — not auto-derived from the airframe.
  VTOL_TAILSITTER_DUOROTOR: 19,
  VTOL_TAILSITTER_QUADROTOR: 20,
  VTOL_TILTROTOR: 21,
  VTOL_FIXEDROTOR: 22,
  VTOL_TAILSITTER: 23,
  VTOL_TILTWING: 24,
  VTOL_RESERVED5: 25,
  // 12-rotor — an ArduCopter airframe class.
  DODECAROTOR: 29,
  // 10-rotor — an ArduCopter airframe class.
  DECAROTOR: 35
} as const

export const MAV_MODE_FLAG = {
  CUSTOM_MODE_ENABLED: 1,
  SAFETY_ARMED: 128
} as const

// MAV_STATE — system health enum from HEARTBEAT.system_status
// (full enum per MAVLink common.xml).
export const MAV_STATE = {
  UNINIT: 0,
  BOOT: 1,
  CALIBRATING: 2,
  STANDBY: 3,
  ACTIVE: 4,
  CRITICAL: 5,
  EMERGENCY: 6,
  POWEROFF: 7,
  FLIGHT_TERMINATION: 8
} as const

export const MAV_SEVERITY = {
  EMERGENCY: 0,
  ALERT: 1,
  CRITICAL: 2,
  ERROR: 3,
  WARNING: 4,
  NOTICE: 5,
  INFO: 6,
  DEBUG: 7
} as const

export const MAV_PARAM_TYPE = {
  UINT8: 1,
  INT8: 2,
  UINT16: 3,
  INT16: 4,
  UINT32: 5,
  INT32: 6,
  UINT64: 7,
  INT64: 8,
  REAL32: 9,
  REAL64: 10
} as const

export const MAV_CMD = {
  DO_SET_MODE: 176,
  DO_MOTOR_TEST: 209,
  PREFLIGHT_CALIBRATION: 241,
  PREFLIGHT_STORAGE: 245,
  PREFLIGHT_REBOOT_SHUTDOWN: 246,
  /** ArduPilot-specific: control onboard Lua scripting (ardupilotmega.xml). */
  SCRIPTING: 42701,
  /**
   * Re-flash the bootloader from the image embedded in the running firmware
   * (ardupilotmega.xml, "Update the bootloader"). param5 must be the magic
   * 290876 or ArduPilot answers "Magic not set" and FAILED — see
   * GCS_Common.cpp handle_command_flash_bootloader, which reads it from the
   * COMMAND_INT `x` field. The entry is hasLocation="false", so the autopilot's
   * COMMAND_LONG -> COMMAND_INT conversion copies param5 into x WITHOUT the
   * 1e7 latitude scaling that location commands get.
   *
   * Compile-gated behind AP_BOOTLOADER_FLASHING_ENABLED: a build without it
   * answers UNSUPPORTED rather than failing silently.
   */
  FLASH_BOOTLOADER: 42650,
  // Put the RC receiver into bind/pair mode. ArduPilot routes this to the
  // active RC protocol's bind: CRSF/ExpressLRS sends the CRSF bind command
  // frame to the RX, Spektrum pulses the satellite bind. Params are ignored
  // for CRSF.
  START_RX_PAIR: 500,
  SET_MESSAGE_INTERVAL: 511,
  REQUEST_MESSAGE: 512,
  /**
   * Ask the autopilot to run its pre-arm checks right now and report every
   * failure. GCS_Common.cpp handle_command_run_prearm_checks calls
   * AP_Arming::pre_arm_checks(true) directly, so each accepted command emits a
   * complete, current set of `PreArm:` STATUSTEXTs.
   *
   * This is the only way to see a pre-arm result sooner than ArduPilot's own
   * schedule: AP_Arming::update() reports failures at most every
   * PREARM_DISPLAY_PERIOD (30 s) and never announces a fail->pass transition at
   * all. Answers TEMPORARILY_REJECTED while armed, and UNSUPPORTED on a build
   * without AP_ARMING_ENABLED.
   */
  RUN_PREARM_CHECKS: 401,
  REQUEST_AUTOPILOT_CAPABILITIES: 520,
  DO_START_MAG_CAL: 42424,
  DO_ACCEPT_MAG_CAL: 42425,
  DO_CANCEL_MAG_CAL: 42426,
  ACCELCAL_VEHICLE_POS: 42429,
  // Ask the autopilot to forward raw CAN frames from a specific bus
  // (1 or 2) via CAN_FRAME (msgid 386) MAVLink messages. param1 = bus,
  // 0 to disable. MAVLink stays alive on the same channel; this is the
  // mechanism Mission Planner uses for its DroneCAN inspector.
  CAN_FORWARD: 32000,
  // Asks the autopilot's MAVLink-UAVCAN bridge to re-emit UAVCAN_NODE_INFO
  // for every currently-online DroneCAN node. Per the MAVLink common-dialect
  // notes the command is "superseded" by MAV_CMD_REQUEST_MESSAGE, but is
  // still the documented broadcast trigger and remains supported on every
  // ArduPilot release that ships AP_DroneCAN today.
  UAVCAN_GET_NODE_INFO: 5200
} as const

export const MAV_PROTOCOL_CAPABILITY = {
  // MAV_PROTOCOL_CAPABILITY_FTP = 32 (bit 5) in common.xml. Note bit 128
  // is SET_POSITION_TARGET_LOCAL_NED, which a copter also advertises;
  // using 128 here would read as MAVFTP-supported on copters but fail on a
  // fixed-wing Plane (which does not set bit 128) despite its FTP support.
  FTP: 32n
} as const

export const MAV_FTP_OPCODE = {
  NONE: 0,
  TERMINATE_SESSION: 1,
  RESET_SESSIONS: 2,
  LIST_DIRECTORY: 3,
  OPEN_FILE_RO: 4,
  READ_FILE: 5,
  CREATE_FILE: 6,
  WRITE_FILE: 7,
  REMOVE_FILE: 8,
  CREATE_DIRECTORY: 9,
  REMOVE_DIRECTORY: 10,
  OPEN_FILE_WO: 11,
  TRUNCATE_FILE: 12,
  RENAME: 13,
  CALC_FILE_CRC32: 14,
  BURST_READ_FILE: 15,
  ACK: 128,
  NAK: 129
} as const

export const MAV_FTP_ERR = {
  NONE: 0,
  FAIL: 1,
  FAIL_ERRNO: 2,
  INVALID_DATA_SIZE: 3,
  INVALID_SESSION: 4,
  NO_SESSIONS_AVAILABLE: 5,
  EOF: 6,
  UNKNOWN_COMMAND: 7,
  FILE_EXISTS: 8,
  FILE_PROTECTED: 9,
  FILE_NOT_FOUND: 10
} as const

export const MOTOR_TEST_THROTTLE_TYPE = {
  PERCENT: 0,
  PWM: 1,
  PILOT: 2,
  CAL: 3
} as const

export const MOTOR_TEST_ORDER = {
  DEFAULT: 0,
  SEQUENCE: 1,
  BOARD: 2
} as const

export const MAV_RESULT = {
  ACCEPTED: 0,
  TEMPORARILY_REJECTED: 1,
  DENIED: 2,
  UNSUPPORTED: 3,
  FAILED: 4,
  IN_PROGRESS: 5
} as const
