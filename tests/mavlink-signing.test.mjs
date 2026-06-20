import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import test from 'node:test'

import { MavlinkV2Codec } from '../packages/protocol-mavlink/dist/index.js'
import {
  MAVLINK_V2_HEADER_LENGTH,
  MAVLINK_V2_CHECKSUM_LENGTH,
  MAVLINK_V2_INCOMPAT_FLAG_SIGNED,
  MAVLINK_V2_SIGNATURE_LENGTH,
  MAVLINK_PAYLOAD_LENGTHS,
  MAVLINK_MESSAGE_IDS
} from '../packages/protocol-mavlink/dist/constants.js'

const HEARTBEAT_TEMPLATE = {
  type: 'HEARTBEAT',
  customMode: 0x01020304,
  vehicleType: 2,
  autopilot: 3,
  baseMode: 0x81,
  systemStatus: 4,
  mavlinkVersion: 3
}

function envelope(overrides = {}) {
  return {
    header: { systemId: 1, componentId: 1, sequence: 0, ...overrides.header },
    message: { ...HEARTBEAT_TEMPLATE, ...overrides.message },
    timestampMs: 0
  }
}

function makeKey(fill) {
  const key = new Uint8Array(32)
  for (let i = 0; i < 32; i += 1) {
    key[i] = (fill + i) & 0xff
  }
  return key
}

// A deterministic, monotonic clock for reproducible signing tests.
function fixedClock(value) {
  return () => value
}

function readUint48LE(bytes, offset) {
  let value = 0
  let scale = 1
  for (let i = 0; i < 6; i += 1) {
    value += bytes[offset + i] * scale
    scale *= 256
  }
  return value
}

function writeUint48LE(out, offset, value) {
  let remaining = value
  for (let i = 0; i < 6; i += 1) {
    out[offset + i] = remaining & 0xff
    remaining = Math.floor(remaining / 256)
  }
}

const PAYLOAD_LEN = MAVLINK_PAYLOAD_LENGTHS[MAVLINK_MESSAGE_IDS.HEARTBEAT]
const BASE_LEN = MAVLINK_V2_HEADER_LENGTH + PAYLOAD_LEN + MAVLINK_V2_CHECKSUM_LENGTH

test('signed encode sets the SIGNED incompat flag and appends a 13-byte trailer', () => {
  const codec = new MavlinkV2Codec()
  codec.setSigningConfig({ secretKey: makeKey(0x10), linkId: 5, clock: fixedClock(100) })
  const frame = codec.encode(envelope())

  assert.equal(frame[2] & MAVLINK_V2_INCOMPAT_FLAG_SIGNED, MAVLINK_V2_INCOMPAT_FLAG_SIGNED)
  assert.equal(frame.length, BASE_LEN + MAVLINK_V2_SIGNATURE_LENGTH)
  assert.equal(frame[BASE_LEN], 5, 'link_id byte')
  assert.equal(readUint48LE(frame, BASE_LEN + 1), 100, 'timestamp')
})

test('INDEPENDENT signature check: codec trailer equals node-crypto SHA-256 first 6 bytes', () => {
  // This is the load-bearing cross-check. We sign with the codec, then
  // independently recompute the expected signature using node's trusted
  // crypto.createHash('sha256') over secret_key + frame(base, no trailer) +
  // link_id + timestamp(6 LE) and assert the codec's 6 bytes match.
  const secretKey = makeKey(0x42)
  const linkId = 9
  const timestamp = 0x0123456789ab // exercise all 6 timestamp bytes
  const codec = new MavlinkV2Codec()
  codec.setSigningConfig({ secretKey, linkId, clock: fixedClock(timestamp) })
  const frame = codec.encode(envelope({ header: { systemId: 7, componentId: 3, sequence: 12 } }))

  const baseFrame = frame.subarray(0, BASE_LEN)
  // Confirm the codec actually stamped the timestamp we expect.
  assert.equal(readUint48LE(frame, BASE_LEN + 1), timestamp)

  const tsBytes = new Uint8Array(6)
  writeUint48LE(tsBytes, 0, timestamp)
  const hashInput = Buffer.concat([
    Buffer.from(secretKey),
    Buffer.from(baseFrame),
    Buffer.from([linkId & 0xff]),
    Buffer.from(tsBytes)
  ])
  const expected = crypto.createHash('sha256').update(hashInput).digest()
  const codecSignature = frame.subarray(BASE_LEN + 7, BASE_LEN + 13)

  assert.deepEqual(
    Array.from(codecSignature),
    Array.from(expected.subarray(0, 6)),
    'codec signature must equal node-crypto SHA-256 first 6 bytes'
  )
})

test('round-trip: codec B with the same key verifies and accepts a frame signed by codec A', () => {
  const key = makeKey(0x11)
  const a = new MavlinkV2Codec()
  a.setSigningConfig({ secretKey: key, linkId: 0, clock: fixedClock(500) })
  const b = new MavlinkV2Codec()
  b.setSigningConfig({ secretKey: key, linkId: 0, clock: fixedClock(500) })

  const frame = a.encode(envelope({ header: { systemId: 7, componentId: 3, sequence: 99 } }))
  const decoded = b.push(frame)
  assert.equal(decoded.length, 1)
  assert.equal(decoded[0].header.systemId, 7)
  assert.equal(decoded[0].header.componentId, 3)
  assert.equal(decoded[0].header.sequence, 99)
  assert.equal(decoded[0].message.type, 'HEARTBEAT')
  assert.equal(decoded[0].message.customMode, HEARTBEAT_TEMPLATE.customMode)
  assert.equal(b.getSignatureRejectionCount(), 0)
})

test('wrong key is rejected (frame dropped, rejection surfaced)', () => {
  const a = new MavlinkV2Codec()
  a.setSigningConfig({ secretKey: makeKey(0x11), clock: fixedClock(500) })
  const b = new MavlinkV2Codec()
  const rejections = []
  b.setSignatureRejectionHandler((r) => rejections.push(r))
  b.setSigningConfig({ secretKey: makeKey(0x99), clock: fixedClock(500) })

  const frame = a.encode(envelope())
  assert.deepEqual(b.push(frame), [])
  assert.equal(b.getSignatureRejectionCount(), 1)
  assert.equal(rejections.length, 1)
  assert.equal(rejections[0].reason, 'bad-signature')
})

test('tampered payload byte is rejected', () => {
  const key = makeKey(0x11)
  const a = new MavlinkV2Codec()
  a.setSigningConfig({ secretKey: key, clock: fixedClock(500) })
  const b = new MavlinkV2Codec()
  b.setSigningConfig({ secretKey: key, clock: fixedClock(500) })

  const frame = a.encode(envelope())
  const tampered = Uint8Array.from(frame)
  // Flip a payload byte; CRC would normally catch this, but flip the CRC to
  // match so we exercise the SIGNATURE path specifically rather than the CRC
  // reject. Recompute the X25 CRC over the mutated payload.
  tampered[MAVLINK_V2_HEADER_LENGTH] ^= 0xff
  const crc = x25(tampered.subarray(1, MAVLINK_V2_HEADER_LENGTH + PAYLOAD_LEN), 50)
  tampered[MAVLINK_V2_HEADER_LENGTH + PAYLOAD_LEN] = crc & 0xff
  tampered[MAVLINK_V2_HEADER_LENGTH + PAYLOAD_LEN + 1] = (crc >> 8) & 0xff

  assert.deepEqual(b.push(tampered), [], 'tampered payload must be dropped on signature mismatch')
  assert.equal(b.getSignatureRejectionCount(), 1)
})

test('replayed frame (same or older timestamp) is rejected', () => {
  const key = makeKey(0x22)
  const a = new MavlinkV2Codec()
  // First frame at ts=1000, second at ts=1001 (monotonic on the sender).
  let ts = 1000
  a.setSigningConfig({ secretKey: key, clock: () => ts })
  const b = new MavlinkV2Codec()
  b.setSigningConfig({ secretKey: key, clock: fixedClock(2000) })

  const first = a.encode(envelope({ header: { sequence: 1 } }))
  assert.equal(b.push(first).length, 1, 'first accepted')

  // Replay the SAME frame -> same timestamp -> rejected.
  assert.deepEqual(b.push(Uint8Array.from(first)), [], 'replay of same frame rejected')

  // An older timestamp must also be rejected. A fresh sender (no monotonic
  // history) genuinely stamps ts=999, below b's last-accepted 1000.
  const aOld = new MavlinkV2Codec()
  aOld.setSigningConfig({ secretKey: key, clock: fixedClock(999) })
  const older = aOld.encode(envelope({ header: { sequence: 2 } }))
  assert.deepEqual(b.push(older), [], 'older timestamp rejected')
  assert.equal(b.getSignatureRejectionCount(), 2)

  // A strictly newer one is accepted.
  ts = 1500
  const newer = a.encode(envelope({ header: { sequence: 3 } }))
  assert.equal(b.push(newer).length, 1, 'newer timestamp accepted')
})

test('timestamp more than 1 minute behind local time is rejected', () => {
  const key = makeKey(0x33)
  const a = new MavlinkV2Codec()
  // Sender stamps an old timestamp.
  a.setSigningConfig({ secretKey: key, clock: fixedClock(1_000) })
  const b = new MavlinkV2Codec()
  // Receiver's local clock is 6_000_001 units (> 1 min == 6_000_000) ahead.
  b.setSigningConfig({ secretKey: key, clock: fixedClock(1_000 + 6_000_001) })

  const frame = a.encode(envelope())
  assert.deepEqual(b.push(frame), [], 'stale (>1min behind) frame rejected')
  assert.equal(b.getSignatureRejectionCount(), 1)

  // Exactly 1 minute behind (boundary) is still accepted.
  const b2 = new MavlinkV2Codec()
  b2.setSigningConfig({ secretKey: key, clock: fixedClock(1_000 + 6_000_000) })
  assert.equal(b2.push(Uint8Array.from(frame)).length, 1, 'exactly 1min behind accepted')
})

test('unsigned frame with no key configured still parses (legacy behaviour preserved)', () => {
  const a = new MavlinkV2Codec()
  const unsigned = a.encode(envelope({ header: { sequence: 44 } }))
  assert.equal(unsigned[2] & MAVLINK_V2_INCOMPAT_FLAG_SIGNED, 0)

  const b = new MavlinkV2Codec() // no signing config
  const decoded = b.push(unsigned)
  assert.equal(decoded.length, 1)
  assert.equal(decoded[0].header.sequence, 44)
})

test('configured-but-disabled signing encodes unsigned and does not verify', () => {
  const codec = new MavlinkV2Codec()
  codec.setSigningConfig({ secretKey: makeKey(0x55), enabled: false })
  const frame = codec.encode(envelope())
  assert.equal(frame[2] & MAVLINK_V2_INCOMPAT_FLAG_SIGNED, 0)
  assert.equal(frame.length, BASE_LEN, 'no trailer when disabled')
})

test('signing timestamps increase monotonically per stream even with a stuck clock', () => {
  const codec = new MavlinkV2Codec()
  codec.setSigningConfig({ secretKey: makeKey(0x66), linkId: 0, clock: fixedClock(7) })
  const f1 = codec.encode(envelope())
  const f2 = codec.encode(envelope())
  const t1 = readUint48LE(f1, BASE_LEN + 1)
  const t2 = readUint48LE(f2, BASE_LEN + 1)
  assert.ok(t2 > t1, `timestamp must strictly increase (t1=${t1}, t2=${t2})`)
})

test('setSigningConfig rejects a secret key that is not 32 bytes', () => {
  const codec = new MavlinkV2Codec()
  assert.throws(() => codec.setSigningConfig({ secretKey: new Uint8Array(16) }), /32 bytes/)
})

test('a signed frame received with NO key configured is parsed (trailer skipped) — legacy', () => {
  const a = new MavlinkV2Codec()
  a.setSigningConfig({ secretKey: makeKey(0x77), linkId: 2, clock: fixedClock(123) })
  const signed = a.encode(envelope({ header: { sequence: 5 } }))

  const b = new MavlinkV2Codec() // no key -> must not verify, just skip trailer
  const decoded = b.push(signed)
  assert.equal(decoded.length, 1)
  assert.equal(decoded[0].header.sequence, 5)
  assert.equal(b.getSignatureRejectionCount(), 0)
})

// X25 checksum copy for the tamper test (recompute CRC over mutated payload).
function x25(bytes, crcExtra) {
  let checksum = 0xffff
  for (const byte of bytes) checksum = acc(byte, checksum)
  checksum = acc(crcExtra, checksum)
  return checksum
}
function acc(byte, checksum) {
  let tmp = byte ^ (checksum & 0xff)
  tmp ^= (tmp << 4) & 0xff
  return ((checksum >> 8) ^ (tmp << 8) ^ (tmp << 3) ^ (tmp >> 4)) & 0xffff
}
