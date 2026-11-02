// Generic DroneCAN (UAVCAN v0) serialisation over the generated catalogue.
//
// This follows pydronecan's transport module bit for bit, because that is
// what defines the wire format in practice (libcanard and libuavcan agree with
// it): the stream is a string of bits; a primitive of N bits is written as
// its big-endian bits cut into 8-bit chunks from the LOW end, the low chunk
// first (le_from_be_bits), so multi-byte values are little-endian and a
// partial top chunk comes last; union tags and nothing else are written plain;
// a trailing dynamic array whose element is >= 8 bits drops its length prefix
// (tail array optimisation) when TAO is on -- always for classic CAN, never
// for CAN FD. Every rule here is pinned by test vectors that pydronecan
// itself produced (tests/fixtures/dronecan-dsdl-vectors.json).

import type {
  DronecanFieldDesc,
  DronecanSectionDesc,
  DronecanTypeDesc,
  DronecanValue
} from './types.js'

export class DronecanCodecError extends Error {}

/** Resolve a nested type's message section by full name. */
export type DronecanSectionResolver = (fullName: string) => DronecanSectionDesc

// ---------------------------------------------------------------------------
// Bits

export function bitsFromBytes(bytes: Uint8Array): string {
  let out = ''
  for (const byte of bytes) out += byte.toString(2).padStart(8, '0')
  return out
}

export function bytesFromBits(bits: string): Uint8Array {
  const padded = bits.length % 8 === 0 ? bits : bits + '0'.repeat(8 - (bits.length % 8))
  const out = new Uint8Array(padded.length / 8)
  for (let index = 0; index < out.length; index += 1) {
    out[index] = Number.parseInt(padded.slice(index * 8, index * 8 + 8), 2)
  }
  return out
}

/** pydronecan be_from_le_bits: the first `bitlen` bits, 8-bit chunks reversed. */
function beFromLeBits(stream: string, bitlen: number): string {
  if (stream.length < bitlen) {
    throw new DronecanCodecError(`Not enough bits: need ${bitlen}, have ${stream.length}.`)
  }
  const s = stream.slice(0, bitlen)
  const chunks: string[] = []
  for (let index = 0; index < s.length; index += 8) chunks.push(s.slice(index, index + 8))
  return chunks.reverse().join('')
}

/** pydronecan le_from_be_bits: 8-bit chunks taken from the end of `s`. */
function leFromBeBits(s: string, bitlen: number): string {
  const trimmed = s.length > bitlen ? s.slice(s.length - bitlen) : s
  const chunks: string[] = []
  for (let end = trimmed.length; end > 0; end -= 8) chunks.push(trimmed.slice(Math.max(0, end - 8), end))
  return chunks.join('')
}

function bitLength(value: number): number {
  return value <= 0 ? 0 : value.toString(2).length
}

/** ceil(log2(n)) for a union of n fields (0 for a single field). */
function unionTagBits(fieldCount: number): number {
  return fieldCount <= 1 ? 0 : bitLength(fieldCount - 1)
}

// ---------------------------------------------------------------------------
// float16 (translated from libuavcan, as pydronecan does)

const scratch = new DataView(new ArrayBuffer(4))

function floatOfBits(bits: number): number {
  scratch.setUint32(0, bits >>> 0)
  return scratch.getFloat32(0)
}

function bitsOfFloat(value: number): number {
  scratch.setFloat32(0, value)
  return scratch.getUint32(0)
}

/** float -> float16 bits: libuavcan's f16_from_f32, as pydronecan translates it. */
export function float16Bits(value: number): number {
  const f32infty = (255 << 23) >>> 0
  const f16infty = (31 << 23) >>> 0
  const magic = floatOfBits(15 << 23)
  let u = bitsOfFloat(value)
  const sign = (u & 0x80000000) >>> 0
  u = (u ^ sign) >>> 0
  let out: number
  if (u >= f32infty) {
    out = u > f32infty ? 0x7fff : 0x7c00
  } else {
    u = (u & ~0xfff) >>> 0 // clear the low 12 bits (round mask)
    u = bitsOfFloat(floatOfBits(u) * magic)
    u = (u + 0x1000) >>> 0 // u -= ~0xFFF, i.e. += 4096
    if (u > f16infty) u = f16infty
    out = (u >>> 13) & 0xffff
  }
  return (out | ((sign >>> 16) & 0xffff)) & 0xffff
}

/** float16 bits -> float: libuavcan's f32_from_f16. */
export function float16Value(bits: number): number {
  const magic = floatOfBits((254 - 15) << 23)
  const wasInfNan = floatOfBits((127 + 16) << 23)
  let u = ((bits & 0x7fff) << 13) >>> 0
  u = bitsOfFloat(floatOfBits(u) * magic)
  if (floatOfBits(u) >= wasInfNan) u = (u | (255 << 23)) >>> 0
  u = (u | ((bits & 0x8000) << 16)) >>> 0
  return floatOfBits(u)
}

// ---------------------------------------------------------------------------
// Primitives

type PrimitiveDesc = Extract<DronecanTypeDesc, { p: string }>

function decodePrimitive(desc: PrimitiveDesc, bits: string): number | bigint | boolean {
  const wide = desc.bits > 32
  const unsigned: bigint | number = wide ? BigInt(`0b${bits || '0'}`) : Number.parseInt(bits || '0', 2)
  switch (desc.p) {
    case 'b':
      return unsigned !== 0 && unsigned !== 0n
    case 'u':
      if (typeof unsigned === 'bigint') return desc.bits <= 53 || unsigned <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(unsigned) : unsigned
      return unsigned
    case 'i': {
      const big = BigInt(unsigned)
      const signed = big >= 1n << BigInt(desc.bits - 1) ? big - (1n << BigInt(desc.bits)) : big
      return signed >= BigInt(Number.MIN_SAFE_INTEGER) && signed <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(signed) : signed
    }
    case 'f': {
      if (desc.bits === 16) return float16Value(Number(unsigned))
      const view = new DataView(new ArrayBuffer(8))
      if (desc.bits === 32) {
        view.setUint32(0, Number(unsigned))
        return view.getFloat32(0)
      }
      view.setBigUint64(0, BigInt(unsigned))
      return view.getFloat64(0)
    }
  }
}

const FLOAT_LIMITS: Record<number, number> = { 16: 65504, 32: 3.4028234663852886e38, 64: Number.MAX_VALUE }

function encodePrimitive(desc: PrimitiveDesc, value: DronecanValue | undefined): string {
  const bits = desc.bits
  if (desc.p === 'b') return value ? '1' : '0'
  if (desc.p === 'f') {
    let number = typeof value === 'number' ? value : typeof value === 'bigint' ? Number(value) : 0
    const limit = FLOAT_LIMITS[bits]
    if (!Number.isNaN(number)) {
      if (desc.c === 's') number = Math.max(-limit, Math.min(limit, number))
      else if (number > limit) number = Number.POSITIVE_INFINITY
      else if (number < -limit) number = Number.NEGATIVE_INFINITY
    }
    let raw: bigint
    if (bits === 16) raw = BigInt(float16Bits(number))
    else {
      const view = new DataView(new ArrayBuffer(8))
      if (bits === 32) {
        view.setFloat32(0, number)
        raw = BigInt(view.getUint32(0))
      } else {
        view.setFloat64(0, number)
        raw = view.getBigUint64(0)
      }
    }
    return raw.toString(2).padStart(bits, '0')
  }
  let integer = typeof value === 'bigint' ? value : BigInt(Math.trunc(typeof value === 'number' ? value : value ? 1 : 0))
  const width = BigInt(bits)
  if (desc.p === 'u') {
    const max = (1n << width) - 1n
    integer = desc.c === 's' ? (integer < 0n ? 0n : integer > max ? max : integer) : integer & max
  } else {
    const min = -(1n << (width - 1n))
    const max = (1n << (width - 1n)) - 1n
    if (desc.c === 's') integer = integer < min ? min : integer > max ? max : integer
    else {
      integer = integer & ((1n << width) - 1n)
      if (integer > max) integer -= 1n << width
    }
    if (integer < 0n) integer += 1n << width
  }
  return integer.toString(2).padStart(bits, '0')
}

// ---------------------------------------------------------------------------
// Decode

interface Cursor {
  stream: string
  pos: number
}

function remaining(cursor: Cursor): number {
  return cursor.stream.length - cursor.pos
}

function take(cursor: Cursor, bitlen: number): string {
  const bits = beFromLeBits(cursor.stream.slice(cursor.pos), bitlen)
  cursor.pos += bitlen
  return bits
}

function decodeType(desc: DronecanTypeDesc, cursor: Cursor, tao: boolean, resolve: DronecanSectionResolver): DronecanValue {
  if ('p' in desc) return decodePrimitive(desc, take(cursor, desc.bits))
  if ('v' in desc) {
    cursor.pos += desc.v
    return 0
  }
  if ('r' in desc) return decodeSection(resolve(desc.r), cursor, tao, resolve)
  // Array
  const items: DronecanValue[] = []
  if (desc.m === 's') {
    for (let index = 0; index < desc.max; index += 1) {
      items.push(decodeType(desc.a, cursor, tao && index === desc.max - 1, resolve))
    }
    return items
  }
  if (tao && desc.eMin >= 8) {
    while (remaining(cursor) >= 8) items.push(decodeType(desc.a, cursor, false, resolve))
    cursor.pos = cursor.stream.length
    return items
  }
  const countWidth = bitLength(desc.max)
  const count = Number.parseInt(take(cursor, countWidth) || '0', 2)
  for (let index = 0; index < count; index += 1) {
    items.push(decodeType(desc.a, cursor, tao && index === count - 1, resolve))
  }
  return items
}

function decodeSection(
  section: DronecanSectionDesc,
  cursor: Cursor,
  tao: boolean,
  resolve: DronecanSectionResolver
): { [field: string]: DronecanValue } {
  const fields = section.fields
  if (section.union) {
    const tagBits = unionTagBits(fields.length)
    const tag = tagBits === 0 ? 0 : Number.parseInt(cursor.stream.slice(cursor.pos, cursor.pos + tagBits), 2)
    if (cursor.stream.length - cursor.pos < tagBits) throw new DronecanCodecError('Not enough bits for the union tag.')
    cursor.pos += tagBits
    const field: DronecanFieldDesc | undefined = fields[tag]
    if (!field) throw new DronecanCodecError(`Union tag ${tag} is out of range.`)
    const value = decodeType(field.t, cursor, tao, resolve)
    return field.n === null ? {} : { [field.n]: value }
  }
  const out: { [field: string]: DronecanValue } = {}
  fields.forEach((field, index) => {
    const value = decodeType(field.t, cursor, tao && index === fields.length - 1, resolve)
    if (field.n !== null) out[field.n] = value
  })
  return out
}

/** Decode a transfer payload (CRC already removed) against one section. */
export function decodeDronecanSection(
  section: DronecanSectionDesc,
  payload: Uint8Array,
  resolve: DronecanSectionResolver,
  tao = true
): { [field: string]: DronecanValue } {
  return decodeSection(section, { stream: bitsFromBytes(payload), pos: 0 }, tao, resolve)
}

// ---------------------------------------------------------------------------
// Encode

function encodeType(desc: DronecanTypeDesc, value: DronecanValue | undefined, tao: boolean, resolve: DronecanSectionResolver): string {
  if ('p' in desc) return leFromBeBits(encodePrimitive(desc, value), desc.bits)
  if ('v' in desc) return '0'.repeat(desc.v)
  if ('r' in desc) {
    return encodeSection(resolve(desc.r), isRecord(value) ? value : {}, tao, resolve)
  }
  const items = (Array.isArray(value) ? value : []).slice(0, desc.max)
  if (desc.m === 's') {
    let out = ''
    for (let index = 0; index < desc.max; index += 1) {
      out += encodeType(desc.a, items[index], tao && index === desc.max - 1, resolve)
    }
    return out
  }
  if (tao && desc.eMin >= 8) {
    return items.map((item) => encodeType(desc.a, item, false, resolve)).join('')
  }
  const countWidth = bitLength(desc.max)
  const count = leFromBeBits(items.length.toString(2).padStart(countWidth, '0'), countWidth)
  return count + items.map((item, index) => encodeType(desc.a, item, tao && index === items.length - 1, resolve)).join('')
}

function isRecord(value: DronecanValue | undefined): value is { [field: string]: DronecanValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function encodeSection(
  section: DronecanSectionDesc,
  value: { [field: string]: DronecanValue },
  tao: boolean,
  resolve: DronecanSectionResolver
): string {
  const fields = section.fields
  if (section.union) {
    const named = fields.map((field) => field.n)
    const chosen = Object.keys(value).find((key) => named.includes(key))
    const tag = chosen === undefined ? 0 : named.indexOf(chosen)
    const tagBits = unionTagBits(fields.length)
    const prefix = tagBits === 0 ? '' : tag.toString(2).padStart(tagBits, '0')
    return prefix + encodeType(fields[tag].t, chosen === undefined ? undefined : value[chosen], tao, resolve)
  }
  return fields
    .map((field, index) => encodeType(field.t, field.n === null ? undefined : value[field.n], tao && index === fields.length - 1, resolve))
    .join('')
}

/** Encode a value into a transfer payload (no CRC) against one section. */
export function encodeDronecanSection(
  section: DronecanSectionDesc,
  value: { [field: string]: DronecanValue },
  resolve: DronecanSectionResolver,
  tao = true
): Uint8Array {
  return bytesFromBits(encodeSection(section, value, tao, resolve))
}
