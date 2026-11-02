// packages/dronecan-dsdl against the reference implementation.
//
// tests/fixtures/dronecan-dsdl-vectors.json was produced by pydronecan
// (packages/dronecan-dsdl/tools/generate.py): seeded random values for every
// type in the bundled DSDL, packed by pydronecan, and read back by it for the
// canonical value. The TypeScript codec must agree in both directions, for
// every type, with and without the tail array optimisation.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { DronecanCatalogue, float16Bits, float16Value } from '../packages/dronecan-dsdl/dist/index.js'
import {
  DRONECAN_ESC_STATUS_SIGNATURE,
  DRONECAN_FILE_BEGIN_FIRMWARE_UPDATE_SIGNATURE,
  DRONECAN_FILE_READ_SIGNATURE,
  DRONECAN_GET_NODE_INFO_SIGNATURE,
  DRONECAN_NODE_STATUS_SIGNATURE,
  DRONECAN_PARAM_EXECUTE_OPCODE_SIGNATURE,
  DRONECAN_PARAM_GETSET_SIGNATURE,
  DRONECAN_RESTART_NODE_SIGNATURE,
  encodeDronecanNodeStatus,
  decodeDronecanNodeStatus,
  decodeDronecanGetNodeInfoResponse,
  decodeDronecanGetSetResponse
} from '../packages/protocol-mavlink/dist/index.js'

const { vectors } = JSON.parse(readFileSync(new URL('./fixtures/dronecan-dsdl-vectors.json', import.meta.url), 'utf8'))
const catalogue = new DronecanCatalogue()

/** JSON vectors write >53-bit integers as {$bigint}. */
function revive(value) {
  if (Array.isArray(value)) return value.map(revive)
  if (value && typeof value === 'object') {
    if ('$bigint' in value) return BigInt(value.$bigint)
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, revive(inner)]))
  }
  return value
}

const hex = (bytes) => Buffer.from(bytes).toString('hex')

test('every pydronecan vector decodes to the reference value', () => {
  assert.ok(vectors.length > 600, `expected the full vector set, got ${vectors.length}`)
  const failures = []
  for (const vector of vectors) {
    try {
      const decoded = catalogue.decode(vector.type, vector.section, Buffer.from(vector.hex, 'hex'), { tao: vector.tao })
      assert.deepStrictEqual(decoded, revive(vector.value))
    } catch (error) {
      failures.push(`${vector.type} ${vector.section} tao=${vector.tao}: ${error.message.split('\n')[0]}`)
    }
  }
  assert.deepEqual(failures.slice(0, 10), [], `${failures.length} of ${vectors.length} failed`)
})

test('every reference value encodes back to the reference bytes', () => {
  const failures = []
  for (const vector of vectors) {
    try {
      const encoded = catalogue.encode(vector.type, vector.section, revive(vector.value), { tao: vector.tao })
      assert.equal(hex(encoded), vector.hex)
    } catch (error) {
      failures.push(`${vector.type} ${vector.section} tao=${vector.tao}: ${error.message.split('\n')[0]}`)
    }
  }
  assert.deepEqual(failures.slice(0, 10), [], `${failures.length} of ${vectors.length} failed`)
})

test('the catalogue agrees with the signatures the app already hard-codes', () => {
  const expected = {
    'uavcan.protocol.NodeStatus': [341, DRONECAN_NODE_STATUS_SIGNATURE],
    'uavcan.protocol.GetNodeInfo': [1, DRONECAN_GET_NODE_INFO_SIGNATURE],
    'uavcan.protocol.param.GetSet': [11, DRONECAN_PARAM_GETSET_SIGNATURE],
    'uavcan.protocol.param.ExecuteOpcode': [10, DRONECAN_PARAM_EXECUTE_OPCODE_SIGNATURE],
    'uavcan.protocol.RestartNode': [5, DRONECAN_RESTART_NODE_SIGNATURE],
    'uavcan.protocol.file.BeginFirmwareUpdate': [40, DRONECAN_FILE_BEGIN_FIRMWARE_UPDATE_SIGNATURE],
    'uavcan.protocol.file.Read': [48, DRONECAN_FILE_READ_SIGNATURE],
    'uavcan.equipment.esc.Status': [1034, DRONECAN_ESC_STATUS_SIGNATURE]
  }
  for (const [name, [id, signature]] of Object.entries(expected)) {
    const info = catalogue.info(name)
    assert.equal(info.dataTypeId, id, name)
    assert.equal(info.signature, signature, name)
  }
  assert.equal(catalogue.messageById(341).fullName, 'uavcan.protocol.NodeStatus')
  assert.equal(catalogue.serviceById(11).fullName, 'uavcan.protocol.param.GetSet')
  assert.equal(catalogue.messageById(9999), undefined)
})

test('the generic codec reads the app\'s own hand-written NodeStatus encoder', () => {
  const payload = encodeDronecanNodeStatus({ uptimeSec: 123456, health: 1, mode: 2, subMode: 3, vendorSpecificStatusCode: 0xbeef })
  assert.deepEqual(catalogue.decode('uavcan.protocol.NodeStatus', 'msg', payload), {
    uptime_sec: 123456,
    health: 1,
    mode: 2,
    sub_mode: 3,
    vendor_specific_status_code: 0xbeef
  })
})

test('float16 matches libuavcan at the edges', () => {
  assert.equal(float16Value(float16Bits(1)), 1)
  assert.equal(float16Value(float16Bits(-2.5)), -2.5)
  assert.equal(float16Value(float16Bits(65504)), 65504)
  assert.equal(float16Value(float16Bits(1e6)), Number.POSITIVE_INFINITY)
  assert.ok(Number.isNaN(float16Value(float16Bits(Number.NaN))))
})

// The hand-written decoders the runtime has used since before the catalogue,
// checked against the reference on the same vectors. Two were wrong.
const sample = (type, section) => vectors.filter((vector) => vector.type === type && vector.section === section && vector.tao)

test('the hand-written NodeStatus decoder and encoder use DroneCAN bit order', () => {
  for (const vector of sample('uavcan.protocol.NodeStatus', 'msg')) {
    const bytes = Buffer.from(vector.hex, 'hex')
    const decoded = decodeDronecanNodeStatus(bytes)
    assert.deepEqual(
      { health: decoded.health, mode: decoded.mode, sub_mode: decoded.subMode },
      { health: vector.value.health, mode: vector.value.mode, sub_mode: vector.value.sub_mode }
    )
    assert.equal(
      hex(encodeDronecanNodeStatus({ uptimeSec: decoded.uptimeSec, health: decoded.health, mode: decoded.mode, subMode: decoded.subMode, vendorSpecificStatusCode: decoded.vendorSpecificStatusCode })),
      vector.hex
    )
  }
  // The field report case: a node in software-update mode (mode 3).
  assert.equal(decodeDronecanNodeStatus(Uint8Array.from([0, 0, 0, 0, 0b00011000, 0, 0])).mode, 3)
})

test('the hand-written GetNodeInfo decoder reads the embedded status the same way', () => {
  for (const vector of sample('uavcan.protocol.GetNodeInfo', 'res')) {
    const decoded = decodeDronecanGetNodeInfoResponse(Buffer.from(vector.hex, 'hex'))
    assert.equal(decoded.status.health, vector.value.status.health)
    assert.equal(decoded.status.mode, vector.value.status.mode)
    assert.equal(decoded.status.subMode, vector.value.status.sub_mode)
  }
})

test('the hand-written GetSet decoder accepts a bool or string default value', () => {
  for (const vector of sample('uavcan.protocol.param.GetSet', 'res')) {
    assert.ok(decodeDronecanGetSetResponse(Buffer.from(vector.hex, 'hex')), `rejected ${JSON.stringify(vector.value).slice(0, 120)}`)
  }
  // value = bool true, default = bool false, max/min empty, name "X".
  const bytes = Uint8Array.from([3, 1, 3, 0, 0, 0, 0x58])
  const decoded = decodeDronecanGetSetResponse(bytes)
  assert.deepEqual(decoded.defaultValue, { tag: 'bool', bool: false })
  assert.equal(decoded.name, 'X')
})

// --- Transfers from frames -------------------------------------------------

import { canFrameFromRawId } from '../packages/can-core/dist/index.js'
import { DronecanTransferDecoder } from '../packages/dronecan-dsdl/dist/index.js'
import {
  dronecanBuildBroadcastFrames,
  dronecanBuildServiceFrames,
  encodeDronecanEscStatus,
  encodeDronecanGetSetResponse,
  DRONECAN_ESC_STATUS_DT_ID,
  DRONECAN_NODE_STATUS_DT_ID,
  DRONECAN_PARAM_GETSET_SERVICE_ID
} from '../packages/protocol-mavlink/dist/index.js'

let seq = 0
const toFrames = (built, extra = {}) =>
  built.map((frame) => ({
    ...canFrameFromRawId({ timestampMs: 1000 + seq, bus: 1, rawId: (frame.canId | 0x80000000) >>> 0, data: frame.data, ...extra }),
    seq: ++seq
  }))

function feed(decoder, frames) {
  const done = []
  for (const frame of frames) {
    const transfer = decoder.push(frame)
    if (transfer) done.push(transfer)
  }
  return done
}

test('a single-frame NodeStatus decodes through the catalogue', () => {
  const decoder = new DronecanTransferDecoder(catalogue)
  const frames = toFrames(
    dronecanBuildBroadcastFrames(
      { messageTypeId: DRONECAN_NODE_STATUS_DT_ID, signature: DRONECAN_NODE_STATUS_SIGNATURE, sourceNodeId: 124, transferId: 7 },
      encodeDronecanNodeStatus({ uptimeSec: 42, health: 1, mode: 3, subMode: 0, vendorSpecificStatusCode: 9 })
    )
  )
  const [transfer] = feed(decoder, frames)
  assert.equal(transfer.type.fullName, 'uavcan.protocol.NodeStatus')
  assert.equal(transfer.kind, 'message')
  assert.equal(transfer.sourceNodeId, 124)
  assert.equal(transfer.transferId, 7)
  assert.deepEqual(transfer.value, { uptime_sec: 42, health: 1, mode: 3, sub_mode: 0, vendor_specific_status_code: 9 })
})

test('a multi-frame esc.Status is reassembled, CRC-checked and decoded', () => {
  const decoder = new DronecanTransferDecoder(catalogue)
  const frames = toFrames(
    dronecanBuildBroadcastFrames(
      { messageTypeId: DRONECAN_ESC_STATUS_DT_ID, signature: DRONECAN_ESC_STATUS_SIGNATURE, sourceNodeId: 50, transferId: 3 },
      encodeDronecanEscStatus({ errorCount: 2, voltage: 16, current: 7.5, temperature: 305, rpm: 4800, powerRatingPct: 40, escIndex: 1 })
    )
  )
  assert.ok(frames.length > 1, 'esc.Status is a multi-frame transfer')
  const done = feed(decoder, frames)
  assert.equal(done.length, 1)
  assert.deepEqual(done[0].frameSeqs, frames.map((frame) => frame.seq))
  assert.equal(done[0].problem, undefined)
  assert.equal(done[0].value.rpm, 4800)
  assert.equal(done[0].value.esc_index, 1)
  assert.equal(done[0].value.voltage, 16)
})

test('a service response is decoded with its source and destination', () => {
  const decoder = new DronecanTransferDecoder(catalogue)
  const payload = encodeDronecanGetSetResponse({
    value: { tag: 'int64', int64: 9n },
    defaultValue: { tag: 'int64', int64: 0n },
    maxValue: { tag: 'empty' },
    minValue: { tag: 'empty' },
    name: 'GPS_TYPE'
  })
  const frames = toFrames(
    dronecanBuildServiceFrames(
      { serviceTypeId: DRONECAN_PARAM_GETSET_SERVICE_ID, signature: DRONECAN_PARAM_GETSET_SIGNATURE, destinationNodeId: 127, sourceNodeId: 124, transferId: 1, isRequest: false },
      payload
    )
  )
  const [transfer] = feed(decoder, frames)
  assert.equal(transfer.kind, 'response')
  assert.equal(transfer.type.fullName, 'uavcan.protocol.param.GetSet')
  assert.equal(transfer.destinationNodeId, 127)
  assert.deepEqual(transfer.value.value, { integer_value: 9 })
  assert.equal(Buffer.from(transfer.value.name).toString(), 'GPS_TYPE')
})

test('a corrupted multi-frame transfer is reported, not decoded', () => {
  const decoder = new DronecanTransferDecoder(catalogue)
  const frames = toFrames(
    dronecanBuildBroadcastFrames(
      { messageTypeId: DRONECAN_ESC_STATUS_DT_ID, signature: DRONECAN_ESC_STATUS_SIGNATURE, sourceNodeId: 50, transferId: 4 },
      encodeDronecanEscStatus({ errorCount: 0, voltage: 1, current: 1, temperature: 300, rpm: 1, powerRatingPct: 1, escIndex: 0 })
    )
  )
  frames[1].data = Uint8Array.from(frames[1].data)
  frames[1].data[0] ^= 0xff
  const [transfer] = feed(decoder, frames)
  assert.equal(transfer.value, undefined)
  assert.match(transfer.problem, /CRC/)
})

test('unknown types, plain CAN and orphan middle frames are handled quietly', () => {
  const decoder = new DronecanTransferDecoder(catalogue)
  // msg type 60000 is not in the DSDL (single frame: no CRC to check).
  const unknown = toFrames([{ canId: (24 << 24) | (60000 << 8) | 10, data: Uint8Array.from([1, 2, 0xc0]) }])
  const [transfer] = feed(decoder, unknown)
  assert.match(transfer.problem, /not in this build/)
  // A standard-id frame is not DroneCAN.
  assert.equal(decoder.push({ ...canFrameFromRawId({ timestampMs: 0, bus: 1, rawId: 0x123, data: Uint8Array.from([0xc0]) }), seq: 999 }), undefined)
  // A middle frame with no start is dropped.
  assert.equal(decoder.push({ ...canFrameFromRawId({ timestampMs: 0, bus: 1, rawId: 0x80000000 | (24 << 24) | (1034 << 8) | 50, data: Uint8Array.from([1, 0x25]) }), seq: 1000 }), undefined)
})
