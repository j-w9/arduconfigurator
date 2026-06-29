import assert from 'node:assert/strict'
import test from 'node:test'

import {
  formatFlightSwVersion,
  formatFlightCustomVersion,
  parseFlightSwVersion,
  firmwareVersionAtLeast
} from '../packages/ardupilot-core/dist/index.js'

// AUTOPILOT_VERSION.flight_sw_version is packed major<<24 | minor<<16 |
// patch<<8 | fw_type. fw_type: 0=dev, 64=alpha, 128=beta, 192=rc, 255=official.
test('formatFlightSwVersion decodes the packed major.minor.patch with type suffix', () => {
  // 4.6.0 official (the demo value) -> no suffix.
  assert.equal(formatFlightSwVersion(0x040600ff), '4.6.0')
  // 4.6.0 rc -> "(rc)" suffix.
  assert.equal(formatFlightSwVersion(0x040600c0), '4.6.0 (rc)')
  // 4.5.7 dev -> "(dev)" suffix.
  assert.equal(formatFlightSwVersion(0x04050700), '4.5.7 (dev)')
  // 4.4.4 beta.
  assert.equal(formatFlightSwVersion(0x04040480), '4.4.4 (beta)')
})

test('formatFlightSwVersion returns undefined for zero / non-finite input', () => {
  assert.equal(formatFlightSwVersion(0), undefined)
  assert.equal(formatFlightSwVersion(Number.NaN), undefined)
  assert.equal(formatFlightSwVersion(Number.POSITIVE_INFINITY), undefined)
})

test('formatFlightSwVersion handles the high bit without sign issues', () => {
  // Major 0xC0 (192) would be negative under signed shifts; >>> 0 keeps it
  // unsigned. 0xC0000000 -> 192.0.0 official.
  assert.equal(formatFlightSwVersion(0xc00000ff), '192.0.0')
})

test('parseFlightSwVersion returns numeric major/minor/patch', () => {
  assert.deepEqual(parseFlightSwVersion(0x040600ff), { major: 4, minor: 6, patch: 0 })
  assert.deepEqual(parseFlightSwVersion(0x04050700), { major: 4, minor: 5, patch: 7 })
  // High bit stays unsigned.
  assert.deepEqual(parseFlightSwVersion(0xc00000ff), { major: 192, minor: 0, patch: 0 })
  assert.equal(parseFlightSwVersion(0), undefined)
  assert.equal(parseFlightSwVersion(Number.NaN), undefined)
})

test('firmwareVersionAtLeast compares major.minor, undefined when unknown', () => {
  const v47 = parseFlightSwVersion(0x04070000)
  const v46 = parseFlightSwVersion(0x04060300)
  assert.equal(firmwareVersionAtLeast(v47, 4, 7), true)
  assert.equal(firmwareVersionAtLeast(v46, 4, 7), false)
  assert.equal(firmwareVersionAtLeast(v46, 4, 6), true)
  assert.equal(firmwareVersionAtLeast(v46, 4, 5), true)
  assert.equal(firmwareVersionAtLeast(parseFlightSwVersion(0x05000000), 4, 7), true) // 5.0 > 4.7
  assert.equal(firmwareVersionAtLeast(undefined, 4, 7), undefined) // unknown → caller falls back
})

test('formatFlightCustomVersion accepts a real ArduPilot 8-char hex git hash', () => {
  const ascii = (s) => new Uint8Array([...s].map((c) => c.charCodeAt(0)))
  // Plain 8-char git hash — the standard ArduPilot fwversion().fw_hash_str.
  assert.equal(formatFlightCustomVersion(ascii('abc12345')), 'abc12345')
  // Mixed case is accepted.
  assert.equal(formatFlightCustomVersion(ascii('ABC12345')), 'ABC12345')
  // Trailing whitespace/NULs trimmed before the hex check.
  assert.equal(formatFlightCustomVersion(new Uint8Array([0x61, 0x62, 0x63, 0x64, 0x00, 0x20])), 'abcd')
})

test('formatFlightCustomVersion returns undefined for empty / non-printable / non-hex bytes', () => {
  assert.equal(formatFlightCustomVersion(undefined), undefined)
  assert.equal(formatFlightCustomVersion(new Uint8Array(0)), undefined)
  assert.equal(formatFlightCustomVersion(new Uint8Array([0x00, 0x01, 0xff])), undefined)
  // Strings shorter than 4 hex chars are rejected — too lossy to identify.
  assert.equal(formatFlightCustomVersion(new Uint8Array([0x61, 0x62, 0x63])), undefined)
  // Demo-mock magic-byte garbage like `$&` would land here pre-hardening
  // — now rejected because '$' / '&' aren't hex.
  assert.equal(formatFlightCustomVersion(new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0x24, 0x03, 0x26, 0x01])), undefined)
})
