import assert from 'node:assert/strict'
import test from 'node:test'

import { ArduPilotConfiguratorRuntime } from '../packages/ardupilot-core/dist/index.js'
import { arducopterMetadata } from '../packages/param-metadata/dist/index.js'
import { MAV_PARAM_TYPE } from '../packages/protocol-mavlink/dist/index.js'

// Field repro (4.8-dev board): the FC watchdog-resets a few seconds into every
// connect, dropping the USB link. Before this coverage the runtime (a) threw
// away every parameter already downloaded on each drop, (b) stopped retrying
// after 3 no-progress passes and never resumed, and (c) ignored the heartbeat
// from the board once it finished rebooting — so the operator never got a
// complete table no matter how many times they reconnected, while a GCS that
// retries indefinitely pulled the same board's parameters off fine.

const TOTAL = 12

function createResettingSession(sent, { windowSize }) {
  let window = windowSize
  const statusListeners = []
  const messageListeners = []
  let connected = false
  let served = 0 // how many params this board has handed over across all links
  let healthy = true
  let total = TOTAL

  const emit = (message) =>
    messageListeners.forEach((listener) =>
      listener({ header: { systemId: 1, componentId: 1, sequence: 0 }, message, timestampMs: Date.now() })
    )

  const heartbeat = () =>
    emit({
      type: 'HEARTBEAT',
      autopilot: 3,
      vehicleType: 2,
      baseMode: 0,
      customMode: 0,
      systemStatus: 4,
      mavlinkVersion: 3
    })

  const emitParam = (index) =>
    emit({
      type: 'PARAM_VALUE',
      paramId: `P_${index}`,
      paramValue: index,
      paramType: MAV_PARAM_TYPE.REAL32,
      paramCount: total,
      paramIndex: index
    })

  return {
    heartbeat,
    setHealthy(value) {
      healthy = value
    },
    /** Simulate a reflash between links: the table itself changes size. */
    setTotal(value) {
      total = value
    },
    /** How many params survive one link window before the watchdog bites. */
    setWindow(value) {
      window = value
    },
    /** The board watchdogs: the link drops the way Web Serial reports it. */
    watchdogReset(reason = 'Serial read loop ended.') {
      connected = false
      statusListeners.forEach((listener) => listener({ kind: 'disconnected', reason }))
    },
    servedCount() {
      return served
    },
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
      heartbeat()
    },
    async disconnect() {
      connected = false
      statusListeners.forEach((listener) => listener({ kind: 'disconnected', reason: 'test' }))
    },
    destroy() {},
    async send(message) {
      sent.push(message)
      if (!healthy) {
        return // board is down (rebooting): total silence
      }
      if (message.type === 'PARAM_REQUEST_LIST') {
        // Only `windowSize` params make it out before the watchdog bites.
        for (let index = 0; index < Math.min(window, total); index += 1) {
          served += 1
          emitParam(index)
        }
        return
      }
      if (message.type === 'PARAM_REQUEST_READ' && message.paramIndex < total) {
        served += 1
        emitParam(message.paramIndex)
      }
    }
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

test('a partial table survives a watchdog link drop and the next connect resumes by index', async () => {
  const sent = []
  const session = createResettingSession(sent, { windowSize: 5 })
  const runtime = new ArduPilotConfiguratorRuntime(session, arducopterMetadata, {
    parameterSyncStallRetryMs: 10_000 // no stall retry interference; this tests the reconnect path
  })
  try {
    await runtime.connect()
    await runtime.requestParameterList({ timeoutMs: 500 })
    assert.equal(runtime.getSnapshot().parameters.length, 5, 'first window delivered 5 of 12')

    session.watchdogReset()
    await sleep(20)
    // The values stay on screen after the drop — blanking the app on every
    // watchdog reset helps nobody — but they are explicitly marked stale.
    const dropped = runtime.getSnapshot()
    assert.equal(dropped.parameters.length, 5, 'the last table is retained while disconnected')
    assert.ok(dropped.staleLink, 'and flagged as stale so the UI can say so')
    assert.equal(dropped.staleLink.downloaded, 5)
    assert.equal(dropped.staleLink.total, TOTAL)
    assert.equal(dropped.vehicle, undefined, 'but the vehicle is gone: nothing may act on it')
    assert.equal(dropped.parameterStats.status, 'idle', 'and no sync is considered live')

    // Operator reconnects; the board is up long enough to answer by-index reads.
    await runtime.connect()
    await runtime.requestParameterList({ timeoutMs: 500 })
    const stats = await runtime.waitForParameterSync({ timeoutMs: 2000 })

    assert.equal(stats.status, 'complete', 'the resumed download completed across two links')
    assert.equal(stats.downloaded, TOTAL)

    // The resume refetched ONLY the 7 it never received — not a full re-stream.
    const listRequests = sent.filter((m) => m.type === 'PARAM_REQUEST_LIST')
    const readIndices = sent.filter((m) => m.type === 'PARAM_REQUEST_READ').map((m) => m.paramIndex).sort((a, b) => a - b)
    assert.equal(listRequests.length, 1, 'the second connect resumed instead of re-streaming the table')
    assert.deepEqual(readIndices, [5, 6, 7, 8, 9, 10, 11], 'only the missing indices were requested')
  } finally {
    runtime.destroy()
  }
})

test('the sync keeps retrying while the board is down and recovers when it returns', async () => {
  const sent = []
  const session = createResettingSession(sent, { windowSize: 5 })
  const runtime = new ArduPilotConfiguratorRuntime(session, arducopterMetadata, {
    parameterSyncStallRetryMs: 20
  })
  try {
    await runtime.connect()
    await runtime.requestParameterList({ timeoutMs: 500 })
    assert.equal(runtime.getSnapshot().parameters.length, 5)

    // Board goes down (link stays nominally open — a bridge/SITL-style stall, or
    // the window between the reset and the port dropping). Old behaviour: three
    // no-progress passes and the runtime never asked again.
    session.setHealthy(false)
    await sleep(400) // >> 3 passes at 20ms
    assert.equal(runtime.getSnapshot().parameterStats.downloaded, 5, 'still stuck while the board is down')

    const requestsBefore = sent.length
    session.setHealthy(true)
    const stats = await runtime.waitForParameterSync({ timeoutMs: 4000 })

    assert.ok(sent.length > requestsBefore, 'the runtime was still retrying when the board came back')
    assert.equal(stats.status, 'complete', 'recovered without operator intervention')
    assert.equal(stats.downloaded, TOTAL)
  } finally {
    runtime.destroy()
  }
})

test('fresh: true refuses the carried-over table (post-reboot / post-flash pulls)', async () => {
  const sent = []
  const session = createResettingSession(sent, { windowSize: 5 })
  const runtime = new ArduPilotConfiguratorRuntime(session, arducopterMetadata, {
    parameterSyncStallRetryMs: 10_000
  })
  try {
    await runtime.connect()
    await runtime.requestParameterList({ timeoutMs: 500 })
    session.watchdogReset()
    await sleep(20)

    await runtime.connect()
    await runtime.requestParameterList({ timeoutMs: 500, fresh: true })
    // A clean pull re-streams the whole table rather than gap-filling.
    assert.equal(sent.filter((m) => m.type === 'PARAM_REQUEST_LIST').length, 2, 're-streamed instead of resuming')
    assert.equal(sent.filter((m) => m.type === 'PARAM_REQUEST_READ').length, 0, 'no by-index resume reads')
  } finally {
    runtime.destroy()
  }
})

test('a board whose parameter count changed discards the carried-over values', async () => {
  // Reflashed between links: same board identity, different table. Resuming
  // would blend two firmwares, so the carried values must be thrown out and the
  // download restarted clean against the new count.
  const sent = []
  const session = createResettingSession(sent, { windowSize: 5 })
  const runtime = new ArduPilotConfiguratorRuntime(session, arducopterMetadata, {
    parameterSyncStallRetryMs: 10_000
  })
  try {
    await runtime.connect()
    await runtime.requestParameterList({ timeoutMs: 500 })
    assert.equal(runtime.getSnapshot().parameters.length, 5, 'partial table before the drop')

    session.watchdogReset()
    await sleep(20)

    // New firmware: the table grew, and the board is now stable enough to
    // stream the whole thing in one window.
    session.setTotal(TOTAL + 3)
    session.setWindow(TOTAL + 3)
    await runtime.connect()
    await runtime.requestParameterList({ timeoutMs: 500 })
    const stats = await runtime.waitForParameterSync({ timeoutMs: 3000 })

    assert.equal(stats.total, TOTAL + 3, 'adopted the new table size')
    assert.equal(stats.downloaded, TOTAL + 3, 'downloaded the new table in full')

    const snapshot = runtime.getSnapshot()
    assert.equal(
      snapshot.parameters.filter((parameter) => parameter.aliasedFrom === undefined).length,
      TOTAL + 3,
      'no stale entries left over from the previous firmware'
    )
    assert.ok(
      snapshot.statusTexts.some((entry) => /table changed/i.test(entry.text)),
      'the operator is told the carried-over values were discarded'
    )
  } finally {
    runtime.destroy()
  }
})
