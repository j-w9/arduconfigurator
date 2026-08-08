import assert from 'node:assert/strict'
import test from 'node:test'

import { MavftpService } from '../packages/ardupilot-core/dist/index.js'
import { MAV_FTP_ERR, MAV_FTP_OPCODE } from '../packages/protocol-mavlink/dist/index.js'

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
    data: payload.subarray(12, 12 + size)
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

/**
 * An FC that answers slowly and records which file each request belongs to.
 *
 * Slowness is the point: the bug being pinned needed a transfer still running
 * when an unrelated caller arrived, which is exactly the shape of a multi-minute
 * log download and a background housekeeping read.
 */
function slowScriptedFc({ replyDelayMs = 5, failOpenOf } = {}) {
  const requestLog = []
  let openPathBySession = new Map()

  const service = new MavftpService({
    session: {
      send: async (message) => {
        const req = decodeReq(message.payload)
        // Tag every request with the file its session was opened for, so an
        // interleaving is visible in the log rather than merely suspected.
        if (req.opcode === MAV_FTP_OPCODE.OPEN_FILE_RO) {
          const path = new TextDecoder().decode(req.data)
          openPathBySession.set(req.session, path)
          requestLog.push({ opcode: req.opcode, path })
        } else {
          requestLog.push({ opcode: req.opcode, path: openPathBySession.get(req.session) ?? '?' })
        }

        const reply = (fields) =>
          setTimeout(
            () =>
              service.handleFileTransferProtocol({
                payload: encodeResp({ seq: (req.seq + 1) & 0xffff, reqOpcode: req.opcode, ...fields })
              }),
            replyDelayMs
          )

        switch (req.opcode) {
          case MAV_FTP_OPCODE.OPEN_FILE_RO:
            if (failOpenOf !== undefined && new TextDecoder().decode(req.data) === failOpenOf) {
              reply({ opcode: MAV_FTP_OPCODE.NAK, data: new Uint8Array([MAV_FTP_ERR.FAIL]) })
            } else {
              reply({ opcode: MAV_FTP_OPCODE.ACK, data: u32le(8) })
            }
            break
          case MAV_FTP_OPCODE.READ_FILE:
            if (req.offset >= 8) {
              reply({ opcode: MAV_FTP_OPCODE.NAK, data: new Uint8Array([MAV_FTP_ERR.EOF]) })
            } else {
              reply({ opcode: MAV_FTP_OPCODE.ACK, offset: req.offset, data: new Uint8Array(8) })
            }
            break
          default:
            reply({ opcode: MAV_FTP_OPCODE.ACK })
            break
        }
      }
    },
    getVehicle: () => VEHICLE,
    isFtpSupported: () => true
  })

  return { service, requestLog }
}

test('an unrelated read cannot interleave with a transfer already in flight', async () => {
  // The regression: a background read arriving mid-download used to be waved
  // through the "already held" fast path. Every request hardcodes session 0, so
  // its OPEN repointed session 0 at another file and the download's next read
  // NAKed FileNotFound — a log dying partway with the FC's own error, at a
  // different percentage every run.
  const { service, requestLog } = slowScriptedFc()

  const transfer = service.readRemoteFile('/APM/LOGS/00000019.BIN')
  // Arrive mid-transfer, the way a housekeeping timer does — not queued up
  // front, but while the first operation is genuinely still running.
  await new Promise((resolve) => setTimeout(resolve, 1))
  const background = service.readRemoteTextFile('@SYS/uarts.txt')

  await Promise.all([transfer, background])

  const paths = requestLog.map((entry) => entry.path)
  const lastOfTransfer = paths.lastIndexOf('/APM/LOGS/00000019.BIN')
  const firstOfBackground = paths.indexOf('@SYS/uarts.txt')

  assert.ok(firstOfBackground > 0, 'the background read must actually have run')
  assert.ok(
    firstOfBackground > lastOfTransfer,
    `the background read touched the session mid-transfer: ${JSON.stringify(paths)}`
  )
})

test('a queued caller still runs after the transfer it waited for', async () => {
  // The other half: serializing must not mean starving. A background read that
  // waits its turn has to actually get one, or "never interleaves" would be
  // satisfied by never running at all.
  const { service } = slowScriptedFc()

  const transfer = service.readRemoteFile('/APM/LOGS/00000019.BIN')
  const background = service.readRemoteTextFile('@SYS/uarts.txt')

  const [bytes, text] = await Promise.all([transfer, background])
  assert.equal(bytes.length, 8)
  assert.equal(typeof text, 'string')
})

test('a failed transfer releases the session for the next caller', async () => {
  // Serialization is only safe if the lock is released on the error path too;
  // otherwise one failed download wedges every later MAVFTP operation.
  const { service } = slowScriptedFc({ failOpenOf: '/APM/LOGS/missing.BIN' })

  await assert.rejects(() => service.readRemoteFile('/APM/LOGS/missing.BIN'))

  const bytes = await service.readRemoteFile('/APM/LOGS/00000019.BIN')
  assert.equal(bytes.length, 8)
})
