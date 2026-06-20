import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ReplayTransport,
  SessionRecorder,
  DEFAULT_MAX_RECORDED_EVENTS,
  parseRecordedSession,
  serializeRecordedSession
} from '../packages/transport/dist/index.js'

// Record a few synthetic frames through the recorder, serialize to the existing
// RecordedSession replay format, parse it back, and feed it to ReplayTransport.
// Confirm the inbound frames replay in order with the recorded direction and
// timing preserved through the full round-trip.
test('SessionRecorder round-trips synthetic frames back through ReplayTransport', async () => {
  const recorder = new SessionRecorder({ label: 'round-trip test' })
  recorder.start()

  const inA = Uint8Array.from([0xfd, 0x01, 0x02, 0x03])
  const out1 = Uint8Array.from([0xfd, 0xaa, 0xbb])
  const inB = Uint8Array.from([0xfd, 0x10, 0x20, 0x30, 0x40])

  recorder.recordInbound(inA, 1000)
  recorder.recordOutbound(out1, 1010)
  recorder.recordInbound(inB, 1025)
  recorder.stop()

  assert.equal(recorder.eventCount(), 3)
  assert.equal(recorder.isRecording(), false)

  const session = recorder.getSession()
  assert.equal(session.version, 1)
  assert.equal(session.label, 'round-trip test')
  assert.equal(session.truncated, undefined)

  // Serialize + parse exactly as the UI download / replay loader would.
  const parsed = parseRecordedSession(serializeRecordedSession(session))
  assert.equal(parsed.events.length, 3)

  const transport = new ReplayTransport('rt', { session: parsed, speedMultiplier: 0 })
  const received = []
  transport.onFrame((frame) => received.push(Array.from(frame)))

  await transport.connect()
  // speedMultiplier 0 schedules all inbound frames at delay 0; let the
  // setTimeout(…, 0) callbacks flush.
  await new Promise((resolve) => setTimeout(resolve, 20))
  await transport.disconnect()

  // Only inbound frames replay (ReplayTransport emits 'in' frames in atMs order).
  assert.deepEqual(received, [Array.from(inA), Array.from(inB)])
})

// Strict replay verifies BOTH direction ordering and exact bytes against the
// recorded session: a stronger round-trip assertion than the non-strict path.
test('SessionRecorder round-trip drives strict ReplayTransport in recorded order', async () => {
  const recorder = new SessionRecorder()
  recorder.start()
  const inA = Uint8Array.from([1, 2, 3])
  const out1 = Uint8Array.from([9, 8, 7])
  recorder.recordInbound(inA, 0)
  recorder.recordOutbound(out1, 5)
  recorder.stop()

  const parsed = parseRecordedSession(serializeRecordedSession(recorder.getSession()))
  const transport = new ReplayTransport('strict-rt', { session: parsed, speedMultiplier: 0, strictOutbound: true })
  const received = []
  transport.onFrame((frame) => received.push(Array.from(frame)))

  await transport.connect()
  await new Promise((resolve) => setTimeout(resolve, 20))
  // The recorded out frame must be replayed back to advance the strict cursor.
  await transport.send(out1)
  await transport.disconnect()

  assert.deepEqual(received, [Array.from(inA)])
})

test('SessionRecorder ignores frames when not recording', () => {
  const recorder = new SessionRecorder()
  recorder.recordInbound(Uint8Array.from([1]), 0)
  recorder.start()
  recorder.recordInbound(Uint8Array.from([2]), 1)
  recorder.stop()
  recorder.recordInbound(Uint8Array.from([3]), 2)
  assert.equal(recorder.eventCount(), 1)
})

test('SessionRecorder caps the buffer and marks the session truncated', () => {
  const recorder = new SessionRecorder({ maxEvents: 3 })
  recorder.start()
  for (let i = 0; i < 10; i += 1) {
    recorder.recordInbound(Uint8Array.from([i]), i)
  }
  assert.equal(recorder.eventCount(), 3)
  assert.equal(recorder.isRecording(), false)
  assert.equal(recorder.isTruncated(), true)
  const session = recorder.getSession()
  assert.equal(session.events.length, 3)
  assert.equal(session.truncated, true)
})

test('SessionRecorder defaults to a sane large cap', () => {
  const recorder = new SessionRecorder()
  assert.equal(typeof DEFAULT_MAX_RECORDED_EVENTS, 'number')
  assert.equal(DEFAULT_MAX_RECORDED_EVENTS, 200_000)
  // A non-positive / non-integer maxEvents falls back to the default.
  const fallback = new SessionRecorder({ maxEvents: -1 })
  fallback.start()
  fallback.recordInbound(Uint8Array.from([1]), 0)
  assert.equal(fallback.isTruncated(), false)
  assert.equal(recorder.isTruncated(), false)
})
