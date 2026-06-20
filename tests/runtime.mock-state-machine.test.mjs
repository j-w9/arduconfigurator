import assert from 'node:assert/strict'
import test from 'node:test'

import { ArduPilotConfiguratorRuntime } from '../packages/ardupilot-core/dist/index.js'
import { arducopterMetadata } from '../packages/param-metadata/dist/index.js'
import { arduplaneMetadata } from '../packages/param-metadata/dist/index.js'
import {
  MavlinkSession,
  MavlinkV2Codec,
  createArduCopterMockScenario,
  createArduPlaneMockScenario
} from '../packages/protocol-mavlink/dist/index.js'
import { MockTransport } from '../packages/transport/dist/index.js'

// These tests pin the dynamic mock state machine added on top of the static
// demo scenario. The "without dynamicCadenceMs" cases prove the legacy path
// stays byte-for-byte equivalent; the "with dynamicCadenceMs" cases prove
// the new transitions actually surface to the runtime over time.

test('mock scenario stays static when dynamicCadenceMs is unset', async () => {
  const scenario = createArduCopterMockScenario()
  const transport = new MockTransport('static-mock-no-cadence', {
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

  try {
    await runtime.connect()
    await runtime.requestParameterList({ timeoutMs: 500 })
    await runtime.waitForParameterSync({ timeoutMs: 2500 })

    const initialVoltage = runtime.getSnapshot().liveVerification.batteryTelemetry.voltageV
    assert.equal(typeof initialVoltage, 'number')

    // Wait well past any plausible cadence; no transitions should fire.
    await sleep(150)

    const afterVoltage = runtime.getSnapshot().liveVerification.batteryTelemetry.voltageV
    assert.equal(afterVoltage, initialVoltage)
    assert.equal(runtime.getSnapshot().liveVerification.rcInput.verified, true)

    const statusTexts = runtime.getSnapshot().statusTexts.map((entry) => entry.text)
    assert.ok(
      !statusTexts.some((text) => /battery 1 low|battery 1 critical|RC link lost|EKF variance/i.test(text)),
      `Static mock should not emit dynamic STATUSTEXTs. Saw: ${JSON.stringify(statusTexts)}`
    )
  } finally {
    await runtime.disconnect().catch(() => {})
    runtime.destroy()
  }
})

test('battery voltage sags when dynamicCadenceMs is set', async () => {
  const dynamicCadenceMs = 50
  const scenario = createArduCopterMockScenario({ dynamicCadenceMs })
  const transport = new MockTransport('dynamic-mock-battery', {
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

  try {
    await runtime.connect()

    // Sample the battery voltage from the first dynamic ticks, before the sag
    // profile floors at BATT_CRT_VOLT. This test used to read after a full
    // param sync, but that only worked because the old MockTransport cursor
    // bunched dynamic telemetry behind the connect-time param backlog, so the
    // snapshot lagged and had not floored yet. Whole-frame delivery now hands
    // telemetry over promptly (as a real link would), so by the end of a
    // 1030-param sync the sag has already floored at 13.8 and no further drop
    // is observable. Sampling the live telemetry directly keeps the intent
    // (voltage sags tick-over-tick) without depending on delivery bunching.
    await sleep(dynamicCadenceMs * 2)
    const initialVoltage = runtime.getSnapshot().liveVerification.batteryTelemetry.voltageV ?? 0
    assert.ok(initialVoltage > 0, 'battery voltage should be reported on the initial frame')

    // A few more ticks, still comfortably before the sag floor.
    await sleep(dynamicCadenceMs * 4)

    const sag = runtime.getSnapshot().liveVerification.batteryTelemetry.voltageV ?? 0
    assert.ok(
      sag < initialVoltage,
      `Battery voltage should sag with dynamic cadence. initial=${initialVoltage} after=${sag}`
    )
  } finally {
    await runtime.disconnect().catch(() => {})
    runtime.destroy()
  }
})

test('battery sag floors at the critical threshold and emits the matching STATUSTEXTs', async () => {
  const scenario = createArduCopterMockScenario({ dynamicCadenceMs: 20 })
  const transport = new MockTransport('dynamic-mock-floor', {
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

  try {
    await runtime.connect()
    await runtime.requestParameterList({ timeoutMs: 500 })
    await runtime.waitForParameterSync({ timeoutMs: 2500 })

    // Drive the state machine well past the sag floor.
    await sleep(700)

    const snapshot = runtime.getSnapshot()
    const finalVoltage = snapshot.liveVerification.batteryTelemetry.voltageV ?? 0
    const criticalThresholdV = snapshot.parameters.find((parameter) => parameter.id === 'BATT_CRT_VOLT')?.value ?? 13.8

    assert.ok(
      finalVoltage >= criticalThresholdV - 0.01,
      `Voltage must floor at BATT_CRT_VOLT (${criticalThresholdV}). Saw ${finalVoltage}.`
    )
    assert.ok(finalVoltage > 0, 'Voltage must stay positive after landing.')

    const statusTexts = snapshot.statusTexts.map((entry) => entry.text)
    assert.ok(
      statusTexts.some((text) => /battery 1 low/i.test(text)),
      `Expected a battery-low STATUSTEXT. Saw: ${JSON.stringify(statusTexts)}`
    )
    assert.ok(
      statusTexts.some((text) => /battery 1 critical/i.test(text)),
      `Expected a battery-critical STATUSTEXT. Saw: ${JSON.stringify(statusTexts)}`
    )
    assert.ok(
      statusTexts.some((text) => /landed safely/i.test(text)),
      `Expected a landing STATUSTEXT. Saw: ${JSON.stringify(statusTexts)}`
    )
  } finally {
    await runtime.disconnect().catch(() => {})
    runtime.destroy()
  }
})

test('EKF action transition emits the expected STATUSTEXT once', async () => {
  const scenario = createArduCopterMockScenario({ dynamicCadenceMs: 20 })
  const transport = new MockTransport('dynamic-mock-ekf', {
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

  try {
    await runtime.connect()
    await runtime.requestParameterList({ timeoutMs: 500 })
    await runtime.waitForParameterSync({ timeoutMs: 2500 })

    await sleep(500)

    const statusTexts = runtime.getSnapshot().statusTexts.map((entry) => entry.text)
    const ekfFires = statusTexts.filter((text) => /EKF variance: FS_EKF_ACTION/.test(text))
    assert.equal(
      ekfFires.length,
      1,
      `Expected exactly one EKF-fire STATUSTEXT. Saw ${ekfFires.length} in ${JSON.stringify(statusTexts)}`
    )
    assert.ok(
      statusTexts.some((text) => /EKF variance cleared/i.test(text)),
      `Expected an EKF-clear STATUSTEXT. Saw: ${JSON.stringify(statusTexts)}`
    )
  } finally {
    await runtime.disconnect().catch(() => {})
    runtime.destroy()
  }
})

test('RC link blip toggles rcInput.verified and recovers', async () => {
  const scenario = createArduCopterMockScenario({ dynamicCadenceMs: 20 })
  const transport = new MockTransport('dynamic-mock-rc', {
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

  try {
    await runtime.connect()
    await runtime.requestParameterList({ timeoutMs: 500 })
    await runtime.waitForParameterSync({ timeoutMs: 2500 })

    await sleep(500)

    const statusTexts = runtime.getSnapshot().statusTexts.map((entry) => entry.text)
    assert.ok(
      statusTexts.some((text) => /RC link lost/i.test(text)),
      `Expected an RC-link-lost STATUSTEXT. Saw: ${JSON.stringify(statusTexts)}`
    )
    assert.ok(
      statusTexts.some((text) => /RC link recovered/i.test(text)),
      `Expected an RC-link-recovered STATUSTEXT. Saw: ${JSON.stringify(statusTexts)}`
    )
    // After the blip we expect the runtime to be back to a verified link.
    assert.equal(runtime.getSnapshot().liveVerification.rcInput.verified, true)
  } finally {
    await runtime.disconnect().catch(() => {})
    runtime.destroy()
  }
})

test('ArduPlane mock scenario is detected as a Plane and swaps the catalog', async () => {
  const scenario = createArduPlaneMockScenario()
  const transport = new MockTransport('mock-arduplane', {
    initialFrames: scenario.initialFrames,
    respondToOutbound: scenario.respondToOutbound,
    dynamicEmitter: scenario.attachDynamicEmitter,
    frameIntervalMs: 1,
    responseDelayMs: 1,
    chunkSize: 0
  })
  const runtime = new ArduPilotConfiguratorRuntime(
    new MavlinkSession(transport, new MavlinkV2Codec()),
    arducopterMetadata,
    {
      metadataByVehicle: {
        ArduCopter: arducopterMetadata,
        ArduPlane: arduplaneMetadata
      }
    }
  )

  try {
    await runtime.connect()
    const vehicle = await runtime.waitForVehicle({ timeoutMs: 500 })
    assert.equal(vehicle.vehicle, 'ArduPlane')

    await runtime.requestParameterList({ timeoutMs: 500 })
    // Plane carries the copter base params + the mirrored OSD2-4 layout + its
    // own fixed-wing family, and this test also swaps the metadata catalog
    // mid-sync, so it needs a little more headroom than the copter cases.
    await runtime.waitForParameterSync({ timeoutMs: 3000 })

    const active = runtime.getActiveMetadata()
    assert.equal(active.firmware, 'ArduPlane')

    // The Plane mock seeds Q_ENABLE + Plane failsafe params; they should
    // be present in the synced snapshot.
    const params = runtime.getSnapshot().parameters
    const byId = new Map(params.map((p) => [p.id, p.value]))
    assert.equal(byId.get('Q_ENABLE'), 1)
    assert.equal(byId.get('FS_LONG_ACTN'), 1)
  } finally {
    await runtime.disconnect().catch(() => {})
    runtime.destroy()
  }
})

function sleep(durationMs) {
  return new Promise((resolve) => setTimeout(resolve, durationMs))
}
