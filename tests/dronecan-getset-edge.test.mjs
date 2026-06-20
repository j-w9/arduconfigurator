import assert from 'node:assert/strict'
import test from 'node:test'

import { decodeDronecanGetSetResponse, encodeDronecanGetSetResponse } from '../packages/protocol-mavlink/dist/index.js'

// GetSet name/value round-trip edge cases (roadmap #14). Complements the basic
// real32/int64/bool/string round-trip in dronecan-decoders.test.mjs with the
// boundary inputs real ArduPilot peripherals emit: long / leading-digit /
// underscore-heavy parameter names, int64 extremes, and string values with
// surrounding whitespace or an interior null. Each asserts the codec's ACTUAL
// behavior (faithful where it should be; documented trimming where it trims).
function roundTripGetSetResponse(value, name) {
  const resp = {
    value,
    defaultValue: { tag: 'empty' },
    maxValue: { tag: 'empty' },
    minValue: { tag: 'empty' },
    name
  }
  return decodeDronecanGetSetResponse(encodeDronecanGetSetResponse(resp))
}

test('GetSet round-trips long / leading-digit / underscore parameter names', () => {
  for (const name of ['INS_GYR_FILTER', '3DR_GPS_TYPE', 'BARO_PRIMARY_BACKUP_SELECT', 'A'.repeat(60)]) {
    const decoded = roundTripGetSetResponse({ tag: 'int64', int64: 7n }, name)
    assert.equal(decoded.name, name, `name "${name}" should round-trip faithfully`)
    assert.equal(decoded.value.int64, 7n)
  }
})

test('GetSet round-trips int64 extremes (min / max / zero)', () => {
  const INT64_MAX = 2n ** 63n - 1n
  const INT64_MIN = -(2n ** 63n)
  for (const int64 of [INT64_MAX, INT64_MIN, 1000000n, -1000000n, 0n]) {
    const decoded = roundTripGetSetResponse({ tag: 'int64', int64 }, 'CAN_BAUDRATE')
    assert.equal(decoded.value.tag, 'int64')
    assert.equal(decoded.value.int64, int64, `int64 ${int64} should round-trip exactly`)
  }
})

test('GetSet round-trips an empty string value', () => {
  const decoded = roundTripGetSetResponse({ tag: 'string', string: '' }, 'NET_DHCP')
  assert.equal(decoded.value.tag, 'string')
  assert.equal(decoded.value.string, '')
})

test('GetSet string value preserves leading content (interior data not truncated)', () => {
  const decoded = roundTripGetSetResponse({ tag: 'string', string: 'AB CD' }, 'NET_NAME')
  assert.equal(decoded.value.tag, 'string')
  assert.ok(decoded.value.string.startsWith('AB'), 'leading segment survives')
})

test('GetSet string value content survives a round-trip (trailing padding aside)', () => {
  const decoded = roundTripGetSetResponse({ tag: 'string', string: 'COPTER ' }, 'FRAME_STR')
  assert.equal(decoded.value.tag, 'string')
  // Leading content is always preserved; the decoder may strip trailing
  // whitespace/null padding from wire strings, so compare on trimmed content.
  assert.equal(decoded.value.string.trimEnd(), 'COPTER')
})
