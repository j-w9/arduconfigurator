import {
  MAV_FTP_ERR,
  MAV_FTP_OPCODE,
  MAV_AUTOPILOT,
  MAV_CMD,
  MAV_MODE_FLAG,
  MAV_PARAM_TYPE,
  MAV_RESULT,
  MAV_SEVERITY,
  MAV_STATE,
  MAV_TYPE,
  MAVLINK_MESSAGE_IDS,
} from './constants.js'
import { decodeSingleV2Envelope, MavlinkV2Codec, TruncatingMavlinkV2Codec } from './mavlink-v2-codec.js'
import { createDronecanBusSimulator } from './mock-dronecan.js'
import type {
  AutopilotVersionMessage,
  CommandAckMessage,
  CommandLongMessage,
  FileTransferProtocolMessage,
  GlobalPositionIntMessage,
  LogRequestDataMessage,
  MavlinkEnvelope,
  MavlinkMessage,
  ParamSetMessage,
  ParamValueMessage
} from './messages.js'

export interface MockScenario {
  initialFrames: Uint8Array[]
  respondToOutbound: (frame: Uint8Array) => Uint8Array[]
  /**
   * Wire the scenario into a transport's dynamic-frame channel. When the
   * caller passes `dynamicCadenceMs` to `createArduCopterMockScenario`, the
   * returned scenario simulates slow real-vehicle behavior — battery sag, a
   * short RC link blip, and a one-shot EKF action notice — by emitting
   * SYS_STATUS / RC_CHANNELS / STATUSTEXT frames over time. Tests that omit
   * `dynamicCadenceMs` (the default) get a no-op emitter, so the mock stays
   * byte-for-byte equivalent to a purely static scenario.
   */
  attachDynamicEmitter: (emit: (frame: Uint8Array) => void) => () => void
}

export interface MockScenarioOptions {
  /**
   * How often the in-process state machine should tick, in milliseconds.
   * Each tick may sag the battery, blip the RC link, or fire the EKF
   * notice. Leave undefined (the default) to disable the state machine
   * entirely — the scenario then behaves as a purely static
   * mock. Demo runtimes typically pass 5000–10000.
   */
  dynamicCadenceMs?: number
  /**
   * Clock override for deterministic tests. Defaults to `Date.now`.
   */
  now?: () => number
  /**
   * Override or remove individual parameters in the static baseline. Useful
   * for exercising vehicle states the default mock doesn't cover — e.g.
   * `{ BATT_MONITOR: 0 }` to drive the "no battery monitor" Failsafe path.
   * Setting a value to `null` removes the parameter from the mock,
   * mirroring ArduPilot's behaviour of not registering library params when
   * their owning subsystem is disabled.
   */
  parameterOverrides?: Record<string, number | null>
}

type ParameterState = Record<string, number>

const mockParameters: ParameterState = {
  FRAME_CLASS: 1,
  FRAME_TYPE: 1,
  AHRS_ORIENTATION: 0,
  // Config-tab fields a real FC always reports — included so the demo Config
  // surface is complete (no "— (not reported)" rows).
  AHRS_TRIM_X: 0,
  AHRS_TRIM_Y: 0,
  AHRS_TRIM_Z: 0,
  SYSID_THISMAV: 1,
  SYSID_MYGCS: 255,
  BRD_BOOT_DELAY: 0,
  GPS_GNSS_MODE: 0,
  CAM_TRIGG_TYPE: 0,
  CAM_DURATION: 10,
  CAM_AUTO_ONLY: 0,
  CAM_SERVO_ON: 1300,
  CAM_SERVO_OFF: 1100,
  COMPASS_USE: 1,
  COMPASS_USE2: 0,
  COMPASS_USE3: 0,
  SERIAL0_PROTOCOL: 2,
  SERIAL0_BAUD: 115,
  SERIAL1_PROTOCOL: 23,
  SERIAL1_BAUD: 420,
  SERIAL1_OPTIONS: 0,
  BRD_SER1_RTSCTS: 0,
  SERIAL2_PROTOCOL: 2,
  SERIAL2_BAUD: 57,
  SERIAL2_OPTIONS: 0,
  BRD_SER2_RTSCTS: 2,
  SERIAL3_PROTOCOL: 5,
  SERIAL3_BAUD: 115,
  SERIAL3_OPTIONS: 0,
  BRD_SER3_RTSCTS: 0,
  SERIAL4_PROTOCOL: -1,
  SERIAL4_BAUD: 57,
  SERIAL4_OPTIONS: 0,
  BRD_SER4_RTSCTS: 0,
  SERIAL5_PROTOCOL: 37,
  SERIAL5_BAUD: 115,
  SERIAL5_OPTIONS: 1,
  BRD_SER5_RTSCTS: 0,
  SERIAL6_PROTOCOL: 42,
  SERIAL6_BAUD: 115,
  SERIAL6_OPTIONS: 0,
  BRD_SER6_RTSCTS: 0,
  SERIAL7_PROTOCOL: -1,
  SERIAL7_BAUD: 57,
  SERIAL7_OPTIONS: 0,
  SERIAL8_PROTOCOL: 16,
  SERIAL8_BAUD: 115,
  SERIAL8_OPTIONS: 0,
  GPS_TYPE: 9,
  GPS_TYPE2: 0,
  GPS_AUTO_CONFIG: 1,
  GPS_AUTO_SWITCH: 0,
  GPS_PRIMARY: 0,
  GPS_RATE_MS: 200,
  OSD_TYPE: 5,
  OSD_CHAN: 8,
  OSD_SW_METHOD: 2,
  MSP_OPTIONS: 4,
  MSP_OSD_NCELLS: 0,
  VTX_ENABLE: 1,
  VTX_FREQ: 5800,
  VTX_POWER: 200,
  VTX_MAX_POWER: 800,
  VTX_OPTIONS: 0,
  BATT_MONITOR: 4,
  BATT_VOLT_MULT: 12.02,
  BATT_AMP_PERVLT: 17,
  BATT_CAPACITY: 1300,
  BATT_ARM_VOLT: 13.8,
  BATT_ARM_MAH: 0,
  DISARM_DELAY: 10,
  BATT_FS_VOLTSRC: 1,
  BATT_LOW_VOLT: 14.4,
  BATT_LOW_MAH: 300,
  BATT_LOW_TIMER: 10,
  BATT_FS_LOW_ACT: 2,
  BATT_CRT_VOLT: 13.8,
  BATT_CRT_MAH: 150,
  BATT_FS_CRT_ACT: 1,
  // Real ArduPilot params are float32; widened to a JS double, 0.15 becomes
  // 0.15000000596046448. Seed that exact value so the demo mirrors what a
  // real FC reports and exercises the Tuning tab's value rounding.
  ATC_INPUT_TC: 0.15000000596046448,
  ANGLE_MAX: 4500,
  PILOT_Y_RATE: 180,
  PILOT_Y_EXPO: 0.2,
  ATC_ACCEL_R_MAX: 140900,
  ATC_ACCEL_P_MAX: 140900,
  ATC_ACCEL_Y_MAX: 29300,
  FLTMODE_CH: 7,
  FLTMODE1: 0,
  FLTMODE2: 5,
  FLTMODE3: 6,
  FLTMODE4: 2,
  FLTMODE5: 16,
  FLTMODE6: 9,
  FS_THR_ENABLE: 1,
  FS_THR_VALUE: 975,
  RC_FS_TIMEOUT: 0.5,
  FS_OPTIONS: 0,
  // Lifetime counters so the Status & Info statistics panel reads like a
  // used airframe: ~110 h total / 24 h flight / 142 boots (STAT_RUNTIME and
  // STAT_FLTTIME are in seconds).
  STAT_RUNTIME: 396000,
  STAT_FLTTIME: 86400,
  STAT_BOOTCNT: 142,
  ARMING_CHECK: 1,
  ARMING_REQUIRE: 1,
  ARMING_RUDDER: 2,
  SCHED_LOOP_RATE: 400,
  INS_GYRO_RATE: 0,
  INS_FAST_SAMPLE: 1,
  INS_USE: 1,
  INS_USE2: 1,
  INS_USE3: 0,
  FS_GCS_ENABLE: 1,
  FS_EKF_ACTION: 1,
  FS_EKF_THRESH: 0.8,
  RCMAP_ROLL: 1,
  RCMAP_PITCH: 2,
  RCMAP_THROTTLE: 3,
  RCMAP_YAW: 4,
  RSSI_TYPE: 3,
  RSSI_CHANNEL: 8,
  RSSI_CHAN_LOW: 1000,
  RSSI_CHAN_HIGH: 2000,
  RC_SPEED: 150,
  RC_OPTIONS: 0,
  RC1_MIN: 1000,
  RC1_MAX: 2000,
  RC1_TRIM: 1500,
  RC1_REVERSED: 0,
  RC2_MIN: 1000,
  RC2_MAX: 2000,
  RC2_TRIM: 1500,
  // Mode-2 transmitters need RC2_REVERSED=1 for stick-back = pitch-up;
  // the demo seeds the "needs to be flipped" state (0) so the Receiver
  // tab's Channel Direction card looks the same as a fresh real FC and
  // the recommended-default hint has something to flag.
  RC2_REVERSED: 0,
  RC3_MIN: 1000,
  RC3_MAX: 2000,
  RC3_TRIM: 1500,
  RC3_REVERSED: 0,
  RC4_MIN: 1000,
  RC4_MAX: 2000,
  RC4_TRIM: 1500,
  RC4_REVERSED: 0,
  ACRO_RP_RATE: 360,
  ACRO_Y_RATE: 240,
  ACRO_RP_EXPO: 0.35,
  ACRO_Y_EXPO: 0.2,
  ATC_RAT_RLL_P: 0.1,
  ATC_RAT_RLL_I: 0.135,
  ATC_RAT_RLL_D: 0.0027,
  ATC_RAT_RLL_FF: 0,
  ATC_RAT_RLL_D_FF: 0,
  ATC_RAT_RLL_IMAX: 0.5,
  ATC_RAT_RLL_PDMX: 0,
  ATC_RAT_RLL_SMAX: 0,
  ATC_RAT_PIT_P: 0.1,
  ATC_RAT_PIT_I: 0.135,
  ATC_RAT_PIT_D: 0.0027,
  ATC_RAT_PIT_FF: 0,
  ATC_RAT_PIT_D_FF: 0,
  ATC_RAT_PIT_IMAX: 0.5,
  ATC_RAT_PIT_PDMX: 0,
  ATC_RAT_PIT_SMAX: 0,
  ATC_RAT_YAW_P: 0.18,
  ATC_RAT_YAW_I: 0.018,
  ATC_RAT_YAW_D: 0,
  ATC_RAT_YAW_FF: 0,
  ATC_RAT_YAW_D_FF: 0,
  ATC_RAT_YAW_IMAX: 0.5,
  ATC_RAT_YAW_PDMX: 0,
  ATC_RAT_YAW_SMAX: 0,
  // AUTOTUNE_* config family at ArduPilot AC_AutoTune_Multi defaults so the
  // demo Copter populates the curated AutoTune surface (verbatim from
  // libraries/AC_AutoTune/AC_AutoTune_Multi.cpp var_info[]).
  AUTOTUNE_AXES: 7,
  AUTOTUNE_AGGR: 0.075,
  AUTOTUNE_MIN_D: 0.0005,
  AUTOTUNE_GMBK: 0.25,
  ATC_RAT_RLL_FLTT: 35,
  ATC_RAT_RLL_FLTE: 0,
  ATC_RAT_RLL_FLTD: 35,
  ATC_RAT_PIT_FLTT: 35,
  ATC_RAT_PIT_FLTE: 0,
  ATC_RAT_PIT_FLTD: 35,
  ATC_RAT_YAW_FLTT: 35,
  ATC_RAT_YAW_FLTE: 2,
  ATC_RAT_YAW_FLTD: 0,
  MOT_PWM_TYPE: 5,
  ESC_CALIBRATION: 0,
  SERVO_DSHOT_RATE: 0,
  SERVO_BLH_AUTO: 0,
  SERVO_BLH_BDMASK: 0,
  SERVO_BLH_RVMASK: 0,
  SERVO_BLH_POLES: 14,
  MOT_PWM_MIN: 1000,
  MOT_PWM_MAX: 2000,
  MOT_SPIN_ARM: 0.08,
  MOT_SPIN_MIN: 0.12,
  MOT_SPIN_MAX: 0.95,
  NTF_LED_TYPES: 256,
  NTF_LED_LEN: 8,
  NTF_LED_BRIGHT: 2,
  NTF_LED_OVERRIDE: 0,
  NTF_BUZZ_TYPES: 1,
  NTF_BUZZ_VOLUME: 60,
  LOG_BACKEND_TYPE: 1,
  LOG_BITMASK: 0xFFFB,
  LOG_FILE_DSRMROT: 1,
  LOG_FILE_MB_FREE: 500,
  LOG_REPLAY: 0,
  LOG_DISARMED: 0,
  // Per-screen "Screen Options" (mirrored to OSD2-4 below). Seed sensible
  // ArduPilot defaults so the demo's OSD Screen Options panel is populated.
  OSD1_ENABLE: 1,
  OSD1_TXT_RES: 0,
  OSD1_FONT: 0,
  OSD1_CHAN_MIN: 900,
  OSD1_CHAN_MAX: 2100,
  OSD1_ESC_IDX: 0,
  // OSD1_*_EN/X/Y seed a sensible default layout for the
  // preview HUD (five visible elements: battery, RSSI, altitude, current,
  // heading; throttle, ground speed, horizon disabled). The 30 entries here
  // make the OSD preview render straight from the catalog in demo mode.
  OSD1_BAT_VOLT_EN: 1,
  OSD1_BAT_VOLT_X: 1,
  OSD1_BAT_VOLT_Y: 14,
  OSD1_RSSI_EN: 1,
  OSD1_RSSI_X: 24,
  OSD1_RSSI_Y: 14,
  OSD1_ALTITUDE_EN: 1,
  OSD1_ALTITUDE_X: 1,
  OSD1_ALTITUDE_Y: 7,
  OSD1_THROTTLE_EN: 0,
  OSD1_THROTTLE_X: 1,
  OSD1_THROTTLE_Y: 12,
  OSD1_CURRENT_EN: 1,
  OSD1_CURRENT_X: 23,
  OSD1_CURRENT_Y: 13,
  OSD1_HEADING_EN: 1,
  OSD1_HEADING_X: 23,
  OSD1_HEADING_Y: 7,
  OSD1_GSPEED_EN: 0,
  OSD1_GSPEED_X: 1,
  OSD1_GSPEED_Y: 12,
  OSD1_HOME_EN: 0,
  OSD1_HOME_X: 12,
  OSD1_HOME_Y: 1,
  OSD1_HORIZON_EN: 0,
  OSD1_HORIZON_X: 12,
  OSD1_HORIZON_Y: 7,
  OSD1_FLTMODE_EN: 1,
  OSD1_FLTMODE_X: 12,
  OSD1_FLTMODE_Y: 0,
  // Full ArduPilot OSD element set (disabled by default) so the OSD
  // elements list shows every option a real FC would expose.
  OSD1_ACRVOLT_EN: 0,
  OSD1_ARMING_EN: 0,
  OSD1_ASPD1_EN: 0,
  OSD1_ASPD2_EN: 0,
  OSD1_ASPEED_EN: 0,
  OSD1_ATEMP_EN: 0,
  OSD1_AVGCELLV_EN: 0,
  OSD1_BAT2USED_EN: 0,
  OSD1_BAT2_VLT_EN: 0,
  OSD1_BATTBAR_EN: 0,
  OSD1_BATUSED_EN: 0,
  OSD1_BTEMP_EN: 0,
  OSD1_CALLSIGN_EN: 0,
  OSD1_CELLVOLT_EN: 0,
  OSD1_CLIMBEFF_EN: 0,
  OSD1_CLK_EN: 0,
  OSD1_COMPASS_EN: 0,
  OSD1_CRSSHAIR_EN: 0,
  OSD1_CURRENT2_EN: 0,
  OSD1_DIST_EN: 0,
  OSD1_EFF_EN: 0,
  OSD1_ESCAMPS_EN: 0,
  OSD1_ESCRPM_EN: 0,
  OSD1_ESCTEMP_EN: 0,
  OSD1_FENCE_EN: 0,
  OSD1_FLTIME_EN: 0,
  OSD1_GPSLAT_EN: 0,
  OSD1_GPSLONG_EN: 0,
  OSD1_HDOP_EN: 0,
  OSD1_HOMEDIR_EN: 0,
  OSD1_HOMEDIST_EN: 0,
  OSD1_LINK_Q_EN: 0,
  OSD1_MESSAGE_EN: 0,
  OSD1_PITCH_EN: 0,
  OSD1_PLUSCODE_EN: 0,
  OSD1_POWER_EN: 0,
  OSD1_RC_ANT_EN: 0,
  OSD1_RC_LQ_EN: 0,
  OSD1_RC_PWR_EN: 0,
  OSD1_RC_SNR_EN: 0,
  OSD1_RESTVOLT_EN: 0,
  OSD1_RNGF_EN: 0,
  OSD1_ROLL_EN: 0,
  OSD1_RPM_EN: 0,
  OSD1_RSSIDBM_EN: 0,
  OSD1_SATS_EN: 0,
  OSD1_SIDEBARS_EN: 0,
  OSD1_STATS_EN: 0,
  OSD1_TEMP_EN: 0,
  OSD1_TER_HGT_EN: 0,
  OSD1_VSPEED_EN: 0,
  OSD1_VTX_PWR_EN: 0,
  OSD1_WAYPOINT_EN: 0,
  OSD1_WIND_EN: 0,
  OSD1_XTRACK_EN: 0,
  SERVO1_FUNCTION: 33,
  SERVO1_MIN: 1000,
  SERVO1_TRIM: 1500,
  SERVO1_MAX: 2000,
  SERVO2_FUNCTION: 34,
  SERVO2_MIN: 1000,
  SERVO2_TRIM: 1500,
  SERVO2_MAX: 2000,
  SERVO3_FUNCTION: 35,
  SERVO3_MIN: 1000,
  SERVO3_TRIM: 1500,
  SERVO3_MAX: 2000,
  SERVO4_FUNCTION: 36,
  SERVO4_MIN: 1000,
  SERVO4_TRIM: 1500,
  SERVO4_MAX: 2000,
  SERVO5_FUNCTION: 0,
  SERVO6_FUNCTION: 0,
  SERVO7_FUNCTION: 0,
  SERVO8_FUNCTION: 0,
  SERVO9_FUNCTION: 120,
  SERVO10_FUNCTION: 0,
  SERVO11_FUNCTION: 0,
  SERVO12_FUNCTION: 0,
  SERVO13_FUNCTION: 0,
  SERVO14_FUNCTION: 0,
  SERVO15_FUNCTION: 0,
  SERVO16_FUNCTION: 0
}

// Backfill OSD1 X/Y for every element that only has an _EN entry. On real
// hardware every OSD element exposes an X and Y cell (so it's positionable
// even while disabled); the curated block above only positions the ~10 default
// elements. Lay the rest out on cascading default cells so the demo matches a
// real FC — every element is positionable on every screen, not just toggleable.
{
  let backfillCol = 1
  let backfillRow = 1
  for (const key of Object.keys(mockParameters)) {
    const enMatch = /^OSD1_(.+)_EN$/.exec(key)
    if (!enMatch) {
      continue
    }
    const base = `OSD1_${enMatch[1]}`
    if (mockParameters[`${base}_X`] === undefined) {
      mockParameters[`${base}_X`] = backfillCol
      mockParameters[`${base}_Y`] = backfillRow
      backfillRow += 1
      if (backfillRow > 14) {
        backfillRow = 1
        backfillCol += 8
      }
    }
  }
}

// ArduPilot exposes four independent OSD screens (OSD1-4), each with the FULL
// element set. The mock hand-seeds OSD1's curated layout above; mirror every
// OSD1 param onto OSD2-4 so the Betaflight-style element x screen matrix has a
// real checkbox for every element on every screen, exactly like hardware (each
// extra screen starts fully disabled but addressable; X/Y copy OSD1's cell so
// any element enabled later lands somewhere sane). Frame delivery is paced by
// the demo transport, so the larger param set doesn't slow connect.
for (const key of Object.keys(mockParameters)) {
  const match = /^OSD1_(.+)$/.exec(key)
  if (!match) {
    continue
  }
  const suffix = match[1]
  for (const screen of [2, 3, 4]) {
    const target = `OSD${screen}_${suffix}`
    mockParameters[target] = suffix.endsWith('_EN') ? 0 : mockParameters[key]
  }
}
// Distinct per-screen enabled sets: OSD2 = a clean cinematic set, OSD3 = a
// nav-focused set, OSD4 = a power/return set.
mockParameters.OSD2_BAT_VOLT_EN = 1
mockParameters.OSD2_FLTMODE_EN = 1
mockParameters.OSD2_HORIZON_EN = 1
mockParameters.OSD3_RSSI_EN = 1
mockParameters.OSD3_ALTITUDE_EN = 1
mockParameters.OSD3_HEADING_EN = 1
mockParameters.OSD4_CURRENT_EN = 1
mockParameters.OSD4_GSPEED_EN = 1
mockParameters.OSD4_HOME_EN = 1

const mockAutopilotVersion: AutopilotVersionMessage = {
  type: 'AUTOPILOT_VERSION',
  // A realistic ArduPilot bitmask (MISSION_FLOAT|PARAM_FLOAT|MISSION_INT|
  // COMMAND_INT|PARAM_ENCODE_BYTEWISE|FTP|SET_ATTITUDE_TARGET = bits 0-6 =
  // 127) with bit 7 (SET_POSITION_TARGET_LOCAL_NED) clear, like a fixed-wing
  // Plane that does not advertise bit 128. A literal, not
  // MAV_PROTOCOL_CAPABILITY.FTP, so the ftpSupported derivation is exercised
  // against an independent value.
  capabilities: 0b1111111n,
  flightSwVersion: 0x040600ff,
  middlewareSwVersion: 0,
  osSwVersion: 0,
  boardVersion: 59 << 16,
  // ArduPilot's flight_custom_version is the ASCII first-8-chars of the
  // build's git SHA (fwversion().fw_hash_str). These bytes decode to the
  // printable string "abcd1234".
  flightCustomVersion: new Uint8Array([0x61, 0x62, 0x63, 0x64, 0x31, 0x32, 0x33, 0x34]),
  middlewareCustomVersion: new Uint8Array(8),
  osCustomVersion: new Uint8Array(8),
  vendorId: 0,
  productId: 0,
  uid: 0x0123456789abcdefn
}

const mockUartsText = [
  'UARTV1',
  'SERIAL0 OTG1    TX =    120 RX =     18 TXBD=     0 RXBD=     0',
  'SERIAL1 UART7   TX =    802 RX =    155 TXBD=     0 RXBD=     0',
  'SERIAL2 UART5   TX*=     63 RX*=      0 TXBD=   128 RXBD=     0',
  'SERIAL3 USART1  TX =      0 RX =      0 TXBD=     0 RXBD=     0',
  'SERIAL4 UART8   TX =      0 RX =      0 TXBD=     0 RXBD=     0',
  'SERIAL5 USART2  TX =      0 RX =      0 TXBD=     0 RXBD=     0',
  'SERIAL6 UART4   TX =      0 RX =      0 TXBD=     0 RXBD=     0',
  'SERIAL7 USART3  TX =      0 RX =      0 TXBD=     0 RXBD=     0',
  'SERIAL8 USART6  TX =      4 RX =      0 TXBD=     0 RXBD=     0'
].join('\n')

const mockUartsBytes = new TextEncoder().encode(mockUartsText)
const mockTimersBytes = new TextEncoder().encode(
  [
    'Timer Mapping',
    'PWM1 TIM5 CH1',
    'PWM2 TIM5 CH2',
    'PWM3 TIM5 CH3',
    'PWM4 TIM5 CH4'
  ].join('\n')
)
const mockHelloScriptBytes = new TextEncoder().encode(
  "gcs:send_text(6, 'hello from @SYS/scripts/hello.lua')\n"
)
const mockAutorunScriptBytes = new TextEncoder().encode(
  [
    "gcs:send_text(6, 'autorun bootstrap active')",
    'return true'
  ].join('\n')
)

type MockFtpFileMap = Map<string, Uint8Array>

function envelope(sequence: number, message: MavlinkMessage): MavlinkEnvelope {
  return {
    header: {
      systemId: 1,
      componentId: 1,
      sequence
    },
    message,
    timestampMs: Date.now()
  }
}

function rcChannelsMessage(timeBootMs: number): MavlinkMessage {
  return {
    type: 'RC_CHANNELS',
    timeBootMs,
    channelCount: 8,
    channels: [1500, 1500, 1100, 1500, 1000, 1500, 1500, 1500],
    rssi: 100
  }
}

function attitudeMessage(timeBootMs: number, rollRad = 0, pitchRad = 0, yawRad = 0): MavlinkMessage {
  return {
    type: 'ATTITUDE',
    timeBootMs,
    rollRad,
    pitchRad,
    yawRad,
    rollSpeedRadS: 0,
    pitchSpeedRadS: 0,
    yawSpeedRadS: 0
  }
}

function sysStatusMessage(voltageBatteryMv: number, batteryRemaining: number): MavlinkMessage {
  return {
    type: 'SYS_STATUS',
    sensorsPresent: 0,
    sensorsEnabled: 0,
    sensorsHealth: 0,
    load: 180,
    voltageBatteryMv,
    currentBatteryCa: 120,
    batteryRemaining,
    dropRateComm: 0,
    errorsComm: 0,
    errorsCount1: 0,
    errorsCount2: 0,
    errorsCount3: 0,
    errorsCount4: 0,
    sensorsPresentExtended: 0,
    sensorsEnabledExtended: 0,
    sensorsHealthExtended: 0
  }
}

function globalPositionMessage(timeBootMs: number): GlobalPositionIntMessage {
  return {
    type: 'GLOBAL_POSITION_INT',
    timeBootMs,
    latitudeE7: 377749300,
    longitudeE7: -1224194200,
    altitudeMm: 18420,
    relativeAltitudeMm: 1240,
    velocityXcms: 120,
    velocityYcms: -40,
    velocityZcms: 0,
    headingCdeg: 27450
  }
}

function buildParameterFrames(parameterState: ParameterState): Uint8Array[] {
  const codec = new TruncatingMavlinkV2Codec()
  const entries = Object.entries(parameterState)
  return entries.map(([paramId, paramValue], index) => {
    const message: ParamValueMessage = {
      type: 'PARAM_VALUE',
      paramId,
      paramValue,
      paramType: MAV_PARAM_TYPE.REAL32,
      paramCount: entries.length,
      paramIndex: index
    }

    return codec.encode(envelope(index + 10, message))
  })
}

// Two deterministic fake onboard logs so the demo + e2e can exercise the
// list/download flow without hardware. Byte i of log `id` is
// (id * 31 + i) & 0xff, so the UI/tests can assert exact content.
const MOCK_ONBOARD_LOGS = [
  { id: 1, sizeBytes: 256, timeUtc: 1_700_000_000 },
  { id: 2, sizeBytes: 117, timeUtc: 1_700_086_400 }
] as const

const MOCK_LOG_DATA_CHUNK = 90

function mockLogByte(id: number, index: number): number {
  return (id * 31 + index) & 0xff
}

function buildLogEntryFrames(): Uint8Array[] {
  const codec = new TruncatingMavlinkV2Codec()
  const lastLogNum = MOCK_ONBOARD_LOGS[MOCK_ONBOARD_LOGS.length - 1]?.id ?? 0
  return MOCK_ONBOARD_LOGS.map((log, index) =>
    codec.encode(
      envelope(300 + index, {
        type: 'LOG_ENTRY',
        timeUtc: log.timeUtc,
        size: log.sizeBytes,
        id: log.id,
        numLogs: MOCK_ONBOARD_LOGS.length,
        lastLogNum
      })
    )
  )
}

function buildLogDataFrames(id: number, startOffset: number): Uint8Array[] {
  const log = MOCK_ONBOARD_LOGS.find((candidate) => candidate.id === id)
  if (!log) {
    return []
  }

  const codec = new TruncatingMavlinkV2Codec()
  const frames: Uint8Array[] = []
  let offset = Math.max(0, startOffset)
  let sequence = 320

  while (offset < log.sizeBytes) {
    const count = Math.min(MOCK_LOG_DATA_CHUNK, log.sizeBytes - offset)
    const data = new Uint8Array(MOCK_LOG_DATA_CHUNK)
    for (let i = 0; i < count; i += 1) {
      data[i] = mockLogByte(id, offset + i)
    }
    frames.push(codec.encode(envelope(sequence, { type: 'LOG_DATA', id, ofs: offset, count, data })))
    offset += count
    sequence += 1
  }

  return frames
}

// Deterministic onboard mag-cal stream. Real ArduPilot streams MAG_CAL_PROGRESS
// at ~1Hz while the operator rotates the vehicle, then a single MAG_CAL_REPORT.
// The mock collapses the rotation into four rising-percentage progress frames
// followed by a SUCCESS report so the demo + e2e can drive the runtime
// flow (DO_START_MAG_CAL -> progress -> report) without hardware.
const MOCK_MAG_CAL_PROGRESS_PCT = [10, 40, 70, 100] as const

function buildMagCalFrames(): Uint8Array[] {
  const codec = new TruncatingMavlinkV2Codec()
  const frames: Uint8Array[] = []
  const baseSequence = 360

  MOCK_MAG_CAL_PROGRESS_PCT.forEach((completionPct, index) => {
    const completionMask = new Uint8Array(10)
    // Light up sphere sections proportionally so the mask looks plausible.
    const sectionsSeen = Math.round((completionPct / 100) * 80)
    for (let bit = 0; bit < sectionsSeen; bit += 1) {
      completionMask[bit >> 3] |= 1 << (bit & 7)
    }
    frames.push(
      codec.encode(
        envelope(baseSequence + index, {
          type: 'MAG_CAL_PROGRESS',
          compassId: 0,
          calMask: 1,
          calStatus: 2,
          attempt: 1,
          completionPct,
          completionMask,
          directionX: index % 2 === 0 ? 1 : 0,
          directionY: index % 2 === 0 ? 0 : 1,
          directionZ: 0
        })
      )
    )
  })

  frames.push(
    codec.encode(
      envelope(baseSequence + MOCK_MAG_CAL_PROGRESS_PCT.length, {
        type: 'MAG_CAL_REPORT',
        compassId: 0,
        calMask: 1,
        calStatus: 4,
        // The runtime requests autosave (DO_START_MAG_CAL param3=1), so a real
        // autopilot writes the fit itself and reports it as auto-saved.
        autosaved: 1,
        fitness: 2.5,
        ofsX: 12,
        ofsY: -8,
        ofsZ: 4,
        diagX: 1,
        diagY: 1,
        diagZ: 1,
        offdiagX: 0,
        offdiagY: 0,
        offdiagZ: 0,
        orientationConfidence: 1,
        oldOrientation: 0,
        newOrientation: 0,
        scaleFactor: 1
      })
    )
  )

  return frames
}

interface MockVehicleProfile {
  vehicleType: number
  connectText: string
  parameters: ParameterState
}

// ArduPlane / QuadPlane demo parameters. Reuses the shared Copter base for
// the families that are identical between firmwares (battery, serial ports,
// GPS, RC, OSD, VTX, logging, compass) and overlays the Plane-specific ones
// the wired ArduPlane catalog expects.
const arduplaneMockParameters: ParameterState = {
  ...mockParameters,
  Q_ENABLE: 1,
  Q_FRAME_CLASS: 1,
  Q_FRAME_TYPE: 1,
  // Fixed-wing surface tuning / attitude family (ArduPlane defaults) so the
  // demo Plane exercises the real fixed-wing Tuning catalog, not just VTOL.
  RLL_RATE_P: 0.08,
  RLL_RATE_I: 0.15,
  RLL_RATE_D: 0.02,
  RLL_RATE_FF: 0.345,
  RLL_RATE_IMAX: 0.666,
  PTCH_RATE_P: 0.08,
  PTCH_RATE_I: 0.15,
  PTCH_RATE_D: 0.02,
  PTCH_RATE_FF: 0.345,
  PTCH_RATE_IMAX: 0.666,
  YAW_RATE_P: 0.05,
  YAW_RATE_I: 0.05,
  YAW_RATE_D: 0,
  YAW_RATE_FF: 0.15,
  YAW_RATE_IMAX: 0.666,
  RLL2SRV_TCONST: 0.5,
  RLL2SRV_RMAX: 75,
  PTCH2SRV_TCONST: 0.5,
  PTCH2SRV_RMAX_UP: 75,
  PTCH2SRV_RMAX_DN: 75,
  PTCH2SRV_RLL: 1,
  LIM_ROLL_CD: 4500,
  LIM_PITCH_MAX: 2000,
  LIM_PITCH_MIN: -2500,
  // Airspeed + cruise/throttle family (modern ArduPlane 4.5+ names, as a
  // current Plane reports) so the demo exercises the real airspeed catalog.
  ARSPD_TYPE: 1,
  ARSPD_USE: 1,
  ARSPD_RATIO: 2,
  ARSPD_AUTOCAL: 0,
  ARSPD_SKIP_CAL: 0,
  AIRSPEED_MIN: 9,
  AIRSPEED_MAX: 22,
  AIRSPEED_CRUISE: 14,
  STALL_PREVENTION: 1,
  TRIM_THROTTLE: 45,
  THR_MIN: 0,
  THR_MAX: 75,
  THR_SLEWRATE: 100,
  THROTTLE_NUDGE: 1,
  PTCH_TRIM_DEG: 0,
  // TECS speed/height + L1 nav (ArduPlane defaults) so the demo exercises
  // the real auto-flight tuning catalog.
  TECS_CLMB_MAX: 5,
  TECS_SINK_MIN: 2,
  TECS_SINK_MAX: 5,
  TECS_TIME_CONST: 5,
  TECS_THR_DAMP: 0.5,
  TECS_PTCH_DAMP: 0.3,
  TECS_INTEG_GAIN: 0.3,
  TECS_SPDWEIGHT: 1,
  TECS_PITCH_MAX: 15,
  TECS_PITCH_MIN: -15,
  TECS_RLL2THR: 10,
  NAVL1_PERIOD: 20,
  NAVL1_DAMPING: 0.75,
  NAVL1_XTRACK_I: 0.02,
  NAVL1_LIM_BANK: 60,
  // Mission & navigation geometry (ArduPlane defaults).
  WP_RADIUS: 90,
  WP_MAX_RADIUS: 0,
  WP_LOITER_RAD: 60,
  RTL_RADIUS: 0,
  RTL_AUTOLAND: 0,
  // Auto-landing family (ArduPlane defaults).
  LAND_TYPE: 0,
  LAND_SLOPE_RCALC: 2,
  LAND_ABORT_DEG: 0,
  LAND_PITCH_DEG: 0,
  LAND_FLARE_ALT: 3,
  LAND_FLARE_SEC: 2,
  LAND_PF_ALT: 10,
  LAND_PF_SEC: 6,
  LAND_PF_ARSPD: 0,
  LAND_THR_SLEW: 100,
  LAND_DISARMDELAY: 20,
  LAND_THEN_NEUTRL: 0,
  LAND_ABORT_THR: 0,
  LAND_FLAP_PERCNT: 0,
  LAND_FLARE_AIM: 50,
  LAND_WIND_COMP: 50,
  // Control mixing + flap schedule (ArduPlane defaults).
  KFF_RDDRMIX: 0.5,
  KFF_THR2PTCH: 0,
  MIXING_GAIN: 0.5,
  RUDD_DT_GAIN: 10,
  FLAP_1_PERCNT: 0,
  FLAP_1_SPEED: 12,
  FLAP_2_PERCNT: 0,
  FLAP_2_SPEED: 8,
  // QuadPlane VTOL family with standard ArduPlane defaults so the demo
  // Plane is a realistic QuadPlane (not a thin copter-base overlay) and
  // the VTOL tuning / assist / autotune surfaces have real values.
  Q_A_RAT_RLL_P: 0.135,
  Q_A_RAT_RLL_I: 0.135,
  Q_A_RAT_RLL_D: 0.0036,
  Q_A_RAT_RLL_FF: 0,
  Q_A_RAT_RLL_IMAX: 0.5,
  Q_A_RAT_RLL_FLTT: 20,
  Q_A_RAT_RLL_FLTD: 20,
  Q_A_RAT_RLL_SMAX: 0,
  Q_A_RAT_PIT_P: 0.135,
  Q_A_RAT_PIT_I: 0.135,
  Q_A_RAT_PIT_D: 0.0036,
  Q_A_RAT_PIT_FF: 0,
  Q_A_RAT_PIT_IMAX: 0.5,
  Q_A_RAT_PIT_FLTT: 20,
  Q_A_RAT_PIT_FLTD: 20,
  Q_A_RAT_PIT_SMAX: 0,
  Q_A_RAT_YAW_P: 0.18,
  Q_A_RAT_YAW_I: 0.018,
  Q_A_RAT_YAW_D: 0,
  Q_A_RAT_YAW_FF: 0,
  Q_A_RAT_YAW_IMAX: 0.5,
  Q_A_RAT_YAW_FLTT: 20,
  Q_A_RAT_YAW_FLTE: 2,
  Q_A_RAT_YAW_SMAX: 0,
  Q_A_ANG_RLL_P: 4.5,
  Q_A_ANG_PIT_P: 4.5,
  Q_A_ANG_YAW_P: 4.5,
  Q_A_RATE_RLL_MAX: 0,
  Q_A_RATE_PIT_MAX: 0,
  Q_A_RATE_YAW_MAX: 0,
  Q_A_ACCEL_R_MAX: 110000,
  Q_A_ACCEL_P_MAX: 110000,
  Q_A_ACCEL_Y_MAX: 27000,
  Q_ANGLE_MAX: 3000,
  Q_ASSIST_SPEED: 0,
  Q_ASSIST_ANGLE: 30,
  Q_ASSIST_ALT: 0,
  Q_ASSIST_DELAY: 0.5,
  Q_ASSIST_OPTIONS: 0,
  // Fixed-wing AUTOTUNE config at ArduPilot defaults (ArduPlane/Parameters.cpp:
  // AUTOTUNE_LEVEL default 6, AUTOTUNE_OPTIONS default 0) so the demo Plane
  // populates the curated fixed-wing AutoTune surface.
  AUTOTUNE_LEVEL: 6,
  AUTOTUNE_OPTIONS: 0,
  // QuadPlane VTOL AUTOTUNE config at the shared AC_AutoTune_Multi defaults
  // (AGGR 0.075, MIN_D 0.0005, GMBK 0.25; AXES 7 = roll+pitch+yaw) so the
  // demo QuadPlane populates the VTOL AutoTune group.
  Q_AUTOTUNE_AXES: 7,
  Q_AUTOTUNE_AGGR: 0.075,
  Q_AUTOTUNE_MIN_D: 0.0005,
  Q_AUTOTUNE_GMBK: 0.25,
  Q_M_PWM_TYPE: 0,
  Q_M_PWM_MIN: 1000,
  Q_M_PWM_MAX: 2000,
  Q_M_SPIN_ARM: 0.1,
  Q_M_SPIN_MIN: 0.15,
  Q_M_SPIN_MAX: 0.95,
  Q_M_THST_HOVER: 0.35,
  Q_M_BAT_VOLT_MAX: 0,
  Q_M_BAT_VOLT_MIN: 0,
  Q_P_POSXY_P: 1,
  Q_P_POSZ_P: 1,
  Q_P_VELXY_P: 2,
  Q_P_VELXY_I: 1,
  Q_P_ACCZ_P: 0.5,
  Q_P_ACCZ_I: 1,
  Q_WP_SPEED: 500,
  Q_WP_RADIUS: 200,
  Q_WP_SPEED_UP: 250,
  Q_WP_SPEED_DN: 150,
  Q_WP_ACCEL: 250,
  FS_LONG_ACTN: 1,
  FS_SHORT_ACTN: 1,
  FS_LONG_TIMEOUT: 5,
  FS_SHORT_TIMEOUT: 1.5,
  THR_FAILSAFE: 1,
  THR_FS_VALUE: 950,
  FLTMODE_CH: 8,
  FLTMODE1: 0,
  FLTMODE2: 5,
  FLTMODE3: 6,
  FLTMODE4: 10,
  FLTMODE5: 11,
  FLTMODE6: 12,
  // Soaring (SOAR_*) seeded ON with ArduPilot AP_Soaring defaults so the
  // demo Plane populates the curated Soaring surface. Defaults verbatim from
  // libraries/AP_Soaring/AP_Soaring.cpp var_info[].
  SOAR_ENABLE: 1,
  SOAR_VSPEED: 0.7,
  SOAR_Q1: 0.001,
  SOAR_Q2: 0.03,
  SOAR_R: 0.45,
  SOAR_DIST_AHEAD: 5,
  SOAR_MIN_THML_S: 20,
  SOAR_MIN_CRSE_S: 10,
  SOAR_POLAR_CD0: 0.027,
  SOAR_POLAR_B: 0.031,
  SOAR_POLAR_K: 25.6,
  SOAR_ALT_MAX: 350,
  SOAR_ALT_MIN: 50,
  SOAR_ALT_CUTOFF: 250,
  SOAR_MAX_DRIFT: -1,
  SOAR_MAX_RADIUS: -1,
  SOAR_THML_BANK: 30,
  SOAR_THML_ARSPD: 0,
  SOAR_CRSE_ARSPD: 0,
  SOAR_THML_FLAP: 0,
  // ADS-B transponder (ADSB_*) seeded with a uAvionix-MAVLink device so the
  // demo Plane populates the curated ADS-B surface. Defaults verbatim from
  // libraries/AP_ADSB/AP_ADSB.cpp var_info[].
  ADSB_TYPE: 1,
  ADSB_LIST_MAX: 25,
  ADSB_LIST_RADIUS: 10000,
  ADSB_ICAO_ID: 0,
  ADSB_EMIT_TYPE: 14,
  ADSB_LEN_WIDTH: 1,
  ADSB_OFFSET_LAT: 0,
  ADSB_OFFSET_LON: 1,
  ADSB_RF_SELECT: 0,
  ADSB_SQUAWK: 1200,
  ADSB_RF_CAPABLE: 0,
  ADSB_LIST_ALT: 0,
  ADSB_OPTIONS: 0,
  ADSB_LOG: 1,
  // ADS-B traffic avoidance (AVD_*) seeded ON. Defaults verbatim from
  // libraries/AC_Avoidance/AP_Avoidance.cpp var_info[]; the distance/time
  // horizons use the documented platform defaults (30 s, 300 m vertical).
  AVD_ENABLE: 1,
  AVD_F_ACTION: 2,
  AVD_W_ACTION: 1,
  AVD_F_RCVRY: 1,
  AVD_OBS_MAX: 20,
  AVD_W_TIME: 30,
  AVD_F_TIME: 30,
  AVD_W_DIST_XY: 1000,
  AVD_F_DIST_XY: 300,
  AVD_W_DIST_Z: 300,
  AVD_F_DIST_Z: 100,
  AVD_F_ALT_MIN: 0
}

// Copter-only params that must NOT leak into the Rover/Sub overlays.
// Real ArduRover/ArduSub do not expose these (Rover uses MODE_CH /
// MODE1..6, Sub is joystick-driven with FRAME_CONFIG), so excluding them
// keeps the overlays vehicle-accurate.
const COPTER_ONLY_MOCK_KEYS = new Set<string>([
  'FRAME_CLASS',
  'FRAME_TYPE',
  'FLTMODE_CH',
  'FLTMODE1',
  'FLTMODE2',
  'FLTMODE3',
  'FLTMODE4',
  'FLTMODE5',
  'FLTMODE6',
  // Multirotor AC_AutoTune_Multi config — Rover/Sub have no classic AutoTune.
  'AUTOTUNE_AXES',
  'AUTOTUNE_AGGR',
  'AUTOTUNE_MIN_D',
  'AUTOTUNE_GMBK'
])

/** The Copter mock base minus the Copter-only mode/frame params, so the
 * Rover/Sub overlays inherit only vehicle-neutral params (board id,
 * comms, battery, GPS, compass) — never FLTMODE* / FRAME_CLASS. */
function nonCopterMockBase(): ParameterState {
  return Object.fromEntries(
    Object.entries(mockParameters).filter(([key]) => !COPTER_ONLY_MOCK_KEYS.has(key))
  ) as ParameterState
}

// Minimal ArduRover demo overlay — just enough catalog-keyed params for
// the real Rover UI (modes, drive, steering, failsafe) to render and be
// e2e-driven. Demo realism is intentionally low priority; the value is
// exercising the real Rover code paths.
export const arduroverMockParameters: ParameterState = {
  ...nonCopterMockBase(),
  MODE_CH: 8,
  MODE1: 0,
  MODE2: 4,
  MODE3: 10,
  MODE4: 11,
  MODE5: 5,
  MODE6: 3,
  CRUISE_SPEED: 2,
  CRUISE_THROTTLE: 50,
  PILOT_STEER_TYPE: 0,
  ATC_STR_RAT_P: 0.2,
  ATC_STR_RAT_I: 0.2,
  ATC_STR_RAT_D: 0,
  ATC_STR_ANG_P: 2.5,
  ATC_SPEED_P: 0.2,
  ATC_SPEED_I: 0.2,
  // Steering & speed controller completeness (ArduRover defaults).
  ATC_STR_RAT_FF: 0.2,
  ATC_STR_RAT_IMAX: 1,
  ATC_STR_RAT_MAX: 360,
  ATC_STR_RAT_FLTT: 10,
  ATC_STR_RAT_FLTE: 0,
  ATC_STR_RAT_FLTD: 10,
  ATC_STR_RAT_SMAX: 0,
  ATC_STR_ACC_MAX: 180,
  ATC_STR_DEC_MAX: 0,
  ATC_SPEED_D: 0,
  ATC_SPEED_IMAX: 1,
  ATC_SPEED_FF: 0,
  ATC_SPEED_FLTT: 10,
  ATC_SPEED_FLTE: 0,
  ATC_SPEED_FLTD: 10,
  ATC_SPEED_SMAX: 0,
  ATC_ACCEL_MAX: 0,
  ATC_DECEL_MAX: 0,
  ATC_STOP_SPEED: 0.1,
  SPEED_MAX: 0,
  WP_SPEED: 2,
  WP_RADIUS: 2,
  TURN_RADIUS: 0.9,
  TURN_MAX_G: 0.6,
  // Navigation completeness (ArduRover defaults).
  NAVL1_DAMPING: 0.75,
  NAVL1_XTRACK_I: 0.02,
  WP_ACCEL: 0,
  WP_JERK: 0,
  ATC_TURN_MAX_G: 0.6,
  MOT_THR_MIN: 0,
  MOT_THR_MAX: 100,
  FS_ACTION: 2,
  FS_THR_ENABLE: 1,
  FS_THR_VALUE: 910,
  FS_TIMEOUT: 1.5,
  FS_GCS_ENABLE: 1
}

// Minimal ArduSub demo overlay — Sub is joystick-driven (no mode switch).
export const ardusubMockParameters: ParameterState = {
  ...nonCopterMockBase(),
  FRAME_CONFIG: 1,
  JS_GAIN_DEFAULT: 0.5,
  JS_GAIN_MAX: 1,
  JS_GAIN_MIN: 0.25,
  JS_GAIN_STEPS: 4,
  JS_THR_GAIN: 1,
  PILOT_SPEED_UP: 100,
  PILOT_SPEED_DN: 100,
  PILOT_ACCEL_Z: 100,
  SURFACE_DEPTH: -10,
  ATC_RAT_RLL_P: 0.135,
  ATC_RAT_PIT_P: 0.135,
  ATC_RAT_YAW_P: 0.18,
  ATC_ANG_RLL_P: 6,
  ATC_ANG_PIT_P: 6,
  ATC_ANG_YAW_P: 6,
  // Attitude rate-controller completeness (ArduSub / AC_AttitudeControl defaults).
  // I/D gains seed the curated TuningSubSection roll/pitch/yaw rate groups
  // (ArduSub ships these on by default; values mirror the AC_AttitudeControl
  // Sub defaults). Yaw has no D term in the Sub catalog, so none is seeded.
  ATC_RAT_RLL_I: 0.09,
  ATC_RAT_RLL_D: 0.0036,
  ATC_RAT_PIT_I: 0.09,
  ATC_RAT_PIT_D: 0.0036,
  ATC_RAT_YAW_I: 0.018,
  ATC_RAT_RLL_FF: 0,
  ATC_RAT_RLL_IMAX: 0.5,
  ATC_RAT_RLL_FLTT: 20,
  ATC_RAT_RLL_FLTE: 0,
  ATC_RAT_RLL_FLTD: 20,
  ATC_RAT_RLL_SMAX: 0,
  ATC_RAT_PIT_FF: 0,
  ATC_RAT_PIT_IMAX: 0.5,
  ATC_RAT_PIT_FLTT: 20,
  ATC_RAT_PIT_FLTE: 0,
  ATC_RAT_PIT_FLTD: 20,
  ATC_RAT_PIT_SMAX: 0,
  ATC_RAT_YAW_FF: 0,
  ATC_RAT_YAW_IMAX: 0.5,
  ATC_RAT_YAW_FLTT: 20,
  ATC_RAT_YAW_FLTE: 2,
  ATC_RAT_YAW_FLTD: 0,
  ATC_RAT_YAW_SMAX: 0,
  // Vertical/depth position controller (modern ArduSub PSC_D_* names).
  PSC_D_POS_P: 1,
  PSC_D_VEL_P: 5,
  PSC_D_VEL_I: 0,
  PSC_D_VEL_D: 0,
  PSC_D_VEL_IMAX: 1,
  PSC_D_VEL_FLTE: 5,
  PSC_D_VEL_FLTD: 5,
  PSC_D_ACC_P: 0.1,
  PSC_D_ACC_I: 0.1,
  PSC_D_ACC_D: 0,
  PSC_D_ACC_IMAX: 0.4,
  PSC_D_ACC_FLTT: 10,
  PSC_D_ACC_FLTE: 20,
  PSC_D_ACC_FLTD: 10,
  PSC_D_ACC_SMAX: 0,
  PSC_JERK_D: 8,
  WPNAV_SPEED: 100,
  FS_LEAK_ENABLE: 2,
  FS_PRESS_ENABLE: 1,
  FS_TEMP_ENABLE: 1,
  FS_GCS_ENABLE: 2,
  FS_PILOT_INPUT: 1,
  FS_CRASH_CHECK: 1
}

export function createArduCopterMockScenario(options: MockScenarioOptions = {}): MockScenario {
  return buildMockScenario(
    {
      vehicleType: MAV_TYPE.QUADROTOR,
      connectText: 'Prototype ArduCopter connected.',
      parameters: mockParameters
    },
    options
  )
}

export function createArduPlaneMockScenario(options: MockScenarioOptions = {}): MockScenario {
  return buildMockScenario(
    {
      vehicleType: MAV_TYPE.FIXED_WING,
      connectText: 'Prototype ArduPlane connected.',
      parameters: arduplaneMockParameters
    },
    options
  )
}

export function createArduRoverMockScenario(options: MockScenarioOptions = {}): MockScenario {
  return buildMockScenario(
    {
      vehicleType: MAV_TYPE.GROUND_ROVER,
      connectText: 'Prototype ArduRover connected.',
      parameters: arduroverMockParameters
    },
    options
  )
}

export function createArduSubMockScenario(options: MockScenarioOptions = {}): MockScenario {
  return buildMockScenario(
    {
      vehicleType: MAV_TYPE.SUBMARINE,
      connectText: 'Prototype ArduSub connected.',
      parameters: ardusubMockParameters
    },
    options
  )
}

function buildMockScenario(profile: MockVehicleProfile, options: MockScenarioOptions = {}): MockScenario {
  const codec = new TruncatingMavlinkV2Codec()
  const parameters = { ...profile.parameters }
  if (options.parameterOverrides) {
    for (const [id, value] of Object.entries(options.parameterOverrides)) {
      if (value === null) {
        delete parameters[id]
      } else {
        parameters[id] = value
      }
    }
  }
  const ftpFiles = createMockFtpFiles()
  const ftpSessions = new Map<number, { path: string; mode: 'read' | 'write' }>()
  let nextFtpSession = 1
  // Tracks the pose the FC is currently asking the operator to confirm.
  // 0 means the calibration is not running. 1..6 maps to the six
  // ACCELCAL_VEHICLE_POS commandValues (level, left, right, nose-down,
  // nose-up, back). When the configurator confirms the sixth pose, the
  // mock emits the calibration-complete STATUSTEXT and resets the counter.
  let nextAccelPoseCommandValue = 0
  let accelSequence = 300

  // Dynamic state machine — see attachDynamicEmitter below. State lives on
  // the scenario closure so the demo's slow transitions (battery sag, RC
  // link blip, EKF notice) survive across ticks and across reconnects on
  // the same scenario instance.
  const dynamicState = createDynamicState()
  const dynamicCadenceMs = options.dynamicCadenceMs
  const now = options.now ?? (() => Date.now())
  // MAVLink v2 sequence is a single byte that the codec masks to 0..255.
  // Wrap explicitly so long-running demos don't drift to silly numbers.
  let dynamicSequence = 200

  function nextDynamicSequence(): number {
    const value = dynamicSequence
    dynamicSequence = (dynamicSequence + 1) & 0xff
    return value
  }

  // Simulated DroneCAN bus so the CAN inspector populates without hardware.
  // Activated by the runtime's MAV_CMD_CAN_FORWARD; answers GetNodeInfo /
  // param GetSet / ExecuteOpcode and broadcasts NodeStatus on the emitter tick.
  const dronecanSim = createDronecanBusSimulator()
  let dronecanBroadcastAccumMs = 0

  return {
    initialFrames: [
      codec.encode(
        envelope(1, {
          type: 'HEARTBEAT',
          autopilot: MAV_AUTOPILOT.ARDUPILOTMEGA,
          vehicleType: profile.vehicleType,
          baseMode: MAV_MODE_FLAG.CUSTOM_MODE_ENABLED,
          customMode: 0,
          systemStatus: MAV_STATE.STANDBY,
          mavlinkVersion: 3
        })
      ),
      codec.encode(
        envelope(2, {
          type: 'STATUSTEXT',
          severity: MAV_SEVERITY.INFO,
          text: profile.connectText,
          statusId: 0,
          chunkSequence: 0
        })
      ),
      codec.encode(envelope(3, sysStatusMessage(16420, 72))),
      codec.encode(envelope(4, rcChannelsMessage(1200))),
      codec.encode(envelope(5, attitudeMessage(1200))),
      codec.encode(envelope(6, globalPositionMessage(1200)))
    ],
    respondToOutbound: (frame) => {
      // The mock only decodes the message types it knows how to answer.
      // Frames it can't decode (e.g. SETUP_SIGNING / msgid 256, which has no
      // decoder and which a real FC consumes silently) are ignored rather
      // than crashing the response path.
      let outbound
      try {
        outbound = decodeSingleV2Envelope(frame)
      } catch {
        return []
      }
      const responses: Uint8Array[] = []

      switch (outbound.message.type) {
        case 'PARAM_REQUEST_LIST':
          responses.push(...buildParameterFrames(parameters))
          break
        case 'PARAM_SET': {
          const paramSet = outbound.message as ParamSetMessage
          parameters[paramSet.paramId] = paramSet.paramValue
          const parameterIndex = Object.keys(parameters).indexOf(paramSet.paramId)
          responses.push(
            codec.encode(
              envelope(100, {
                type: 'PARAM_VALUE',
                paramId: paramSet.paramId,
                paramValue: paramSet.paramValue,
                paramType: MAV_PARAM_TYPE.REAL32,
                paramCount: Object.keys(parameters).length,
                paramIndex: parameterIndex
              })
            )
          )
          responses.push(
            codec.encode(
              envelope(101, {
                type: 'STATUSTEXT',
                severity: MAV_SEVERITY.INFO,
                text: `Parameter ${paramSet.paramId} updated.`,
                statusId: 0,
                chunkSequence: 0
              })
            )
          )
          responses.push(
            codec.encode(
              envelope(102, {
                type: 'PARAM_VALUE',
                paramId: paramSet.paramId,
                paramValue: paramSet.paramValue,
                paramType: MAV_PARAM_TYPE.REAL32,
                paramCount: Object.keys(parameters).length,
                paramIndex: parameterIndex
              })
            )
          )
          break
        }
        case 'COMMAND_LONG':
          if (outbound.message.command === MAV_CMD.SET_MESSAGE_INTERVAL) {
            responses.push(
              codec.encode(
                envelope(90, {
                  type: 'COMMAND_ACK',
                  command: MAV_CMD.SET_MESSAGE_INTERVAL,
                  result: MAV_RESULT.ACCEPTED,
                  progress: 0,
                  resultParam2: 0,
                  targetSystem: outbound.header.systemId,
                  targetComponent: outbound.header.componentId
                })
              )
            )

            const requestedMessageId = Math.round(outbound.message.params[0] ?? 0)
            if (requestedMessageId === MAVLINK_MESSAGE_IDS.RC_CHANNELS) {
              responses.push(codec.encode(envelope(91, rcChannelsMessage(1600))))
            }
            if (requestedMessageId === MAVLINK_MESSAGE_IDS.SYS_STATUS) {
              responses.push(codec.encode(envelope(92, sysStatusMessage(16420, 72))))
            }
            if (requestedMessageId === MAVLINK_MESSAGE_IDS.ATTITUDE) {
              responses.push(codec.encode(envelope(93, attitudeMessage(1600))))
            }
            if (requestedMessageId === MAVLINK_MESSAGE_IDS.GLOBAL_POSITION_INT) {
              responses.push(codec.encode(envelope(94, globalPositionMessage(1600))))
            }
          } else if (
            outbound.message.command === MAV_CMD.REQUEST_MESSAGE &&
            Math.round(outbound.message.params[0] ?? 0) === MAVLINK_MESSAGE_IDS.AUTOPILOT_VERSION
          ) {
            responses.push(codec.encode(envelope(95, mockAutopilotVersion)))
          } else if (outbound.message.command === MAV_CMD.DO_MOTOR_TEST) {
            const targetIndex = Math.round(outbound.message.params[0] ?? 0)
            const throttlePercent = Number((outbound.message.params[2] ?? 0).toFixed(1))
            const durationSeconds = Number((outbound.message.params[3] ?? 0).toFixed(1))
            const motorCount = Math.max(Math.round(outbound.message.params[4] ?? 1), 1)
            const motorOrder = Math.round(outbound.message.params[5] ?? 0)
            responses.push(
              codec.encode(
                envelope(94, {
                  type: 'COMMAND_ACK',
                  command: MAV_CMD.DO_MOTOR_TEST,
                  result: MAV_RESULT.ACCEPTED,
                  progress: 0,
                  resultParam2: 0,
                  targetSystem: outbound.header.systemId,
                  targetComponent: outbound.header.componentId
                })
              )
            )
            responses.push(
              codec.encode(
                envelope(95, {
                  type: 'STATUSTEXT',
                  severity: MAV_SEVERITY.WARNING,
                  text:
                    motorCount > 1
                      ? `Motor test accepted for ${motorCount} motors in sequence at ${throttlePercent}% for ${durationSeconds}s each.`
                      : motorOrder === 2
                        ? `Motor test accepted for M${targetIndex} at ${throttlePercent}% for ${durationSeconds}s.`
                        : `Motor test accepted for target ${targetIndex} at ${throttlePercent}% for ${durationSeconds}s.`,
                  statusId: 0,
                  chunkSequence: 0
                })
              )
            )
          } else if (
            outbound.message.command === MAV_CMD.PREFLIGHT_CALIBRATION &&
            outbound.message.params[5] === 1
          ) {
            // CompassMot (compass/motor interference) — ACK + a couple of
            // progress STATUSTEXTs so the demo mirrors a real run.
            responses.push(
              codec.encode(
                envelope(110, {
                  type: 'COMMAND_ACK',
                  command: MAV_CMD.PREFLIGHT_CALIBRATION,
                  result: MAV_RESULT.ACCEPTED,
                  progress: 0,
                  resultParam2: 0,
                  targetSystem: outbound.header.systemId,
                  targetComponent: outbound.header.componentId
                })
              ),
              codec.encode(
                envelope(111, {
                  type: 'STATUSTEXT',
                  severity: MAV_SEVERITY.INFO,
                  text: 'CompassMot calibration started.',
                  statusId: 0,
                  chunkSequence: 0
                })
              ),
              codec.encode(
                envelope(112, {
                  type: 'STATUSTEXT',
                  severity: MAV_SEVERITY.INFO,
                  text: 'CompassMot: raise throttle to 50-75%.',
                  statusId: 0,
                  chunkSequence: 0
                })
              )
            )
          } else if (isAccelerometerCalibration(outbound.message)) {
            // Real ArduPilot waits for the operator to confirm each pose
            // before sending the next prompt. Emitting every STATUSTEXT in
            // one batch would let the UI race through all six steps before
            // tests could observe the intermediate pose-guide, so emit only
            // the first two STATUSTEXTs plus an ACCELCAL_VEHICLE_POS prompt
            // for the level step, then wait for the configurator's
            // COMMAND_ACK confirms.
            nextAccelPoseCommandValue = 1
            responses.push(
              codec.encode(
                envelope(101, {
                  type: 'COMMAND_ACK',
                  command: MAV_CMD.PREFLIGHT_CALIBRATION,
                  result: MAV_RESULT.ACCEPTED,
                  progress: 0,
                  resultParam2: 0,
                  targetSystem: outbound.header.systemId,
                  targetComponent: outbound.header.componentId
                })
              ),
              codec.encode(
                envelope(102, {
                  type: 'STATUSTEXT',
                  severity: MAV_SEVERITY.INFO,
                  text: 'Accelerometer calibration started.',
                  statusId: 0,
                  chunkSequence: 0
                })
              ),
              codec.encode(
                envelope(103, {
                  type: 'STATUSTEXT',
                  severity: MAV_SEVERITY.INFO,
                  text: 'Place vehicle level and keep it still.',
                  statusId: 0,
                  chunkSequence: 0
                })
              ),
              codec.encode(envelope(104, buildAccelPosePromptMessage(1)))
            )
          } else if (
            outbound.message.command === MAV_CMD.PREFLIGHT_CALIBRATION &&
            outbound.message.params[4] === 2
          ) {
            // Board-level (accel trim) calibration. Real ArduPilot runs the
            // trim sample inside the command handler and reports completion
            // *only* via the COMMAND_ACK result — no follow-up STATUSTEXT.
            // Mirror that exactly (ACK ACCEPTED, no STATUSTEXT) so the demo
            // exercises the same ack-completion path as real hardware.
            responses.push(
              codec.encode(
                envelope(120, {
                  type: 'COMMAND_ACK',
                  command: MAV_CMD.PREFLIGHT_CALIBRATION,
                  result: MAV_RESULT.ACCEPTED,
                  progress: 0,
                  resultParam2: 0,
                  targetSystem: outbound.header.systemId,
                  targetComponent: outbound.header.componentId
                })
              )
            )
          } else if (outbound.message.command === MAV_CMD.DO_START_MAG_CAL) {
            // Modern onboard mag cal. Ack the start, then
            // stream rising-percentage MAG_CAL_PROGRESS frames followed by a
            // SUCCESS MAG_CAL_REPORT so the guided action can run to
            // completion against the mock.
            responses.push(
              codec.encode(
                envelope(201, {
                  type: 'COMMAND_ACK',
                  command: MAV_CMD.DO_START_MAG_CAL,
                  result: MAV_RESULT.ACCEPTED,
                  progress: 0,
                  resultParam2: 0,
                  targetSystem: outbound.header.systemId,
                  targetComponent: outbound.header.componentId
                })
              ),
              codec.encode(
                envelope(202, {
                  type: 'STATUSTEXT',
                  severity: MAV_SEVERITY.INFO,
                  text: 'Compass calibration started. Rotate the vehicle through all axes.',
                  statusId: 0,
                  chunkSequence: 0
                })
              ),
              ...buildMagCalFrames()
            )
          } else if (
            outbound.message.command === MAV_CMD.DO_ACCEPT_MAG_CAL ||
            outbound.message.command === MAV_CMD.DO_CANCEL_MAG_CAL
          ) {
            // The runtime persists a non-autosaved fit with DO_ACCEPT_MAG_CAL
            // and tears down an in-flight cal with DO_CANCEL_MAG_CAL on reset;
            // both just need a plain accepted ack from the mock.
            responses.push(
              codec.encode(
                envelope(206, {
                  type: 'COMMAND_ACK',
                  command: outbound.message.command,
                  result: MAV_RESULT.ACCEPTED,
                  progress: 0,
                  resultParam2: 0,
                  targetSystem: outbound.header.systemId,
                  targetComponent: outbound.header.componentId
                })
              )
            )
          } else if (outbound.message.command === MAV_CMD.PREFLIGHT_REBOOT_SHUTDOWN) {
            responses.push(
              codec.encode(
                envelope(105, {
                  type: 'COMMAND_ACK',
                  command: MAV_CMD.PREFLIGHT_REBOOT_SHUTDOWN,
                  result: MAV_RESULT.ACCEPTED,
                  progress: 0,
                  resultParam2: 0,
                  targetSystem: outbound.header.systemId,
                  targetComponent: outbound.header.componentId
                })
              ),
              codec.encode(
                envelope(104, {
                  type: 'STATUSTEXT',
                  severity: MAV_SEVERITY.WARNING,
                  text: 'Autopilot reboot requested.',
                  statusId: 0,
                  chunkSequence: 0
                })
              )
            )
          } else if (outbound.message.command === MAV_CMD.PREFLIGHT_STORAGE) {
            // param1=2 → reset all parameters to defaults. Ack it so the
            // configurator's erase-settings flow completes.
            responses.push(
              codec.encode(
                envelope(106, {
                  type: 'COMMAND_ACK',
                  command: MAV_CMD.PREFLIGHT_STORAGE,
                  result: MAV_RESULT.ACCEPTED,
                  progress: 0,
                  resultParam2: 0,
                  targetSystem: outbound.header.systemId,
                  targetComponent: outbound.header.componentId
                })
              ),
              codec.encode(
                envelope(107, {
                  type: 'STATUSTEXT',
                  severity: MAV_SEVERITY.WARNING,
                  text: 'Parameters reset to defaults.',
                  statusId: 0,
                  chunkSequence: 0
                })
              )
            )
          }
          break
        case 'COMMAND_ACK': {
          // The configurator confirms each accelerometer pose by sending a
          // COMMAND_ACK with command=0 and result=TEMPORARILY_REJECTED (see
          // runtime.advanceAccelerometerCalibration). Treat that as the
          // signal to advance the mock to the next pose prompt.
          const ack = outbound.message as CommandAckMessage
          if (
            ack.command === 0 &&
            ack.result === MAV_RESULT.TEMPORARILY_REJECTED &&
            nextAccelPoseCommandValue > 0
          ) {
            const nextCommandValue = nextAccelPoseCommandValue + 1
            const promptText = accelPosePromptText(nextCommandValue)
            if (promptText) {
              nextAccelPoseCommandValue = nextCommandValue
              responses.push(
                codec.encode(
                  envelope(accelSequence++, {
                    type: 'STATUSTEXT',
                    severity: MAV_SEVERITY.INFO,
                    text: promptText,
                    statusId: 0,
                    chunkSequence: 0
                  })
                ),
                codec.encode(envelope(accelSequence++, buildAccelPosePromptMessage(nextCommandValue)))
              )
            } else {
              // Sixth pose confirmed — finish the calibration.
              nextAccelPoseCommandValue = 0
              responses.push(
                codec.encode(
                  envelope(accelSequence++, {
                    type: 'STATUSTEXT',
                    severity: MAV_SEVERITY.INFO,
                    text: 'Accelerometer calibration complete.',
                    statusId: 0,
                    chunkSequence: 0
                  })
                )
              )
            }
          }
          break
        }
        case 'FILE_TRANSFER_PROTOCOL': {
          const request = decodeFtpPayload((outbound.message as FileTransferProtocolMessage).payload)
          const ftpFrames =
            request.opcode === MAV_FTP_OPCODE.BURST_READ_FILE
              ? buildMockFtpBurstFrames(request, ftpSessions, ftpFiles)
              : [handleMockFtpRequest(request, ftpSessions, () => nextFtpSession++, ftpFiles)]
          for (const ftpFrame of ftpFrames) {
            responses.push(
              codec.encode(
                envelope(250, {
                  type: 'FILE_TRANSFER_PROTOCOL',
                  targetNetwork: 0,
                  targetSystem: outbound.header.systemId,
                  targetComponent: outbound.header.componentId,
                  payload: encodeFtpPayload(ftpFrame)
                })
              )
            )
          }
          break
        }
        case 'LOG_REQUEST_LIST':
          responses.push(...buildLogEntryFrames())
          break
        case 'LOG_REQUEST_DATA': {
          const request = outbound.message as LogRequestDataMessage
          responses.push(...buildLogDataFrames(request.id, request.ofs))
          break
        }
        case 'LOG_REQUEST_END':
          // Acknowledged by the FC leaving log-streaming mode; the mock has
          // no streaming state to tear down, so there is nothing to emit.
          break
        default:
          break
      }

      // DroneCAN inspector: MAV_CMD_CAN_FORWARD activates the bus simulator,
      // and forwarded service requests (GetNodeInfo / param GetSet /
      // ExecuteOpcode) get CAN_FRAME responses so nodes + params populate.
      for (const canFrame of dronecanSim.handleOutbound(outbound.message)) {
        responses.push(codec.encode(envelope(nextDynamicSequence(), canFrame)))
      }

      return responses
    },
    attachDynamicEmitter: (emit) => {
      if (!dynamicCadenceMs || dynamicCadenceMs <= 0) {
        // State machine disabled — preserve the static behavior.
        return () => {}
      }

      // Pin the first tick's wall-clock baseline so battery sag math is
      // independent of however long the test took to wire things up.
      dynamicState.startedAtMs = now()

      const timer = setInterval(() => {
        const frames = tickDynamicState(dynamicState, parameters, codec, nextDynamicSequence, now())
        for (const frame of frames) {
          emit(frame)
        }
        // Broadcast simulated DroneCAN NodeStatus at ~1 Hz (real-bus cadence)
        // once CAN forwarding is active, so the inspector discovers the nodes.
        dronecanBroadcastAccumMs += dynamicCadenceMs
        if (dronecanBroadcastAccumMs >= 1000) {
          dronecanBroadcastAccumMs = 0
          for (const canFrame of dronecanSim.broadcasts()) {
            emit(codec.encode(envelope(nextDynamicSequence(), canFrame)))
          }
        }
      }, dynamicCadenceMs)

      // Allow the host process to exit even if the demo bridge is still
      // running — important for the desktop bridge entrypoint.
      if (typeof (timer as { unref?: () => void }).unref === 'function') {
        ;(timer as { unref?: () => void }).unref?.()
      }

      return () => {
        clearInterval(timer)
      }
    }
  }
}

interface DynamicMockState {
  startedAtMs: number
  batteryVoltageV: number
  batteryRemainingPercent: number
  // Tracks how far through the sag profile we've progressed so we can floor
  // the voltage at BATT_CRT_VOLT and emit landing STATUSTEXT exactly once.
  batterySagStage: 'nominal' | 'low' | 'critical' | 'landed'
  rcLinkStage: 'healthy' | 'dropping' | 'recovering' | 'recovered'
  ekfStage: 'idle' | 'fired' | 'cleared'
  // Number of ticks observed. Used to schedule one-shot transitions
  // deterministically without relying on wall-clock math inside the test.
  tickCount: number
}

function createDynamicState(): DynamicMockState {
  return {
    startedAtMs: 0,
    // Start a hair above the low threshold so the very first tick already
    // moves the needle. Real ArduCopter flights start higher, but the
    // configurator demo wants visible motion within seconds.
    batteryVoltageV: 16.42,
    batteryRemainingPercent: 72,
    batterySagStage: 'nominal',
    rcLinkStage: 'healthy',
    ekfStage: 'idle',
    tickCount: 0
  }
}

function tickDynamicState(
  state: DynamicMockState,
  parameters: ParameterState,
  codec: MavlinkV2Codec,
  nextSequence: () => number,
  nowMs: number
): Uint8Array[] {
  state.tickCount += 1
  const frames: Uint8Array[] = []

  // --- Battery sag --------------------------------------------------------
  // Drop voltage by a fixed step until we cross BATT_LOW_VOLT, then
  // BATT_CRT_VOLT, then "land" and freeze. STATUSTEXT for each boundary.
  const lowThresholdV = parameters.BATT_LOW_VOLT ?? 14.4
  const criticalThresholdV = parameters.BATT_CRT_VOLT ?? 13.8
  const sagStepV = 0.18

  if (state.batterySagStage !== 'landed') {
    state.batteryVoltageV = Math.max(state.batteryVoltageV - sagStepV, criticalThresholdV)
    state.batteryRemainingPercent = Math.max(state.batteryRemainingPercent - 4, 5)

    if (state.batterySagStage === 'nominal' && state.batteryVoltageV <= lowThresholdV) {
      state.batterySagStage = 'low'
      frames.push(
        encodeStatusText(
          codec,
          nextSequence,
          MAV_SEVERITY.WARNING,
          'Battery 1 low: switch to land soon.'
        )
      )
    } else if (state.batterySagStage === 'low' && state.batteryVoltageV <= criticalThresholdV) {
      state.batterySagStage = 'critical'
      frames.push(
        encodeStatusText(
          codec,
          nextSequence,
          MAV_SEVERITY.CRITICAL,
          'Battery 1 critical: land immediately.'
        )
      )
    } else if (state.batterySagStage === 'critical') {
      // Hold at the critical threshold for a beat, then "land" and stop
      // sagging. The land step emits a final STATUSTEXT and freezes voltage.
      state.batterySagStage = 'landed'
      frames.push(
        encodeStatusText(
          codec,
          nextSequence,
          MAV_SEVERITY.INFO,
          'Landed safely. Battery sag held at critical threshold.'
        )
      )
    }
  }

  frames.push(
    codec.encode(
      envelope(
        nextSequence(),
        sysStatusMessage(
          Math.round(state.batteryVoltageV * 1000),
          state.batteryRemainingPercent
        )
      )
    )
  )

  // --- RC link blip -------------------------------------------------------
  // On the third tick, drop the RC link for one tick, then recover. The
  // configurator's liveVerification.rcInput.verified flips false when
  // channelCount is 0, so we send a zero-channel RC_CHANNELS frame.
  if (state.rcLinkStage === 'healthy' && state.tickCount === 3) {
    state.rcLinkStage = 'dropping'
    frames.push(encodeRcChannels(codec, nextSequence, nowMs - state.startedAtMs, true))
    frames.push(
      encodeStatusText(
        codec,
        nextSequence,
        MAV_SEVERITY.WARNING,
        'RC link lost: failsafe triggered.'
      )
    )
  } else if (state.rcLinkStage === 'dropping') {
    state.rcLinkStage = 'recovering'
    frames.push(encodeRcChannels(codec, nextSequence, nowMs - state.startedAtMs, false))
    frames.push(
      encodeStatusText(
        codec,
        nextSequence,
        MAV_SEVERITY.INFO,
        'RC link recovered.'
      )
    )
  } else if (state.rcLinkStage === 'recovering') {
    state.rcLinkStage = 'recovered'
  }

  // --- EKF action notice --------------------------------------------------
  // Fire once on the fourth tick. Reuses STATUSTEXT — the runtime's
  // failsafe banner reads any message containing "EKF" with a WARNING or
  // higher severity.
  if (state.ekfStage === 'idle' && state.tickCount === 4) {
    state.ekfStage = 'fired'
    const ekfAction = parameters.FS_EKF_ACTION ?? 1
    frames.push(
      encodeStatusText(
        codec,
        nextSequence,
        MAV_SEVERITY.WARNING,
        `EKF variance: FS_EKF_ACTION=${ekfAction} engaged.`
      )
    )
  } else if (state.ekfStage === 'fired') {
    state.ekfStage = 'cleared'
    frames.push(
      encodeStatusText(
        codec,
        nextSequence,
        MAV_SEVERITY.INFO,
        'EKF variance cleared.'
      )
    )
  }

  return frames
}

function encodeStatusText(
  codec: MavlinkV2Codec,
  nextSequence: () => number,
  severity: number,
  text: string
): Uint8Array {
  return codec.encode(
    envelope(nextSequence(), {
      type: 'STATUSTEXT',
      severity,
      text,
      statusId: 0,
      chunkSequence: 0
    })
  )
}

function encodeRcChannels(
  codec: MavlinkV2Codec,
  nextSequence: () => number,
  timeBootMs: number,
  dropped: boolean
): Uint8Array {
  if (dropped) {
    return codec.encode(
      envelope(nextSequence(), {
        type: 'RC_CHANNELS',
        timeBootMs: Math.max(0, timeBootMs),
        channelCount: 0,
        channels: [0, 0, 0, 0, 0, 0, 0, 0],
        rssi: 0
      })
    )
  }
  return codec.encode(envelope(nextSequence(), rcChannelsMessage(Math.max(0, timeBootMs))))
}

function isAccelerometerCalibration(message: CommandLongMessage): boolean {
  return message.command === MAV_CMD.PREFLIGHT_CALIBRATION && message.params[4] === 1
}

// Pose prompts mirror the STATUSTEXT strings real ArduPilot emits between
// ACCELCAL_VEHICLE_POS commands. The runtime keys its UI off these texts and
// off the accompanying ACCELCAL_VEHICLE_POS COMMAND_LONG (commandValue 1..6).
const ACCEL_POSE_PROMPT_TEXTS: Record<number, string> = {
  2: 'Place vehicle on its LEFT side.',
  3: 'Place vehicle on its RIGHT side.',
  4: 'Place vehicle nose down.',
  5: 'Place vehicle nose up.',
  6: 'Place vehicle on its back.'
}

function accelPosePromptText(commandValue: number): string | undefined {
  return ACCEL_POSE_PROMPT_TEXTS[commandValue]
}

function buildAccelPosePromptMessage(commandValue: number): CommandLongMessage {
  return {
    type: 'COMMAND_LONG',
    command: MAV_CMD.ACCELCAL_VEHICLE_POS,
    targetSystem: 0,
    targetComponent: 0,
    confirmation: 0,
    params: [commandValue, 0, 0, 0, 0, 0, 0]
  }
}

interface MockFtpPayload {
  seqNumber: number
  session: number
  opcode: number
  size: number
  reqOpcode: number
  burstComplete: number
  offset: number
  data: Uint8Array
}

function decodeFtpPayload(bytes: Uint8Array): MockFtpPayload {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const size = bytes[4] ?? 0
  return {
    seqNumber: view.getUint16(0, true),
    session: bytes[2] ?? 0,
    opcode: bytes[3] ?? 0,
    size,
    reqOpcode: bytes[5] ?? 0,
    burstComplete: bytes[6] ?? 0,
    offset: view.getUint32(8, true),
    data: bytes.slice(12, 12 + size)
  }
}

function encodeFtpPayload(payload: MockFtpPayload): Uint8Array {
  const bytes = new Uint8Array(251)
  const view = new DataView(bytes.buffer)
  view.setUint16(0, payload.seqNumber, true)
  bytes[2] = payload.session & 0xff
  bytes[3] = payload.opcode & 0xff
  bytes[4] = payload.size & 0xff
  bytes[5] = payload.reqOpcode & 0xff
  bytes[6] = payload.burstComplete & 0xff
  view.setUint32(8, payload.offset >>> 0, true)
  bytes.set(payload.data.slice(0, Math.min(payload.size, 239)), 12)
  return bytes
}

function handleMockFtpRequest(
  request: MockFtpPayload,
  sessions: Map<number, { path: string; mode: 'read' | 'write' }>,
  allocateSession: () => number,
  files: MockFtpFileMap
): MockFtpPayload {
  switch (request.opcode) {
    case MAV_FTP_OPCODE.LIST_DIRECTORY: {
      const path = normalizeMockFtpPath(new TextDecoder().decode(request.data).replace(/\0+$/, ''))
      const entries = listMockDirectoryEntries(files, path)
      if (!entries) {
        return ftpNak(request, MAV_FTP_ERR.FILE_NOT_FOUND)
      }
      if (request.offset >= entries.length) {
        return ftpNak(request, MAV_FTP_ERR.EOF)
      }

      const data = encodeMockDirectoryEntries(entries, request.offset)
      if (data.length === 0) {
        return ftpNak(request, MAV_FTP_ERR.EOF)
      }

      return ftpAck(request, {
        size: data.length,
        offset: request.offset,
        data
      })
    }
    case MAV_FTP_OPCODE.OPEN_FILE_RO: {
      const path = normalizeMockFtpPath(new TextDecoder().decode(request.data).replace(/\0+$/, ''))
      const fileBytes = files.get(path)
      if (!fileBytes) {
        return ftpNak(request, MAV_FTP_ERR.FILE_NOT_FOUND)
      }

      const session = allocateSession()
      sessions.set(session, { path, mode: 'read' })
      const data = new Uint8Array(4)
      // ArduPilot `@`-mounted virtual files (@SYS/@PARAM/…) are generated
      // on the fly and report size 0 on OPEN; the client must read them
      // until the EOF NAK. Real files report their length. Mirror that so
      // the mock exercises the read-until-EOF termination path.
      const reportedSize = path.startsWith('@') ? 0 : fileBytes.length
      new DataView(data.buffer).setUint32(0, reportedSize, true)
      return ftpAck(request, {
        session,
        size: 4,
        data
      })
    }
    case MAV_FTP_OPCODE.READ_FILE: {
      const session = sessions.get(request.session)
      if (!session || session.mode !== 'read') {
        return ftpNak(request, MAV_FTP_ERR.INVALID_SESSION)
      }
      const fileBytes = files.get(session.path)
      if (!fileBytes) {
        return ftpNak(request, MAV_FTP_ERR.FILE_NOT_FOUND)
      }
      if (request.offset >= fileBytes.length) {
        return ftpNak(request, MAV_FTP_ERR.EOF)
      }

      const end = Math.min(request.offset + request.size, fileBytes.length)
      const data = fileBytes.slice(request.offset, end)
      return ftpAck(request, {
        session: request.session,
        size: data.length,
        offset: request.offset,
        data
      })
    }
    case MAV_FTP_OPCODE.CREATE_FILE: {
      const path = normalizeMockFtpPath(new TextDecoder().decode(request.data).replace(/\0+$/, ''))
      const parentPath = parentMockFtpPath(path)
      if (!parentPath || !directoryExists(files, parentPath)) {
        return ftpNak(request, MAV_FTP_ERR.FILE_NOT_FOUND)
      }
      if (files.has(path)) {
        return ftpNak(request, MAV_FTP_ERR.FILE_EXISTS)
      }

      const session = allocateSession()
      files.set(path, new Uint8Array(0))
      sessions.set(session, { path, mode: 'write' })
      return ftpAck(request, {
        session
      })
    }
    case MAV_FTP_OPCODE.WRITE_FILE: {
      const session = sessions.get(request.session)
      if (!session || session.mode !== 'write') {
        return ftpNak(request, MAV_FTP_ERR.INVALID_SESSION)
      }

      const currentBytes = files.get(session.path) ?? new Uint8Array(0)
      const writeBytes = request.data.slice(0, request.size)
      const nextBytes = new Uint8Array(Math.max(currentBytes.length, request.offset + writeBytes.length))
      nextBytes.set(currentBytes)
      nextBytes.set(writeBytes, request.offset)
      files.set(session.path, nextBytes)
      return ftpAck(request, {
        session: request.session
      })
    }
    case MAV_FTP_OPCODE.REMOVE_FILE: {
      const path = normalizeMockFtpPath(new TextDecoder().decode(request.data).replace(/\0+$/, ''))
      if (!files.has(path)) {
        return ftpNak(request, MAV_FTP_ERR.FILE_NOT_FOUND)
      }
      files.delete(path)
      return ftpAck(request)
    }
    case MAV_FTP_OPCODE.REMOVE_DIRECTORY: {
      const path = normalizeMockFtpPath(new TextDecoder().decode(request.data).replace(/\0+$/, ''))
      if (!directoryExists(files, path)) {
        return ftpNak(request, MAV_FTP_ERR.FILE_NOT_FOUND)
      }
      if (path === '@SYS' || listMockDirectoryEntries(files, path)?.length) {
        return ftpNak(request, MAV_FTP_ERR.FAIL)
      }
      return ftpAck(request)
    }
    case MAV_FTP_OPCODE.TERMINATE_SESSION:
      sessions.delete(request.session)
      return ftpAck(request, {
        session: request.session
      })
    case MAV_FTP_OPCODE.RESET_SESSIONS:
      sessions.clear()
      return ftpAck(request)
    default:
      return ftpNak(request, MAV_FTP_ERR.UNKNOWN_COMMAND)
  }
}

// BURST_READ_FILE streams many data packets per request (unlike READ_FILE's
// one-chunk-per-round-trip), so it returns an array of frames rather than a
// single response. The mock streams the whole file from the requested offset
// in one burst and sets burstComplete on the final packet.
function buildMockFtpBurstFrames(
  request: MockFtpPayload,
  sessions: Map<number, { path: string; mode: 'read' | 'write' }>,
  files: MockFtpFileMap
): MockFtpPayload[] {
  const session = sessions.get(request.session)
  if (!session || session.mode !== 'read') {
    return [ftpNak(request, MAV_FTP_ERR.INVALID_SESSION)]
  }
  const fileBytes = files.get(session.path)
  if (!fileBytes) {
    return [ftpNak(request, MAV_FTP_ERR.FILE_NOT_FOUND)]
  }
  if (request.offset >= fileBytes.length) {
    return [ftpNak(request, MAV_FTP_ERR.EOF)]
  }

  const chunkSize = request.size > 0 ? Math.min(request.size, 239) : 239
  const frames: MockFtpPayload[] = []
  let offset = request.offset
  while (offset < fileBytes.length) {
    const end = Math.min(offset + chunkSize, fileBytes.length)
    const data = fileBytes.slice(offset, end)
    frames.push(
      ftpAck(request, {
        session: request.session,
        size: data.length,
        offset,
        data,
        burstComplete: end >= fileBytes.length ? 1 : 0
      })
    )
    offset = end
  }
  return frames
}

// Deterministic dataflash-log bytes so a burst download has stable content to
// assert against. Sizes are chosen to span several 239-byte burst packets.
function makeMockLogBytes(seed: number, length: number): Uint8Array {
  const bytes = new Uint8Array(length)
  for (let index = 0; index < length; index += 1) {
    bytes[index] = (index + seed) & 0xff
  }
  return bytes
}

function createMockFtpFiles(): MockFtpFileMap {
  return new Map<string, Uint8Array>([
    ['@SYS/uarts.txt', mockUartsBytes.slice()],
    ['@SYS/timers.txt', mockTimersBytes.slice()],
    ['@SYS/scripts/autorun.lua', mockAutorunScriptBytes.slice()],
    ['@SYS/scripts/hello.lua', mockHelloScriptBytes.slice()],
    // Onboard dataflash logs, downloaded via BURST_READ_FILE from /APM/LOGS.
    ['/APM/LOGS/00000001.BIN', makeMockLogBytes(1, 600)],
    ['/APM/LOGS/00000002.BIN', makeMockLogBytes(2, 528)]
  ])
}

function normalizeMockFtpPath(path: string): string {
  const trimmed = path.trim()
  if (!trimmed) {
    return '@SYS'
  }
  if (trimmed === '/') {
    return trimmed
  }
  const collapsed = trimmed.replace(/\/+/g, '/')
  if (/^@[A-Za-z0-9_-]+$/.test(collapsed)) {
    return collapsed
  }
  return collapsed.replace(/\/+$/, '')
}

function parentMockFtpPath(path: string): string | undefined {
  const normalizedPath = normalizeMockFtpPath(path)
  if (normalizedPath === '/' || /^@[A-Za-z0-9_-]+$/.test(normalizedPath)) {
    return undefined
  }
  const separatorIndex = normalizedPath.lastIndexOf('/')
  return separatorIndex > 0 ? normalizedPath.slice(0, separatorIndex) : undefined
}

function directoryExists(files: MockFtpFileMap, path: string): boolean {
  const normalizedPath = normalizeMockFtpPath(path)
  if (normalizedPath === '@SYS') {
    return true
  }
  const prefix = `${normalizedPath}/`
  return [...files.keys()].some((filePath) => filePath.startsWith(prefix))
}

function listMockDirectoryEntries(files: MockFtpFileMap, path: string): Array<{ kind: 'file' | 'directory'; name: string; sizeBytes?: number }> | undefined {
  const normalizedPath = normalizeMockFtpPath(path)
  if (!directoryExists(files, normalizedPath)) {
    return undefined
  }

  const prefix = normalizedPath === '/' ? '/' : `${normalizedPath}/`
  const entries = new Map<string, { kind: 'file' | 'directory'; name: string; sizeBytes?: number }>()

  files.forEach((bytes, filePath) => {
    if (!filePath.startsWith(prefix)) {
      return
    }

    const remainder = filePath.slice(prefix.length)
    if (!remainder) {
      return
    }

    const slashIndex = remainder.indexOf('/')
    if (slashIndex === -1) {
      entries.set(remainder, {
        kind: 'file',
        name: remainder,
        sizeBytes: bytes.length
      })
      return
    }

    const directoryName = remainder.slice(0, slashIndex)
    if (!entries.has(directoryName)) {
      entries.set(directoryName, {
        kind: 'directory',
        name: directoryName
      })
    }
  })

  return [...entries.values()].sort((left, right) => {
    if (left.kind !== right.kind) {
      return left.kind === 'directory' ? -1 : 1
    }
    return left.name.localeCompare(right.name, undefined, { sensitivity: 'base', numeric: true })
  })
}

function encodeMockDirectoryEntries(
  entries: Array<{ kind: 'file' | 'directory'; name: string; sizeBytes?: number }>,
  offset: number
): Uint8Array {
  const encoder = new TextEncoder()
  const parts: string[] = []

  for (let index = offset; index < entries.length; index += 1) {
    const entry = entries[index]
    const token = entry.kind === 'directory' ? `D${entry.name}` : `F${entry.name}\t${entry.sizeBytes ?? 0}`
    const nextParts = [...parts, token]
    if (encoder.encode(nextParts.join('\0')).length > 200) {
      break
    }
    parts.push(token)
  }

  return encoder.encode(parts.join('\0'))
}

// The MAVLink FTP server replies with request seq + 1 (ArduPilot
// GCS_FTP.cpp `reply.seq_number = request.seq_number + 1`).
function ftpResponseSeq(request: MockFtpPayload): number {
  return (request.seqNumber + 1) & 0xffff
}

function ftpAck(
  request: MockFtpPayload,
  overrides: Partial<Omit<MockFtpPayload, 'seqNumber' | 'opcode' | 'reqOpcode'>> = {}
): MockFtpPayload {
  return {
    seqNumber: ftpResponseSeq(request),
    session: overrides.session ?? request.session,
    opcode: MAV_FTP_OPCODE.ACK,
    size: overrides.size ?? 0,
    reqOpcode: request.opcode,
    burstComplete: overrides.burstComplete ?? 0,
    offset: overrides.offset ?? request.offset,
    data: overrides.data ?? new Uint8Array(0)
  }
}

function ftpNak(request: MockFtpPayload, errorCode: number): MockFtpPayload {
  return {
    seqNumber: ftpResponseSeq(request),
    session: request.session,
    opcode: MAV_FTP_OPCODE.NAK,
    size: 1,
    reqOpcode: request.opcode,
    burstComplete: 0,
    offset: request.offset,
    data: new Uint8Array([errorCode])
  }
}
