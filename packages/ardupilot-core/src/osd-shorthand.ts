// Codec for the OSD message shorthand table exposed by the ArduPilot fork over
// MAVLink-FTP at @OSD/shorthand.dat (mirrors the @VTX table). The blob is a
// small user-defined from→to substitution dictionary applied to the OSD MESSAGE
// panel on top of the firmware's built-in one. Wire format (little-endian),
// verbatim from AP_OSD_Shorthand::serialize:
//   [magic u16 = 'OS' 0x534F][version u8 = 1][count u8]
//   count × ( from[16] + to[10] )   (fixed-width, NUL-padded)
//   [crc u32]   (ArduPilot crc_crc32 over all preceding bytes)

/** MAVLink-FTP path the firmware exposes the shorthand blob at. */
export const OSD_SHORTHAND_FTP_PATH = '@OSD/shorthand.dat'

export const OSD_SHORTHAND_MAGIC = 0x534f // 'OS' (byte0 'O' 0x4F, byte1 'S' 0x53)
export const OSD_SHORTHAND_VERSION = 1
export const OSD_SHORTHAND_MAX_ENTRIES = 16
/** Field is NUL-terminated within its width, so the usable text is LEN-1. */
export const OSD_SHORTHAND_FROM_LEN = 16
export const OSD_SHORTHAND_TO_LEN = 10

export interface OsdShorthandEntry {
  /** Text matched (case-insensitively, by the firmware) in a MESSAGE. ≤15 chars. */
  from: string
  /** Replacement text. ≤9 chars. */
  to: string
}

export interface OsdShorthand {
  entries: OsdShorthandEntry[]
}

// CRC-32 matching ArduPilot's crc_crc32(): reflected table (poly 0xEDB88320),
// init = 0, NO final XOR — deliberately NOT zlib crc32. Must match byte-for-byte
// or the firmware rejects the uploaded blob. (Same flavor as vtxTableCrc32.)
const OSD_SHORTHAND_CRC32_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? (0xedb88320 ^ (c >>> 1)) >>> 0 : c >>> 1
    }
    table[n] = c >>> 0
  }
  return table
})()

export function osdShorthandCrc32(bytes: Uint8Array): number {
  let crc = 0
  for (let i = 0; i < bytes.length; i += 1) {
    crc = (OSD_SHORTHAND_CRC32_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8)) >>> 0
  }
  return crc >>> 0
}

/** Strip trailing NULs/spaces from a fixed-width field for display. */
function decodeFixedString(bytes: Uint8Array): string {
  let end = bytes.length
  while (end > 0 && (bytes[end - 1] === 0 || bytes[end - 1] === 0x20)) {
    end -= 1
  }
  let out = ''
  for (let i = 0; i < end; i += 1) {
    out += String.fromCharCode(bytes[i])
  }
  return out
}

/** Encode into a fixed-width field, leaving a NUL terminator (writes at most
 *  len-1 chars, matching the firmware which forces the last byte to 0). */
function encodeFixedString(value: string, len: number): Uint8Array {
  const out = new Uint8Array(len) // zero-filled
  for (let i = 0; i < len - 1 && i < value.length; i += 1) {
    out[i] = value.charCodeAt(i) & 0xff
  }
  return out
}

const ENTRY_LEN = OSD_SHORTHAND_FROM_LEN + OSD_SHORTHAND_TO_LEN
const HEADER_LEN = 4
const CRC_LEN = 4

export class OsdShorthandParseError extends Error {}

/**
 * Parse an @OSD/shorthand.dat blob. Throws {@link OsdShorthandParseError} on a
 * bad magic / unsupported version / over-count / truncation / CRC mismatch, so a
 * detection caller can distinguish "no shorthand table" from a transport error.
 */
export function parseOsdShorthand(bytes: Uint8Array): OsdShorthand {
  if (bytes.length < HEADER_LEN + CRC_LEN) {
    throw new OsdShorthandParseError('OSD shorthand blob too short for its header.')
  }
  const magic = bytes[0] | (bytes[1] << 8)
  if (magic !== OSD_SHORTHAND_MAGIC) {
    throw new OsdShorthandParseError(`OSD shorthand bad magic 0x${magic.toString(16)}.`)
  }
  const version = bytes[2]
  if (version !== OSD_SHORTHAND_VERSION) {
    throw new OsdShorthandParseError(`Unsupported OSD shorthand version ${version}.`)
  }
  const count = bytes[3]
  if (count > OSD_SHORTHAND_MAX_ENTRIES) {
    throw new OsdShorthandParseError(`OSD shorthand count ${count} exceeds ${OSD_SHORTHAND_MAX_ENTRIES}.`)
  }
  const need = HEADER_LEN + count * ENTRY_LEN + CRC_LEN
  if (bytes.length < need) {
    throw new OsdShorthandParseError('OSD shorthand blob truncated.')
  }
  const crc = osdShorthandCrc32(bytes.subarray(0, need - CRC_LEN))
  const stored =
    (bytes[need - 4] | (bytes[need - 3] << 8) | (bytes[need - 2] << 16) | (bytes[need - 1] << 24)) >>> 0
  if (crc !== stored) {
    throw new OsdShorthandParseError('OSD shorthand CRC mismatch.')
  }
  const entries: OsdShorthandEntry[] = []
  let offset = HEADER_LEN
  for (let i = 0; i < count; i += 1) {
    const from = decodeFixedString(bytes.subarray(offset, offset + OSD_SHORTHAND_FROM_LEN))
    offset += OSD_SHORTHAND_FROM_LEN
    const to = decodeFixedString(bytes.subarray(offset, offset + OSD_SHORTHAND_TO_LEN))
    offset += OSD_SHORTHAND_TO_LEN
    entries.push({ from, to })
  }
  return { entries }
}

/** Serialize a shorthand table to its @OSD/shorthand.dat blob (with CRC). */
export function serializeOsdShorthand(table: OsdShorthand): Uint8Array {
  const entries = table.entries.slice(0, OSD_SHORTHAND_MAX_ENTRIES)
  const body = new Uint8Array(HEADER_LEN + entries.length * ENTRY_LEN)
  body[0] = OSD_SHORTHAND_MAGIC & 0xff
  body[1] = OSD_SHORTHAND_MAGIC >> 8
  body[2] = OSD_SHORTHAND_VERSION
  body[3] = entries.length
  let offset = HEADER_LEN
  for (const entry of entries) {
    body.set(encodeFixedString(entry.from, OSD_SHORTHAND_FROM_LEN), offset)
    offset += OSD_SHORTHAND_FROM_LEN
    body.set(encodeFixedString(entry.to, OSD_SHORTHAND_TO_LEN), offset)
    offset += OSD_SHORTHAND_TO_LEN
  }
  const crc = osdShorthandCrc32(body)
  const out = new Uint8Array(body.length + CRC_LEN)
  out.set(body, 0)
  out[body.length] = crc & 0xff
  out[body.length + 1] = (crc >>> 8) & 0xff
  out[body.length + 2] = (crc >>> 16) & 0xff
  out[body.length + 3] = (crc >>> 24) & 0xff
  return out
}
