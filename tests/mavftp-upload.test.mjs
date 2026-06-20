import assert from 'node:assert/strict'
import test from 'node:test'

import { MavftpService } from '../packages/ardupilot-core/dist/index.js'
import { MAV_FTP_ERR, MAV_FTP_OPCODE } from '../packages/protocol-mavlink/dist/index.js'

// Unit coverage for the MAVFTP UPLOAD path (CREATE_FILE -> WRITE_FILE chunks ->
// TERMINATE_SESSION). The full CRUD is exercised in the integration suite against
// the mock SITL; this pins the upload wire protocol (seq+1, chunked writes
// reassembling at the right offsets, and the overwrite=delete+recreate path)
// against a scripted FC, independent of the package.

const VEHICLE = { systemId: 1, componentId: 1, firmware: 'ArduPilot', vehicle: 'ArduCopter', armed: false }

function decodeReq(payload) {
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength)
  const size = payload[4] ?? 0
  return {
    seq: view.getUint16(0, true),
    session: payload[2] ?? 0,
    opcode: payload[3] ?? 0,
    offset: view.getUint32(8, true),
    size,
    data: payload.slice(12, 12 + size)
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

// A scripted FC that accepts an upload. `existsOnce` makes the first CREATE_FILE
// NAK with FILE_EXISTS (to exercise the overwrite=delete+recreate path).
function scriptedUploadFc({ existsOnce = false } = {}) {
  const state = { createdPath: undefined, writes: [], terminated: false, removed: [], createCount: 0 }
  let pendingExists = existsOnce
  const service = new MavftpService({
    session: {
      send: async (message) => {
        const req = decodeReq(message.payload)
        const reply = (fields) =>
          setTimeout(
            () =>
              service.handleFileTransferProtocol({
                payload: encodeResp({ seq: (req.seq + 1) & 0xffff, reqOpcode: req.opcode, ...fields })
              }),
            0
          )
        switch (req.opcode) {
          case MAV_FTP_OPCODE.CREATE_FILE:
            state.createCount += 1
            if (pendingExists) {
              pendingExists = false
              reply({ opcode: MAV_FTP_OPCODE.NAK, data: new Uint8Array([MAV_FTP_ERR.FILE_EXISTS]) })
            } else {
              state.createdPath = new TextDecoder().decode(req.data)
              reply({ opcode: MAV_FTP_OPCODE.ACK, session: 7 })
            }
            break
          case MAV_FTP_OPCODE.WRITE_FILE:
            state.writes.push({ offset: req.offset, data: req.data })
            reply({ opcode: MAV_FTP_OPCODE.ACK, session: req.session })
            break
          case MAV_FTP_OPCODE.REMOVE_FILE:
            state.removed.push(new TextDecoder().decode(req.data))
            reply({ opcode: MAV_FTP_OPCODE.ACK })
            break
          case MAV_FTP_OPCODE.TERMINATE_SESSION:
            state.terminated = true
            reply({ opcode: MAV_FTP_OPCODE.ACK })
            break
          default:
            reply({ opcode: MAV_FTP_OPCODE.ACK })
        }
      }
    },
    getVehicle: () => VEHICLE,
    ensureSupport: async () => {}
  })
  const reassemble = () => {
    const total = state.writes.reduce((max, w) => Math.max(max, w.offset + w.data.length), 0)
    const out = new Uint8Array(total)
    for (const w of state.writes) out.set(w.data, w.offset)
    return out
  }
  return { service, state, reassemble }
}

test('uploadRemoteFile creates the file then writes chunked bytes that reassemble exactly', async () => {
  const { service, state, reassemble } = scriptedUploadFc()
  // Larger than one transfer chunk so the chunked-write offsets are exercised.
  const payload = new Uint8Array(700).map((_, i) => (i * 7) & 0xff)
  await service.uploadRemoteFile('@SYS/scripts/up.lua', payload)

  assert.equal(state.createdPath, '@SYS/scripts/up.lua', 'CREATE_FILE carried the path')
  assert.ok(state.writes.length >= 2, 'a >1-chunk payload should issue multiple WRITE_FILE requests')
  assert.deepEqual(reassemble(), payload, 'the written chunks reassemble to the original bytes')
  assert.equal(state.terminated, true, 'the session is terminated after the writes')
})

test('uploadRemoteFile with overwrite deletes the existing file then recreates + writes', async () => {
  const { service, state, reassemble } = scriptedUploadFc({ existsOnce: true })
  const payload = new TextEncoder().encode("return 'hi'\n")
  await service.uploadRemoteFile('@SYS/scripts/up.lua', payload, { overwrite: true })

  assert.deepEqual(state.removed, ['@SYS/scripts/up.lua'], 'the pre-existing file is removed first')
  assert.equal(state.createCount, 2, 'CREATE_FILE is retried after the delete')
  assert.deepEqual(reassemble(), payload, 'the bytes are written after recreate')
  assert.equal(state.terminated, true)
})

test('uploadRemoteFile without overwrite surfaces a FILE_EXISTS failure', async () => {
  const { service } = scriptedUploadFc({ existsOnce: true })
  await assert.rejects(
    () => service.uploadRemoteFile('@SYS/scripts/up.lua', new Uint8Array([1, 2, 3]), { overwrite: false }),
    /exist/i
  )
})
