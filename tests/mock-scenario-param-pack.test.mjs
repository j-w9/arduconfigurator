// The demo serves ArduPilot's packed parameter table.
//
// Everything that depends on knowing a parameter's firmware default -- the
// "changed only" filter, the Default column, and the guided sequence's capture
// of settings already on the vehicle -- could otherwise only be exercised
// against hardware. This drives the mock's own FTP handler, which is what the
// app talks to in demo mode.
//
// ArduPilot serves `@`-mounted files as generated content: OPEN reports size 0
// and the client reads until EOF. The test follows that path deliberately,
// because a reader that trusts the declared size gets nothing at all.

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  MavlinkV2Codec,
  MAV_FTP_OPCODE,
  createArduCopterMockScenario,
  decodeSingleV2Envelope
} from '../packages/protocol-mavlink/dist/index.js'

const codec = new MavlinkV2Codec()
const MAV_FTP_ERR_EOF = 6

function ftpFrame({ session = 0, opcode, size = 0, offset = 0, data = new Uint8Array(0) }) {
  const bytes = new Uint8Array(251)
  const view = new DataView(bytes.buffer)
  view.setUint16(0, 0, true)
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

/** Open, then read to EOF, exactly as the client does for an `@` file. */
function readWholeFile(scenario, path) {
  const encoded = new TextEncoder().encode(path)
  const [open] = sendFtp(scenario, ftpFrame({ opcode: MAV_FTP_OPCODE.OPEN_FILE_RO, size: encoded.length, data: encoded }))
  assert.equal(open.opcode, 128, `OPEN was NAK'd for ${path}`)
  const declaredSize = new DataView(open.data.buffer, open.data.byteOffset, open.data.byteLength).getUint32(0, true)

  const chunks = []
  let offset = 0
  for (let guard = 0; guard < 4000; guard += 1) {
    const [read] = sendFtp(
      scenario,
      ftpFrame({ session: open.session, opcode: MAV_FTP_OPCODE.READ_FILE, size: 239, offset })
    )
    if (read.opcode !== 128) {
      assert.equal(read.data[0], MAV_FTP_ERR_EOF, 'read failed for a reason other than EOF')
      break
    }
    chunks.push(read.data)
    offset += read.data.length
    if (read.data.length === 0) break
  }
  const total = chunks.reduce((sum, c) => sum + c.length, 0)
  const bytes = new Uint8Array(total)
  let at = 0
  for (const chunk of chunks) {
    bytes.set(chunk, at)
    at += chunk.length
  }
  return { bytes, declaredSize }
}

test('the demo serves a packed parameter table with defaults', () => {
  const scenario = createArduCopterMockScenario()
  const { bytes, declaredSize } = readWholeFile(scenario, '@PARAM/param.pck?withdefaults=1')

  // An `@` file reports size 0 and is read to EOF, like the real firmware.
  assert.equal(declaredSize, 0)
  assert.ok(bytes.length > 1000, `only ${bytes.length} bytes came back`)

  // 0x671c is the magic for "packed params, with defaults".
  assert.equal(bytes[0] | (bytes[1] << 8), 0x671c)
  const count = bytes[2] | (bytes[3] << 8)
  assert.ok(count > 100, `only ${count} parameters declared`)
})

test('the query string is part of the name, not decoration', () => {
  // The client asks for the `?withdefaults=1` form; the bare path is served too
  // so a caller that drops the query still gets a valid pack rather than a NAK.
  const scenario = createArduCopterMockScenario()
  const { bytes } = readWholeFile(scenario, '@PARAM/param.pck')
  assert.equal(bytes[0] | (bytes[1] << 8), 0x671c)
})
