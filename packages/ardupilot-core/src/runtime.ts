import type {
  FirmwareMetadataBundle,
  GuidedActionId,
  LiveSignalId,
} from '@arduconfig/param-metadata'
import type {
  AttitudeMessage,
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
  PreArmIssueState,
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
  formatFlightCustomVersion,
  parseUartsFile,
  type MavftpDirectoryEntry,
} from './mavftp.js'
import { listMavftpLogFiles } from './mavftp-log-directories.js'
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

export interface RequestParameterListOptions extends WaitForVehicleOptions {}

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
const DEFAULT_HEARTBEAT_TIMEOUT_MS = 20000
const DEFAULT_PARAMETER_SYNC_TIMEOUT_MS = 20000
const PARAMETER_SYNC_STALL_RETRY_MS = 1500
const MAX_PARAMETER_SYNC_RETRIES = 3
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
const LEGACY_PARAM_ALIASES: Record<string, string> = {
  // legacy -> modern (ArduPilot 4.5+ GPS family rename)
  GPS_TYPE: 'GPS1_TYPE',
  GPS_TYPE2: 'GPS2_TYPE',
  GPS_RATE_MS: 'GPS1_RATE_MS',
  GPS_GNSS_MODE: 'GPS1_GNSS_MODE',
  // ArduPlane 4.5+ airspeed-bounds rename (same m/s unit). NOT included:
  // TRIM_ARSPD_CM / AIRSPEED_CRUISE — that rename changed cm/s -> m/s.
  ARSPD_FBW_MIN: 'AIRSPEED_MIN',
  ARSPD_FBW_MAX: 'AIRSPEED_MAX',
  // QuadPlane attitude rate limits (axis-name abbreviation, same deg/s unit).
  // NOT included: Q_A_ACCEL_* -> Q_A_ACC_*, which also changed units.
  Q_A_RATE_RLL_MAX: 'Q_A_RATE_R_MAX',
  Q_A_RATE_PIT_MAX: 'Q_A_RATE_P_MAX',
  Q_A_RATE_YAW_MAX: 'Q_A_RATE_Y_MAX',
  // Rover 4.3 cornering-limit rehome (same g unit/range). The retired
  // WP_OVERSHOOT / NAVL1_* family have no modern replacement, so no alias.
  TURN_MAX_G: 'ATC_TURN_MAX_G',
  // ArduPilot 4.5+ MAVLink identifier rename (same range, no unit), plus the
  // MODE_CH -> FLTMODE_CH flight-mode channel rename.
  SYSID_THISMAV: 'MAV_SYSID',
  SYSID_MYGCS: 'MAV_GCS_SYSID',
  MODE_CH: 'FLTMODE_CH'
}
const MODERN_TO_LEGACY_ALIASES: Record<string, string> = Object.fromEntries(
  Object.entries(LEGACY_PARAM_ALIASES).map(([legacy, modern]) => [modern, legacy])
)
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
const LIVE_TELEMETRY_REQUESTS = [
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
  }
] as const
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
  private readonly preArmIssues = new Map<string, PreArmIssueState>()
  private readonly statusTexts: StatusTextEntry[] = []
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
  private liveTelemetryRequestsIssued = false
  // FIFO of un-ACKed SET_MESSAGE_INTERVAL requests, dequeued in arrival order
  // so processCommandAck can name which stream the autopilot rejected.
  private readonly pendingSetMessageIntervalLabels: string[] = []
  private preArmExpiryTimer?: ReturnType<typeof setTimeout>
  private parameterSyncRetryTimer?: ReturnType<typeof setTimeout>
  private parameterSyncRetryCount = 0
  // Test-injectable per-instance override; defaults to the
  // module constant. Production callers never set this.
  private readonly parameterSyncStallRetryMs: number
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
        this.emit()
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

  getSnapshot(): ConfiguratorSnapshot {
    const parameters = [...this.parameters.values()].sort((left, right) => left.id.localeCompare(right.id))
    const preArmStatus = this.buildPreArmStatus()

    return {
      connection: this.connection,
      vehicle: this.vehicle,
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
      this.parameters.clear()
      this.realParameterIdsReceived.clear()
      this.totalParameters = 0
      this.parameterSyncRetryCount = 0
      this.clearParameterSyncRetryTimer()
      this.parameterSync = {
        status: 'requesting',
        downloaded: 0,
        total: 0,
        duplicateFrames: 0,
        progress: null,
        targetSystemId: vehicle.systemId,
        targetComponentId: vehicle.componentId,
        requestedAtMs: Date.now()
      }
      this.setGuidedAction('request-parameters', {
        actionId: 'request-parameters',
        status: 'running',
        summary: `Parameter request sent to sys=${vehicle.systemId} comp=${vehicle.componentId}.`,
        instructions: ['Waiting for the autopilot to stream the full parameter table.'],
        statusTexts: [],
        startedAtMs: this.guidedActionService.getAction('request-parameters').startedAtMs ?? Date.now(),
        updatedAtMs: Date.now(),
        completedAtMs: undefined
      })
      this.emit()

      await this.requestParameterTable(vehicle.systemId, vehicle.componentId)
    } catch (error) {
      this.failGuidedAction('request-parameters', error)
      this.emit()
      throw error
    }
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
      throw error
    }
  }

  async setParameters(
    requests: ParameterWriteRequest[],
    options: ParameterWriteOptions = {},
    onProgress?: (progress: ParameterBatchWriteProgress) => void
  ): Promise<ParameterBatchWriteResult> {
    const result: ParameterBatchWriteResult = {
      applied: [],
      rolledBack: []
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

    return result
  }

  async listRemoteDirectory(path = '@SYS'): Promise<MavftpDirectoryEntry[]> {
    return this.mavftp.listRemoteDirectory(path)
  }

  async downloadRemoteFile(path: string): Promise<Uint8Array> {
    return this.mavftp.downloadRemoteFile(path)
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
  async downloadMavftpLog(
    path: string,
    onProgress?: (progress: LogDownloadProgress) => void
  ): Promise<Uint8Array> {
    const bytes = await this.mavftp.downloadRemoteFileBurst(path, {
      onProgress,
      maxBytes: MAX_MAVFTP_LOG_BYTES
    })
    this.appendStatusEntry('info', `Downloaded ${path} via MAVFTP (${bytes.length} bytes).`)
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

  /** Operator-initiated early abort of an in-flight motor test. */
  async stopMotorTest(): Promise<void> {
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
    await this.sendCommand(MAV_CMD.PREFLIGHT_REBOOT_SHUTDOWN, [3, 0, 0, 0, 0, 0, 0], {
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
      case 'ATTITUDE':
        this.processAttitude(envelope.message)
        break
      case 'ATTITUDE_QUATERNION':
        this.processAttitudeQuaternion(envelope.message)
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

  private processParamValue(message: ParamValueMessage): void {
    // "Known" tracks REAL arrivals (excludes alias-mirror entries) so a
    // mirrored entry placed under one id by a later message does not mark
    // an earlier real arrival under the other id as a duplicate.
    const known = this.realParameterIdsReceived.has(message.paramId)
    this.realParameterIdsReceived.add(message.paramId)
    this.totalParameters = message.paramCount

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
    this.statusTexts.unshift({
      severity,
      text,
      receivedAtMs: Date.now()
    })
    this.statusTexts.splice(STATUS_TEXT_HISTORY_LIMIT)
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
  }

  private processAttitudeQuaternion(message: AttitudeQuaternionMessage): void {
    this.liveVerification.attitudeTelemetry = {
      ...this.liveVerification.attitudeTelemetry,
      verified: true,
      quaternion: { w: message.qw, x: message.qx, y: message.qy, z: message.qz },
      lastSeenAtMs: Date.now()
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

  // OPTICAL_FLOW (msgid 100) is the "pulse on the flow sensor" signal. This
  // only records whether the sensor is producing telemetry (no EKF
  // innovations); the UI computes the freshness window against lastSeenAtMs.
  private processOpticalFlow(message: OpticalFlowMessage): void {
    this.liveVerification.opticalFlow = {
      verified: true,
      lastSeenAtMs: Date.now(),
      sensorId: message.sensorId,
      quality: message.quality
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
    this.commandAckLog.unshift({
      command: message.command,
      result: message.result,
      receivedAtMs: Date.now(),
      sourceSystemId: systemId,
      sourceComponentId: componentId,
      foreign
    })
    this.commandAckLog.splice(ArduPilotConfiguratorRuntime.COMMAND_ACK_LOG_LIMIT)
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
    if (this.batchEmitMode) {
      // Batch write: coalesce to the timer interval only (skip per-frame rAF).
      // The full-snapshot rebuild + app re-render is expensive; doing it ~4x/s
      // instead of ~60x/s frees the main thread to process the PARAM_VALUE
      // readbacks that resolve each write, so the batch runs at link speed.
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

  private resetLiveState(): void {
    this.vehicle = undefined
    this.hardwareBoard = undefined
    this.uartsFile = createIdleUartsFileState()
    this.pwmOutputCount = undefined
    this.parameters.clear()
    this.realParameterIdsReceived.clear()
    this.totalParameters = 0
    this.parameterSyncRetryCount = 0
    this.parameterSync = createIdleParameterSync()
    this.guidedActionService.reset()
    this.motorTestService.reset()
    this.liveVerification = createIdleLiveVerification()
    this.liveTelemetryRequestsIssued = false
    this.pendingSetMessageIntervalLabels.length = 0
    this.autopilotVersionRequested = false
    this.uartsFileRequested = false
    this.preArmIssues.clear()
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

    if (
      (this.parameterSync.status !== 'requesting' && this.parameterSync.status !== 'streaming') ||
      this.parameterSyncRetryCount >= MAX_PARAMETER_SYNC_RETRIES
    ) {
      return
    }

    this.parameterSyncRetryTimer = setTimeout(() => {
      void this.retryParameterSync()
    }, this.parameterSyncStallRetryMs)
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

    if (
      !this.vehicle ||
      (this.parameterSync.status !== 'requesting' && this.parameterSync.status !== 'streaming') ||
      // Gate on realParameterIdsReceived.size, NOT parameters.size (which
      // counts alias mirrors), against the alias-free FC-reported total — same
      // source the completion gate uses.
      this.realParameterIdsReceived.size >= this.totalParameters && this.totalParameters > 0 ||
      this.parameterSyncRetryCount >= MAX_PARAMETER_SYNC_RETRIES
    ) {
      return
    }

    this.parameterSyncRetryCount += 1
    // Use the alias-free count for the "stalled at X/Y" label so it matches
    // the downloaded count getSnapshot() exposes.
    const downloaded = this.realParameterIdsReceived.size
    const total = this.totalParameters
    this.appendStatusEntry(
      'warning',
      `Parameter stream stalled at ${downloaded}/${total || 'unknown'}. Re-requesting the table (${this.parameterSyncRetryCount}/${MAX_PARAMETER_SYNC_RETRIES}).`
    )
    this.setGuidedAction('request-parameters', {
      ...this.guidedActionService.getAction('request-parameters'),
      status: 'running',
      // Recovery is a full PARAM_REQUEST_LIST re-stream (no partial-list
      // request exists), so the copy says "full parameter table".
      summary: `Parameter stream stalled at ${downloaded}/${total || 'unknown'}. Re-requesting the full parameter table.`,
      instructions: ['Keep the link open while the configurator retries the parameter stream.'],
      updatedAtMs: Date.now(),
      completedAtMs: undefined
    })
    this.emit()

    try {
      await this.requestParameterTable(this.vehicle.systemId, this.vehicle.componentId)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown parameter retry error.'
      this.appendStatusEntry('warning', `Failed to retry the parameter stream: ${message}`)
      this.emit()
      this.scheduleParameterSyncRetry()
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
    return {
      healthy: issues.length === 0,
      issues,
      lastUpdatedAtMs: issues[0]?.lastSeenAtMs
    }
  }

  private prunePreArmIssues(referenceTimeMs = Date.now()): boolean {
    let removed = false
    this.preArmIssues.forEach((issue, key) => {
      if (referenceTimeMs - issue.lastSeenAtMs > PRE_ARM_ISSUE_TTL_MS) {
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
    const nextExpiryAtMs = [...this.preArmIssues.values()].reduce<number | undefined>((earliest, issue) => {
      const candidate = issue.lastSeenAtMs + PRE_ARM_ISSUE_TTL_MS
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
