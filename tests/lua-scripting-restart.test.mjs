// Restarting onboard Lua scripting without rebooting the flight controller.
//
// ArduPilot asks for exactly this whenever a script changes on disk (it emits a
// "restart scripting" STATUSTEXT), but the only control the app offered was a
// full reboot — which drops the link, re-runs every startup check and re-syncs
// the whole parameter table to achieve the same thing.
//
// The command id and the enum values are the whole risk here: a wrong param1
// silently does nothing (AP_Scripting returns DENIED or UNSUPPORTED rather than
// failing loudly), so they are asserted against the values read out of
// AP_Scripting.cpp and ardupilotmega.xml.

import assert from 'node:assert/strict'
import test from 'node:test'

import { ArduPilotConfiguratorRuntime } from '../packages/ardupilot-core/dist/index.js'
import { arducopterMetadata } from '../packages/param-metadata/dist/index.js'
import { MAV_RESULT } from '../packages/protocol-mavlink/dist/index.js'

/** MAV_CMD_SCRIPTING, ardupilotmega.xml. */
const MAV_CMD_SCRIPTING = 42701

function createScriptingSession(sent) {
  const statusListeners = []
  const messageListeners = []

  const emit = (message) =>
    messageListeners.forEach((listener) =>
      listener({ header: { systemId: 1, componentId: 1, sequence: 0 }, message, timestampMs: Date.now() })
    )

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
      emit({
        type: 'HEARTBEAT',
        autopilot: 3,
        vehicleType: 2,
        baseMode: 0,
        customMode: 0,
        systemStatus: 4,
        mavlinkVersion: 3
      })
    },
    async disconnect() {
      statusListeners.forEach((listener) => listener({ kind: 'disconnected', reason: 'test' }))
    },
    destroy() {},
    async send(message) {
      sent.push(message)
      if (message.command === MAV_CMD_SCRIPTING) {
        emit({
          type: 'COMMAND_ACK',
          command: MAV_CMD_SCRIPTING,
          result: MAV_RESULT.ACCEPTED,
          progress: 0,
          resultParam2: 0,
          targetSystem: 1,
          targetComponent: 1
        })
      }
    }
  }
}

async function withRuntime(run) {
  const sent = []
  const runtime = new ArduPilotConfiguratorRuntime(createScriptingSession(sent), arducopterMetadata)
  try {
    await runtime.connect()
    await run(runtime, sent)
  } finally {
    await runtime.disconnect().catch(() => {})
    runtime.destroy()
  }
}

test('restartScripting sends MAV_CMD_SCRIPTING with STOP_AND_RESTART (3)', async () => {
  await withRuntime(async (runtime, sent) => {
    await runtime.restartScripting()
    const command = sent.find((message) => message.command === MAV_CMD_SCRIPTING)
    assert.ok(command, 'a MAV_CMD_SCRIPTING (42701) command was sent')
    // AP_Scripting.cpp: SCRIPTING_CMD_STOP_AND_RESTART sets _restart = true.
    assert.equal(command.params[0], 3, 'param1 must be SCRIPTING_CMD_STOP_AND_RESTART')
  })
})

test('stopScripting sends MAV_CMD_SCRIPTING with STOP (2)', async () => {
  await withRuntime(async (runtime, sent) => {
    await runtime.stopScripting()
    const command = sent.find((message) => message.command === MAV_CMD_SCRIPTING)
    assert.ok(command, 'a MAV_CMD_SCRIPTING (42701) command was sent')
    // SCRIPTING_CMD_STOP sets _stop = true WITHOUT _restart.
    assert.equal(command.params[0], 2, 'param1 must be SCRIPTING_CMD_STOP')
  })
})

test('neither command reboots the flight controller', async () => {
  // The entire point: a reboot drops the link and re-syncs the parameter table.
  await withRuntime(async (runtime, sent) => {
    await runtime.restartScripting()
    await runtime.stopScripting()
    const reboots = sent.filter((message) => message.command === 246) // PREFLIGHT_REBOOT_SHUTDOWN
    assert.deepEqual(reboots, [], 'no PREFLIGHT_REBOOT_SHUTDOWN may be sent')
  })
})

test('the REPL commands are not exposed — AP_Scripting refuses them', async () => {
  // REPL_START (0) and REPL_STOP (1) both return MAV_RESULT_DENIED in
  // AP_Scripting.cpp's handler, so offering them would be a button that always
  // fails. The runtime exposes only the two the firmware accepts.
  assert.equal(typeof ArduPilotConfiguratorRuntime.prototype.restartScripting, 'function')
  assert.equal(typeof ArduPilotConfiguratorRuntime.prototype.stopScripting, 'function')
  assert.equal(ArduPilotConfiguratorRuntime.prototype.startScriptingRepl, undefined)
})
