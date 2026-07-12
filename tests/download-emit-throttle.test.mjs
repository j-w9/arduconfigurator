import assert from 'node:assert/strict'
import test from 'node:test'

import { ArduPilotConfiguratorRuntime } from '../packages/ardupilot-core/dist/index.js'
import { arducopterMetadata } from '../packages/param-metadata/dist/index.js'

// Regression: the runtime emitted a snapshot for EVERY inbound message. During a
// MAVFTP burst / LOG_DATA download that is thousands of packets a second, each
// firing a full-app re-render — which starved the Web Serial read loop and
// collapsed download throughput to ~130x slower than a headless client (94 KB/s
// vs ~0.7 KB/s in the browser). File-download packets don't change the snapshot
// (progress rides their own callbacks), so they must NOT emit per packet.
function createSession() {
  const statusListeners = []
  const messageListeners = []
  const emit = (message) =>
    messageListeners.forEach((listener) =>
      listener({ header: { systemId: 1, componentId: 1, sequence: 0 }, message, timestampMs: Date.now() })
    )
  return {
    getTransportStatus: () => ({ kind: 'connected' }),
    onStatus: (l) => (statusListeners.push(l), () => {}),
    onMessage: (l) => (messageListeners.push(l), () => {}),
    async connect() {
      statusListeners.forEach((l) => l({ kind: 'connected' }))
      emit({ type: 'HEARTBEAT', autopilot: 3, vehicleType: 2, baseMode: 0, customMode: 0, systemStatus: 4, mavlinkVersion: 3 })
    },
    async disconnect() {},
    destroy() {},
    async send() {},
    _emit: emit
  }
}

test('MAVFTP + LOG_DATA download packets do not each trigger a snapshot emit', async () => {
  const session = createSession()
  const runtime = new ArduPilotConfiguratorRuntime(session, arducopterMetadata)
  try {
    await runtime.connect()

    let emits = 0
    const unsubscribe = runtime.subscribe(() => {
      emits += 1
    })
    // subscribe() may replay the current snapshot once; measure deltas from here.
    const baseline = emits

    // A flood of file-download packets — these route to the mavftp/logDownload
    // services and must not churn the snapshot.
    for (let i = 0; i < 500; i += 1) {
      session._emit({
        type: 'FILE_TRANSFER_PROTOCOL',
        targetNetwork: 0,
        targetSystem: 1,
        targetComponent: 1,
        payload: new Uint8Array(251)
      })
      session._emit({ type: 'LOG_DATA', id: 1, ofs: i * 90, count: 90, data: new Uint8Array(90) })
    }
    assert.equal(emits - baseline, 0, '1000 download packets triggered zero snapshot emits')

    // A real state-changing message still emits.
    session._emit({ type: 'HEARTBEAT', autopilot: 3, vehicleType: 2, baseMode: 0, customMode: 0, systemStatus: 4, mavlinkVersion: 3 })
    assert.ok(emits - baseline >= 1, 'a heartbeat still emits a snapshot')

    unsubscribe()
  } finally {
    await runtime.disconnect().catch(() => {})
    runtime.destroy()
  }
})
