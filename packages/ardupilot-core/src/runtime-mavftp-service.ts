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
import { sortMavftpDirectoryEntries } from './runtime-helpers.js'
import type { VehicleIdentity } from './types.js'

const DEFAULT_MAVFTP_TIMEOUT_MS = 3000
const MAVFTP_TRANSFER_CHUNK_SIZE = 200
// ArduPilot `@SYS` virtual files report size 0 on OPEN_FILE_RO and are read
// until the server's EOF NAK; this cap bounds that read so a FC that never
// sends EOF can't loop forever.
const MAX_MAVFTP_FILE_BYTES = 16 * 1024 * 1024

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

  handleFileTransferProtocol(message: FileTransferProtocolMessage): void {
    const payload = decodeMavftpPayload(message.payload)
    this.resolveWaiters(payload)
  }

  cancelAll(error: Error): void {
    this.waiters.forEach((waiter) => {
      clearTimeout(waiter.timer)
      waiter.reject(error)
    })
    this.waiters.clear()
    // A link drop may leak a server-side session; clear again on next use.
    this.staleSessionsCleared = false
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
