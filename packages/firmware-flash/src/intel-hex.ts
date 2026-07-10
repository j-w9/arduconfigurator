// Intel HEX parser for ArduPilot DFU `.hex` images. ArduPilot publishes a
// `.hex` alongside each board's `.apj`; the `.hex` carries absolute flash
// addresses (STM32 internal flash starts at 0x08000000) and is what gets
// programmed over the STM32 DFU bootloader (DfuSe). This module is pure — it
// turns the text into address/data segments — so the DFU client and the UI can
// reason about what will be written before any USB traffic happens.
//
// Record types handled: 0x00 data, 0x01 end-of-file, 0x02 extended segment
// address, 0x04 extended linear address, 0x03/0x05 start address (entry point,
// ignored for flashing). Anything else is rejected so a malformed/truncated
// file fails loudly instead of flashing garbage.

/** A contiguous run of bytes destined for an absolute address. */
export interface IntelHexSegment {
  address: number
  data: Uint8Array
}

export interface ParsedIntelHex {
  /** Contiguous segments, ascending by address, gaps preserved (not padded). */
  segments: IntelHexSegment[]
  /** Lowest address written (e.g. 0x08000000), or 0 when empty. */
  minAddress: number
  /** One past the highest address written, or 0 when empty. */
  endAddress: number
  /** Total payload bytes across all segments. */
  totalBytes: number
}

const RECORD_DATA = 0x00
const RECORD_EOF = 0x01
const RECORD_EXT_SEGMENT = 0x02
const RECORD_EXT_LINEAR = 0x04
const RECORD_START_SEGMENT = 0x03
const RECORD_START_LINEAR = 0x05

/**
 * Parse an Intel HEX file into address-ordered segments. Throws on any
 * structural error (bad prefix, odd length, checksum mismatch, unknown record
 * type, data after EOF) — callers surface that as a load failure.
 */
export function parseIntelHex(text: string): ParsedIntelHex {
  // upperBase = the high address bits set by the most recent 0x02/0x04 record.
  let upperBase = 0
  let sawEof = false
  // Collect raw (address,data) writes, then coalesce into segments afterwards.
  const writes: IntelHexSegment[] = []

  const lines = text.split(/\r?\n/)
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const raw = lines[lineIndex].trim()
    if (raw.length === 0) {
      continue
    }
    const where = `line ${lineIndex + 1}`
    if (raw[0] !== ':') {
      throw new Error(`Invalid Intel HEX (${where}): record does not start with ':'`)
    }
    const body = raw.slice(1)
    if (body.length % 2 !== 0 || body.length < 10) {
      throw new Error(`Invalid Intel HEX (${where}): record has an odd or short length`)
    }
    const bytes = hexToBytes(body, where)
    const byteCount = bytes[0]
    if (bytes.length !== byteCount + 5) {
      throw new Error(`Invalid Intel HEX (${where}): byte count ${byteCount} does not match record length`)
    }
    // Checksum: sum of every byte including the trailing checksum is 0 mod 256.
    const sum = bytes.reduce((acc, value) => (acc + value) & 0xff, 0)
    if (sum !== 0) {
      throw new Error(`Invalid Intel HEX (${where}): checksum mismatch`)
    }
    if (sawEof) {
      throw new Error(`Invalid Intel HEX (${where}): record found after end-of-file`)
    }

    const recordType = bytes[3]
    const offset = (bytes[1] << 8) | bytes[2]
    const data = bytes.slice(4, 4 + byteCount)

    switch (recordType) {
      case RECORD_DATA:
        writes.push({ address: (upperBase + offset) >>> 0, data })
        break
      case RECORD_EOF:
        if (byteCount !== 0) {
          throw new Error(`Invalid Intel HEX (${where}): end-of-file record carries data`)
        }
        sawEof = true
        break
      case RECORD_EXT_LINEAR:
        if (byteCount !== 2) {
          throw new Error(`Invalid Intel HEX (${where}): extended linear address record must be 2 bytes`)
        }
        upperBase = ((data[0] << 8) | data[1]) * 0x10000
        break
      case RECORD_EXT_SEGMENT:
        if (byteCount !== 2) {
          throw new Error(`Invalid Intel HEX (${where}): extended segment address record must be 2 bytes`)
        }
        upperBase = ((data[0] << 8) | data[1]) * 0x10
        break
      case RECORD_START_SEGMENT:
      case RECORD_START_LINEAR:
        // Entry-point hint only; irrelevant to flashing.
        break
      default:
        throw new Error(`Invalid Intel HEX (${where}): unsupported record type 0x${recordType.toString(16)}`)
    }
  }

  if (!sawEof) {
    throw new Error('Invalid Intel HEX: missing end-of-file (:00000001FF) record')
  }

  return coalesce(writes)
}

function hexToBytes(hex: string, where: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i += 1) {
    const byte = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
    if (Number.isNaN(byte)) {
      throw new Error(`Invalid Intel HEX (${where}): non-hex characters in record`)
    }
    out[i] = byte
  }
  return out
}

/** Sort writes by address and merge contiguous/overlapping runs into segments.
 *
 * A real ArduPilot .hex has one data record per 16-32 bytes, so a 1-2 MB
 * image is tens of thousands of records. Allocating and copying the WHOLE
 * accumulated segment on every contiguous record (the previous approach)
 * is O(n^2) in the segment size — that quadratic blowup is exactly what made
 * loading a large .hex file feel like it hung the browser. This does two
 * O(n) passes instead: first group runs and total their length without
 * touching any bytes, then allocate each final segment's buffer once and
 * copy each run into its slot directly. */
function coalesce(writes: IntelHexSegment[]): ParsedIntelHex {
  if (writes.length === 0) {
    return { segments: [], minAddress: 0, endAddress: 0, totalBytes: 0 }
  }
  const ordered = [...writes].sort((a, b) => a.address - b.address)

  interface PendingSegment {
    address: number
    length: number
    runs: IntelHexSegment[]
  }
  const pending: PendingSegment[] = []
  for (const write of ordered) {
    const current = pending[pending.length - 1]
    const currentEnd = current ? current.address + current.length : undefined
    if (current && write.address === currentEnd) {
      current.length += write.data.length
      current.runs.push(write)
      continue
    }
    if (current && write.address < (currentEnd as number)) {
      throw new Error(
        `Invalid Intel HEX: overlapping data at 0x${write.address.toString(16)} — refusing to flash an ambiguous image`
      )
    }
    pending.push({ address: write.address, length: write.data.length, runs: [write] })
  }

  const segments: IntelHexSegment[] = pending.map((segment) => {
    const data = new Uint8Array(segment.length)
    let offset = 0
    for (const run of segment.runs) {
      data.set(run.data, offset)
      offset += run.data.length
    }
    return { address: segment.address, data }
  })

  const minAddress = segments[0].address
  const lastSegment = segments[segments.length - 1]
  const endAddress = lastSegment.address + lastSegment.data.length
  const totalBytes = segments.reduce((acc, segment) => acc + segment.data.length, 0)
  return { segments, minAddress, endAddress, totalBytes }
}
