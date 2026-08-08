import assert from 'node:assert/strict'
import test from 'node:test'

import { ArduPilotConfiguratorRuntime } from '../packages/ardupilot-core/dist/index.js'
import { arducopterMetadata } from '../packages/param-metadata/dist/index.js'
import { MAV_AUTOPILOT, MAV_CMD, MAV_RESULT, MAV_TYPE } from '../packages/protocol-mavlink/dist/index.js'

// On real hardware (CubeRed + ArduPlane 4.6.3) the autopilot's MAVLink-UAVCAN
// bridge DENIES the SET_MESSAGE_INTERVAL request for UAVCAN_NODE_STATUS
// (msgid 310). The runtime already responds with a UAVCAN_GET_NODE_INFO
// broadcast (handles the "DroneCAN node identity" surface), so this rejection
// is benign — but the runtime used to surface a generic
// "Autopilot rejected live telemetry stream request (DENIED)" warning, which
// reads as a real failure to operators.
//
// The runtime used to NAME the refused stream, by keeping a queue of pending
// labels and dequeuing one per ack — i.e. correlating by send order. That is
// unsound: COMMAND_ACK does not carry the requested message id, so a single
// lost ack offset the queue permanently and every later warning named the WRONG
// stream. These very tests encoded the assumption, with comments listing the
// exact send order and acks positioned against it, and had already gone stale
// once when a request was added at the head of the list.
//
// So the behaviour these now pin is a truthful COUNT rather than a confident
// wrong name:
//   1. Refusals produce one warning that does not claim to know which stream.
//   2. All-accepted produces no warning at all.
//   3. A refusal never names a stream, so it can never name the wrong one.

function createScriptedSession() {
  const statusListeners = []
  const messageListeners = []
  const sentMessages = []
  let connected = false

  return {
    sentMessages,
    getTransportStatus() {
      return connected ? { kind: 'connected' } : { kind: 'disconnected' }
    },
    onStatus(listener) {
      statusListeners.push(listener)
      return () => {}
    },
    onMessage(listener) {
      messageListeners.push(listener)
      return () => {}
    },
    async connect() {
      connected = true
      statusListeners.forEach((listener) => listener({ kind: 'connected' }))
    },
    async disconnect() {
      connected = false
      statusListeners.forEach((listener) => listener({ kind: 'disconnected', reason: 'test disconnect' }))
    },
    destroy() {},
    async send(message) {
      sentMessages.push(message)
    },
    inject(envelope) {
      messageListeners.forEach((listener) => listener(envelope))
    }
  }
}

function planeHeartbeat() {
  return {
    header: { systemId: 1, componentId: 1, sequence: 0 },
    message: {
      type: 'HEARTBEAT',
      autopilot: MAV_AUTOPILOT.ARDUPILOTMEGA,
      vehicleType: MAV_TYPE.FIXED_WING,
      baseMode: 0,
      customMode: 0,
      systemStatus: 4,
      mavlinkVersion: 3
    },
    timestampMs: Date.now()
  }
}

function commandAck(result) {
  return {
    header: { systemId: 1, componentId: 1, sequence: 0 },
    message: {
      type: 'COMMAND_ACK',
      command: MAV_CMD.SET_MESSAGE_INTERVAL,
      result,
      progress: 0,
      resultParam2: 0,
      targetSystem: 1,
      targetComponent: 1
    },
    timestampMs: Date.now()
  }
}

async function waitFor(predicate, timeoutMs = 1000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return true
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  return false
}

async function bootRuntimeAndWaitForStreamRequests(session) {
  const runtime = new ArduPilotConfiguratorRuntime(session, arducopterMetadata)
  await runtime.connect()
  session.inject(planeHeartbeat())
  await runtime.waitForVehicle({ timeoutMs: 200 })
  // Now the runtime has fired SET_MESSAGE_INTERVAL once per LIVE_TELEMETRY_REQUESTS
  // entry; wait until they've all been observed by the session.
  const seen = await waitFor(() =>
    session.sentMessages.filter(
      (msg) => msg.type === 'COMMAND_LONG' && msg.command === MAV_CMD.SET_MESSAGE_INTERVAL
    ).length >= 7
  )
  assert.ok(seen, 'expected all SET_MESSAGE_INTERVAL requests to be sent')
  return runtime
}

test('a refused stream request warns without guessing which stream it was', async () => {
  const session = createScriptedSession()
  const runtime = await bootRuntimeAndWaitForStreamRequests(session)
  try {
    session.inject(commandAck(MAV_RESULT.DENIED))

    await waitFor(() =>
      runtime.getSnapshot().statusTexts.some((entry) => entry.severity === 'warning' && entry.text.includes('DENIED'))
    )
    const warning = runtime
      .getSnapshot()
      .statusTexts.find((entry) => entry.severity === 'warning' && entry.text.includes('DENIED'))
    assert.ok(warning, 'expected a warning about the refusal')
    // The point: it must not assert an identity it cannot know. Naming a stream
    // here is only ever a guess from send order, and a wrong one actively
    // misdirects someone already chasing an empty readout.
    for (const label of ['ATTITUDE', 'RC_CHANNELS', 'SYS_STATUS', 'GPS_RAW_INT', 'OPTICAL_FLOW']) {
      assert.ok(!warning.text.includes(label), `the warning must not name ${label}`)
    }
    // It should still point at the likely candidates as a class, which is true.
    assert.match(warning.text, /compile-time|bridge/i)
  } finally {
    await runtime.disconnect().catch(() => {})
    runtime.destroy()
  }
})

test('accepted stream requests produce no warning', async () => {
  const session = createScriptedSession()
  const runtime = await bootRuntimeAndWaitForStreamRequests(session)
  try {
    for (let index = 0; index < 14; index += 1) {
      session.inject(commandAck(MAV_RESULT.ACCEPTED))
    }
    await new Promise((resolve) => setTimeout(resolve, 50))

    const warnings = runtime
      .getSnapshot()
      .statusTexts.filter((entry) => entry.severity === 'warning' && entry.text.toLowerCase().includes('telemetry stream'))
    assert.deepEqual(warnings, [], 'a healthy run must be silent')
  } finally {
    await runtime.disconnect().catch(() => {})
    runtime.destroy()
  }
})

test('two refusals are reported as two, not as two different guessed streams', async () => {
  const session = createScriptedSession()
  const runtime = await bootRuntimeAndWaitForStreamRequests(session)
  try {
    session.inject(commandAck(MAV_RESULT.DENIED))
    session.inject(commandAck(MAV_RESULT.UNSUPPORTED))

    const counted = await waitFor(() =>
      runtime.getSnapshot().statusTexts.some((entry) => entry.severity === 'warning' && entry.text.includes('2 live telemetry stream requests'))
    )
    assert.ok(counted, 'expected the count to reflect both refusals')
  } finally {
    await runtime.disconnect().catch(() => {})
    runtime.destroy()
  }
})
