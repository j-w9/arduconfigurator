// The one CAN frame model every source and tool shares: a MAVLink-forwarded
// frame, an SLCAN line, a candump log line and a frame we transmit all become
// this, so the monitor, filters, recorder and plots never care where a frame
// came from.

/** ArduPilot / SocketCAN flag bits carried in the top of a 32-bit CAN id. */
export const CAN_EFF_FLAG = 0x80000000
export const CAN_RTR_FLAG = 0x40000000
export const CAN_ERR_FLAG = 0x20000000
export const CAN_SFF_MASK = 0x000007ff
export const CAN_EFF_MASK = 0x1fffffff

/** Classic CAN carries 0..8 data bytes; CAN FD up to 64. */
export const CAN_MAX_DLEN = 8
export const CANFD_MAX_DLEN = 64

export type CanFrameDirection = 'rx' | 'tx'

export interface CanFrame {
  /** Monotonic capture sequence, assigned by the buffer. 0 until captured. */
  seq: number
  /** When the host saw the frame (ms since epoch; sub-ms where the source has it). */
  timestampMs: number
  /** 1-based bus number (CAN1 = 1), as ArduPilot names them. */
  bus: number
  /** Arbitration id WITHOUT flag bits: 11-bit standard or 29-bit extended. */
  id: number
  extended: boolean
  /** Remote transmission request (classic CAN only). */
  rtr: boolean
  /** Error frame, as reported by the controller. */
  error: boolean
  /** CAN FD frame. */
  fd: boolean
  /** Payload; length is the real data length (not the DLC code). */
  data: Uint8Array
  /** Received from the bus, or sent by this app. */
  direction: CanFrameDirection
}

export interface CanFrameInput {
  timestampMs: number
  bus: number
  /** Raw 32-bit id with flag bits, as ArduPilot's CAN_FRAME / CANFD_FRAME carry it. */
  rawId: number
  data: Uint8Array
  fd?: boolean
  direction?: CanFrameDirection
}

/**
 * Build a frame from a raw id that carries the flag bits in its top three
 * bits (AP_HAL::CANFrame, SocketCAN). The payload is copied, so a caller's
 * reused buffer cannot change a captured frame later.
 */
export function canFrameFromRawId(input: CanFrameInput): CanFrame {
  const raw = input.rawId >>> 0
  const extended = (raw & CAN_EFF_FLAG) !== 0
  return {
    seq: 0,
    timestampMs: input.timestampMs,
    bus: input.bus,
    id: extended ? raw & CAN_EFF_MASK : raw & CAN_SFF_MASK,
    extended,
    rtr: (raw & CAN_RTR_FLAG) !== 0,
    error: (raw & CAN_ERR_FLAG) !== 0,
    fd: input.fd ?? false,
    data: input.data.slice(),
    direction: input.direction ?? 'rx'
  }
}

/** The raw 32-bit id (with flag bits) for a frame, as ArduPilot expects to receive it. */
export function canFrameRawId(frame: Pick<CanFrame, 'id' | 'extended' | 'rtr' | 'error'>): number {
  let raw = frame.extended ? frame.id & CAN_EFF_MASK : frame.id & CAN_SFF_MASK
  if (frame.extended) raw |= CAN_EFF_FLAG
  if (frame.rtr) raw |= CAN_RTR_FLAG
  if (frame.error) raw |= CAN_ERR_FLAG
  return raw >>> 0
}

/** Id as hex, padded the way every CAN tool shows it: 3 digits standard, 8 extended. */
export function formatCanId(id: number, extended: boolean): string {
  return (id >>> 0).toString(16).toUpperCase().padStart(extended ? 8 : 3, '0')
}

/** Payload as space-separated hex bytes. */
export function formatCanData(data: Uint8Array): string {
  let out = ''
  for (let index = 0; index < data.length; index += 1) {
    if (index > 0) out += ' '
    out += data[index].toString(16).toUpperCase().padStart(2, '0')
  }
  return out
}

/** Payload as printable ASCII, '.' for anything else (the classic dump column). */
export function formatCanAscii(data: Uint8Array): string {
  let out = ''
  for (const byte of data) {
    out += byte >= 0x20 && byte < 0x7f ? String.fromCharCode(byte) : '.'
  }
  return out
}

/** CAN FD's DLC codes above 8 map to these data lengths. */
const CANFD_LENGTHS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 12, 16, 20, 24, 32, 48, 64] as const

/** The DLC code for a data length (CAN FD rounds up to the next valid length). */
export function canDlcForLength(length: number): number {
  for (let dlc = 0; dlc < CANFD_LENGTHS.length; dlc += 1) {
    if (CANFD_LENGTHS[dlc] >= length) return dlc
  }
  return 15
}

/** The data length a DLC code stands for. */
export function canLengthForDlc(dlc: number): number {
  return CANFD_LENGTHS[Math.max(0, Math.min(15, Math.round(dlc)))]
}
