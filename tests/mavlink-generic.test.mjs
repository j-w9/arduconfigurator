// The generic, decode-only MAVLink path: every message in ArduPilot's dialect
// that the typed codec does not model, decoded off a table generated from the
// XML (scripts/generate-mavlink-generic.mjs). These pin that the generated
// crc_extra agrees with every hand-entered one, that payloads round-trip
// (arrays, char[], extensions, v2 trailing-zero trimming), and that the
// stream parser now passes known-to-XML frames while typed ids keep their
// typed shapes and a truly unknown id is still dropped.

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  MAVLINK_GENERIC_ID_BY_NAME,
  MAVLINK_MESSAGE_CRCS,
  MAVLINK_MESSAGE_IDS,
  MavlinkV2Codec,
  TruncatingMavlinkV2Codec,
  decodeGenericPayload,
  encodeGenericPayload,
  genericMessageFields,
  mavlinkGenericCrcExtra,
  mockExtraTelemetryForTick
} from '../packages/protocol-mavlink/dist/index.js'

const header = { systemId: 1, componentId: 1, sequence: 7 }

function roundTrip(name, fields) {
  const id = MAVLINK_GENERIC_ID_BY_NAME[name]
  const decoded = decodeGenericPayload(id, encodeGenericPayload(name, fields))
  assert.equal(decoded.type, 'GENERIC')
  assert.equal(decoded.name, name)
  assert.equal(decoded.messageId, id)
  return decoded.fields
}

test('generated crc_extra matches every hand-entered MAVLINK_MESSAGE_CRCS entry', () => {
  const ids = Object.keys(MAVLINK_MESSAGE_CRCS).map(Number)
  assert.ok(ids.length >= 30)
  for (const id of ids) {
    // AVAILABLE_MODES / _MONITOR are development-dialect only, which
    // ardupilotmega does not include — the generator checks those itself.
    if (id === MAVLINK_MESSAGE_IDS.AVAILABLE_MODES || id === MAVLINK_MESSAGE_IDS.AVAILABLE_MODES_MONITOR) {
      assert.equal(mavlinkGenericCrcExtra(id), undefined)
      continue
    }
    assert.equal(mavlinkGenericCrcExtra(id), MAVLINK_MESSAGE_CRCS[id], `crc_extra for id ${id}`)
  }
  // Two well-known values not in the hand-entered table.
  assert.equal(mavlinkGenericCrcExtra(MAVLINK_GENERIC_ID_BY_NAME.VFR_HUD), 20)
  assert.equal(mavlinkGenericCrcExtra(MAVLINK_GENERIC_ID_BY_NAME.VIBRATION), 90)
})

test('fields come in wire order with snake_case XML names', () => {
  const names = genericMessageFields('VFR_HUD').map((field) => field.name)
  assert.deepEqual(names, ['airspeed', 'groundspeed', 'alt', 'climb', 'heading', 'throttle'])
  const voltages = genericMessageFields('BATTERY_STATUS').find((field) => field.name === 'voltages')
  assert.equal(voltages.type, 'uint16_t')
  assert.equal(voltages.arrayLength, 10)
  assert.equal(genericMessageFields('NOT_A_MESSAGE'), undefined)
})

test('VFR_HUD round-trips', () => {
  const fields = roundTrip('VFR_HUD', { airspeed: 12.5, groundspeed: 11.25, heading: 271, throttle: 43, alt: 105.5, climb: -1.5 })
  assert.deepEqual(fields, { airspeed: 12.5, groundspeed: 11.25, alt: 105.5, climb: -1.5, heading: 271, throttle: 43 })
})

test('VIBRATION round-trips, uint64 time included', () => {
  const fields = roundTrip('VIBRATION', {
    time_usec: 123_456_789_012,
    vibration_x: 0.5,
    vibration_y: 1.25,
    vibration_z: 2,
    clipping_0: 3,
    clipping_1: 70000,
    clipping_2: 0
  })
  assert.equal(fields.time_usec, 123_456_789_012)
  assert.equal(fields.vibration_y, 1.25)
  assert.equal(fields.clipping_1, 70000)
})

test('BATTERY_STATUS round-trips arrays and signed fields', () => {
  const voltages = [4100, 4110, 4120, 4130, 65535, 65535, 65535, 65535, 65535, 65535]
  const fields = roundTrip('BATTERY_STATUS', {
    voltages,
    current_battery: -1,
    battery_remaining: 72,
    energy_consumed: -1,
    voltages_ext: [1, 2, 3, 4]
  })
  assert.deepEqual(fields.voltages, voltages)
  assert.equal(fields.current_battery, -1)
  assert.equal(fields.energy_consumed, -1)
  assert.equal(fields.battery_remaining, 72)
  assert.deepEqual(fields.voltages_ext, [1, 2, 3, 4])
})

test('char[] decodes as a string trimmed at NUL; extensions decode', () => {
  // NAMED_VALUE_FLOAT: char[10] name. STATUSTEXT: char[50] text + extensions.
  assert.deepEqual(roundTrip('NAMED_VALUE_FLOAT', { time_boot_ms: 9, name: 'RPM1', value: 1234.5 }), {
    time_boot_ms: 9,
    value: 1234.5,
    name: 'RPM1'
  })
  const status = roundTrip('STATUSTEXT', { severity: 6, text: 'Hello', id: 513, chunk_seq: 2 })
  assert.deepEqual(status, { severity: 6, text: 'Hello', id: 513, chunk_seq: 2 })
  const fields = genericMessageFields('STATUSTEXT')
  assert.deepEqual(fields.filter((field) => field.extension).map((field) => field.name), ['id', 'chunk_seq'])
})

test('a trailing-zero-trimmed payload zero-extends; a missing extension reads as zero', () => {
  const payload = encodeGenericPayload('VFR_HUD', { airspeed: 3 })
  assert.equal(payload.length, 4, 'only the non-zero leading float survives trimming')
  const decoded = decodeGenericPayload(MAVLINK_GENERIC_ID_BY_NAME.VFR_HUD, payload)
  assert.deepEqual(decoded.fields, { airspeed: 3, groundspeed: 0, alt: 0, climb: 0, heading: 0, throttle: 0 })
  // An all-zero payload keeps one byte, as ArduPilot sends it.
  assert.equal(encodeGenericPayload('VFR_HUD', {}).length, 1)
  assert.equal(decodeGenericPayload(0xeeeeee, new Uint8Array(4)), undefined)
})

test('the v2 parser yields a GENERIC VFR_HUD and still drops a truly unknown id', () => {
  const codec = new MavlinkV2Codec()
  const frame = codec.encode({
    header,
    message: { type: 'GENERIC', name: 'VFR_HUD', messageId: 74, fields: { airspeed: 8, heading: 90, alt: 20 } }
  })
  const [envelope, ...rest] = new MavlinkV2Codec().push(frame)
  assert.equal(rest.length, 0)
  assert.equal(envelope.message.type, 'GENERIC')
  assert.equal(envelope.message.name, 'VFR_HUD')
  assert.equal(envelope.message.messageId, 74)
  assert.equal(envelope.message.fields.airspeed, 8)
  assert.equal(envelope.message.fields.heading, 90)
  assert.equal(envelope.byteLength, frame.length)

  // Same frame with an id no dialect defines: CRC can't be checked -> junk.
  const tampered = new Uint8Array(frame)
  tampered[7] = 0xee
  tampered[8] = 0xee
  tampered[9] = 0xee
  assert.deepEqual(new MavlinkV2Codec().push(tampered), [])
})

test('generic frames interleave with typed ones; typed ids keep their typed shapes', () => {
  const codec = new TruncatingMavlinkV2Codec()
  const frames = [
    codec.encode({
      header,
      message: { type: 'HEARTBEAT', autopilot: 3, vehicleType: 2, baseMode: 0x81, customMode: 5, systemStatus: 4, mavlinkVersion: 3 }
    }),
    codec.encode({ header, message: { type: 'GENERIC', name: 'VIBRATION', messageId: 241, fields: { vibration_z: 1.5 } } }),
    codec.encode({
      header,
      message: { type: 'ATTITUDE', timeBootMs: 10, rollRad: 0.25, pitchRad: -0.5, yawRad: 1, rollSpeedRadS: 0, pitchSpeedRadS: 0, yawSpeedRadS: 0 }
    })
  ]
  const joined = new Uint8Array(frames.reduce((total, frame) => total + frame.length, 0))
  let offset = 0
  for (const frame of frames) {
    joined.set(frame, offset)
    offset += frame.length
  }
  const messages = new MavlinkV2Codec().push(joined).map((envelope) => envelope.message)
  assert.deepEqual(messages.map((message) => message.type), ['HEARTBEAT', 'GENERIC', 'ATTITUDE'])
  assert.equal(messages[0].customMode, 5)
  assert.equal(messages[0].vehicleType, 2)
  assert.equal(messages[1].name, 'VIBRATION')
  assert.equal(messages[1].fields.vibration_z, 1.5)
  assert.equal(messages[2].rollRad, 0.25)
  assert.equal(messages[2].pitchRad, -0.5)
})

test('ids the hand-entered table lists but nothing decodes stay dropped (GPS_INPUT)', () => {
  const frame = new MavlinkV2Codec().encode({
    header,
    message: {
      type: 'GPS_INPUT',
      gpsId: 0,
      ignoreFlags: 0,
      fixType: 3,
      latitudeE7: 1,
      longitudeE7: 1,
      altitudeM: 1,
      hdop: 1,
      vdop: 1,
      satellitesVisible: 10
    }
  })
  assert.deepEqual(new MavlinkV2Codec().push(frame), [])
})

test('every demo extra-telemetry field exists in its message definition and survives the wire', () => {
  const codec = new TruncatingMavlinkV2Codec()
  const seen = new Set()
  for (let tick = 0; tick < 8; tick += 1) {
    for (const message of mockExtraTelemetryForTick(tick, tick * 250)) {
      const known = new Set(genericMessageFields(message.name).map((field) => field.name))
      for (const name of Object.keys(message.fields)) {
        assert.ok(known.has(name), `${message.name}.${name} is not in the XML`)
      }
      const [envelope] = new MavlinkV2Codec().push(codec.encode({ header, message }))
      assert.equal(envelope.message.name, message.name)
      seen.add(message.name)
    }
  }
  assert.deepEqual([...seen].sort(), [
    'AHRS2',
    'BATTERY_STATUS',
    'EKF_STATUS_REPORT',
    'LOCAL_POSITION_NED',
    'NAV_CONTROLLER_OUTPUT',
    'POWER_STATUS',
    'RAW_IMU',
    'SCALED_PRESSURE',
    'VFR_HUD',
    'VIBRATION'
  ])
})
