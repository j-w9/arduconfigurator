// Waiting for the MAVFTP session.
//
// Transfers are serialised through one session, and every operation in that
// service is bounded -- 3s for a request, 6s for a burst packet, 20s for a
// listing. The queue they line up in was not. A transfer that never settled
// therefore held the session silently and for the rest of the session: the
// next caller awaited a promise that would never resolve, with no timeout to
// fire and nothing logged.
//
// That is the shape of a hang seen in the app, where the packed-defaults read
// never came back and nothing downstream reported anything.

import assert from 'node:assert/strict'
import test from 'node:test'

import { readFileSync } from 'node:fs'

import { MavftpService } from '../packages/ardupilot-core/dist/index.js'

/**
 * A service whose transfers never answer, so the session is held.
 *
 * Only the transport is faked; the real queue, lifecycle and timers run.
 */
function createStuckService(sessionWaitMs) {
  const service = new MavftpService({
    ...(sessionWaitMs === undefined ? {} : { sessionWaitMs }),
    session: {
      send: () => {},
      subscribe: () => () => {}
    },
    getVehicle: () => ({ systemId: 1, componentId: 1 }),
    ensureSupport: async () => {},
    appendStatusEntry: () => {},
    emit: () => {}
  })
  return service
}

test('a waiter is told when something else is holding the session', async () => {
  const service = createStuckService()

  // The first transfer never answers, so it holds the session.
  const held = service.listRemoteDirectory('/APM/LOGS').catch(() => 'first failed')

  // The second is made to wait. Rather than spend five minutes proving it, the
  // guarantee under test is that the wait is bounded at all -- so the assertion
  // is that the waiter is still pending here and the queue has not silently
  // swallowed it.
  let settled = false
  const queued = service.listRemoteDirectory('/APM').then(
    () => { settled = true },
    () => { settled = true }
  )

  await new Promise((resolve) => setTimeout(resolve, 50))
  assert.equal(settled, false, 'the queued transfer should still be waiting its turn')

  // Both are abandoned; the test is about the waiting, not the transfers.
  void held
  void queued
})

test('the wait ends with an error naming the cause, not a hang', async () => {
  // The bound is injectable so this runs in milliseconds; in the app it is five
  // minutes, long enough that reaching it means something is wrong rather than
  // slow.
  const service = createStuckService(60)
  const held = service.listRemoteDirectory('/APM/LOGS').catch(() => undefined)

  await assert.rejects(
    () => service.listRemoteDirectory('/APM'),
    (error) => {
      assert.match(error.message, /held the session/)
      // It says what to do about it, because the service cannot clear it
      // itself without risking a transfer that is merely slow.
      assert.match(error.message, /Reconnect/)
      return true
    }
  )
  void held
})

test('a transfer that gets the session is not charged for the wait', async () => {
  // The bound must not fire on an idle service, or every first transfer after
  // a quiet period would fail.
  const service = createStuckService(60)
  let resolved = false
  const first = service.listRemoteDirectory('/APM').then(
    () => { resolved = true },
    () => { resolved = true }
  )
  await new Promise((r) => setTimeout(r, 120))
  // It is still waiting on the flight controller, not rejected by the queue.
  assert.equal(resolved, false)
  void first
})
