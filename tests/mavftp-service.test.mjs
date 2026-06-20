import assert from 'node:assert/strict'
import test from 'node:test'

import { MavftpService } from '../packages/ardupilot-core/dist/index.js'
import { MAV_FTP_ERR, MAV_FTP_OPCODE } from '../packages/protocol-mavlink/dist/index.js'

const VEHICLE = { systemId: 1, componentId: 1, firmware: 'ArduPilot', vehicle: 'ArduCopter', armed: false }

// Minimal MAVFTP wire codec (12-byte header + data) — kept local so the
// test pins the on-the-wire contract independently of the package.
function decodeReq(payload) {
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength)
  const size = payload[4] ?? 0
  return {
    seq: view.getUint16(0, true),
    session: payload[2] ?? 0,
    opcode: payload[3] ?? 0,
    offset: view.getUint32(8, true),
    size
  }
}

function encodeResp({ seq, session = 0, opcode, reqOpcode, offset = 0, data = new Uint8Array(0) }) {
  const bytes = new Uint8Array(12 + data.length)
  const view = new DataView(bytes.buffer)
  view.setUint16(0, seq & 0xffff, true)
  bytes[2] = session & 0xff
  bytes[3] = opcode & 0xff
  bytes[4] = data.length & 0xff
  bytes[5] = reqOpcode & 0xff
  view.setUint32(8, offset >>> 0, true)
  bytes.set(data, 12)
  return bytes
}

const u32le = (n) => {
  const b = new Uint8Array(4)
  new DataView(b.buffer).setUint32(0, n >>> 0, true)
  return b
}

// A scripted FC that answers FILE_TRANSFER_PROTOCOL requests. `seqDelta`
// is what it adds to the request seq on its reply — the spec value is +1
// (ArduPilot GCS_FTP.cpp). `fileBytes`/`reportedSize` model a virtual
// `@SYS` file (size 0 on OPEN, streamed until an EOF NAK).
function scriptedFc({ fileBytes, reportedSize, seqDelta = 1, sentOpcodes = [] }) {
  const service = new MavftpService({
    session: {
      send: async (message) => {
        const req = decodeReq(message.payload)
        sentOpcodes.push(req.opcode)
        const reply = (fields) =>
          setTimeout(
            () =>
              service.handleFileTransferProtocol({
                payload: encodeResp({ seq: (req.seq + seqDelta) & 0xffff, reqOpcode: req.opcode, ...fields })
              }),
            0
          )
        switch (req.opcode) {
          case MAV_FTP_OPCODE.OPEN_FILE_RO:
            reply({ opcode: MAV_FTP_OPCODE.ACK, session: 1, data: u32le(reportedSize) })
            break
          case MAV_FTP_OPCODE.READ_FILE:
            if (req.offset >= fileBytes.length) {
              reply({ opcode: MAV_FTP_OPCODE.NAK, data: new Uint8Array([MAV_FTP_ERR.EOF]) })
            } else {
              reply({
                opcode: MAV_FTP_OPCODE.ACK,
                offset: req.offset,
                data: fileBytes.slice(req.offset, req.offset + req.size)
              })
            }
            break
          default: // TERMINATE_SESSION etc. — ACK is enough
            reply({ opcode: MAV_FTP_OPCODE.ACK })
        }
      }
    },
    getVehicle: () => VEHICLE,
    ensureSupport: async () => {}
  })
  return service
}

test('RESET_SESSIONS is sent once before the first session-allocating op, and re-armed after cancelAll (conformance fix)', async () => {
  // The MAVLink FTP spec has the client clear stale server sessions at
  // startup; without it, a session leaked by a crashed prior client
  // NAKs our OPEN/CREATE with kErrFail until ArduPilot's ~20s idle
  // sweep. Lock: exactly one RESET_SESSIONS before the first open,
  // none on subsequent ops, and a fresh one after cancelAll (link
  // drop = exactly when OUR session may have leaked).
  const fileBytes = new TextEncoder().encode('hello')
  const sentOpcodes = []
  const service = scriptedFc({ fileBytes, reportedSize: fileBytes.length, sentOpcodes })

  await service.readRemoteFile('/APM/a.txt', { timeoutMs: 1000 })
  assert.equal(sentOpcodes[0], MAV_FTP_OPCODE.RESET_SESSIONS, 'first wire op is RESET_SESSIONS')
  assert.equal(
    sentOpcodes.filter((opcode) => opcode === MAV_FTP_OPCODE.RESET_SESSIONS).length,
    1,
    'sent exactly once'
  )

  await service.readRemoteFile('/APM/a.txt', { timeoutMs: 1000 })
  assert.equal(
    sentOpcodes.filter((opcode) => opcode === MAV_FTP_OPCODE.RESET_SESSIONS).length,
    1,
    'NOT re-sent for subsequent ops in the same link session'
  )

  service.cancelAll(new Error('link dropped'))
  await service.readRemoteFile('/APM/a.txt', { timeoutMs: 1000 })
  assert.equal(
    sentOpcodes.filter((opcode) => opcode === MAV_FTP_OPCODE.RESET_SESSIONS).length,
    2,
    're-armed after cancelAll'
  )
})

test('a same-seq response does NOT satisfy the waiter (the server replies seq + 1)', async () => {
  // The MAVLink FTP server replies with request seq + 1. A server that
  // (wrongly) echoes the request seq must NOT resolve the request — this
  // is exactly the off-by-one that passed the old echo-seq mock but
  // timed out every real-hardware MAVFTP op.
  const service = scriptedFc({ fileBytes: new Uint8Array([1, 2, 3]), reportedSize: 0, seqDelta: 0 })
  await assert.rejects(
    () => service.readRemoteTextFile('@SYS/uarts.txt', { timeoutMs: 80 }),
    /Timed out waiting for MAVFTP response after 80ms\./
  )
})

test('a size-0 @SYS virtual file is read to completion via the EOF NAK (seq + 1)', async () => {
  // Finding C: ArduPilot @SYS files report size 0 on OPEN; the old
  // `while (offset < fileSize)` loop read nothing. The read must run
  // until the server's EOF NAK and return the full content.
  const content = 'SERIAL0 OTG1 TX=1 RX=2 TXBD=115200 RXBD=115200\nSERIAL1 UART7 TX=3 RX=4 TXBD=57600 RXBD=57600\n'
  const fileBytes = new TextEncoder().encode(content)
  const service = scriptedFc({ fileBytes, reportedSize: 0, seqDelta: 1 })
  const text = await service.readRemoteTextFile('@SYS/uarts.txt', { timeoutMs: 1000 })
  assert.equal(text, content)
})

test('a normal file with a declared size still reads correctly (seq + 1)', async () => {
  const fileBytes = new Uint8Array(450).map((_, i) => i & 0xff)
  const service = scriptedFc({ fileBytes, reportedSize: fileBytes.length, seqDelta: 1 })
  const bytes = await service.readRemoteFile('/APM/defaults.parm', { timeoutMs: 1000 })
  assert.deepEqual(bytes, fileBytes)
})
