// VTX band/frequency table codec — the ground-station half of ArduPilot's
// user-definable VTX table (AP_VideoTX_Table), transported as a single binary
// blob over MAVLink FTP at @VTX/vtxtable.dat.
//
// VERSION 2, the form being upstreamed. Bands only. Little-endian, no padding:
//
//   [0..1] magic 0x5654 ('VT')   [2] version = 2   [3] numBands   [4] numChannels
//   per band (numBands ×):  name[8]  letter[1]  isFactory[1]  freq[numChannels × u16]
//   [tail] crc[u32] = crc_crc32(0, buf, len-4) over everything before it
//
// What changed from version 1: the header lost its numPowerLevels byte (6 -> 5)
// and the power section after the bands is gone. POWER LEVELS ARE PARAMETERS
// now -- VTX_PWRTBL_EN and VTX_PWRTBL1..6, see vtx-power-table.ts -- which also
// means they work on every board, not only ones that can store a table.
//
// Version 1 blobs only ever came from the old SmallFastDrone fork firmware and
// are REJECTED here, with a distinguishable error so the UI can say "firmware
// too old" rather than "corrupt table". Reading one and writing v2 back would
// silently discard its power section; refusing is the honest answer.
//
// The full specification is libraries/AP_VideoTX/README_VTX_TABLE.md.

/** MAVLink-FTP path the firmware exposes the table blob at. */
export const VTX_TABLE_FTP_PATH = '@VTX/vtxtable.dat'

export const VTX_TABLE_MAGIC = 0x5654 // 'VT'
export const VTX_TABLE_VERSION = 2
/** The only other version that ever existed: the pre-upstream fork format. */
export const VTX_TABLE_LEGACY_VERSION = 1
export const VTX_TABLE_MAX_BANDS = 12
export const VTX_TABLE_MAX_CHANNELS = 8
export const VTX_TABLE_MAX_POWER_LEVELS = 8
export const VTX_TABLE_BAND_NAME_LEN = 8
export const VTX_TABLE_POWER_LABEL_LEN = 3
/** magic(2) + version(1) + numBands(1) + numChannels(1). Was 6 in version 1. */
export const VTX_TABLE_HEADER_LEN = 5

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
  /** Power in mW. The firmware stores this as mW for every protocol and derives
   *  the SmartAudio dBm/dac step from it (AP_VideoTX::load_power_levels_from_table),
   *  so it is NOT a raw dBm/index value even for SmartAudio. */
  value: number
  /** Short display label ("25", "200", "1W"); trimmed of storage padding. */
  label: string
}

export interface VtxTable {
  version: number
  numChannels: number
  bands: VtxTableBand[]
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
 * The vehicle accepted every byte and then refused the table on close.
 *
 * The firmware exposes no capability flag for this, so the message says the
 * likely cause rather than pretending to know: only boards with 32 KB of
 * parameter storage can keep a custom table. Reads still work on the others and
 * return the built-in bands, which is why the tab keeps showing a table.
 */
export class VtxTableStorageUnavailableError extends Error {
  constructor() {
    super(
      'This autopilot cannot store a custom band table; the default bands are in use. (Only boards with 32 KB of parameter storage can keep one.)'
    )
    this.name = 'VtxTableStorageUnavailableError'
  }
}

/**
 * Thrown when the blob is a VERSION 1 table.
 *
 * Its own type because the UI answers it differently: not "this table is
 * corrupt" but "this firmware predates the upstream VTX table". Nothing the
 * operator can do to the table fixes it; they need a newer build.
 */
export class VtxTableLegacyVersionError extends VtxTableParseError {
  constructor() {
    super(
      'This firmware uses the old (version 1) VTX table format, which this version cannot read or write. Update to a build with the upstream VTX table.'
    )
    this.name = 'VtxTableLegacyVersionError'
  }
}


/**
 * Parse a @VTX/vtxtable.dat blob. Throws {@link VtxTableParseError} on a bad
 * magic / unsupported version / out-of-range counts / truncation / CRC
 * mismatch, so a detection caller can distinguish "not a VTX table" from a
 * transport failure.
 */
export function parseVtxTable(bytes: Uint8Array): VtxTable {
  if (bytes.length < VTX_TABLE_HEADER_LEN) {
    throw new VtxTableParseError('VTX table blob too short for its header.')
  }
  const magic = bytes[0] | (bytes[1] << 8)
  if (magic !== VTX_TABLE_MAGIC) {
    throw new VtxTableParseError(`VTX table bad magic 0x${magic.toString(16)}.`)
  }
  const version = bytes[2]
  if (version === VTX_TABLE_LEGACY_VERSION) {
    throw new VtxTableLegacyVersionError()
  }
  if (version !== VTX_TABLE_VERSION) {
    throw new VtxTableParseError(`Unsupported VTX table version ${version}.`)
  }
  const numBands = bytes[3]
  const numChannels = bytes[4]
  // At least one of each: the firmware rejects a table with either at zero, and
  // a zero-band table would otherwise parse as a valid empty one and then be
  // refused on upload with nothing useful to say.
  if (numBands < 1 || numChannels < 1) {
    throw new VtxTableParseError('VTX table must have at least one band and one channel.')
  }
  if (numBands > VTX_TABLE_MAX_BANDS || numChannels > VTX_TABLE_MAX_CHANNELS) {
    throw new VtxTableParseError('VTX table counts exceed the supported limits.')
  }
  const need =
    VTX_TABLE_HEADER_LEN + numBands * (VTX_TABLE_BAND_NAME_LEN + 2 + numChannels * 2) + 4
  if (bytes.length < need) {
    throw new VtxTableParseError('VTX table blob truncated.')
  }
  const stored =
    (bytes[need - 4] | (bytes[need - 3] << 8) | (bytes[need - 2] << 16) | (bytes[need - 1] << 24)) >>> 0
  if (vtxTableCrc32(bytes.subarray(0, need - 4)) !== stored) {
    throw new VtxTableParseError('VTX table CRC mismatch.')
  }

  let o = VTX_TABLE_HEADER_LEN
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

  return { version, numChannels, bands }
}

/**
 * Serialize a VtxTable back into a @VTX/vtxtable.dat blob, byte-exact to the
 * firmware format (incl. the trailing crc_crc32). The inverse of
 * {@link parseVtxTable}: `parse(serialize(t))` deep-equals `t`.
 */
export function serializeVtxTable(table: VtxTable): Uint8Array {
  const numBands = table.bands.length
  const numChannels = table.numChannels
  const size =
    VTX_TABLE_HEADER_LEN + numBands * (VTX_TABLE_BAND_NAME_LEN + 2 + numChannels * 2) + 4
  const buf = new Uint8Array(size)
  let o = 0
  buf[o++] = VTX_TABLE_MAGIC & 0xff
  buf[o++] = (VTX_TABLE_MAGIC >> 8) & 0xff
  buf[o++] = VTX_TABLE_VERSION
  buf[o++] = numBands
  buf[o++] = numChannels
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
  const crc = vtxTableCrc32(buf.subarray(0, o))
  buf[o++] = crc & 0xff
  buf[o++] = (crc >> 8) & 0xff
  buf[o++] = (crc >> 16) & 0xff
  buf[o++] = (crc >> 24) & 0xff
  return buf
}

// ---------------------------------------------------------------------------
// Betaflight `vtxtable` CLI interchange — lets users import a table shared as
// a Betaflight CLI snippet (or full dump) and export the current table in the
// same format. Betaflight's vtxtable model maps 1:1 onto AP_VideoTX_Table with
// identical field limits (name ≤8, letter 1, label ≤3, freq 0 = disabled,
// FACTORY/CUSTOM), so the conversion is lossless. Reference:
// https://github.com/betaflight/betaflight/wiki/VTX-CLI-Settings
//
//   vtxtable bands <n>
//   vtxtable channels <n>
//   vtxtable band <1-based> <name(≤8, quote if spaces)> <letter> <FACTORY|CUSTOM> <freq…>
//   vtxtable powerlevels <n>
//   vtxtable powervalues <v…>
//   vtxtable powerlabels <l…>

/** Split a CLI line into tokens, honoring double-quoted band names. */
function tokenizeCliLine(line: string): string[] {
  const tokens: string[] = []
  const re = /"([^"]*)"|(\S+)/g
  let match: RegExpExecArray | null
  while ((match = re.exec(line)) !== null) {
    tokens.push(match[1] !== undefined ? match[1] : match[2])
  }
  return tokens
}

/**
 * Parse a Betaflight `vtxtable` table from CLI text (a bare snippet or a full
 * `diff`/`dump` — non-vtxtable lines are ignored). Throws
 * {@link VtxTableParseError} on a table that's missing required rows, is
 * internally inconsistent, or exceeds the firmware's limits (so the user gets
 * a clear reason rather than a silently-truncated table the FC can't hold).
 */
export interface BetaflightVtxTableImport {
  table: VtxTable
  /** From the snippet's powervalues/powerlabels rows; may be empty. */
  powerLevels: VtxTablePowerLevel[]
}

export function parseBetaflightVtxTable(text: string): BetaflightVtxTableImport {
  let numChannels: number | undefined
  const bandByIndex = new Map<number, VtxTableBand>()
  let powerValues: number[] | undefined
  let powerLabels: string[] | undefined

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim() // strip trailing comments
    if (line.length === 0) continue
    const tokens = tokenizeCliLine(line)
    if (tokens[0]?.toLowerCase() !== 'vtxtable' || tokens.length < 2) continue
    const kind = tokens[1].toLowerCase()
    if (kind === 'channels') {
      numChannels = Number(tokens[2])
    } else if (kind === 'band') {
      const index = Number(tokens[2])
      if (!Number.isInteger(index) || index < 1) {
        throw new VtxTableParseError(`Invalid vtxtable band index "${tokens[2]}".`)
      }
      const name = tokens[3] ?? ''
      const letter = tokens[4] ?? ''
      const factoryToken = (tokens[5] ?? '').toUpperCase()
      if (factoryToken !== 'FACTORY' && factoryToken !== 'CUSTOM') {
        throw new VtxTableParseError(`vtxtable band ${index} missing FACTORY/CUSTOM flag.`)
      }
      const frequencies = tokens.slice(6).map((token) => {
        const value = Number(token)
        return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0
      })
      bandByIndex.set(index, { name, letter: letter.slice(0, 1), isFactory: factoryToken === 'FACTORY', frequencies })
    } else if (kind === 'powervalues') {
      powerValues = tokens.slice(2).map((token) => Math.max(0, Math.round(Number(token) || 0)))
    } else if (kind === 'powerlabels') {
      powerLabels = tokens.slice(2).map((token) => token)
    }
    // `bands`/`powerlevels` counts are advisory — derived from the actual rows.
  }

  if (bandByIndex.size === 0) {
    throw new VtxTableParseError('No vtxtable band rows found in the imported text.')
  }
  // Assemble bands in index order, requiring a contiguous 1..N.
  const maxIndex = Math.max(...bandByIndex.keys())
  const bands: VtxTableBand[] = []
  for (let index = 1; index <= maxIndex; index += 1) {
    const band = bandByIndex.get(index)
    if (!band) {
      throw new VtxTableParseError(`vtxtable is missing band ${index} (bands must be a contiguous 1..N).`)
    }
    bands.push(band)
  }
  // Channel count: explicit `channels` row, else the widest band.
  const resolvedChannels = numChannels ?? Math.max(...bands.map((band) => band.frequencies.length))
  // Normalize every band to exactly `resolvedChannels` frequencies (pad 0 / trim).
  for (const band of bands) {
    if (band.frequencies.length < resolvedChannels) {
      band.frequencies = [...band.frequencies, ...new Array(resolvedChannels - band.frequencies.length).fill(0)]
    } else if (band.frequencies.length > resolvedChannels) {
      band.frequencies = band.frequencies.slice(0, resolvedChannels)
    }
  }
  const values = powerValues ?? []
  const labels = powerLabels ?? []
  const powerCount = Math.max(values.length, labels.length)
  const powerLevels: VtxTablePowerLevel[] = []
  for (let i = 0; i < powerCount; i += 1) {
    powerLevels.push({ value: values[i] ?? 0, label: (labels[i] ?? String(values[i] ?? 0)).slice(0, VTX_TABLE_POWER_LABEL_LEN) })
  }

  // Enforce the firmware's storage limits — a table that can't fit is an error,
  // not a silent truncation.
  if (bands.length > VTX_TABLE_MAX_BANDS) {
    throw new VtxTableParseError(`Too many bands (${bands.length}); the flight controller supports at most ${VTX_TABLE_MAX_BANDS}.`)
  }
  if (resolvedChannels > VTX_TABLE_MAX_CHANNELS) {
    throw new VtxTableParseError(`Too many channels (${resolvedChannels}); the maximum is ${VTX_TABLE_MAX_CHANNELS}.`)
  }
  if (powerLevels.length > VTX_TABLE_MAX_POWER_LEVELS) {
    throw new VtxTableParseError(`Too many power levels (${powerLevels.length}); the maximum is ${VTX_TABLE_MAX_POWER_LEVELS}.`)
  }
  const longName = bands.find((band) => band.name.length > VTX_TABLE_BAND_NAME_LEN)
  if (longName) {
    throw new VtxTableParseError(`Band name "${longName.name}" exceeds ${VTX_TABLE_BAND_NAME_LEN} characters.`)
  }

  return {
    table: { version: VTX_TABLE_VERSION, numChannels: resolvedChannels, bands },
    powerLevels
  }
}

/**
 * Render a table as a Betaflight `vtxtable` CLI snippet (the shareable format
 * users paste into a configurator or save to a file).
 *
 * Power is passed in separately because it no longer lives in the blob -- on
 * this firmware it is VTX_PWRTBL1..6 -- but the Betaflight interchange format
 * still carries it, and a snippet without power levels is not one another
 * configurator will accept.
 */
export function serializeBetaflightVtxTable(
  table: VtxTable,
  powerLevels: readonly VtxTablePowerLevel[] = []
): string {
  const quote = (name: string): string => (/\s/.test(name) ? `"${name}"` : name)
  const lines: string[] = []
  lines.push(`vtxtable bands ${table.bands.length}`)
  lines.push(`vtxtable channels ${table.numChannels}`)
  table.bands.forEach((band, index) => {
    const freqs = Array.from({ length: table.numChannels }, (_, c) => band.frequencies[c] ?? 0).join(' ')
    lines.push(
      `vtxtable band ${index + 1} ${quote(band.name)} ${band.letter || '?'} ${band.isFactory ? 'FACTORY' : 'CUSTOM'} ${freqs}`
    )
  })
  lines.push(`vtxtable powerlevels ${powerLevels.length}`)
  lines.push(`vtxtable powervalues ${powerLevels.map((level) => level.value).join(' ')}`)
  lines.push(`vtxtable powerlabels ${powerLevels.map((level) => level.label || String(level.value)).join(' ')}`)
  return lines.join('\n') + '\n'
}
