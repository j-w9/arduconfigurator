// In-browser parser for ArduPilot **DataFlash** binary logs (the `.bin` files
// downloaded from the flight controller's SD card / dataflash). It is the
// foundation for every log-based analysis (MAGFit compass calibration, filter /
// notch tuning, PID review, …): it turns the opaque binary blob into typed
// message records keyed by message name.
//
// Format (AP_Logger): the stream is a sequence of messages, each framed by two
// head bytes (0xA3 0x95) followed by a 1-byte message type. FMT messages
// (type 0x80) are self-describing schema records — they define the byte layout
// and column names of every other message type, INCLUDING FMT itself (the log
// always opens with the FMT-defines-FMT record). We bootstrap FMT from its
// fixed layout, then decode every subsequent message against the schema.
//
// Field type codes and their built-in scaling match pymavlink's DFReader
// (FORMAT_TO_STRUCT), so a decoded value equals what `magfit_WMM.py` &co. read
// — the oracle we validate against. Everything is little-endian.
//
// Provenance: the format/type-code table mirrors ArduPilot's AP_Logger and
// pymavlink DFReader (both GPL-3.0), consistent with this repo's licence.

const HEAD_BYTE1 = 0xa3
const HEAD_BYTE2 = 0x95
const FMT_TYPE = 0x80
// FMT body layout: type(u8) length(u8) name(char[4]) format(char[16]) columns(char[64]).
const FMT_BODY_LENGTH = 1 + 1 + 4 + 16 + 64
const FMT_MESSAGE_LENGTH = 3 + FMT_BODY_LENGTH

/** One field type code: its on-wire byte size, and how to read/convert it. */
interface TypeCode {
  size: number
  /** Read the value at `offset` in the little-endian DataView. */
  read: (view: DataView, offset: number) => number | string | number[]
}

const textDecoder = new TextDecoder('latin1')

function readString(view: DataView, offset: number, length: number): string {
  const bytes = new Uint8Array(view.buffer, view.byteOffset + offset, length)
  const nul = bytes.indexOf(0)
  const slice = nul === -1 ? bytes : bytes.subarray(0, nul)
  return textDecoder.decode(slice)
}

// Field type codes, matching pymavlink DFReader.FORMAT_TO_STRUCT. The built-in
// multipliers on c/C/e/E (×0.01) and L (×1e-7) are applied here so decoded
// values are in the same units DFReader yields.
const TYPE_CODES: Record<string, TypeCode> = {
  b: { size: 1, read: (v, o) => v.getInt8(o) },
  B: { size: 1, read: (v, o) => v.getUint8(o) },
  h: { size: 2, read: (v, o) => v.getInt16(o, true) },
  H: { size: 2, read: (v, o) => v.getUint16(o, true) },
  i: { size: 4, read: (v, o) => v.getInt32(o, true) },
  I: { size: 4, read: (v, o) => v.getUint32(o, true) },
  f: { size: 4, read: (v, o) => v.getFloat32(o, true) },
  d: { size: 8, read: (v, o) => v.getFloat64(o, true) },
  n: { size: 4, read: (v, o) => readString(v, o, 4) },
  N: { size: 16, read: (v, o) => readString(v, o, 16) },
  Z: { size: 64, read: (v, o) => readString(v, o, 64) },
  c: { size: 2, read: (v, o) => v.getInt16(o, true) * 0.01 },
  C: { size: 2, read: (v, o) => v.getUint16(o, true) * 0.01 },
  e: { size: 4, read: (v, o) => v.getInt32(o, true) * 0.01 },
  E: { size: 4, read: (v, o) => v.getUint32(o, true) * 0.01 },
  L: { size: 4, read: (v, o) => v.getInt32(o, true) * 1e-7 },
  M: { size: 1, read: (v, o) => v.getInt8(o) },
  q: { size: 8, read: (v, o) => Number(v.getBigInt64(o, true)) },
  Q: { size: 8, read: (v, o) => Number(v.getBigUint64(o, true)) },
  // int16[32] batch array (used by the IMU batch sampler ISBD messages).
  a: {
    size: 64,
    read: (v, o) => {
      const out: number[] = new Array(32)
      for (let i = 0; i < 32; i += 1) {
        out[i] = v.getInt16(o + i * 2, true)
      }
      return out
    }
  }
}

/** A message's schema, as declared by a FMT record. */
export interface DataflashFormat {
  type: number
  length: number
  name: string
  /** Field type codes (one char per column). */
  format: string
  columns: string[]
}

/** A decoded message: its name plus each column as a keyed value. */
export type DataflashMessage = { readonly name: string } & Record<string, number | string | number[]>

export interface ParsedDataflashLog {
  /** Decoded messages grouped by message name (e.g. "MAG", "ATT", "GPS"). */
  messagesByType: Map<string, DataflashMessage[]>
  /** Schema of every message type seen (keyed by name). */
  formats: Map<string, DataflashFormat>
  /** Count of each message name (cheap summary without walking the arrays). */
  counts: Map<string, number>
  /** Bytes that could not be resynchronised to a valid frame. */
  skippedBytes: number
}

function bodyLength(format: string): number {
  let total = 0
  for (const ch of format) {
    const code = TYPE_CODES[ch]
    if (!code) {
      return Number.NaN
    }
    total += code.size
  }
  return total
}

function decodeBody(format: DataflashFormat, view: DataView, bodyOffset: number): DataflashMessage {
  const record: Record<string, number | string | number[]> = { name: format.name }
  let offset = bodyOffset
  for (let i = 0; i < format.format.length; i += 1) {
    const code = TYPE_CODES[format.format[i]]
    const column = format.columns[i] ?? `f${i}`
    // A FMT with more format chars than columns (or vice-versa) is malformed;
    // decode what we can and leave the rest absent rather than throwing.
    if (!code) {
      break
    }
    record[column] = code.read(view, offset)
    offset += code.size
  }
  return record as DataflashMessage
}

/**
 * Parse a DataFlash `.bin` log. Resilient to a corrupt/truncated tail: a byte
 * that is not a valid frame head is skipped and resynchronised, and a truncated
 * final message is dropped rather than throwing.
 */
export function parseDataflashLog(input: ArrayBuffer | Uint8Array): ParsedDataflashLog {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const formats = new Map<number, DataflashFormat>()
  const formatsByName = new Map<string, DataflashFormat>()
  const messagesByType = new Map<string, DataflashMessage[]>()
  const counts = new Map<string, number>()
  let skippedBytes = 0

  let pos = 0
  const end = bytes.length
  while (pos + 3 <= end) {
    if (bytes[pos] !== HEAD_BYTE1 || bytes[pos + 1] !== HEAD_BYTE2) {
      // Not a frame boundary — skip one byte and try to resync.
      skippedBytes += 1
      pos += 1
      continue
    }
    const type = bytes[pos + 2]

    if (type === FMT_TYPE) {
      if (pos + FMT_MESSAGE_LENGTH > end) {
        break // truncated FMT at EOF
      }
      const bodyOffset = pos + 3
      const definedType = view.getUint8(bodyOffset)
      const length = view.getUint8(bodyOffset + 1)
      const name = readString(view, bodyOffset + 2, 4)
      const format = readString(view, bodyOffset + 6, 16)
      const columnsRaw = readString(view, bodyOffset + 22, 64)
      const columns = columnsRaw.length > 0 ? columnsRaw.split(',') : []
      const def: DataflashFormat = { type: definedType, length, name, format, columns }
      formats.set(definedType, def)
      formatsByName.set(name, def)
      // A FMT record is schema, not an instance of the message it defines —
      // record it under "FMT" (matching DFReader), never as a `name` message.
      recordMessage(messagesByType, counts, {
        name: 'FMT',
        Type: definedType,
        Length: length,
        Name: name,
        Format: format,
        Columns: columnsRaw
      })
      pos += FMT_MESSAGE_LENGTH
      continue
    }

    const def = formats.get(type)
    if (!def || !Number.isFinite(bodyLength(def.format)) || def.length < 3) {
      // Unknown type (its FMT hasn't been seen) or malformed schema: resync.
      skippedBytes += 1
      pos += 1
      continue
    }
    if (pos + def.length > end) {
      break // truncated message at EOF
    }
    recordMessage(messagesByType, counts, decodeBody(def, view, pos + 3))
    pos += def.length
  }

  return { messagesByType, formats: formatsByName, counts, skippedBytes }
}

function recordMessage(
  messagesByType: Map<string, DataflashMessage[]>,
  counts: Map<string, number>,
  message: DataflashMessage
): void {
  let bucket = messagesByType.get(message.name)
  if (!bucket) {
    bucket = []
    messagesByType.set(message.name, bucket)
  }
  bucket.push(message)
  counts.set(message.name, (counts.get(message.name) ?? 0) + 1)
}
