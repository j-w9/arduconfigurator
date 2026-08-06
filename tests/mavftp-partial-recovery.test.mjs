// A failed burst must hand back what it managed to read.
//
// The reader tracks a CONTIGUOUS frontier, so bytes below it are known-good,
// and a dataflash log carries its FMT definitions at the front — a prefix is a
// real log that ends early. Discarding it because the last packet never
// arrived throws away a whole flight to save nothing.
//
// The load-bearing property is that the salvaged prefix has NO HOLES. A buffer
// with a gap in the middle would parse into confident nonsense, which is worse
// than returning nothing at all.

import assert from 'node:assert/strict'
import test from 'node:test'

import { MavftpService, MavftpAbortError, partialTransferOf } from '../packages/ardupilot-core/dist/index.js'

/**
 * A service whose burst never completes on its own, so the test decides when it
 * ends. Only the transport is faked; the real op lifecycle, contiguity
 * bookkeeping and failure path run. Same harness as mavftp-burst-abort.
 */
function createService() {
  const service = new MavftpService({
    send: async () => {},
    getVehicle: () => ({ systemId: 1, componentId: 1 }),
    appendStatusEntry: () => {},
    emit: () => {}
  })
  service.ensureSupport = async () => {}
  service.clearStaleSessionsOnce = async () => {}
  service.terminateSession = async () => {}
  service.sendBurstReadRequest = () => {}
  return service
}

// A short timeout so the real failure path runs promptly. An earlier version
// of this harness used the production 60 s and every test "passed" only after
// waiting out the genuine timer — exercising the retry ladder by accident.
const BURST_TIMEOUT_MS = 15
/**
 * Start a burst and return a promise of how it ENDED. The rejection handler is
 * attached immediately and on purpose: the burst rejects while the test is
 * still stalling the link, and a handler attached afterwards makes it an
 * unhandled rejection.
 */
const startBurst = (service, declaredSize, signal) =>
  service.runBurst(1, declaredSize, BURST_TIMEOUT_MS, undefined, signal).then(
    () => new Error('the burst resolved; it was supposed to fail'),
    (error) => error
  )

/** Feed one burst data packet of `length` bytes filled with `fill` at `offset`. */
function burstPacket(service, { offset, length, fill }) {
  service.handleBurstPacket({
    opcode: 128,
    session: 1,
    size: length,
    offset,
    data: new Uint8Array(length).fill(fill)
  })
}

/**
 * Stop the burst the way a broken link does: stall until the retry budget is
 * spent. Goes through the real timeout path rather than calling failBurst, so
 * the salvage has to survive the retry ladder.
 */
const breakLink = () => new Promise((resolve) => setTimeout(resolve, BURST_TIMEOUT_MS * 12))

test('a burst that dies partway attaches what it received to the error', async () => {
  const service = createService()
  const pending = startBurst(service, 4096)
  burstPacket(service, { offset: 0, length: 1024, fill: 7 })
  await breakLink()

  const error = await pending
  const partial = partialTransferOf(error)
  assert.ok(partial, 'the failure discarded every byte it had already read')
  assert.equal(partial.bytes.length, 1024)
  assert.equal(partial.declaredSize, 4096)
  assert.ok(partial.bytes.every((byte) => byte === 7), 'salvaged bytes should be the ones received')
})

test('the salvaged prefix stops at a HOLE rather than spanning it', async () => {
  // The whole point. A packet at 2048 arriving after one at 0 leaves bytes
  // 1024..2047 unwritten; returning 3072 bytes would hand back a buffer with a
  // zero-filled gap, which parses into confident nonsense.
  const service = createService()
  const pending = startBurst(service, 8192)
  burstPacket(service, { offset: 0, length: 1024, fill: 7 })
  burstPacket(service, { offset: 2048, length: 1024, fill: 9 })
  await breakLink()

  const error = await pending
  const partial = partialTransferOf(error)
  assert.ok(partial)
  assert.equal(partial.bytes.length, 1024, 'the prefix must not span the gap')
  assert.ok(partial.bytes.every((byte) => byte === 7))
})

test('a burst that received nothing attaches nothing', async () => {
  // An empty partial is not a zero-length file; there is simply nothing to say.
  const service = createService()
  const pending = startBurst(service, 4096)
  await breakLink()
  const error = await pending
  assert.equal(partialTransferOf(error), undefined)
})

test('an aborted burst also carries its partial — the caller decides', async () => {
  // Abort and failure are still distinguishable by error type; salvage is
  // orthogonal to why the transfer stopped.
  const controller = new AbortController()
  const service = createService()
  const pending = startBurst(service, 4096, controller.signal)
  burstPacket(service, { offset: 0, length: 512, fill: 3 })
  controller.abort()

  const error = await pending
  assert.ok(error instanceof MavftpAbortError, 'abort must stay distinguishable from failure')
  assert.equal(partialTransferOf(error)?.bytes.length, 512)
})

test('partialTransferOf is safe on things that are not errors', () => {
  assert.equal(partialTransferOf(undefined), undefined)
  assert.equal(partialTransferOf(null), undefined)
  assert.equal(partialTransferOf('nope'), undefined)
  assert.equal(partialTransferOf(new Error('plain')), undefined)
})
