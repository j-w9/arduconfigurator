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
