import assert from 'node:assert/strict'
import test from 'node:test'

import { ArduPilotConfiguratorRuntime } from '../packages/ardupilot-core/dist/index.js'
import { arducopterMetadata } from '../packages/param-metadata/dist/index.js'
import { MAV_CMD, MAV_RESULT } from '../packages/protocol-mavlink/dist/index.js'

// Conformance locks for the MAVLink command protocol
// (mavlink.io/en/services/command.html):
//  - A COMMAND_ACK is only valid from the system/component the command was
//    addressed to; with MAVLink routing other endpoints can ACK the same
//    command id.
//  - MAV_RESULT_IN_PROGRESS is a progress beat: it resets the operation
//    timeout, and the final result arrives in a later COMMAND_ACK. It must
//    not settle the wait as a final success.

const PREFLIGHT_CALIBRATION = MAV_CMD.PREFLIGHT_CALIBRATION

/**
 * Scripted session: emits a heartbeat from sys=1 comp=1 on connect, serves a
 * tiny parameter table, and answers PREFLIGHT_CALIBRATION (level cal,
 * param5=2) with a configurable ACK script of {delayMs, header?, ack}
 * entries.
 */
function createAckScriptSession(ackScript, sentMessages = []) {
  const statusListeners = []
  const messageListeners = []
  const parameters = { FRAME_CLASS: 1, FRAME_TYPE: 1, FLTMODE1: 0 }
  let connected = false

  const emit = (message, header = { systemId: 1, componentId: 1, sequence: 0 }) => {
    messageListeners.forEach((listener) => listener({ header, message, timestampMs: Date.now() }))
  }

  return {
    emit,
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
      emit({ type: 'HEARTBEAT', autopilot: 3, vehicleType: 2, baseMode: 0, customMode: 0, systemStatus: 4, mavlinkVersion: 3 })
    },
    async disconnect() {
      connected = false
      statusListeners.forEach((listener) => listener({ kind: 'disconnected', reason: 'test disconnect' }))
    },
    destroy() {},
    async send(message) {
      sentMessages.push(message)
      if (message.type === 'PARAM_REQUEST_LIST') {
        Object.entries(parameters).forEach(([paramId, paramValue], index, entries) => {
          emit({ type: 'PARAM_VALUE', paramId, paramValue, paramType: 9, paramCount: entries.length, paramIndex: index })
        })
        return
      }
      if (message.type === 'COMMAND_LONG' && message.command === PREFLIGHT_CALIBRATION) {
        for (const step of ackScript) {
          setTimeout(() => emit(step.ack, step.header), step.delayMs)
        }
      }
    }
  }
}

function levelCalAck(result, overrides = {}) {
  return {
    type: 'COMMAND_ACK',
    command: PREFLIGHT_CALIBRATION,
    result,
    progress: 0,
    resultParam2: 0,
    targetSystem: 255,
    targetComponent: 190,
    ...overrides
  }
}

async function runLevelCal(session) {
  const runtime = new ArduPilotConfiguratorRuntime(session, arducopterMetadata)
  try {
    await runtime.connect()
    await runtime.requestParameterList({ timeoutMs: 200 })
    await runtime.waitForParameterSync({ timeoutMs: 200 })
    // A FAILED final ACK propagates out of runGuidedAction (the action
    // state still records the failure) — swallow it and assert on state.
    await runtime.runGuidedAction('calibrate-level').catch(() => {})
    const deadline = Date.now() + 8000
    for (;;) {
      const action = runtime.getSnapshot().guidedActions['calibrate-level']
      if (action.status === 'succeeded' || action.status === 'failed') {
        return { action, snapshot: runtime.getSnapshot() }
      }
      if (Date.now() > deadline) {
        throw new Error(`level cal still ${action.status} after 8s`)
      }
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
  } finally {
    await runtime.disconnect().catch(() => {})
    runtime.destroy()
  }
}

test('COMMAND_ACK from a foreign system does not settle the waiter; the vehicle ACK does', async () => {
  // A companion at sys=2 FAILs the command immediately; the vehicle ACCEPTs
  // it shortly after. Pre-fix the foreign FAILED settled the waiter and the
  // guided action reported failure.
  const session = createAckScriptSession([
    { delayMs: 5, header: { systemId: 2, componentId: 191, sequence: 0 }, ack: levelCalAck(MAV_RESULT.FAILED) },
    { delayMs: 60, ack: levelCalAck(MAV_RESULT.ACCEPTED) }
  ])
  const { action } = await runLevelCal(session)
  assert.equal(action.status, 'succeeded', 'vehicle ACCEPTED must win over a foreign FAILED')
})

test('IN_PROGRESS followed by FAILED reports failure (was: success on the progress beat)', async () => {
  const session = createAckScriptSession([
    { delayMs: 5, ack: levelCalAck(MAV_RESULT.IN_PROGRESS, { progress: 10 }) },
    { delayMs: 80, ack: levelCalAck(MAV_RESULT.FAILED) }
  ])
  const { action } = await runLevelCal(session)
  assert.equal(action.status, 'failed', 'the final FAILED ACK is the result, not the IN_PROGRESS beat')
})

test('IN_PROGRESS followed by ACCEPTED succeeds on the final ACK', async () => {
  const session = createAckScriptSession([
    { delayMs: 5, ack: levelCalAck(MAV_RESULT.IN_PROGRESS, { progress: 50 }) },
    { delayMs: 80, ack: levelCalAck(MAV_RESULT.ACCEPTED) }
  ])
  const { action } = await runLevelCal(session)
  assert.equal(action.status, 'succeeded')
})

test('IN_PROGRESS with no final ACK still resolves as started (firmwares that omit the final ACK)', async () => {
  // Only the progress beat arrives. The waiter must re-arm its timeout and,
  // when the (refreshed) window closes with no final ACK, resolve with the
  // IN_PROGRESS acceptance instead of failing a command the autopilot took.
  // Level cal uses a 15s ack budget — too slow for a unit test — so drive
  // the private waiter directly with a 150ms window.
  const session = createAckScriptSession([])
  const runtime = new ArduPilotConfiguratorRuntime(session, arducopterMetadata)
  try {
    await runtime.connect()
    const handle = runtime.waitForCommandAck(PREFLIGHT_CALIBRATION, 150)
    session.emit(levelCalAck(MAV_RESULT.IN_PROGRESS, { progress: 25 }))
    const ack = await handle.promise
    assert.equal(ack.result, MAV_RESULT.IN_PROGRESS)
  } finally {
    await runtime.disconnect().catch(() => {})
    runtime.destroy()
  }
})

test('IN_PROGRESS beats reset the ack timeout (command protocol timeout rule)', async () => {
  // 150ms window, progress beats at 100ms and 200ms, final ACCEPTED at
  // 280ms. Without the reset the waiter would have timed out at 150ms;
  // with it the final ACK lands inside the third window.
  const session = createAckScriptSession([])
  const runtime = new ArduPilotConfiguratorRuntime(session, arducopterMetadata)
  try {
    await runtime.connect()
    const handle = runtime.waitForCommandAck(PREFLIGHT_CALIBRATION, 150)
    setTimeout(() => session.emit(levelCalAck(MAV_RESULT.IN_PROGRESS, { progress: 30 })), 100)
    setTimeout(() => session.emit(levelCalAck(MAV_RESULT.IN_PROGRESS, { progress: 60 })), 200)
    setTimeout(() => session.emit(levelCalAck(MAV_RESULT.ACCEPTED)), 280)
    const ack = await handle.promise
    assert.equal(ack.result, MAV_RESULT.ACCEPTED, 'final ACK resolves after refreshed windows')
  } finally {
    await runtime.disconnect().catch(() => {})
    runtime.destroy()
  }
})
