import assert from 'node:assert/strict'
import test from 'node:test'

import { ArduPilotConfiguratorRuntime } from '../packages/ardupilot-core/dist/index.js'
import { arducopterMetadata } from '../packages/param-metadata/dist/index.js'
import { MAV_PARAM_TYPE } from '../packages/protocol-mavlink/dist/index.js'

// A lossy transport (Web Serial under a fast param burst) drops a handful of
// PARAM_VALUE frames, so the app lands a few params short of the FC-advertised
// count and any criterion/view depending on a dropped param silently breaks
// (field repro: FRAME_TYPE at index 26 dropped -> guided Airframe stuck at 4/6,
// "Confirm Airframe Review" hard-disabled). Recovery must refetch exactly the
// missing indices with PARAM_REQUEST_READ instead of re-streaming the whole
// table (which just re-runs the same lossy burst).
function createLossySession(sentMessages, { dropIndices }) {
  const statusListeners = []
  const messageListeners = []
  let connected = false

  // A small synthetic table; FRAME_TYPE sits at an early index like on a real FC.
  const table = [
    { id: 'FRAME_TYPE', value: 1 },
    { id: 'AHRS_EKF_TYPE', value: 3 },
    { id: 'FRAME_CLASS', value: 1 },
    { id: 'ATC_RAT_RLL_P', value: 0.135 },
    { id: 'INS_GYRO_FILTER', value: 20 }
  ]
  const total = table.length
  const drop = new Set(dropIndices)

  const emit = (message) =>
    messageListeners.forEach((listener) =>
      listener({ header: { systemId: 1, componentId: 1, sequence: 0 }, message, timestampMs: Date.now() })
    )

  const emitParam = (index) =>
    emit({
      type: 'PARAM_VALUE',
      paramId: table[index].id,
      paramValue: table[index].value,
      paramType: MAV_PARAM_TYPE.REAL32,
      paramCount: total,
      paramIndex: index
    })

  return {
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
        // The initial burst "loses" the dropped indices.
        for (let index = 0; index < total; index += 1) {
          if (!drop.has(index)) {
            emitParam(index)
          }
        }
        return
      }
      if (message.type === 'PARAM_REQUEST_READ') {
        // The FC honours a by-index read — this is the gap-fill path.
        assert.equal(message.paramId, '', 'gap-fill reads by index, not by name')
        assert.ok(message.paramIndex >= 0 && message.paramIndex < total)
        emitParam(message.paramIndex)
      }
    }
  }
}

test('a stalled parameter sync refetches only the dropped indices by PARAM_REQUEST_READ and completes', async () => {
  const sentMessages = []
  const session = createLossySession(sentMessages, { dropIndices: [0, 3] }) // FRAME_TYPE + one more
  const runtime = new ArduPilotConfiguratorRuntime(session, arducopterMetadata, {
    parameterSyncStallRetryMs: 10
  })
  try {
    await runtime.connect()
    await runtime.requestParameterList({ timeoutMs: 500 })
    const stats = await runtime.waitForParameterSync({ timeoutMs: 1000 })

    assert.equal(stats.status, 'complete', 'gap-fill drove the sync to complete')
    assert.equal(stats.downloaded, 5, 'all five params present after gap-fill')

    const snapshot = runtime.getSnapshot()
    const frameType = snapshot.parameters.find((p) => p.id === 'FRAME_TYPE')
    assert.ok(frameType, 'the dropped FRAME_TYPE was recovered')
    assert.equal(frameType.value, 1)

    // Recovery targeted exactly the two gaps by index — not a full re-stream.
    const reads = sentMessages.filter((m) => m.type === 'PARAM_REQUEST_READ')
    const readIndices = reads.map((m) => m.paramIndex).sort((a, b) => a - b)
    assert.deepEqual(readIndices, [0, 3], 'only the missing indices were refetched')
    const listRequests = sentMessages.filter((m) => m.type === 'PARAM_REQUEST_LIST')
    assert.equal(listRequests.length, 1, 'no full re-stream once a partial set exists to gap-fill')
  } finally {
    await runtime.disconnect().catch(() => {})
    runtime.destroy()
  }
})

test('a sync that drops the very first burst entirely falls back to a full re-stream', async () => {
  const sentMessages = []
  // Drop everything on the first PARAM_REQUEST_LIST, then serve normally on the
  // re-stream — with nothing received there are no indices to target, so the
  // recovery must fall back to a full list request.
  let firstList = true
  const table = [
    { id: 'FRAME_TYPE', value: 1 },
    { id: 'FRAME_CLASS', value: 1 }
  ]
  const messageListeners = []
  const statusListeners = []
  const emit = (message) =>
    messageListeners.forEach((l) => l({ header: { systemId: 1, componentId: 1, sequence: 0 }, message, timestampMs: Date.now() }))
  const session = {
    getTransportStatus: () => ({ kind: 'connected' }),
    onStatus: (l) => (statusListeners.push(l), () => {}),
    onMessage: (l) => (messageListeners.push(l), () => {}),
    async connect() {
      statusListeners.forEach((l) => l({ kind: 'connected' }))
      emit({ type: 'HEARTBEAT', autopilot: 3, vehicleType: 2, baseMode: 0, customMode: 0, systemStatus: 4, mavlinkVersion: 3 })
    },
    async disconnect() {},
    destroy() {},
    async send(message) {
      sentMessages.push(message)
      if (message.type === 'PARAM_REQUEST_LIST') {
        if (firstList) {
          firstList = false
          return // total burst loss
        }
        table.forEach((entry, index) =>
          emit({ type: 'PARAM_VALUE', paramId: entry.id, paramValue: entry.value, paramType: MAV_PARAM_TYPE.REAL32, paramCount: table.length, paramIndex: index })
        )
      }
    }
  }
  const runtime = new ArduPilotConfiguratorRuntime(session, arducopterMetadata, { parameterSyncStallRetryMs: 10 })
  try {
    await runtime.connect()
    await runtime.requestParameterList({ timeoutMs: 500 })
    const stats = await runtime.waitForParameterSync({ timeoutMs: 1000 })
    assert.equal(stats.status, 'complete')
    assert.equal(sentMessages.filter((m) => m.type === 'PARAM_REQUEST_LIST').length, 2, 'fell back to a full re-stream')
    assert.equal(sentMessages.filter((m) => m.type === 'PARAM_REQUEST_READ').length, 0, 'no by-index reads when nothing had arrived')
  } finally {
    await runtime.disconnect().catch(() => {})
    runtime.destroy()
  }
})
