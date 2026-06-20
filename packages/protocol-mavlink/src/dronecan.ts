// DroneCAN protocol decoders and frame-assembly helpers consumed by the
// configurator's CAN tab. Only the DSDL types we actually wire UI to are
// implemented here:
//
//   uavcan.protocol.NodeStatus           DT-id 341       (single frame)
//   uavcan.protocol.GetNodeInfo          service 1       (multi-frame resp)
//   uavcan.protocol.param.GetSet         service 11      (multi-frame req+resp)
//   uavcan.protocol.param.ExecuteOpcode  service 10      (single-frame req+resp)
//
// All wire details below come from the DroneCAN specification at
// https://dronecan.github.io/Specification/. CAN ID layout follows the
// 2017-era CAN-bus transport: 29-bit extended ID with priority, service /
// message marker, type id, dest node (for services), and source node.

// ---------------------------------------------------------------------------
// CAN ID + tail byte parsing
// ---------------------------------------------------------------------------

/** Source node id sits in bits 0-6 of the CAN ID. */
export function dronecanSourceNodeId(canId: number): number {
  return canId & 0x7f
}

/** Bit 7 of the CAN ID. 0 = broadcast message, 1 = service. */
export function dronecanIsServiceFrame(canId: number): boolean {
  return ((canId >> 7) & 0x1) === 1
}

/** Message Type ID (16 bits) for broadcast frames; bits 8-23 of the CAN ID. */
export function dronecanMessageTypeId(canId: number): number {
  return (canId >>> 8) & 0xffff
}

/** Service Type ID (8 bits) for service frames; bits 16-23 of the CAN ID. */
export function dronecanServiceTypeId(canId: number): number {
  return (canId >>> 16) & 0xff
}

/** Destination node id (7 bits) for service frames; bits 8-14 of the CAN ID. */
export function dronecanServiceDestinationNodeId(canId: number): number {
  return (canId >>> 8) & 0x7f
}

/** Bit 15 of the CAN ID for service frames. 1 = request, 0 = response. */
export function dronecanIsServiceRequest(canId: number): boolean {
  return ((canId >> 15) & 0x1) === 1
}

export interface DronecanTailByte {
  /** Start of Transfer flag. True for the first (or only) frame. */
  sot: boolean
  /** End of Transfer flag. True for the last (or only) frame. */
  eot: boolean
  /** Toggle bit — alternates between middle frames of a multi-frame transfer. */
  toggle: boolean
  /** Transfer ID 0..31, identifies one multi-frame transfer. */
  transferId: number
}

/** Decode a DroneCAN tail byte (always the last byte of CAN frame payload). */
export function dronecanParseTailByte(tail: number): DronecanTailByte {
  return {
    sot: (tail & 0x80) !== 0,
    eot: (tail & 0x40) !== 0,
    toggle: (tail & 0x20) !== 0,
    transferId: tail & 0x1f
  }
}

/** Compose a DroneCAN tail byte. Used when synthesizing service requests. */
export function dronecanComposeTailByte(t: DronecanTailByte): number {
  return (
    (t.sot ? 0x80 : 0) |
    (t.eot ? 0x40 : 0) |
    (t.toggle ? 0x20 : 0) |
    (t.transferId & 0x1f)
  )
}

/** Encode the 29-bit extended CAN ID for a broadcast (message) frame.
 *  Bits 0-6 = source node, bit 7 = 0, bits 8-23 = msg type id,
 *  bit 24 = 0, bits 25-28 = priority. */
export function dronecanEncodeMessageCanId(
  priority: number,
  messageTypeId: number,
  sourceNodeId: number
): number {
  return (
    ((priority & 0x1f) << 24) |
    ((messageTypeId & 0xffff) << 8) |
    (sourceNodeId & 0x7f)
  )
}

/** Encode the 29-bit extended CAN ID for a service frame.
 *  Bits 0-6 = source node, bit 7 = 1, bits 8-14 = dest node,
 *  bit 15 = request flag, bits 16-23 = service type id,
 *  bit 24 = 0, bits 25-28 = priority. */
export function dronecanEncodeServiceCanId(
  priority: number,
  serviceTypeId: number,
  isRequest: boolean,
  destinationNodeId: number,
  sourceNodeId: number
): number {
  return (
    ((priority & 0x1f) << 24) |
    ((serviceTypeId & 0xff) << 16) |
    ((isRequest ? 1 : 0) << 15) |
    ((destinationNodeId & 0x7f) << 8) |
    0x80 |
    (sourceNodeId & 0x7f)
  )
}

// ---------------------------------------------------------------------------
// Multi-frame transfer assembly
// ---------------------------------------------------------------------------

/** CRC-16-CCITT-FALSE (poly 0x1021, init 0xFFFF). Used to validate
 *  multi-frame transfers; the first two bytes of the assembled payload
 *  must match CRC(DT signature LE + payload bytes excluding CRC). */
export function dronecanCrc16(bytes: Uint8Array, initial = 0xffff): number {
  let crc = initial
  for (let i = 0; i < bytes.length; i += 1) {
    crc ^= bytes[i] << 8
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 0x8000) !== 0 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff
    }
  }
  return crc & 0xffff
}

/** Compute the CRC seed for a payload by mixing in the data type
 *  signature first (DroneCAN uses the DT signature as the CRC initial
 *  state). The 8-byte signature is passed as a bigint. */
export function dronecanCrcWithSignature(signatureLe: bigint, payload: Uint8Array): number {
  const sig = new Uint8Array(8)
  for (let i = 0; i < 8; i += 1) {
    sig[i] = Number((signatureLe >> BigInt(8 * i)) & 0xffn)
  }
  let crc = dronecanCrc16(sig)
  crc = dronecanCrc16(payload, crc)
  return crc
}

/** Pending multi-frame transfer state. Keyed in the runtime by
 *  (source_node, transfer_id, type_kind). */
interface PartialTransfer {
  pieces: number[]
  expectedToggle: boolean
  framesSeen: number
}

export interface DronecanTransferContext {
  /** Source DroneCAN node id (1..127). */
  sourceNodeId: number
  /** True for service frames, false for broadcast. */
  isService: boolean
  /** Message type id (broadcast) or service type id (service). */
  typeId: number
  /** For service frames, true if this is a request, false if response. */
  isRequest?: boolean
  /** Transfer id 0..31. */
  transferId: number
}

export interface DronecanReassembledTransfer extends DronecanTransferContext {
  payload: Uint8Array
}

export interface DronecanReassemblerOptions {
  /** Provide the DT signature for the transfer to enable CRC verification
   *  on multi-frame transfers. Returning undefined means "skip CRC for
   *  this transfer" (single-frame transfers never include a CRC anyway). */
  getDataTypeSignature: (context: DronecanTransferContext) => bigint | undefined
  /** Optional callback for when a transfer fails CRC. Default = drop silently. */
  onCrcError?: (context: DronecanTransferContext) => void
}

/**
 * Hard cap on a single in-flight transfer's accumulated payload bytes.
 * Every DroneCAN type we reassemble (param.GetSet, GetNodeInfo,
 * NodeStatus) is well under ~130 bytes, so 1 KiB is far above any real
 * transfer while bounding memory: without this, a faulty or hostile node
 * on the forwarded bus could stream correctly-toggling middle frames that
 * never set EOT and grow `pieces` without limit.
 */
const MAX_REASSEMBLY_BYTES = 1024

/**
 * Assemble DroneCAN multi-frame transfers from individual CAN frames.
 * Pushes one frame at a time; returns a finalized transfer when EOT
 * arrives. Holds at most one partial transfer per (source, type, kind)
 * tuple, each capped at MAX_REASSEMBLY_BYTES, to keep memory bounded
 * against a glitching or hostile bus.
 */
export class DronecanReassembler {
  private readonly pending = new Map<string, PartialTransfer>()
  constructor(private readonly options: DronecanReassemblerOptions) {}

  private keyFor(context: DronecanTransferContext): string {
    return `${context.sourceNodeId}|${context.isService ? 's' : 'm'}|${context.typeId}|${context.isRequest ? 'q' : 'r'}|${context.transferId}`
  }

  /** Feed one CAN frame's payload. Returns a reassembled transfer when
   *  the EOT-marked frame arrives, else undefined. Single-frame transfers
   *  (SOT && EOT in one frame) return immediately. */
  push(context: DronecanTransferContext, framePayload: Uint8Array): DronecanReassembledTransfer | undefined {
    if (framePayload.length === 0) {
      return undefined
    }
    const tail = dronecanParseTailByte(framePayload[framePayload.length - 1])
    const dataBytes = framePayload.subarray(0, framePayload.length - 1)

    // Single-frame transfer: SOT && EOT, no CRC prefix.
    if (tail.sot && tail.eot) {
      return { ...context, payload: dataBytes.slice() }
    }

    const key = this.keyFor(context)

    if (tail.sot) {
      // Start of multi-frame. First two bytes are CRC over (DT sig + payload).
      // Reset any prior partial transfer for the same key (a previous one
      // never completed; trust the freshest start).
      this.pending.set(key, { pieces: Array.from(dataBytes), expectedToggle: true, framesSeen: 1 })
      return undefined
    }

    const partial = this.pending.get(key)
    if (!partial) {
      // Mid-frame without a start — drop it.
      return undefined
    }
    if (tail.toggle !== partial.expectedToggle) {
      // Toggle mismatch — transfer corrupt. Discard.
      this.pending.delete(key)
      return undefined
    }
    for (const byte of dataBytes) {
      partial.pieces.push(byte)
    }
    partial.expectedToggle = !partial.expectedToggle
    partial.framesSeen += 1

    // Runaway transfer (a node streaming middle frames that never set EOT):
    // drop it rather than let `pieces` grow unbounded. Treated as a corrupt
    // transfer so callers can surface it like any other reassembly failure.
    if (partial.pieces.length > MAX_REASSEMBLY_BYTES) {
      this.pending.delete(key)
      this.options.onCrcError?.(context)
      return undefined
    }

    if (!tail.eot) {
      return undefined
    }

    // EOT — finalize.
    this.pending.delete(key)
    if (partial.pieces.length < 2) {
      this.options.onCrcError?.(context)
      return undefined
    }
    const crcReceived = partial.pieces[0] | (partial.pieces[1] << 8)
    const payload = new Uint8Array(partial.pieces.slice(2))
    const signature = this.options.getDataTypeSignature(context)
    if (signature !== undefined) {
      const expected = dronecanCrcWithSignature(signature, payload)
      if (expected !== crcReceived) {
        this.options.onCrcError?.(context)
        return undefined
      }
    }
    return { ...context, payload }
  }

  /** Drop any partial transfers we're holding for the given source node
   *  (use when a node goes offline / staleness sweep). */
  forgetNode(nodeId: number): void {
    for (const key of Array.from(this.pending.keys())) {
      if (key.startsWith(`${nodeId}|`)) {
        this.pending.delete(key)
      }
    }
  }

  reset(): void {
    this.pending.clear()
  }
}

// ---------------------------------------------------------------------------
// DSDL decoders for the types we surface in the UI
// ---------------------------------------------------------------------------

// uavcan.protocol.NodeStatus (DT-id 341)
// Signature: 0x0F0868D0C1A7C6F1
//   uint32 uptime_sec
//   uint2  health
//   uint3  mode
//   uint3  sub_mode
//   uint16 vendor_specific_status_code
export const DRONECAN_NODE_STATUS_DT_ID = 341
export const DRONECAN_NODE_STATUS_SIGNATURE = 0x0f0868d0c1a7c6f1n

export interface DronecanNodeStatus {
  uptimeSec: number
  /** 0=OK, 1=WARNING, 2=ERROR, 3=CRITICAL. */
  health: number
  /** 0=OPERATIONAL, 1=INITIALIZATION, 2=MAINTENANCE, 3=SOFTWARE_UPDATE, 7=OFFLINE. */
  mode: number
  subMode: number
  vendorSpecificStatusCode: number
}

export function decodeDronecanNodeStatus(payload: Uint8Array): DronecanNodeStatus | undefined {
  if (payload.length < 7) {
    return undefined
  }
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength)
  const uptimeSec = view.getUint32(0, true)
  const packed = payload[4]
  const health = packed & 0x03
  const mode = (packed >> 2) & 0x07
  const subMode = (packed >> 5) & 0x07
  const vendorSpecificStatusCode = view.getUint16(5, true)
  return { uptimeSec, health, mode, subMode, vendorSpecificStatusCode }
}

// uavcan.protocol.GetNodeInfo response (service 1)
// Signature: 0xEE468A8121C46A9E
//   NodeStatus status                      (7 bytes)
//   SoftwareVersion software_version       (15 bytes)
//   HardwareVersion hardware_version       (18 + COA tail)
//   uint8[<=80] name
// Where SoftwareVersion = u8 major, u8 minor, u8 optional_field_flags,
//                        u32 vcs_commit, u64 image_crc
// And HardwareVersion   = u8 major, u8 minor, u8[16] unique_id,
//                        uint8[<=255] certificate_of_authenticity (length-prefixed
//                        because hardware_version is not the outermost tail)
// The trailing `name` is a tail array of the OUTER struct; consumes whatever
// bytes remain after HardwareVersion.
export const DRONECAN_GET_NODE_INFO_SERVICE_ID = 1
export const DRONECAN_GET_NODE_INFO_SIGNATURE = 0xee468a8121c46a9en

export interface DronecanGetNodeInfoResponse {
  status: DronecanNodeStatus
  softwareVersion: {
    major: number
    minor: number
    optionalFieldFlags: number
    vcsCommit: number
    imageCrc: bigint
  }
  hardwareVersion: {
    major: number
    minor: number
    uniqueId: Uint8Array
    certificateOfAuthenticity: Uint8Array
  }
  name: string
}

const textDecoder = new TextDecoder('utf-8', { fatal: false })

export function decodeDronecanGetNodeInfoResponse(
  payload: Uint8Array
): DronecanGetNodeInfoResponse | undefined {
  // Need NodeStatus (7) + SoftwareVersion (15) + HardwareVersion fixed part (18)
  // + COA length prefix (1) at minimum.
  if (payload.length < 7 + 15 + 18 + 1) {
    return undefined
  }
  const status = decodeDronecanNodeStatus(payload.subarray(0, 7))
  if (!status) {
    return undefined
  }
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength)
  const swMajor = payload[7]
  const swMinor = payload[8]
  const optionalFieldFlags = payload[9]
  const vcsCommit = view.getUint32(10, true)
  const imageCrc = view.getBigUint64(14, true)

  const hwMajor = payload[22]
  const hwMinor = payload[23]
  const uniqueId = payload.slice(24, 40)
  // COA length prefix is 1 byte (uint8[<=255]).
  const coaLen = payload[40]
  const coaStart = 41
  if (payload.length < coaStart + coaLen) {
    return undefined
  }
  const certificateOfAuthenticity = payload.slice(coaStart, coaStart + coaLen)
  const nameStart = coaStart + coaLen
  const nameBytes = payload.subarray(nameStart)
  const name = textDecoder.decode(nameBytes).replace(/ +$/, '')
  return {
    status,
    softwareVersion: { major: swMajor, minor: swMinor, optionalFieldFlags, vcsCommit, imageCrc },
    hardwareVersion: { major: hwMajor, minor: hwMinor, uniqueId, certificateOfAuthenticity },
    name
  }
}

// uavcan.protocol.param.GetSet (service 11) request + response
// Signature: 0xA7B622F939D1A4D5
//
// REQUEST (used to read or write a single parameter):
//   uint13 index           (lower-13 bits of first 2-byte word, LSB-aligned)
//   Value  value           (tag-prefixed variant; see below)
//   uint8[<=92] name       (length-prefixed when not the last field;
//                           here it IS the last field of the request,
//                           so it is a tail array with no length prefix)
//
// RESPONSE:
//   Value  value
//   Value  default_value
//   NumericValue max_value
//   NumericValue min_value
//   uint8[<=92] name       (tail)
//
// Value variant tags (one byte holds the tag in our simplified encoding —
// the spec uses a void2 + 3-bit tag, totalling 5 bits; we read the byte
// directly and mask). Tag enum:
//   0 = empty
//   1 = int64
//   2 = real32
//   3 = bool (uint8)
//   4 = string (uint8[<=128])
//
// NumericValue is the same as Value but only int64 / real32 / empty.
export const DRONECAN_PARAM_GETSET_SERVICE_ID = 11
export const DRONECAN_PARAM_GETSET_SIGNATURE = 0xa7b622f939d1a4d5n

export type DronecanParamValueTag = 'empty' | 'int64' | 'real32' | 'bool' | 'string'
export interface DronecanParamValue {
  tag: DronecanParamValueTag
  int64?: bigint
  real32?: number
  bool?: boolean
  string?: string
}




/**
 * Read one byte-aligned param Value/NumericValue from the response stream.
 * Returns the decoded value + the next cursor position, or undefined if
 * the tag is invalid for the union width.
 *
 * Wire format (confirmed by bench probe against a CubePilot Here4 +
 * matekL431-periph — see decodeDronecanGetSetResponse for the why):
 *   tag      : 1 byte  (0 empty, 1 int64, 2 real32, 3 bool, 4 string)
 *   variant  : int64 = 8 bytes LE | real32 = 4 bytes LE | bool = 1 byte |
 *              string = 1-byte length + N bytes | empty = 0 bytes
 * `isFullValue` distinguishes the 5-variant `Value` (used for `value`,
 * allows bool/string) from the 3-variant `NumericValue` (default/max/min).
 */
function readDronecanValueBytes(
  payload: Uint8Array,
  pos: number,
  isFullValue: boolean
): { value: DronecanParamValue; next: number } | undefined {
  if (pos >= payload.length) {
    // Canard zero-extends a truncated message; treat a missing tag as empty.
    return { value: { tag: 'empty' }, next: pos }
  }
  const tag = payload[pos]
  const after = pos + 1
  switch (tag) {
    case 0:
      return { value: { tag: 'empty' }, next: after }
    case 1: {
      let raw = 0n
      for (let i = 0; i < 8; i += 1) raw |= BigInt(payload[after + i] ?? 0) << BigInt(8 * i)
      if (raw >= 0x8000000000000000n) raw -= 1n << 64n
      return { value: { tag: 'int64', int64: raw }, next: after + 8 }
    }
    case 2: {
      const buf = new Uint8Array(4)
      for (let i = 0; i < 4; i += 1) buf[i] = payload[after + i] ?? 0
      const view = new DataView(buf.buffer, buf.byteOffset, 4)
      return { value: { tag: 'real32', real32: view.getFloat32(0, true) }, next: after + 4 }
    }
    case 3:
      if (!isFullValue) return undefined
      return { value: { tag: 'bool', bool: (payload[after] ?? 0) !== 0 }, next: after + 1 }
    case 4: {
      if (!isFullValue) return undefined
      const len = payload[after] ?? 0
      const start = after + 1
      const buf = payload.subarray(start, start + len)
      return { value: { tag: 'string', string: textDecoder.decode(buf).replace(/[\s\0]+$/, '') }, next: start + len }
    }
    default:
      return undefined
  }
}

export interface DronecanGetSetRequest {
  index: number
  value: DronecanParamValue
  name?: string
}

export function encodeDronecanGetSetRequest(req: DronecanGetSetRequest): Uint8Array {
  // BYTE-ALIGNED, matching the wire format real ArduPilot DroneCAN nodes
  // actually decode (the mirror of the byte-aligned GetSet *response* — see
  // decodeDronecanGetSetResponse):
  //   uint8 index, Value value (1-byte tag + content), uint8[<=92] name
  //
  // NOT the canonical bit-packed DSDL (uint13 index + 3-bit union tag). A
  // bit-packed request only *coincidentally* parses for empty-value reads —
  // index 0 / tag 0 serialize to [0x00,0x00,...name] either way, which is why
  // parameter discovery + by-index walks worked. But any SET carries a real
  // Value: bit-packing put the 3-bit tag mid-byte and shifted the value + name,
  // so the node couldn't match the name and returned an empty "not found"
  // response — every write/save silently failed. Bench-verified against a
  // CubePilot Here4 (a byte-aligned `00 01 <int64> <name>` SET is ACKed; the
  // bit-packed form is rejected with an empty response).
  const valueBytes = writeDronecanValueBytes(req.value, true)
  const nameBytes =
    req.name && req.name.length > 0 ? new TextEncoder().encode(req.name).slice(0, 92) : new Uint8Array(0)
  const out = new Uint8Array(1 + valueBytes.length + nameBytes.length)
  out[0] = req.index & 0xff
  out.set(valueBytes, 1)
  out.set(nameBytes, 1 + valueBytes.length)
  return out
}

export interface DronecanGetSetResponse {
  value: DronecanParamValue
  defaultValue: DronecanParamValue
  maxValue: DronecanParamValue
  minValue: DronecanParamValue
  name: string
}

export function decodeDronecanGetSetResponse(payload: Uint8Array): DronecanGetSetResponse | undefined {
  // BYTE-ALIGNED, back-to-back:
  //   Value         value         (1-byte tag + variant — 5 variants)
  //   NumericValue  default_value (1-byte tag + variant — 3 variants)
  //   NumericValue  max_value     (1-byte tag + variant)
  //   NumericValue  min_value     (1-byte tag + variant)
  //   uint8[<=92]   name          (tail bytes, byte-aligned)
  //
  // NOTE: this does NOT match the canonical bit-packed
  // uavcan.protocol.param.GetSet.Response DSDL (3-bit/2-bit union tags).
  // A bench probe (scripts/dronecan-name-probe.mjs) against a real
  // CubePilot Here4 + matekL431-periph proved the node serializes its
  // GetSet *response* byte-aligned: e.g. CAN_BAUDRATE came back as
  //   01 40 42 0f 00 00 00 00 00  00 00 00  43 41 4e 5f 42 41 55 44 52 41 54 45
  //   ^tag=int64  ^^int64 LE = 1000000   ^def^max^min(empty)  "CAN_BAUDRATE"
  // The bit-packed decoder misread BOTH the value (1000000 → 32000000)
  // and the name (byte-shifted → garbled UTF-8). The *request* stays
  // bit-packed (uint13 index + 3-bit tag) — that path is verified
  // working and a byte-aligned request makes the node treat the trailing
  // byte as a name lookup and return empty. Asymmetric, but matches the
  // wire.
  const value = readDronecanValueBytes(payload, 0, true)
  if (!value) return undefined
  const defaultValue = readDronecanValueBytes(payload, value.next, false)
  if (!defaultValue) return undefined
  const maxValue = readDronecanValueBytes(payload, defaultValue.next, false)
  if (!maxValue) return undefined
  const minValue = readDronecanValueBytes(payload, maxValue.next, false)
  if (!minValue) return undefined
  const name = textDecoder.decode(payload.subarray(minValue.next)).replace(/[\s\0]+$/, '')
  return {
    value: value.value,
    defaultValue: defaultValue.value,
    maxValue: maxValue.value,
    minValue: minValue.value,
    name
  }
}

// uavcan.protocol.param.ExecuteOpcode (service 10)
// Signature: 0x3B131AC5EB69D2CD
//   REQUEST:  uint8 opcode (SAVE=0, ERASE=1), int48 argument
//   RESPONSE: int48 argument, bool ok
export const DRONECAN_PARAM_EXECUTE_OPCODE_SERVICE_ID = 10
export const DRONECAN_PARAM_EXECUTE_OPCODE_SIGNATURE = 0x3b131ac5eb69d2cdn
export const DRONECAN_PARAM_OPCODE_SAVE = 0
export const DRONECAN_PARAM_OPCODE_ERASE = 1

export function encodeDronecanExecuteOpcodeRequest(opcode: number, argument: bigint = 0n): Uint8Array {
  const out = new Uint8Array(7)
  out[0] = opcode & 0xff
  // int48, LSB-first.
  for (let i = 0; i < 6; i += 1) {
    out[1 + i] = Number((argument >> BigInt(8 * i)) & 0xffn)
  }
  return out
}

export interface DronecanExecuteOpcodeResponse {
  argument: bigint
  ok: boolean
}

export function decodeDronecanExecuteOpcodeResponse(payload: Uint8Array): DronecanExecuteOpcodeResponse | undefined {
  if (payload.length < 7) {
    return undefined
  }
  let argument = 0n
  for (let i = 0; i < 6; i += 1) {
    argument |= BigInt(payload[i]) << BigInt(8 * i)
  }
  // Sign-extend the 48-bit value into 64 bits.
  if ((argument & 0x800000000000n) !== 0n) {
    argument -= 0x1000000000000n
  }
  const ok = payload[6] !== 0
  return { argument, ok }
}

// ---------------------------------------------------------------------------
// Outbound frame helpers — split a multi-byte service payload into CAN frames
// ---------------------------------------------------------------------------

export interface DronecanServiceCallParts {
  serviceTypeId: number
  signature: bigint
  destinationNodeId: number
  sourceNodeId: number
  transferId: number
  priority?: number
  isRequest?: boolean
}

/**
 * Take an arbitrary service payload (could be 0..N bytes) and return the
 * sequence of CAN frames (each up to 8 bytes including the tail byte) that
 * encode it. The first frame includes the 2-byte CRC for multi-frame
 * transfers; single-frame transfers (<=7 bytes) skip the CRC entirely.
 */
export function dronecanBuildServiceFrames(
  parts: DronecanServiceCallParts,
  payload: Uint8Array
): Array<{ canId: number; data: Uint8Array }> {
  const priority = parts.priority ?? 16
  const canId = dronecanEncodeServiceCanId(
    priority,
    parts.serviceTypeId,
    parts.isRequest ?? true,
    parts.destinationNodeId,
    parts.sourceNodeId
  )
  const transferId = parts.transferId & 0x1f
  const frames: Array<{ canId: number; data: Uint8Array }> = []

  if (payload.length <= 7) {
    const data = new Uint8Array(payload.length + 1)
    data.set(payload, 0)
    data[payload.length] = dronecanComposeTailByte({ sot: true, eot: true, toggle: false, transferId })
    frames.push({ canId, data })
    return frames
  }

  // Multi-frame: first frame gets a CRC-16 prefix over (DT signature + payload).
  const crc = dronecanCrcWithSignature(parts.signature, payload)
  const withCrc = new Uint8Array(payload.length + 2)
  withCrc[0] = crc & 0xff
  withCrc[1] = (crc >> 8) & 0xff
  withCrc.set(payload, 2)

  let cursor = 0
  let toggle = false
  let sot = true
  while (cursor < withCrc.length) {
    const remaining = withCrc.length - cursor
    const chunk = Math.min(7, remaining)
    const isEot = chunk === remaining
    const frame = new Uint8Array(chunk + 1)
    frame.set(withCrc.subarray(cursor, cursor + chunk), 0)
    frame[chunk] = dronecanComposeTailByte({ sot, eot: isEot, toggle, transferId })
    frames.push({ canId, data: frame })
    cursor += chunk
    sot = false
    toggle = !toggle
  }
  return frames
}

export interface DronecanBroadcastParts {
  messageTypeId: number
  signature: bigint
  sourceNodeId: number
  transferId: number
  priority?: number
}

/**
 * Broadcast (message) counterpart to {@link dronecanBuildServiceFrames}:
 * split a message payload into CAN frames with a message CAN ID. Single-frame
 * (<=7 bytes) transfers skip the CRC; multi-frame transfers prefix the first
 * frame with the CRC-16 over (DT signature + payload). Used to synthesize
 * inbound DroneCAN traffic (the demo mock; tests).
 */
export function dronecanBuildBroadcastFrames(
  parts: DronecanBroadcastParts,
  payload: Uint8Array
): Array<{ canId: number; data: Uint8Array }> {
  const priority = parts.priority ?? 16
  const canId = dronecanEncodeMessageCanId(priority, parts.messageTypeId, parts.sourceNodeId)
  const transferId = parts.transferId & 0x1f
  const frames: Array<{ canId: number; data: Uint8Array }> = []

  if (payload.length <= 7) {
    const data = new Uint8Array(payload.length + 1)
    data.set(payload, 0)
    data[payload.length] = dronecanComposeTailByte({ sot: true, eot: true, toggle: false, transferId })
    frames.push({ canId, data })
    return frames
  }

  const crc = dronecanCrcWithSignature(parts.signature, payload)
  const withCrc = new Uint8Array(payload.length + 2)
  withCrc[0] = crc & 0xff
  withCrc[1] = (crc >> 8) & 0xff
  withCrc.set(payload, 2)

  let cursor = 0
  let toggle = false
  let sot = true
  while (cursor < withCrc.length) {
    const remaining = withCrc.length - cursor
    const chunk = Math.min(7, remaining)
    const isEot = chunk === remaining
    const frame = new Uint8Array(chunk + 1)
    frame.set(withCrc.subarray(cursor, cursor + chunk), 0)
    frame[chunk] = dronecanComposeTailByte({ sot, eot: isEot, toggle, transferId })
    frames.push({ canId, data: frame })
    cursor += chunk
    sot = false
    toggle = !toggle
  }
  return frames
}

// ---------------------------------------------------------------------------
// DSDL encoders — inverse of the decoders above. Used to synthesize DroneCAN
// responses (the demo mock simulates peripheral nodes; round-trip tests).
// ---------------------------------------------------------------------------

/** Encode a uavcan.protocol.NodeStatus payload (7 bytes, byte-aligned). */
export function encodeDronecanNodeStatus(status: DronecanNodeStatus): Uint8Array {
  const out = new Uint8Array(7)
  const view = new DataView(out.buffer)
  view.setUint32(0, status.uptimeSec >>> 0, true)
  out[4] = (status.health & 0x03) | ((status.mode & 0x07) << 2) | ((status.subMode & 0x07) << 5)
  view.setUint16(5, status.vendorSpecificStatusCode & 0xffff, true)
  return out
}

/** Byte-aligned param Value/NumericValue writer — inverse of
 *  {@link readDronecanValueBytes}. `isFullValue` allows bool/string (the
 *  5-variant `Value`); NumericValue (default/max/min) collapses those to empty. */
function writeDronecanValueBytes(value: DronecanParamValue, isFullValue: boolean): Uint8Array {
  switch (value.tag) {
    case 'empty':
      return Uint8Array.of(0)
    case 'int64': {
      const out = new Uint8Array(9)
      out[0] = 1
      let v = value.int64 ?? 0n
      if (v < 0n) v += 1n << 64n
      for (let i = 0; i < 8; i += 1) out[1 + i] = Number((v >> BigInt(8 * i)) & 0xffn)
      return out
    }
    case 'real32': {
      const out = new Uint8Array(5)
      out[0] = 2
      new DataView(out.buffer).setFloat32(1, value.real32 ?? 0, true)
      return out
    }
    case 'bool':
      return isFullValue ? Uint8Array.of(3, value.bool ? 1 : 0) : Uint8Array.of(0)
    case 'string': {
      if (!isFullValue) return Uint8Array.of(0)
      const bytes = new TextEncoder().encode(value.string ?? '').slice(0, 128)
      const out = new Uint8Array(2 + bytes.length)
      out[0] = 4
      out[1] = bytes.length & 0xff
      out.set(bytes, 2)
      return out
    }
  }
}

/** Encode a uavcan.protocol.GetNodeInfo response payload (byte-aligned). */
export function encodeDronecanGetNodeInfoResponse(info: DronecanGetNodeInfoResponse): Uint8Array {
  const status = encodeDronecanNodeStatus(info.status)
  const sw = new Uint8Array(15)
  const swView = new DataView(sw.buffer)
  sw[0] = info.softwareVersion.major & 0xff
  sw[1] = info.softwareVersion.minor & 0xff
  sw[2] = info.softwareVersion.optionalFieldFlags & 0xff
  swView.setUint32(3, info.softwareVersion.vcsCommit >>> 0, true)
  swView.setBigUint64(7, info.softwareVersion.imageCrc & 0xffffffffffffffffn, true)
  const hw = new Uint8Array(18)
  hw[0] = info.hardwareVersion.major & 0xff
  hw[1] = info.hardwareVersion.minor & 0xff
  hw.set(info.hardwareVersion.uniqueId.subarray(0, 16), 2)
  const coa = (info.hardwareVersion.certificateOfAuthenticity ?? new Uint8Array(0)).subarray(0, 255)
  const nameBytes = new TextEncoder().encode(info.name).slice(0, 80)
  const out = new Uint8Array(status.length + sw.length + hw.length + 1 + coa.length + nameBytes.length)
  let o = 0
  out.set(status, o); o += status.length
  out.set(sw, o); o += sw.length
  out.set(hw, o); o += hw.length
  out[o] = coa.length & 0xff; o += 1
  out.set(coa, o); o += coa.length
  out.set(nameBytes, o)
  return out
}

/** Encode a uavcan.protocol.param.GetSet response payload (byte-aligned, the
 *  wire format real ArduPilot nodes emit — see decodeDronecanGetSetResponse). */
export function encodeDronecanGetSetResponse(resp: DronecanGetSetResponse): Uint8Array {
  const parts = [
    writeDronecanValueBytes(resp.value, true),
    writeDronecanValueBytes(resp.defaultValue, false),
    writeDronecanValueBytes(resp.maxValue, false),
    writeDronecanValueBytes(resp.minValue, false),
    new TextEncoder().encode(resp.name).slice(0, 92)
  ]
  const total = parts.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(total)
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

/** Encode a uavcan.protocol.param.ExecuteOpcode response payload. */
export function encodeDronecanExecuteOpcodeResponse(argument: bigint, ok: boolean): Uint8Array {
  const out = new Uint8Array(7)
  let arg = argument
  if (arg < 0n) arg += 0x1000000000000n
  for (let i = 0; i < 6; i += 1) out[i] = Number((arg >> BigInt(8 * i)) & 0xffn)
  out[6] = ok ? 1 : 0
  return out
}
