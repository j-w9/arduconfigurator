import assert from 'node:assert/strict'
import test from 'node:test'

import { MavftpService } from '../packages/ardupilot-core/dist/index.js'

const VEHICLE = { systemId: 1, componentId: 1, firmware: 'ArduPilot', vehicle: 'ArduCopter', armed: false }

// A session whose send() resolves but no response is ever delivered, so
// the service's response waiter always reaches its timeout — which is
// exactly what we want to assert the timeout value on.
function silentService(requestTimeoutMs) {
  return new MavftpService({
    session: { send: async () => {} },
    getVehicle: () => VEHICLE,
    ensureSupport: async () => {},
    requestTimeoutMs
  })
}

test('readRemoteFile honors a per-call timeout override', async () => {
  const service = silentService(5000)
  await assert.rejects(
    () => service.readRemoteFile('@SYS/uarts.txt', { timeoutMs: 60 }),
    /Timed out waiting for MAVFTP response after 60ms\./
  )
})

test('readRemoteTextFile forwards the per-call timeout override', async () => {
  const service = silentService(5000)
  await assert.rejects(
    () => service.readRemoteTextFile('@SYS/uarts.txt', { timeoutMs: 70 }),
    /Timed out waiting for MAVFTP response after 70ms\./
  )
})

test('without an override the constructor requestTimeoutMs still applies', async () => {
  const service = silentService(45)
  await assert.rejects(
    () => service.readRemoteFile('@SYS/uarts.txt'),
    /Timed out waiting for MAVFTP response after 45ms\./
  )
})

// ── Serialization ─────────────────────────────────────────────────────────
//
// Every session-allocating request hardcodes session 0, and ArduPilot echoes
// back whatever session the client chose rather than allocating one — so all
// transfers share a single server-side session. Overlapping them corrupts data
// SILENTLY: the second OPEN is NAKed, our stale-handle recovery sends
// RESET_SESSIONS which force-closes the first transfer's fd, and the first
// transfer's next READ returns the second file's bytes at its own offsets, with
// a valid ACK. These pin that two operations can no longer interleave.

/** MAVFTP opcodes (MAV_FTP_OPCODE) this test inspects on the wire. */
const MAV_FTP_RESET_SESSIONS = 2
const MAV_FTP_OPEN_FILE_RO = 4

/** Records the opcode order the service actually puts on the wire. */
function recordingService() {
  const opcodes = []
  let respond
  const service = new MavftpService({
    session: {
      async send(message) {
        // payload[3] is the opcode byte in the MAVFTP payload layout.
        opcodes.push(message.payload[3])
      }
    },
    getVehicle: () => VEHICLE,
    ensureSupport: async () => {},
    requestTimeoutMs: 40
  })
  return { service, opcodes, respond }
}

test('a second transfer sends nothing until the first has finished', async () => {
  const { service, opcodes } = recordingService()

  const first = service.readRemoteFile('/APM/LOGS/1.BIN').catch(() => 'first')
  const second = service.readRemoteFile('/APM/LOGS/2.BIN').catch(() => 'second')

  // The discriminating assertion. Resolution ORDER proves nothing here — both
  // transfers time out at the same rate, so they resolve in start order with or
  // without a mutex. What only serialization can produce is B having put NOTHING
  // on the wire at the moment A gives up.
  assert.equal(await first, 'first')
  const opcodesWhenFirstFinished = [...opcodes]
  assert.deepEqual(
    opcodesWhenFirstFinished,
    [MAV_FTP_RESET_SESSIONS, MAV_FTP_OPEN_FILE_RO],
    'only the first transfer had reached the wire'
  )

  assert.equal(await second, 'second')
  assert.deepEqual(
    opcodes.slice(opcodesWhenFirstFinished.length),
    [MAV_FTP_OPEN_FILE_RO],
    'the second transfer opened only after the first was done'
  )
})

test('a nested call from inside a held transfer does not deadlock', async () => {
  // downloadRemoteFile delegates to readRemoteFile; if the mutex were not
  // re-entrant this would hang until the test timed out rather than failing.
  const { service } = recordingService()
  await assert.rejects(() => service.downloadRemoteFile('@SYS/uarts.txt'), /Timed out waiting for MAVFTP response/)
})

test('a failed transfer releases the lock for the next one', async () => {
  const { service } = recordingService()
  await assert.rejects(() => service.readRemoteFile('/APM/LOGS/1.BIN'))
  // If the finally in withExclusiveSession did not release, this would hang.
  await assert.rejects(() => service.readRemoteFile('/APM/LOGS/2.BIN'))
})

// ── Directory listing gets its own, longer budget ──────────────────────────
//
// Reported from the field: an F4 with 200+ .bin files on the SD card timed out
// listing them. The listing is a LOOP — one LIST_DIRECTORY request per chunk of
// entries, each with its own timeout — so a long directory never got a longer
// total budget, it got more chances to trip the same short one. ArduPilot stats
// every file while filling a chunk, and on a slow card one chunk can take well
// over 3s, which failed exactly the boards with the most logs to list.

test('LIST_DIRECTORY does not use the short default timeout', async () => {
  // The service is constructed with the 3s-era default. If listing still used
  // it, this would reject at ~40ms; it must not.
  const service = silentService(40)
  const listing = service.listRemoteDirectory('/APM/LOGS')
  const raced = await Promise.race([
    listing.then(() => 'resolved', (error) => `rejected: ${error.message}`),
    new Promise((resolve) => setTimeout(() => resolve('still waiting'), 300))
  ])
  assert.equal(
    raced,
    'still waiting',
    'listing must outlive the short per-request default, or a big log directory fails again'
  )
})

test('a directory listing chunk slower than 3s still completes', async () => {
  // The exact field case, with the slow chunk made explicit: the first
  // LIST_DIRECTORY response arrives after longer than the old 3s budget.
  const SLOW_MS = 3200
  let sent = 0
  const service = new MavftpService({
    session: {
      send: async (message) => {
        if (message.type !== 'FILE_TRANSFER_PROTOCOL') return
        sent += 1
        const seq = (message.payload[0] | (message.payload[1] << 8)) & 0xffff
        const delay = sent === 1 ? SLOW_MS : 0
        setTimeout(() => {
          // NAK with EOF ends the loop cleanly, which is all this needs: the
          // assertion is that the request SURVIVED the delay, not what it read.
          const payload = new Uint8Array(251)
          payload[0] = (seq + 1) & 0xff
          payload[1] = ((seq + 1) >> 8) & 0xff
          payload[2] = 0 // session
          payload[3] = 129 // NAK
          payload[4] = 1 // size
          payload[12] = 6 // MAV_FTP_ERR.EOF
          service.handleFileTransferProtocol({ type: 'FILE_TRANSFER_PROTOCOL', targetNetwork: 0, targetSystem: 255, targetComponent: 0, payload })
        }, delay)
      }
    },
    getVehicle: () => VEHICLE,
    ensureSupport: async () => {},
    requestTimeoutMs: 3000
  })

  const started = Date.now()
  const entries = await service.listRemoteDirectory('/APM/LOGS')
  const elapsed = Date.now() - started
  assert.ok(elapsed >= SLOW_MS, `should have waited out the slow chunk, took ${elapsed}ms`)
  assert.deepEqual(entries, [], 'an EOF NAK ends the listing cleanly')
})
