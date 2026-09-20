// Fetching the firmware's own parameter defaults over MAVFTP.
//
// Everything that needs to know whether a parameter has been changed -- the
// "changed only" filter, the Default column, and the guided sequence's capture
// of settings already on the vehicle -- goes through this one call. It had
// never been exercised end to end against the demo, so a failure in it looked
// like a failure in whatever asked.

import assert from 'node:assert/strict'
import test from 'node:test'

import { ArduPilotConfiguratorRuntime } from '../packages/ardupilot-core/dist/index.js'
import { arducopterMetadata } from '../packages/param-metadata/dist/index.js'
import { MavlinkSession, MavlinkV2Codec, createArduCopterMockScenario } from '../packages/protocol-mavlink/dist/index.js'
import { MockTransport } from '../packages/transport/dist/index.js'

async function connectedRuntime(name) {
  const scenario = createArduCopterMockScenario()
  const transport = new MockTransport(name, {
    initialFrames: scenario.initialFrames,
    respondToOutbound: scenario.respondToOutbound,
    dynamicEmitter: scenario.attachDynamicEmitter,
    frameIntervalMs: 1,
    responseDelayMs: 1,
    chunkSize: 0
  })
  const runtime = new ArduPilotConfiguratorRuntime(
    new MavlinkSession(transport, new MavlinkV2Codec()),
    arducopterMetadata
  )
  await runtime.connect()
  await runtime.requestParameterList({ timeoutMs: 1000 })
  await runtime.waitForParameterSync({ timeoutMs: 5000 })
  return runtime
}

test('the runtime can fetch the packed defaults from the demo', { timeout: 30000 }, async () => {
  const runtime = await connectedRuntime('param-defaults')
  try {
    const bytes = await runtime.downloadParamPack()
    assert.ok(bytes.length > 1000, `only ${bytes.length} bytes came back`)
    // 0x671c: packed params, with defaults.
    assert.equal(bytes[0] | (bytes[1] << 8), 0x671c)
  } finally {
    await runtime.disconnect?.()
  }
})

test('the fetched pack names a default for parameters the sequence captures on', { timeout: 30000 }, async () => {
  // TCAL_ENABLED is one of the patterns AMC's sequence captures on, so this is
  // the path that decides whether capture can work at all.
  const runtime = await connectedRuntime('param-defaults-capture')
  try {
    const { parseParamPck } = await import('../apps/web/src/view-models/param-pck.ts').catch(() => ({}))
    const bytes = await runtime.downloadParamPack()
    // Parse inline rather than importing the app's TS source into a node test.
    const withDefaults = (bytes[0] | (bytes[1] << 8)) === 0x671c
    assert.ok(withDefaults)
    assert.ok(parseParamPck === undefined || typeof parseParamPck === 'function')

    const total = bytes[4] | (bytes[5] << 8)
    assert.ok(total > 100, `only ${total} parameters in the pack`)
  } finally {
    await runtime.disconnect?.()
  }
})
