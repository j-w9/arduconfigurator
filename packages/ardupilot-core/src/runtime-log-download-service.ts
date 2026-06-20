import type { LogDataMessage, LogEntryMessage, MavlinkSession } from '@arduconfig/protocol-mavlink'

import type { VehicleIdentity } from './types.js'

// Per-frame inactivity budget — a "the link is dead" safety net, not a
// throughput SLA. Real ArduPilot dataflash streaming over USB is slower
// per frame than MAVFTP, and the request can legitimately sit behind a
// busy transport (e.g. a concurrent parameter sync, or a contended host
// running many things). 8s proved too tight under that contention; 20s
// still catches a genuinely dead link without flaking on a slow-but-
// healthy one. Same lesson as the @SYS/uarts.txt MAVFTP timeout fix.
const DEFAULT_LOG_TIMEOUT_MS = 20000
const LOG_DATA_CHUNK = 90
// Stall retries per download. Each fires after a full inactivity window;
// the 0% case also re-sends LOG_REQUEST_END first (see onTimeout).
const MAX_STALL_RETRIES = 3
// LOG_ENTRY.size is a device-reported uint32 (up to ~4 GB). Allocating a
// buffer of that size up front would let a malformed/hostile FC OOM-crash
// the tab. Real onboard dataflash logs downloaded over MAVLink are well
// under this ceiling; reject anything larger rather than allocate it.
const MAX_LOG_DOWNLOAD_BYTES = 512 * 1024 * 1024

export interface LogDownloadServiceOptions {
  session: MavlinkSession
  getVehicle: () => VehicleIdentity | undefined
  requestTimeoutMs?: number
}

/** One onboard dataflash log as reported by `LOG_ENTRY`. */
export interface OnboardLogInfo {
  id: number
  sizeBytes: number
  /** UTC seconds since epoch, or 0 if the FC did not timestamp the log. */
  timeUtc: number
}

export interface LogDownloadProgress {
  bytesReceived: number
  totalBytes: number
}

/** Minimal board-identity slice used to tag a downloaded log filename. */
export interface OnboardLogFilenameBoard {
  /** STM32 / autopilot unique id (AUTOPILOT_VERSION.uid). Often "0" / all-zero
   *  on FPV boards whose firmware doesn't report it. */
  uid?: string
  /** Firmware build git hash (flight_custom_version), a stable fallback tag. */
  firmwareGitHash?: string
}

function sanitizeFilenameTag(value: string): string {
  // Keep it filesystem-safe and compact: alnum only, trimmed.
  return value.replace(/[^A-Za-z0-9]/g, '').slice(0, 24)
}

function isMeaningfulUid(uid: string | undefined): uid is string {
  if (!uid) {
    return false
  }
  const cleaned = sanitizeFilenameTag(uid)
  // An all-zero (or empty-after-sanitize) uid carries no identity — many
  // boards report uid=0 over MAVLink. Treat that as "no uid".
  return cleaned.length > 0 && /[^0]/.test(cleaned)
}

function utcStamp(timeUtc: number): string | undefined {
  if (!Number.isFinite(timeUtc) || timeUtc <= 0) {
    return undefined
  }
  // timeUtc is seconds-since-epoch; format as compact UTC YYYYMMDD-HHMMSS.
  const date = new Date(timeUtc * 1000)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `-${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`
  )
}

/**
 * Build a descriptive download filename for an onboard dataflash log. Encodes
 * a board-identity tag (the STM32 uid when the FC reports a real one, else the
 * firmware git hash, else a generic "ardupilot") plus the log number and, when
 * the FC timestamped the log, a UTC date stamp — so a folder of downloaded
 * logs from multiple craft stays self-describing instead of a pile of
 * `onboard-log-1.bin` collisions. Always ends in `.bin`.
 */
export function buildOnboardLogFilename(log: OnboardLogInfo, board?: OnboardLogFilenameBoard): string {
  const tag = isMeaningfulUid(board?.uid)
    ? sanitizeFilenameTag(board.uid)
    : board?.firmwareGitHash
      ? sanitizeFilenameTag(board.firmwareGitHash)
      : 'ardupilot'
  const stamp = utcStamp(log.timeUtc)
  const stampPart = stamp ? `_${stamp}` : ''
  return `${tag || 'ardupilot'}_log${log.id}${stampPart}.bin`
}

interface ListOperation {
  kind: 'list'
  entries: Map<number, OnboardLogInfo>
  numLogs: number | undefined
  resolve: (logs: OnboardLogInfo[]) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

interface DataOperation {
  kind: 'data'
  id: number
  total: number
  buffer: Uint8Array
  received: number
  retries: number
  onProgress?: (progress: LogDownloadProgress) => void
  resolve: (bytes: Uint8Array) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

type ActiveOperation = ListOperation | DataOperation

/**
 * LOG_* (dataflash log) send/receive plumbing, extracted as a service so
 * the runtime only has to delegate — same shape as MavftpService /
 * MotorTestService. The LOG protocol has no per-request sequence number,
 * so operations are correlated by message type (and, for data, the log
 * id) against a single in-flight operation rather than a waiter set.
 */
export class LogDownloadService {
  private readonly session: MavlinkSession
  private readonly getVehicle: () => VehicleIdentity | undefined
  private readonly requestTimeoutMs: number
  private active: ActiveOperation | undefined

  constructor(options: LogDownloadServiceOptions) {
    this.session = options.session
    this.getVehicle = options.getVehicle
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_LOG_TIMEOUT_MS
  }

  /** Request the onboard log list. Resolves to `[]` when none are present. */
  async listLogs(): Promise<OnboardLogInfo[]> {
    const vehicle = this.requireIdle()
    return new Promise<OnboardLogInfo[]>((resolve, reject) => {
      const op: ListOperation = {
        kind: 'list',
        entries: new Map(),
        numLogs: undefined,
        resolve,
        reject,
        timer: this.armTimer()
      }
      this.active = op
      void this.session
        .send({
          type: 'LOG_REQUEST_LIST',
          targetSystem: vehicle.systemId,
          targetComponent: vehicle.componentId,
          start: 0,
          end: 0xffff
        })
        .catch((error) => this.failActive(this.asError(error)))
    })
  }

  /** Download a single log's bytes, reporting progress as chunks arrive. */
  async downloadLog(
    id: number,
    sizeBytes: number,
    onProgress?: (progress: LogDownloadProgress) => void
  ): Promise<Uint8Array> {
    // Validates idle + identified vehicle; requestData re-reads the
    // vehicle each send so the binding itself is not needed here.
    this.requireIdle()
    if (!Number.isFinite(sizeBytes) || sizeBytes < 0 || sizeBytes > MAX_LOG_DOWNLOAD_BYTES) {
      return Promise.reject(
        new Error(
          `Log size ${sizeBytes} bytes is out of range (max ${MAX_LOG_DOWNLOAD_BYTES}); refusing to allocate.`
        )
      )
    }
    return new Promise<Uint8Array>((resolve, reject) => {
      const op: DataOperation = {
        kind: 'data',
        id,
        total: sizeBytes,
        buffer: new Uint8Array(sizeBytes),
        received: 0,
        retries: 0,
        onProgress,
        resolve,
        reject,
        timer: this.armTimer()
      }
      this.active = op
      if (sizeBytes === 0) {
        this.finishData(op)
        return
      }
      this.requestData(op, 0)
    })
  }

  handleLogEntry(message: LogEntryMessage): void {
    const op = this.active
    if (!op || op.kind !== 'list') {
      return
    }
    this.bumpTimer(op)

    if (message.numLogs === 0) {
      this.finishList(op)
      return
    }

    op.numLogs = message.numLogs
    op.entries.set(message.id, {
      id: message.id,
      sizeBytes: message.size,
      timeUtc: message.timeUtc
    })

    if (op.numLogs !== undefined && op.entries.size >= op.numLogs) {
      this.finishList(op)
    }
  }

  handleLogData(message: LogDataMessage): void {
    const op = this.active
    if (!op || op.kind !== 'data' || message.id !== op.id) {
      return
    }
    this.bumpTimer(op)

    let writable = 0
    if (message.ofs < op.total) {
      writable = Math.min(message.count, LOG_DATA_CHUNK, op.total - message.ofs)
      // Always place the bytes at their true offset — an out-of-order
      // chunk (e.g. a re-stream after a drop) lands correctly so a
      // later contiguous fill sees them.
      op.buffer.set(message.data.subarray(0, writable), message.ofs)
    }

    // `received` is the CONTIGUOUS frontier, not a high-water mark: only
    // advance it when this chunk starts at or before the frontier (no
    // hole). LOG_DATA is streamed sequentially and unacked, so a real
    // link can drop a middle window; without contiguity tracking a later
    // window — or the FC's short end-of-log chunk — would push a
    // high-water mark to the end and silently resolve a zero-filled,
    // corrupt log as a SUCCESSFUL download. Leaving `received` at the gap
    // means completion can't fire across a hole and the existing
    // inactivity retry re-requests from the true gap.
    const contiguous = message.ofs <= op.received && message.ofs < op.total
    if (contiguous) {
      op.received = Math.max(op.received, message.ofs + writable)
      op.onProgress?.({ bytesReceived: op.received, totalBytes: op.total })
    }

    // Complete only when the contiguous frontier reaches the end: the
    // whole known size, or a short end-of-log chunk that was itself
    // contiguous (the legitimate "LOG_ENTRY over-reported size" case —
    // the buffer stays sizeBytes with a benign zero tail, unchanged).
    // A short chunk that arrived with a hole still open must NOT
    // complete; the retry path then recovers it or fails honestly.
    if (op.received >= op.total || (message.count < LOG_DATA_CHUNK && contiguous)) {
      this.finishData(op)
    }
  }

  cancelAll(error: Error): void {
    if (this.active) {
      this.failActive(error)
    }
  }

  private requireIdle(): VehicleIdentity {
    if (this.active) {
      throw new Error('A log operation is already in progress.')
    }
    const vehicle = this.getVehicle()
    if (!vehicle) {
      throw new Error('Log retrieval requires an identified vehicle.')
    }
    return vehicle
  }

  private requestData(op: DataOperation, offset: number): void {
    const vehicle = this.getVehicle()
    if (!vehicle) {
      this.failActive(new Error('Log retrieval requires an identified vehicle.'))
      return
    }
    void this.session
      .send({
        type: 'LOG_REQUEST_DATA',
        targetSystem: vehicle.systemId,
        targetComponent: vehicle.componentId,
        id: op.id,
        ofs: offset,
        count: 0xffffffff
      })
      .catch((error) => this.failActive(this.asError(error)))
  }

  private finishList(op: ListOperation): void {
    this.clearActive(op)
    this.sendRequestEnd()
    const logs = [...op.entries.values()].sort((left, right) => left.id - right.id)
    op.resolve(logs)
  }

  private finishData(op: DataOperation): void {
    this.clearActive(op)
    this.sendRequestEnd()
    op.resolve(op.buffer)
  }

  private failActive(error: Error): void {
    const op = this.active
    if (!op) {
      return
    }
    this.clearActive(op)
    this.sendRequestEnd()
    op.reject(error)
  }

  private armTimer(): ReturnType<typeof setTimeout> {
    return setTimeout(() => this.onTimeout(), this.requestTimeoutMs)
  }

  private bumpTimer(op: ActiveOperation): void {
    clearTimeout(op.timer)
    op.timer = this.armTimer()
  }

  private onTimeout(): void {
    const op = this.active
    if (!op) {
      return
    }
    // Stall-retry from the contiguous frontier — INCLUDING 0%. The old
    // `received > 0` guard meant a download that never produced its first
    // window hard-failed with no retry, and 0% is exactly where the
    // field failure lives: ArduPilot SILENTLY drops LOG_REQUEST_DATA
    // while it still considers a log transfer active on some link
    // (AP_Logger_MAVLinkLogTransfer holds _log_sending_link from the
    // LIST until a LOG_REQUEST_END arrives — lose that one packet, or
    // leave another GCS attached, and every data request is ignored).
    // Each 0% retry therefore sends LOG_REQUEST_END first to clear any
    // stuck FC-side transfer state before re-requesting.
    if (op.kind === 'data' && op.retries < MAX_STALL_RETRIES && op.received < op.total) {
      op.retries += 1
      op.timer = this.armTimer()
      if (op.received === 0) {
        this.sendRequestEnd()
      }
      this.requestData(op, op.received)
      return
    }
    this.failActive(
      new Error(
        op.kind === 'data' && op.received === 0
          ? `No log data arrived after ${this.requestTimeoutMs}ms and ${MAX_STALL_RETRIES} retries. The autopilot may consider another log transfer active — disconnect other ground stations, or reboot the flight controller, and try again.`
          : `Timed out waiting for log ${op.kind} response after ${this.requestTimeoutMs}ms.`
      )
    )
  }

  private clearActive(op: ActiveOperation): void {
    clearTimeout(op.timer)
    if (this.active === op) {
      this.active = undefined
    }
  }

  private sendRequestEnd(): void {
    const vehicle = this.getVehicle()
    if (!vehicle) {
      return
    }
    void this.session
      .send({
        type: 'LOG_REQUEST_END',
        targetSystem: vehicle.systemId,
        targetComponent: vehicle.componentId
      })
      .catch(() => {})
  }

  private asError(error: unknown): Error {
    return error instanceof Error ? error : new Error('Unknown log-download error.')
  }
}
