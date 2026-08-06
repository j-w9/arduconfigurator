// Cancelling an in-flight MAVFTP burst.
//
// This exists so BACKGROUND log reads can stand down. A burst holds the single
// `activeBurst` slot for its whole duration and a second one throws, so an
// uncancellable multi-megabyte read in the background would make an operator's
// own download fail while they sat waiting on it. That is background work
// degrading foreground work, which is exactly what a feature meant to be
// invisible must never do.
//
// So the assertion that actually matters is not "abort rejects" — it is that
// after aborting, the slot is FREE and a real download succeeds.

import assert from 'node:assert/strict'
import test from 'node:test'

import { MavftpService, MavftpAbortError } from '../packages/ardupilot-core/dist/index.js'

/**
 * A service whose burst never completes on its own, so a test can decide when
 * (or whether) it ends. Only the transport is faked; the real op lifecycle,
 * timer handling and activeBurst bookkeeping run.
 */
function createService({ declaredSize = 4096 } = {}) {
  const sent = []
  const service = new MavftpService({
    send: async (message) => {
      sent.push(message)
    },
    getVehicle: () => ({ systemId: 1, componentId: 1 }),
    appendStatusEntry: () => {},
    emit: () => {}
  })
  // Bypass the handshake and the open/size negotiation: this test is about the
  // burst's cancellation, not about MAVFTP capability probing.
  service.ensureSupport = async () => {}
  service.clearStaleSessionsOnce = async () => {}
  service.terminateSession = async () => {}
  service.send = async () => ({ size: declaredSize, data: new Uint8Array(0) })
  service.sendBurstReadRequest = () => {}
  return { service, sent }
}

/** Drive a burst directly so the test controls its lifetime. */
function startBurst(service, signal, declaredSize = 4096) {
  return service.runBurst(1, declaredSize, 60_000, undefined, signal)
}

test('aborting rejects with a distinguishable error, not a generic failure', async () => {
  // Background work must be able to tell "I stood this down" from "the link
  // broke" — one is silent, the other is worth knowing about.
  const { service } = createService()
  const controller = new AbortController()
  const burst = startBurst(service, controller.signal)
  controller.abort()
  const error = await burst.then(
    () => undefined,
    (e) => e
  )
  assert.ok(error instanceof MavftpAbortError, `expected MavftpAbortError, got ${error}`)
  assert.equal(error.aborted, true)
})

// THE POINT OF THE FEATURE.
test('after aborting, the burst slot is free for another download', async () => {
  const { service } = createService()
  const controller = new AbortController()
  const background = startBurst(service, controller.signal)
  // The slot is taken while it runs.
  assert.ok(service.activeBurst, 'a running burst should hold the slot')

  controller.abort()
  await background.catch(() => {})

  assert.equal(service.activeBurst, undefined, 'aborting must release the slot')
  // A foreground download can now proceed — the whole reason abort exists.
  const foreground = startBurst(service, undefined)
  assert.ok(service.activeBurst, 'a new burst should be able to start')
  service.finishBurst(service.activeBurst)
  await foreground
})

test('an already-aborted signal never opens a session at all', async () => {
  // Cheapest possible refusal: the flight controller is not touched.
  const { service, sent } = createService()
  const controller = new AbortController()
  controller.abort()
  const before = sent.length
  await assert.rejects(
    () => service.downloadRemoteFileBurst('/APM/LOGS/1.BIN', { signal: controller.signal }),
    (error) => error instanceof MavftpAbortError
  )
  assert.equal(sent.length, before, 'no MAVFTP traffic should be emitted')
})

test('a completed burst detaches its abort listener', async () => {
  // A shared signal across many background reads must not accumulate
  // listeners for bursts that already finished.
  const { service } = createService()
  const controller = new AbortController()
  const burst = startBurst(service, controller.signal)
  const op = service.activeBurst
  service.finishBurst(op)
  await burst

  // Aborting now must be inert — the op is gone and nothing should react.
  assert.equal(service.activeBurst, undefined)
  controller.abort()
  assert.equal(service.activeBurst, undefined)
})

test('aborting one burst does not reject an unrelated later one', async () => {
  const { service } = createService()
  const first = new AbortController()
  const burstA = startBurst(service, first.signal)
  first.abort()
  await burstA.catch(() => {})

  const second = new AbortController()
  const burstB = startBurst(service, second.signal)
  // The already-fired first signal must not touch this one.
  service.finishBurst(service.activeBurst)
  await assert.doesNotReject(() => burstB)
})

test('a burst without a signal behaves exactly as before', async () => {
  // Operator-initiated downloads pass no signal; nothing about them changes.
  const { service } = createService()
  const burst = startBurst(service, undefined)
  assert.ok(service.activeBurst)
  service.finishBurst(service.activeBurst)
  const bytes = await burst
  assert.ok(bytes instanceof Uint8Array)
})
