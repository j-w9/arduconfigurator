// DroneCAN transfers from raw CAN frames, decoded through the catalogue.
//
// The bus monitor sees frames; people want messages. This reassembles the
// frames of each transfer (one frame, or several with a CRC), checks the CRC
// against the type's signature, and decodes the payload -- for every type in
// the bundled DSDL, not just the handful the runtime acts on.
//
// CAN id layout (DroneCAN / UAVCAN v0, 29-bit):
//   priority 24..28 | service flag 7 | source node 0..6
//   message:   type id 8..23   (anonymous, source 0: type id low 2 bits at 8..9)
//   service:   type id 16..23, request flag 15, destination node 8..14
// Tail byte (last data byte): SOT 0x80, EOT 0x40, toggle 0x20, transfer id 0x1F.

import type { CanFrame } from '@arduconfig/can-core'

import type { DronecanCatalogue, DronecanTypeInfo } from './catalogue.js'
import type { DronecanValue } from './types.js'

export type DronecanTransferKind = 'message' | 'anonymous' | 'request' | 'response'

export interface DronecanTransfer {
  bus: number
  kind: DronecanTransferKind
  priority: number
  dataTypeId: number
  sourceNodeId: number
  destinationNodeId?: number
  transferId: number
  /** Capture sequence numbers of the frames that made it, first to last. */
  frameSeqs: number[]
  /** Time of the last frame. */
  timestampMs: number
  direction: CanFrame['direction']
  /** Reassembled payload, CRC removed. */
  payload: Uint8Array
  /** The DSDL type, when this build knows the id. */
  type?: DronecanTypeInfo
  /** Decoded fields, when the type is known and the payload decoded. */
  value?: { [field: string]: DronecanValue }
  /** Why there is no value: unknown type, CRC mismatch, decode failure. */
  problem?: string
}

/** DroneCAN's transfer timeout: a transfer not finished within this is dropped. */
const TRANSFER_TIMEOUT_MS = 2000

interface Partial {
  frames: CanFrame[]
  bytes: number[]
  expectedToggle: boolean
  startedAtMs: number
  crc?: number
}

/** CRC-16-CCITT-FALSE (poly 0x1021, init 0xFFFF), continued over `bytes`. */
export function dronecanCrc16(bytes: ArrayLike<number>, initial = 0xffff): number {
  let crc = initial
  for (let index = 0; index < bytes.length; index += 1) {
    crc ^= (bytes[index] & 0xff) << 8
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff
    }
  }
  return crc
}

/** The multi-frame transfer CRC: over the signature (little-endian), then the payload. */
export function dronecanTransferCrc(signature: bigint, payload: ArrayLike<number>): number {
  const signatureBytes: number[] = []
  for (let index = 0; index < 8; index += 1) signatureBytes.push(Number((signature >> BigInt(8 * index)) & 0xffn))
  return dronecanCrc16(payload, dronecanCrc16(signatureBytes))
}

export class DronecanTransferDecoder {
  private readonly partials = new Map<string, Partial>()

  constructor(private readonly catalogue: DronecanCatalogue) {}

  /**
   * Feed one frame. Returns the transfer it completes, if any. Frames that
   * cannot be DroneCAN (standard id, remote, error, empty) are ignored.
   */
  push(frame: CanFrame): DronecanTransfer | undefined {
    if (!frame.extended || frame.rtr || frame.error || frame.data.length === 0) return undefined
    const id = frame.id
    const tail = frame.data[frame.data.length - 1]
    const sot = (tail & 0x80) !== 0
    const eot = (tail & 0x40) !== 0
    const toggle = (tail & 0x20) !== 0
    const transferId = tail & 0x1f
    const header = parseId(id)
    const key = `${frame.bus}:${frame.direction}:${header.kind}:${header.dataTypeId}:${header.sourceNodeId}:${header.destinationNodeId ?? '-'}:${transferId}`
    const body = Array.from(frame.data.subarray(0, frame.data.length - 1))

    this.expire(frame.timestampMs)

    if (sot && eot) {
      if (toggle) return undefined // a single-frame transfer starts with toggle 0
      return this.finish(header, frame, [frame], Uint8Array.from(body), transferId, undefined)
    }
    if (sot) {
      if (toggle || body.length < 2) return undefined
      this.partials.set(key, {
        frames: [frame],
        bytes: body.slice(2),
        expectedToggle: true,
        startedAtMs: frame.timestampMs,
        crc: body[0] | (body[1] << 8)
      })
      return undefined
    }
    const partial = this.partials.get(key)
    if (!partial || partial.expectedToggle !== toggle) {
      // A middle frame of a transfer we never saw start, or out of order.
      if (partial) this.partials.delete(key)
      return undefined
    }
    partial.frames.push(frame)
    partial.bytes.push(...body)
    partial.expectedToggle = !partial.expectedToggle
    if (!eot) return undefined
    this.partials.delete(key)
    return this.finish(header, frame, partial.frames, Uint8Array.from(partial.bytes), transferId, partial.crc)
  }

  reset(): void {
    this.partials.clear()
  }

  private expire(nowMs: number): void {
    if (this.partials.size === 0) return
    for (const [key, partial] of this.partials) {
      if (nowMs - partial.startedAtMs > TRANSFER_TIMEOUT_MS) this.partials.delete(key)
    }
  }

  private finish(
    header: ParsedId,
    last: CanFrame,
    frames: CanFrame[],
    payload: Uint8Array,
    transferId: number,
    crc: number | undefined
  ): DronecanTransfer {
    const transfer: DronecanTransfer = {
      bus: last.bus,
      kind: header.kind,
      priority: header.priority,
      dataTypeId: header.dataTypeId,
      sourceNodeId: header.sourceNodeId,
      destinationNodeId: header.destinationNodeId,
      transferId,
      frameSeqs: frames.map((entry) => entry.seq),
      timestampMs: last.timestampMs,
      direction: last.direction,
      payload
    }
    if (header.kind === 'anonymous') {
      transfer.problem = 'Anonymous message: the full type id is not in the frame.'
      return transfer
    }
    const type =
      header.kind === 'message' ? this.catalogue.messageById(header.dataTypeId) : this.catalogue.serviceById(header.dataTypeId)
    if (!type) {
      transfer.problem = `Type ${header.dataTypeId} is not in this build's DSDL.`
      return transfer
    }
    transfer.type = type
    if (crc !== undefined && dronecanTransferCrc(type.signature, payload) !== crc) {
      transfer.problem = 'Transfer CRC does not match this type: a different type sharing the id, or a corrupted transfer.'
      return transfer
    }
    try {
      const section = header.kind === 'message' ? 'msg' : header.kind === 'request' ? 'req' : 'res'
      // TAO is used on classic CAN and not on CAN FD.
      transfer.value = this.catalogue.decode(type.fullName, section, payload, { tao: !last.fd })
    } catch (error) {
      transfer.problem = `Could not decode as ${type.fullName}: ${error instanceof Error ? error.message : String(error)}`
    }
    return transfer
  }
}

interface ParsedId {
  kind: DronecanTransferKind
  priority: number
  dataTypeId: number
  sourceNodeId: number
  destinationNodeId?: number
}

function parseId(id: number): ParsedId {
  const priority = (id >>> 24) & 0x1f
  const sourceNodeId = id & 0x7f
  if ((id >>> 7) & 1) {
    return {
      kind: (id >>> 15) & 1 ? 'request' : 'response',
      priority,
      dataTypeId: (id >>> 16) & 0xff,
      sourceNodeId,
      destinationNodeId: (id >>> 8) & 0x7f
    }
  }
  if (sourceNodeId === 0) {
    return { kind: 'anonymous', priority, dataTypeId: (id >>> 8) & 0x3, sourceNodeId }
  }
  return { kind: 'message', priority, dataTypeId: (id >>> 8) & 0xffff, sourceNodeId }
}
