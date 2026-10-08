// Formatting the flight controller's SD card over MAVLink.
//
// The command id and the two params are the whole risk: GCS_Common.cpp
// handle_command_storage_format answers UNSUPPORTED unless param1 (storage id)
// and param2 (confirm) are both exactly 1, and the work is asynchronous --
// IN_PROGRESS first, then a concluding ACCEPTED or FAILED.

import assert from 'node:assert/strict'
import test from 'node:test'

import { ArduPilotConfiguratorRuntime } from '../packages/ardupilot-core/dist/index.js'
import { arducopterMetadata } from '../packages/param-metadata/dist/index.js'
import { MAV_RESULT } from '../packages/protocol-mavlink/dist/index.js'

/** MAV_CMD_STORAGE_FORMAT, common.xml. */
const MAV_CMD_STORAGE_FORMAT = 526

function createSession(sent, acks, { armed = false } = {}) {
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
        // MAV_MODE_FLAG_SAFETY_ARMED = 128
        baseMode: armed ? 128 : 0,
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
      if (message.command === MAV_CMD_STORAGE_FORMAT) {
        for (const result of acks) {
          emit({
            type: 'COMMAND_ACK',
            command: MAV_CMD_STORAGE_FORMAT,
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
}

async function withRuntime(acks, run, options) {
  const sent = []
  const runtime = new ArduPilotConfiguratorRuntime(createSession(sent, acks, options), arducopterMetadata)
  try {
    await runtime.connect()
    await run(runtime, sent)
  } finally {
    await runtime.disconnect().catch(() => {})
    runtime.destroy()
  }
}

test('formatStorage sends MAV_CMD_STORAGE_FORMAT with storage 1 and confirm 1', async () => {
  await withRuntime([MAV_RESULT.IN_PROGRESS, MAV_RESULT.ACCEPTED], async (runtime, sent) => {
    assert.equal(await runtime.formatStorage(), 'formatted')
    const command = sent.find((message) => message.command === MAV_CMD_STORAGE_FORMAT)
    assert.ok(command, 'a MAV_CMD_STORAGE_FORMAT (526) command was sent')
    assert.equal(command.params[0], 1, 'param1 must be storage id 1')
    assert.equal(command.params[1], 1, 'param2 must be the confirm flag 1')
  })
})

test('an IN_PROGRESS ack does not settle it: the concluding FAILED is what is reported', async () => {
  await withRuntime([MAV_RESULT.IN_PROGRESS, MAV_RESULT.FAILED], async (runtime) => {
    await assert.rejects(runtime.formatStorage(), /format failed/i)
  })
})

test('an UNSUPPORTED firmware gets a sentence, not a generic rejection', async () => {
  await withRuntime([MAV_RESULT.UNSUPPORTED], async (runtime) => {
    await assert.rejects(runtime.formatStorage(), /cannot format its storage/i)
  })
})

test('it is refused while armed, before anything is sent', async () => {
  await withRuntime(
    [MAV_RESULT.ACCEPTED],
    async (runtime, sent) => {
      await assert.rejects(runtime.formatStorage(), /disarm/i)
      assert.equal(sent.filter((message) => message.command === MAV_CMD_STORAGE_FORMAT).length, 0)
    },
    { armed: true }
  )
})
