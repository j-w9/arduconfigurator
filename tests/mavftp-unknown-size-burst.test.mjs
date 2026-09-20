// Bursting a file whose size the vehicle will not declare.
//
// ArduPilot's `@`-mounted virtual files -- @PARAM/param.pck above all -- are
// generated on the fly and report size 0 on OPEN. The burst server streams
// them perfectly well; it was OUR reader that needed a declared size, to
// preallocate and to know when to stop. Without it every packed-defaults read
// fell back to the sequential READ_FILE loop: ~126 blocking 200-byte round
// trips for a 25 KB pack.
//
// These tests are about the reader, so the server here declares no size and
// ends the file with an EOF NAK, which is what a real one does.

import assert from 'node:assert/strict'
import test from 'node:test'

import { MavftpService } from '../packages/ardupilot-core/dist/index.js'
import { MAV_FTP_OPCODE } from '../packages/protocol-mavlink/dist/index.js'

const VEHICLE = { systemId: 1, componentId: 1, firmware: 'ArduPilot', vehicle: 'ArduCopter', armed: false }
const BURST_CHUNK = 239

function decodeReq(payload) {
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength)
  const size = payload[4] ?? 0
  return {
    seq: view.getUint16(0, true),
    session: payload[2] ?? 0,
    opcode: payload[3] ?? 0,
    offset: view.getUint32(8, true),
    size,
    data: payload.subarray(12, 12 + size)
  }
}

function encodeResp({ seq, session = 0, opcode, reqOpcode, offset = 0, burstComplete = 0, data = new Uint8Array(0) }) {
  const bytes = new Uint8Array(12 + data.length)
  const view = new DataView(bytes.buffer)
  view.setUint16(0, seq & 0xffff, true)
  bytes[2] = session & 0xff
  bytes[3] = opcode & 0xff
  bytes[4] = data.length & 0xff
  bytes[5] = reqOpcode & 0xff
  bytes[6] = burstComplete & 0xff
  view.setUint32(8, offset >>> 0, true)
  bytes.set(data, 12)
  return bytes
}

const u32le = (n) => {
  const b = new Uint8Array(4)
  new DataView(b.buffer).setUint32(0, n >>> 0, true)
  return b
}

/**
 * A vehicle serving `file` over burst while declaring NO size on OPEN.
 * `counts` records how the client went about it.
 */
function serve(file, { declareSize = 0 } = {}) {
  const counts = { open: 0, burst: 0, read: 0 }
  let service
  const session = {
    send: async (message) => {
      const req = decodeReq(message.payload)
      const reply = (payload) => setTimeout(() => service.handleFileTransferProtocol({ payload }), 1)

      // A real server answers these, and leaving them unanswered made every
      // test here pay a request timeout before the part being tested began.
      if (req.opcode === MAV_FTP_OPCODE.RESET_SESSIONS || req.opcode === MAV_FTP_OPCODE.TERMINATE_SESSION) {
        reply(encodeResp({
          seq: (req.seq + 1) & 0xffff,
          session: req.session,
          opcode: MAV_FTP_OPCODE.ACK,
          reqOpcode: req.opcode
        }))
        return
      }
      if (req.opcode === MAV_FTP_OPCODE.OPEN_FILE_RO) {
        counts.open += 1
        reply(encodeResp({
          seq: (req.seq + 1) & 0xffff,
          session: 1,
          opcode: MAV_FTP_OPCODE.ACK,
          reqOpcode: req.opcode,
          data: u32le(declareSize)
        }))
        return
      }
      if (req.opcode === MAV_FTP_OPCODE.READ_FILE) {
        counts.read += 1
      }
      if (req.opcode === MAV_FTP_OPCODE.BURST_READ_FILE) {
        counts.burst += 1
        let seq = req.seq
        for (let offset = req.offset; offset < file.length; offset += BURST_CHUNK) {
          const chunk = file.subarray(offset, Math.min(offset + BURST_CHUNK, file.length))
          const last = offset + BURST_CHUNK >= file.length
          seq += 1
          reply(encodeResp({
            seq: seq & 0xffff,
            session: 1,
            opcode: MAV_FTP_OPCODE.ACK,
            reqOpcode: MAV_FTP_OPCODE.BURST_READ_FILE,
            offset,
            burstComplete: last ? 1 : 0,
            data: chunk
          }))
        }
        // The file ends where the vehicle says it does.
        seq += 1
        reply(encodeResp({
          seq: seq & 0xffff,
          session: 1,
          opcode: MAV_FTP_OPCODE.NAK,
          reqOpcode: MAV_FTP_OPCODE.BURST_READ_FILE,
          offset: file.length,
          data: new Uint8Array([6]) // EOF
        }))
      }
    }
  }
  service = new MavftpService({ session, getVehicle: () => VEHICLE, ensureSupport: async () => {} })
  return { service, counts }
}

const pack = Uint8Array.from({ length: 25_269 }, (_, i) => (i * 7 + (i >> 8)) & 0xff)

test('a file with no declared size is read over burst, not one chunk at a time', async () => {
  const { service, counts } = serve(pack)
  const bytes = await service.downloadRemoteFileBurst('@PARAM/param.pck?withdefaults=1')

  assert.deepEqual(bytes, pack, 'the bytes must survive the growing buffer exactly')
  assert.ok(counts.burst > 0, 'no burst was ever requested')
  // The regression this exists for. The sequential path would need ~126 reads
  // for this file; the burst path needs none at all.
  assert.equal(counts.read, 0, `fell back to ${counts.read} sequential READ_FILE round trips`)
})

test('a declared size is still honoured', async () => {
  // The path that always worked must keep working: with a size, the buffer is
  // allocated once and completion does not wait for an EOF.
  const { service, counts } = serve(pack, { declareSize: pack.length })
  const bytes = await service.downloadRemoteFileBurst('/APM/LOGS/1.BIN')
  assert.deepEqual(bytes, pack)
  assert.equal(counts.read, 0)
})

test('a file smaller than the initial buffer comes back at its own length', async () => {
  // The buffer starts at 64 KB, so a short file leaves it mostly empty — the
  // result must be cut to what arrived rather than padded with zeros.
  const short = Uint8Array.from({ length: 300 }, (_, i) => i & 0xff)
  const { service } = serve(short)
  const bytes = await service.downloadRemoteFileBurst('@SYS/uarts.txt')
  assert.equal(bytes.length, 300, 'a short file must not come back buffer-sized')
  assert.deepEqual(bytes, short)
})

test('a file larger than the initial buffer grows it without corruption', async () => {
  // Crosses the 64 KB starting capacity, so the buffer is reallocated
  // mid-transfer. An off-by-one in the copy shows up as a corrupt tail.
  const big = Uint8Array.from({ length: 200_000 }, (_, i) => (i * 31) & 0xff)
  const { service } = serve(big)
  const bytes = await service.downloadRemoteFileBurst('@PARAM/param.pck')
  assert.equal(bytes.length, big.length)
  assert.deepEqual(bytes, big)
})

test('a vehicle that never says EOF is stopped by the cap', async () => {
  // Without a declared size the cap is the only thing bounding the transfer,
  // and passing it has to fail rather than quietly return half a file.
  const endless = Uint8Array.from({ length: 50_000 }, () => 1)
  const { service } = serve(endless)
  await assert.rejects(
    () => service.downloadRemoteFileBurst('@SYS/flash.bin', { maxBytes: 4096 }),
    /exceeded the 4096-byte cap/,
    'a file past the cap must fail, not truncate'
  )
})
