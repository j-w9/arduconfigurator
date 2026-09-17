import { MAV_FTP_ERR } from '@arduconfig/protocol-mavlink'

import type { BoardSerialPortMapping } from './types.js'

const MAVFTP_DATA_OFFSET = 12
const MAVFTP_MAX_DATA_SIZE = 239

export type MavftpDirectoryEntryKind = 'file' | 'directory'

export interface MavftpPayload {
  seqNumber: number
  session: number
  opcode: number
  size: number
  reqOpcode: number
  burstComplete: number
  offset: number
  data: Uint8Array
}

export interface MavftpDirectoryEntry {
  name: string
  path: string
  kind: MavftpDirectoryEntryKind
  sizeBytes?: number
}

export class MavftpRequestError extends Error {
  readonly errorCode: number
  readonly errno?: number

  constructor(errorCode: number, errno?: number) {
    super(formatMavftpNakError(errorCode, errno))
    this.name = 'MavftpRequestError'
    this.errorCode = errorCode
    this.errno = errno
  }
}

export function decodeMavftpPayload(bytes: Uint8Array): MavftpPayload {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const size = bytes[4] ?? 0
  return {
    seqNumber: view.getUint16(0, true),
    session: bytes[2] ?? 0,
    opcode: bytes[3] ?? 0,
    size,
    reqOpcode: bytes[5] ?? 0,
    burstComplete: bytes[6] ?? 0,
    offset: view.getUint32(8, true),
    data: bytes.slice(MAVFTP_DATA_OFFSET, MAVFTP_DATA_OFFSET + size)
  }
}

export function encodeMavftpPayload(payload: MavftpPayload): Uint8Array {
  const bytes = new Uint8Array(251)
  const view = new DataView(bytes.buffer)
  view.setUint16(0, payload.seqNumber & 0xffff, true)
  bytes[2] = payload.session & 0xff
  bytes[3] = payload.opcode & 0xff
  bytes[4] = payload.size & 0xff
  bytes[5] = payload.reqOpcode & 0xff
  bytes[6] = payload.burstComplete & 0xff
  bytes[7] = 0
  view.setUint32(8, payload.offset >>> 0, true)
  bytes.set(payload.data.slice(0, Math.min(payload.size, MAVFTP_MAX_DATA_SIZE)), MAVFTP_DATA_OFFSET)
  return bytes
}

export function boardTypeFromBoardVersion(boardVersion: number): number {
  return boardVersion >>> 16
}

export function formatMavftpNakError(errorCode: number, errno?: number): string {
  switch (errorCode) {
    case MAV_FTP_ERR.NONE:
      return 'No error'
    case MAV_FTP_ERR.FAIL:
      return 'Unknown FTP failure'
    case MAV_FTP_ERR.FAIL_ERRNO:
      return errno === undefined ? 'FTP failure with errno' : `FTP failure with errno ${errno}`
    case MAV_FTP_ERR.INVALID_DATA_SIZE:
      return 'Invalid FTP data size'
    case MAV_FTP_ERR.INVALID_SESSION:
      return 'Invalid FTP session'
    case MAV_FTP_ERR.NO_SESSIONS_AVAILABLE:
      return 'No FTP sessions available'
    case MAV_FTP_ERR.EOF:
      return 'End of file'
    case MAV_FTP_ERR.UNKNOWN_COMMAND:
      return 'Unknown FTP command'
    case MAV_FTP_ERR.FILE_EXISTS:
      return 'File already exists'
    case MAV_FTP_ERR.FILE_PROTECTED:
      return 'File is protected'
    case MAV_FTP_ERR.FILE_NOT_FOUND:
      return 'File not found'
    default:
      return `FTP error ${errorCode}`
  }
}

export function formatAutopilotUid(uid: bigint, uid2?: Uint8Array): string | undefined {
  if (uid2 && uid2.some((byte) => byte !== 0)) {
    return [...uid2].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  }
  if (uid === 0n) {
    return undefined
  }
  return uid.toString(16).padStart(16, '0')
}

// MAV_FIRMWARE_VERSION_TYPE codes packed into the low byte of
// AUTOPILOT_VERSION.flight_sw_version.
const FIRMWARE_VERSION_TYPE_LABELS: Record<number, string> = {
  0: 'dev',
  64: 'alpha',
  128: 'beta',
  192: 'rc',
  255: 'official'
}

/** Decode AUTOPILOT_VERSION.flight_sw_version (packed
 *  major<<24 | minor<<16 | patch<<8 | type) into "major.minor.patch
 *  (type)". Returns undefined for 0 (no version reported). */
export function formatFlightSwVersion(flightSwVersion: number): string | undefined {
  if (!Number.isFinite(flightSwVersion) || flightSwVersion === 0) {
    return undefined
  }
  const v = flightSwVersion >>> 0
  const major = (v >>> 24) & 0xff
  const minor = (v >>> 16) & 0xff
  const patch = (v >>> 8) & 0xff
  const typeCode = v & 0xff
  const typeLabel = FIRMWARE_VERSION_TYPE_LABELS[typeCode]
  const base = `${major}.${minor}.${patch}`
  return typeLabel && typeLabel !== 'official' ? `${base} (${typeLabel})` : base
}

export interface FlightSwVersionParts {
  major: number
  minor: number
  patch: number
}

/** Parse AUTOPILOT_VERSION.flight_sw_version into numeric major/minor/patch for
 *  version comparisons (e.g. 4.6 vs 4.7 feature gating). Returns undefined for 0
 *  / non-finite (no version reported yet). */
export function parseFlightSwVersion(flightSwVersion: number): FlightSwVersionParts | undefined {
  if (!Number.isFinite(flightSwVersion) || flightSwVersion === 0) {
    return undefined
  }
  const v = flightSwVersion >>> 0
  return {
    major: (v >>> 24) & 0xff,
    minor: (v >>> 16) & 0xff,
    patch: (v >>> 8) & 0xff
  }
}

/** True when `parts` is at least major.minor. Used to gate UI/metadata that
 *  diverged between firmware releases (e.g. ARMING_CHECK→ARMING_SKIPCHK in 4.7).
 *  Returns undefined when the version is unknown so callers can fall back to
 *  another signal (e.g. which param the FC actually streamed). */
export function firmwareVersionAtLeast(
  parts: FlightSwVersionParts | undefined,
  major: number,
  minor: number
): boolean | undefined {
  if (!parts) {
    return undefined
  }
  return parts.major > major || (parts.major === major && parts.minor >= minor)
}

/** flight_custom_version is up to 8 ASCII bytes — the firmware build's git
 *  hash (ArduPilot copies fwversion().fw_hash_str directly). Returns the
 *  trimmed string only when it looks like a git hash (≥4 chars, all
 *  hex/digit) so partial corruption or mock-padding bytes don't surface
 *  as garbage like "$&". Undefined when the bytes are empty, all
 *  non-printable, or don't resemble a hash. */
export function formatFlightCustomVersion(bytes: Uint8Array | undefined): string | undefined {
  if (!bytes || bytes.length === 0) {
    return undefined
  }
  const ascii = [...bytes]
    .filter((byte) => byte >= 32 && byte < 127)
    .map((byte) => String.fromCharCode(byte))
    .join('')
    .trim()
  if (ascii.length === 0) {
    return undefined
  }
  // Real ArduPilot fw_hash_str is the first 8 chars of the git SHA, always
  // 0-9a-f. Reject anything that isn't (mocks with magic bytes like
  // 0xDEADBEEF land here — 0x24 '$' / 0x26 '&' / 0x03 / 0x01 yield "$&"
  // after the printable filter, which is what was leaking into backups).
  if (!/^[0-9a-fA-F]{4,16}$/.test(ascii)) {
    return undefined
  }
  return ascii
}

export function joinMavftpPath(parentPath: string, name: string): string {
  const normalizedParent = normalizeMavftpPath(parentPath)
  const normalizedName = name.replace(/^\/+/, '').replace(/\/+$/, '')
  if (!normalizedName) {
    return normalizedParent
  }
  if (normalizedParent === '/') {
    return `/${normalizedName}`
  }
  return `${normalizedParent}/${normalizedName}`
}

export function normalizeMavftpPath(path: string): string {
  const trimmed = path.trim()
  if (!trimmed) {
    return '@SYS'
  }
  if (trimmed === '/') {
    return trimmed
  }

  const collapsed = trimmed.replace(/\/+/g, '/')
  if (/^@[A-Za-z0-9_-]+$/.test(collapsed)) {
    return collapsed
  }

  return collapsed.replace(/\/+$/, '')
}

export function parentMavftpPath(path: string): string | undefined {
  const normalizedPath = normalizeMavftpPath(path)
  if (normalizedPath === '/' || /^@[A-Za-z0-9_-]+$/.test(normalizedPath)) {
    return undefined
  }

  const lastSeparatorIndex = normalizedPath.lastIndexOf('/')
  if (lastSeparatorIndex <= 0) {
    return undefined
  }

  return normalizedPath.slice(0, lastSeparatorIndex)
}

export function parseMavftpDirectoryEntries(directoryPath: string, data: Uint8Array): MavftpDirectoryEntry[] {
  const decoded = new TextDecoder().decode(data).replace(/\0+$/, '')
  if (!decoded) {
    return []
  }

  const normalizedDirectoryPath = normalizeMavftpPath(directoryPath)
  return decoded
    .split('\0')
    .map((entry) => parseMavftpDirectoryEntry(normalizedDirectoryPath, entry))
    .filter((entry): entry is MavftpDirectoryEntry => entry !== undefined)
}

export function parseUartsFile(rawText: string): BoardSerialPortMapping[] {
  return rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('SERIAL'))
    .map((line) => parseUartsLine(line))
    .filter((mapping): mapping is BoardSerialPortMapping => mapping !== undefined)
    .sort((left, right) => left.serialPortNumber - right.serialPortNumber)
}

function parseUartsLine(line: string): BoardSerialPortMapping | undefined {
  // The real format, from AP_HAL_ChibiOS/UARTDriver.cpp:
  //
  //   TX%c=%8u RX%c=%8u TXBD=%6u RXBD=%6u RXDRP=%8u [FE=%lu OE=%lu NE=%lu] FlowCtrl=%u
  //
  // The previous pattern anchored with `RXBD=(\d+)$`, so it never matched a
  // real board — every line fell through to the name-only branch below and came
  // back with txActive/rxActive hardcoded false and no counters at all. That is
  // why the traffic summary always read "Idle".
  //
  // FE/OE/NE are compiled out when CH_CFG_USE_EVENTS is off, so they are
  // optional here rather than assumed.
  const detailedMatch = line.match(
    /^SERIAL(\d+)\s+(\S+)\s+TX(\*?)\s*=\s*(\d+)\s+RX(\*?)\s*=\s*(\d+)\s+TXBD=\s*(\d+)\s+RXBD=\s*(\d+)\s+RXDRP=\s*(\d+)/i
  )
  if (detailedMatch) {
    // TX/RX are the CHANGE since the last read (StatsTracker::update), so a
    // non-zero count means the port moved bytes in that window — which is the
    // activity signal. The asterisk is DMA, not activity.
    const txBytes = Number(detailedMatch[4])
    const rxBytes = Number(detailedMatch[6])
    return {
      serialPortNumber: Number(detailedMatch[1]),
      hardwarePort: detailedMatch[2],
      txActive: txBytes > 0,
      rxActive: rxBytes > 0,
      txDma: detailedMatch[3] === '*',
      rxDma: detailedMatch[5] === '*',
      txBytes,
      rxBytes,
      txThroughput: Number(detailedMatch[7]),
      rxThroughput: Number(detailedMatch[8]),
      rxDroppedBytes: Number(detailedMatch[9])
    }
  }

  const simpleMatch = line.match(/^SERIAL(\d+)\s+(\S+)/i)
  if (!simpleMatch) {
    return undefined
  }

  return {
    serialPortNumber: Number(simpleMatch[1]),
    hardwarePort: simpleMatch[2],
    txActive: false,
    rxActive: false
  }
}


// Reject device-supplied entry names that could escape their directory if
// a name is ever mapped to a local filesystem path. Names are FC-controlled,
// so treat path separators and dot segments as untrusted.
function isSafeMavftpEntryName(name: string): boolean {
  return name !== '.' && name !== '..' && !name.includes('/') && !name.includes('\\')
}

function parseMavftpDirectoryEntry(directoryPath: string, rawEntry: string): MavftpDirectoryEntry | undefined {
  const entry = rawEntry.trim()
  if (!entry) {
    return undefined
  }

  const kindPrefix = entry[0]
  const rest = entry.slice(1)

  if (kindPrefix === 'D') {
    const name = rest.trim()
    if (!name || !isSafeMavftpEntryName(name)) {
      return undefined
    }
    return {
      name,
      path: joinMavftpPath(directoryPath, name),
      kind: 'directory'
    }
  }

  if (kindPrefix === 'F') {
    const [namePart, sizePart] = rest.split('\t')
    const name = namePart?.trim()
    if (!name || !isSafeMavftpEntryName(name)) {
      return undefined
    }
    const parsedSize = sizePart === undefined ? Number.NaN : Number(sizePart.trim())
    return {
      name,
      path: joinMavftpPath(directoryPath, name),
      kind: 'file',
      sizeBytes: Number.isFinite(parsedSize) ? parsedSize : undefined
    }
  }

  return undefined
}
