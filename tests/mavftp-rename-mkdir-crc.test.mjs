import assert from 'node:assert/strict'
import test from 'node:test'

import { MavftpService, osdShorthandCrc32 } from '../packages/ardupilot-core/dist/index.js'
import { MAV_FTP_ERR, MAV_FTP_OPCODE } from '../packages/protocol-mavlink/dist/index.js'

/*
 * The three MAVFTP operations the app did not have: rename, create directory,
 * and the file checksum that lets an upload be verified rather than merely
 * acknowledged.
 *
 * An ack says the packet arrived, not that the file on the far side is the
 * file that was sent. These lock the wire format of each one, because getting
 * a payload layout subtly wrong fails as a NAK from the firmware rather than
 * as anything this side can see.
 */

const VEHICLE = { systemId: 1, componentId: 1 }

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

const u32le = (n) => {
  const b = new Uint8Array(4)
  new DataView(b.buffer).setUint32(0, n >>> 0, true)
  return b
}

/** A vehicle that records what it was asked and answers plausibly. */
function scriptedFc({ crc = 0, seen = [], failCrc = false } = {}) {
  const service = new MavftpService({
    session: {
      send: async (message) => {
        const req = decodeReq(message.payload)
        seen.push(req)
        const reply = (fields) =>
          setTimeout(
            () =>
              service.handleFileTransferProtocol({
                payload: encodeResp({ seq: (req.seq + 1) & 0xffff, reqOpcode: req.opcode, ...fields })
              }),
            0
          )
        switch (req.opcode) {
          case MAV_FTP_OPCODE.CALC_FILE_CRC32:
            if (failCrc) reply({ opcode: MAV_FTP_OPCODE.NAK, data: new Uint8Array([MAV_FTP_ERR.FAIL]) })
            else reply({ opcode: MAV_FTP_OPCODE.ACK, data: u32le(crc) })
            break
          case MAV_FTP_OPCODE.CREATE_FILE:
            reply({ opcode: MAV_FTP_OPCODE.ACK, session: 1 })
            break
          default:
            reply({ opcode: MAV_FTP_OPCODE.ACK })
        }
      }
    },
    getVehicle: () => VEHICLE,
    ensureSupport: async () => {}
  })
  return service
}

const opcodes = (seen) => seen.map((r) => r.opcode)
const text = (bytes) => new TextDecoder().decode(bytes)

test('rename carries both paths in one payload, NUL-separated', async () => {
  // ArduPilot's FTP server splits the payload on the first NUL and renames the
  // first path to the second. A trailing terminator, or two separate
  // requests, is a NAK.
  const seen = []
  const service = scriptedFc({ seen })
  await service.renameRemotePath('/APM/old.bin', '/APM/new.bin')

  const rename = seen.find((r) => r.opcode === MAV_FTP_OPCODE.RENAME)
  assert.ok(rename, 'expected a RENAME')
  const parts = text(rename.data).split('\0')
  assert.deepEqual(parts, ['/APM/old.bin', '/APM/new.bin'])
  assert.equal(rename.size, rename.data.length, 'size must cover both paths and the separator')
})

test('creating a directory names it and nothing else', async () => {
  const seen = []
  const service = scriptedFc({ seen })
  await service.makeRemoteDirectory('/APM/LOGS')

  const mkdir = seen.find((r) => r.opcode === MAV_FTP_OPCODE.CREATE_DIRECTORY)
  assert.ok(mkdir, 'expected a CREATE_DIRECTORY')
  assert.equal(text(mkdir.data), '/APM/LOGS')
})

test('the file checksum comes back as a little-endian u32', async () => {
  const service = scriptedFc({ crc: 0xdeadbeef })
  assert.equal(await service.remoteFileCrc32('/APM/x.bin'), 0xdeadbeef)
})

test('a verified upload accepts a file the vehicle checksums the same', async () => {
  const bytes = new TextEncoder().encode('the bytes that went up')
  const seen = []
  const service = scriptedFc({ crc: osdShorthandCrc32(bytes), seen })
  await service.uploadRemoteFileVerified('/APM/x.bin', bytes)
  // It must actually ask: an upload that never checksums is the unverified
  // one wearing a different name.
  assert.ok(opcodes(seen).includes(MAV_FTP_OPCODE.CALC_FILE_CRC32))
})

test('a verified upload refuses a file the vehicle checksums differently', async () => {
  // The failure this exists for: every write acked, and the file on the far
  // side is still not the file that was sent.
  const bytes = new TextEncoder().encode('the bytes that went up')
  const service = scriptedFc({ crc: osdShorthandCrc32(bytes) ^ 0xff })
  await assert.rejects(
    () => service.uploadRemoteFileVerified('/APM/x.bin', bytes),
    /did not survive the upload/
  )
})

test('a vehicle that cannot checksum fails the upload rather than passing it', async () => {
  const bytes = new TextEncoder().encode('hello')
  const service = scriptedFc({ failCrc: true })
  await assert.rejects(() => service.uploadRemoteFileVerified('/APM/x.bin', bytes))
})
