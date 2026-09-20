import assert from 'node:assert/strict'
import test from 'node:test'

import { MavftpService } from '../packages/ardupilot-core/dist/index.js'
import { MAV_FTP_OPCODE } from '../packages/protocol-mavlink/dist/index.js'

// Two ways a MAVFTP transfer could hold the shared session forever. Every
// individual operation is bounded — 3s for a request, 6s per burst packet, 20s
// for a listing — but that is not the same as the transfer being bounded, and
// the session queue behind it was not bounded at all.
//
// Both are tested behaviourally, in milliseconds, through injected bounds:
// asserting that a helper exists, or grepping the built source for its name,
// would prove nothing about whether a stuck transfer actually comes back.

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

test('a queued operation gives up on a holder that has gone silent', async () => {
  // The holder here is the worst case the queue could not survive: an
  // operation that never settles at all.
  const service = new MavftpService({
    session: {
      // Never resolves: the holder is stuck INSIDE its own operation, which is
      // the case the per-request timeouts cannot cover.
      send: () => new Promise(() => {})
    },
    getVehicle: () => VEHICLE,
    ensureSupport: async () => {},
    queueStallTimeoutMs: 120
  })

  const wedged = service.listRemoteDirectory('/APM/LOGS')
  wedged.catch(() => {})
  // Let the holder take the session and put its request on the wire.
  await new Promise((resolve) => setTimeout(resolve, 20))

  const startedAt = Date.now()
  await assert.rejects(
    () => service.readRemoteTextFile('/@SYS/uarts.txt'),
    // The holder is named: "something is wedged" tells an operator neither
    // which transfer to wait for nor which one to report as broken.
    /still busy with an earlier transfer \(list \/APM\/LOGS\) that has sent nothing/i,
    'the waiter must come back with something to read, not wait forever'
  )
  // It waited for the bound rather than failing instantly...
  assert.ok(Date.now() - startedAt >= 100, 'gave up too early to be a stall bound')
  // ...and the holder was left alone rather than force-released: taking the
  // session from a transfer that is merely slow is the corruption the queue
  // exists to prevent.
  assert.equal(await Promise.race([wedged.then(() => 'settled', () => 'settled'), Promise.resolve('running')]), 'running')

  // Teardown: clear the holder's armed response waiter so its timer does not
  // outlive the test. cancelAll is the same path a link drop takes.
  //
  // Not awaited: this holder is stuck inside a send() that never resolves, so
  // its promise never settles — which is the whole point of the case, and
  // exactly why the queue needed a bound of its own.
  service.cancelAll(new Error('test teardown'))
})

test('an idle service does not fail the first transfer after a quiet period', async () => {
  // The bound is measured from the HOLDER's last send. If it were measured
  // from process start, every first transfer after a quiet spell would fail.
  const service = new MavftpService({
    session: {
      send: async (message) => {
        const req = decodeReq(message.payload)
        setTimeout(() => {
          service.handleFileTransferProtocol({
            payload: encodeResp({
              seq: (req.seq + 1) & 0xffff,
              opcode: MAV_FTP_OPCODE.ACK,
              reqOpcode: req.opcode,
              data: new Uint8Array(0)
            })
          })
        }, 1)
      },
    },
    getVehicle: () => VEHICLE,
    ensureSupport: async () => {},
    queueStallTimeoutMs: 50
  })

  await new Promise((resolve) => setTimeout(resolve, 120))
  const entries = await service.listRemoteDirectory('/APM/LOGS')
  assert.deepEqual(entries, [], 'an empty listing, not a stall rejection')
})

test('a burst that streams without progressing still times out', async () => {
  // The watchdog used to be refreshed by every packet that arrived, so a
  // stream that never advanced the transfer held the timeout off forever:
  // the burst neither completed nor failed, and the session it held never
  // came back. Here the vehicle keeps re-sending the SAME first chunk.
  let repeats = 0
  const chunk = new Uint8Array(64).fill(7)

  const service = new MavftpService({
    session: {
      send: async (message) => {
        const req = decodeReq(message.payload)
        if (req.opcode === MAV_FTP_OPCODE.OPEN_FILE_RO) {
          setTimeout(() => {
            service.handleFileTransferProtocol({
              payload: encodeResp({
                seq: (req.seq + 1) & 0xffff,
                session: 0,
                opcode: MAV_FTP_OPCODE.ACK,
                reqOpcode: req.opcode,
                data: u32le(4096)
              })
            })
          }, 1)
          return
        }
        if (req.opcode === MAV_FTP_OPCODE.BURST_READ_FILE) {
          // Always the same 64 bytes at offset 0: traffic without progress.
          const timer = setInterval(() => {
            repeats += 1
            if (repeats > 400) {
              clearInterval(timer)
              return
            }
            service.handleFileTransferProtocol({
              payload: encodeResp({
                seq: (req.seq + 1 + repeats) & 0xffff,
                session: 0,
                opcode: MAV_FTP_OPCODE.ACK,
                reqOpcode: MAV_FTP_OPCODE.BURST_READ_FILE,
                offset: 0,
                data: chunk
              })
            })
          }, 2)
          timer.unref?.()
        }
      },
    },
    getVehicle: () => VEHICLE,
    ensureSupport: async () => {}
  })

  await assert.rejects(
    () => service.downloadRemoteFileBurst('/APM/LOGS/1.BIN', { timeoutMs: 60 }),
    /No MAVFTP burst data arrived/i,
    'repeated zero-progress packets must not hold the watchdog off'
  )
})

test('a late packet from a previous burst is not written into this one', async () => {
  // ArduPilot echoes the session on every reply, so a stale packet is
  // identifiable. Writing it would corrupt this file at that offset; letting
  // it refresh the watchdog would keep a dead transfer alive.
  const service = new MavftpService({
    session: {
      send: async (message) => {
        const req = decodeReq(message.payload)
        if (req.opcode === MAV_FTP_OPCODE.OPEN_FILE_RO) {
          setTimeout(() => {
            service.handleFileTransferProtocol({
              payload: encodeResp({
                seq: (req.seq + 1) & 0xffff,
                session: 0,
                opcode: MAV_FTP_OPCODE.ACK,
                reqOpcode: req.opcode,
                data: u32le(8)
              })
            })
          }, 1)
          return
        }
        if (req.opcode === MAV_FTP_OPCODE.BURST_READ_FILE) {
          setTimeout(() => {
            // Session 3 is not ours: garbage that must be ignored outright.
            service.handleFileTransferProtocol({
              payload: encodeResp({
                seq: 900,
                session: 3,
                opcode: MAV_FTP_OPCODE.ACK,
                reqOpcode: MAV_FTP_OPCODE.BURST_READ_FILE,
                offset: 0,
                data: new Uint8Array([9, 9, 9, 9, 9, 9, 9, 9])
              })
            })
            // ...and then the real data for ours.
            service.handleFileTransferProtocol({
              payload: encodeResp({
                seq: (req.seq + 1) & 0xffff,
                session: 0,
                opcode: MAV_FTP_OPCODE.ACK,
                reqOpcode: MAV_FTP_OPCODE.BURST_READ_FILE,
                offset: 0,
                burstComplete: 1,
                data: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
              })
            })
          }, 1)
        }
      },
    },
    getVehicle: () => VEHICLE,
    ensureSupport: async () => {}
  })

  const bytes = await service.downloadRemoteFileBurst('/APM/LOGS/2.BIN', { timeoutMs: 2000 })
  assert.deepEqual([...bytes], [1, 2, 3, 4, 5, 6, 7, 8], 'the other session’s bytes must not appear')
})
