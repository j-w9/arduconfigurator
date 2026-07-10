// VTX band/frequency + power table codec — the ground-station half of
// ArduPilot's user-definable VTX table (AP_VideoTX_Table, Betaflight-style),
// transported as a single binary blob over MAVLink FTP at @VTX/vtxtable.dat.
//
// Wire format is byte-exact to AP_VideoTX_Table::serialize/deserialize on the
// firmware branch that introduced it. Little-endian throughout:
//
//   [0..1] magic 0x5654 ('VT')     [2] version    [3] numBands
//   [4] numChannels                [5] numPowerLevels
//   per band  (numBands ×):  name[8]  letter[1]  isFactory[1]  freq[numChannels × u16]
//   per power (numPowerLevels ×):  value[u16]  label[3]
//   [tail] crc[u32]  = crc_crc32(0, buf, len-4)  over everything before it
//
// The band/frequency half is hardware-validated and stable; power-level
// semantics (how `value` is consumed by the Tramp/SmartAudio drivers) are
// still evolving on the firmware side, so consumers should treat power as
// read-only for now.

/** MAVLink-FTP path the firmware exposes the table blob at. */
export const VTX_TABLE_FTP_PATH = '@VTX/vtxtable.dat'

export const VTX_TABLE_MAGIC = 0x5654 // 'VT'
export const VTX_TABLE_VERSION = 1
export const VTX_TABLE_MAX_BANDS = 12
export const VTX_TABLE_MAX_CHANNELS = 8
export const VTX_TABLE_MAX_POWER_LEVELS = 8
export const VTX_TABLE_BAND_NAME_LEN = 8
export const VTX_TABLE_POWER_LABEL_LEN = 3

export interface VtxTableBand {
  /** Human name (e.g. "Boscam A"); already trimmed of the storage padding. */
  name: string
  /** Single-letter id shown in the OSD (e.g. "A"). */
  letter: string
  /** Factory band: the VTX uses its own frequency map for it. */
  isFactory: boolean
  /** Per-channel frequency in MHz; 0 = channel disabled. Length = numChannels. */
  frequencies: number[]
}

export interface VtxTablePowerLevel {
  /** Protocol value sent to the VTX (mW for Tramp, index/dBm for SmartAudio). */
  value: number
  /** Short display label ("25", "200", "1W"); trimmed of storage padding. */
  label: string
}

export interface VtxTable {
  version: number
  numChannels: number
  bands: VtxTableBand[]
  powerLevels: VtxTablePowerLevel[]
}

// CRC-32 matching ArduPilot's crc_crc32(): standard reflected table (poly
// 0xEDB88320) but init = 0 and NO final XOR — deliberately NOT zlib crc32
// (which inits 0xFFFFFFFF and inverts at the end). Must match byte-for-byte or
// the firmware rejects the uploaded blob.
const VTX_CRC32_TABLE: Uint32Array = (() => {
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

export function vtxTableCrc32(bytes: Uint8Array): number {
  let crc = 0
  for (let i = 0; i < bytes.length; i += 1) {
    crc = (VTX_CRC32_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8)) >>> 0
  }
  return crc >>> 0
}

/** Firmware stores fixed-width names/labels space/zero-padded and NOT
 *  NUL-terminated; strip trailing NULs and spaces for display. */
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

/** Encode a string into a fixed-width, zero-padded (not NUL-terminated) field;
 *  truncates if longer than `len`. */
function encodeFixedString(value: string, len: number): Uint8Array {
  const out = new Uint8Array(len) // zero-filled padding
  for (let i = 0; i < len && i < value.length; i += 1) {
    out[i] = value.charCodeAt(i) & 0xff
  }
  return out
}

export class VtxTableParseError extends Error {}

/**
 * Parse a @VTX/vtxtable.dat blob. Throws {@link VtxTableParseError} on a bad
 * magic / unsupported version / out-of-range counts / truncation / CRC
 * mismatch, so a detection caller can distinguish "not a VTX table" from a
 * transport failure.
 */
export function parseVtxTable(bytes: Uint8Array): VtxTable {
  if (bytes.length < 6) {
    throw new VtxTableParseError('VTX table blob too short for its header.')
  }
  const magic = bytes[0] | (bytes[1] << 8)
  if (magic !== VTX_TABLE_MAGIC) {
    throw new VtxTableParseError(`VTX table bad magic 0x${magic.toString(16)}.`)
  }
  const version = bytes[2]
  if (version !== VTX_TABLE_VERSION) {
    throw new VtxTableParseError(`Unsupported VTX table version ${version}.`)
  }
  const numBands = bytes[3]
  const numChannels = bytes[4]
  const numPowerLevels = bytes[5]
  if (
    numBands > VTX_TABLE_MAX_BANDS ||
    numChannels > VTX_TABLE_MAX_CHANNELS ||
    numPowerLevels > VTX_TABLE_MAX_POWER_LEVELS
  ) {
    throw new VtxTableParseError('VTX table counts exceed the supported limits.')
  }
  const need =
    6 +
    numBands * (VTX_TABLE_BAND_NAME_LEN + 2 + numChannels * 2) +
    numPowerLevels * (2 + VTX_TABLE_POWER_LABEL_LEN) +
    4
  if (bytes.length < need) {
    throw new VtxTableParseError('VTX table blob truncated.')
  }
  const stored =
    (bytes[need - 4] | (bytes[need - 3] << 8) | (bytes[need - 2] << 16) | (bytes[need - 1] << 24)) >>> 0
  if (vtxTableCrc32(bytes.subarray(0, need - 4)) !== stored) {
    throw new VtxTableParseError('VTX table CRC mismatch.')
  }

  let o = 6
  const bands: VtxTableBand[] = []
  for (let b = 0; b < numBands; b += 1) {
    const name = decodeFixedString(bytes.subarray(o, o + VTX_TABLE_BAND_NAME_LEN))
    o += VTX_TABLE_BAND_NAME_LEN
    const letter = bytes[o] === 0 ? '' : String.fromCharCode(bytes[o])
    o += 1
    const isFactory = bytes[o] !== 0
    o += 1
    const frequencies: number[] = []
    for (let c = 0; c < numChannels; c += 1) {
      frequencies.push(bytes[o] | (bytes[o + 1] << 8))
      o += 2
    }
    bands.push({ name, letter, isFactory, frequencies })
  }
  const powerLevels: VtxTablePowerLevel[] = []
  for (let i = 0; i < numPowerLevels; i += 1) {
    const value = bytes[o] | (bytes[o + 1] << 8)
    o += 2
    const label = decodeFixedString(bytes.subarray(o, o + VTX_TABLE_POWER_LABEL_LEN))
    o += VTX_TABLE_POWER_LABEL_LEN
    powerLevels.push({ value, label })
  }

  return { version, numChannels, bands, powerLevels }
}

/**
 * Serialize a VtxTable back into a @VTX/vtxtable.dat blob, byte-exact to the
 * firmware format (incl. the trailing crc_crc32). The inverse of
 * {@link parseVtxTable}: `parse(serialize(t))` deep-equals `t`.
 */
export function serializeVtxTable(table: VtxTable): Uint8Array {
  const numBands = table.bands.length
  const numChannels = table.numChannels
  const numPowerLevels = table.powerLevels.length
  const size =
    6 +
    numBands * (VTX_TABLE_BAND_NAME_LEN + 2 + numChannels * 2) +
    numPowerLevels * (2 + VTX_TABLE_POWER_LABEL_LEN) +
    4
  const buf = new Uint8Array(size)
  let o = 0
  buf[o++] = VTX_TABLE_MAGIC & 0xff
  buf[o++] = (VTX_TABLE_MAGIC >> 8) & 0xff
  buf[o++] = VTX_TABLE_VERSION
  buf[o++] = numBands
  buf[o++] = numChannels
  buf[o++] = numPowerLevels
  for (const band of table.bands) {
    buf.set(encodeFixedString(band.name, VTX_TABLE_BAND_NAME_LEN), o)
    o += VTX_TABLE_BAND_NAME_LEN
    buf[o++] = band.letter.length > 0 ? band.letter.charCodeAt(0) & 0xff : 0
    buf[o++] = band.isFactory ? 1 : 0
    for (let c = 0; c < numChannels; c += 1) {
      const freq = band.frequencies[c] ?? 0
      buf[o++] = freq & 0xff
      buf[o++] = (freq >> 8) & 0xff
    }
  }
  for (const level of table.powerLevels) {
    buf[o++] = level.value & 0xff
    buf[o++] = (level.value >> 8) & 0xff
    buf.set(encodeFixedString(level.label, VTX_TABLE_POWER_LABEL_LEN), o)
    o += VTX_TABLE_POWER_LABEL_LEN
  }
  const crc = vtxTableCrc32(buf.subarray(0, o))
  buf[o++] = crc & 0xff
  buf[o++] = (crc >> 8) & 0xff
  buf[o++] = (crc >> 16) & 0xff
  buf[o++] = (crc >> 24) & 0xff
  return buf
}
