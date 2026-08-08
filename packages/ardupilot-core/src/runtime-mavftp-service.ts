import type {
  FileTransferProtocolMessage,
  MavlinkSession
} from '@arduconfig/protocol-mavlink'
import { MAV_FTP_ERR, MAV_FTP_OPCODE } from '@arduconfig/protocol-mavlink'

import {
  decodeMavftpPayload,
  encodeMavftpPayload,
  MavftpRequestError,
  normalizeMavftpPath,
  parseMavftpDirectoryEntries,
  type MavftpDirectoryEntry,
  type MavftpPayload
} from './mavftp.js'
import type { LogDownloadProgress } from './runtime-log-download-service.js'
import { sortMavftpDirectoryEntries } from './runtime-helpers.js'
import type { VehicleIdentity } from './types.js'

const DEFAULT_MAVFTP_TIMEOUT_MS = 3000
const MAVFTP_TRANSFER_CHUNK_SIZE = 200
// ArduPilot `@SYS` virtual files report size 0 on OPEN_FILE_RO and are read
// until the server's EOF NAK; this cap bounds that read so a FC that never
// sends EOF can't loop forever.
const MAX_MAVFTP_FILE_BYTES = 16 * 1024 * 1024
// Per-packet read size requested in a BURST_READ_FILE; the FTP payload data
// field is 239 bytes, so the server streams packets of up to this size.
const MAVFTP_BURST_READ_SIZE = 239
// Inactivity budget for a burst download — the timer resets on every packet, so
// this only fires once the stream has genuinely gone quiet (a lost burst tail or
// a lost burst_complete). ArduPilot streams up to 2000 packets per request and
// only signals burst_complete on the last one, so a single dropped packet on a
// no-flow-control USB link leaves the transfer waiting; keep this short enough
// that recovery is snappy but long enough to tolerate a slow SD card.
const DEFAULT_MAVFTP_BURST_TIMEOUT_MS = 6000
// CONSECUTIVE-stall retries (reset on any forward progress — see
// handleBurstPacket). A large multi-burst log over a lossy link legitimately
// hits many isolated stalls across the whole download; the budget is per-stall,
// not per-download, so it must not be exhausted by total stall count.
const MAX_MAVFTP_BURST_RETRIES = 6

interface MavftpWaiter {
  seqNumber: number
  resolve: (payload: MavftpPayload) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

interface MavftpWaiterHandle {
  seqNumber: number
  promise: Promise<MavftpPayload>
  cancel: (error: Error) => void
}

/**
 * A burst that was cancelled by its caller, not one that failed.
 *
 * Distinct from a generic Error so a caller can tell "I stood this down" from
 * "the link broke" — background work must swallow its own cancellation
 * silently, while a real failure is worth knowing about.
 */
export class MavftpAbortError extends Error {
  readonly aborted = true
  constructor() {
    super('MAVFTP burst download was aborted.')
    this.name = 'MavftpAbortError'
  }
}

/**
 * Bytes recovered from a transfer that did not finish.
 *
 * A failed burst is not necessarily a worthless one. The reader tracks a
 * CONTIGUOUS frontier, so everything below it is known-good, and a dataflash
 * log carries its FMT definitions at the front — which makes a prefix a
 * genuinely parseable log that simply ends early. Throwing that away because
 * the last packet never arrived discards a whole flight to save nothing.
 */
export interface PartialTransfer {
  /** The contiguous prefix actually received. Never has holes. */
  bytes: Uint8Array
  /** Size the vehicle said the file was, for judging how much is missing. */
  declaredSize: number
}

/**
 * Carried on the rejected error rather than as a distinct error type, because
 * callers already discriminate on MavftpAbortError / MavftpRequestError and a
 * new type would silently change which branch they take. A symbol keeps it off
 * the error's own enumerable surface.
 */
const PARTIAL_TRANSFER = Symbol.for('arduconfig.mavftp.partialTransfer')

/** The bytes salvaged from a failed transfer, when there were any. */
export function partialTransferOf(error: unknown): PartialTransfer | undefined {
  if (typeof error !== 'object' || error === null) return undefined
  const value = (error as Record<symbol, unknown>)[PARTIAL_TRANSFER]
  return value as PartialTransfer | undefined
}

function attachPartialTransfer(error: Error, partial: PartialTransfer): void {
  Object.defineProperty(error, PARTIAL_TRANSFER, {
    value: partial,
    enumerable: false,
    configurable: true
  })
}

interface BurstOperation {
  /** Detaches the abort listener, if one was attached. Called on every exit. */
  cleanup?: () => void
  session: number
  declaredSize: number
  buffer: Uint8Array
  // Contiguous frontier — bytes [0, received) are all present — NOT a
  // high-water mark. A dropped middle packet must leave this at the gap so
  // completion can't fire across a hole; see handleBurstPacket (and the same
  // reasoning in LogDownloadService).
  received: number
  // Highest offset+length ever written into the buffer. When this is ahead of
  // `received` a packet was dropped below it (a hole); an EOF NAK in that state
  // means we're missing middle data, not that the file ended.
  highWater: number
  // CONSECUTIVE stalls since the last forward progress; reset to 0 whenever the
  // contiguous frontier advances, so the retry budget is per-stall.
  retries: number
  timeoutMs: number
  onProgress?: (progress: LogDownloadProgress) => void
  resolve: (bytes: Uint8Array) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export interface MavftpServiceOptions {
  session: MavlinkSession
  getVehicle: () => VehicleIdentity | undefined
  ensureSupport: () => Promise<void>
  requestTimeoutMs?: number
}

/**
 * MAVFTP send/receive plumbing extracted from the runtime so the runtime
 * class only has to delegate. Owns its own waiter set and sequence counter;
 * leaves the higher-level UARTs-file workflow on the runtime so snapshot
 * state mutations stay there.
 */
export class MavftpService {
  private readonly session: MavlinkSession
  private readonly getVehicle: () => VehicleIdentity | undefined
  private readonly ensureSupport: () => Promise<void>
  private readonly requestTimeoutMs: number
  private readonly waiters = new Set<MavftpWaiter>()
  private activeBurst: BurstOperation | undefined
  /**
   * When MAVFTP last put a request on the wire.
   *
   * Read by the runtime (`isTransferInFlight`) because a transfer saturates the
   * downlink, and ArduPilot PURGES any STATUSTEXT it could not send within 5s
   * (GCS_Common.cpp's statustext queue drain). Anything that infers meaning
   * from the ABSENCE of a STATUSTEXT — the pre-arm reason list does exactly
   * that — has to know when that inference is unsafe.
   *
   * Stamped at the single send() choke point rather than wrapped around each
   * public operation: that covers bursts, plain reads, uploads and directory
   * listings alike, with nothing to keep in sync as operations are added.
   */
  private lastTransferActivityAtMs = 0
  /** Tail of the serialization chain — see withExclusiveSession. */
  private transferQueue: Promise<void> = Promise.resolve()
  private sessionHeld = false
  // The seq_number to put on the NEXT request. Not a private counter: MAVFTP's
  // seq_number is a SHARED, monotonically rising conversation counter that the
  // server advances too. A burst reply stream bumps the server's copy once per
  // streamed packet (ArduPilot GCS_FTP.cpp `reply.seq_number++` inside the
  // BurstReadFile loop) while the client only ever sent one request — so a
  // client that just counts its own sends falls BEHIND the server. See
  // adoptServerSequence for what that costs.
  private sequence = 0
  // Per the MAVLink FTP spec the client sends ResetSessions so a stale
  // server-side session doesn't block session-allocating ops. Sent lazily
  // once before the first such op; re-armed by cancelAll() on link drop.
  private staleSessionsCleared = false

  constructor(options: MavftpServiceOptions) {
    this.session = options.session
    this.getVehicle = options.getVehicle
    this.ensureSupport = options.ensureSupport
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_MAVFTP_TIMEOUT_MS
  }

  /**
   * True while MAVFTP is actively moving data. `windowMs` is how long after the
   * last request the link should still be considered busy — generous by
   * default, because the cost of a false positive is only that a pre-arm reason
   * lingers a little longer, while a false negative drops a live reason.
   */
  isTransferInFlight(windowMs = 3000): boolean {
    return this.lastTransferActivityAtMs > 0 && Date.now() - this.lastTransferActivityAtMs < windowMs
  }

  // ── Public API: one MAVFTP conversation at a time ────────────────────────
  //
  // Every session-allocating request this client sends hardcodes `session: 0`,
  // and ArduPilot's FTP server does not allocate ids — it echoes back whatever
  // the client chose (GCS_FTP.cpp `reply.session = request.session`). So all
  // transfers share one server-side session no matter how many slots the
  // firmware has.
  //
  // Unserialized, that corrupts data silently rather than failing. Transfer A
  // holds an open fd on session 0; B's OPEN_FILE_RO is NAKed with "only one
  // file open per session"; our own recovery reads that bare NAK as a leaked
  // stale handle and sends RESET_SESSIONS, which FORCE-CLOSES A's fd; B then
  // reopens on the same session and A's next READ_FILE returns B's file at A's
  // offsets, ACKed, with valid-looking data. The overlaps are real and
  // automatic-vs-operator: the @SYS/uarts.txt fetch at connect and the
  // param.pck fetch on first row expansion both race operator log downloads,
  // file-browser transfers and Lua script reads.
  //
  // Distinct session ids would NOT fix this on <= 4.6 (a single global fd; a
  // foreign session id gets InvalidSession), so serialization is the portable
  // answer. It is also honest about the hardware: one link, one conversation.

  listRemoteDirectory(path: string): Promise<MavftpDirectoryEntry[]> {
    return this.withExclusiveSession(() => this.listRemoteDirectoryUnlocked(path))
  }

  downloadRemoteFile(path: string): Promise<Uint8Array> {
    return this.withExclusiveSession(() => this.downloadRemoteFileUnlocked(path))
  }

  uploadRemoteFile(path: string, bytes: Uint8Array, options: { overwrite?: boolean } = {}): Promise<void> {
    return this.withExclusiveSession(() => this.uploadRemoteFileUnlocked(path, bytes, options))
  }

  deleteRemotePath(path: string, kind: 'file' | 'directory' = 'file'): Promise<void> {
    return this.withExclusiveSession(() => this.deleteRemotePathUnlocked(path, kind))
  }

  readRemoteTextFile(path: string, options: { timeoutMs?: number } = {}): Promise<string> {
    return this.withExclusiveSession(() => this.readRemoteTextFileUnlocked(path, options))
  }

  readRemoteFilePrefix(path: string, byteLimit: number, options: { timeoutMs?: number } = {}): Promise<Uint8Array> {
    return this.withExclusiveSession(() => this.readRemoteFilePrefixUnlocked(path, byteLimit, options))
  }

  readRemoteFile(path: string, options: { timeoutMs?: number; byteLimit?: number } = {}): Promise<Uint8Array> {
    return this.withExclusiveSession(() => this.readRemoteFileUnlocked(path, options))
  }

  downloadRemoteFileBurst(
    path: string,
    options: Parameters<MavftpService['downloadRemoteFileBurstUnlocked']>[1] = {}
  ): Promise<Uint8Array> {
    return this.withExclusiveSession(() => this.downloadRemoteFileBurstUnlocked(path, options))
  }

  /**
   * Run `operation` with exclusive use of the FTP session.
   *
   * Re-entrant on purpose: downloadRemoteFile delegates to readRemoteFile and
   * readRemoteTextFile to readRemoteFileUnlocked, so a nested call from inside
   * a held lock runs straight through instead of deadlocking against itself.
   */
  private async withExclusiveSession<T>(operation: () => Promise<T>): Promise<T> {
    if (this.sessionHeld) {
      return operation()
    }
    const predecessor = this.transferQueue
    let release = (): void => {}
    // The queue link resolves only from the finally below, so it can never
    // reject and never needs a rejection handler to stay unbroken.
    this.transferQueue = predecessor.then(() => new Promise<void>((resolve) => {
      release = resolve
    }))
    await predecessor
    this.sessionHeld = true
    try {
      return await operation()
    } finally {
      this.sessionHeld = false
      release()
    }
  }

  private async listRemoteDirectoryUnlocked(path: string): Promise<MavftpDirectoryEntry[]> {
    await this.ensureSupport()

    const normalizedPath = normalizeMavftpPath(path)
    const pathBytes = new TextEncoder().encode(normalizedPath)
    const entries: MavftpDirectoryEntry[] = []
    let offset = 0

    while (true) {
      try {
        const response = await this.send({
          session: 0,
          opcode: MAV_FTP_OPCODE.LIST_DIRECTORY,
          size: pathBytes.length,
          offset,
          data: pathBytes
        })
        const chunkEntries = parseMavftpDirectoryEntries(normalizedPath, response.data)
        if (chunkEntries.length === 0) {
          break
        }

        entries.push(...chunkEntries)
        offset += chunkEntries.length
      } catch (error) {
        if (error instanceof MavftpRequestError && error.errorCode === MAV_FTP_ERR.EOF) {
          break
        }
        throw error
      }
    }

    return entries.sort(sortMavftpDirectoryEntries)
  }

  private async downloadRemoteFileUnlocked(path: string): Promise<Uint8Array> {
    await this.ensureSupport()
    return this.readRemoteFileUnlocked(normalizeMavftpPath(path))
  }

  private async uploadRemoteFileUnlocked(path: string, bytes: Uint8Array, options: { overwrite?: boolean } = {}): Promise<void> {
    await this.ensureSupport()

    const normalizedPath = normalizeMavftpPath(path)
    const pathBytes = new TextEncoder().encode(normalizedPath)
    const overwriteExisting = options.overwrite ?? true
    await this.clearStaleSessionsOnce()
    let createResponse: MavftpPayload

    try {
      createResponse = await this.send({
        session: 0,
        opcode: MAV_FTP_OPCODE.CREATE_FILE,
        size: pathBytes.length,
        offset: 0,
        data: pathBytes
      })
    } catch (error) {
      if (!(overwriteExisting && error instanceof MavftpRequestError && error.errorCode === MAV_FTP_ERR.FILE_EXISTS)) {
        throw error
      }

      await this.deleteRemotePath(normalizedPath, 'file')
      createResponse = await this.send({
        session: 0,
        opcode: MAV_FTP_OPCODE.CREATE_FILE,
        size: pathBytes.length,
        offset: 0,
        data: pathBytes
      })
    }

    const session = createResponse.session
    let offset = 0

    try {
      while (offset < bytes.length) {
        const chunk = bytes.slice(offset, offset + MAVFTP_TRANSFER_CHUNK_SIZE)
        await this.send({
          session,
          opcode: MAV_FTP_OPCODE.WRITE_FILE,
          size: chunk.length,
          offset,
          data: chunk
        })
        offset += chunk.length
      }
    } finally {
      await this.send({
        session,
        opcode: MAV_FTP_OPCODE.TERMINATE_SESSION,
        size: 0,
        offset: 0,
        data: new Uint8Array(0)
      }).catch(() => {})
    }
  }

  private async deleteRemotePathUnlocked(path: string, kind: 'file' | 'directory' = 'file'): Promise<void> {
    await this.ensureSupport()

    const normalizedPath = normalizeMavftpPath(path)
    const pathBytes = new TextEncoder().encode(normalizedPath)
    await this.send({
      session: 0,
      opcode: kind === 'directory' ? MAV_FTP_OPCODE.REMOVE_DIRECTORY : MAV_FTP_OPCODE.REMOVE_FILE,
      size: pathBytes.length,
      offset: 0,
      data: pathBytes
    })
  }

  private async readRemoteTextFileUnlocked(path: string, options: { timeoutMs?: number } = {}): Promise<string> {
    const bytes = await this.readRemoteFileUnlocked(path, options)
    return new TextDecoder().decode(bytes).replace(/\0+$/, '')
  }

  /**
   * Read only the first `byteLimit` bytes of a remote file.
   *
   * Exists for ArduPilot's `@SYS` region files, whose OPEN size cannot be
   * trusted: AP_Filesystem_Sys.cpp stat() hands back a flat placeholder for
   * every `@SYS` entry except storage.bin/crash_dump.bin, while the file
   * itself may be megabytes long (`@SYS/flash.bin` spans the whole program
   * flash). Reading such a file "to EOF" would pull far more off the link than
   * the caller wants, so a caller that only needs a known-length prefix says
   * so and pays for exactly that.
   *
   * Deliberately the sequential READ_FILE loop rather than BURST_READ_FILE:
   * ArduPilot's burst server streams up to 2000 packets per request and cannot
   * be stopped early, so bursting a prefix of a large region would put
   * hundreds of KB on the wire to fetch tens. It also keeps this read off the
   * single-slot burst path, so it can never make an operator's own log
   * download fail with "a burst download is already in progress".
   */
  private async readRemoteFilePrefixUnlocked(
    path: string,
    byteLimit: number,
    options: { timeoutMs?: number } = {}
  ): Promise<Uint8Array> {
    if (!Number.isFinite(byteLimit) || byteLimit <= 0) {
      return new Uint8Array(0)
    }
    return this.readRemoteFileUnlocked(path, { ...options, byteLimit })
  }

  private async readRemoteFileUnlocked(
    path: string,
    options: { timeoutMs?: number; byteLimit?: number } = {}
  ): Promise<Uint8Array> {
    const { timeoutMs, byteLimit } = options
    const normalizedPath = normalizeMavftpPath(path)
    const pathBytes = new TextEncoder().encode(normalizedPath)
    await this.clearStaleSessionsOnce(timeoutMs)
    const openResponse = await this.openFileForRead(pathBytes, timeoutMs)

    const session = openResponse.session
    // Size the FC declared on OPEN; 0 for `@SYS` virtual files, which are
    // read until the EOF NAK rather than this value.
    const declaredSize = openResponse.data.byteLength >= 4
      ? new DataView(openResponse.data.buffer, openResponse.data.byteOffset, openResponse.data.byteLength).getUint32(0, true)
      : 0
    const chunks: Uint8Array[] = []
    let offset = 0

    try {
      for (;;) {
        // A caller-supplied limit outranks the declared size in BOTH
        // directions: it stops a read early on a file the FC over-reports (a
        // `@SYS` region), and it is the only stopping rule at all when the FC
        // reports no size.
        if (byteLimit !== undefined && offset >= byteLimit) {
          break
        }
        // A known nonzero size lets a normal file stop without a
        // trailing EOF round-trip; @SYS files (size 0) never take this
        // branch and are bounded only by the EOF NAK + the safety cap.
        if (byteLimit === undefined && declaredSize > 0 && offset >= declaredSize) {
          break
        }
        if (offset >= MAX_MAVFTP_FILE_BYTES) {
          throw new Error(
            `MAVFTP read exceeded the ${MAX_MAVFTP_FILE_BYTES}-byte cap (no EOF from the vehicle).`
          )
        }
        // Remaining bytes we are still willing to accept, so the last chunk of
        // a bounded read never overshoots the limit the caller asked for.
        const remaining =
          byteLimit !== undefined
            ? byteLimit - offset
            : declaredSize > 0
              ? declaredSize - offset
              : undefined
        const chunkSize =
          remaining !== undefined
            ? Math.min(MAVFTP_TRANSFER_CHUNK_SIZE, remaining)
            : MAVFTP_TRANSFER_CHUNK_SIZE
        let response: MavftpPayload
        try {
          response = await this.send(
            {
              session,
              opcode: MAV_FTP_OPCODE.READ_FILE,
              size: chunkSize,
              offset,
              data: new Uint8Array(0)
            },
            timeoutMs
          )
        } catch (error) {
          // An EOF NAK is the clean end-of-file for size-unknown reads;
          // anything else is a real failure and propagates.
          if (error instanceof MavftpRequestError && error.errorCode === MAV_FTP_ERR.EOF) {
            break
          }
          throw error
        }
        if (response.data.length === 0) {
          break
        }
        chunks.push(response.data)
        offset += response.data.length
      }
    } finally {
      await this.send({
        session,
        opcode: MAV_FTP_OPCODE.TERMINATE_SESSION,
        size: 0,
        offset: 0,
        data: new Uint8Array(0)
      }).catch(() => {})
    }

    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
    const bytes = new Uint8Array(totalLength)
    let writeOffset = 0
    chunks.forEach((chunk) => {
      bytes.set(chunk, writeOffset)
      writeOffset += chunk.length
    })
    return bytes
  }

  /**
   * Download a regular file via BURST_READ_FILE — the server streams many
   * data packets per request instead of the single-chunk-per-round-trip
   * READ_FILE loop, which is what makes large files (onboard dataflash logs)
   * practical over MAVFTP. Requires a vehicle-declared size; falls back to
   * the single-read path for size-0 `@SYS` virtual files. Reports progress by
   * contiguous bytes received, like LogDownloadService.
   */
  private async downloadRemoteFileBurstUnlocked(
    path: string,
    options: {
      timeoutMs?: number
      maxBytes?: number
      onProgress?: (progress: LogDownloadProgress) => void
      /**
       * Cancels an in-flight burst.
       *
       * Exists for BACKGROUND reads. A burst holds the single activeBurst slot
       * for its whole duration and a second one throws, so an uncancellable
       * multi-megabyte read in the background would make an operator's own
       * download fail while they waited on it. With a signal the background
       * work can stand down instead.
       *
       * Aborting rejects through the normal failure path, so the session is
       * still terminated by the caller's finally — the flight controller is
       * never left streaming into a dead operation.
       */
      signal?: AbortSignal
    } = {}
  ): Promise<Uint8Array> {
    await this.ensureSupport()
    if (options.signal?.aborted) {
      // Checked before opening a session so an already-cancelled request costs
      // the flight controller nothing at all.
      throw new MavftpAbortError()
    }
    if (this.activeBurst) {
      throw new Error('A MAVFTP burst download is already in progress.')
    }

    const normalizedPath = normalizeMavftpPath(path)
    const pathBytes = new TextEncoder().encode(normalizedPath)
    const { timeoutMs } = options
    const maxBytes = options.maxBytes ?? MAX_MAVFTP_FILE_BYTES
    await this.clearStaleSessionsOnce()

    const openResponse = await this.openFileForRead(pathBytes, timeoutMs)
    const session = openResponse.session
    const declaredSize =
      openResponse.data.byteLength >= 4
        ? new DataView(
            openResponse.data.buffer,
            openResponse.data.byteOffset,
            openResponse.data.byteLength
          ).getUint32(0, true)
        : 0

    // Burst needs a known size to preallocate and detect completion; the
    // single-read path already handles size-0 `@SYS` files (read-to-EOF).
    if (declaredSize <= 0) {
      await this.terminateSession(session)
      return this.readRemoteFile(normalizedPath, { timeoutMs })
    }
    if (declaredSize > maxBytes) {
      await this.terminateSession(session)
      throw new Error(
        `MAVFTP file size ${declaredSize} bytes exceeds the ${maxBytes}-byte cap; refusing to allocate.`
      )
    }

    try {
      return await this.runBurst(session, declaredSize, timeoutMs, options.onProgress, options.signal)
    } finally {
      await this.terminateSession(session)
    }
  }

  handleFileTransferProtocol(message: FileTransferProtocolMessage): void {
    const payload = decodeMavftpPayload(message.payload)
    // Every reply — burst packet or not — carries the server's current
    // seq_number, so track it before doing anything else with the payload.
    this.adoptServerSequence(payload.seqNumber)
    // A burst download receives a stream of packets (each with its own
    // seq_number) for a single request, so it can't use the one-waiter-per-
    // seq correlation; route burst responses to the active burst op instead.
    if (this.activeBurst && payload.reqOpcode === MAV_FTP_OPCODE.BURST_READ_FILE) {
      this.handleBurstPacket(payload)
      return
    }
    this.resolveWaiters(payload)
  }

  cancelAll(error: Error): void {
    this.failBurst(error)
    this.waiters.forEach((waiter) => {
      clearTimeout(waiter.timer)
      waiter.reject(error)
    })
    this.waiters.clear()
    // A link drop may leak a server-side session; clear again on next use.
    this.staleSessionsCleared = false
  }

  private runBurst(
    session: number,
    declaredSize: number,
    timeoutMs: number | undefined,
    onProgress?: (progress: LogDownloadProgress) => void,
    signal?: AbortSignal
  ): Promise<Uint8Array> {
    const effectiveTimeoutMs = timeoutMs ?? DEFAULT_MAVFTP_BURST_TIMEOUT_MS
    return new Promise<Uint8Array>((resolve, reject) => {
      const op: BurstOperation = {
        session,
        declaredSize,
        buffer: new Uint8Array(declaredSize),
        received: 0,
        highWater: 0,
        retries: 0,
        timeoutMs: effectiveTimeoutMs,
        onProgress,
        resolve,
        reject,
        timer: setTimeout(() => this.onBurstTimeout(), effectiveTimeoutMs)
      }
      // Abort routes through failBurst, the SAME path a timeout takes, so
      // cancellation cannot leave the service in a state the normal failure
      // path does not already handle.
      if (signal) {
        const onAbort = (): void => this.failBurst(new MavftpAbortError())
        signal.addEventListener('abort', onAbort, { once: true })
        // Detached however the op ends — resolve, reject or abort — so a long
        // session cannot accumulate listeners on a shared signal.
        op.cleanup = () => signal.removeEventListener('abort', onAbort)
      }
      this.activeBurst = op
      this.sendBurstReadRequest(op, 0)
    })
  }

  private sendBurstReadRequest(op: BurstOperation, offset: number): void {
    const vehicle = this.getVehicle()
    if (!vehicle) {
      this.failBurst(new Error('MAVFTP requires an identified vehicle.'))
      return
    }
    const requestSeq = this.nextSequence()
    void this.session
      .send({
        type: 'FILE_TRANSFER_PROTOCOL',
        targetNetwork: 0,
        targetSystem: vehicle.systemId,
        targetComponent: vehicle.componentId,
        payload: encodeMavftpPayload({
          seqNumber: requestSeq,
          session: op.session,
          opcode: MAV_FTP_OPCODE.BURST_READ_FILE,
          size: MAVFTP_BURST_READ_SIZE,
          reqOpcode: 0,
          burstComplete: 0,
          offset,
          data: new Uint8Array(0)
        })
      })
      .catch((error) => this.failBurst(this.asError(error)))
  }

  private handleBurstPacket(payload: MavftpPayload): void {
    const op = this.activeBurst
    if (!op) {
      return
    }

    if (payload.opcode === MAV_FTP_OPCODE.NAK) {
      const errorCode = payload.data[0] ?? 0
      if (errorCode === MAV_FTP_ERR.EOF) {
        // EOF = the server has no data past the last offset it read. If our
        // contiguous frontier already covers everything we've seen, the file is
        // exactly `received` bytes (the vehicle over-reported declaredSize) —
        // done. But if a dropped packet left a hole BELOW the high-water mark,
        // EOF means we're missing middle data: re-request from the frontier to
        // fill the gap rather than silently returning a truncated log.
        if (op.received >= op.highWater) {
          this.finishBurst(op)
          return
        }
        if (op.retries < MAX_MAVFTP_BURST_RETRIES) {
          op.retries += 1
          this.bumpBurstTimer(op)
          this.sendBurstReadRequest(op, op.received)
          return
        }
        this.failBurst(
          new Error(
            `MAVFTP burst left a gap at ${op.received}/${op.declaredSize} bytes after ${MAX_MAVFTP_BURST_RETRIES} retries.`
          )
        )
        return
      }
      this.failBurst(new MavftpRequestError(errorCode, payload.data[1]))
      return
    }

    this.bumpBurstTimer(op)

    const data = payload.data
    let writable = 0
    if (payload.offset < op.declaredSize && data.length > 0) {
      writable = Math.min(data.length, op.declaredSize - payload.offset)
      // Place at the true offset so an out-of-order packet still lands
      // correctly for a later contiguous fill.
      op.buffer.set(data.subarray(0, writable), payload.offset)
      op.highWater = Math.max(op.highWater, payload.offset + writable)
    }

    // Advance the contiguous frontier only when this packet starts at or
    // before it (no hole). A dropped middle packet leaves `received` at the
    // gap, so completion can't fire across it and the next burst re-requests
    // from the true frontier.
    const contiguous = payload.offset <= op.received && payload.offset < op.declaredSize
    if (contiguous) {
      const before = op.received
      op.received = Math.max(op.received, payload.offset + writable)
      if (op.received > before) {
        // Forward progress — this stall (if any) recovered, so refund the
        // retry budget. Otherwise a long download over a lossy link would
        // accumulate isolated stalls and fail mid-transfer.
        op.retries = 0
        op.onProgress?.({ bytesReceived: op.received, totalBytes: op.declaredSize })
      }
    }

    if (op.received >= op.declaredSize) {
      this.finishBurst(op)
      return
    }

    // The server finished a burst segment (last packet for this request).
    // Request the next burst from the contiguous frontier — which also
    // recovers any hole a dropped packet left behind.
    if (payload.burstComplete) {
      this.sendBurstReadRequest(op, op.received)
    }
  }

  private onBurstTimeout(): void {
    const op = this.activeBurst
    if (!op) {
      return
    }
    if (op.retries < MAX_MAVFTP_BURST_RETRIES) {
      op.retries += 1
      op.timer = setTimeout(() => this.onBurstTimeout(), op.timeoutMs)
      this.sendBurstReadRequest(op, op.received)
      return
    }
    this.failBurst(
      new Error(
        `No MAVFTP burst data arrived after ${op.timeoutMs}ms and ${MAX_MAVFTP_BURST_RETRIES} retries.`
      )
    )
  }

  private bumpBurstTimer(op: BurstOperation): void {
    clearTimeout(op.timer)
    op.timer = setTimeout(() => this.onBurstTimeout(), op.timeoutMs)
  }

  private finishBurst(op: BurstOperation): void {
    if (this.activeBurst !== op) {
      return
    }
    clearTimeout(op.timer)
    op.cleanup?.()
    this.activeBurst = undefined
    const bytes = op.received >= op.declaredSize ? op.buffer : op.buffer.slice(0, op.received)
    op.resolve(bytes)
  }

  private failBurst(error: Error): void {
    const op = this.activeBurst
    if (!op) {
      return
    }
    clearTimeout(op.timer)
    op.cleanup?.()
    this.activeBurst = undefined
    // Hand back whatever arrived. `received` is the contiguous frontier, so the
    // prefix is hole-free; the caller decides whether a partial file is worth
    // anything, but it cannot decide that if we drop it here.
    if (op.received > 0) {
      attachPartialTransfer(error, {
        bytes: op.buffer.slice(0, op.received),
        declaredSize: op.declaredSize
      })
    }
    op.reject(error)
  }

  private async terminateSession(session: number): Promise<void> {
    await this.send({
      session,
      opcode: MAV_FTP_OPCODE.TERMINATE_SESSION,
      size: 0,
      offset: 0,
      data: new Uint8Array(0)
    }).catch(() => {})
  }

  /**
   * Take the seq_number for the next request and advance the counter.
   *
   * Nothing here is new bookkeeping — it is the same `sequence++` the send
   * paths used to do inline — but routing BOTH senders through one place is
   * what lets adoptServerSequence's catch-up apply to burst re-requests as
   * well as ordinary requests.
   */
  private nextSequence(): number {
    const requestSeq = this.sequence
    this.sequence = (this.sequence + 1) & 0xffff
    return requestSeq
  }

  /**
   * Keep our seq_number at or ahead of the server's.
   *
   * ArduPilot treats a request as a DUPLICATE — replaying its last reply
   * instead of executing the request — when `request.seq_number + 1 ==
   * reply.seq_number` for the same session (GCS_FTP.cpp:823-829). A burst read
   * costs us one seq but costs the server one PER STREAMED PACKET, so after a
   * burst our counter sits below the server's and the next request we send can
   * land exactly on that equality by accident.
   *
   * It is not a rare accident. A file that fits in a single burst packet leaves
   * the server exactly two ahead, which is precisely the offset that makes our
   * follow-up TerminateSession look like a re-request of the burst's EOF NAK.
   * The close is swallowed, the descriptor stays open, and because ArduPilot
   * allows only one open file per session (GCS_FTP.cpp:341-352) the NEXT open
   * is refused with Fail until the server's 3s idle sweep reclaims it. Large
   * logs never showed this — they take far longer than 3s — but two small
   * files back to back fail every time.
   *
   * Adopting the server's seq also stops a late burst packet from satisfying
   * the waiter for a subsequent request that happened to reuse its seq.
   *
   * Wrap-safe: seq_number is 16-bit, so "ahead" is a signed comparison on the
   * 16-bit difference rather than a plain `>`.
   */
  private adoptServerSequence(serverSeq: number): void {
    const normalized = serverSeq & 0xffff
    if (((normalized - this.sequence) & 0xffff) < 0x8000) {
      // The server's own reply seq is a value it has already USED, so sending
      // our next request with that same number keeps `request + 1` clear of it
      // while still being the smallest step that does.
      this.sequence = normalized
    }
  }

  private asError(error: unknown): Error {
    return error instanceof Error ? error : new Error('Unknown MAVFTP burst error.')
  }

  /**
   * OPEN_FILE_RO, retried once through RESET_SESSIONS on a bare `Fail` NAK.
   *
   * ArduPilot answers OpenFileRO with plain `Fail` in exactly one case: a
   * descriptor is still open on this session and it has not yet gone idle long
   * enough for the server to reclaim it (GCS_FTP.cpp:341-352 — a malformed
   * request gets InvalidDataSize and a missing file gets FailErrno/FileNotFound
   * instead). That is a TRANSIENT condition, so failing the caller's download
   * outright is the wrong answer even though the sequence-number fix above
   * should stop us from ever creating it.
   *
   * RESET_SESSIONS is the recovery to reach for rather than another
   * TerminateSession: the server handles it at the top of its worker loop and
   * force-closes every session on our channel BEFORE reaching the duplicate-
   * request check (GCS_FTP.cpp:760-777), so unlike a close it cannot itself be
   * swallowed as a replay — which is the failure we are recovering from.
   *
   * Exactly one retry. If a fresh open still fails with a descriptor we just
   * ordered closed, something other than a leaked handle is wrong and the
   * caller deserves the error rather than a retry loop against a live vehicle.
   */
  private async openFileForRead(pathBytes: Uint8Array, timeoutMs?: number): Promise<MavftpPayload> {
    const request = {
      session: 0,
      opcode: MAV_FTP_OPCODE.OPEN_FILE_RO,
      size: pathBytes.length,
      offset: 0,
      data: pathBytes
    }

    try {
      return await this.send(request, timeoutMs)
    } catch (error) {
      if (!(error instanceof MavftpRequestError) || error.errorCode !== MAV_FTP_ERR.FAIL) {
        throw error
      }
      await this.resetSessions().catch(() => {})
      return this.send(request, timeoutMs)
    }
  }

  /**
   * Best-effort one-shot RESET_SESSIONS — see staleSessionsCleared field doc.
   */
  private async clearStaleSessionsOnce(timeoutMs?: number): Promise<void> {
    if (this.staleSessionsCleared) {
      return
    }
    this.staleSessionsCleared = true
    try {
      await this.resetSessions(timeoutMs)
    } catch {
      // Best-effort: a NAK / timeout here must not block the actual
      // operation — worst case a stale session NAKs the open and
      // ArduPilot's idle sweep eventually reclaims it.
    }
  }

  /**
   * RESET_SESSIONS — closes every server-side session on our link.
   *
   * Takes the caller's timeout. Without it this preamble always used the 5s
   * constructor default, so a caller asking for a 60ms budget silently waited
   * 5s before its own request even went out — invisible in production and
   * responsible for a 10s unit test that thought it was measuring 60ms.
   */
  private async resetSessions(timeoutMs?: number): Promise<void> {
    await this.send({
      session: 0,
      opcode: MAV_FTP_OPCODE.RESET_SESSIONS,
      size: 0,
      offset: 0,
      data: new Uint8Array(0)
    }, timeoutMs)
  }

  private async send(
    request: Pick<MavftpPayload, 'session' | 'opcode' | 'size' | 'offset' | 'data'>,
    timeoutMs?: number
  ): Promise<MavftpPayload> {
    const vehicle = this.getVehicle()
    if (!vehicle) {
      throw new Error('MAVFTP requires an identified vehicle.')
    }

    this.lastTransferActivityAtMs = Date.now()

    const requestSeq = this.nextSequence()
    // The MAVLink FTP server replies with `seq_number = request seq + 1`,
    // so correlate the waiter to the expected response seq.
    const expectedResponseSeq = (requestSeq + 1) & 0xffff
    const waiter = this.waitForResponse(expectedResponseSeq, timeoutMs)

    try {
      await this.session.send({
        type: 'FILE_TRANSFER_PROTOCOL',
        targetNetwork: 0,
        targetSystem: vehicle.systemId,
        targetComponent: vehicle.componentId,
        payload: encodeMavftpPayload({
          seqNumber: requestSeq,
          session: request.session,
          opcode: request.opcode,
          size: request.size,
          reqOpcode: 0,
          burstComplete: 0,
          offset: request.offset,
          data: request.data
        })
      })
    } catch (error) {
      const sendError = error instanceof Error ? error : new Error('Unknown MAVFTP send error.')
      waiter.cancel(sendError)
      void waiter.promise.catch(() => {})
      throw sendError
    }

    const response = await waiter.promise
    if (response.opcode === MAV_FTP_OPCODE.ACK) {
      return response
    }

    const errorCode = response.data[0] ?? 0
    const errno = response.data[1]
    throw new MavftpRequestError(errorCode, errno)
  }

  // `expectedSeqNumber` is the seq the server will put on its reply
  // (request seq + 1), so `resolveWaiters` can stay a simple equality.
  private waitForResponse(expectedSeqNumber: number, timeoutMs?: number): MavftpWaiterHandle {
    const effectiveTimeoutMs = timeoutMs ?? this.requestTimeoutMs
    let cancel = (_error: Error) => {}
    const promise = new Promise<MavftpPayload>((resolve, reject) => {
      let settled = false
      const waiter: MavftpWaiter = {
        seqNumber: expectedSeqNumber,
        resolve: (payload) => {
          settled = true
          clearTimeout(timer)
          resolve(payload)
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
        this.waiters.delete(waiter)
        reject(new Error(`Timed out waiting for MAVFTP response after ${effectiveTimeoutMs}ms.`))
      }, effectiveTimeoutMs)

      waiter.timer = timer
      this.waiters.add(waiter)

      cancel = (error: Error) => {
        if (settled) {
          return
        }

        settled = true
        clearTimeout(timer)
        this.waiters.delete(waiter)
        reject(error)
      }
    })

    return {
      seqNumber: expectedSeqNumber,
      promise,
      cancel
    }
  }

  private resolveWaiters(payload: MavftpPayload): void {
    const waiters = [...this.waiters].filter((waiter) => waiter.seqNumber === payload.seqNumber)
    waiters.forEach((waiter) => {
      clearTimeout(waiter.timer)
      this.waiters.delete(waiter)
      waiter.resolve(payload)
    })
  }
}
