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
// Per-packet inactivity budget for a burst download — a dead-link safety
// net, not a throughput SLA. Same rationale as the LOG_* dataflash timeout:
// a healthy-but-slow or contended link can legitimately pause between
// packets, so keep this generous.
const DEFAULT_MAVFTP_BURST_TIMEOUT_MS = 20000
// Stall retries per burst download; each re-issues BURST_READ_FILE from the
// contiguous frontier after a full inactivity window.
const MAX_MAVFTP_BURST_RETRIES = 3

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

interface BurstOperation {
  session: number
  declaredSize: number
  buffer: Uint8Array
  // Contiguous frontier — bytes [0, received) are all present — NOT a
  // high-water mark. A dropped middle packet must leave this at the gap so
  // completion can't fire across a hole; see handleBurstPacket (and the same
  // reasoning in LogDownloadService).
  received: number
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

  async listRemoteDirectory(path: string): Promise<MavftpDirectoryEntry[]> {
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

  async downloadRemoteFile(path: string): Promise<Uint8Array> {
    await this.ensureSupport()
    return this.readRemoteFile(normalizeMavftpPath(path))
  }

  async uploadRemoteFile(path: string, bytes: Uint8Array, options: { overwrite?: boolean } = {}): Promise<void> {
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

  async deleteRemotePath(path: string, kind: 'file' | 'directory' = 'file'): Promise<void> {
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

  async readRemoteTextFile(path: string, options: { timeoutMs?: number } = {}): Promise<string> {
    const bytes = await this.readRemoteFile(path, options)
    return new TextDecoder().decode(bytes).replace(/\0+$/, '')
  }

  async readRemoteFile(path: string, options: { timeoutMs?: number } = {}): Promise<Uint8Array> {
    const { timeoutMs } = options
    const normalizedPath = normalizeMavftpPath(path)
    const pathBytes = new TextEncoder().encode(normalizedPath)
    await this.clearStaleSessionsOnce()
    const openResponse = await this.send(
      {
        session: 0,
        opcode: MAV_FTP_OPCODE.OPEN_FILE_RO,
        size: pathBytes.length,
        offset: 0,
        data: pathBytes
      },
      timeoutMs
    )

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
        // A known nonzero size lets a normal file stop without a
        // trailing EOF round-trip; @SYS files (size 0) never take this
        // branch and are bounded only by the EOF NAK + the safety cap.
        if (declaredSize > 0 && offset >= declaredSize) {
          break
        }
        if (offset >= MAX_MAVFTP_FILE_BYTES) {
          throw new Error(
            `MAVFTP read exceeded the ${MAX_MAVFTP_FILE_BYTES}-byte cap (no EOF from the vehicle).`
          )
        }
        const chunkSize =
          declaredSize > 0
            ? Math.min(MAVFTP_TRANSFER_CHUNK_SIZE, declaredSize - offset)
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
  async downloadRemoteFileBurst(
    path: string,
    options: {
      timeoutMs?: number
      maxBytes?: number
      onProgress?: (progress: LogDownloadProgress) => void
    } = {}
  ): Promise<Uint8Array> {
    await this.ensureSupport()
    if (this.activeBurst) {
      throw new Error('A MAVFTP burst download is already in progress.')
    }

    const normalizedPath = normalizeMavftpPath(path)
    const pathBytes = new TextEncoder().encode(normalizedPath)
    const { timeoutMs } = options
    const maxBytes = options.maxBytes ?? MAX_MAVFTP_FILE_BYTES
    await this.clearStaleSessionsOnce()

    const openResponse = await this.send(
      {
        session: 0,
        opcode: MAV_FTP_OPCODE.OPEN_FILE_RO,
        size: pathBytes.length,
        offset: 0,
        data: pathBytes
      },
      timeoutMs
    )
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
      return await this.runBurst(session, declaredSize, timeoutMs, options.onProgress)
    } finally {
      await this.terminateSession(session)
    }
  }

  handleFileTransferProtocol(message: FileTransferProtocolMessage): void {
    const payload = decodeMavftpPayload(message.payload)
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
    onProgress?: (progress: LogDownloadProgress) => void
  ): Promise<Uint8Array> {
    const effectiveTimeoutMs = timeoutMs ?? DEFAULT_MAVFTP_BURST_TIMEOUT_MS
    return new Promise<Uint8Array>((resolve, reject) => {
      const op: BurstOperation = {
        session,
        declaredSize,
        buffer: new Uint8Array(declaredSize),
        received: 0,
        retries: 0,
        timeoutMs: effectiveTimeoutMs,
        onProgress,
        resolve,
        reject,
        timer: setTimeout(() => this.onBurstTimeout(), effectiveTimeoutMs)
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
    const requestSeq = this.sequence
    this.sequence = (this.sequence + 1) & 0xffff
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
      // EOF means the server has no data past the offset we asked for. Because
      // `received` is a contiguous frontier (no holes below it), EOF here
      // means the file is exactly `received` bytes — the vehicle over-reported
      // declaredSize, the same benign case the LOG_* path tolerates.
      if (errorCode === MAV_FTP_ERR.EOF) {
        this.finishBurst(op)
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
    }

    // Advance the contiguous frontier only when this packet starts at or
    // before it (no hole). A dropped middle packet leaves `received` at the
    // gap, so completion can't fire across it and the next burst re-requests
    // from the true frontier.
    const contiguous = payload.offset <= op.received && payload.offset < op.declaredSize
    if (contiguous) {
      op.received = Math.max(op.received, payload.offset + writable)
      op.onProgress?.({ bytesReceived: op.received, totalBytes: op.declaredSize })
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
    this.activeBurst = undefined
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

  private asError(error: unknown): Error {
    return error instanceof Error ? error : new Error('Unknown MAVFTP burst error.')
  }

  /**
   * Best-effort one-shot RESET_SESSIONS — see staleSessionsCleared field doc.
   */
  private async clearStaleSessionsOnce(): Promise<void> {
    if (this.staleSessionsCleared) {
      return
    }
    this.staleSessionsCleared = true
    try {
      await this.send({
        session: 0,
        opcode: MAV_FTP_OPCODE.RESET_SESSIONS,
        size: 0,
        offset: 0,
        data: new Uint8Array(0)
      })
    } catch {
      // Best-effort: a NAK / timeout here must not block the actual
      // operation — worst case a stale session NAKs the open and
      // ArduPilot's idle sweep eventually reclaims it.
    }
  }

  private async send(
    request: Pick<MavftpPayload, 'session' | 'opcode' | 'size' | 'offset' | 'data'>,
    timeoutMs?: number
  ): Promise<MavftpPayload> {
    const vehicle = this.getVehicle()
    if (!vehicle) {
      throw new Error('MAVFTP requires an identified vehicle.')
    }

    const requestSeq = this.sequence
    this.sequence = (this.sequence + 1) & 0xffff
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
