// Updating the bootloader over MAVLink (MAV_CMD_FLASH_BOOTLOADER).
//
// The command id and the magic number are the entire risk surface: ArduPilot
// answers "Magic not set" + FAILED for any param5 other than 290876, and an
// unrecognised command id is simply UNSUPPORTED. Both fail in ways that look
// like "nothing happened" rather than an obvious error, so they are asserted
// against the values read out of GCS_Common.cpp and ardupilotmega.xml.
//
// This re-flashes the bootloader image embedded in the RUNNING firmware — it
// is not a file upload, and it must NOT reboot the vehicle by itself.

import assert from 'node:assert/strict'
import test from 'node:test'

import { ArduPilotConfiguratorRuntime } from '../packages/ardupilot-core/dist/index.js'
import { arducopterMetadata } from '../packages/param-metadata/dist/index.js'
import { MAV_CMD, MAV_RESULT } from '../packages/protocol-mavlink/dist/index.js'

/** ardupilotmega.xml entry value="42650". */
const MAV_CMD_FLASH_BOOTLOADER = 42650
/** GCS_Common.cpp: `if (packet.x != 290876) { "Magic not set"; FAILED }`. */
const FLASH_BOOTLOADER_MAGIC = 290876

function createSession(sent, { result = MAV_RESULT.ACCEPTED } = {}) {
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
      if (message.command === MAV_CMD_FLASH_BOOTLOADER) {
        emit({
          type: 'COMMAND_ACK',
          command: MAV_CMD_FLASH_BOOTLOADER,
          result,
          progress: 0,
          resultParam2: 0,
          targetSystem: 1,
          targetComponent: 1
        })
      }
    }
  }
}

async function withRuntime(run, options) {
  const sent = []
  const runtime = new ArduPilotConfiguratorRuntime(createSession(sent, options), arducopterMetadata)
  try {
    await runtime.connect()
    await run(runtime, sent)
  } finally {
    await runtime.disconnect().catch(() => {})
    runtime.destroy()
  }
}

test('the command id matches ardupilotmega.xml', () => {
  assert.equal(MAV_CMD.FLASH_BOOTLOADER, MAV_CMD_FLASH_BOOTLOADER)
})

test('flashBootloader sends the 290876 magic in param5', async () => {
  await withRuntime(async (runtime, sent) => {
    await runtime.flashBootloader()
    const command = sent.find((message) => message.command === MAV_CMD_FLASH_BOOTLOADER)
    assert.ok(command, 'a MAV_CMD_FLASH_BOOTLOADER (42650) command was sent')
    // params[4] is param5, which the autopilot reads as COMMAND_INT `x`.
    // Anything else gets "Magic not set" and FAILED.
    assert.equal(command.params[4], FLASH_BOOTLOADER_MAGIC)
  })
})

test('every other parameter is empty, per the command definition', async () => {
  await withRuntime(async (runtime, sent) => {
    await runtime.flashBootloader()
    const command = sent.find((message) => message.command === MAV_CMD_FLASH_BOOTLOADER)
    assert.deepEqual(command.params, [0, 0, 0, 0, FLASH_BOOTLOADER_MAGIC, 0, 0])
  })
})

test('it does not reboot the vehicle by itself', async () => {
  // A reboot here would drop the link mid-write. The operator reboots after.
  await withRuntime(async (runtime, sent) => {
    await runtime.flashBootloader()
    const reboots = sent.filter((message) => message.command === 246)
    assert.deepEqual(reboots, [], 'no PREFLIGHT_REBOOT_SHUTDOWN may be sent')
  })
})

test('a refusing autopilot surfaces as a rejection, not a silent success', async () => {
  // A build without AP_BOOTLOADER_FLASHING_ENABLED answers UNSUPPORTED, and a
  // wrong magic answers FAILED. Either must reach the operator.
  await withRuntime(
    async (runtime) => {
      await assert.rejects(() => runtime.flashBootloader())
    },
    { result: MAV_RESULT.UNSUPPORTED }
  )
})
