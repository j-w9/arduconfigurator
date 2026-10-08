// Frame filters, written the way CAN tools write them.
//
// The id expression is a list of terms separated by commas or spaces. Ids are
// always hexadecimal (with or without 0x), because every CAN tool and data
// sheet writes them that way:
//
//   123            one id
//   100-1FF        an inclusive range
//   1E0A3C7F/1FFFFF00   id/mask: a frame matches when (frameId & mask) === (id & mask)
//   !341           exclude (any term can be negated)
//
// A frame is shown when it matches at least one include term (or there are
// none) and no exclude term. Kind, direction and payload filters apply on top.

import type { CanFrame, CanFrameDirection } from './frame.js'

export type CanIdTerm =
  | { kind: 'exact'; id: number; negate: boolean }
  | { kind: 'range'; low: number; high: number; negate: boolean }
  | { kind: 'mask'; id: number; mask: number; negate: boolean }

export interface CanFrameKinds {
  standard: boolean
  extended: boolean
  fd: boolean
  remote: boolean
  error: boolean
}

export interface CanFrameFilter {
  idTerms: readonly CanIdTerm[]
  kinds: CanFrameKinds
  /** Undefined shows both directions. */
  direction?: CanFrameDirection
  /** Hex byte sequence the payload must contain, e.g. [0x1F, 0x00]. */
  dataContains?: readonly number[]
  /** Only frames on this 1-based bus; undefined shows every bus. */
  bus?: number
}

export const ALL_CAN_FRAME_KINDS: CanFrameKinds = {
  standard: true,
  extended: true,
  fd: true,
  remote: true,
  error: true
}

export const EMPTY_CAN_FRAME_FILTER: CanFrameFilter = {
  idTerms: [],
  kinds: ALL_CAN_FRAME_KINDS
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string }

const MAX_EXTENDED_ID = 0x1fffffff

function parseHexId(text: string): number | undefined {
  const clean = text.trim().replace(/^0x/i, '')
  if (!/^[0-9a-f]{1,8}$/i.test(clean)) return undefined
  const value = Number.parseInt(clean, 16)
  return value <= MAX_EXTENDED_ID ? value : undefined
}

/** Parse an id expression. An empty string is a valid filter that matches everything. */
export function parseCanIdFilter(expression: string): ParseResult<CanIdTerm[]> {
  const terms: CanIdTerm[] = []
  for (const rawToken of expression.split(/[\s,]+/)) {
    if (rawToken === '') continue
    const negate = rawToken.startsWith('!')
    const token = negate ? rawToken.slice(1) : rawToken
    if (token.includes('/')) {
      const [idText, maskText, extra] = token.split('/')
      const id = parseHexId(idText ?? '')
      const mask = parseHexId(maskText ?? '')
      if (id === undefined || mask === undefined || extra !== undefined) {
        return { ok: false, error: `"${rawToken}" is not id/mask in hex (e.g. 1E0A3C7F/1FFFFF00).` }
      }
      terms.push({ kind: 'mask', id, mask, negate })
    } else if (token.includes('-')) {
      const [lowText, highText, extra] = token.split('-')
      const low = parseHexId(lowText ?? '')
      const high = parseHexId(highText ?? '')
      if (low === undefined || high === undefined || extra !== undefined) {
        return { ok: false, error: `"${rawToken}" is not a hex range (e.g. 100-1FF).` }
      }
      terms.push({ kind: 'range', low: Math.min(low, high), high: Math.max(low, high), negate })
    } else {
      const id = parseHexId(token)
      if (id === undefined) {
        return { ok: false, error: `"${rawToken}" is not a hex CAN id (up to 1FFFFFFF).` }
      }
      terms.push({ kind: 'exact', id, negate })
    }
  }
  return { ok: true, value: terms }
}

/** Parse a payload search: hex bytes, spaces optional ("1F00", "1F 00", "0x1F 0x00"). */
export function parseCanDataSearch(text: string): ParseResult<number[] | undefined> {
  const clean = text.replace(/0x/gi, '').replace(/[\s,]+/g, '')
  if (clean === '') return { ok: true, value: undefined }
  if (!/^[0-9a-f]+$/i.test(clean) || clean.length % 2 !== 0) {
    return { ok: false, error: 'Payload search is whole hex bytes, e.g. "1F 00".' }
  }
  const bytes: number[] = []
  for (let index = 0; index < clean.length; index += 2) {
    bytes.push(Number.parseInt(clean.slice(index, index + 2), 16))
  }
  return { ok: true, value: bytes }
}

function termMatches(term: CanIdTerm, id: number): boolean {
  switch (term.kind) {
    case 'exact':
      return id === term.id
    case 'range':
      return id >= term.low && id <= term.high
    case 'mask':
      return ((id & term.mask) >>> 0) === ((term.id & term.mask) >>> 0)
  }
}

function containsSequence(data: Uint8Array, needle: readonly number[]): boolean {
  if (needle.length === 0) return true
  outer: for (let start = 0; start + needle.length <= data.length; start += 1) {
    for (let offset = 0; offset < needle.length; offset += 1) {
      if (data[start + offset] !== needle[offset]) continue outer
    }
    return true
  }
  return false
}

/** Does this frame pass the filter? */
export function matchesCanFilter(frame: CanFrame, filter: CanFrameFilter): boolean {
  const { kinds } = filter
  if (frame.error) {
    if (!kinds.error) return false
  } else if (frame.rtr) {
    if (!kinds.remote) return false
  } else if (frame.fd) {
    if (!kinds.fd) return false
  }
  if (frame.extended ? !kinds.extended : !kinds.standard) return false
  if (filter.direction !== undefined && frame.direction !== filter.direction) return false
  if (filter.bus !== undefined && frame.bus !== filter.bus) return false

  let included = true
  let sawInclude = false
  for (const term of filter.idTerms) {
    const hit = termMatches(term, frame.id)
    if (term.negate) {
      if (hit) return false
    } else {
      if (!sawInclude) {
        sawInclude = true
        included = false
      }
      if (hit) included = true
    }
  }
  if (!included) return false
  return filter.dataContains === undefined || containsSequence(frame.data, filter.dataContains)
}
