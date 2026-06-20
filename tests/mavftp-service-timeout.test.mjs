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
