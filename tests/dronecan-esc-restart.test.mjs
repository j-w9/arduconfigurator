import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DRONECAN_ESC_STATUS_SIGNATURE,
  DRONECAN_RESTART_NODE_MAGIC,
  decodeDronecanEscStatus,
  decodeDronecanRestartNodeResponse,
  dronecanDecodeFloat16,
  dronecanEncodeFloat16,
  encodeDronecanEscStatus,
  encodeDronecanRestartNodeRequest,
  encodeDronecanRestartNodeResponse
} from '../packages/protocol-mavlink/dist/index.js'

test('RestartNode request encodes the 5-byte uint40 MAGIC_NUMBER little-endian', () => {
  const payload = encodeDronecanRestartNodeRequest()
  assert.equal(payload.length, 5)
  // 0xACCE551B1E, little-endian.
  assert.deepEqual(Array.from(payload), [0x1e, 0x1b, 0x55, 0xce, 0xac])
  // Reconstruct the magic from the LE bytes.
  let magic = 0n
  for (let i = 0; i < 5; i += 1) magic |= BigInt(payload[i]) << BigInt(8 * i)
  assert.equal(magic, DRONECAN_RESTART_NODE_MAGIC)
})

test('RestartNode request accepts a custom magic (e.g. a rejecting value)', () => {
  const payload = encodeDronecanRestartNodeRequest(0n)
  assert.deepEqual(Array.from(payload), [0, 0, 0, 0, 0])
})

test('RestartNode response bool ok round-trips', () => {
  assert.deepEqual(decodeDronecanRestartNodeResponse(encodeDronecanRestartNodeResponse(true)), { ok: true })
  assert.deepEqual(decodeDronecanRestartNodeResponse(encodeDronecanRestartNodeResponse(false)), { ok: false })
  assert.equal(decodeDronecanRestartNodeResponse(new Uint8Array(0)), undefined)
})

test('float16 codec round-trips representative ESC values', () => {
  for (const v of [0, 1, 16.2, 12.5, 313.15, -8.25, 0.5]) {
    const back = dronecanDecodeFloat16(dronecanEncodeFloat16(v))
    // half-precision step grows with magnitude (~1 ULP = |v|/1024).
    const tolerance = Math.max(0.02, Math.abs(v) / 512)
    assert.ok(Math.abs(back - v) < tolerance, `float16 round-trip ${v} -> ${back}`)
  }
  // NaN is preserved as NaN (unknown-field sentinel).
  assert.ok(Number.isNaN(dronecanDecodeFloat16(dronecanEncodeFloat16(NaN))))
})

test('esc.Status places the non-byte-aligned esc_index in the documented bits', () => {
  // Only esc_index set: it occupies bits 105..110, i.e. byte 13 bits 6..2.
  // esc_index = 1 (0b00001) -> byte13 == 0b00000100 == 0x04. rpm/power live in
  // earlier bytes, so byte 13 isolates esc_index (+ power's LSB in bit 7 = 0).
  const payload = encodeDronecanEscStatus({
    errorCount: 0,
    voltage: 0,
    current: 0,
    temperature: 0,
    rpm: 0,
    powerRatingPct: 0,
    escIndex: 1
  })
  assert.equal(payload.length, 14)
  assert.equal(payload[13], 0x04)
})

test('esc.Status decodes a full bit-packed sample with a signed reverse RPM', () => {
  const sample = {
    errorCount: 7,
    voltage: 16.2,
    current: 12.5,
    temperature: 313.15, // Kelvin (~40C)
    rpm: -2048, // negative = reverse; well within int18 range
    powerRatingPct: 73,
    escIndex: 3
  }
  const decoded = decodeDronecanEscStatus(encodeDronecanEscStatus(sample))
  assert.ok(decoded)
  assert.equal(decoded.errorCount, 7)
  assert.ok(Math.abs(decoded.voltage - 16.2) < 0.05)
  assert.ok(Math.abs(decoded.current - 12.5) < 0.05)
  assert.ok(Math.abs(decoded.temperature - 313.15) < 0.5)
  assert.equal(decoded.rpm, -2048)
  assert.equal(decoded.powerRatingPct, 73)
  assert.equal(decoded.escIndex, 3)
})

test('esc.Status rejects a truncated frame', () => {
  assert.equal(decodeDronecanEscStatus(new Uint8Array(13)), undefined)
})

test('esc.Status signature constant is the canard-generated value', () => {
  assert.equal(DRONECAN_ESC_STATUS_SIGNATURE, 0xa9af28aea2fbb254n)
})
