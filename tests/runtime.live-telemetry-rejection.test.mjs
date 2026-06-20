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
// These tests pin the new behaviour:
//   1. A DENIED for the UAVCAN_NODE_STATUS slot in the request loop produces
//      an INFO entry (not a warning) and names the workaround.
//   2. A DENIED for a different stream (e.g. ATTITUDE) still produces a
//      labelled WARNING — the regression we don't want.

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

test('UAVCAN_NODE_STATUS DENIED is downgraded to info with a workaround note', async () => {
  const session = createScriptedSession()
  const runtime = await bootRuntimeAndWaitForStreamRequests(session)
  try {
    // The runtime sends them in order: GLOBAL_POSITION_INT, ATTITUDE,
    // RC_CHANNELS, SYS_STATUS, UAVCAN_NODE_STATUS, MAG_CAL_PROGRESS,
    // MAG_CAL_REPORT. ACK first four, DENY the fifth (UAVCAN_NODE_STATUS),
    // then ACK the trailing mag-cal pair.
    session.inject(commandAck(MAV_RESULT.ACCEPTED))
    session.inject(commandAck(MAV_RESULT.ACCEPTED))
    session.inject(commandAck(MAV_RESULT.ACCEPTED))
    session.inject(commandAck(MAV_RESULT.ACCEPTED))
    session.inject(commandAck(MAV_RESULT.DENIED))
    session.inject(commandAck(MAV_RESULT.ACCEPTED))
    session.inject(commandAck(MAV_RESULT.ACCEPTED))

    const seen = await waitFor(() =>
      runtime.getSnapshot().statusTexts.some(
        (entry) => entry.text.includes('UAVCAN_NODE_STATUS') && entry.severity === 'info'
      )
    )
    assert.ok(seen, 'expected an INFO entry naming UAVCAN_NODE_STATUS')

    const noBogusWarning = !runtime
      .getSnapshot()
      .statusTexts.some(
        (entry) =>
          entry.severity === 'warning' &&
          entry.text.toLowerCase().includes('telemetry stream')
      )
    assert.ok(noBogusWarning, 'must not surface the old generic "telemetry stream" warning')
  } finally {
    await runtime.disconnect().catch(() => {})
    runtime.destroy()
  }
})

test('a DENIED on a non-UAVCAN stream still surfaces a labelled warning', async () => {
  const session = createScriptedSession()
  const runtime = await bootRuntimeAndWaitForStreamRequests(session)
  try {
    // Order: GLOBAL_POSITION_INT, ATTITUDE, RC_CHANNELS, SYS_STATUS,
    // UAVCAN_NODE_STATUS, MAG_CAL_PROGRESS, MAG_CAL_REPORT.
    // Deny the second (ATTITUDE) so we exercise the still-warning path.
    session.inject(commandAck(MAV_RESULT.ACCEPTED))
    session.inject(commandAck(MAV_RESULT.DENIED))
    session.inject(commandAck(MAV_RESULT.ACCEPTED))
    session.inject(commandAck(MAV_RESULT.ACCEPTED))
    session.inject(commandAck(MAV_RESULT.ACCEPTED))
    session.inject(commandAck(MAV_RESULT.ACCEPTED))
    session.inject(commandAck(MAV_RESULT.ACCEPTED))

    const seen = await waitFor(() =>
      runtime
        .getSnapshot()
        .statusTexts.some(
          (entry) =>
            entry.severity === 'warning' &&
            entry.text.includes('ATTITUDE') &&
            entry.text.includes('DENIED')
        )
    )
    assert.ok(seen, 'expected a labelled WARNING naming ATTITUDE')
  } finally {
    await runtime.disconnect().catch(() => {})
    runtime.destroy()
  }
})
