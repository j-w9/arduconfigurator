// The shape of the generated catalogue (tools/generate.py) and of decoded values.

/** A field or element type, as the generator writes it. */
export type DronecanTypeDesc =
  /** Primitive: b(ool), u(int), i(nt), f(loat); `c` is the cast mode (s)aturated / (t)runcated. */
  | { p: 'b' | 'u' | 'i' | 'f'; bits: number; c?: 's' | 't' }
  /** Void padding of `v` bits. */
  | { v: number }
  /** Array: element type, (s)tatic or (d)ynamic, max length, element minimum bit length. */
  | { a: DronecanTypeDesc; m: 's' | 'd'; max: number; eMin: number }
  /** A nested compound type, by full name. */
  | { r: string }

export interface DronecanFieldDesc {
  /** Field name; null for void padding. */
  n: string | null
  t: DronecanTypeDesc
}

export interface DronecanConstDesc {
  n: string
  t: DronecanTypeDesc
  v: number | boolean
}

export interface DronecanSectionDesc {
  union: boolean
  fields: DronecanFieldDesc[]
  consts: DronecanConstDesc[]
}

export interface DronecanTypeEntry {
  /** (m)essage or (s)ervice. */
  k: 'm' | 's'
  /** Default data type id; null for types that have none (nested-only). */
  id: number | null
  /** Data type signature, 16 hex digits. */
  sig: string
  msg?: DronecanSectionDesc
  req?: DronecanSectionDesc
  res?: DronecanSectionDesc
}

export interface DronecanCatalogueData {
  dsdlCommit: string
  types: Record<string, DronecanTypeEntry>
}

export type DronecanSectionKind = 'msg' | 'req' | 'res'

/**
 * A decoded value. Compounds are plain objects keyed by field name; a union
 * is an object with exactly one key (the active field); arrays are arrays.
 * Integers wider than 53 bits come back as bigint.
 */
export type DronecanValue =
  | number
  | bigint
  | boolean
  | DronecanValue[]
  | { [field: string]: DronecanValue }
