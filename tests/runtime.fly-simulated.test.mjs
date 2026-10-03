import assert from 'node:assert/strict'
import test from 'node:test'

import { ArduPilotConfiguratorRuntime } from '../packages/ardupilot-core/dist/index.js'
import { arducopterMetadata } from '../packages/param-metadata/dist/index.js'
import { MAV_AUTOPILOT, MAV_TYPE } from '../packages/protocol-mavlink/dist/index.js'

/*
 * This app configures aircraft; it does not fly them. The simulator is the one
 * exception, because its "aircraft" is a WebAssembly module in the same tab.
 *
 * The guard that makes that true lives on the runtime, not on the view that
 * draws the buttons -- a control that is merely not rendered is not a safety
 * property. These tests are that guard: a runtime built for anything other
 * than a local vehicle must refuse to arm, to change mode, or to take off,
 * and must send nothing at all when it refuses.
 */

const COMPONENT_ARM_DISARM = 400
const NAV_TAKEOFF = 22
const DO_SET_MODE = 176

function createSession(sent) {
  const statusListeners = []
  const messageListeners = []
  let connected = false
  return {
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
    },
    async disconnect() {
      connected = false
      statusListeners.forEach((listener) => listener({ kind: 'disconnected', reason: 'test' }))
    },
    destroy() {},
    async send(message) {
      sent.push(message)
      // Acknowledge anything that asks, so the command helpers resolve.
      if (message?.type === 'COMMAND_LONG') {
        queueMicrotask(() =>
          messageListeners.forEach((listener) =>
            listener({
              header: { systemId: 1, componentId: 1, sequence: 0 },
              message: { type: 'COMMAND_ACK', command: message.command, result: 0 },
              timestampMs: Date.now()
            })
          )
        )
      }
    },
    inject(envelope) {
      messageListeners.forEach((listener) => listener(envelope))
    }
  }
}

function heartbeat() {
  return {
    header: { systemId: 1, componentId: 1, sequence: 0 },
    message: {
      type: 'HEARTBEAT',
      autopilot: MAV_AUTOPILOT.ARDUPILOTMEGA,
      vehicleType: MAV_TYPE.QUADROTOR,
      baseMode: 0,
      customMode: 0,
      systemStatus: 4,
      mavlinkVersion: 3
    },
    timestampMs: Date.now()
  }
}

async function withRuntime(options, run) {
  const sent = []
  const session = createSession(sent)
  const runtime = new ArduPilotConfiguratorRuntime(session, arducopterMetadata, options)
  try {
    await runtime.connect()
    session.inject(heartbeat())
    await runtime.waitForVehicle({ timeoutMs: 500 }).catch(() => {})
    // The connect-time SET_MESSAGE_INTERVAL burst is fired unawaited from the
    // heartbeat handler, so it has to be allowed to land before the buffer is
    // cleared -- otherwise it arrives afterwards and looks like our traffic.
    await new Promise((resolve) => setTimeout(resolve, 80))
    sent.length = 0
    await run(runtime, sent)
  } finally {
    await runtime.disconnect().catch(() => {})
  }
}

const commands = (sent) =>
  sent.filter((message) => message?.type === 'COMMAND_LONG').map((message) => message.command)

test('a vehicle on a real link refuses to be flown', async () => {
  // The failure this prevents: a configurator connected to an aircraft on a
  // bench, with someone's hands near the propellers, arming it.
  for (const options of [undefined, {}, { localVehicle: false }]) {
    await withRuntime(options, async (runtime, sent) => {
      await assert.rejects(() => runtime.armSimulatedVehicle(true), /simulated vehicle/)
      await assert.rejects(() => runtime.setSimulatedFlightMode(4), /simulated vehicle/)
      await assert.rejects(() => runtime.takeOffSimulatedVehicle(10), /simulated vehicle/)
      assert.deepEqual(commands(sent), [], 'a refusal must not put anything on the wire')
    })
  }
})

test('a vehicle running in this tab arms, changes mode and takes off', async () => {
  await withRuntime({ localVehicle: true }, async (runtime, sent) => {
    await runtime.setSimulatedFlightMode(4)
    await runtime.armSimulatedVehicle(true)
    await runtime.takeOffSimulatedVehicle(12)
    assert.deepEqual(commands(sent), [DO_SET_MODE, COMPONENT_ARM_DISARM, NAV_TAKEOFF])
  })
})

test('the commands carry what ArduPilot reads them by', async () => {
  await withRuntime({ localVehicle: true }, async (runtime, sent) => {
    await runtime.setSimulatedFlightMode(4)
    await runtime.armSimulatedVehicle(true)
    await runtime.takeOffSimulatedVehicle(12)
    await runtime.armSimulatedVehicle(false)

    const byCommand = new Map(
      sent.filter((m) => m?.type === 'COMMAND_LONG').map((m) => [`${m.command}:${m.params[0]}`, m.params])
    )

    // param1 is MAV_MODE_FLAG_CUSTOM_MODE_ENABLED, without which ArduPilot
    // reads param2 as a generic MAVLink mode rather than one of its own.
    assert.equal(byCommand.get(`${DO_SET_MODE}:1`)?.[0], 1)
    assert.equal(byCommand.get(`${DO_SET_MODE}:1`)?.[1], 4, 'GUIDED')

    assert.equal(byCommand.get(`${COMPONENT_ARM_DISARM}:1`)?.[0], 1, 'arm')
    assert.equal(byCommand.get(`${COMPONENT_ARM_DISARM}:0`)?.[0], 0, 'disarm')
    // Never force-arm: 21196 in param2 skips the pre-arm checks, and the whole
    // point of flying the simulator is to exercise what a real vehicle does.
    assert.notEqual(byCommand.get(`${COMPONENT_ARM_DISARM}:1`)?.[1], 21196)

    // Altitude rides in param7 for NAV_TAKEOFF.
    assert.equal(byCommand.get(`${NAV_TAKEOFF}:0`)?.[6], 12)
  })
})
