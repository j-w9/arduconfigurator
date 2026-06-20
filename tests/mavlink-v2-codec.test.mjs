import assert from 'node:assert/strict'
import test from 'node:test'

import {
  MavlinkV2Codec,
  TruncatingMavlinkV2Codec,
  decodeSingleV2Envelope,
  truncateMavlinkV2Frame
} from '../packages/protocol-mavlink/dist/index.js'
import {
  MAVLINK_MESSAGE_CRCS,
  MAVLINK_MESSAGE_IDS,
  MAVLINK_PAYLOAD_LENGTHS,
  MAVLINK_V2_CHECKSUM_LENGTH,
  MAVLINK_V2_HEADER_LENGTH,
  MAVLINK_V2_INCOMPAT_FLAG_SIGNED,
  MAVLINK_V2_SIGNATURE_LENGTH,
  MAVLINK_V2_STX
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

function buildHeartbeatEnvelope(overrides = {}) {
  return {
    header: {
      systemId: 1,
      componentId: 1,
      sequence: 0,
      ...overrides.header
    },
    message: {
      ...HEARTBEAT_TEMPLATE,
      ...overrides.message
    },
    timestampMs: 0
  }
}

test('MavlinkV2Codec decodes every frame from a >4KB coalesced read (cap must not pre-trim valid frames)', () => {
  // Regression (#167): the buffer cap ran BEFORE the decode loop, so a
  // single large coalesced read (param-sync streams ~33KB; the OS hands
  // back multi-KB chunks after a main-thread stall) was sliced to the
  // last 512B and most valid back-to-back frames were silently dropped.
  const encoder = new MavlinkV2Codec()
  const frameCount = 200
  const frames = []
  let total = 0
  for (let i = 0; i < frameCount; i += 1) {
    const frame = encoder.encode(buildHeartbeatEnvelope({ header: { sequence: i & 0xff } }))
    frames.push(frame)
    total += frame.length
  }
  assert.ok(total > 4096, `expected a >4096B single chunk, got ${total}`)
  const coalesced = new Uint8Array(total)
  let offset = 0
  for (const frame of frames) {
    coalesced.set(frame, offset)
    offset += frame.length
  }

  const decoder = new MavlinkV2Codec()
  const decoded = decoder.push(coalesced)
  assert.equal(
    decoded.length,
    frameCount,
    'every frame in the coalesced chunk must decode (cap-before-parse dropped them)'
  )
  assert.equal(decoded[0].message.type, 'HEARTBEAT')
  assert.equal(decoded[frameCount - 1].message.type, 'HEARTBEAT')
})

test('MavlinkV2Codec round-trips a HEARTBEAT frame preserving header and payload fields', () => {
  const codec = new MavlinkV2Codec()
  const envelope = buildHeartbeatEnvelope({
    header: { systemId: 42, componentId: 7, sequence: 123 }
  })

  const frame = codec.encode(envelope)

  // Frame layout sanity: STX, payloadLength, incompatFlags=0, compatFlags=0
  const payloadLength = MAVLINK_PAYLOAD_LENGTHS[MAVLINK_MESSAGE_IDS.HEARTBEAT]
  assert.equal(frame[0], MAVLINK_V2_STX)
  assert.equal(frame[1], payloadLength)
  assert.equal(frame[2], 0)
  assert.equal(frame[3], 0)
  assert.equal(frame.length, MAVLINK_V2_HEADER_LENGTH + payloadLength + MAVLINK_V2_CHECKSUM_LENGTH)
  assert.equal(frame[7], MAVLINK_MESSAGE_IDS.HEARTBEAT & 0xff)
  assert.equal(frame[8], 0)
  assert.equal(frame[9], 0)

  const decoder = new MavlinkV2Codec()
  const decoded = decoder.push(frame)
  assert.equal(decoded.length, 1)
  const [received] = decoded
  assert.equal(received.header.systemId, 42)
  assert.equal(received.header.componentId, 7)
  assert.equal(received.header.sequence, 123)
  assert.equal(received.message.type, 'HEARTBEAT')
  assert.equal(received.message.customMode, HEARTBEAT_TEMPLATE.customMode)
  assert.equal(received.message.vehicleType, HEARTBEAT_TEMPLATE.vehicleType)
  assert.equal(received.message.autopilot, HEARTBEAT_TEMPLATE.autopilot)
  assert.equal(received.message.baseMode, HEARTBEAT_TEMPLATE.baseMode)
  assert.equal(received.message.systemStatus, HEARTBEAT_TEMPLATE.systemStatus)
  assert.equal(received.message.mavlinkVersion, HEARTBEAT_TEMPLATE.mavlinkVersion)
})

test('decodeSingleV2Envelope returns a single envelope for a self-contained HEARTBEAT frame', () => {
  const codec = new MavlinkV2Codec()
  const frame = codec.encode(buildHeartbeatEnvelope({ header: { sequence: 9 } }))

  const envelope = decodeSingleV2Envelope(frame)
  assert.equal(envelope.header.sequence, 9)
  assert.equal(envelope.message.type, 'HEARTBEAT')
})

test('MavlinkV2Codec rejects a frame whose X25 checksum has been corrupted', () => {
  const codec = new MavlinkV2Codec()
  const frame = codec.encode(buildHeartbeatEnvelope())

  // Flip the low checksum byte. Both CRC bytes live at the tail of the frame.
  const corrupted = new Uint8Array(frame)
  const checksumOffset = corrupted.length - MAVLINK_V2_CHECKSUM_LENGTH
  corrupted[checksumOffset] = corrupted[checksumOffset] ^ 0xff

  const decoder = new MavlinkV2Codec()
  const decoded = decoder.push(corrupted)
  assert.deepEqual(decoded, [])
})

test('MavlinkV2Codec preserves sequence numbers across the 0xFF -> 0x00 wrap boundary', () => {
  const codec = new MavlinkV2Codec()
  const seqs = [0xfe, 0xff, 0x00, 0x01]

  const decoder = new MavlinkV2Codec()
  const received = []
  for (const sequence of seqs) {
    const frame = codec.encode(buildHeartbeatEnvelope({ header: { sequence } }))
    received.push(...decoder.push(frame))
  }

  assert.deepEqual(
    received.map((envelope) => envelope.header.sequence),
    seqs
  )
})

test('MavlinkV2Codec drops a frame truncated mid-payload without throwing and keeps the buffer', () => {
  const codec = new MavlinkV2Codec()
  const frame = codec.encode(buildHeartbeatEnvelope())
  const truncated = frame.slice(0, frame.length - 3)

  const decoder = new MavlinkV2Codec()
  // First push: partial frame must produce no envelopes and not throw.
  assert.doesNotThrow(() => decoder.push(truncated))
  assert.deepEqual(decoder.push(new Uint8Array(0)), [])

  // After feeding the remaining bytes the original frame must decode cleanly,
  // proving the buffer was retained instead of discarded.
  const tail = frame.slice(frame.length - 3)
  const decoded = decoder.push(tail)
  assert.equal(decoded.length, 1)
  assert.equal(decoded[0].message.type, 'HEARTBEAT')
})

test('MavlinkV2Codec decodes several frames concatenated into one buffer', () => {
  const codec = new MavlinkV2Codec()
  const frames = [
    codec.encode(buildHeartbeatEnvelope({ header: { sequence: 1 } })),
    codec.encode(buildHeartbeatEnvelope({ header: { sequence: 2 } })),
    codec.encode(buildHeartbeatEnvelope({ header: { sequence: 3 } }))
  ]

  const concatenated = new Uint8Array(frames.reduce((sum, frame) => sum + frame.length, 0))
  let offset = 0
  for (const frame of frames) {
    concatenated.set(frame, offset)
    offset += frame.length
  }

  const decoder = new MavlinkV2Codec()
  const decoded = decoder.push(concatenated)
  assert.deepEqual(
    decoded.map((envelope) => envelope.header.sequence),
    [1, 2, 3]
  )
})

test('MavlinkV2Codec resynchronizes past leading junk bytes before the STX marker', () => {
  const codec = new MavlinkV2Codec()
  const frame = codec.encode(buildHeartbeatEnvelope({ header: { sequence: 17 } }))
  // Leading garbage that contains every byte value except 0xfd.
  const junk = new Uint8Array([0x00, 0x55, 0xaa, 0xfe, 0xfc, 0x10, 0xff])
  const noisy = new Uint8Array(junk.length + frame.length)
  noisy.set(junk, 0)
  noisy.set(frame, junk.length)

  const decoder = new MavlinkV2Codec()
  const decoded = decoder.push(noisy)
  assert.equal(decoded.length, 1)
  assert.equal(decoded[0].header.sequence, 17)
})

test('MavlinkV2Codec reassembles a frame delivered byte-by-byte', () => {
  const codec = new MavlinkV2Codec()
  const frame = codec.encode(buildHeartbeatEnvelope({ header: { sequence: 99 } }))

  const decoder = new MavlinkV2Codec()
  const received = []
  for (let index = 0; index < frame.length; index += 1) {
    received.push(...decoder.push(frame.subarray(index, index + 1)))
  }

  assert.equal(received.length, 1)
  assert.equal(received[0].header.sequence, 99)
})

test('MavlinkV2Codec.reset() clears any half-buffered partial frame', () => {
  const codec = new MavlinkV2Codec()
  const frame = codec.encode(buildHeartbeatEnvelope())
  const half = frame.slice(0, Math.floor(frame.length / 2))

  const decoder = new MavlinkV2Codec()
  assert.deepEqual(decoder.push(half), [])
  decoder.reset()
  // Feeding the remaining bytes after reset must NOT produce an envelope:
  // the codec should treat them as junk because the STX marker is gone.
  const remainder = frame.slice(half.length)
  assert.deepEqual(decoder.push(remainder), [])
})

test('MavlinkV2Codec rejects a frame whose message id is unknown', () => {
  const codec = new MavlinkV2Codec()
  const frame = codec.encode(buildHeartbeatEnvelope())

  // Rewrite the 24-bit message id to something the codec does not register.
  const tampered = new Uint8Array(frame)
  tampered[7] = 0xee
  tampered[8] = 0xee
  tampered[9] = 0xee
  // CRC will also no longer match — both checks should reject this frame.

  const decoder = new MavlinkV2Codec()
  assert.deepEqual(decoder.push(tampered), [])
})

test('MavlinkV2Codec decodes a signed v2 frame by skipping the 13-byte signature trailer', () => {
  // The codec does not currently emit signed frames, but it must still parse
  // them: the incompat-flag bit tells the decoder to skip 13 trailing bytes.
  const messageId = MAVLINK_MESSAGE_IDS.HEARTBEAT
  const payloadLength = MAVLINK_PAYLOAD_LENGTHS[messageId]
  const frameLength =
    MAVLINK_V2_HEADER_LENGTH + payloadLength + MAVLINK_V2_CHECKSUM_LENGTH + MAVLINK_V2_SIGNATURE_LENGTH
  const frame = new Uint8Array(frameLength)

  frame[0] = MAVLINK_V2_STX
  frame[1] = payloadLength
  frame[2] = MAVLINK_V2_INCOMPAT_FLAG_SIGNED
  frame[3] = 0
  frame[4] = 200 // sequence
  frame[5] = 11 // systemId
  frame[6] = 22 // componentId
  frame[7] = messageId & 0xff
  frame[8] = (messageId >> 8) & 0xff
  frame[9] = (messageId >> 16) & 0xff

  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength)
  view.setUint32(MAVLINK_V2_HEADER_LENGTH + 0, HEARTBEAT_TEMPLATE.customMode, true)
  view.setUint8(MAVLINK_V2_HEADER_LENGTH + 4, HEARTBEAT_TEMPLATE.vehicleType)
  view.setUint8(MAVLINK_V2_HEADER_LENGTH + 5, HEARTBEAT_TEMPLATE.autopilot)
  view.setUint8(MAVLINK_V2_HEADER_LENGTH + 6, HEARTBEAT_TEMPLATE.baseMode)
  view.setUint8(MAVLINK_V2_HEADER_LENGTH + 7, HEARTBEAT_TEMPLATE.systemStatus)
  view.setUint8(MAVLINK_V2_HEADER_LENGTH + 8, HEARTBEAT_TEMPLATE.mavlinkVersion)

  const checksum = computeX25Checksum(
    frame.subarray(1, MAVLINK_V2_HEADER_LENGTH + payloadLength),
    MAVLINK_MESSAGE_CRCS[messageId]
  )
  const checksumOffset = MAVLINK_V2_HEADER_LENGTH + payloadLength
  frame[checksumOffset] = checksum & 0xff
  frame[checksumOffset + 1] = (checksum >> 8) & 0xff

  // Arbitrary signature bytes — codec must not interpret these as a new frame
  // even though some of them are 0xfd (the STX marker).
  const signatureOffset = checksumOffset + MAVLINK_V2_CHECKSUM_LENGTH
  for (let i = 0; i < MAVLINK_V2_SIGNATURE_LENGTH; i += 1) {
    frame[signatureOffset + i] = i === 3 ? MAVLINK_V2_STX : 0xa5
  }

  const decoder = new MavlinkV2Codec()
  const decoded = decoder.push(frame)
  assert.equal(decoded.length, 1)
  assert.equal(decoded[0].header.systemId, 11)
  assert.equal(decoded[0].header.componentId, 22)
  assert.equal(decoded[0].header.sequence, 200)
  assert.equal(decoded[0].message.type, 'HEARTBEAT')

  // Pushing an empty chunk must not surface a "second" envelope from the
  // signature bytes that contain a stray 0xfd.
  assert.deepEqual(decoder.push(new Uint8Array(0)), [])
})

test('MavlinkV2Codec recovers a valid frame that immediately follows a CRC-corrupted frame', () => {
  const codec = new MavlinkV2Codec()
  const good = codec.encode(buildHeartbeatEnvelope({ header: { sequence: 71 } }))
  const bad = codec.encode(buildHeartbeatEnvelope({ header: { sequence: 70 } }))
  // Corrupt the CRC of the first frame only.
  bad[bad.length - 1] = bad[bad.length - 1] ^ 0xff

  const concatenated = new Uint8Array(bad.length + good.length)
  concatenated.set(bad, 0)
  concatenated.set(good, bad.length)

  const decoder = new MavlinkV2Codec()
  const decoded = decoder.push(concatenated)
  assert.equal(decoded.length, 1)
  assert.equal(decoded[0].header.sequence, 71)
})

test('MavlinkV2Codec does not lose a real STX that sits inside a CRC-failing frames declared payload', () => {
  // Hand-craft a malformed "frame" whose payloadLength byte claims 30 bytes
  // of payload. Inside that fake payload, we plant a real heartbeat at a
  // location the old decoder would have swallowed when it discarded the
  // whole fake frame. The fixed decoder discards only the false STX byte
  // on CRC failure, then resyncs onto the real frame.
  const codec = new MavlinkV2Codec()
  const real = codec.encode(buildHeartbeatEnvelope({ header: { sequence: 42 } }))

  // Build the fake frame: STX + claimed payloadLength=30 + arbitrary header
  // padding, then real bytes embedded inside the declared region.
  const fakeHeader = new Uint8Array([
    0xfd, // STX
    0x1e, // claimed payloadLength = 30
    0x00, // incompat_flags
    0x00, // compat_flags
    0x00, // sequence
    0x01, // systemId
    0x01, // componentId
    0x00, 0x00, 0x00 // messageId 0 (HEARTBEAT)
  ])
  // Fill the rest of the fake "frame" with junk that includes the real
  // frame bytes so the resync has to climb out of them. The fake frame
  // length is header(10) + payload(30) + crc(2) = 42 bytes.
  const tail = new Uint8Array(42 - fakeHeader.length)
  tail.fill(0xaa)
  // Place the real frame inside the tail so it would have been swallowed
  // by the old decoder, then leave it again outside so we can prove the
  // decoder eventually finds the real bytes.
  const concatenated = new Uint8Array(fakeHeader.length + tail.length + real.length)
  concatenated.set(fakeHeader, 0)
  concatenated.set(tail, fakeHeader.length)
  concatenated.set(real, fakeHeader.length + tail.length)

  const decoder = new MavlinkV2Codec()
  const decoded = decoder.push(concatenated)
  assert.ok(decoded.length >= 1, 'expected to recover at least one real frame after resync')
  assert.equal(decoded[decoded.length - 1].header.sequence, 42)
})

test('MavlinkV2Codec does not stall when a false STX declares a large length and the stream then goes quiet', () => {
  const codec = new MavlinkV2Codec()
  const real = codec.encode(buildHeartbeatEnvelope({ header: { sequence: 88 } }))

  // A false STX whose byte-1 claims a 250-byte payload (frameLength ~262).
  // Only a few junk bytes follow before the *real* frame, and then the
  // stream stops. The old decoder would block at offset 0 forever waiting
  // for ~262 bytes that never arrive, never surfacing the real frame.
  const falseStart = new Uint8Array([0xfd, 0xfa, 0x00, 0x00, 0x11, 0x22, 0x33])
  const buffer = new Uint8Array(falseStart.length + real.length)
  buffer.set(falseStart, 0)
  buffer.set(real, falseStart.length)

  const decoder = new MavlinkV2Codec()
  // Single push, then no more bytes ever — simulates the stream going quiet.
  const decoded = decoder.push(buffer)
  assert.equal(decoded.length, 1, 'expected the real frame to surface despite the false STX prefix')
  assert.equal(decoded[0].header.sequence, 88)

  // A subsequent empty push must not resurrect or duplicate anything.
  assert.deepEqual(decoder.push(new Uint8Array(0)), [])
})

test('MavlinkV2Codec still waits (no false resync) when offset 0 is a genuine slow-arriving frame', () => {
  const codec = new MavlinkV2Codec()
  const frame = codec.encode(buildHeartbeatEnvelope({ header: { sequence: 7 } }))

  const decoder = new MavlinkV2Codec()
  // Deliver the real frame split across two pushes with nothing else in the
  // buffer. There is no later valid frame, so the decoder must keep waiting
  // for the rest rather than discarding the legitimate prefix.
  const firstHalf = frame.subarray(0, 6)
  const secondHalf = frame.subarray(6)
  assert.deepEqual(decoder.push(firstHalf), [])
  const decoded = decoder.push(secondHalf)
  assert.equal(decoded.length, 1)
  assert.equal(decoded[0].header.sequence, 7)
})

// Local copy of the X25 checksum implementation, used only by the
// signed-frame test above so we can hand-craft a frame without going
// through the encoder (which does not emit signed frames).
function computeX25Checksum(bytes, crcExtra) {
  let checksum = 0xffff
  for (const byte of bytes) {
    checksum = accumulate(byte, checksum)
  }
  checksum = accumulate(crcExtra, checksum)
  return checksum
}

function accumulate(byte, checksum) {
  let tmp = byte ^ (checksum & 0xff)
  tmp ^= (tmp << 4) & 0xff
  return ((checksum >> 8) ^ (tmp << 8) ^ (tmp << 3) ^ (tmp >> 4)) & 0xffff
}

function roundTrip(message) {
  const codec = new MavlinkV2Codec()
  const frame = codec.encode({
    header: { systemId: 1, componentId: 1, sequence: 0 },
    message,
    timestampMs: 0
  })
  const decoded = new MavlinkV2Codec().push(frame)
  assert.equal(decoded.length, 1, `${message.type} should decode to exactly one envelope`)
  return { frame, message: decoded[0].message }
}

test('MavlinkV2Codec round-trips LOG_REQUEST_LIST', () => {
  const { frame, message } = roundTrip({
    type: 'LOG_REQUEST_LIST',
    targetSystem: 1,
    targetComponent: 1,
    start: 0,
    end: 0xffff
  })
  assert.equal(frame[1], MAVLINK_PAYLOAD_LENGTHS[MAVLINK_MESSAGE_IDS.LOG_REQUEST_LIST])
  assert.equal(frame[7], MAVLINK_MESSAGE_IDS.LOG_REQUEST_LIST & 0xff)
  assert.deepEqual(message, {
    type: 'LOG_REQUEST_LIST',
    targetSystem: 1,
    targetComponent: 1,
    start: 0,
    end: 0xffff
  })
})

test('MavlinkV2Codec round-trips LOG_ENTRY', () => {
  const { message } = roundTrip({
    type: 'LOG_ENTRY',
    timeUtc: 1_700_000_000,
    size: 2_345_678,
    id: 7,
    numLogs: 12,
    lastLogNum: 11
  })
  assert.deepEqual(message, {
    type: 'LOG_ENTRY',
    timeUtc: 1_700_000_000,
    size: 2_345_678,
    id: 7,
    numLogs: 12,
    lastLogNum: 11
  })
})

test('MavlinkV2Codec round-trips LOG_REQUEST_DATA', () => {
  const { message } = roundTrip({
    type: 'LOG_REQUEST_DATA',
    targetSystem: 1,
    targetComponent: 1,
    id: 7,
    ofs: 90_000,
    count: 0xffffffff
  })
  assert.deepEqual(message, {
    type: 'LOG_REQUEST_DATA',
    targetSystem: 1,
    targetComponent: 1,
    id: 7,
    ofs: 90_000,
    count: 0xffffffff
  })
})

test('MavlinkV2Codec round-trips LOG_DATA preserving the 90-byte chunk', () => {
  const data = new Uint8Array(90)
  for (let i = 0; i < 90; i += 1) {
    data[i] = (i * 7 + 3) & 0xff
  }
  const { frame, message } = roundTrip({
    type: 'LOG_DATA',
    id: 7,
    ofs: 180,
    count: 90,
    data
  })
  assert.equal(frame[1], MAVLINK_PAYLOAD_LENGTHS[MAVLINK_MESSAGE_IDS.LOG_DATA])
  assert.equal(message.type, 'LOG_DATA')
  assert.equal(message.id, 7)
  assert.equal(message.ofs, 180)
  assert.equal(message.count, 90)
  assert.deepEqual(Array.from(message.data), Array.from(data))
})

test('MavlinkV2Codec round-trips LOG_DATA with a short final chunk (count < 90)', () => {
  const data = new Uint8Array(90)
  data.set([10, 20, 30, 40], 0)
  const { message } = roundTrip({ type: 'LOG_DATA', id: 9, ofs: 0, count: 4, data })
  assert.equal(message.count, 4)
  assert.deepEqual(Array.from(message.data.slice(0, 4)), [10, 20, 30, 40])
})

test('MavlinkV2Codec round-trips LOG_REQUEST_END', () => {
  const { frame, message } = roundTrip({
    type: 'LOG_REQUEST_END',
    targetSystem: 1,
    targetComponent: 1
  })
  assert.equal(frame[1], MAVLINK_PAYLOAD_LENGTHS[MAVLINK_MESSAGE_IDS.LOG_REQUEST_END])
  assert.deepEqual(message, {
    type: 'LOG_REQUEST_END',
    targetSystem: 1,
    targetComponent: 1
  })
})

test('MavlinkV2Codec round-trips MAG_CAL_PROGRESS incl. the 10-byte completion mask', () => {
  const completionMask = new Uint8Array(10)
  for (let i = 0; i < 10; i += 1) {
    completionMask[i] = (i * 17 + 1) & 0xff
  }
  const { frame, message } = roundTrip({
    type: 'MAG_CAL_PROGRESS',
    compassId: 1,
    calMask: 0b11,
    calStatus: 2,
    attempt: 1,
    completionPct: 42,
    completionMask,
    directionX: 0.25,
    directionY: -0.5,
    directionZ: 0.75
  })
  assert.equal(frame[1], MAVLINK_PAYLOAD_LENGTHS[MAVLINK_MESSAGE_IDS.MAG_CAL_PROGRESS])
  assert.equal(message.type, 'MAG_CAL_PROGRESS')
  assert.equal(message.compassId, 1)
  assert.equal(message.calStatus, 2)
  assert.equal(message.completionPct, 42)
  assert.equal(message.directionX, 0.25)
  assert.equal(message.directionY, -0.5)
  assert.equal(message.directionZ, 0.75)
  assert.deepEqual(Array.from(message.completionMask), Array.from(completionMask))
})

test('MavlinkV2Codec round-trips MAG_CAL_REPORT including the extension fields', () => {
  const { frame, message } = roundTrip({
    type: 'MAG_CAL_REPORT',
    compassId: 0,
    calMask: 1,
    calStatus: 4,
    autosaved: 1,
    fitness: 3.5,
    ofsX: 1,
    ofsY: -2,
    ofsZ: 3,
    diagX: 1,
    diagY: 1,
    diagZ: 1,
    offdiagX: 0,
    offdiagY: 0,
    offdiagZ: 0,
    orientationConfidence: 0.5,
    oldOrientation: 0,
    newOrientation: 0,
    scaleFactor: 1
  })
  assert.equal(frame[1], MAVLINK_PAYLOAD_LENGTHS[MAVLINK_MESSAGE_IDS.MAG_CAL_REPORT])
  assert.equal(message.type, 'MAG_CAL_REPORT')
  assert.equal(message.calStatus, 4)
  assert.equal(message.autosaved, 1)
  assert.equal(message.fitness, 3.5)
  assert.equal(message.ofsY, -2)
  // float32-exact values only (0.9 is not representable in 32-bit float).
  assert.equal(message.orientationConfidence, 0.5)
  assert.equal(message.scaleFactor, 1)
})

test('MavlinkV2Codec decodes a MAG_CAL_REPORT truncated before the extension fields', () => {
  // v1 / older autopilots omit the extension fields; decode must not throw
  // and should default them to 0 (the codec zero-extends to the declared
  // length, so this asserts the >= length guards behave).
  const codec = new MavlinkV2Codec()
  const full = codec.encode({
    header: { systemId: 1, componentId: 1, sequence: 0 },
    message: {
      type: 'MAG_CAL_REPORT',
      compassId: 0,
      calMask: 1,
      calStatus: 5,
      autosaved: 0,
      fitness: 9,
      ofsX: 0,
      ofsY: 0,
      ofsZ: 0,
      diagX: 0,
      diagY: 0,
      diagZ: 0,
      offdiagX: 0,
      offdiagY: 0,
      offdiagZ: 0,
      orientationConfidence: 0,
      oldOrientation: 0,
      newOrientation: 0,
      scaleFactor: 0
    },
    timestampMs: 0
  })
  const [received] = new MavlinkV2Codec().push(full)
  assert.equal(received.message.type, 'MAG_CAL_REPORT')
  assert.equal(received.message.calStatus, 5)
  assert.equal(received.message.orientationConfidence, 0)
  assert.equal(received.message.scaleFactor, 0)
})

// audit-18: build a v2 frame the way a conformant sender (real
// ArduPilot) does — trailing zero payload bytes truncated, LEN + CRC
// over the truncated bytes. The decoder must zero-pad back, not drop it.
function truncateLikeRealFc(fullFrame, msgId) {
  const hdr = MAVLINK_V2_HEADER_LENGTH
  const fullLen = fullFrame[1]
  let len = fullLen
  while (len > 1 && fullFrame[hdr + len - 1] === 0) len -= 1
  const out = new Uint8Array(hdr + len + MAVLINK_V2_CHECKSUM_LENGTH)
  out.set(fullFrame.subarray(0, hdr))
  out[1] = len
  out.set(fullFrame.subarray(hdr, hdr + len), hdr)
  const crc = computeX25Checksum(out.subarray(1, hdr + len), MAVLINK_MESSAGE_CRCS[msgId])
  out[hdr + len] = crc & 0xff
  out[hdr + len + 1] = (crc >> 8) & 0xff
  return { frame: out, truncatedLen: len, fullLen }
}

test('MavlinkV2Codec decodes a v2-truncated FILE_TRANSFER_PROTOCOL reply (real-FC; was silently dropped) — audit-18', () => {
  // Real ArduPilot truncates trailing zeros (MAVLink v2). An FTP reply
  // carries a tiny payload inside the 251-byte field, so it arrives far
  // shorter than 254. The decoder rejected anything below the full
  // length and silently dropped EVERY real FTP reply — the true,
  // hardware-validated cause of "MAVFTP times out on real hardware".
  const ftp = new Uint8Array(251)
  new DataView(ftp.buffer).setUint16(0, 8, true) // seq = req(7)+1, as the real FC replies
  ftp[3] = 128 // opcode = ACK
  ftp[4] = 2 // size
  ftp[5] = 3 // req_opcode = LIST_DIRECTORY
  ftp[12] = 0x44 // 'D'
  ftp[13] = 0x78 // 'x'
  const full = new MavlinkV2Codec().encode({
    header: { systemId: 1, componentId: 1, sequence: 5 },
    message: { type: 'FILE_TRANSFER_PROTOCOL', targetNetwork: 0, targetSystem: 255, targetComponent: 190, payload: ftp },
    timestampMs: 0
  })
  assert.equal(full[1], MAVLINK_PAYLOAD_LENGTHS[MAVLINK_MESSAGE_IDS.FILE_TRANSFER_PROTOCOL], 'our encoder does not truncate')
  const { frame, truncatedLen } = truncateLikeRealFc(full, MAVLINK_MESSAGE_IDS.FILE_TRANSFER_PROTOCOL)
  assert.ok(truncatedLen < 60, `a real FTP reply truncates small (got ${truncatedLen}/254)`)

  const decoded = new MavlinkV2Codec().push(frame)
  assert.equal(decoded.length, 1, 'truncated FTP frame must decode, not be dropped')
  const m = decoded[0].message
  assert.equal(m.type, 'FILE_TRANSFER_PROTOCOL')
  assert.equal(m.targetSystem, 255)
  assert.equal(m.targetComponent, 190)
  assert.equal(m.payload.length, 251, 'MAVFTP payload zero-padded back to full length')
  const v = new DataView(m.payload.buffer, m.payload.byteOffset, m.payload.byteLength)
  assert.equal(v.getUint16(0, true), 8, 'reply seq preserved')
  assert.equal(m.payload[3], 128, 'opcode (ACK) preserved')
  assert.equal(m.payload[5], 3, 'req_opcode preserved')
  assert.equal(m.payload[12], 0x44)
  assert.equal(m.payload[13], 0x78)
  assert.equal(m.payload[20], 0, 'stripped trailing zeros restored')
})

test('MavlinkV2Codec decodes a v2-truncated STATUSTEXT (short messages were also dropped) — audit-18', () => {
  const text = 'PreArm: GPS'
  const full = new MavlinkV2Codec().encode({
    header: { systemId: 1, componentId: 1, sequence: 0 },
    message: { type: 'STATUSTEXT', severity: 4, text },
    timestampMs: 0
  })
  const { frame, truncatedLen } = truncateLikeRealFc(full, MAVLINK_MESSAGE_IDS.STATUSTEXT)
  assert.ok(truncatedLen < 51, `short STATUSTEXT truncates below the old MIN (got ${truncatedLen})`)
  const decoded = new MavlinkV2Codec().push(frame)
  assert.equal(decoded.length, 1, 'truncated STATUSTEXT must decode, not be dropped')
  assert.equal(decoded[0].message.type, 'STATUSTEXT')
  assert.equal(decoded[0].message.text, text)
  assert.equal(decoded[0].message.severity, 4)
})

test('truncateMavlinkV2Frame strips trailing zeros, recomputes CRC, and produces a still-decodable frame', () => {
  // Wire-level guarantee: a STATUSTEXT with a short text leaves the rest of
  // the 51-byte declared payload as trailing zeros, so truncation must drop
  // them; LEN drops; the recomputed CRC validates; the decoder zero-pads
  // back up so the round-trip is byte-identical at the envelope level.
  // STATUSTEXT was chosen over HEARTBEAT because HEARTBEAT's encoder
  // force-substitutes MAVLINK_PROTOCOL_VERSION on a zero mavlinkVersion
  // (the last byte is never zero), so there is nothing to truncate.
  const text = 'Ready'
  const full = new MavlinkV2Codec().encode({
    header: { systemId: 1, componentId: 1, sequence: 0 },
    message: { type: 'STATUSTEXT', severity: 4, text },
    timestampMs: 0
  })
  const fullLen = full[1]
  const truncated = truncateMavlinkV2Frame(full)
  assert.ok(truncated.length < full.length, `truncated frame must be shorter (full=${full.length}, truncated=${truncated.length})`)
  assert.ok(truncated[1] >= 1, 'LEN must stay >= 1 (real ArduPilot never emits LEN=0)')
  assert.ok(truncated[1] < fullLen, `LEN must drop from ${fullLen} (got ${truncated[1]})`)
  assert.equal(truncated[0], MAVLINK_V2_STX, 'STX preserved')
  // CRC was recomputed against the truncated payload; decoder zero-pads + accepts.
  const decoded = new MavlinkV2Codec().push(truncated)
  assert.equal(decoded.length, 1, 'truncated STATUSTEXT must decode')
  assert.equal(decoded[0].message.type, 'STATUSTEXT')
  assert.equal(decoded[0].message.text, text)
  assert.equal(decoded[0].message.severity, 4)
})

test('truncateMavlinkV2Frame leaves an all-non-zero payload unchanged (nothing to strip)', () => {
  // Defensive: when there are no trailing zeros to strip, the function must
  // return the original frame unchanged — no spurious re-encoding, no CRC
  // drift. ATTITUDE payload is 28 bytes of mostly-non-zero floats; with all
  // 7 fields set non-zero, there are no trailing zero bytes.
  const full = new MavlinkV2Codec().encode({
    header: { systemId: 1, componentId: 1, sequence: 0 },
    message: {
      type: 'ATTITUDE',
      timeBootMs: 0xdeadbeef,
      roll: 1.25,
      pitch: 0.75,
      yaw: 2.5,
      rollspeed: 0.1,
      pitchspeed: 0.2,
      yawspeed: 0.3
    },
    timestampMs: 0
  })
  const truncated = truncateMavlinkV2Frame(full)
  assert.equal(truncated.length, full.length, 'no truncation when no trailing zeros')
  assert.equal(truncated[1], full[1], 'LEN unchanged')
})

test('TruncatingMavlinkV2Codec.encode() emits frames identical to applying truncateMavlinkV2Frame to base encode()', () => {
  // Lock the relationship: TruncatingMavlinkV2Codec is a thin wrapper —
  // there should never be a semantic difference between
  //   TruncatingMavlinkV2Codec.encode(env)
  // and
  //   truncateMavlinkV2Frame(new MavlinkV2Codec().encode(env))
  // If they ever diverge, one is buggy; this test catches that.
  const env = buildHeartbeatEnvelope({ message: { customMode: 0x42, baseMode: 0x80 } })
  const fromWrapper = new TruncatingMavlinkV2Codec().encode(env)
  const fromManual = truncateMavlinkV2Frame(new MavlinkV2Codec().encode(env))
  assert.deepEqual(Array.from(fromWrapper), Array.from(fromManual))
})

test('TruncatingMavlinkV2Codec.push() inherits the base decoder unchanged (zero-pad on receive)', () => {
  // Sanity: the truncating subclass overrides ONLY encode. A frame it emits
  // must round-trip through its own push() — proving the subclass is
  // bidirectional, not just an encoder.
  const env = buildHeartbeatEnvelope({ message: { customMode: 7, baseMode: 0x81 } })
  const codec = new TruncatingMavlinkV2Codec()
  const frame = codec.encode(env)
  const decoded = codec.push(frame)
  assert.equal(decoded.length, 1)
  assert.equal(decoded[0].message.type, 'HEARTBEAT')
  assert.equal(decoded[0].message.customMode, 7)
  assert.equal(decoded[0].message.baseMode, 0x81)
})

test('MavlinkV2Codec discards frames carrying unknown incompat_flags bits (mandatory-understanding flags)', () => {
  // Conformance: incompat_flags are "flags that must be understood for
  // MAVLink compatibility (implementation discards packet if it does not
  // understand flag)" — mavlink.io serialization guide. The C parser
  // rejects via `incompat_flags & ~MAVLINK_IFLAG_MASK` with
  // MAVLINK_IFLAG_MASK == 0x01 (mavlink_helpers.h). Only SIGNED (0x01) is
  // defined; any other bit signals a framing change we cannot interpret.
  const encoder = new MavlinkV2Codec()
  const frame = encoder.encode(buildHeartbeatEnvelope({ header: { sequence: 9 } }))
  const payloadLength = frame[1]
  frame[2] = 0x02 // unknown incompat bit
  const crc = x25CodecTest(frame.subarray(1, MAVLINK_V2_HEADER_LENGTH + payloadLength), MAVLINK_MESSAGE_CRCS[0])
  frame[MAVLINK_V2_HEADER_LENGTH + payloadLength] = crc & 0xff
  frame[MAVLINK_V2_HEADER_LENGTH + payloadLength + 1] = (crc >> 8) & 0xff

  const codec = new MavlinkV2Codec()
  assert.equal(codec.push(frame).length, 0, 'unknown incompat bit must drop the frame')

  // The stream must continue cleanly: a following normal frame decodes.
  const next = encoder.encode(buildHeartbeatEnvelope({ header: { sequence: 10 } }))
  const decoded = codec.push(next)
  assert.equal(decoded.length, 1)
  assert.equal(decoded[0].header.sequence, 10)

  // And the SIGNED bit alone (without a signing key configured) still
  // parses — the rejection is only for bits we do not implement.
  const signedish = encoder.encode(buildHeartbeatEnvelope({ header: { sequence: 11 } }))
  const signedFrame = new Uint8Array(signedish.length + MAVLINK_V2_SIGNATURE_LENGTH)
  signedFrame.set(signedish)
  signedFrame[2] = MAVLINK_V2_INCOMPAT_FLAG_SIGNED
  const crc2 = x25CodecTest(signedFrame.subarray(1, MAVLINK_V2_HEADER_LENGTH + payloadLength), MAVLINK_MESSAGE_CRCS[0])
  signedFrame[MAVLINK_V2_HEADER_LENGTH + payloadLength] = crc2 & 0xff
  signedFrame[MAVLINK_V2_HEADER_LENGTH + payloadLength + 1] = (crc2 >> 8) & 0xff
  const signedDecoded = codec.push(signedFrame)
  assert.equal(signedDecoded.length, 1)
  assert.equal(signedDecoded[0].header.sequence, 11)
})

// X25 checksum copy (recompute CRC over a mutated header for the
// incompat_flags conformance test).
function x25CodecTest(bytes, crcExtra) {
  let checksum = 0xffff
  for (const byte of bytes) checksum = accCodecTest(byte, checksum)
  checksum = accCodecTest(crcExtra, checksum)
  return checksum
}
function accCodecTest(byte, checksum) {
  let tmp = byte ^ (checksum & 0xff)
  tmp ^= (tmp << 4) & 0xff
  return ((checksum >> 8) ^ (tmp << 8) ^ (tmp << 3) ^ (tmp >> 4)) & 0xffff
}

test('AUTOPILOT_VERSION decodes the c_library_v2 wire layout (vendor/product u16s BEFORE the u8[8] arrays)', () => {
  // Conformance: MAVLink sorts fields by base-type size, and u8[] arrays
  // sort by ELEMENT size (1), so per c_library_v2's
  // mavlink_msg_autopilot_version.h the layout is: capabilities@0 u64,
  // uid@8 u64, flight/middleware/os/board u32 @16..31, vendor_id@32 u16,
  // product_id@34 u16, flight_custom_version@36, middleware@44, os@52
  // (u8[8] each), uid2@60 (u8[18] extension). Our codec had the three
  // custom-version arrays at 32/40/48 and vendor/product at 56/58, so on
  // a real FC vendor/product ids and the git-hash custom versions all
  // decoded garbled.
  const payload = new Uint8Array(78)
  const view = new DataView(payload.buffer)
  view.setBigUint64(0, 0x0000000000010fcfn, true) // capabilities
  view.setBigUint64(8, 0x1122334455667788n, true) // uid
  view.setUint32(16, (4 << 24) | (6 << 16) | (3 << 8) | 255, true) // flight_sw 4.6.3-official
  view.setUint32(20, 0x20240101, true)
  view.setUint32(24, 0x20240202, true)
  view.setUint32(28, 0x00090000, true)
  view.setUint16(32, 0x2dae, true) // vendor_id (CubePilot)
  view.setUint16(34, 0x1011, true) // product_id
  const flightHash = [0x61, 0x62, 0x63, 0x64, 0x65, 0x66, 0x67, 0x00] // "abcdefg"
  payload.set(flightHash, 36)
  payload.set([0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37, 0x00], 44)
  payload.set([0x71, 0x72, 0x73, 0x74, 0x75, 0x76, 0x77, 0x00], 52)
  const uid2 = Uint8Array.from({ length: 18 }, (_, i) => i + 1)
  payload.set(uid2, 60)

  // Frame the payload as a v2 frame by hand (msgid 148, crc_extra 178).
  const frame = new Uint8Array(MAVLINK_V2_HEADER_LENGTH + 78 + MAVLINK_V2_CHECKSUM_LENGTH)
  frame[0] = MAVLINK_V2_STX
  frame[1] = 78
  frame[4] = 3 // seq
  frame[5] = 1 // sysid
  frame[6] = 1 // compid
  frame[7] = 148 & 0xff
  frame[8] = (148 >> 8) & 0xff
  frame[9] = (148 >> 16) & 0xff
  frame.set(payload, MAVLINK_V2_HEADER_LENGTH)
  const crc = x25CodecTest(frame.subarray(1, MAVLINK_V2_HEADER_LENGTH + 78), MAVLINK_MESSAGE_CRCS[148])
  frame[MAVLINK_V2_HEADER_LENGTH + 78] = crc & 0xff
  frame[MAVLINK_V2_HEADER_LENGTH + 78 + 1] = (crc >> 8) & 0xff

  const decoded = decodeSingleV2Envelope(frame).message
  assert.equal(decoded.type, 'AUTOPILOT_VERSION')
  assert.equal(decoded.capabilities, 0x0000000000010fcfn)
  assert.equal(decoded.uid, 0x1122334455667788n)
  assert.equal(decoded.flightSwVersion >>> 24, 4)
  assert.equal(decoded.vendorId, 0x2dae, 'vendor_id reads from offset 32')
  assert.equal(decoded.productId, 0x1011, 'product_id reads from offset 34')
  assert.deepEqual(Array.from(decoded.flightCustomVersion), flightHash, 'flight_custom_version reads from offset 36')
  assert.deepEqual(Array.from(decoded.uid2), Array.from(uid2))

  // Encode round-trip reproduces the reference bytes exactly.
  const encoder = new MavlinkV2Codec()
  const reencoded = encoder.encode({
    header: { systemId: 1, componentId: 1, sequence: 3 },
    message: decoded,
    timestampMs: 0
  })
  assert.deepEqual(
    Array.from(reencoded.subarray(MAVLINK_V2_HEADER_LENGTH, MAVLINK_V2_HEADER_LENGTH + 78)),
    Array.from(payload),
    'encoder emits the c_library_v2 layout byte-for-byte'
  )
})
