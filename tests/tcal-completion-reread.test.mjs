// Per-IMU thermal calibration finishes inside the firmware, which saves
// INS_TCALn_ENABLE (2 -> 1) without sending a PARAM_VALUE. The only sign is a
// "TCAL[n]: completed calibration" STATUSTEXT (AP_InertialSensor_tempcal.cpp).
// A field report: the board reached its target and the card stayed on
// "learning". The runtime now re-reads INS_TCALn_* when that message arrives.

import assert from 'node:assert/strict'
import test from 'node:test'

import { ArduPilotConfiguratorRuntime } from '../packages/ardupilot-core/dist/index.js'
import { arducopterMetadata } from '../packages/param-metadata/dist/index.js'

function createTcalSession(initialParameters) {
  const statusListeners = []
  const messageListeners = []
  const parameters = { ...initialParameters }
  const ids = Object.keys(parameters)
  let connected = false
  const reads = []
  const emit = (message) =>
    messageListeners.forEach((listener) =>
      listener({ header: { systemId: 1, componentId: 1, sequence: 0 }, message, timestampMs: Date.now() })
    )
  const paramValue = (paramId) => ({
    type: 'PARAM_VALUE',
    paramId,
    paramValue: parameters[paramId],
    paramType: 9,
    paramCount: ids.length,
    paramIndex: ids.indexOf(paramId)
  })
  return {
    reads,
    getTransportStatus: () => (connected ? { kind: 'connected' } : { kind: 'disconnected' }),
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
      statusListeners.forEach((listener) => listener({ kind: 'disconnected', reason: 'test' }))
    },
    destroy() {},
    async send(message) {
      if (message.type === 'PARAM_REQUEST_LIST') {
        ids.forEach((paramId) => emit(paramValue(paramId)))
      } else if (message.type === 'PARAM_REQUEST_READ' && message.paramId in parameters) {
        reads.push(message.paramId)
        queueMicrotask(() => emit(paramValue(message.paramId)))
      }
    },
    /** The firmware saving a value without announcing it. */
    setSilently(paramId, value) {
      parameters[paramId] = value
    },
    pushStatusText(text) {
      emit({ type: 'STATUSTEXT', severity: 4, text, statusId: 0, chunkSequence: 0 })
    }
  }
}

const value = (runtime, id) => runtime.getSnapshot().parameters.find((parameter) => parameter.id === id)?.value

async function waitFor(predicate, timeoutMs = 1000) {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('timed out')
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

async function connectedRuntime(session) {
  const runtime = new ArduPilotConfiguratorRuntime(session, arducopterMetadata)
  await runtime.connect()
  await runtime.requestParameterList({ timeoutMs: 200 })
  await runtime.waitForParameterSync({ timeoutMs: 200 })
  return runtime
}

test('a TCAL completion message re-reads INS_TCALn_* so learning flips to on', async () => {
  const session = createTcalSession({
    INS_TCAL1_ENABLE: 2,
    INS_TCAL1_TMIN: 30,
    INS_TCAL1_TMAX: 75,
    INS_TCAL2_ENABLE: 2,
    FLTMODE1: 0
  })
  const runtime = await connectedRuntime(session)
  try {
    assert.equal(value(runtime, 'INS_TCAL1_ENABLE'), 2)
    session.setSilently('INS_TCAL1_ENABLE', 1)
    session.setSilently('INS_TCAL1_TMIN', 36)
    session.pushStatusText('TCAL[1]: completed calibration tmin=36.1 tmax=75.0')
    await waitFor(() => value(runtime, 'INS_TCAL1_ENABLE') === 1)
    assert.equal(value(runtime, 'INS_TCAL1_TMIN'), 36)
    // Only the thermal-calibration parameters are re-read.
    assert.ok(session.reads.every((id) => /^INS_TCAL\d+_/.test(id)), session.reads.join(','))
    assert.ok(!session.reads.includes('FLTMODE1'))
  } finally {
    await runtime.disconnect()
  }
})

test('a failed fit re-reads too, so the card shows thermal cal off', async () => {
  const session = createTcalSession({ INS_TCAL1_ENABLE: 2, INS_TCAL1_TMAX: 75 })
  const runtime = await connectedRuntime(session)
  try {
    session.setSilently('INS_TCAL1_ENABLE', 0)
    session.pushStatusText('TCAL[1]: failed fit')
    await waitFor(() => value(runtime, 'INS_TCAL1_ENABLE') === 0)
  } finally {
    await runtime.disconnect()
  }
})

test('other TCAL messages do not trigger a re-read', async () => {
  const session = createTcalSession({ INS_TCAL1_ENABLE: 2, INS_TCAL1_TMAX: 75 })
  const runtime = await connectedRuntime(session)
  try {
    session.pushStatusText('TCAL[1]: started calibration t=30.0C tmax=75.0C')
    await new Promise((resolve) => setTimeout(resolve, 50))
    assert.deepEqual(session.reads, [])
  } finally {
    await runtime.disconnect()
  }
})
