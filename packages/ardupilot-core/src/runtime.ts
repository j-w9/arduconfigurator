import type {
  FirmwareMetadataBundle,
  GuidedActionId,
  LiveSignalId,
} from '@arduconfig/param-metadata'
import type {
  GpsRawIntMessage,
  AttitudeMessage,
  ScaledImuMessage,
  AttitudeQuaternionMessage,
  AutopilotVersionMessage,
  CommandAckMessage,
  CommandLongMessage,
  GlobalPositionIntMessage,
  HeartbeatMessage,
  MavlinkEnvelope,
  ParamValueMessage,
  RcChannelsMessage,
  OpticalFlowMessage,
  DistanceSensorMessage,
  EscTelemetryMessage,
  StatusTextMessage,
  SysStatusMessage,
  UavcanNodeInfoMessage,
  UavcanNodeStatusMessage,
} from '@arduconfig/protocol-mavlink'
import type { MavlinkSignatureRejection } from '@arduconfig/protocol-mavlink'
import {
  MAV_PROTOCOL_CAPABILITY,
  MAV_CMD,
  MAV_PARAM_TYPE,
  MAV_RESULT,
  MAVLINK_MESSAGE_IDS,
  MAVLINK_V2_SIGNING_KEY_LENGTH,
  MavlinkSession,
  currentSigningTimestamp,
  deriveSigningKeyFromPassphrase,
} from '@arduconfig/protocol-mavlink'
import type { TransportStatus, Unsubscribe } from '@arduconfig/transport'

import type {
  BoardFileState,
  CanNodeState,
  HardwareBoardState,
  ConfiguratorSnapshot,
  GuidedActionState,
  MotorTestRequest,
  MotorTestStopResult,
  PreArmIssueState,
  PreArmLiveCheckState,
  PreArmStatusState,
  ParameterBatchWriteResult,
  ParameterBatchWriteProgress,
  ParameterState,
  ParameterSyncState,
  ParameterWriteOptions,
  ParameterWriteRequest,
  ParameterWriteResult,
  SetupSectionState,
  SetupStatus,
  StatusTextEntry,
  VehicleIdentity,
} from './types.js'
import {
  boardTypeFromBoardVersion,
  formatAutopilotUid,
  formatFlightSwVersion,
  parseFlightSwVersion,
  formatFlightCustomVersion,
  parseUartsFile,
  type MavftpDirectoryEntry,
} from './mavftp.js'
import { applyArducopter47Override } from './firmware-overrides.js'
import { LEGACY_PARAM_ALIASES, MODERN_TO_LEGACY_ALIASES } from './parameter-aliases.js'
import { listMavftpLogFiles } from './mavftp-log-directories.js'
import { VTX_TABLE_FTP_PATH, parseVtxTable, serializeVtxTable, type VtxTable } from './vtx-table.js'
import {
  OSD_SHORTHAND_FTP_PATH,
  parseOsdShorthand,
  serializeOsdShorthand,
  type OsdShorthand
} from './osd-shorthand.js'
import {
  BOOTLOADER_IMAGE_FETCH_TIMEOUT_MS,
  EMBEDDED_BOOTLOADER_FTP_PATH,
  FLASH_REGION_FTP_PATH,
  MAX_BOOTLOADER_IMAGE_BYTES,
  describeBootloaderReadFailure,
  type BootloaderImagePair
} from './bootloader-images.js'
import { CanBusService } from './runtime-can-bus-service.js'
import { GuidedActionService } from './runtime-guided-action-service.js'
import { LogDownloadService, type LogDownloadProgress, type OnboardLogInfo } from './runtime-log-download-service.js'
import { MavftpService } from './runtime-mavftp-service.js'
import { MotorTestService } from './runtime-motor-test-service.js'
import type { MotorTestEligibilityOptions } from './motor-test.js'
import {
  ParameterSyncWaiterSet,
  ParameterValueWaiterSet
} from './runtime-parameter-waiters.js'
import {
  UARTS_FILE_PATH,
  approximatelyEqualParameterValue,
  canNodeHealthFromCode,
  canNodeModeFromCode,
  cloneBoardFileState,
  cloneGuidedActions,
  cloneHardwareState,
  parsePwmOutputCountFromBanner,
  cloneLiveVerification,
  cloneMotorTestState,
  clonePreArmStatus,
  createIdleLiveVerification,
  createIdleParameterSync,
  createIdleUartsFileState,
  createVehicleIdentity,
  formatParameterValueForLog,
  isAuthoritativeHeartbeat,
  isPwmChannelValue,
  isValidGlobalCoordinates,
  liveSignalLabel,
  mavCommandLabel,
  mavResultLabel,
  normalizePreArmIssueText,
  radiansToDegrees,
  recomputeSatisfiedSignals,
  severityName
} from './runtime-helpers.js'

type UpdateListener = (snapshot: ConfiguratorSnapshot) => void

interface VehicleWaiter {
  resolve: (vehicle: VehicleIdentity) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

interface CommandAckWaiter {
  command: number
  rejectOnFailure: boolean
  resolve: (message: CommandAckMessage) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
  /**
   * Progress beat (MAV_RESULT_IN_PROGRESS): per the MAVLink command
   * protocol the operation timeout resets on each IN_PROGRESS ACK and the
   * final result arrives in a later ACK — so this re-arms the timer and
   * remembers the ACK instead of settling the waiter.
   */
  noteInProgress: (message: CommandAckMessage) => void
  lastInProgress?: CommandAckMessage
}

interface AutopilotVersionWaiter {
  resolve: (board: HardwareBoardState) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

interface WaiterHandle<T> {
  promise: Promise<T>
  cancel: (error: Error) => void
}

export interface WaitForVehicleOptions {
  timeoutMs?: number
}

export interface RequestParameterListOptions extends WaitForVehicleOptions {
  /**
   * Force a clean download, ignoring any partial table carried over from a
   * link that dropped mid-sync. Required after anything that can change what
   * the table holds — a firmware flash, a defaults reset, a reboot into new
   * firmware — where inheriting the previous board state would be wrong.
   */
  fresh?: boolean
}

export interface WaitForParameterSyncOptions {
  timeoutMs?: number
}

export interface ArduPilotConfiguratorRuntimeOptions {
  accelerometerInitialWarmupMs?: number
  accelerometerStepAdvanceMs?: number
  accelerometerCompletionFallbackMs?: number
  compassGuidanceTimeoutMs?: number
  /**
   * Test-injectable override for the param-sync stall-retry timer
   * (default PARAMETER_SYNC_STALL_RETRY_MS = 1500ms). Tests use a
   * tiny value (~30ms) so the retry path can be exercised without a
   * 1.5s real-time wait per case. Production callers leave this unset.
   */
  parameterSyncStallRetryMs?: number
  /**
   * Test-injectable overrides for the MAV_CMD_RUN_PREARM_CHECKS poll
   * (defaults PRE_ARM_REFRESH_INTERVAL_MS = 3000ms and
   * PRE_ARM_ISSUE_TTL_POLLED_MS = 8000ms). Tests shrink both so the
   * poll-and-expire cycle runs in milliseconds instead of seconds.
   * Production callers leave these unset.
   */
  preArmRefreshIntervalMs?: number
  preArmIssueTtlPolledMs?: number
  /**
   * Firmware-specific metadata bundles. When an authoritative heartbeat
   * identifies the connected vehicle, the runtime swaps to the matching
   * bundle here (if present) and re-emits so derived setup/category state
   * picks up the right catalog. Callers that omit this keep the single
   * constructor bundle regardless of the detected vehicle.
   */
  metadataByVehicle?: Partial<Record<'ArduCopter' | 'ArduPlane' | 'ArduRover' | 'ArduSub', FirmwareMetadataBundle>>
}

// A real flight controller can take well over 5s to emit its first HEARTBEAT
// (peripheral/compass/GPS init), so 20s covers a realistic cold boot. Tests
// pass their own short timeoutMs.
// SCRIPTING_CMD values (ardupilotmega.xml). Only the two AP_Scripting actually
// accepts — REPL_START (0) / REPL_STOP (1) return MAV_RESULT_DENIED.
/** MAV_CMD_FLASH_BOOTLOADER param5. GCS_Common.cpp rejects anything else with
 *  "Magic not set" — it exists so a stray command cannot rewrite a bootloader. */
const FLASH_BOOTLOADER_MAGIC = 290876
const SCRIPTING_CMD_STOP = 2
const SCRIPTING_CMD_STOP_AND_RESTART = 3

const DEFAULT_HEARTBEAT_TIMEOUT_MS = 20000
const DEFAULT_PARAMETER_SYNC_TIMEOUT_MS = 20000
const PARAMETER_SYNC_STALL_RETRY_MS = 1500
// Consecutive no-progress stall passes before the retry interval starts backing
// off. The retry itself is NOT capped: a board that watchdog-resets mid-download
// is silent for far longer than a few passes, and giving up permanently left the
// operator with a partial table and no way back short of a reconnect (field
// repro: a 4.8-dev board resetting on every connect never delivered a single
// full table, while a GCS that retries indefinitely pulled it off fine).
const PARAMETER_SYNC_BACKOFF_AFTER_PASSES = 3
// Ceiling for the backed-off stall interval. Slow enough not to spam a dead
// link, fast enough to catch a board the moment it finishes rebooting.
const MAX_PARAMETER_SYNC_STALL_RETRY_MS = 8000
// How long a partial table carried over from a dropped link stays eligible for
// resume. Long enough to cover a watchdog reboot + USB re-enumeration + the
// operator re-connecting; short enough that it can't silently resurface hours
// later against a board that has since been reflashed.
const PARAMETER_CARRY_OVER_TTL_MS = 10 * 60 * 1000
// Cap on how many PARAM_REQUEST_READ frames a single gap-fill pass emits, so a
// pathological gap streams in bounded bursts rather than thousands at once. The
// real-world gap is a handful of dropped frames; any remainder rolls to the
// next stall-retry pass.
const MAX_PARAMETER_GAP_FILL_PER_PASS = 256
// Above this share of the table missing, a full re-stream beats by-index
// refetch. See the reasoning at the canGapFill decision — bulk measured 13x
// faster than gap-fill on the same link when most of the table was absent.
const PARAMETER_GAP_FILL_MAX_FRACTION = 0.2
// Below this many missing parameters the fraction rule does not apply at all —
// a small table with a couple of holes is the case by-index refetch is FOR, and
// re-streaming it would be slower, not faster.
const MIN_MISSING_FOR_FRACTION_RESTREAM = 64
// Hard upper bound on emit() coalescing. requestAnimationFrame is suspended
// in a backgrounded tab, so a setTimeout fallback at this bound guarantees a
// coalesced terminal snapshot still reaches the UI.
const EMIT_COALESCE_MAX_MS = 250
const DEFAULT_COMMAND_ACK_TIMEOUT_MS = 3000
const DEFAULT_AUTOPILOT_VERSION_TIMEOUT_MS = 3000
// The @SYS/uarts.txt enrichment read is a benign, non-control-path MAVFTP
// read; give it a generous budget since the default is tight on a contended
// USB link.
const UARTS_FETCH_TIMEOUT_MS = 15000
// Cap a MAVFTP log download the same way the LOG_* path caps its allocation
// (MAX_LOG_DOWNLOAD_BYTES) — logs dwarf the @SYS files the default cap targets.
const MAX_MAVFTP_LOG_BYTES = 512 * 1024 * 1024
// ArduPilot only re-emits a failing pre-arm check roughly every ~30s, so a short
// TTL let the reason expire between sends and the UI flipped to "Clear" while the
// FC still refused to arm. Hold each reason long enough to survive the gap (a
// still-failing check is re-sent and refreshed; a resolved one ages out).
const PRE_ARM_ISSUE_TTL_MS = 60000
// ...unless we are driving the reports ourselves. MAV_CMD_RUN_PREARM_CHECKS
// makes the vehicle re-run its checks and re-report every failure on demand, so
// while that poll is answering, a reason that misses two consecutive rounds has
// genuinely cleared rather than merely gone quiet. Without this an operator who
// fixes one of three failures watches the fixed one linger for the best part of
// a minute.
const PRE_ARM_REFRESH_INTERVAL_MS = 3000
const PRE_ARM_ISSUE_TTL_POLLED_MS = 8000
// MAV_SYS_STATUS_PREARM_CHECK (common.xml, value 268435456). ArduPilot sets it
// present whenever arming is compiled in, enabled when ARMING_CHECK != 0, and
// healthy when the last 1 Hz pre-arm run passed or the vehicle is armed
// (libraries/GCS_MAVLink/GCS.cpp). This is the live fail→pass signal that
// STATUSTEXT does not provide.
const MAV_SYS_STATUS_PREARM_CHECK = 0x10000000
// SYS_STATUS is requested at 2 Hz, so four missed frames means the stream is
// genuinely gone (link loss, a GCS that re-rated the stream) rather than jitter.
// Past that we stop claiming a live verdict and fall back to the latched
// reasons — an aged truth beats a confidently wrong "Clear".
const PRE_ARM_LIVE_CHECK_TTL_MS = 5000
const STATUS_TEXT_HISTORY_LIMIT = 500
// STATUSTEXT v2 chunking parameters. ArduPilot splits messages
// of >50 chars into chunks of EXACTLY 50 chars (the legacy v1 payload
// size) until a final shorter chunk completes the message. End-of-message
// is detected either by a chunk shorter than 50 (the common case) or
// by a time-based flush so an incomplete burst doesn't sit hidden
// forever. The DoS caps keep a malformed / hostile sender from filling
// memory with an unbounded number of in-flight statusIds.
const STATUSTEXT_CHUNK_SIZE = 50
const STATUSTEXT_CHUNK_TIMEOUT_MS = 2000
const STATUSTEXT_MAX_IN_FLIGHT_BUFFERS = 16
const STATUSTEXT_MAX_CHUNKS_PER_BUFFER = 32
// Param-rename shim: ArduPilot renamed several long-standing parameters to
// the per-instance form (e.g. GPS_TYPE -> GPS1_TYPE in 4.5+). Bidirectional
// map (legacy -> modern): the runtime mirrors a reported value under the
// other id so lookups via either name resolve, and forwards a legacy-id write
// under the modern name when that's what the FC exposes. Only renames where
// units AND range are identical are listed — value-changing renames are NOT,
// since mirroring the raw value would be wrong.
// DroneCAN node lifecycle thresholds.
//   - REFRESH_DEBOUNCE: minimum interval between MAV_CMD_UAVCAN_GET_NODE_INFO
//     broadcasts, so the bridge isn't asked again immediately if NODE_INFO
//     keeps not arriving for a node.
//   - OFFLINE_AFTER: how long a node's last NODE_STATUS may age before the
//     UI flips it to 'offline'. NODE_STATUS streams at 1 Hz, so 3s catches a
//     real outage without flapping on a single missed frame.
//   - REMOVE_AFTER: after this much silence the node disappears from the
//     snapshot. Set generously so a momentary CAN glitch doesn't lose
//     identity data we'd then have to re-discover.
//   - SWEEP_INTERVAL: how often the staleness sweep runs.
const CAN_NODE_INFO_REFRESH_DEBOUNCE_MS = 5000
const CAN_NODE_OFFLINE_AFTER_MS = 3000
const CAN_NODE_REMOVE_AFTER_MS = 30000
const CAN_NODE_STALE_SWEEP_INTERVAL_MS = 1000

// AP_Proximity.h: PROXIMITY_SENSOR_ID_START. AP_Proximity publishes its
// 360-degree sectors as DISTANCE_SENSOR messages with ids from this value
// upwards, sharing the message with real rangefinder instances (ids 0..9,
// where the id IS the backend instance). Anything at or above this is an
// avoidance sector, not the downward lidar the Status card reports.
const PROXIMITY_SENSOR_ID_START = 10
const LIVE_TELEMETRY_REQUESTS = [
  {
    // The RAW receiver report. Distinct from GLOBAL_POSITION_INT, which only
    // appears once the EKF has a position: GPS_RAW_INT arrives as soon as a
    // module is talking to the driver, fix or no fix, so "configured but
    // nothing wired up" stops looking identical to "working GPS, no fix yet".
    // 1 Hz is plenty for a detection + sat-count readout.
    messageId: MAVLINK_MESSAGE_IDS.GPS_RAW_INT,
    label: 'GPS_RAW_INT',
    intervalUs: 1000000
  },
  {
    messageId: MAVLINK_MESSAGE_IDS.GLOBAL_POSITION_INT,
    label: 'GLOBAL_POSITION_INT',
    // 5 Hz — smooth position updates for the Live GPS map without being
    // wasteful over a telemetry link.
    intervalUs: 200000
  },
  {
    messageId: MAVLINK_MESSAGE_IDS.ATTITUDE,
    label: 'ATTITUDE',
    intervalUs: 25000
  },
  {
    // Quaternion attitude for the craft view (singularity-free near vertical).
    // Same 40 Hz cadence as ATTITUDE; ATTITUDE still drives the numeric
    // roll/pitch/heading readouts and the heading tape.
    messageId: MAVLINK_MESSAGE_IDS.ATTITUDE_QUATERNION,
    label: 'ATTITUDE_QUATERNION',
    intervalUs: 25000
  },
  {
    // Primary IMU temperature for the thermal-calibration (TCAL) readout.
    // 1 Hz — temperature changes slowly; negligible bandwidth.
    messageId: MAVLINK_MESSAGE_IDS.SCALED_IMU,
    label: 'SCALED_IMU',
    intervalUs: 1000000
  },
  {
    messageId: MAVLINK_MESSAGE_IDS.RC_CHANNELS,
    label: 'RC_CHANNELS',
    intervalUs: 50000
  },
  {
    messageId: MAVLINK_MESSAGE_IDS.SYS_STATUS,
    label: 'SYS_STATUS',
    intervalUs: 500000
  },
  // DroneCAN node discovery needs UAVCAN_NODE_STATUS (msgid 310), which
  // ArduPilot does not include in any default stream and must be requested
  // explicitly. The 1 Hz interval matches DroneCAN's native NodeStatus
  // cadence.
  {
    messageId: MAVLINK_MESSAGE_IDS.UAVCAN_NODE_STATUS,
    label: 'UAVCAN_NODE_STATUS',
    intervalUs: 1000000
  },
  // MAG_CAL_PROGRESS/REPORT ride the EXTRA3 stream group and must be
  // requested explicitly; ArduPilot only fills them while a calibrator runs.
  {
    messageId: MAVLINK_MESSAGE_IDS.MAG_CAL_PROGRESS,
    label: 'MAG_CAL_PROGRESS',
    intervalUs: 500000
  },
  {
    messageId: MAVLINK_MESSAGE_IDS.MAG_CAL_REPORT,
    label: 'MAG_CAL_REPORT',
    intervalUs: 1000000
  },
  // Rangefinder + optical flow both live in STREAM_EXTRA3
  // (libraries/GCS_MAVLink/GCS_MAVLink_Parameters.cpp), which ArduPilot does
  // NOT stream unless a GCS asks for it. Without these two entries the
  // Status & Info sensor cards render perfectly in demo mode — the mock
  // scenario emits whatever it likes — and are stone dead on a real FC.
  // That is the exact failure this feature must not ship: an operator
  // checking a sensor would read our silence as "sensor broken".
  {
    // The per-instance rangefinder report. Chosen over RANGEFINDER (msgid
    // 173) because send_distance_sensor() skips a backend whose has_data()
    // is false, so no-message genuinely means no-data — see
    // RangefinderSensorState in types.ts for the full justification.
    // 5 Hz: fast enough that an operator waving a hand under the craft sees
    // the number track their hand, slow enough to be free on a 57k6 link
    // (39-byte payload × a handful of instances).
    messageId: MAVLINK_MESSAGE_IDS.DISTANCE_SENSOR,
    label: 'DISTANCE_SENSOR',
    intervalUs: 200000
  },
  {
    // OPTICAL_FLOW was already decoded and already drove the header Flow
    // chip, but was never requested — so on real hardware that chip could
    // only ever be grey. Requesting it here is what makes both the chip and
    // the new flow card work off a flight controller instead of the mock.
    // 5 Hz matches the rangefinder cadence; flow quality is the number an
    // operator watches while they change lighting or height.
    messageId: MAVLINK_MESSAGE_IDS.OPTICAL_FLOW,
    label: 'OPTICAL_FLOW',
    intervalUs: 200000
  },
  {
    // ESC telemetry rides STREAM_EXTRA1 (MSG_ESC_TELEMETRY,
    // GCS_MAVLink_Parameters.cpp:313), so like the two above it never arrives
    // unless we ask. Requesting only the 1_TO_4 id is deliberate and correct:
    // SET_MESSAGE_INTERVAL is resolved to an ap_message
    // (MAVLINK_MSG_ID_ESC_TELEMETRY_1_TO_4 -> MSG_ESC_TELEMETRY,
    // GCS_Common.cpp:1181), and that one ap_message emits every populated group
    // in turn. Asking for 11031/11032 as well would just re-rate the same slot.
    //
    // 2 Hz: RPM is a "is it spinning, and how fast" readout an operator watches
    // during a motor test, not something to smooth-plot. At 44 bytes per group
    // this stays cheap even for 12 ESCs on a telemetry link.
    messageId: MAVLINK_MESSAGE_IDS.ESC_TELEMETRY_1_TO_4,
    label: 'ESC_TELEMETRY',
    intervalUs: 500000
  }
] as const
/**
 * The PARAM_SET was sent, but no PARAM_VALUE echoing the requested value
 * arrived before the verify timeout. MAVLink has no PARAM_SET ack, so this does
 * NOT prove the write failed — it commonly means the FC owns the value and
 * re-derives it live (a firmware-managed param like BAROn_GND_PRESS), so the
 * echo can never match. Distinct from a send/link failure: the batch uses this
 * to skip-and-continue (when the link is still alive) rather than roll back.
 */
export class ParameterVerifyTimeoutError extends Error {
  constructor(
    message: string,
    readonly paramId: string,
    readonly requestedValue: number,
    readonly cause?: unknown
  ) {
    super(message)
    this.name = 'ParameterVerifyTimeoutError'
  }
}

export class ParameterBatchWriteError extends Error {
  constructor(
    message: string,
    readonly result: ParameterBatchWriteResult,
    readonly cause?: unknown
  ) {
    super(message)
    this.name = 'ParameterBatchWriteError'
  }
}

/**
 * Outcome of an operator-triggered message request (SET_MESSAGE_INTERVAL /
 * REQUEST_MESSAGE). `ok` is true when the autopilot accepted the request
 * (ACCEPTED or IN_PROGRESS); `resultLabel` is a human MAV_RESULT name.
 */
export interface MessageRequestResult {
  ok: boolean
  result: number
  resultLabel: string
}

export class ArduPilotConfiguratorRuntime {
  private readonly updateListeners = new Set<UpdateListener>()
  // Raw MAVLink envelope subscribers for the read-only inspector (see onMessage).
  private readonly inspectorListeners = new Set<(envelope: MavlinkEnvelope) => void>()
  // Coalesces high-rate emit()s into at most one snapshot notify per
  // animation frame. Undefined when no flush is pending.
  private emitHandle: number | undefined
  // setTimeout fallback for when requestAnimationFrame is suspended
  // (backgrounded tab). Whichever of rAF / timer fires first flushes and
  // cancels the other.
  private emitTimer: ReturnType<typeof setTimeout> | undefined
  // During a batch write, emit() coalesces to the timer interval only (no
  // per-frame rAF) so the heavy snapshot render can't starve inbound-frame
  // processing and crawl the batch on slow links/large apps.
  private batchEmitMode = false
  private readonly subscriptions: Unsubscribe[]
  private readonly vehicleWaiters = new Set<VehicleWaiter>()
  private readonly parameterSyncWaiters = new ParameterSyncWaiterSet()
  private readonly commandAckWaiters = new Set<CommandAckWaiter>()
  private readonly parameterValueWaiters = new ParameterValueWaiterSet()
  private readonly autopilotVersionWaiters = new Set<AutopilotVersionWaiter>()
  private readonly mavftp: MavftpService
  private readonly logDownload: LogDownloadService
  private readonly parameters = new Map<string, ParameterState>()
  // Param IDs the FC actually streamed (excludes alias-mirror entries). The
  // param-sync completion gate counts these so a mirror can't inflate
  // `downloaded` past `total`.
  private readonly realParameterIdsReceived = new Set<string>()
  // Param indices the FC has streamed, so a stalled sync can refetch exactly the
  // missing indices (PARAM_REQUEST_READ) instead of re-streaming the whole table
  // and re-dropping the same frames under a lossy transport.
  private readonly receivedParameterIndices = new Set<number>()
  private readonly preArmIssues = new Map<string, PreArmIssueState>()
  // Last SYS_STATUS pre-arm verdict. Undefined until the first SYS_STATUS of
  // the session arrives; freshness is judged at read time, not here.
  private preArmLiveCheck?: PreArmLiveCheckState
  // MAV_CMD_RUN_PREARM_CHECKS poll. `supported` latches false the first time the
  // vehicle answers UNSUPPORTED so we stop asking a board that cannot answer;
  // `active` gates the short issue TTL, and is only true while the poll is
  // actually being accepted — an aged reason must never expire early just
  // because we asked for a refresh that never landed.
  private preArmRefreshTimer?: ReturnType<typeof setInterval>
  private readonly preArmRefreshIntervalMs: number
  private readonly preArmIssueTtlPolledMs: number
  private preArmRefreshSupported = true
  private preArmRefreshActive = false
  private preArmRefreshInFlight = false
  private readonly statusTexts: StatusTextEntry[] = []
  // One-shot waiters for a specific STATUSTEXT substring (e.g. "Passthru
  // enabled"), resolved by emitStatusText when a matching message arrives.
  private readonly statusTextWaiters: Array<{ substring: string; resolve: () => void }> = []
  // STATUSTEXT chunked-reassembly buffers. ArduPilot splits messages longer
  // than the 50-char v2 payload into frames sharing a `statusId` with an
  // incrementing `chunkSequence`; concatenate in sequence order into one
  // entry. Keyed by statusId; statusId === 0 (legacy single-frame) is never
  // buffered.
  private readonly statusTextChunkBuffers = new Map<
    number,
    { severity: number; chunks: Map<number, string>; startedAtMs: number }
  >()
  // Recent-ACK log so a command-ACK timeout can self-diagnose by including
  // the last ACKs received (command id + result + when) in its error.
  private readonly commandAckLog: Array<{
    command: number
    result: number
    receivedAtMs: number
    sourceSystemId: number
    sourceComponentId: number
    foreign: boolean
  }> = []
  private static readonly COMMAND_ACK_LOG_LIMIT = 20
  // DroneCAN nodes advertised by the MAVLink-UAVCAN bridge, keyed by
  // component_id (kept equal to the UAVCAN node_id). Identity + liveness only.
  private readonly canNodes = new Map<number, CanNodeState>()
  // Debounce + sweep state for DroneCAN node discovery follow-ups.
  // - canNodeInfoLastRequestedAtMs throttles MAV_CMD_UAVCAN_GET_NODE_INFO.
  // - canNodeStaleSweepTimer demotes nodes to 'offline' past
  //   CAN_NODE_OFFLINE_AFTER_MS and evicts them past CAN_NODE_REMOVE_AFTER_MS.
  private canNodeInfoLastRequestedAtMs?: number
  private canNodeStaleSweepTimer?: ReturnType<typeof setInterval>
  private readonly guidedActionService: GuidedActionService
  private readonly canBusService: CanBusService

  private connection: TransportStatus
  private vehicle?: VehicleIdentity
  private hardwareBoard?: HardwareBoardState
  private uartsFile: BoardFileState = createIdleUartsFileState()
  // Physical PWM output count, parsed from the "RCOut: PWM:1-N" boot banner —
  // the only on-wire signal for it (SERVOn_FUNCTION params allocate up to
  // MAX_SERVO regardless of board pins).
  private pwmOutputCount?: number
  private parameterSync: ParameterSyncState = createIdleParameterSync()
  private readonly motorTestService: MotorTestService
  // No-GPS calibration helper: a synthetic GPS_INPUT stream + the GPS backend
  // type we temporarily override to MAV (restored on stop).
  private fakeGpsTimer: ReturnType<typeof setInterval> | undefined
  private fakeGpsOriginalType: number | undefined
  private liveVerification = createIdleLiveVerification()
  private totalParameters = 0
  /** Set when the FC's reported parameter count grew mid-sync — a board that
   *  was still registering parameters when it answered. */
  private parameterTableGrewDuringSync = false
  private liveTelemetryRequestsIssued = false
  // FIFO of un-ACKed SET_MESSAGE_INTERVAL requests, dequeued in arrival order
  // so processCommandAck can name which stream the autopilot rejected.
  private readonly pendingSetMessageIntervalLabels: string[] = []
  private preArmExpiryTimer?: ReturnType<typeof setTimeout>
  private parameterSyncRetryTimer?: ReturnType<typeof setTimeout>
  private parameterSyncRetryCount = 0
  // Downloaded count observed at the last stall-retry, so a retry that recovered
  // params can refund the retry budget (a working link with a large gap must be
  // allowed to converge over many gap-fill passes, not give up at
  // MAX_RETRIES × MAX_PER_PASS). Only CONSECUTIVE no-progress passes count.
  private parameterSyncLastRetryDownloaded = 0
  // Whether the previous stall-retry issued a by-index gap-fill; if it did and
  // this pass made no progress, fall back to a full re-stream (guards an FC not
  // honoring by-index reads).
  private parameterSyncGapFillActive = false
  // Test-injectable per-instance override; defaults to the
  // module constant. Production callers never set this.
  private readonly parameterSyncStallRetryMs: number
  // Parameter count the retained table was captured against, while a resumed
  // download is still unproven. The first PARAM_VALUE of the new link settles
  // it: a different count means the table itself changed (reflash, defaults
  // reset, different build) and the retained values must be thrown out.
  private parameterSyncResumedTotal: number | undefined
  // Set when a link drops with parameters in hand. The table itself STAYS in
  // `this.parameters`: a board that watchdog-resets every few seconds would
  // otherwise blank the whole app on each reset, and those values are still the
  // last truth we had. This marks them as no longer live — the UI says so
  // loudly, and everything that can act on the vehicle stays gated on
  // `connection.kind === 'connected'`, which a retained table cannot satisfy.
  // It also carries the identity + timestamp that decide whether the next
  // connect may resume the download instead of restarting from zero.
  private staleLink:
    | {
        readonly key: string
        readonly sinceMs: number
        readonly vehicle: VehicleIdentity
        readonly downloaded: number
        readonly total: number
      }
    | undefined
  private autopilotVersionRequested = false
  private uartsFileRequested = false

  private metadata: FirmwareMetadataBundle
  private readonly metadataByVehicle: Partial<Record<'ArduCopter' | 'ArduPlane' | 'ArduRover' | 'ArduSub', FirmwareMetadataBundle>>

  constructor(
    private readonly session: MavlinkSession,
    metadata: FirmwareMetadataBundle,
    options: ArduPilotConfiguratorRuntimeOptions = {}
  ) {
    this.metadata = metadata
    this.metadataByVehicle = options.metadataByVehicle ?? {}
    this.parameterSyncStallRetryMs = options.parameterSyncStallRetryMs ?? PARAMETER_SYNC_STALL_RETRY_MS
    this.preArmRefreshIntervalMs = options.preArmRefreshIntervalMs ?? PRE_ARM_REFRESH_INTERVAL_MS
    this.preArmIssueTtlPolledMs = options.preArmIssueTtlPolledMs ?? PRE_ARM_ISSUE_TTL_POLLED_MS
    this.mavftp = new MavftpService({
      session: this.session,
      getVehicle: () => this.vehicle,
      ensureSupport: () => this.requireMavftpSupport()
    })
    this.motorTestService = new MotorTestService({
      getSnapshot: () => this.getSnapshot(),
      sendCommand: (command, params, sendOptions) => this.sendCommand(command, params, sendOptions),
      appendStatusEntry: (severity, text) => this.appendStatusEntry(severity, text),
      emit: () => this.emit()
    })
    this.logDownload = new LogDownloadService({
      session: this.session,
      getVehicle: () => this.vehicle
    })
    this.connection = this.session.getTransportStatus()
    this.canBusService = new CanBusService({
      session: this.session,
      emit: () => this.emit(),
      appendStatusEntry: (severity, text) => this.appendStatusEntry(severity, text),
      getTargetSystem: () => this.vehicle?.systemId ?? 1,
      getTargetComponent: () => this.vehicle?.componentId ?? 1
    })
    this.guidedActionService = new GuidedActionService({
      session: this.session,
      getVehicle: () => this.vehicle,
      getParameters: () => this.parameters,
      getParameterSyncStatus: () => this.parameterSync.status,
      isConnected: () => this.connection.kind === 'connected',
      sendCommand: (command, params, sendOptions) => this.sendCommand(command, params, sendOptions),
      appendStatusEntry: (severity, text) => this.appendStatusEntry(severity, text),
      emit: () => this.emit(),
      accelerometerInitialWarmupMs: options.accelerometerInitialWarmupMs,
      accelerometerStepAdvanceMs: options.accelerometerStepAdvanceMs,
      accelerometerCompletionFallbackMs: options.accelerometerCompletionFallbackMs,
      compassGuidanceTimeoutMs: options.compassGuidanceTimeoutMs
    })
    this.subscriptions = [
      this.session.onStatus((status: TransportStatus) => {
        this.connection = status
        if (status.kind === 'disconnected' || status.kind === 'error') {
          const reason =
            status.kind === 'error'
              ? status.message
              : status.reason ?? 'Vehicle link closed before the request completed.'
          this.rejectVehicleWaiters(new Error(reason))
          this.parameterSyncWaiters.rejectAll(new Error(reason))
          this.rejectCommandAckWaiters(new Error(reason))
          this.parameterValueWaiters.rejectAll(new Error(reason))
          this.rejectAutopilotVersionWaiters(new Error(reason))
          this.mavftp.cancelAll(new Error(reason))
          this.logDownload.cancelAll(new Error(reason))
          this.resetLiveState()
        }
        this.emit()
      }),
      this.session.onMessage((envelope: MavlinkEnvelope) => {
        this.processEnvelope(envelope)
        for (const listener of this.inspectorListeners) {
          listener(envelope)
        }
        // MAVFTP burst packets and LOG_DATA chunks arrive by the thousand during
        // a file/log download and do NOT change the snapshot — their progress is
        // surfaced through the download callbacks, and processEnvelope routes
        // them to the mavftp / logDownload services rather than snapshot state.
        // Emitting a snapshot per packet drove a continuous full-app re-render
        // that starved the Web Serial read loop and collapsed download
        // throughput to ~130x slower than a headless client. Skip the per-packet
        // emit for those two high-rate types; any status/state change they make
        // flushes on the next telemetry message, and completion emits explicitly.
        const messageType = envelope.message.type
        if (messageType !== 'FILE_TRANSFER_PROTOCOL' && messageType !== 'LOG_DATA') {
          this.emit()
        }
      })
    ]
  }

  /**
   * Subscribe to the raw decoded MAVLink envelope stream (every message, all
   * types) — for the read-only MAVLink inspector. Returns an unsubscribe.
   * Separate from the snapshot so high-rate traffic doesn't churn it.
   */
  onMessage(handler: (envelope: MavlinkEnvelope) => void): Unsubscribe {
    this.inspectorListeners.add(handler)
    return () => {
      this.inspectorListeners.delete(handler)
    }
  }

  /**
   * Subscribe to the MAVLink envelopes this runtime SENDS (outbound) — for the
   * inspector's "Sent" view. Delegates straight to the session; the runtime
   * keeps no sent-side state of its own.
   */
  onSentMessage(handler: (envelope: MavlinkEnvelope) => void): Unsubscribe {
    return this.session.onSentMessage(handler)
  }

  getSnapshot(): ConfiguratorSnapshot {
    // Apply version-gated ArduCopter 4.7 metadata overrides HERE (not at
    // PARAM_VALUE receive time) so every snapshot reflects the CURRENT detected
    // firmware version — a param that arrived before AUTOPILOT_VERSION still
    // picks up its 4.7 definition once the version is known. Base (<=4.6 /
    // unknown / non-copter) is returned unchanged by identity, so this is a
    // no-op on the trust-anchor path.
    const applyCopter47Override = this.vehicle?.vehicle === 'ArduCopter'
    const firmwareVersionParts = this.hardwareBoard?.firmwareVersionParts
    const parameters = [...this.parameters.values()]
      .map((parameter) => {
        if (!applyCopter47Override || parameter.definition === undefined) {
          return parameter
        }
        const definition = applyArducopter47Override(parameter.definition, firmwareVersionParts)
        return definition === parameter.definition ? parameter : { ...parameter, definition }
      })
      .sort((left, right) => left.id.localeCompare(right.id))
    const preArmStatus = this.buildPreArmStatus()

    return {
      connection: this.connection,
      vehicle: this.vehicle,
      // Retained-table marker. Present only while the values on screen came
      // from a link that has since dropped; cleared the moment a live download
      // resumes or restarts.
      staleLink: this.staleLink
        ? {
            sinceMs: this.staleLink.sinceMs,
            vehicle: this.staleLink.vehicle,
            downloaded: this.staleLink.downloaded,
            total: this.staleLink.total
          }
        : undefined,
      hardware: cloneHardwareState({
        board: this.hardwareBoard ? { ...this.hardwareBoard } : undefined,
        uartsFile: cloneBoardFileState(this.uartsFile),
        pwmOutputCount: this.pwmOutputCount
      }),
      parameterStats: {
        // Use parameterSync.downloaded (real arrivals), NOT parameters.length,
        // which also counts alias mirrors and would inflate downloaded.
        downloaded: this.parameterSync.downloaded,
        total: this.totalParameters,
        duplicateFrames: this.parameterSync.duplicateFrames,
        status: this.parameterSync.status,
        progress: this.parameterSync.progress,
        requestedAtMs: this.parameterSync.requestedAtMs,
        completedAtMs: this.parameterSync.completedAtMs
      },
      parameters,
      setupSections: this.buildSetupSections(),
      guidedActions: cloneGuidedActions(this.guidedActionService.getActions()),
      motorTest: cloneMotorTestState(this.motorTestService.getState()),
      liveVerification: cloneLiveVerification(this.liveVerification),
      preArmStatus: clonePreArmStatus(preArmStatus),
      statusTexts: [...this.statusTexts],
      canNodes: Array.from(this.canNodes.values())
        .map((node) => ({ ...node }))
        .sort((left, right) => left.componentId - right.componentId),
      canBus: this.canBusService.getSnapshot()
    }
  }

  subscribe(listener: UpdateListener): Unsubscribe {
    this.updateListeners.add(listener)
    listener(this.getSnapshot())
    return () => {
      this.updateListeners.delete(listener)
    }
  }

  async connect(): Promise<void> {
    this.resetLiveState()
    await this.session.connect()
  }

  async disconnect(): Promise<void> {
    // Reset while the link is still up so the best-effort DO_CANCEL_MAG_CAL
    // can reach the vehicle, and clear state + timers regardless of whether
    // the transport later echoes 'disconnected'. Idempotent with the
    // onStatus path (mirrors connect(), which also resets first).
    this.resetLiveState()
    // Emit the cleared snapshot immediately so the UI doesn't show a stale
    // connected vehicle until the transport echoes 'disconnected'.
    this.emit()
    await this.session.disconnect()
  }

  // ---------------------------------------------------------------------
  // MAVLink v2 message signing.
  //
  // Local signing (sign outbound + verify inbound on this GCS) is configured
  // on the codec via the session. Provisioning the *same* key onto the FC is
  // a separate, explicit action (sendSigningSetup) using SETUP_SIGNING — that
  // way the operator can sign/verify locally for testing without ever
  // touching the vehicle, and only pushes the key to the FC deliberately,
  // over a trusted link.
  //
  // The secret key is never persisted by the runtime and never logged. The
  // passphrase is hashed to a key in memory and handed straight to the codec.
  // ---------------------------------------------------------------------

  /** True when this runtime's session can sign/verify v2 frames. */
  supportsSigning(): boolean {
    return this.session.supportsSigning()
  }

  /**
   * Configure local MAVLink v2 signing from a user passphrase. Derives the
   * 32-byte key (SHA-256 of the UTF-8 passphrase, matching Mission Planner)
   * and applies it to the codec. While enabled, outbound frames are signed
   * and inbound signed frames are verified (failures dropped + counted).
   *
   * Returns the derived key so the caller can optionally provision the FC
   * with the identical key via {@link sendSigningSetup}. The key is not
   * retained beyond the codec; callers should not log or store it.
   */
  configureSigningFromPassphrase(
    passphrase: string,
    options: { linkId?: number; enabled?: boolean } = {}
  ): Uint8Array {
    const secretKey = deriveSigningKeyFromPassphrase(passphrase)
    this.session.setSigningConfig({
      secretKey,
      linkId: options.linkId ?? 0,
      enabled: options.enabled ?? true
    })
    return secretKey
  }

  /**
   * Configure local signing directly from a raw 32-byte key (e.g. a pasted
   * hex key). Throws if the key is not exactly 32 bytes.
   */
  configureSigningFromKey(
    secretKey: Uint8Array,
    options: { linkId?: number; enabled?: boolean } = {}
  ): void {
    if (secretKey.length !== MAVLINK_V2_SIGNING_KEY_LENGTH) {
      throw new Error(
        `MAVLink signing key must be ${MAVLINK_V2_SIGNING_KEY_LENGTH} bytes, got ${secretKey.length}.`
      )
    }
    this.session.setSigningConfig({
      secretKey,
      linkId: options.linkId ?? 0,
      enabled: options.enabled ?? true
    })
  }

  /** Disable local signing/verification (restores unsigned behaviour). */
  disableSigning(): void {
    this.session.setSigningConfig(undefined)
  }

  /** Number of inbound signed frames dropped by verification so far. */
  getSignatureRejectionCount(): number {
    return this.session.getSignatureRejectionCount()
  }

  /** Subscribe to signed-frame rejection events. */
  onSignatureRejection(handler: (rejection: MavlinkSignatureRejection) => void): Unsubscribe {
    return this.session.onSignatureRejection(handler)
  }

  /**
   * Provision the vehicle with a signing key via SETUP_SIGNING (msgid 256).
   * This is the standard MAVLink mechanism for sharing the key with the FC so
   * both ends hold the same secret. Per the spec it must only be sent over a
   * trusted/direct link (USB / wired); the UI gates this behind an explicit
   * action and a connected vehicle.
   *
   * The initial_timestamp is seeded from our local signing clock so the FC's
   * replay window starts aligned with ours. Mission Planner sends the message
   * twice for reliability; we mirror that.
   */
  async sendSigningSetup(secretKey: Uint8Array): Promise<void> {
    if (secretKey.length !== MAVLINK_V2_SIGNING_KEY_LENGTH) {
      throw new Error(
        `MAVLink signing key must be ${MAVLINK_V2_SIGNING_KEY_LENGTH} bytes, got ${secretKey.length}.`
      )
    }
    const targetSystem = this.vehicle?.systemId ?? 1
    const targetComponent = this.vehicle?.componentId ?? 1
    const initialTimestamp = currentSigningTimestamp()
    // Send twice (matching Mission Planner): SETUP_SIGNING is unacknowledged,
    // so a second copy reduces the chance a single dropped frame leaves the
    // FC unprovisioned.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await this.session.send({
        type: 'SETUP_SIGNING',
        targetSystem,
        targetComponent,
        secretKey,
        initialTimestamp
      })
    }
    this.appendStatusEntry(
      'info',
      `Sent SETUP_SIGNING to vehicle ${targetSystem}/${targetComponent} to provision the signing key.`
    )
    this.emit()
  }

  async waitForVehicle(options: WaitForVehicleOptions = {}): Promise<VehicleIdentity> {
    if (this.vehicle) {
      return this.vehicle
    }

    const timeoutMs = options.timeoutMs ?? DEFAULT_HEARTBEAT_TIMEOUT_MS
    if (this.parameterSync.status === 'idle') {
      this.parameterSync = {
        ...this.parameterSync,
        status: 'awaiting-vehicle'
      }
      this.emit()
    }

    return new Promise<VehicleIdentity>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.vehicleWaiters.delete(waiter)
        reject(new Error(`Timed out waiting for vehicle heartbeat after ${timeoutMs}ms.`))
      }, timeoutMs)

      const waiter: VehicleWaiter = {
        resolve: (vehicle: VehicleIdentity) => {
          clearTimeout(timer)
          resolve(vehicle)
        },
        reject: (error: Error) => {
          clearTimeout(timer)
          reject(error)
        },
        timer
      }

      this.vehicleWaiters.add(waiter)
    })
  }

  /**
   * Clear the Recent Notices (STATUSTEXT history) on operator request. Drops any
   * in-flight multi-frame chunk buffers too so a later fragment can't resurrect a
   * cleared message. New STATUSTEXTs from the FC keep arriving as normal.
   */
  clearStatusTexts(): void {
    if (this.statusTexts.length === 0) {
      return
    }
    this.statusTexts.splice(0)
    this.statusTextChunkBuffers.clear()
    this.emit()
  }

  async requestParameterList(options: RequestParameterListOptions = {}): Promise<void> {
    this.setGuidedAction('request-parameters', {
      actionId: 'request-parameters',
      status: 'requested',
      summary: 'Waiting for heartbeat before requesting the parameter table.',
      instructions: ['The parameter sync will start once the autopilot heartbeat identifies the target system.'],
      statusTexts: [],
      startedAtMs: Date.now(),
      updatedAtMs: Date.now(),
      completedAtMs: undefined
    })
    this.emit()

    try {
      const vehicle = await this.waitForVehicle(options)

      // Resume the table the previous link dropped mid-download, when this is
      // the same board and it is still fresh. `fresh: true` opts out — a caller
      // that just reflashed or rebooted the board must not inherit values from
      // the firmware that was on it before.
      const resuming = options.fresh !== true && this.canResumeStaleLink(vehicle)
      if (!resuming) {
        this.discardStaleLink()
      }
      const resumedFrom = resuming ? this.staleLink : undefined
      this.staleLink = undefined

      this.parameterSyncRetryCount = 0
      this.parameterSyncLastRetryDownloaded = resumedFrom ? resumedFrom.downloaded : 0
      this.parameterSyncGapFillActive = false
      this.parameterSyncResumedTotal = resumedFrom?.total
      this.clearParameterSyncRetryTimer()

      if (resumedFrom) {
        this.appendStatusEntry(
          'info',
          `Resuming the parameter download: ${resumedFrom.downloaded}/${resumedFrom.total} kept from the previous link.`
        )
      }

      this.parameterSync = {
        status: 'requesting',
        downloaded: resumedFrom ? resumedFrom.downloaded : 0,
        total: resumedFrom ? resumedFrom.total : 0,
        duplicateFrames: 0,
        progress: resumedFrom ? Math.min(resumedFrom.downloaded / resumedFrom.total, 1) : null,
        targetSystemId: vehicle.systemId,
        targetComponentId: vehicle.componentId,
        requestedAtMs: Date.now()
      }
      this.setGuidedAction('request-parameters', {
        actionId: 'request-parameters',
        status: 'running',
        summary: resumedFrom
          ? `Resuming the parameter download at ${resumedFrom.downloaded}/${resumedFrom.total} (sys=${vehicle.systemId} comp=${vehicle.componentId}).`
          : `Parameter request sent to sys=${vehicle.systemId} comp=${vehicle.componentId}.`,
        instructions: ['Waiting for the autopilot to stream the full parameter table.'],
        statusTexts: [],
        startedAtMs: this.guidedActionService.getAction('request-parameters').startedAtMs ?? Date.now(),
        updatedAtMs: Date.now(),
        completedAtMs: undefined
      })
      this.emit()

      // Refetch only what the dropped link never delivered — a full re-stream
      // re-sends everything we already hold and, on a board that resets every
      // few seconds, never gets further than the last attempt.
      //
      // But by-index refetch is paced: MAX_PARAMETER_GAP_FILL_PER_PASS reads
      // per pass, and the next pass waits out the stall timer
      // (PARAMETER_SYNC_STALL_RETRY_MS, 1.5s+). That is the right shape for the
      // handful of frames a lossy link drops, and the wrong shape for a gap of
      // hundreds: a full table then costs several passes of pure waiting, so a
      // reconnect after a reboot took far longer than a first connect and the
      // operator's fastest move was to disconnect (which discards the carry-over
      // via discardRetainedParameters) and reconnect for a clean bulk stream.
      //
      // So: target the gap when it fits in ONE pass, otherwise bulk-stream. The
      // retained values stay on screen either way, and if the bulk stream stalls
      // the existing retry path gap-fills automatically — which is what keeps a
      // constantly-resetting board converging.
      const resumeMissingIndices = resumedFrom ? this.missingParameterIndices() : []
      if (resumedFrom && resumeMissingIndices.length <= MAX_PARAMETER_GAP_FILL_PER_PASS) {
        this.parameterSyncGapFillActive = true
        await this.requestMissingParameters(resumeMissingIndices)
        this.scheduleParameterSyncRetry()
      } else {
        await this.requestParameterTable(vehicle.systemId, vehicle.componentId)
      }
    } catch (error) {
      this.failGuidedAction('request-parameters', error)
      this.emit()
      throw error
    }
  }

  /**
   * Drop the retained parameter table from a dropped link. The operator closing
   * the link on purpose expects a clean slate — "link lost, showing the last
   * data" is only honest about a link that went away on its own. NOT called on
   * the internal disconnect()s inside a reconnect attempt, which must leave the
   * retained table intact for the resume.
   */
  discardRetainedParameters(): void {
    if (!this.staleLink && this.parameters.size === 0) {
      return
    }
    this.discardStaleLink()
    this.emit()
  }

  async waitForParameterSync(options: WaitForParameterSyncOptions = {}): Promise<ConfiguratorSnapshot['parameterStats']> {
    if (this.parameterSync.status === 'complete') {
      return this.getSnapshot().parameterStats
    }

    const timeoutMs = options.timeoutMs ?? DEFAULT_PARAMETER_SYNC_TIMEOUT_MS
    return this.parameterSyncWaiters.add(timeoutMs)
  }

  async setParameter(paramId: string, paramValue: number, options: ParameterWriteOptions = {}): Promise<ParameterWriteResult> {
    this.assertParameterWriteAllowed()

    const known = this.parameters.get(paramId)
    // Param-rename shim: when the caller writes a legacy id but the FC exposes
    // the modern one, forward the PARAM_SET under the modern name. Gate on
    // realParameterIdsReceived (the alias-free set of genuine FC arrivals),
    // NOT parameters.has — the bidirectional mirror makes the latter true even
    // on firmware that never streamed the modern name, which would misroute
    // the write.
    const modernAlias = LEGACY_PARAM_ALIASES[paramId]
    const onWireParamId = modernAlias !== undefined && this.realParameterIdsReceived.has(modernAlias)
      ? modernAlias
      : paramId
    // Verify against the on-wire name (what the FC echoes); the mirror in
    // processParamValue updates both ids.
    const writeVerification = this.parameterValueWaiters.add(onWireParamId, paramValue, options)

    try {
      await this.session.send({
        type: 'PARAM_SET',
        targetSystem: this.vehicle?.systemId ?? 1,
        targetComponent: this.vehicle?.componentId ?? 1,
        paramId: onWireParamId,
        paramValue,
        // Parameter-protocol conformance: PARAM_SET echoes the param_type the
        // FC reported in PARAM_VALUE (strict routers require it). REAL32 only
        // as the never-streamed fallback.
        paramType: this.parameters.get(onWireParamId)?.paramType ?? MAV_PARAM_TYPE.REAL32
      })
    } catch (error) {
      const sendError = error instanceof Error ? error : new Error('Unknown parameter send error.')
      writeVerification.cancel(sendError)
      void writeVerification.promise.catch(() => {})
      throw sendError
    }

    try {
      const confirmed = await writeVerification.promise
      this.appendStatusEntry('info', `Verified parameter ${paramId} = ${formatParameterValueForLog(confirmed.value)}.`)
      this.emit()
      return {
        paramId,
        previousValue: known?.value,
        requestedValue: paramValue,
        confirmedValue: confirmed.value,
        confirmedAtMs: Date.now()
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown parameter verification error.'
      this.appendStatusEntry('warning', `Failed to verify parameter ${paramId}: ${message}`)
      this.emit()
      // Typed so the batch path can tell a sent-but-unverifiable write (the FC
      // owns/re-derives the value) apart from a send/link failure: the former is
      // skipped-and-continued, the latter rolls back.
      throw new ParameterVerifyTimeoutError(message, paramId, paramValue, error)
    }
  }

  async setParameters(
    requests: ParameterWriteRequest[],
    options: ParameterWriteOptions = {},
    onProgress?: (progress: ParameterBatchWriteProgress) => void
  ): Promise<ParameterBatchWriteResult> {
    const result: ParameterBatchWriteResult = {
      applied: [],
      rolledBack: [],
      unconfirmed: []
    }

    const total = requests.length
    let processed = 0
    // Throttle snapshot emits to ~4/s for the duration so the per-write app
    // render doesn't starve the batch (callers still get smooth progress via
    // onProgress, which is independent of the snapshot). A final flush below
    // pushes the terminal state.
    this.batchEmitMode = true
    try {
    for (const request of requests) {
      const known = this.parameters.get(request.paramId)
      if (known && approximatelyEqualParameterValue(known.value, request.paramValue, options.tolerance)) {
        processed += 1
        onProgress?.({ completed: processed, total, paramId: request.paramId })
        continue
      }

      try {
        const writeResult = await this.setParameter(request.paramId, request.paramValue, options)
        result.applied.push(writeResult)
        processed += 1
        onProgress?.({ completed: processed, total, paramId: request.paramId })
      } catch (error) {
        // A sent-but-unverifiable write (the FC owns/re-derives the value, e.g.
        // BAROn_GND_PRESS, or silently clamped it) must NOT unwind the verified
        // writes. As long as the link is still alive — this and the remaining
        // writes can still go — record it and continue. A send/link failure
        // (blockReason set, or any non-verify error) falls through to the
        // rollback path below, so audit-honest rollback on a dropped link is
        // preserved.
        if (error instanceof ParameterVerifyTimeoutError && !this.parameterWriteBlockReason()) {
          result.unconfirmed.push({
            paramId: request.paramId,
            requestedValue: request.paramValue,
            reason: error.message
          })
          this.appendStatusEntry(
            'warning',
            `Could not confirm ${request.paramId} (${error.message}); left as written and continued the batch.`
          )
          processed += 1
          onProgress?.({ completed: processed, total, paramId: request.paramId })
          continue
        }

        const rollbackSourceWrites = [...result.applied].reverse().filter((write) => write.previousValue !== undefined)
        // Rollback re-issues writes, so if the failure also blocks writes
        // (link dropped, armed, guided action started) rollback can't be
        // attempted — detect that once here instead of letting every rollback
        // setParameter throw the same error.
        const rollbackBlockReason = this.parameterWriteBlockReason()

        let rollbackSummary: string
        if (result.applied.length === 0) {
          rollbackSummary = 'No earlier parameter writes needed rollback.'
        } else if (rollbackSourceWrites.length === 0) {
          // Applied, but no prior value was ever known (cannot restore).
          rollbackSummary =
            `${result.applied.length} applied change(s) had no previously known value and were left as written — ` +
            'restore from a snapshot to recover a known state.'
        } else if (rollbackBlockReason) {
          this.appendStatusEntry(
            'error',
            `Could not roll back ${rollbackSourceWrites.length} applied parameter change(s): ${rollbackBlockReason} ` +
              'They remain on the vehicle exactly as written — reconnect and restore from a snapshot to recover a known state.'
          )
          rollbackSummary =
            `Rollback NOT attempted (${rollbackBlockReason}) — ${rollbackSourceWrites.length} applied change(s) ` +
            'remain on the vehicle as written; reconnect and restore from a snapshot.'
        } else {
          for (const appliedWrite of rollbackSourceWrites) {
            try {
              const rollbackResult = await this.setParameter(appliedWrite.paramId, appliedWrite.previousValue as number, options)
              result.rolledBack.push(rollbackResult)
            } catch (rollbackError) {
              const rollbackMessage = rollbackError instanceof Error ? rollbackError.message : 'Unknown rollback error.'
              this.appendStatusEntry(
                'error',
                `Rollback failed for ${appliedWrite.paramId} after batch write error: ${rollbackMessage}`
              )
            }
          }
          rollbackSummary =
            result.rolledBack.length === rollbackSourceWrites.length
              ? `Rolled back ${result.rolledBack.length} previously applied parameter change(s).`
              : `Rolled back ${result.rolledBack.length} of ${rollbackSourceWrites.length} previously applied parameter ` +
                'change(s); the rest could not be restored — verify the vehicle and restore from a snapshot.'
        }

        const writeMessage = error instanceof Error ? error.message : 'Unknown batch write error.'
        // The failing write itself is never rolled back and its on-vehicle
        // state is unknowable: MAVLink PARAM_SET has no ack, so a
        // verification timeout does NOT prove the value was not applied.
        const failedParamNote =
          ` The parameter that failed (${request.paramId}) was not confirmed and may or may not have been applied; ` +
          're-sync parameters to confirm the vehicle state.'
        throw new ParameterBatchWriteError(
          `Batch write failed on ${request.paramId}: ${writeMessage} ${rollbackSummary}${failedParamNote}`,
          result,
          error
        )
      }
    }
    } finally {
      // Restore normal per-frame emits and push the terminal snapshot now.
      this.batchEmitMode = false
      this.cancelScheduledEmit()
      this.flushEmit()
    }

    if (result.unconfirmed.length > 0) {
      const names = result.unconfirmed.map((entry) => entry.paramId).join(', ')
      this.appendStatusEntry(
        'warning',
        `${result.applied.length} parameter(s) written; ${result.unconfirmed.length} could not be confirmed ` +
          `and were left as written (firmware-managed or live values that never echo the set value): ${names}. ` +
          're-sync parameters to confirm the vehicle state.'
      )
      this.emit()
    }

    return result
  }

  async listRemoteDirectory(path = '@SYS'): Promise<MavftpDirectoryEntry[]> {
    return this.mavftp.listRemoteDirectory(path)
  }

  async downloadRemoteFile(path: string): Promise<Uint8Array> {
    return this.mavftp.downloadRemoteFile(path)
  }

  /** Download an arbitrary remote file via MAVFTP burst read (512 MB cap),
   *  falling back to a single read for size-0 `@SYS` virtual files. The file
   *  browser uses this so a regular file over the 16 MB single-read cap
   *  (an `/APM/LOGS/*.BIN`, a terrain tile, a crash dump) downloads instead of
   *  failing with "read exceeded the 16777216-byte cap". */
  async downloadRemoteFileBurst(
    path: string,
    onProgress?: (progress: LogDownloadProgress) => void
  ): Promise<Uint8Array> {
    return this.mavftp.downloadRemoteFileBurst(path, { onProgress, maxBytes: MAX_MAVFTP_LOG_BYTES })
  }

  /**
   * Fetch the two bootloader images an Update Bootloader would compare, so an
   * operator can see what is about to be written next to what is already
   * there. Read-only; nothing here writes to the vehicle.
   *
   * BOTH sides are genuinely retrievable in normal operation, and both come
   * from exactly the addresses AP_HAL_ChibiOS/Util.cpp flash_bootloader() uses:
   *
   *  - INCOMING is `@ROMFS/bootloader.bin`. flash_bootloader() writes
   *    `AP_ROMFS::find_decompress("bootloader.bin")`, and
   *    AP_Filesystem_ROMFS.cpp open() serves `@ROMFS/<name>` through that same
   *    find_decompress call, so MAVFTP hands back the identical decompressed
   *    bytes that would be flashed. Never a guess.
   *
   *  - INSTALLED is the head of `@SYS/flash.bin`. AP_Filesystem_Sys.cpp maps
   *    that file at `(void*)0x08000000`, which is STM32_FLASH_BASE
   *    (AP_HAL_ChibiOS/hwdef/common/flash.c) and therefore exactly
   *    `hal.flash->getpageaddr(0)` — the address flash_bootloader() memcmps the
   *    ROMFS image against. So the first N bytes of that file ARE the installed
   *    bootloader, for the same N.
   *
   * Both reads are best-effort and independent. Either can legitimately be
   * absent and that is not an error worth failing the caller over:
   * `@ROMFS/bootloader.bin` only exists on builds with
   * AP_BOOTLOADER_FLASHING_ENABLED (chibios_hwdef.py adds it alongside that
   * define), and `@SYS/flash.bin` only on ChibiOS
   * (AP_FILESYSTEM_SYS_FLASH_ENABLED is `CONFIG_HAL_BOARD == HAL_BOARD_CHIBIOS`),
   * so SITL has neither. This method therefore NEVER throws: it reports per-side
   * failures and lets the UI say "unavailable" rather than invent a value.
   *
   * The installed read is deliberately sized from the incoming image, because
   * without an incoming length there is no defensible number of bytes to call
   * "the bootloader" — the flash region is megabytes and its trailing content
   * is unrelated. No incoming image means no installed comparison either.
   */
  async readBootloaderImages(): Promise<BootloaderImagePair> {
    const result: BootloaderImagePair = {}

    try {
      // Bounded at the READ, not after it, so a firmware that reports an absurd
      // size cannot make us pull megabytes before we reject it. Asking for one
      // byte past the cap is what makes "hit the cap" distinguishable from
      // "the file simply ends there" — a full cap+1 response means the image is
      // larger than we are willing to believe, anything shorter is the whole file.
      const embedded = await this.mavftp.readRemoteFilePrefix(
        EMBEDDED_BOOTLOADER_FTP_PATH,
        MAX_BOOTLOADER_IMAGE_BYTES + 1,
        { timeoutMs: BOOTLOADER_IMAGE_FETCH_TIMEOUT_MS }
      )
      if (embedded.byteLength === 0) {
        result.embeddedError = 'The firmware served an empty bootloader image.'
      } else if (embedded.byteLength > MAX_BOOTLOADER_IMAGE_BYTES) {
        // Refuse rather than trust: a length past every board's reserved
        // bootloader region means we are not looking at what we think we are.
        result.embeddedError = 'The embedded bootloader image is implausibly large.'
      } else {
        result.embedded = embedded
      }
    } catch (error) {
      result.embeddedError = describeBootloaderReadFailure(error, EMBEDDED_BOOTLOADER_FTP_PATH)
    }

    if (!result.embedded) {
      return result
    }

    try {
      // Bounded prefix read: @SYS/flash.bin spans the whole program flash and
      // its OPEN size is a placeholder, so the length must come from us.
      const installed = await this.mavftp.readRemoteFilePrefix(
        FLASH_REGION_FTP_PATH,
        result.embedded.byteLength,
        { timeoutMs: BOOTLOADER_IMAGE_FETCH_TIMEOUT_MS }
      )
      if (installed.byteLength < result.embedded.byteLength) {
        // A short read is not a different bootloader, it is an unfinished
        // read. Comparing it would report a spurious mismatch.
        result.installedError = `Only ${installed.byteLength} of ${result.embedded.byteLength} bytes of the installed bootloader could be read.`
      } else {
        result.installed = installed
      }
    } catch (error) {
      result.installedError = describeBootloaderReadFailure(error, FLASH_REGION_FTP_PATH)
    }

    return result
  }

  /**
   * Read the VTX band/power table over MAVLink FTP (@VTX/vtxtable.dat) and
   * parse it. Returns `undefined` when the firmware doesn't expose the table
   * (FTP mount/file absent) OR the blob doesn't parse (bad magic/version/CRC) —
   * both mean "no usable VTX table here", so the caller keeps the preview.
   * Only surfaces as available on a clean parse.
   */
  async readVtxTable(): Promise<VtxTable | undefined> {
    let bytes: Uint8Array
    try {
      bytes = await this.mavftp.readRemoteFile(VTX_TABLE_FTP_PATH)
    } catch {
      return undefined // no @VTX mount / file — feature not present
    }
    try {
      return parseVtxTable(bytes)
    } catch {
      return undefined // present but unparseable (version skew / corruption)
    }
  }

  /** Serialize and upload a VTX table over MAVLink FTP, overwriting the
   *  existing @VTX/vtxtable.dat. The firmware re-validates (magic/version/CRC)
   *  and rejects a malformed blob, leaving its table unchanged. */
  async writeVtxTable(table: VtxTable): Promise<void> {
    await this.mavftp.uploadRemoteFile(VTX_TABLE_FTP_PATH, serializeVtxTable(table), { overwrite: true })
    this.appendStatusEntry('info', `Uploaded VTX table over MAVFTP (${table.bands.length} bands).`)
  }

  /** Read the OSD message shorthand table (@OSD/shorthand.dat), or undefined
   *  when the mount is absent (feature not present) or the blob is unparseable —
   *  same detection contract as {@link readVtxTable}. */
  async readOsdShorthand(): Promise<OsdShorthand | undefined> {
    let bytes: Uint8Array
    try {
      bytes = await this.mavftp.readRemoteFile(OSD_SHORTHAND_FTP_PATH)
    } catch {
      return undefined
    }
    try {
      return parseOsdShorthand(bytes)
    } catch {
      return undefined
    }
  }

  /** Serialize and upload the OSD shorthand table, overwriting
   *  @OSD/shorthand.dat. The firmware re-validates (magic/version/CRC) and
   *  rejects a malformed blob, leaving its table unchanged. */
  async writeOsdShorthand(table: OsdShorthand): Promise<void> {
    await this.mavftp.uploadRemoteFile(OSD_SHORTHAND_FTP_PATH, serializeOsdShorthand(table), { overwrite: true })
    this.appendStatusEntry('info', `Uploaded OSD shorthand table over MAVFTP (${table.entries.length} entries).`)
  }

  /** List the onboard dataflash logs (`LOG_REQUEST_LIST`). */
  async listOnboardLogs(): Promise<OnboardLogInfo[]> {
    return this.logDownload.listLogs()
  }

  /** Download one onboard log's bytes (`LOG_REQUEST_DATA`), reporting progress. */
  async downloadOnboardLog(
    id: number,
    sizeBytes: number,
    onProgress?: (progress: LogDownloadProgress) => void
  ): Promise<Uint8Array> {
    const bytes = await this.logDownload.downloadLog(id, sizeBytes, onProgress)
    this.appendStatusEntry('info', `Downloaded onboard log ${id} (${bytes.length} bytes).`)
    this.emit()
    return bytes
  }

  /**
   * List onboard dataflash logs exposed over MAVFTP — the file entries (real
   * on-FC filenames + sizes). Probes `/APM/LOGS` (hardware) then `/logs` (SITL)
   * so the listing works in either environment. A faster, real-named
   * alternative to listOnboardLogs() on FCs that support MAVFTP burst read.
   */
  async listMavftpLogs(): Promise<MavftpDirectoryEntry[]> {
    return listMavftpLogFiles((path) => this.mavftp.listRemoteDirectory(path))
  }

  /** Download one onboard log over MAVFTP burst read, reporting progress. */
  /**
   * Download one onboard log over MAVFTP burst read, reporting progress.
   *
   * `silent` suppresses the status entry and the snapshot emit. Background work
   * the operator did not ask for must leave no trace in the status feed: a
   * "Downloaded /APM/LOGS/00000042.BIN" line appearing unprompted reads as the
   * app doing something behind their back, and buries the entries they were
   * actually watching for. An operator-initiated download still reports, since
   * there the line is the confirmation they are waiting on.
   */
  async downloadMavftpLog(
    path: string,
    onProgress?: (progress: LogDownloadProgress) => void,
    options: { silent?: boolean; signal?: AbortSignal } = {}
  ): Promise<Uint8Array> {
    const bytes = await this.mavftp.downloadRemoteFileBurst(path, {
      onProgress,
      maxBytes: MAX_MAVFTP_LOG_BYTES,
      signal: options.signal
    })
    if (!options.silent) {
      this.appendStatusEntry('info', `Downloaded ${path} via MAVFTP (${bytes.length} bytes).`)
      this.emit()
    }
    return bytes
  }

  // Fetch @PARAM/param.pck?withdefaults=1 (ArduPilot 4.5+) — the packed param
  // table where each param carries a flag when it differs from its firmware
  // default. Returns the raw bytes; the caller parses them (parseParamPck) to
  // derive the non-default set. Uses the same burst reader as log download.
  async downloadParamPack(): Promise<Uint8Array> {
    const bytes = await this.mavftp.downloadRemoteFileBurst('@PARAM/param.pck?withdefaults=1', {
      maxBytes: MAX_MAVFTP_LOG_BYTES
    })
    this.appendStatusEntry('info', `Fetched packed param defaults via MAVFTP (${bytes.length} bytes).`)
    this.emit()
    return bytes
  }

  async uploadRemoteFile(path: string, bytes: Uint8Array, options: { overwrite?: boolean } = {}): Promise<void> {
    await this.mavftp.uploadRemoteFile(path, bytes, options)
    this.appendStatusEntry('info', `Uploaded ${path} via MAVFTP.`)
    this.emit()
  }

  async deleteRemotePath(path: string, kind: 'file' | 'directory' = 'file'): Promise<void> {
    await this.mavftp.deleteRemotePath(path, kind)
    this.appendStatusEntry('info', `Removed ${path} via MAVFTP.`)
    this.emit()
  }

  async runGuidedAction(actionId: GuidedActionId): Promise<void> {
    if (actionId === 'request-parameters') {
      await this.requestParameterList()
      return
    }

    await this.guidedActionService.runCalibrationAction(actionId)
  }

  /**
   * Operator-initiated abort of a requested/running guided action. A
   * calibration stranded in 'running' (lost completion message, abandoned
   * mid-cal) blocks every parameter write via hasActiveAction(); this is
   * the recovery path that doesn't require a reboot. No-op for
   * 'request-parameters' (owned by the parameter-sync state machine) and
   * for actions that aren't active.
   */
  cancelGuidedAction(actionId: GuidedActionId): void {
    if (actionId === 'request-parameters') {
      return
    }

    this.guidedActionService.cancelAction(actionId)
  }

  async runMotorTest(request: MotorTestRequest, options: MotorTestEligibilityOptions = {}): Promise<void> {
    return this.motorTestService.run(request, options)
  }

  /** Operator-initiated early abort of an in-flight motor test. Resolves
   *  with whether the zero-throttle abort was sent and ACKed, so callers
   *  chaining a follow-up spin can refuse to start one on an unproven stop. */
  async stopMotorTest(): Promise<MotorTestStopResult> {
    return this.motorTestService.stop()
  }

  /** True while a synthetic GPS is being streamed for no-GPS calibration. */
  isFakeGpsActive(): boolean {
    return this.fakeGpsTimer !== undefined
  }

  /**
   * Start streaming a synthetic GPS (GPS_INPUT) at a fixed location so the EKF
   * can acquire a position and complete yaw alignment with no physical GPS —
   * which is what onboard compass calibration requires to start. Temporarily
   * switches the GPS backend to type 14 (MAV) so the autopilot consumes the
   * stream, saving the previous value to restore on stop. Validated in SITL:
   * with this running, DO_START_MAG_CAL is accepted on a GPS-less vehicle.
   *
   * The stream must keep running for the whole calibration; call stopFakeGps()
   * afterwards to halt it and restore the GPS backend type.
   */
  async startFakeGps(latitudeDeg: number, longitudeDeg: number, altitudeMeters = 0): Promise<void> {
    if (this.fakeGpsTimer !== undefined) {
      await this.stopFakeGps()
    }
    // Save the current backend type, then switch to MAV so GPS_INPUT is used.
    this.fakeGpsOriginalType = this.parameters.get('GPS1_TYPE')?.value
    await this.setParameter('GPS1_TYPE', 14)

    const latitudeE7 = Math.round(latitudeDeg * 1e7)
    const longitudeE7 = Math.round(longitudeDeg * 1e7)
    const send = (): void => {
      void this.session
        .send({
          type: 'GPS_INPUT',
          gpsId: 0,
          // Ignore velocity (horiz/vert) and speed accuracy — we only assert a
          // static position. GPS_INPUT_IGNORE_FLAG_VEL_HORIZ|VEL_VERT|SPEED_ACCURACY.
          ignoreFlags: 8 | 16 | 32,
          fixType: 3,
          latitudeE7,
          longitudeE7,
          altitudeM: altitudeMeters,
          hdop: 1,
          vdop: 1,
          satellitesVisible: 12
        })
        .catch(() => {
          // transient send failures are fine — the next tick retries
        })
    }
    send()
    this.fakeGpsTimer = setInterval(send, 200)
  }

  /** Stop the synthetic GPS stream and restore the original GPS backend type. */
  async stopFakeGps(): Promise<void> {
    if (this.fakeGpsTimer !== undefined) {
      clearInterval(this.fakeGpsTimer)
      this.fakeGpsTimer = undefined
    }
    if (this.fakeGpsOriginalType !== undefined) {
      try {
        await this.setParameter('GPS1_TYPE', this.fakeGpsOriginalType)
      } catch {
        // best-effort restore; the operator can also reboot to reset
      }
      this.fakeGpsOriginalType = undefined
    }
  }

  // ---- DroneCAN bus tab ---------------------------------------------------
  /** Ask ArduPilot to start forwarding CAN frames from the given bus
   *  index (1 or 2) over the MAVLink CAN_FRAME tunnel. The configurator's
   *  CAN tab uses this to drive its discovery + parameter UI. MAVLink
   *  stays alive on the same channel — this is the same mechanism
   *  Mission Planner uses for its DroneCAN inspector. */
  async startCanBusForward(bus: number): Promise<void> {
    return this.canBusService.start(bus)
  }

  /** Stop CAN forwarding cleanly. Best-effort: the autopilot also
   *  times the forward state out on its own if MAVLink goes quiet. */
  async stopCanBusForward(): Promise<void> {
    return this.canBusService.stop()
  }

  /** Reboot the autopilot into its bootloader / DFU stage by sending
   *  MAV_CMD_PREFLIGHT_REBOOT_SHUTDOWN with param1=3. Most STM32-based
   *  ArduPilot boards then enumerate as a DFU device on USB. Throws on
   *  REJECTED / TIMEOUT — the caller surfaces that to the operator. */
  async rebootToBootloader(): Promise<void> {
    // ArduPilot refuses param1=3 while armed, so this is belt-and-braces —
    // but it turns a confusing FAILED ack into a sentence, and it keeps the
    // two bootloader entry points behaving alike.
    this.assertNotArmed('Disarm the vehicle before rebooting to the bootloader.')
    // Whatever is flashed next may have a different parameter table, so no
    // table from this session may survive to be resumed against it.
    this.discardStaleLink()
    await this.sendCommand(MAV_CMD.PREFLIGHT_REBOOT_SHUTDOWN, [3, 0, 0, 0, 0, 0, 0], {
      waitForAck: true,
      ackTimeoutMs: 3000
    })
  }

  /**
   * Reboot into the STM32 ROM DFU bootloader — a different thing entirely from
   * rebootToBootloader() above, and the distinction cost an operator an
   * evening.
   *
   * `rebootToBootloader()` (param1=3) holds the board in *ArduPilot's own*
   * bootloader, which speaks the ArduPilot serial protocol and is what our
   * Web Serial flasher talks to. It is NOT DFU. Real DFU is the chip's ROM
   * bootloader, enumerating as an STM32 device (VID 0483 / PID DF11) — which
   * is what you need when the ArduPilot bootloader itself is the problem.
   *
   * The magic is ArduPilot's, not ours: GCS_Common.cpp handle_preflight_reboot
   * gates the DFU branch behind param1=42, param2=24, param3=71 and only then
   * looks at param4=99. Nothing else in that handler accepts param1=42, which
   * is why a firmware without DFU support answers UNSUPPORTED rather than
   * doing something unintended.
   *
   * Three answers are possible and the caller must distinguish them:
   *  - ACCEPTED: "Entering DFU mode", the link drops, board re-enumerates.
   *  - UNSUPPORTED: built without ENABLE_DFU_BOOT (the default for most
   *    boards). The magic block is compiled out, execution falls through to
   *    the param1 must-be-1-or-3 check, and that is what rejects it.
   *  - FAILED: AP_SIGNED_FIRMWARE — "Refusing DFU for secure firmware".
   *
   * One caveat this cannot detect: __entry_hook, which performs the actual
   * jump to ROM, lives in the BOOTLOADER build. A board whose firmware has DFU
   * support but whose flashed bootloader predates it will accept the command,
   * reboot, and come back normally.
   */
  async rebootToDfu(): Promise<void> {
    // ArduPilot does NOT protect this one. handle_preflight_reboot's
    // "refuse reboot when armed" check (GCS_Common.cpp:3646) sits AFTER the
    // magic block, so the param4==99 branch returns ACCEPTED and calls
    // boot_to_dfu() without ever consulting get_soft_armed(). Every other
    // reboot path in that handler is guarded; this is the exception, so the
    // guard has to be ours. Dropping a flying aircraft into ROM DFU stops the
    // motors.
    this.assertNotArmed('Disarm the vehicle before requesting DFU mode.')
    this.discardStaleLink()
    const ack = await this.sendCommand(MAV_CMD.PREFLIGHT_REBOOT_SHUTDOWN, [42, 24, 71, 99, 0, 0, 0], {
      waitForAck: true,
      ackTimeoutMs: 3000,
      // Handled here so each result gets its own actionable sentence rather
      // than the generic "command rejected".
      rejectAckOnFailure: false
    })
    const result = ack && 'result' in ack ? ack.result : undefined
    if (result === MAV_RESULT.ACCEPTED) {
      return
    }
    if (result === MAV_RESULT.UNSUPPORTED) {
      throw new Error(
        'This firmware was not built with DFU support (ENABLE_DFU_BOOT), so it cannot enter DFU on command. Use the board’s BOOT/DFU button or pads while plugging in USB.'
      )
    }
    if (result === MAV_RESULT.FAILED) {
      throw new Error(
        'The autopilot refused to enter DFU. Secure (signed) firmware blocks it — check the messages for "Refusing DFU for secure firmware".'
      )
    }
    throw new Error(
      `The autopilot did not accept the DFU request${result === undefined ? ' (no acknowledgement)' : ` (result ${result})`}.`
    )
  }

  /**
   * Re-flash the bootloader from the image embedded in the RUNNING firmware
   * (MAV_CMD_FLASH_BOOTLOADER, param5 = the 290876 magic).
   *
   * This is not a file upload: the autopilot writes the bootloader it was
   * built with, so the firmware currently flashed determines the bootloader
   * you get. It is the recommended way to update a bootloader in the field
   * because it needs no DFU cable and no external tooling.
   *
   * Deliberately NOT wrapped in discardStaleLink(): unlike rebootToBootloader
   * this leaves the vehicle running the same firmware with the same parameter
   * table, so there is nothing stale to drop. ArduPilot answers ACCEPTED on
   * both OK and NO_CHANGE (an already-current bootloader is a success, not an
   * error the operator should see).
   */
  async flashBootloader(): Promise<void> {
    await this.sendCommand(MAV_CMD.FLASH_BOOTLOADER, [0, 0, 0, 0, FLASH_BOOTLOADER_MAGIC, 0, 0], {
      waitForAck: true,
      // Erasing and rewriting the bootloader sector takes appreciably longer
      // than a normal command round-trip.
      ackTimeoutMs: 20000,
      rejectAckOnFailure: true
    })
  }

  /**
   * Restart onboard Lua scripting WITHOUT rebooting the autopilot
   * (MAV_CMD_SCRIPTING, param1 = SCRIPTING_CMD_STOP_AND_RESTART).
   *
   * ArduPilot asks for this whenever a script changes on disk — it emits a
   * "restart scripting" STATUSTEXT — and until now the only way to act on it
   * from here was a full flight-controller reboot, which drops the link,
   * re-runs every startup check and re-syncs the whole parameter table.
   *
   * Values verified against AP_Scripting.cpp's handle_command_int_packet:
   * STOP = 2, STOP_AND_RESTART = 3. REPL_START/REPL_STOP (0/1) are deliberately
   * not exposed — that handler returns MAV_RESULT_DENIED for both.
   */
  async restartScripting(): Promise<void> {
    await this.sendCommand(MAV_CMD.SCRIPTING, [SCRIPTING_CMD_STOP_AND_RESTART, 0, 0, 0, 0, 0, 0], {
      waitForAck: true,
      ackTimeoutMs: 3000
    })
  }

  /**
   * Stop onboard Lua scripting until the next restart or reboot
   * (MAV_CMD_SCRIPTING, param1 = SCRIPTING_CMD_STOP).
   */
  async stopScripting(): Promise<void> {
    await this.sendCommand(MAV_CMD.SCRIPTING, [SCRIPTING_CMD_STOP, 0, 0, 0, 0, 0, 0], {
      waitForAck: true,
      ackTimeoutMs: 3000
    })
  }

  /** Normal autopilot reboot (PREFLIGHT_REBOOT_SHUTDOWN param1=1). */
  async reboot(): Promise<void> {
    await this.sendCommand(MAV_CMD.PREFLIGHT_REBOOT_SHUTDOWN, [1, 0, 0, 0, 0, 0, 0], {
      waitForAck: true,
      ackTimeoutMs: 3000
    })
  }

  /**
   * Put the RC receiver into bind/pair mode (MAV_CMD_START_RX_PAIR). ArduPilot
   * routes this to the active RC protocol's bind: CRSF/ExpressLRS emits the CRSF
   * "RX bind" command frame to the receiver, Spektrum pulses the satellite bind.
   * param1 is the RC_TYPE (1 = CRSF) per the MAVLink spec — ArduPilot ignores it
   * (it binds every enabled backend), but setting it keeps us spec-correct and
   * portable. Fire-and-forget — the autopilot returns ACCEPTED unconditionally
   * and does not report whether the RX actually entered bind mode, so the
   * operator confirms via the receiver LED / their transmitter. Note: ELRS
   * receivers with a bind phrase set ignore this command.
   */
  async startReceiverBind(): Promise<void> {
    // param1 = RC_TYPE_CRSF (1); remaining params unused for CRSF/ELRS.
    await this.sendCommand(MAV_CMD.START_RX_PAIR, [1, 0, 0, 0, 0, 0, 0])
    this.appendStatusEntry(
      'info',
      'Receiver bind requested (MAV_CMD_START_RX_PAIR) — put the receiver/transmitter into bind mode.'
    )
    this.emit()
  }

  /**
   * Resolve once a STATUSTEXT whose text CONTAINS `substring` arrives (matching
   * any already in the recent history first), or reject on timeout. Used to gate
   * on autopilot banners like "Passthru enabled" that have no MAVLink ACK.
   */
  waitForStatusText(substring: string, timeoutMs: number): Promise<void> {
    if (this.statusTexts.some((entry) => entry.text.includes(substring))) {
      return Promise.resolve()
    }
    return new Promise((resolve, reject) => {
      const waiter = {
        substring,
        resolve: () => {
          clearTimeout(timer)
          resolve()
        }
      }
      const timer = setTimeout(() => {
        const index = this.statusTextWaiters.indexOf(waiter)
        if (index >= 0) {
          this.statusTextWaiters.splice(index, 1)
        }
        reject(new Error(`Timed out after ${timeoutMs}ms waiting for STATUSTEXT containing "${substring}".`))
      }, timeoutMs)
      this.statusTextWaiters.push(waiter)
    })
  }

  /**
   * Enable ArduPilot's transparent USB↔UART pass-through bridge so a host tool
   * (e.g. esptool flashing an ELRS receiver) can talk to a UART-attached device
   * through the FC. Sets SERIAL_PASS1 (source, default 0 = USB console),
   * SERIAL_PASSTIMO (auto-restore timeout), then SERIAL_PASS2 (destination UART)
   * LAST so the bridge only arms once the timeout is configured — each write is
   * verified against the echoed PARAM_VALUE. Resolves when the FC reports
   * "Passthru enabled". The caller must then release the transport (disconnect)
   * and reopen the port at the flashing baud, since the FC forwards USB-CDC baud
   * changes onto the target UART.
   */
  async enableSerialPassthrough(
    destinationPort: number,
    options: { timeoutSeconds?: number; sourcePort?: number; statusTextTimeoutMs?: number } = {}
  ): Promise<void> {
    const { timeoutSeconds = 15, sourcePort = 0, statusTextTimeoutMs = 5000 } = options
    await this.setParameter('SERIAL_PASS1', sourcePort)
    await this.setParameter('SERIAL_PASSTIMO', timeoutSeconds)
    await this.setParameter('SERIAL_PASS2', destinationPort)
    await this.waitForStatusText('Passthru enabled', statusTextTimeoutMs)
    this.appendStatusEntry(
      'info',
      `Serial pass-through enabled (Serial${sourcePort} ↔ Serial${destinationPort}, ${timeoutSeconds}s timeout).`
    )
    this.emit()
  }

  /** Start CompassMot (compass/motor interference) calibration via
   *  MAV_CMD_PREFLIGHT_CALIBRATION param6=1. The vehicle must be disarmed,
   *  restrained, and have its props removed — running it spins the motors.
   *  Progress + completion arrive as STATUSTEXT, surfaced in the status feed. */
  async startCompassMotCalibration(): Promise<void> {
    await this.sendCommand(MAV_CMD.PREFLIGHT_CALIBRATION, [0, 0, 0, 0, 0, 1, 0], {
      waitForAck: true,
      ackTimeoutMs: 3000
    })
  }

  /** Reset all parameters to firmware defaults (PREFLIGHT_STORAGE param1=2).
   *  Destructive — wipes the operator's configuration. A reboot is required
   *  afterwards for the defaults to take effect. */
  async resetParametersToDefaults(): Promise<void> {
    // AP_Param::erase_all() on an armed vehicle wipes the tuning it is flying
    // on. ArduPilot's PREFLIGHT_STORAGE handler has no armed check of its own
    // (GCS_Common.cpp:5813), and this is reachable from two UI surfaces, so the
    // guard belongs here rather than in either of them.
    //
    // Deliberately assertNotArmed and NOT the full parameter-write gate: that
    // one also requires a completed parameter sync, and "reset this board to
    // defaults" is precisely what you reach for when a board is too broken to
    // finish syncing. Refusing it there would block the recovery it exists for.
    this.assertNotArmed('Disarm the vehicle before resetting parameters to defaults.')
    await this.sendCommand(MAV_CMD.PREFLIGHT_STORAGE, [2, 0, 0, 0, 0, 0, 0], {
      waitForAck: true,
      ackTimeoutMs: 3000
    })
  }

  /** Re-issue uavcan.protocol.GetNodeInfo for the given node (used to
   *  refresh identity if the first response was lost). */
  refreshCanBusNode(nodeId: number): void {
    this.canBusService.refreshNode(nodeId)
  }

  /** Restart a discovered DroneCAN node via uavcan.protocol.RestartNode.
   *  The node reboots and re-announces itself with a fresh uptime. */
  async restartCanBusNode(nodeId: number): Promise<void> {
    return this.canBusService.restartNode(nodeId)
  }

  /** Re-fetch all parameters for the given node from index 0. */
  fetchAllCanBusParameters(nodeId: number): void {
    this.canBusService.fetchAllParameters(nodeId)
  }

  /** Write one parameter on a discovered DroneCAN node. The write IS
   *  the read — DroneCAN GetSet returns the post-write value as its
   *  response, which the service handles by updating the snapshot. */
  async writeCanBusParameter(
    nodeId: number,
    paramName: string,
    value: import('./types.js').DronecanParamValueState
  ): Promise<void> {
    return this.canBusService.writeParameter(nodeId, paramName, value)
  }

  /** Trigger uavcan.protocol.param.ExecuteOpcode(SAVE) so the node
   *  persists its parameter table across reboots. */
  async saveCanBusParameters(nodeId: number): Promise<void> {
    return this.canBusService.saveParameters(nodeId)
  }

  /** Write a batch of staged parameters to a node, then SAVE to flash once
   *  every write is acknowledged (the single "Apply & Save" action). */
  async applyAndSaveCanBusParameters(
    nodeId: number,
    writes: Array<{ name: string; value: import('./types.js').DronecanParamValueState }>
  ): Promise<void> {
    return this.canBusService.applyAndSave(nodeId, writes)
  }

  /** Update a DroneCAN node's firmware: the configurator acts as the file
   *  server over the CAN_FORWARD tunnel — it sends uavcan.protocol.file
   *  BeginFirmwareUpdate, then answers the node's file.Read requests with the
   *  selected image until the node has read it all and reboots. Only one
   *  update runs at a time. Progress + result surface on canBus.firmwareUpdate. */
  async startCanBusNodeFirmwareUpdate(nodeId: number, fileName: string, image: Uint8Array): Promise<void> {
    return this.canBusService.startFirmwareUpdate(nodeId, fileName, image)
  }

  /** Cancel an in-flight node firmware update, or dismiss a finished one. */
  cancelCanBusNodeFirmwareUpdate(): void {
    this.canBusService.cancelFirmwareUpdate()
  }

  /**
   * Operator-triggered SET_MESSAGE_INTERVAL (MAV_CMD 511) for the MAVLink
   * inspector. `intervalUs` is the raw command interval: > 0 streams the
   * message at that period, 0 requests the firmware default rate, and a
   * negative value disables the stream. A label is pushed onto the pending
   * stream-request queue so the ACK lines up with the auto-stream bookkeeping
   * (and is removed again if the send itself fails before any ACK). Standard
   * GCS command, clearly user-initiated — does not change ArduCopter's
   * unsolicited stream behaviour.
   */
  async requestMessageInterval(messageId: number, intervalUs: number): Promise<MessageRequestResult> {
    const label = `message ${messageId}`
    this.pendingSetMessageIntervalLabels.push(label)
    try {
      const ack = await this.sendCommand(
        MAV_CMD.SET_MESSAGE_INTERVAL,
        [messageId, intervalUs, 0, 0, 0, 0, 0],
        { waitForAck: true, rejectAckOnFailure: false }
      )
      return this.toMessageRequestResult(ack)
    } catch (error) {
      const index = this.pendingSetMessageIntervalLabels.lastIndexOf(label)
      if (index >= 0) {
        this.pendingSetMessageIntervalLabels.splice(index, 1)
      }
      throw error
    }
  }

  /**
   * Operator-triggered one-shot REQUEST_MESSAGE (MAV_CMD 512): ask the vehicle
   * to emit a single instance of the message now. Does not touch the
   * stream-request label queue (that bookkeeping is SET_MESSAGE_INTERVAL only).
   */
  async requestMessageOnce(messageId: number): Promise<MessageRequestResult> {
    const ack = await this.sendCommand(MAV_CMD.REQUEST_MESSAGE, [messageId, 0, 0, 0, 0, 0, 0], {
      waitForAck: true,
      rejectAckOnFailure: false
    })
    return this.toMessageRequestResult(ack)
  }

  private toMessageRequestResult(ack: CommandAckMessage | void): MessageRequestResult {
    if (!ack) {
      return { ok: false, result: -1, resultLabel: 'no acknowledgment' }
    }
    const ok = ack.result === MAV_RESULT.ACCEPTED || ack.result === MAV_RESULT.IN_PROGRESS
    return { ok, result: ack.result, resultLabel: mavResultLabel(ack.result) }
  }

  destroy(): void {
    // Flush any pending coalesced emit synchronously before cancelling the
    // rAF/timer, so a still-subscribed listener isn't left on stale state.
    const hadPendingEmit = this.emitHandle !== undefined || this.emitTimer !== undefined
    this.cancelScheduledEmit()
    if (hadPendingEmit) {
      this.flushEmit()
    }
    this.subscriptions.forEach((unsubscribe) => unsubscribe())
    this.commandAckWaiters.forEach((waiter) => {
      clearTimeout(waiter.timer)
      waiter.reject(new Error('Runtime destroyed before command acknowledgment was received.'))
    })
    this.commandAckWaiters.clear()
    this.parameterValueWaiters.rejectAll(new Error('Runtime destroyed before parameter verification was received.'))
    this.rejectAutopilotVersionWaiters(new Error('Runtime destroyed before AUTOPILOT_VERSION was received.'))
    this.mavftp.cancelAll(new Error('Runtime destroyed before the MAVFTP request completed.'))
    this.logDownload.cancelAll(new Error('Runtime destroyed before the log request completed.'))
    this.motorTestService.clearCompletionTimer()
    if (this.fakeGpsTimer !== undefined) {
      clearInterval(this.fakeGpsTimer)
      this.fakeGpsTimer = undefined
    }
    this.guidedActionService.destroy()
    this.canBusService.destroy()
    this.clearPreArmExpiryTimer()
    this.clearPreArmRefresh()
    this.clearParameterSyncRetryTimer()
    this.clearCanNodeStaleSweep()
    this.rejectVehicleWaiters(new Error('Runtime destroyed before vehicle heartbeat was received.'))
    this.parameterSyncWaiters.rejectAll(new Error('Runtime destroyed before parameter sync completed.'))
    this.session.destroy()
  }

  private async sendCommand(
    command: number,
    params: number[],
    options: { waitForAck?: boolean; ackTimeoutMs?: number; rejectAckOnFailure?: boolean } = {}
  ): Promise<CommandAckMessage | void> {
    const message: CommandLongMessage = {
      type: 'COMMAND_LONG',
      command,
      targetSystem: this.vehicle?.systemId ?? 1,
      targetComponent: this.vehicle?.componentId ?? 1,
      confirmation: 0,
      params: params as CommandLongMessage['params']
    }

    const ackWaiter = options.waitForAck
      ? this.waitForCommandAck(command, options.ackTimeoutMs, { rejectOnFailure: options.rejectAckOnFailure ?? true })
      : undefined
    try {
      await this.session.send(message)
    } catch (error) {
      const sendError = error instanceof Error ? error : new Error('Unknown command send error.')
      ackWaiter?.cancel(sendError)
      void ackWaiter?.promise.catch(() => {})
      throw sendError
    }
    if (ackWaiter) {
      return ackWaiter.promise
    }
  }

  private async requestLiveTelemetryStreams(systemId: number, componentId: number): Promise<void> {
    this.liveTelemetryRequestsIssued = true

    try {
      for (const request of LIVE_TELEMETRY_REQUESTS) {
        this.pendingSetMessageIntervalLabels.push(request.label)
        await this.session.send({
          type: 'COMMAND_LONG',
          command: MAV_CMD.SET_MESSAGE_INTERVAL,
          targetSystem: systemId,
          targetComponent: componentId,
          confirmation: 0,
          params: [request.messageId, request.intervalUs, 0, 0, 0, 0, 0]
        })
      }

      this.appendStatusEntry(
        'info',
        `Requested live telemetry streams: ${LIVE_TELEMETRY_REQUESTS.map((request) => request.label).join(', ')}.`
      )
    } catch (error) {
      this.liveTelemetryRequestsIssued = false
      const message = error instanceof Error ? error.message : 'Unknown live telemetry request error.'
      this.appendStatusEntry('warning', `Failed to request live telemetry streams: ${message}`)
    }

    // Whether or not the SET_MESSAGE_INTERVAL run accepted the UAVCAN
    // entry, fire a one-shot MAV_CMD_UAVCAN_GET_NODE_INFO broadcast.
    // ArduPilot's MAVLink-UAVCAN bridge frequently refuses
    // SET_MESSAGE_INTERVAL for msgid 310 (NODE_STATUS) — observed on
    // CubeRed + ArduPlane 4.6.3 — but reliably responds to the GET
    // command with one UAVCAN_NODE_INFO per online node. That populates
    // snapshot.canNodes from identity arrivals alone, even when the
    // periodic NODE_STATUS stream stays dark.
    void this.requestCanNodeInfoBroadcastOnConnect()
  }

  // One-shot MAV_CMD_UAVCAN_GET_NODE_INFO broadcast at connect. The bridge
  // replies with UAVCAN_NODE_INFO per online node, so node identity populates
  // snapshot.canNodes even when SET_MESSAGE_INTERVAL for UAVCAN_NODE_STATUS is
  // refused (health/mode stay 'unknown' until NODE_STATUS flows).
  private async requestCanNodeInfoBroadcastOnConnect(): Promise<void> {
    if (!this.vehicle) {
      return
    }
    // Stamp the debounce so the subsequent NODE_STATUS-driven refresh
    // in maybeRequestCanNodeInfo() doesn't double-send within 5s.
    this.canNodeInfoLastRequestedAtMs = Date.now()
    try {
      await this.session.send({
        type: 'COMMAND_LONG',
        command: MAV_CMD.UAVCAN_GET_NODE_INFO,
        targetSystem: this.vehicle.systemId,
        targetComponent: this.vehicle.componentId,
        confirmation: 0,
        params: [0, 0, 0, 0, 0, 0, 0]
      })
    } catch {
      // Best-effort; the periodic NODE_STATUS path will retry if it ever
      // starts arriving.
    }
  }

  private async requestAutopilotVersion(systemId: number, componentId: number): Promise<void> {
    const waiter = this.waitForAutopilotVersion()

    try {
      await this.session.send({
        type: 'COMMAND_LONG',
        command: MAV_CMD.REQUEST_MESSAGE,
        targetSystem: systemId,
        targetComponent: componentId,
        confirmation: 0,
        params: [MAVLINK_MESSAGE_IDS.AUTOPILOT_VERSION, 0, 0, 0, 0, 0, 0]
      })
      await waiter.promise
    } catch (error) {
      const requestError = error instanceof Error ? error : new Error('Unknown AUTOPILOT_VERSION request error.')
      waiter.cancel(requestError)
      void waiter.promise.catch(() => {})
      this.autopilotVersionRequested = false
      this.appendStatusEntry('warning', `Failed to identify board metadata: ${requestError.message}`)
      this.emit()
    }
  }

  private processAutopilotVersion(message: AutopilotVersionMessage): void {
    const board: HardwareBoardState = {
      boardVersion: message.boardVersion,
      boardType: boardTypeFromBoardVersion(message.boardVersion),
      vendorId: message.vendorId,
      productId: message.productId,
      uid: formatAutopilotUid(message.uid, message.uid2),
      ftpSupported: (message.capabilities & MAV_PROTOCOL_CAPABILITY.FTP) !== 0n,
      firmwareVersion: formatFlightSwVersion(message.flightSwVersion),
      firmwareVersionParts: parseFlightSwVersion(message.flightSwVersion),
      firmwareGitHash: formatFlightCustomVersion(message.flightCustomVersion),
      lastUpdatedAtMs: Date.now()
    }

    this.hardwareBoard = board
    this.resolveAutopilotVersionWaiters(board)

    if (!board.ftpSupported && this.uartsFile.status === 'idle') {
      this.uartsFile = {
        ...createIdleUartsFileState(),
        status: 'unsupported'
      }
      return
    }

    if (board.ftpSupported && !this.uartsFileRequested && this.uartsFile.status === 'idle') {
      this.uartsFileRequested = true
      void this.fetchUartsFile()
    }
  }

  private async fetchUartsFile(): Promise<void> {
    if (!this.vehicle) {
      return
    }

    this.uartsFile = {
      ...createIdleUartsFileState(),
      status: 'loading'
    }
    this.emit()

    try {
      let rawText: string
      try {
        rawText = await this.mavftp.readRemoteTextFile(UARTS_FILE_PATH, {
          timeoutMs: UARTS_FETCH_TIMEOUT_MS
        })
      } catch (firstError) {
        // One retry for a dropped @SYS read, but never retry "file not found".
        const firstMessage = firstError instanceof Error ? firstError.message : ''
        if (/file not found/i.test(firstMessage)) {
          throw firstError
        }
        rawText = await this.mavftp.readRemoteTextFile(UARTS_FILE_PATH, {
          timeoutMs: UARTS_FETCH_TIMEOUT_MS
        })
      }
      this.uartsFile = {
        status: 'ready',
        path: UARTS_FILE_PATH,
        mappings: parseUartsFile(rawText),
        rawText,
        fetchedAtMs: Date.now()
      }
      this.appendStatusEntry('info', `Fetched ${UARTS_FILE_PATH} via MAVFTP.`)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown MAVFTP error.'
      const status = /file not found/i.test(message) ? 'missing' : 'error'
      this.uartsFile = {
        status,
        path: UARTS_FILE_PATH,
        mappings: [],
        error: message
      }
      this.appendStatusEntry('warning', `Unable to fetch ${UARTS_FILE_PATH}: ${message}`)
    }

    this.emit()
  }

  private async requireMavftpSupport(): Promise<void> {
    if (!this.vehicle) {
      throw new Error('MAVFTP requires an identified vehicle.')
    }

    if (!this.hardwareBoard) {
      if (!this.autopilotVersionRequested) {
        this.autopilotVersionRequested = true
        void this.requestAutopilotVersion(this.vehicle.systemId, this.vehicle.componentId)
      }

      const board = await this.waitForAutopilotVersion().promise
      if (!board.ftpSupported) {
        throw new Error('This controller did not advertise MAVFTP support.')
      }
      return
    }

    if (!this.hardwareBoard.ftpSupported) {
      throw new Error('This controller did not advertise MAVFTP support.')
    }
  }

  private processEnvelope(envelope: MavlinkEnvelope): void {
    switch (envelope.message.type) {
      case 'HEARTBEAT':
        this.processHeartbeat(envelope.message, envelope.header.systemId, envelope.header.componentId)
        break
      case 'PARAM_VALUE':
        this.processParamValue(envelope.message)
        break
      case 'RC_CHANNELS':
        this.processRcChannels(envelope.message)
        break
      case 'GLOBAL_POSITION_INT':
        this.processGlobalPosition(envelope.message)
        break
      case 'GPS_RAW_INT':
        this.processGpsRawInt(envelope.message)
        break
      case 'ATTITUDE':
        this.processAttitude(envelope.message)
        break
      case 'ATTITUDE_QUATERNION':
        this.processAttitudeQuaternion(envelope.message)
        break
      case 'SCALED_IMU':
        this.processScaledImu(envelope.message)
        break
      case 'AUTOPILOT_VERSION':
        this.processAutopilotVersion(envelope.message)
        break
      case 'FILE_TRANSFER_PROTOCOL':
        this.mavftp.handleFileTransferProtocol(envelope.message)
        break
      case 'LOG_ENTRY':
        this.logDownload.handleLogEntry(envelope.message)
        break
      case 'LOG_DATA':
        this.logDownload.handleLogData(envelope.message)
        break
      case 'MAG_CAL_PROGRESS':
        this.guidedActionService.handleMagCalProgress(envelope.message)
        this.emit()
        break
      case 'MAG_CAL_REPORT':
        this.guidedActionService.handleMagCalReport(envelope.message)
        this.emit()
        break
      case 'COMMAND_ACK':
        this.processCommandAck(envelope.message, envelope.header.systemId, envelope.header.componentId)
        break
      case 'COMMAND_LONG':
        this.processCommandLong(envelope.message, envelope.header.systemId, envelope.header.componentId)
        break
      case 'STATUSTEXT':
        this.processStatusText(envelope.message)
        break
      case 'SYS_STATUS':
        this.processSysStatus(envelope.message)
        break
      case 'UAVCAN_NODE_STATUS':
        this.processUavcanNodeStatus(envelope.message, envelope.header.componentId)
        break
      case 'UAVCAN_NODE_INFO':
        this.processUavcanNodeInfo(envelope.message, envelope.header.componentId)
        break
      case 'CAN_FRAME':
        this.canBusService.processCanFrame(envelope.message)
        break
      case 'OPTICAL_FLOW':
        this.processOpticalFlow(envelope.message)
        break
      case 'DISTANCE_SENSOR':
        this.processDistanceSensor(envelope.message)
        break
      case 'ESC_TELEMETRY':
        this.processEscTelemetry(envelope.message)
        break
      default:
        break
    }
  }

  private processHeartbeat(message: HeartbeatMessage, systemId: number, componentId: number): void {
    if (!isAuthoritativeHeartbeat(message)) {
      return
    }

    if (this.vehicle && (this.vehicle.systemId !== systemId || this.vehicle.componentId !== componentId)) {
      return
    }

    this.vehicle = createVehicleIdentity(message, systemId, componentId)
    this.applyFirmwareMetadata(this.vehicle.vehicle)

    // Retained values from a different board must never linger once this one
    // announces itself — better an empty screen than another vehicle's config
    // shown against this heartbeat.
    if (this.staleLink && this.staleLink.key !== this.staleLinkKey(this.vehicle)) {
      this.discardStaleLink()
    }

    if (this.parameterSync.status === 'awaiting-vehicle') {
      this.parameterSync = createIdleParameterSync()
    }

    this.resolveVehicleWaiters(this.vehicle)

    if (!this.liveTelemetryRequestsIssued) {
      void this.requestLiveTelemetryStreams(systemId, componentId)
    }

    if (!this.autopilotVersionRequested) {
      this.autopilotVersionRequested = true
      void this.requestAutopilotVersion(systemId, componentId)
    }

    this.ensurePreArmRefresh()

    // A heartbeat from a board that just finished rebooting is the earliest
    // signal it can answer again. If a download is still open but no retry is
    // armed (nothing can re-arm it once the stream went quiet at exactly the
    // wrong moment), restart the stall timer so the recovery continues.
    if (
      !this.parameterSyncRetryTimer &&
      (this.parameterSync.status === 'requesting' || this.parameterSync.status === 'streaming')
    ) {
      this.scheduleParameterSyncRetry()
    }
  }

  /**
   * Swap the active metadata bundle to the one registered for the detected
   * vehicle, if any. No-op when no per-vehicle bundle was supplied or the
   * active bundle already matches. Emits so derived setup/category state
   * re-derives against the new catalog.
   */
  private applyFirmwareMetadata(vehicle: VehicleIdentity['vehicle']): void {
    if (vehicle === 'Unknown') {
      return
    }
    const next = this.metadataByVehicle[vehicle]
    if (!next || next === this.metadata) {
      return
    }
    this.metadata = next
    this.emit()
  }

  /** The metadata bundle currently driving derived state. */
  getActiveMetadata(): FirmwareMetadataBundle {
    return this.metadata
  }

  /**
   * Settle a resumed download against the first count the reconnected board
   * reports. Same count: the carried values describe this table, keep them.
   * Different count: the parameter table itself changed while we were away, so
   * every carried value is suspect — drop the lot and re-stream from scratch
   * rather than serve the operator a blend of two firmwares.
   */
  private reconcileResumedParameterTable(paramCount: number): void {
    const resumedTotal = this.parameterSyncResumedTotal
    if (resumedTotal === undefined) {
      return
    }
    this.parameterSyncResumedTotal = undefined
    if (paramCount === resumedTotal) {
      return
    }

    this.parameters.clear()
    this.realParameterIdsReceived.clear()
    this.receivedParameterIndices.clear()
    this.totalParameters = 0
    this.parameterTableGrewDuringSync = false
    this.parameterSyncLastRetryDownloaded = 0
    this.parameterSyncGapFillActive = false
    this.parameterSync = {
      ...this.parameterSync,
      status: 'requesting',
      downloaded: 0,
      total: 0,
      progress: null
    }
    this.appendStatusEntry(
      'warning',
      `The board now reports ${paramCount} parameters (was ${resumedTotal}) — its table changed, so the carried-over values were discarded and the download restarted.`
    )
    if (this.vehicle) {
      void this.requestParameterTable(this.vehicle.systemId, this.vehicle.componentId)
    }
  }

  private processParamValue(message: ParamValueMessage): void {
    this.reconcileResumedParameterTable(message.paramCount)
    // "Known" tracks REAL arrivals (excludes alias-mirror entries) so a
    // mirrored entry placed under one id by a later message does not mark
    // an earlier real arrival under the other id as a duplicate.
    const known = this.realParameterIdsReceived.has(message.paramId)
    this.realParameterIdsReceived.add(message.paramId)
    // A board still booting answers PARAM_REQUEST_LIST from a table its
    // libraries have not finished registering, so the count it reports GROWS
    // mid-stream (measured: 953, then 1125 on the same board seconds later).
    // Every index recorded against the smaller table is suspect — the FC
    // renumbers as entries appear — so the coverage map is dropped and the
    // stream re-requested against the real table rather than gap-filling
    // against indices that no longer mean anything.
    if (this.totalParameters > 0 && message.paramCount > this.totalParameters) {
      this.receivedParameterIndices.clear()
      this.parameterTableGrewDuringSync = true
    }
    this.totalParameters = message.paramCount
    // Record the streamed index so a stalled sync can target the gaps. A
    // by-name write echo carries paramIndex 0xffff (no valid index) — ignore it
    // so it can't masquerade as coverage of a real slot.
    if (message.paramIndex !== 0xffff && message.paramIndex < message.paramCount) {
      this.receivedParameterIndices.add(message.paramIndex)
    }

    // A new real arrival is sync progress — re-arm the idle timeout so a slow
    // but steadily-streaming catalog (busy/just-booted board) doesn't time out
    // mid-stream. Duplicates/resends don't count as progress.
    if (!known) {
      this.parameterSyncWaiters.noteProgress()
    }
    const parameterState: ParameterState = {
      id: message.paramId,
      value: message.paramValue,
      index: message.paramIndex,
      count: message.paramCount,
      paramType: message.paramType,
      definition: this.metadata.parameters[message.paramId]
    }
    this.parameters.set(message.paramId, parameterState)
    this.parameterValueWaiters.resolve(parameterState)

    // Bidirectional alias mirror: the FC reports each rename under exactly one
    // name, so surface it under the other id too (the mirror must be
    // bidirectional since either the legacy or the modern name may be the one
    // streamed). The mirror copies value/index/count under the alias's own id.
    const aliasMirror =
      MODERN_TO_LEGACY_ALIASES[message.paramId] ??
      LEGACY_PARAM_ALIASES[message.paramId]
    if (aliasMirror !== undefined) {
      this.parameters.set(aliasMirror, {
        id: aliasMirror,
        value: message.paramValue,
        index: message.paramIndex,
        count: message.paramCount,
        paramType: message.paramType,
        definition: this.metadata.parameters[aliasMirror],
        // Flag the mirror so consumers iterating ALL parameters (raw view,
        // backup serialization) can skip it — otherwise an aliased pair
        // shows up as two duplicate rows and a backup file double-writes
        // the same value under both names.
        aliasedFrom: message.paramId
      })
    }

    // Sync progress counts REAL arrivals only — alias mirrors live in the
    // parameters map for convenient lookup but must not inflate "downloaded"
    // past "total" (which is what the FC promised via paramCount), which
    // would prematurely fire `isComplete` before the real arrivals finish.
    const downloaded = this.realParameterIdsReceived.size
    const duplicateFrames = this.parameterSync.duplicateFrames + (known ? 1 : 0)
    const total = this.totalParameters
    const isComplete = total > 0 && downloaded >= total
    // Once the table has fully synced, a later passive PARAM_VALUE — a write
    // echo, or an FC param_count bump from enabling a subsystem mid-batch — must
    // NOT revert status to 'streaming'. Doing so blocks the rest of an in-flight
    // batch write AND its rollback (parameterWriteBlockReason requires a
    // 'complete' sync), which is exactly what left the vehicle partially written
    // when a batch toggled a feature param. An explicit re-sync
    // (requestParameterList) or a reconnect still resets the status.
    const nextStatus =
      isComplete || this.parameterSync.status === 'complete'
        ? 'complete'
        : downloaded > 0
          ? 'streaming'
          : this.parameterSync.status

    this.parameterSync = {
      status: nextStatus,
      downloaded,
      total,
      duplicateFrames,
      progress: total > 0 ? Math.min(downloaded / total, 1) : null,
      targetSystemId: this.parameterSync.targetSystemId ?? this.vehicle?.systemId,
      targetComponentId: this.parameterSync.targetComponentId ?? this.vehicle?.componentId,
      requestedAtMs: this.parameterSync.requestedAtMs,
      completedAtMs: nextStatus === 'complete' ? this.parameterSync.completedAtMs ?? Date.now() : undefined
    }

    if (isComplete) {
      this.clearParameterSyncRetryTimer()
      this.parameterSyncRetryCount = 0
      this.setGuidedAction('request-parameters', {
        ...this.guidedActionService.getAction('request-parameters'),
        status: 'succeeded',
        summary: `Parameter sync complete. Downloaded ${downloaded}/${total} values.`,
        instructions: ['Review the setup sections and confirm any hardware-dependent steps on the live vehicle.'],
        updatedAtMs: Date.now(),
        completedAtMs: Date.now()
      })
      this.parameterSyncWaiters.resolveAll(this.getSnapshot().parameterStats)
      return
    }

    // Sticky-complete (a post-sync echo / count bump kept status 'complete'
    // above): this isn't a fresh download, so don't schedule a re-sync retry or
    // downgrade the guided action back to "downloading".
    if (this.parameterSync.status === 'complete') {
      return
    }

    this.scheduleParameterSyncRetry()

    if (this.parameterSync.status === 'streaming' || this.parameterSync.status === 'requesting') {
      this.setGuidedAction('request-parameters', {
        ...this.guidedActionService.getAction('request-parameters'),
        status: 'running',
        summary: `Downloading parameter table (${downloaded}/${total || 'unknown'}).`,
        instructions: ['Keep the link open until the parameter stream completes.'],
        updatedAtMs: Date.now(),
        completedAtMs: undefined
      })
    }
  }

  private processStatusText(message: StatusTextMessage): void {
    const now = Date.now()
    // Flush stale partial buffers first, so a cut-off chunked burst surfaces
    // as a partial entry rather than sitting in memory.
    this.flushStaleStatusTextChunks(now)

    // statusId === 0 is the legacy single-frame marker — emit immediately.
    if (message.statusId === 0) {
      this.emitStatusText(message.severity, message.text)
      return
    }

    // Multi-frame: buffer by statusId, keyed by chunkSequence so out-of-order
    // arrivals still concatenate correctly.
    let buffer = this.statusTextChunkBuffers.get(message.statusId)
    if (!buffer) {
      // DoS guard: flush the oldest buffer to make room when too many
      // statusIds are in flight, so a hostile sender can't stream unbounded.
      if (this.statusTextChunkBuffers.size >= STATUSTEXT_MAX_IN_FLIGHT_BUFFERS) {
        let oldestId = -1
        let oldestStart = Infinity
        for (const [id, buf] of this.statusTextChunkBuffers) {
          if (buf.startedAtMs < oldestStart) {
            oldestStart = buf.startedAtMs
            oldestId = id
          }
        }
        if (oldestId >= 0) {
          this.flushStatusTextChunkBuffer(oldestId)
        }
      }
      buffer = { severity: message.severity, chunks: new Map(), startedAtMs: now }
      this.statusTextChunkBuffers.set(message.statusId, buffer)
    }
    buffer.chunks.set(message.chunkSequence, message.text)

    // DoS guard on chunks per buffer. Real ArduPilot messages are at most
    // a few hundred chars; >32 chunks (1600 chars) is well past that.
    if (buffer.chunks.size > STATUSTEXT_MAX_CHUNKS_PER_BUFFER) {
      this.flushStatusTextChunkBuffer(message.statusId)
      return
    }

    // End-of-message detection: ArduPilot sets every chunk except the last
    // to exactly STATUSTEXT_CHUNK_SIZE chars; the final chunk is the
    // remainder (length < CHUNK_SIZE). When we see a short chunk, flush
    // immediately — the message is complete.
    if (message.text.length < STATUSTEXT_CHUNK_SIZE) {
      this.flushStatusTextChunkBuffer(message.statusId)
    }
  }

  /**
   * Emit a fully-formed STATUSTEXT entry to the status feed +
   * downstream consumers (pre-arm issue tracker, guided-action service,
   * boot-banner PWM-count parser). Shared between the legacy single-
   * frame path and the chunk-reassembly flush path so neither path
   * silently drops a downstream hook.
   */
  private emitStatusText(severityCode: number, text: string): void {
    const severity = severityName(severityCode)
    const now = Date.now()
    // A still-failing pre-arm check is re-reported on every refresh round, and
    // once we drive those rounds ourselves that is every few seconds. Repeating
    // an unchanged reason down the notice feed would bury everything else in
    // it, so refresh the existing entry in place instead. Only pre-arm text is
    // collapsed this way: a repeated STATUSTEXT of any other kind is usually the
    // vehicle telling us something happened again, which is worth a new line.
    // Replaced, not mutated in place: snapshots share these entry objects by
    // reference (`statusTexts: [...this.statusTexts]`), so editing one would
    // rewrite history in every snapshot already handed out.
    const existingPreArmIndex = normalizePreArmIssueText(text)
      ? this.statusTexts.findIndex((entry) => entry.text === text)
      : -1
    if (existingPreArmIndex >= 0) {
      // Removed and re-unshifted rather than replaced in place. Replacing in
      // place kept the list stable but broke its ordering invariant: the array
      // is consumed as newest-first (waitForCommandAck slices the head for its
      // "recent messages" diagnostic), and a refreshed entry left at index 40
      // with a just-now stamp makes that slice arbitrary.
      this.statusTexts.splice(existingPreArmIndex, 1)
      this.statusTexts.unshift({ severity, text, receivedAtMs: now })
    } else {
      this.statusTexts.unshift({
        severity,
        text,
        receivedAtMs: now
      })
      this.statusTexts.splice(STATUS_TEXT_HISTORY_LIMIT)
    }
    // Resolve any one-shot substring waiters (e.g. the passthru-enabled gate).
    if (this.statusTextWaiters.length > 0) {
      const remaining: typeof this.statusTextWaiters = []
      for (const waiter of this.statusTextWaiters) {
        if (text.includes(waiter.substring)) {
          waiter.resolve()
        } else {
          remaining.push(waiter)
        }
      }
      this.statusTextWaiters.length = 0
      this.statusTextWaiters.push(...remaining)
    }
    this.recordPreArmIssue(text, severity)
    this.guidedActionService.processStatusText(text)
    // Capture the physical PWM output count from the boot banner. Only the
    // banner reports this — there's no equivalent MAVLink param.
    const pwmCount = parsePwmOutputCountFromBanner(text)
    if (pwmCount !== undefined) {
      this.pwmOutputCount = pwmCount
    }
  }

  /**
   * Flush a single chunk buffer by statusId — concatenate
   * chunks in sequence order and emit the result as one STATUSTEXT
   * entry. The buffer is dropped after flushing regardless of whether
   * end-of-message was detected (called from both end-of-message and
   * stale-timeout paths).
   */
  private flushStatusTextChunkBuffer(statusId: number): void {
    const buffer = this.statusTextChunkBuffers.get(statusId)
    if (!buffer) return
    this.statusTextChunkBuffers.delete(statusId)
    const seqs = Array.from(buffer.chunks.keys()).sort((a, b) => a - b)
    const text = seqs.map((seq) => buffer.chunks.get(seq) ?? '').join('')
    if (text.length === 0) return
    this.emitStatusText(buffer.severity, text)
  }

  /**
   * Drop in-flight chunk buffers that haven't seen a new chunk
   * in STATUSTEXT_CHUNK_TIMEOUT_MS — flushed as-is so the partial content
   * surfaces in the status feed instead of being silently held. Called
   * on every STATUSTEXT arrival so the check is amortised; no separate
   * timer needed (a quiet link will naturally not accumulate stale
   * buffers because there's no flow to time-out against).
   */
  private flushStaleStatusTextChunks(nowMs: number): void {
    const stale: number[] = []
    for (const [id, buffer] of this.statusTextChunkBuffers) {
      if (nowMs - buffer.startedAtMs > STATUSTEXT_CHUNK_TIMEOUT_MS) {
        stale.push(id)
      }
    }
    for (const id of stale) {
      this.flushStatusTextChunkBuffer(id)
    }
  }

  private processRcChannels(message: RcChannelsMessage): void {
    const validChannels = message.channels.filter((value, index) => index < message.channelCount && isPwmChannelValue(value))
    this.liveVerification.rcInput = {
      verified: message.channelCount > 0 && validChannels.length > 0,
      channelCount: message.channelCount,
      channels: message.channels.slice(0, Math.max(message.channelCount, 8)),
      rssi: message.rssi === 255 ? undefined : message.rssi,
      lastSeenAtMs: Date.now()
    }
    this.liveVerification.satisfiedSignals = recomputeSatisfiedSignals(this.liveVerification)
  }

  private processGpsRawInt(message: GpsRawIntMessage): void {
    // Arrival alone is the "a module is talking" signal — fix type and sat
    // count then say how well. A miswired GPS produces none of these.
    this.liveVerification.gpsReceiver = {
      detected: true,
      fixType: message.fixType,
      satellitesVisible: message.satellitesVisible,
      lastSeenAtMs: Date.now()
    }
  }

  private processAttitude(message: AttitudeMessage): void {
    // Merge so the quaternion from ATTITUDE_QUATERNION (a separate message)
    // isn't wiped when Euler attitude updates.
    this.liveVerification.attitudeTelemetry = {
      ...this.liveVerification.attitudeTelemetry,
      verified: true,
      rollDeg: radiansToDegrees(message.rollRad),
      pitchDeg: radiansToDegrees(message.pitchRad),
      yawDeg: radiansToDegrees(message.yawRad),
      lastSeenAtMs: Date.now()
    }
    // Feeds the accelerometer calibration's auto-confirm: once the frame holds
    // the requested posture it records it without waiting for a click.
    this.guidedActionService.handleAttitudeSample(
      this.liveVerification.attitudeTelemetry.rollDeg,
      this.liveVerification.attitudeTelemetry.pitchDeg
    )
  }

  private processAttitudeQuaternion(message: AttitudeQuaternionMessage): void {
    this.liveVerification.attitudeTelemetry = {
      ...this.liveVerification.attitudeTelemetry,
      verified: true,
      quaternion: { w: message.qw, x: message.qx, y: message.qy, z: message.qz },
      lastSeenAtMs: Date.now()
    }
  }

  private processScaledImu(message: ScaledImuMessage): void {
    // IMU temperature (°C) for the thermal-calibration readout. 0 = not
    // reported by this IMU; keep the last good reading rather than flicker.
    if (message.temperatureCdeg !== 0) {
      this.liveVerification.imuTemperatureC = message.temperatureCdeg / 100
    }
  }

  private processGlobalPosition(message: GlobalPositionIntMessage): void {
    const hasValidCoordinates = isValidGlobalCoordinates(message.latitudeE7, message.longitudeE7)
    const horizontalSpeedCms = Math.hypot(message.velocityXcms, message.velocityYcms)

    this.liveVerification.globalPosition = {
      verified: hasValidCoordinates,
      latitudeDeg: hasValidCoordinates ? Number((message.latitudeE7 / 1e7).toFixed(7)) : undefined,
      longitudeDeg: hasValidCoordinates ? Number((message.longitudeE7 / 1e7).toFixed(7)) : undefined,
      altitudeM: hasValidCoordinates ? Number((message.altitudeMm / 1000).toFixed(1)) : undefined,
      relativeAltitudeM: hasValidCoordinates ? Number((message.relativeAltitudeMm / 1000).toFixed(1)) : undefined,
      groundSpeedMs: hasValidCoordinates ? Number((horizontalSpeedCms / 100).toFixed(1)) : undefined,
      headingDeg:
        hasValidCoordinates && message.headingCdeg !== 0xffff ? Number((message.headingCdeg / 100).toFixed(1)) : undefined,
      lastSeenAtMs: Date.now()
    }
  }

  // DroneCAN peripherals appear as sibling MAVLink components
  // (component_id == UAVCAN node_id) advertised by the MAVLink-UAVCAN bridge.
  // Surfaces identity and liveness only.
  private processUavcanNodeStatus(message: UavcanNodeStatusMessage, componentId: number): void {
    const now = Date.now()
    const existing = this.canNodes.get(componentId)
    this.canNodes.set(componentId, {
      componentId,
      name: existing?.name,
      health: canNodeHealthFromCode(message.health),
      mode: canNodeModeFromCode(message.mode),
      uptimeSec: message.uptimeSec,
      vendorStatusCode: message.vendorSpecificStatusCode,
      hwUniqueId: existing?.hwUniqueId,
      hwVersion: existing?.hwVersion,
      swVersion: existing?.swVersion,
      lastSeenSource: 'uavcan-node-status',
      firstSeenAtMs: existing?.firstSeenAtMs ?? now,
      lastSeenAtMs: now
    })
    this.ensureCanNodeStaleSweep()
    void this.maybeRequestCanNodeInfo()
  }

  // If any discovered DroneCAN node still lacks identity (UAVCAN_NODE_INFO
  // never arrived, or arrived before we were listening), nudge the bridge
  // to re-broadcast it. Debounced so a long-running session doesn't spam
  // MAV_CMD_UAVCAN_GET_NODE_INFO every time a fresh NODE_STATUS lands.
  private async maybeRequestCanNodeInfo(): Promise<void> {
    if (!this.vehicle) {
      return
    }
    const now = Date.now()
    if (
      this.canNodeInfoLastRequestedAtMs !== undefined &&
      now - this.canNodeInfoLastRequestedAtMs < CAN_NODE_INFO_REFRESH_DEBOUNCE_MS
    ) {
      return
    }
    const someNodeNeedsInfo = Array.from(this.canNodes.values()).some((node) => node.name === undefined)
    if (!someNodeNeedsInfo) {
      return
    }
    this.canNodeInfoLastRequestedAtMs = now
    try {
      // The bridge broadcasts UAVCAN_NODE_INFO for every online node in
      // response to one command. We don't await the ack — failures here are
      // transient and the next NODE_STATUS arrival will retry on its own.
      await this.sendCommand(MAV_CMD.UAVCAN_GET_NODE_INFO, [0, 0, 0, 0, 0, 0, 0], { waitForAck: false })
    } catch {
      // Best-effort refresh; swallow to avoid noisy STATUSTEXT spam.
    }
  }

  /**
   * Start the pre-arm refresh poll once a vehicle is talking to us.
   *
   * Called from the 1 Hz heartbeat path rather than at connect so it survives a
   * reboot: the timer is torn down on disconnect and re-armed by the first
   * heartbeat of the next session.
   */
  private ensurePreArmRefresh(): void {
    if (this.preArmRefreshTimer !== undefined || !this.preArmRefreshSupported) {
      return
    }
    this.preArmRefreshTimer = setInterval(() => void this.refreshPreArmChecks(), this.preArmRefreshIntervalMs)
    // Ask immediately too, so the first verdict does not wait out a full poll
    // interval on top of the connect handshake.
    void this.refreshPreArmChecks()
  }

  private clearPreArmRefresh(): void {
    if (this.preArmRefreshTimer !== undefined) {
      clearInterval(this.preArmRefreshTimer)
      this.preArmRefreshTimer = undefined
    }
    this.setPreArmRefreshActive(false)
  }

  /**
   * One MAV_CMD_RUN_PREARM_CHECKS round.
   *
   * Deliberately silent: this is background housekeeping the operator did not
   * ask for, so no failure here reaches the status feed. The only lasting
   * consequence of a bad answer is that we stop claiming the fast TTL, which
   * makes the box fall back to its slower-but-honest latched behaviour.
   */
  private async refreshPreArmChecks(): Promise<void> {
    if (this.preArmRefreshInFlight || !this.preArmRefreshSupported) {
      return
    }
    // Rejected outright while armed (and the reasons are moot then anyway).
    if (!this.vehicle || this.vehicle.armed) {
      this.setPreArmRefreshActive(false)
      return
    }

    this.preArmRefreshInFlight = true
    try {
      const ack = await this.sendCommand(MAV_CMD.RUN_PREARM_CHECKS, [0, 0, 0, 0, 0, 0, 0], {
        waitForAck: true,
        ackTimeoutMs: this.preArmRefreshIntervalMs,
        // A non-ACCEPTED result is information here, not an error to throw on.
        rejectAckOnFailure: false
      })
      const result = ack && 'result' in ack ? ack.result : undefined
      if (result === MAV_RESULT.UNSUPPORTED) {
        // No AP_ARMING_ENABLED (or a non-ArduPilot autopilot). Asking again every
        // 3 s for the rest of the session would be pure noise.
        this.preArmRefreshSupported = false
        this.clearPreArmRefresh()
        return
      }
      this.setPreArmRefreshActive(result === MAV_RESULT.ACCEPTED)
    } catch {
      // Timeout or send failure — keep polling (the link may just be busy) but
      // stop trusting the short TTL until a round lands again.
      this.setPreArmRefreshActive(false)
    } finally {
      this.preArmRefreshInFlight = false
    }
  }

  /**
   * Flipping this changes every already-recorded reason's expiry, so the pending
   * timer — computed against the previous TTL — has to be recomputed with it.
   */
  private setPreArmRefreshActive(active: boolean): void {
    if (this.preArmRefreshActive === active) {
      return
    }
    this.preArmRefreshActive = active
    if (this.preArmIssues.size > 0) {
      this.schedulePreArmExpiry()
    }
  }

  /**
   * How long a reported reason stays on screen. Short while our own poll is
   * refreshing the list every few seconds, long otherwise — see
   * PRE_ARM_ISSUE_TTL_MS.
   */
  private preArmIssueTtlMs(): number {
    if (!this.preArmRefreshActive) {
      return PRE_ARM_ISSUE_TTL_MS
    }
    // The short TTL rests on "a still-failing check is re-reported every round,
    // so absent means cleared". That holds only while the reports can actually
    // get through: ArduPilot's STATUSTEXT queue is bounded and purges anything
    // it could not send within 5s, so a MAVFTP transfer saturating the downlink
    // (a log download — our own feature) silently starves the very messages
    // this TTL reads as evidence. Fall back to the slow TTL rather than delete
    // a reason the vehicle is still reporting.
    if (this.mavftp.isTransferInFlight()) {
      return PRE_ARM_ISSUE_TTL_MS
    }
    return this.preArmIssueTtlPolledMs
  }

  private ensureCanNodeStaleSweep(): void {
    if (this.canNodeStaleSweepTimer !== undefined) {
      return
    }
    this.canNodeStaleSweepTimer = setInterval(() => this.sweepStaleCanNodes(), CAN_NODE_STALE_SWEEP_INTERVAL_MS)
  }

  private clearCanNodeStaleSweep(): void {
    if (this.canNodeStaleSweepTimer !== undefined) {
      clearInterval(this.canNodeStaleSweepTimer)
      this.canNodeStaleSweepTimer = undefined
    }
  }

  private sweepStaleCanNodes(): void {
    if (this.canNodes.size === 0) {
      this.clearCanNodeStaleSweep()
      return
    }
    const now = Date.now()
    let mutated = false
    for (const [componentId, node] of this.canNodes) {
      const age = now - node.lastSeenAtMs
      if (age >= CAN_NODE_REMOVE_AFTER_MS) {
        this.canNodes.delete(componentId)
        mutated = true
        continue
      }
      if (age >= CAN_NODE_OFFLINE_AFTER_MS && node.mode !== 'offline') {
        this.canNodes.set(componentId, { ...node, mode: 'offline' })
        mutated = true
      }
    }
    if (this.canNodes.size === 0) {
      this.clearCanNodeStaleSweep()
    }
    if (mutated) {
      this.emit()
    }
  }

  private processUavcanNodeInfo(message: UavcanNodeInfoMessage, componentId: number): void {
    const now = Date.now()
    const existing = this.canNodes.get(componentId)
    const hwUniqueId = Array.from(message.hwUniqueId, (byte) => byte.toString(16).padStart(2, '0')).join('')
    this.canNodes.set(componentId, {
      componentId,
      // UAVCAN_NODE_INFO names can collide with autopilot-side identity
      // when truncated to 16 chars; keep the most-recent NODE_INFO name
      // as authoritative since the bridge re-emits it on discovery/reboot.
      name: message.name.length > 0 ? message.name : existing?.name,
      // Liveness (health, mode, uptime, vendor code) is authoritative from
      // NODE_STATUS, which streams continuously. NODE_INFO is an identity
      // snapshot at discovery/reboot, so its uptime is stale the moment the
      // next NODE_STATUS lands. Carry forward whatever NODE_STATUS most
      // recently set, falling back to the NODE_INFO uptime only when we
      // have never seen a NODE_STATUS for this node.
      health: existing?.health ?? 'unknown',
      mode: existing?.mode ?? 'unknown',
      uptimeSec: existing?.uptimeSec ?? message.uptimeSec,
      vendorStatusCode: existing?.vendorStatusCode,
      hwUniqueId,
      hwVersion: { major: message.hwVersionMajor, minor: message.hwVersionMinor },
      swVersion: { major: message.swVersionMajor, minor: message.swVersionMinor, vcsCommit: message.swVcsCommit },
      lastSeenSource: existing?.lastSeenSource ?? 'uavcan-node-status',
      firstSeenAtMs: existing?.firstSeenAtMs ?? now,
      lastSeenAtMs: now
    })
  }

  // OPTICAL_FLOW (msgid 100) is both the "pulse on the flow sensor" signal
  // and the sensor's actual reading. ArduPilot's send_opticalflow()
  // (GCS_Common.cpp) returns early unless `optflow->healthy()`, so receiving
  // this message at all already means the driver is enumerating and updating
  // the sensor; `quality` then says whether the image it sees is usable.
  // Those are different failures — a live message with quality 0 is a sensor
  // that is wired correctly and staring at a featureless surface — so both
  // are recorded and the UI reports them separately.
  //
  // Still no EKF-innovation processing; the UI computes its own freshness
  // window against lastSeenAtMs.
  private processOpticalFlow(message: OpticalFlowMessage): void {
    this.liveVerification.opticalFlow = {
      verified: true,
      lastSeenAtMs: Date.now(),
      sensorId: message.sensorId,
      quality: message.quality,
      flowRateX: message.flowRateX,
      flowRateY: message.flowRateY,
      // MAVLink reserves negative ground_distance for "unknown", and
      // ArduPilot substitutes 0 when AHRS has no HAGL estimate. Normalise
      // both to undefined so the UI never prints a fake altitude.
      groundDistanceM: message.groundDistance > 0 ? message.groundDistance : undefined
    }
  }

  // DISTANCE_SENSOR (msgid 132). ArduPilot multiplexes rangefinder instances
  // AND AP_Proximity sectors onto this message; proximity uses
  // PROXIMITY_SENSOR_ID_START (10, AP_Proximity.h) as its id base, so ids at
  // or above that are 360° avoidance sectors and must not be mistaken for the
  // downward rangefinder the Status card is about.
  //
  // Among genuine rangefinder instances we keep the LOWEST id. RNGFND1 is
  // instance 0 and is what a Copter build uses for terrain/altitude, so a
  // second forward-facing lidar on RNGFND2 cannot displace the reading the
  // operator is checking. Same-instance updates always win, so the value
  // stays live.
  private processDistanceSensor(message: DistanceSensorMessage): void {
    if (message.id >= PROXIMITY_SENSOR_ID_START) {
      return
    }
    const current = this.liveVerification.rangefinder
    if (current.sensorId !== undefined && message.id > current.sensorId) {
      return
    }
    this.liveVerification.rangefinder = {
      verified: true,
      lastSeenAtMs: Date.now(),
      sensorId: message.id,
      distanceM: message.currentDistanceCm / 100,
      minDistanceM: message.minDistanceCm / 100,
      maxDistanceM: message.maxDistanceCm / 100,
      orientation: message.orientation,
      sensorType: message.sensorType,
      signalQuality: message.signalQuality
    }
  }

  /**
   * ESC_TELEMETRY_1_TO_4 / _5_TO_8 / _9_TO_12.
   *
   * Merged per ESC rather than replaced per message: ArduPilot skips any group
   * of four whose entries are all stale (AP_ESC_Telem.cpp), so a quad reports
   * only the 1_TO_4 group and a wiped table would lose ESCs 5-8 on a machine
   * that has them. Each ESC carries its own lastSeenAtMs for the same reason —
   * one silent ESC inside a live group has to be distinguishable from a live one.
   *
   * Slots reporting a zero packet count are dropped: ArduPilot zero-fills the
   * unused tail of a partially-populated group (a hexacopter's ESCs 7-8 in the
   * 5_TO_8 message), and listing those as ESCs sitting at 0 RPM would invent
   * hardware that is not there.
   */
  private processEscTelemetry(message: EscTelemetryMessage): void {
    const now = Date.now()
    const current = this.liveVerification.escTelemetry
    const byNumber = new Map(current.escs.map((esc) => [esc.escNumber, esc]))

    message.rpm.forEach((rpm, slot) => {
      const count = message.count[slot] ?? 0
      const escNumber = message.groupStartIndex + slot + 1
      // An ESC that has never delivered a telemetry packet is padding, not a
      // reading — unless we already know it, in which case leave what we have.
      if (count === 0 && !byNumber.has(escNumber)) {
        return
      }
      byNumber.set(escNumber, {
        escNumber,
        lastSeenAtMs: now,
        rpm,
        voltageV: (message.voltageCv[slot] ?? 0) / 100,
        currentA: (message.currentCa[slot] ?? 0) / 100,
        consumedMah: message.totalCurrentMah[slot] ?? 0,
        temperatureC: message.temperatureC[slot] ?? 0,
        count
      })
    })

    this.liveVerification.escTelemetry = {
      everReported: true,
      lastSeenAtMs: now,
      escs: [...byNumber.values()].sort((left, right) => left.escNumber - right.escNumber)
    }
  }

  private processSysStatus(message: SysStatusMessage): void {
    // The SYS_STATUS sensor bitmask streams ~1 Hz independent of GPS/EKF, so
    // it reports sensor presence/health truthfully on a bench FC.
    // MAV_SYS_STATUS_SENSOR_ABSOLUTE_PRESSURE (barometer).
    const ABSOLUTE_PRESSURE = 0x8
    const baroPresent = (message.sensorsPresent & ABSOLUTE_PRESSURE) !== 0
    const baroHealthy = baroPresent && (message.sensorsHealth & ABSOLUTE_PRESSURE) !== 0
    this.liveVerification.baroSensor = {
      verified: baroPresent && baroHealthy,
      present: baroPresent,
      healthy: baroHealthy,
      lastSeenAtMs: Date.now()
    }

    // Gyro/accel from the same EKF-independent bitmask
    // (MAV_SYS_STATUS_SENSOR_3D_GYRO / _3D_ACCEL); attitude/AHRS telemetry
    // lags on a bench FC and would mis-show a healthy IMU as absent.
    const SENSOR_3D_GYRO = 0x1
    const SENSOR_3D_ACCEL = 0x2
    const now = Date.now()
    const gyroPresent = (message.sensorsPresent & SENSOR_3D_GYRO) !== 0
    const gyroHealthy = gyroPresent && (message.sensorsHealth & SENSOR_3D_GYRO) !== 0
    this.liveVerification.gyroSensor = {
      verified: gyroPresent && gyroHealthy,
      present: gyroPresent,
      healthy: gyroHealthy,
      lastSeenAtMs: now
    }
    const accelPresent = (message.sensorsPresent & SENSOR_3D_ACCEL) !== 0
    const accelHealthy = accelPresent && (message.sensorsHealth & SENSOR_3D_ACCEL) !== 0
    this.liveVerification.accelSensor = {
      verified: accelPresent && accelHealthy,
      present: accelPresent,
      healthy: accelHealthy,
      lastSeenAtMs: now
    }
    // 3D mag present/health, used ONLY to augment the Mag header chip
    // (active on param-enabled OR this). The compass-calibration / Setup
    // gating still keys on the param-derived enabled-compass count.
    const SENSOR_3D_MAG = 0x4
    const magPresent = (message.sensorsPresent & SENSOR_3D_MAG) !== 0
    const magHealthy = magPresent && (message.sensorsHealth & SENSOR_3D_MAG) !== 0
    this.liveVerification.magSensor = {
      verified: magPresent && magHealthy,
      present: magPresent,
      healthy: magHealthy,
      lastSeenAtMs: now
    }
    // GPS present/health from the same EKF-independent bitmask
    // (MAV_SYS_STATUS_SENSOR_GPS) — the truthful "GPS is configured" signal,
    // present even with no satellite fix indoors. present reads from
    // sensorsEnabled (driver bound) OR sensorsPresent.
    const SENSOR_GPS = 0x20
    const gpsBitPresent =
      (message.sensorsPresent & SENSOR_GPS) !== 0 || (message.sensorsEnabled & SENSOR_GPS) !== 0
    // Latch "present" for the session: the GPS bit can drop out transiently
    // (driver re-probe, blending, negotiating), so once any frame reports it
    // present, keep present=true until the session resets. `healthy` still
    // tracks the live fix bit each frame.
    const gpsPresent = gpsBitPresent || this.liveVerification.gpsSensor.present
    const gpsHealthy = gpsPresent && (message.sensorsHealth & SENSOR_GPS) !== 0
    this.liveVerification.gpsSensor = {
      verified: gpsPresent && gpsHealthy,
      present: gpsPresent,
      healthy: gpsHealthy,
      lastSeenAtMs: now
    }

    const previousBattery = this.liveVerification.batteryTelemetry
    const voltageMv = message.voltageBatteryMv
    const batteryVerified = voltageMv !== 0xffff && voltageMv > 1000
    const freshCurrentA =
      batteryVerified && message.currentBatteryCa !== -1 ? Number((message.currentBatteryCa / 100).toFixed(2)) : undefined
    this.liveVerification.batteryTelemetry = {
      verified: batteryVerified,
      voltageMv: batteryVerified ? voltageMv : undefined,
      voltageV: batteryVerified ? Number((voltageMv / 1000).toFixed(2)) : undefined,
      // Carry the last known current across a SYS_STATUS that omits it
      // (currentBatteryCa === -1) while the battery is still verified — otherwise
      // the reading flickers to "no telemetry" on a transient gap. A genuine
      // loss of battery telemetry (unverified) still clears it.
      currentA: freshCurrentA ?? (batteryVerified ? previousBattery.currentA : undefined),
      remainingPercent:
        batteryVerified && message.batteryRemaining >= 0 && message.batteryRemaining <= 100 ? message.batteryRemaining : undefined,
      lastSeenAtMs: Date.now()
    }
    this.liveVerification.satisfiedSignals = recomputeSatisfiedSignals(this.liveVerification)
    this.processSysStatusPreArmCheck(message, now)
  }

  /**
   * Fold the live pre-arm verdict out of SYS_STATUS.
   *
   * The bitwise-AND uses >>> 0 comparisons because 0x10000000 is safely inside
   * int32 but the neighbouring bits are not — reading the raw field as a signed
   * number is fine here, the mask is positive either way.
   */
  private processSysStatusPreArmCheck(message: SysStatusMessage, nowMs: number): void {
    const present = (message.sensorsPresent & MAV_SYS_STATUS_PREARM_CHECK) !== 0
    const enabled = (message.sensorsEnabled & MAV_SYS_STATUS_PREARM_CHECK) !== 0
    const passing = (message.sensorsHealth & MAV_SYS_STATUS_PREARM_CHECK) !== 0
    this.preArmLiveCheck = { present, enabled, passing, lastSeenAtMs: nowMs }

    // A usable "passing" verdict is positive proof that every latched reason is
    // stale: the FC re-ran the whole check set within the last second and it
    // came back clean. Drop them rather than leaving contradictory text under a
    // green badge — this is also what makes the arm-failure hint below stop
    // naming blockers that no longer exist.
    if (present && enabled && passing && this.preArmIssues.size > 0) {
      this.preArmIssues.clear()
      this.clearPreArmExpiryTimer()
    }
  }

  private processCommandAck(message: CommandAckMessage, systemId: number, componentId: number): void {
    // Command-protocol conformance: an ACK is only valid from the system/
    // component the command was addressed to — the connected vehicle. With
    // MAVLink routing in play (companion computers, gimbals, onboard GCS
    // bridges) other endpoints can emit COMMAND_ACKs for the same command
    // id; matching on command alone would let those settle the waiters and
    // desync the SET_MESSAGE_INTERVAL label queue. Foreign ACKs are still
    // recorded (with their source) so the timeout diagnostic can name
    // them, but they never resolve waiters or dequeue stream labels.
    const foreign =
      this.vehicle !== undefined &&
      (systemId !== this.vehicle.systemId || componentId !== this.vehicle.componentId)
    // The pre-arm refresh poll is excluded. It acks every 3s, and this log is
    // a 20-entry ring quoted 5-at-a-time in command-timeout errors — letting it
    // in would flush the log every minute and leave every timeout diagnostic
    // reading "RUN_PREARM_CHECKS ACCEPTED" five times, which is exactly the
    // evidence the diagnostic exists to preserve.
    if (message.command !== MAV_CMD.RUN_PREARM_CHECKS) {
      this.commandAckLog.unshift({
        command: message.command,
        result: message.result,
        receivedAtMs: Date.now(),
        sourceSystemId: systemId,
        sourceComponentId: componentId,
        foreign
      })
      this.commandAckLog.splice(ArduPilotConfiguratorRuntime.COMMAND_ACK_LOG_LIMIT)
    }
    if (foreign) {
      return
    }
    this.resolveCommandAckWaiters(message)

    if (message.command !== MAV_CMD.SET_MESSAGE_INTERVAL) {
      return
    }

    // Dequeue regardless of outcome so the next ACK lines up with the
    // next pending request label. (Acks arrive in send order.)
    const label = this.pendingSetMessageIntervalLabels.shift()

    if (message.result === MAV_RESULT.ACCEPTED || message.result === MAV_RESULT.IN_PROGRESS) {
      return
    }

    const resultLabel = mavResultLabel(message.result)
    const streamLabel = label ?? 'live telemetry stream'

    // The MAVLink-UAVCAN bridge often denies SET_MESSAGE_INTERVAL for
    // UAVCAN_NODE_STATUS; the UAVCAN_GET_NODE_INFO broadcast already covers
    // node identity, so a DENIED here is expected and benign, not a warning.
    if (label === 'UAVCAN_NODE_STATUS') {
      this.appendStatusEntry(
        'info',
        `Autopilot declined the UAVCAN_NODE_STATUS stream (${resultLabel}). Falling back to a one-shot UAVCAN_GET_NODE_INFO broadcast for DroneCAN node identity.`
      )
      return
    }

    this.appendStatusEntry('warning', `Autopilot rejected the ${streamLabel} stream request (${resultLabel}).`)
  }

  private processCommandLong(message: CommandLongMessage, systemId: number, componentId: number): void {
    this.guidedActionService.handleCommandLong(message, systemId, componentId)
  }

  private buildSetupSections(): SetupSectionState[] {
    return this.metadata.setupSections.map((definition) => {
      const sectionParameters = definition.requiredParameters
        .map((parameterId: string) => this.parameters.get(parameterId))
        .filter((parameter): parameter is ParameterState => parameter !== undefined)

      const missingParameters = definition.requiredParameters.filter(
        (parameterId: string) => !this.parameters.has(parameterId)
      )
      // A param can be present with an "unset" value (commonly 0 for
      // enum-style params like FRAME_CLASS); requiredNonZeroParameters must
      // be non-zero, not merely present, to count a section complete.
      const unsetRequiredParameters = (definition.requiredNonZeroParameters ?? []).filter((parameterId: string) => {
        const param = this.parameters.get(parameterId)
        if (!param) return true
        const value = param.value
        if (typeof value !== 'number' || !Number.isFinite(value)) return true
        return value === 0
      })
      // requiredAnyNonZeroParameters is an OR-of-non-zero — captures the
      // "at least one of these is configured" semantic (e.g. Outputs is not
      // complete while every SERVOn_FUNCTION is still 0). The whole group
      // fails when no listed param has a non-zero finite value.
      const anyNonZeroGroup = definition.requiredAnyNonZeroParameters ?? []
      const anyNonZeroSatisfied = anyNonZeroGroup.length === 0 || anyNonZeroGroup.some((parameterId: string) => {
        const param = this.parameters.get(parameterId)
        if (!param) return false
        const value = param.value
        return typeof value === 'number' && Number.isFinite(value) && value !== 0
      })
      const completionTexts = definition.completionStatusTexts ?? []
      // A previously-calibrated FC won't re-emit the cal-success banner on
      // reconnect, but the cal-output params it persists (AHRS_TRIM_*,
      // INS_ACCOFFS_*, COMPASS_OFS_*) prove the cal happened — a non-zero one
      // satisfies the completion-text gate.
      const hasPriorCompletionEvidence =
        (definition.completionEvidenceNonZeroParameters ?? []).some((parameterId) => {
          const param = this.parameters.get(parameterId)
          if (!param) return false
          const value = param.value
          return typeof value === 'number' && Number.isFinite(value) && value !== 0
        })
      const missingCompletionTexts = hasPriorCompletionEvidence
        ? []
        : completionTexts.filter(
            (text: string) => !this.statusTexts.some((entry) => entry.text.includes(text))
          )
      const missingLiveSignals = (definition.requiredLiveSignals ?? []).filter(
        (signalId: LiveSignalId) => !this.liveVerification.satisfiedSignals.includes(signalId)
      )

      const hasAnyProgress =
        sectionParameters.length > 0 ||
        missingLiveSignals.length < (definition.requiredLiveSignals?.length ?? 0) ||
        completionTexts.some((text: string) => this.statusTexts.some((entry) => entry.text.includes(text)))

      const status: SetupStatus =
        missingParameters.length === 0 &&
        unsetRequiredParameters.length === 0 &&
        anyNonZeroSatisfied &&
        missingCompletionTexts.length === 0 &&
        missingLiveSignals.length === 0
          ? 'complete'
          : hasAnyProgress
            ? 'in-progress'
            : 'attention'

      const notes = [
        ...missingParameters.map((parameterId: string) => `Missing parameter: ${parameterId}`),
        ...unsetRequiredParameters.map((parameterId: string) => `Parameter unset (value 0): ${parameterId}`),
        ...(anyNonZeroSatisfied ? [] : [`At least one of ${anyNonZeroGroup.join(' / ')} must be assigned`]),
        ...missingCompletionTexts.map((text: string) => `Pending confirmation: ${text}`),
        ...missingLiveSignals.map((signalId: LiveSignalId) => `Pending live verification: ${liveSignalLabel(signalId)}`)
      ]

      return {
        id: definition.id,
        title: definition.title,
        description: definition.description,
        status,
        notes,
        actions: definition.actions ?? [],
        definition,
        parameters: sectionParameters
      }
    })
  }

  private emit(): void {
    // Browser: coalesce a burst of inbound frames into one notify per
    // animation frame (the snapshot reflects the latest state at flush time).
    // Node / tests have no requestAnimationFrame, so emit synchronously there.
    if (typeof requestAnimationFrame !== 'function') {
      this.flushEmit()
      return
    }
    if (this.emitHandle !== undefined || this.emitTimer !== undefined) {
      return
    }
    const run = () => {
      this.cancelScheduledEmit()
      this.flushEmit()
    }
    // Coalesce to the timer interval only (skip per-frame rAF) during a batch
    // write OR the initial parameter sync. Both are a fast inbound PARAM_VALUE
    // burst, and the full-snapshot rebuild + app re-render is expensive: doing it
    // ~4x/s instead of ~60x/s frees the main thread to process the readbacks at
    // link speed. Rendering per frame during the sync otherwise starves the Web
    // Serial read loop, drops PARAM_VALUE packets, and stalls the stream —
    // triggering repeated gap-fill retries ("parameter stream keeps stalling").
    const syncingParameters =
      this.parameterSync.status === 'requesting' || this.parameterSync.status === 'streaming'
    if (this.batchEmitMode || syncingParameters) {
      this.emitTimer = setTimeout(run, EMIT_COALESCE_MAX_MS)
      return
    }
    this.emitHandle = requestAnimationFrame(run)
    // rAF is suspended entirely in a hidden tab; the timer still fires
    // (throttled) so a coalesced terminal snapshot can't be stranded.
    this.emitTimer = setTimeout(run, EMIT_COALESCE_MAX_MS)
  }

  private cancelScheduledEmit(): void {
    if (this.emitHandle !== undefined) {
      if (typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(this.emitHandle)
      }
      this.emitHandle = undefined
    }
    if (this.emitTimer !== undefined) {
      clearTimeout(this.emitTimer)
      this.emitTimer = undefined
    }
  }

  private flushEmit(): void {
    this.guidedActionService.reconcileCompassCalibrationAvailability()
    const snapshot = this.getSnapshot()
    // Isolate each listener so one throwing subscriber can't abort emit() and
    // starve the others.
    this.updateListeners.forEach((listener) => {
      try {
        listener(snapshot)
      } catch (error) {
        console.error('ArduPilot runtime: a snapshot listener threw; continuing', error)
      }
    })
  }

  /**
   * Identity the retained table is bound to. Includes the vehicle kind and
   * firmware alongside the MAVLink addresses so a resume can't graft one
   * board's parameters onto another that happens to share sys/comp ids.
   */
  private staleLinkKey(vehicle: VehicleIdentity): string {
    return `${vehicle.systemId}:${vehicle.componentId}:${vehicle.firmware}:${vehicle.vehicle}`
  }

  /**
   * Mark the parameters left on screen as belonging to a link that has gone
   * away. Called as live state is torn down, BEFORE `this.vehicle` is cleared.
   * Nothing to mark when the table is empty — there is no stale data to warn
   * about, and no partial download worth resuming.
   */
  private markStaleLink(): void {
    const vehicle = this.vehicle
    if (!vehicle || this.parameters.size === 0) {
      // Nothing new to record — and crucially, do NOT clear an existing marker.
      // resetLiveState() runs again on connect(), by which point the vehicle is
      // already gone; clearing here would destroy the marker moments before the
      // reconnect that needs it. Retained values are dropped explicitly, via
      // discardStaleLink().
      return
    }

    this.staleLink = {
      key: this.staleLinkKey(vehicle),
      sinceMs: Date.now(),
      vehicle,
      downloaded: this.realParameterIdsReceived.size,
      total: this.totalParameters
    }
  }

  /** Drop the retained table and the stale marker together. */
  private discardStaleLink(): void {
    this.staleLink = undefined
    this.parameters.clear()
    this.realParameterIdsReceived.clear()
    this.receivedParameterIndices.clear()
    this.totalParameters = 0
    this.parameterTableGrewDuringSync = false
  }

  /**
   * Whether the retained table may be resumed against the vehicle that just
   * identified itself: same board, still within the freshness window, and the
   * download was actually incomplete (a complete table is re-pulled normally).
   */
  private canResumeStaleLink(vehicle: VehicleIdentity): boolean {
    const stale = this.staleLink
    return (
      stale !== undefined &&
      stale.key === this.staleLinkKey(vehicle) &&
      stale.total > 0 &&
      stale.downloaded < stale.total &&
      Date.now() - stale.sinceMs <= PARAMETER_CARRY_OVER_TTL_MS
    )
  }

  private resetLiveState(): void {
    // Retain the parameter table (see `staleLink`) — it is the last data we
    // had, and blanking the app on every watchdog reset helps nobody. Live
    // telemetry, verification and guided actions are all cleared below: those
    // are moment-in-time signals, and a frozen attitude or RC reading shown as
    // if current would be genuinely misleading.
    this.markStaleLink()
    this.vehicle = undefined
    this.hardwareBoard = undefined
    this.uartsFile = createIdleUartsFileState()
    this.pwmOutputCount = undefined
    this.parameterSyncRetryCount = 0
    this.parameterSyncLastRetryDownloaded = 0
    this.parameterSyncGapFillActive = false
    this.parameterSyncResumedTotal = undefined
    this.parameterSync = createIdleParameterSync()
    this.guidedActionService.reset()
    this.motorTestService.reset()
    this.liveVerification = createIdleLiveVerification()
    this.liveTelemetryRequestsIssued = false
    this.pendingSetMessageIntervalLabels.length = 0
    this.autopilotVersionRequested = false
    this.uartsFileRequested = false
    this.preArmIssues.clear()
    // A reconnect/reboot is a definite event: the previous vehicle's verdict
    // must not survive into a session that has not reported one yet.
    this.preArmLiveCheck = undefined
    this.statusTexts.splice(0)
    // Drop any in-flight chunk buffers so a partial STATUSTEXT from this
    // session can't fuse with one from the next under a shared statusId.
    this.statusTextChunkBuffers.clear()
    this.canNodes.clear()
    this.canNodeInfoLastRequestedAtMs = undefined
    this.clearCanNodeStaleSweep()
    this.canBusService.reset()
    this.motorTestService.clearCompletionTimer()
    this.clearPreArmExpiryTimer()
    // Torn down rather than left running: the next heartbeat re-arms it, and a
    // poll aimed at a vehicle that is no longer there is only wasted uplink.
    // Support is re-probed rather than remembered: the next heartbeat may be a
    // different board, and one wasted command beats silently never asking.
    this.clearPreArmRefresh()
    this.preArmRefreshSupported = true
    this.clearParameterSyncRetryTimer()
  }

  private resolveVehicleWaiters(vehicle: VehicleIdentity): void {
    this.vehicleWaiters.forEach((waiter) => {
      clearTimeout(waiter.timer)
      waiter.resolve(vehicle)
    })
    this.vehicleWaiters.clear()
  }

  private rejectVehicleWaiters(error: Error): void {
    this.vehicleWaiters.forEach((waiter) => {
      clearTimeout(waiter.timer)
      waiter.reject(error)
    })
    this.vehicleWaiters.clear()
  }

  private waitForAutopilotVersion(timeoutMs = DEFAULT_AUTOPILOT_VERSION_TIMEOUT_MS): WaiterHandle<HardwareBoardState> {
    if (this.hardwareBoard) {
      return {
        promise: Promise.resolve(this.hardwareBoard),
        cancel: () => {}
      }
    }

    let cancel = (_error: Error) => {}
    const promise = new Promise<HardwareBoardState>((resolve, reject) => {
      let settled = false
      const waiter: AutopilotVersionWaiter = {
        resolve: (board) => {
          settled = true
          clearTimeout(timer)
          resolve(board)
        },
        reject: (error) => {
          settled = true
          clearTimeout(timer)
          reject(error)
        },
        timer: undefined as unknown as ReturnType<typeof setTimeout>
      }

      const timer = setTimeout(() => {
        settled = true
        this.autopilotVersionWaiters.delete(waiter)
        reject(new Error(`Timed out waiting for AUTOPILOT_VERSION after ${timeoutMs}ms.`))
      }, timeoutMs)

      waiter.timer = timer
      this.autopilotVersionWaiters.add(waiter)

      cancel = (error: Error) => {
        if (settled) {
          return
        }

        settled = true
        clearTimeout(timer)
        this.autopilotVersionWaiters.delete(waiter)
        reject(error)
      }
    })

    return {
      promise,
      cancel
    }
  }

  private resolveAutopilotVersionWaiters(board: HardwareBoardState): void {
    this.autopilotVersionWaiters.forEach((waiter) => {
      clearTimeout(waiter.timer)
      waiter.resolve(board)
    })
    this.autopilotVersionWaiters.clear()
  }

  private rejectAutopilotVersionWaiters(error: Error): void {
    this.autopilotVersionWaiters.forEach((waiter) => {
      clearTimeout(waiter.timer)
      waiter.reject(error)
    })
    this.autopilotVersionWaiters.clear()
  }

  private async requestParameterTable(systemId: number, componentId: number): Promise<void> {
    await this.session.send({
      type: 'PARAM_REQUEST_LIST',
      targetSystem: systemId,
      targetComponent: componentId
    })
    this.scheduleParameterSyncRetry()
  }

  private scheduleParameterSyncRetry(): void {
    this.clearParameterSyncRetryTimer()

    if (this.parameterSync.status !== 'requesting' && this.parameterSync.status !== 'streaming') {
      return
    }

    this.parameterSyncRetryTimer = setTimeout(() => {
      void this.retryParameterSync()
    }, this.parameterSyncStallRetryDelayMs())
  }

  /**
   * Stall interval for the next pass. Stays at the base rate while passes are
   * still recovering parameters, then backs off exponentially once several
   * consecutive passes have found nothing — the signature of a board that is
   * down (rebooting) rather than a link merely dropping frames. Retries never
   * stop while the sync is live: the board may come back at any moment, and it
   * is the operator who decides to give up, not the runtime.
   */
  private parameterSyncStallRetryDelayMs(): number {
    const overBudget = this.parameterSyncRetryCount - PARAMETER_SYNC_BACKOFF_AFTER_PASSES
    if (overBudget <= 0) {
      return this.parameterSyncStallRetryMs
    }
    const backedOff = this.parameterSyncStallRetryMs * 2 ** Math.min(overBudget, 8)
    // Honour a test-injected fast timer: never back off past the module ceiling,
    // and never below the caller's base interval.
    return Math.max(this.parameterSyncStallRetryMs, Math.min(backedOff, MAX_PARAMETER_SYNC_STALL_RETRY_MS))
  }

  private clearParameterSyncRetryTimer(): void {
    if (!this.parameterSyncRetryTimer) {
      return
    }

    clearTimeout(this.parameterSyncRetryTimer)
    this.parameterSyncRetryTimer = undefined
  }

  private async retryParameterSync(): Promise<void> {
    this.parameterSyncRetryTimer = undefined

    // Use the alias-free count throughout (matches the completion gate and the
    // downloaded count getSnapshot() exposes).
    const downloaded = this.realParameterIdsReceived.size
    // A pass that recovered parameters resets the streak, which drops the
    // interval back to the base rate. Only CONSECUTIVE no-progress passes back
    // it off — a working link with a large gap must converge at full speed.
    const madeProgressSinceLastRetry = downloaded > this.parameterSyncLastRetryDownloaded
    if (madeProgressSinceLastRetry) {
      this.parameterSyncRetryCount = 0
    }
    this.parameterSyncLastRetryDownloaded = downloaded

    if (
      !this.vehicle ||
      (this.parameterSync.status !== 'requesting' && this.parameterSync.status !== 'streaming') ||
      // Gate on realParameterIdsReceived.size, NOT parameters.size (which
      // counts alias mirrors), against the alias-free FC-reported total — same
      // source the completion gate uses.
      (downloaded >= this.totalParameters && this.totalParameters > 0)
    ) {
      return
    }

    this.parameterSyncRetryCount += 1
    const total = this.totalParameters
    // Prefer targeting the exact indices the stream dropped. A full
    // PARAM_REQUEST_LIST re-stream re-runs the same fast burst that lost the
    // frames in the first place (and can re-drop them under a lossy transport);
    // PARAM_REQUEST_READ-by-index refetches only the gaps. Fall back to a full
    // re-stream when nothing has arrived yet (no indices to target), the FC has
    // not reported a count, OR the previous gap-fill pass recovered nothing —
    // the last case guards an FC that isn't honoring by-index reads (or is
    // dropping the by-index responses too), restoring the pre-gap-fill recovery.
    const missingIndices = this.missingParameterIndices()
    const gapFillStalled = this.parameterSyncGapFillActive && !madeProgressSinceLastRetry
    // Gap-fill is right for a HANDFUL of dropped frames and badly wrong for a
    // table that never arrived. Measured on a real board: a bulk stream lands
    // 146 params/s, while by-index refetch of a near-empty table crawls at 11 —
    // it asks for up to MAX_PARAMETER_GAP_FILL_PER_PASS by index and gets a few
    // dozen answers back, then waits out the stall timer and asks again. A
    // reconnect made while the FC is still booting drops into exactly that
    // state and took 96 s where a cold sync took 8 s.
    //
    // So a large gap re-streams instead. The threshold is deliberately
    // generous toward re-streaming: the cost of a needless re-stream is one
    // fast bulk transfer, and the cost of gap-filling a mostly-missing table is
    // minutes.
    // The FRACTION rule is gated on an absolute count as well: two dropped
    // frames out of a six-parameter table is 33% and is precisely the case
    // gap-fill exists for. Only a table that is substantially absent — many
    // parameters AND most of them — is better served by re-streaming.
    const gapTooLargeToFill =
      this.parameterTableGrewDuringSync ||
      missingIndices.length > MAX_PARAMETER_GAP_FILL_PER_PASS ||
      (total > 0 &&
        missingIndices.length >= MIN_MISSING_FOR_FRACTION_RESTREAM &&
        missingIndices.length / total > PARAMETER_GAP_FILL_MAX_FRACTION)
    const canGapFill =
      total > 0 && downloaded > 0 && missingIndices.length > 0 && !gapFillStalled && !gapTooLargeToFill
    this.parameterSyncGapFillActive = canGapFill

    // Retries are unbounded, so every pass must NOT write a notice — a board
    // that stays down would bury the log. Report the first few passes, then
    // only every fifth, which is enough to show the retry is still alive.
    if (this.parameterSyncRetryCount <= PARAMETER_SYNC_BACKOFF_AFTER_PASSES || this.parameterSyncRetryCount % 5 === 0) {
      this.appendStatusEntry(
        'warning',
        canGapFill
          ? `Parameter stream stalled at ${downloaded}/${total}. Refetching ${missingIndices.length} missing parameter(s) by index (attempt ${this.parameterSyncRetryCount}).`
          : `Parameter stream stalled at ${downloaded}/${total || 'unknown'}. Re-requesting the table (attempt ${this.parameterSyncRetryCount}).`
      )
    }
    this.setGuidedAction('request-parameters', {
      ...this.guidedActionService.getAction('request-parameters'),
      status: 'running',
      summary: canGapFill
        ? `Parameter stream stalled at ${downloaded}/${total}. Refetching ${missingIndices.length} missing parameter(s).`
        : `Parameter stream stalled at ${downloaded}/${total || 'unknown'}. Re-requesting the full parameter table.`,
      instructions: [
        'Keep the link open while the configurator retries the parameter stream.',
        'If the board is resetting, leave this running (or reconnect) — the download resumes where it left off instead of restarting.'
      ],
      updatedAtMs: Date.now(),
      completedAtMs: undefined
    })
    this.emit()

    try {
      if (canGapFill) {
        await this.requestMissingParameters(missingIndices)
        // The refetch responses arrive as ordinary PARAM_VALUE frames and drive
        // completion. Re-arm the stall timer so a still-incomplete set gets
        // another gap-fill pass (or a full re-stream once nothing is arriving).
        this.scheduleParameterSyncRetry()
      } else {
        await this.requestParameterTable(this.vehicle.systemId, this.vehicle.componentId)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown parameter retry error.'
      this.appendStatusEntry('warning', `Failed to retry the parameter stream: ${message}`)
      this.emit()
      this.scheduleParameterSyncRetry()
    }
  }

  // Indices the FC promised (0..total-1) that have not yet streamed. Used to
  // drive the by-index gap-fill on a stalled sync.
  private missingParameterIndices(): number[] {
    const total = this.totalParameters
    if (total <= 0) {
      return []
    }
    const missing: number[] = []
    for (let index = 0; index < total; index += 1) {
      if (!this.receivedParameterIndices.has(index)) {
        missing.push(index)
      }
    }
    return missing
  }

  // Refetch specific parameter slots by index with PARAM_REQUEST_READ. Bounded
  // per pass so a pathological gap can't emit thousands of frames at once; any
  // remainder is picked up by the next stall-retry pass.
  private async requestMissingParameters(indices: number[]): Promise<void> {
    if (!this.vehicle) {
      return
    }
    const batch = indices.slice(0, MAX_PARAMETER_GAP_FILL_PER_PASS)
    for (const index of batch) {
      await this.session.send({
        type: 'PARAM_REQUEST_READ',
        targetSystem: this.vehicle.systemId,
        targetComponent: this.vehicle.componentId,
        // Reading by index: leave the name empty and set the index directly.
        paramId: '',
        paramIndex: index
      })
    }
  }

  private rejectCommandAckWaiters(error: Error): void {
    this.commandAckWaiters.forEach((waiter) => {
      clearTimeout(waiter.timer)
      waiter.reject(error)
    })
    this.commandAckWaiters.clear()
  }

  private waitForCommandAck(
    command: number,
    timeoutMs = DEFAULT_COMMAND_ACK_TIMEOUT_MS,
    options: { rejectOnFailure?: boolean } = {}
  ): WaiterHandle<CommandAckMessage> {
    let cancel = (_error: Error) => {}
    const promise = new Promise<CommandAckMessage>((resolve, reject) => {
      let settled = false
      const waiter: CommandAckWaiter = {
        command,
        rejectOnFailure: options.rejectOnFailure ?? true,
        resolve: (message) => {
          settled = true
          clearTimeout(waiter.timer)
          resolve(message)
        },
        reject: (error) => {
          settled = true
          clearTimeout(waiter.timer)
          reject(error)
        },
        timer: undefined as unknown as ReturnType<typeof setTimeout>,
        noteInProgress: (message) => {
          waiter.lastInProgress = message
          clearTimeout(waiter.timer)
          waiter.timer = schedule()
        }
      }

      const onTimeout = () => {
        settled = true
        this.commandAckWaiters.delete(waiter)
        // IN_PROGRESS arrived but no final ACK did. IN_PROGRESS is an
        // acceptance, so resolve as started rather than failing — some
        // firmwares never send the final ACK for long-running ops. Callers
        // needing completion track it out-of-band.
        if (waiter.lastInProgress !== undefined) {
          resolve(waiter.lastInProgress)
          return
        }
        // Self-diagnostic: a timeout means either no ACK arrived at all or it
        // arrived but didn't match this waiter. Include the recent ACK log so
        // the operator (and any bug report) can see which one it was without
        // an instrumented rebuild.
        const now = Date.now()
        const recentAcks = this.commandAckLog
          .slice(0, 5)
          .map((entry) =>
            `${mavCommandLabel(entry.command)} result=${mavResultLabel(entry.result)}${
              entry.foreign ? ` from sys=${entry.sourceSystemId} comp=${entry.sourceComponentId} (ignored: not the vehicle)` : ''
            } ${(now - entry.receivedAtMs) / 1000}s ago`)
        const ackHint = recentAcks.length > 0
          ? ` Recent COMMAND_ACKs received: ${recentAcks.join('; ')}.`
          : ' No COMMAND_ACKs received during the wait.'
        const recentStatus = this.statusTexts
          .filter((entry) => entry.receivedAtMs !== undefined && now - entry.receivedAtMs <= timeoutMs)
          .slice(0, 3)
          .map((entry) => entry.text)
        const statusHint = recentStatus.length > 0
          ? ` Recent autopilot messages: ${recentStatus.join('; ')}.`
          : ''
        reject(new Error(
          `Timed out waiting for ${mavCommandLabel(command)} acknowledgment after ${timeoutMs}ms.${ackHint}${statusHint}`
        ))
      }
      const schedule = () => setTimeout(onTimeout, timeoutMs)

      waiter.timer = schedule()
      this.commandAckWaiters.add(waiter)

      cancel = (error: Error) => {
        if (settled) {
          return
        }

        settled = true
        clearTimeout(waiter.timer)
        this.commandAckWaiters.delete(waiter)
        reject(error)
      }
    })

    return {
      promise,
      cancel
    }
  }

  private resolveCommandAckWaiters(message: CommandAckMessage): void {
    const waiters = [...this.commandAckWaiters].filter((waiter) => waiter.command === message.command)
    if (waiters.length === 0) {
      return
    }

    // IN_PROGRESS is a progress beat, not a final result: it resets the
    // operation timeout and the outcome arrives in a later ACK. Keep the
    // waiters armed; the timeout path resolves with the remembered
    // IN_PROGRESS ack if no final ACK ever arrives.
    if (message.result === MAV_RESULT.IN_PROGRESS) {
      waiters.forEach((waiter) => waiter.noteInProgress(message))
      return
    }

    waiters.forEach((waiter) => {
      clearTimeout(waiter.timer)
      this.commandAckWaiters.delete(waiter)
      if (message.result === MAV_RESULT.ACCEPTED || !waiter.rejectOnFailure) {
        waiter.resolve(message)
        return
      }

      // Enrich a bare rejection with two diagnostics:
      //  1. STATUSTEXTs received within ~2s of this ACK often carry the
      //     firmware's actual failure reason — surface them verbatim.
      //  2. The recent pre-arm issues, which persist across commands and are
      //     a common reason calibration commands are refused.
      const baseMessage = `Autopilot rejected ${mavCommandLabel(message.command)} (${mavResultLabel(message.result)}).`
      const now = Date.now()
      const RECENT_STATUSTEXT_WINDOW_MS = 2000
      const recentReasonTexts = this.statusTexts
        .filter((entry) => entry.receivedAtMs !== undefined && now - entry.receivedAtMs <= RECENT_STATUSTEXT_WINDOW_MS)
        .filter((entry) => !/^prearm\b/i.test(entry.text.trim()))
        .slice(0, 2)
        .map((entry) => entry.text)
      const reasonHint = recentReasonTexts.length > 0
        ? ` Reason from autopilot: ${recentReasonTexts.join('; ')}.`
        : ''
      const recentPreArmIssues = [...this.preArmIssues.values()]
        .sort((left, right) => right.lastSeenAtMs - left.lastSeenAtMs)
        .slice(0, 3)
        .map((issue) => issue.text)
      const preArmHint = recentPreArmIssues.length > 0
        ? ` Active pre-arm issue(s) to clear first: ${recentPreArmIssues.join('; ')}.`
        : ''
      waiter.reject(new Error(baseMessage + reasonHint + preArmHint))
    })
  }

  /**
   * The reason a parameter write is currently blocked, or undefined when
   * writes are allowed. Extracted so the batch-rollback path can ask
   * "can I even attempt rollback?" once, instead of discovering the same
   * block N times by letting every rollback `setParameter` throw.
   */
  private parameterWriteBlockReason(): string | undefined {
    if (this.connection.kind !== 'connected') {
      return 'Parameter writes require an active vehicle connection.'
    }
    if (!this.vehicle) {
      return 'Parameter writes require an identified vehicle heartbeat.'
    }
    if (this.parameterSync.status !== 'complete') {
      return 'Parameter writes require a completed parameter sync.'
    }
    if (this.vehicle.armed) {
      return 'Parameter writes are blocked while the vehicle is armed.'
    }
    if (this.guidedActionService.hasActiveAction() || this.motorTestService.hasActiveTest()) {
      return 'Parameter writes are blocked while another guided action or motor test is active.'
    }
    return undefined
  }

  /**
   * Refuse an action that must never reach an armed vehicle. Separate from
   * assertParameterWriteAllowed because these are reboot-class commands, not
   * parameter writes — they have no business being blocked by a running
   * calibration, only by flight.
   */
  private assertNotArmed(reason: string): void {
    if (this.vehicle?.armed) {
      throw new Error(reason)
    }
  }

  private assertParameterWriteAllowed(): void {
    const reason = this.parameterWriteBlockReason()
    if (reason) {
      throw new Error(reason)
    }
  }

  private setGuidedAction(actionId: GuidedActionId, state: GuidedActionState): void {
    this.guidedActionService.setAction(actionId, state)
  }

  private failGuidedAction(actionId: GuidedActionId, error: unknown): void {
    this.guidedActionService.failAction(actionId, error)
  }

  private appendStatusEntry(severity: StatusTextEntry['severity'], text: string): void {
    const duplicate = this.statusTexts[0]?.severity === severity && this.statusTexts[0]?.text === text
    if (!duplicate) {
      this.statusTexts.unshift({
        severity,
        text,
        receivedAtMs: Date.now()
      })
    }
    this.statusTexts.splice(STATUS_TEXT_HISTORY_LIMIT)
  }

  private recordPreArmIssue(text: string, severity: StatusTextEntry['severity']): void {
    const normalized = normalizePreArmIssueText(text)
    if (!normalized) {
      return
    }

    const now = Date.now()
    const existing = this.preArmIssues.get(normalized)
    this.preArmIssues.set(normalized, {
      text: normalized,
      severity,
      firstSeenAtMs: existing?.firstSeenAtMs ?? now,
      lastSeenAtMs: now
    })
    this.schedulePreArmExpiry()
  }

  private buildPreArmStatus(): PreArmStatusState {
    this.prunePreArmIssues()
    const issues = [...this.preArmIssues.values()].sort((left, right) => right.lastSeenAtMs - left.lastSeenAtMs)
    const liveCheck = this.resolveFreshPreArmLiveCheck()
    // Order matters: the live bit wins whenever it is usable, in BOTH
    // directions. It clears a stale latch within one SYS_STATUS period, and it
    // also reports a failure we have no text for yet (the reason follows up to
    // 30 s later) instead of showing a reassuring empty box.
    const liveVerdictUsable = liveCheck !== undefined && liveCheck.present && liveCheck.enabled
    return {
      healthy: liveVerdictUsable ? liveCheck.passing : issues.length === 0,
      issues,
      lastUpdatedAtMs: issues[0]?.lastSeenAtMs,
      liveCheck
    }
  }

  /**
   * The stored verdict, or undefined once SYS_STATUS has gone quiet long enough
   * that we would be quoting a reading we can no longer stand behind.
   */
  private resolveFreshPreArmLiveCheck(referenceTimeMs = Date.now()): PreArmLiveCheckState | undefined {
    if (!this.preArmLiveCheck) {
      return undefined
    }
    if (referenceTimeMs - this.preArmLiveCheck.lastSeenAtMs > PRE_ARM_LIVE_CHECK_TTL_MS) {
      return undefined
    }
    return { ...this.preArmLiveCheck }
  }

  private prunePreArmIssues(referenceTimeMs = Date.now()): boolean {
    let removed = false
    const ttlMs = this.preArmIssueTtlMs()
    this.preArmIssues.forEach((issue, key) => {
      if (referenceTimeMs - issue.lastSeenAtMs > ttlMs) {
        this.preArmIssues.delete(key)
        removed = true
      }
    })
    return removed
  }

  private clearPreArmExpiryTimer(): void {
    if (this.preArmExpiryTimer) {
      clearTimeout(this.preArmExpiryTimer)
      this.preArmExpiryTimer = undefined
    }
  }

  private schedulePreArmExpiry(): void {
    this.clearPreArmExpiryTimer()
    const ttlMs = this.preArmIssueTtlMs()
    const nextExpiryAtMs = [...this.preArmIssues.values()].reduce<number | undefined>((earliest, issue) => {
      const candidate = issue.lastSeenAtMs + ttlMs
      return earliest === undefined ? candidate : Math.min(earliest, candidate)
    }, undefined)

    if (nextExpiryAtMs === undefined) {
      return
    }

    const delayMs = Math.max(nextExpiryAtMs - Date.now(), 0)
    this.preArmExpiryTimer = setTimeout(() => {
      const changed = this.prunePreArmIssues()
      this.preArmExpiryTimer = undefined
      if (changed) {
        this.emit()
      }
      this.schedulePreArmExpiry()
    }, delayMs + 1)
  }
}
