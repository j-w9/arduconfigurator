import assert from 'node:assert/strict'
import test from 'node:test'

import {
  MavlinkV2Codec,
  MAV_FTP_OPCODE,
  createArduCopterMockScenario,
  decodeSingleV2Envelope
} from '../packages/protocol-mavlink/dist/index.js'

const codec = new MavlinkV2Codec()

function ftpFrame({ seqNumber = 0, session = 0, opcode, size = 0, offset = 0, data = new Uint8Array(0) }) {
  const bytes = new Uint8Array(251)
  const view = new DataView(bytes.buffer)
  view.setUint16(0, seqNumber & 0xffff, true)
  bytes[2] = session & 0xff
  bytes[3] = opcode & 0xff
  bytes[4] = size & 0xff
  view.setUint32(8, offset >>> 0, true)
  bytes.set(data.slice(0, Math.min(size, 239)), 12)
  return bytes
}

function decodeFtp(payload) {
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength)
  const size = payload[4] ?? 0
  return {
    session: payload[2] ?? 0,
    opcode: payload[3] ?? 0,
    size,
    reqOpcode: payload[5] ?? 0,
    burstComplete: payload[6] ?? 0,
    offset: view.getUint32(8, true),
    data: payload.slice(12, 12 + size)
  }
}

function sendFtp(scenario, frame) {
  const outbound = codec.encode({
    header: { systemId: 255, componentId: 0, sequence: 0 },
    message: {
      type: 'FILE_TRANSFER_PROTOCOL',
      targetNetwork: 0,
      targetSystem: 1,
      targetComponent: 1,
      payload: frame
    },
    timestampMs: 0
  })
  return scenario
    .respondToOutbound(outbound)
    .map((bytes) => decodeFtp(decodeSingleV2Envelope(bytes).message.payload))
}

function expectedLogBytes(seed, length) {
  const bytes = new Uint8Array(length)
  for (let i = 0; i < length; i += 1) bytes[i] = (i + seed) & 0xff
  return bytes
}

test('mock scenario lists the seeded onboard logs under /APM/LOGS', () => {
  const scenario = createArduCopterMockScenario()
  const [entry] = sendFtp(scenario, ftpFrame({ opcode: MAV_FTP_OPCODE.LIST_DIRECTORY, size: 9, data: new TextEncoder().encode('/APM/LOGS') }))
  const listing = new TextDecoder().decode(entry.data)
  assert.match(listing, /00000001\.BIN/)
  assert.match(listing, /00000002\.BIN/)
})

test('mock scenario streams a BURST_READ_FILE that assembles to the deterministic log bytes', () => {
  const scenario = createArduCopterMockScenario()

  const path = '/APM/LOGS/00000001.BIN'
  const [open] = sendFtp(scenario, ftpFrame({ opcode: MAV_FTP_OPCODE.OPEN_FILE_RO, size: path.length, data: new TextEncoder().encode(path) }))
  const session = open.session
  const declaredSize = new DataView(open.data.buffer, open.data.byteOffset, open.data.byteLength).getUint32(0, true)
  assert.equal(declaredSize, 600)

  const packets = sendFtp(scenario, ftpFrame({ opcode: MAV_FTP_OPCODE.BURST_READ_FILE, session, size: 239, offset: 0 }))
  assert.ok(packets.length >= 3, 'a 600-byte log needs 239+239+122 burst packets')
  assert.equal(packets.at(-1).burstComplete, 1, 'the final packet sets burstComplete')
  assert.equal(packets.every((p) => p.reqOpcode === MAV_FTP_OPCODE.BURST_READ_FILE), true)

  const assembled = new Uint8Array(declaredSize)
  for (const packet of packets) assembled.set(packet.data, packet.offset)
  assert.deepEqual(Array.from(assembled), Array.from(expectedLogBytes(1, 600)))
})

test('mock scenario NAKs a BURST_READ_FILE past end-of-file with EOF', () => {
  const scenario = createArduCopterMockScenario()
  const path = '/APM/LOGS/00000002.BIN'
  const [open] = sendFtp(scenario, ftpFrame({ opcode: MAV_FTP_OPCODE.OPEN_FILE_RO, size: path.length, data: new TextEncoder().encode(path) }))

  const past = sendFtp(scenario, ftpFrame({ opcode: MAV_FTP_OPCODE.BURST_READ_FILE, session: open.session, size: 239, offset: 528 }))
  assert.equal(past.length, 1)
  assert.equal(past[0].opcode, MAV_FTP_OPCODE.NAK)
})
