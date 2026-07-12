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

// Simple index-addressable session: the initial burst delivers `initialCount`
// of `total` params; every PARAM_REQUEST_READ is answered by index (unless
// answerReads is false). Used for convergence + fallback tests.
function createIndexedSession(sentMessages, { total, initialCount, answerReads = true }) {
  const messageListeners = []
  const statusListeners = []
  const value = (index) => index + 1000
  const emitParam = (index) =>
    messageListeners.forEach((l) =>
      l({
        header: { systemId: 1, componentId: 1, sequence: 0 },
        message: { type: 'PARAM_VALUE', paramId: `P_${index}`, paramValue: value(index), paramType: 9, paramCount: total, paramIndex: index },
        timestampMs: Date.now()
      })
    )
  let firstList = true
  return {
    getTransportStatus: () => ({ kind: 'connected' }),
    onStatus: (l) => (statusListeners.push(l), () => {}),
    onMessage: (l) => (messageListeners.push(l), () => {}),
    async connect() {
      statusListeners.forEach((l) => l({ kind: 'connected' }))
      messageListeners.forEach((l) =>
        l({ header: { systemId: 1, componentId: 1, sequence: 0 }, message: { type: 'HEARTBEAT', autopilot: 3, vehicleType: 2, baseMode: 0, customMode: 0, systemStatus: 4, mavlinkVersion: 3 }, timestampMs: Date.now() })
      )
    },
    async disconnect() {},
    destroy() {},
    async send(message) {
      sentMessages.push(message)
      if (message.type === 'PARAM_REQUEST_LIST') {
        const count = firstList ? initialCount : total
        firstList = false
        for (let i = 0; i < count; i += 1) emitParam(i)
      } else if (message.type === 'PARAM_REQUEST_READ' && answerReads) {
        emitParam(message.paramIndex)
      }
    }
  }
}

test('a gap larger than one gap-fill budget still converges (retry budget refunds on progress)', async () => {
  // 1200 params, only 300 in the first burst → 900 missing, far beyond
  // MAX_PARAMETER_GAP_FILL_PER_PASS (256) × MAX_PARAMETER_SYNC_RETRIES (3) = 768.
  // Before the refund fix this stranded at ~1068/1200; now each pass that
  // recovers params refunds the budget, so it converges.
  const sentMessages = []
  const session = createIndexedSession(sentMessages, { total: 1200, initialCount: 300 })
  const runtime = new ArduPilotConfiguratorRuntime(session, arducopterMetadata, { parameterSyncStallRetryMs: 5 })
  try {
    await runtime.connect()
    await runtime.requestParameterList({ timeoutMs: 2000 })
    const stats = await runtime.waitForParameterSync({ timeoutMs: 5000 })
    assert.equal(stats.status, 'complete', 'large gap converged')
    assert.equal(stats.downloaded, 1200, 'all 1200 recovered (past the old 768 cap)')
    const reads = sentMessages.filter((m) => m.type === 'PARAM_REQUEST_READ')
    assert.ok(reads.length >= 900, `refetched all missing indices by gap-fill (${reads.length} reads)`)
  } finally {
    await runtime.disconnect().catch(() => {})
    runtime.destroy()
  }
})

test('gap-fill that recovers nothing falls back to a full re-stream', async () => {
  // The initial burst drops the last index and the FC does NOT answer by-index
  // reads (answerReads:false). The first pass gap-fills and recovers nothing, so
  // the next pass must fall back to a full PARAM_REQUEST_LIST — which serves the
  // whole table and completes. Guards an FC that ignores PARAM_REQUEST_READ.
  const sentMessages = []
  const session = createIndexedSession(sentMessages, { total: 5, initialCount: 4, answerReads: false })
  const runtime = new ArduPilotConfiguratorRuntime(session, arducopterMetadata, { parameterSyncStallRetryMs: 5 })
  try {
    await runtime.connect()
    await runtime.requestParameterList({ timeoutMs: 2000 })
    const stats = await runtime.waitForParameterSync({ timeoutMs: 5000 })
    assert.equal(stats.status, 'complete', 'fell back and completed')
    assert.ok(
      sentMessages.filter((m) => m.type === 'PARAM_REQUEST_LIST').length >= 2,
      'issued a full re-stream after the unanswered gap-fill'
    )
    assert.ok(sentMessages.some((m) => m.type === 'PARAM_REQUEST_READ'), 'tried gap-fill first')
  } finally {
    await runtime.disconnect().catch(() => {})
    runtime.destroy()
  }
})
