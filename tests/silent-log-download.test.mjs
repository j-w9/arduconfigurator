// Background log reads must leave NO trace in the operator's status feed.
//
// Any automatic read the operator did not ask for must be invisible: a
// "Downloaded /APM/LOGS/00000042.BIN" line appearing unprompted reads as the
// app acting behind their back, and buries the entries they were actually
// watching for.
//
// The inverse matters just as much: an operator-initiated download must STILL
// report, because there the line is the confirmation they are waiting on. A
// blanket silence would be a regression dressed as a fix.

import assert from 'node:assert/strict'
import test from 'node:test'

import { ArduPilotConfiguratorRuntime } from '../packages/ardupilot-core/dist/index.js'
import { arducopterMetadata } from '../packages/param-metadata/dist/index.js'

function createSession() {
  const statusListeners = []
  const messageListeners = []
  return {
    getTransportStatus: () => ({ kind: 'connected' }),
    onStatus(listener) {
      statusListeners.push(listener)
      return () => {}
    },
    onMessage(listener) {
      messageListeners.push(listener)
      return () => {}
    },
    async connect() {
      statusListeners.forEach((listener) => listener({ kind: 'connected' }))
      messageListeners.forEach((listener) =>
        listener({
          header: { systemId: 1, componentId: 1, sequence: 0 },
          message: {
            type: 'HEARTBEAT',
            autopilot: 3,
            vehicleType: 2,
            baseMode: 0,
            customMode: 0,
            systemStatus: 4,
            mavlinkVersion: 3
          },
          timestampMs: Date.now()
        })
      )
    },
    async disconnect() {},
    destroy() {},
    async send() {}
  }
}

/** Stub the burst reader so the test exercises the REPORTING decision, not MAVFTP. */
async function withRuntime(run) {
  const runtime = new ArduPilotConfiguratorRuntime(createSession(), arducopterMetadata)
  try {
    await runtime.connect()
    runtime.mavftp.downloadRemoteFileBurst = async () => new Uint8Array(1024)
    await run(runtime)
  } finally {
    runtime.destroy()
  }
}

const logEntries = (runtime) =>
  runtime
    .getSnapshot()
    .statusTexts.filter((entry) => String(entry.text).includes('Downloaded'))

test('a silent download adds NO status entry', async () => {
  await withRuntime(async (runtime) => {
    const before = logEntries(runtime).length
    await runtime.downloadMavftpLog('/APM/LOGS/00000042.BIN', undefined, { silent: true })
    assert.equal(
      logEntries(runtime).length,
      before,
      'an automatic background read must leave the status feed untouched'
    )
  })
})

test('an operator-initiated download still reports — silence is opt-in', async () => {
  // The confirmation the operator is waiting on must not disappear.
  await withRuntime(async (runtime) => {
    const before = logEntries(runtime).length
    await runtime.downloadMavftpLog('/APM/LOGS/00000042.BIN')
    assert.equal(logEntries(runtime).length, before + 1, 'a normal download should report')
  })
})

test('silent: false is explicit and still reports', async () => {
  await withRuntime(async (runtime) => {
    const before = logEntries(runtime).length
    await runtime.downloadMavftpLog('/APM/LOGS/1.BIN', undefined, { silent: false })
    assert.equal(logEntries(runtime).length, before + 1)
  })
})

test('a silent download still returns the bytes — quiet, not crippled', async () => {
  await withRuntime(async (runtime) => {
    const bytes = await runtime.downloadMavftpLog('/APM/LOGS/1.BIN', undefined, { silent: true })
    assert.ok(bytes instanceof Uint8Array)
    assert.equal(bytes.length, 1024)
  })
})
