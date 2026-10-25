// Decode-only path for every message in ArduPilot's MAVLink dialect that the
// typed codec does not model. Driven by the generated table in
// generated/mavlink-generic.ts (scripts/generate-mavlink-generic.mjs).
// Field names are the XML's snake_case names, which is what MAVExplorer graph
// expressions use.

import { MAVLINK_GENERIC_ROWS } from './generated/mavlink-generic.js'

export interface GenericMavlinkMessage {
  type: 'GENERIC'
  name: string
  messageId: number
  fields: Record<string, number | number[] | string>
}

export type GenericFieldType =
  | 'double'
  | 'float'
  | 'uint64_t'
  | 'int64_t'
  | 'uint32_t'
  | 'int32_t'
  | 'uint16_t'
  | 'int16_t'
  | 'uint8_t'
  | 'int8_t'
  | 'char'

export interface GenericMessageField {
  name: string
  type: GenericFieldType
  /** Array length, 0 for a scalar. A char array decodes as a string. */
  arrayLength: number
  /** Extension field: excluded from crc_extra, may be absent on the wire. */
  extension: boolean
  /** Byte offset in the full (untruncated) payload. */
  offset: number
}

interface GenericMessageDef {
  id: number
  name: string
  crcExtra: number
  fields: GenericMessageField[]
  /** Full payload length including extensions. */
  length: number
}

const TYPE_BY_CODE: Record<string, [GenericFieldType, number]> = {
  d: ['double', 8],
  f: ['float', 4],
  Q: ['uint64_t', 8],
  q: ['int64_t', 8],
  I: ['uint32_t', 4],
  i: ['int32_t', 4],
  H: ['uint16_t', 2],
  h: ['int16_t', 2],
  B: ['uint8_t', 1],
  b: ['int8_t', 1],
  c: ['char', 1]
}

const TYPE_SIZE: Record<GenericFieldType, number> = Object.fromEntries(
  Object.values(TYPE_BY_CODE).map(([type, size]) => [type, size])
) as Record<GenericFieldType, number>

/** Message id by MAVLink name, for every message in the generated table. */
export const MAVLINK_GENERIC_ID_BY_NAME: Readonly<Record<string, number>> = Object.fromEntries(
  MAVLINK_GENERIC_ROWS.map(([id, name]) => [name, id])
)

const rowById = new Map(MAVLINK_GENERIC_ROWS.map((row) => [row[0], row]))
const defsById = new Map<number, GenericMessageDef>()

// Field layouts are parsed lazily, per message, on first use: the table has
// ~300 rows and a session only ever sees a few dozen of them.
function definitionFor(key: number | string): GenericMessageDef | undefined {
  const id = typeof key === 'number' ? key : Object.hasOwn(MAVLINK_GENERIC_ID_BY_NAME, key) ? MAVLINK_GENERIC_ID_BY_NAME[key] : undefined
  if (id === undefined) {
    return undefined
  }
  const cached = defsById.get(id)
  if (cached) {
    return cached
  }
  const row = rowById.get(id)
  if (!row) {
    return undefined
  }
  const [, name, crcExtra, spec] = row
  const fields: GenericMessageField[] = []
  let offset = 0
  const [base, ext = ''] = spec.split('|')
  for (const [part, extension] of [[base, false], [ext, true]] as const) {
    for (const entry of part ? part.split(',') : []) {
      const separator = entry.indexOf(':')
      const [type, size] = TYPE_BY_CODE[entry[separator + 1]]
      const arrayLength = Number(entry.slice(separator + 2) || 0)
      fields.push({ name: entry.slice(0, separator), type, arrayLength, extension, offset })
      offset += size * Math.max(1, arrayLength)
    }
  }
  const def: GenericMessageDef = { id, name, crcExtra, fields, length: offset }
  defsById.set(id, def)
  return def
}

/** crc_extra from the generated table, or undefined for an id it doesn't know. */
export function mavlinkGenericCrcExtra(messageId: number): number | undefined {
  return definitionFor(messageId)?.crcExtra
}

/** Full payload length (extensions included) for a generated-table id. */
export function mavlinkGenericPayloadLength(messageId: number): number | undefined {
  return definitionFor(messageId)?.length
}

/** Fields of a message in wire order, or undefined for an unknown name. */
export function genericMessageFields(name: string): readonly GenericMessageField[] | undefined {
  return definitionFor(name)?.fields
}

function readScalar(view: DataView, type: GenericFieldType, offset: number): number {
  switch (type) {
    case 'double':
      return view.getFloat64(offset, true)
    case 'float':
      return view.getFloat32(offset, true)
    case 'uint64_t':
      return Number(view.getBigUint64(offset, true))
    case 'int64_t':
      return Number(view.getBigInt64(offset, true))
    case 'uint32_t':
      return view.getUint32(offset, true)
    case 'int32_t':
      return view.getInt32(offset, true)
    case 'uint16_t':
      return view.getUint16(offset, true)
    case 'int16_t':
      return view.getInt16(offset, true)
    case 'uint8_t':
    case 'char':
      return view.getUint8(offset)
    case 'int8_t':
      return view.getInt8(offset)
  }
}

function writeScalar(view: DataView, type: GenericFieldType, offset: number, value: number): void {
  const finite = Number.isFinite(value) ? value : 0
  switch (type) {
    case 'double':
      view.setFloat64(offset, value, true)
      return
    case 'float':
      view.setFloat32(offset, value, true)
      return
    case 'uint64_t':
      view.setBigUint64(offset, BigInt.asUintN(64, BigInt(Math.trunc(finite))), true)
      return
    case 'int64_t':
      view.setBigInt64(offset, BigInt.asIntN(64, BigInt(Math.trunc(finite))), true)
      return
    case 'uint32_t':
      view.setUint32(offset, finite >>> 0, true)
      return
    case 'int32_t':
      view.setInt32(offset, finite | 0, true)
      return
    case 'uint16_t':
      view.setUint16(offset, finite & 0xffff, true)
      return
    case 'int16_t':
      view.setInt16(offset, finite, true)
      return
    case 'uint8_t':
    case 'char':
      view.setUint8(offset, finite & 0xff)
      return
    case 'int8_t':
      view.setInt8(offset, finite)
      return
  }
}

const textDecoder = new TextDecoder()
const textEncoder = new TextEncoder()

/**
 * Decode a payload for any message in the generated table. A v2 sender trims
 * trailing zero bytes, so the payload is zero-extended to the full length
 * first; bytes past the known length (a newer extension) are ignored.
 */
export function decodeGenericPayload(messageId: number, payload: Uint8Array): GenericMavlinkMessage | undefined {
  const def = definitionFor(messageId)
  if (!def) {
    return undefined
  }
  const bytes = new Uint8Array(def.length)
  bytes.set(payload.subarray(0, def.length))
  const view = new DataView(bytes.buffer)
  const fields: GenericMavlinkMessage['fields'] = {}
  for (const field of def.fields) {
    if (field.type === 'char' && field.arrayLength > 0) {
      const raw = bytes.subarray(field.offset, field.offset + field.arrayLength)
      const nul = raw.indexOf(0)
      fields[field.name] = textDecoder.decode(nul === -1 ? raw : raw.subarray(0, nul))
    } else if (field.arrayLength > 0) {
      const size = TYPE_SIZE[field.type]
      fields[field.name] = Array.from({ length: field.arrayLength }, (_, index) =>
        readScalar(view, field.type, field.offset + index * size)
      )
    } else {
      fields[field.name] = readScalar(view, field.type, field.offset)
    }
  }
  return { type: 'GENERIC', name: def.name, messageId: def.id, fields }
}

/**
 * Encode a payload by message name (for the mock and tests). Missing fields
 * are zero; trailing zero bytes are trimmed as a v2 sender does, keeping at
 * least one byte. Throws for a name the table doesn't know.
 */
export function encodeGenericPayload(
  name: string,
  fields: Readonly<Record<string, number | readonly number[] | string>>
): Uint8Array {
  const def = definitionFor(name)
  if (!def) {
    throw new Error(`Unknown MAVLink message ${name}.`)
  }
  const bytes = new Uint8Array(def.length)
  const view = new DataView(bytes.buffer)
  for (const field of def.fields) {
    const value = fields[field.name]
    if (value === undefined) {
      continue
    }
    if (typeof value === 'string') {
      bytes.set(textEncoder.encode(value).subarray(0, Math.max(1, field.arrayLength)), field.offset)
    } else if (typeof value === 'number') {
      writeScalar(view, field.type, field.offset, value)
    } else {
      const size = TYPE_SIZE[field.type]
      value.slice(0, field.arrayLength).forEach((entry, index) => writeScalar(view, field.type, field.offset + index * size, entry))
    }
  }
  let length = bytes.length
  while (length > 1 && bytes[length - 1] === 0) {
    length -= 1
  }
  return bytes.slice(0, length)
}
