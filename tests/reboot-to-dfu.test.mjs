// Rebooting into the STM32 ROM DFU bootloader, as distinct from ArduPilot's own.
//
// Reported by an operator: the Flash tab's "Activate Bootloader (DFU)" button
// does not put the board in DFU. It never did — param1=3 is
// "reboot-to-bootloader" and holds the board in ArduPilot's serial bootloader
// (GCS_Common.cpp:3680, `hold_in_bootloader = is_equal(packet.param1, 3.0f)`).
// The operator needed real DFU to recover a board and had to reach for another
// configurator to get it.
//
// Real DFU is a separate, magic-guarded branch of the same command:
// GCS_Common.cpp handle_preflight_reboot only reaches its param4==99 DFU case
// inside `if (param1 == 42 && param2 == 24 && param3 == 71)`. Everything about
// this test is about pinning those four numbers and the three distinguishable
// answers, because every failure mode here otherwise looks like "nothing
// happened".

import assert from 'node:assert/strict'
import test from 'node:test'

import { ArduPilotConfiguratorRuntime } from '../packages/ardupilot-core/dist/index.js'
import { arducopterMetadata } from '../packages/param-metadata/dist/index.js'
import { MAV_CMD, MAV_RESULT } from '../packages/protocol-mavlink/dist/index.js'

/** common.xml MAV_CMD_PREFLIGHT_REBOOT_SHUTDOWN. */
const PREFLIGHT_REBOOT_SHUTDOWN = 246

function createSession(sent, { result = MAV_RESULT.ACCEPTED, answer = true } = {}) {
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
      if (message.type !== 'COMMAND_LONG') return
      sent.push(message)
      if (message.command === PREFLIGHT_REBOOT_SHUTDOWN && answer) {
        emit({
          type: 'COMMAND_ACK',
          command: PREFLIGHT_REBOOT_SHUTDOWN,
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

const rebootCommands = (sent) => sent.filter((message) => message.command === PREFLIGHT_REBOOT_SHUTDOWN)

test('rebootToDfu sends the 42/24/71/99 magic ArduPilot gates the DFU branch behind', async () => {
  await withRuntime(async (runtime, sent) => {
    await runtime.rebootToDfu()
    const [command] = rebootCommands(sent)
    assert.ok(command, 'a PREFLIGHT_REBOOT_SHUTDOWN was sent')
    assert.equal(command.command, MAV_CMD.PREFLIGHT_REBOOT_SHUTDOWN)
    // Any other value for the first three and the handler never even looks at
    // param4 — it falls straight through to the param1 must-be-1-or-3 check.
    assert.deepEqual(command.params.slice(0, 4), [42, 24, 71, 99])
  })
})

test('rebootToBootloader stays param1=3 — it is a different mode, not a synonym', async () => {
  // The whole bug was these two being conflated. Asserting them together is
  // what stops a future "simplification" merging them back.
  await withRuntime(async (runtime, sent) => {
    await runtime.rebootToBootloader()
    const [command] = rebootCommands(sent)
    assert.equal(command.params[0], 3)
    assert.notDeepEqual(command.params.slice(0, 4), [42, 24, 71, 99])
  })
})

test('UNSUPPORTED is reported as "this firmware was not built with DFU support"', async () => {
  // The common answer: ENABLE_DFU_BOOT defaults off in hwdef, the magic block
  // is compiled out, and the fall-through param1 check rejects param1=42.
  // "Command rejected" would leave the operator with nothing to do next.
  await withRuntime(
    async (runtime) => {
      await assert.rejects(() => runtime.rebootToDfu(), /not built with DFU support/i)
    },
    { result: MAV_RESULT.UNSUPPORTED }
  )
})

test('FAILED is reported as the signed-firmware refusal', async () => {
  await withRuntime(
    async (runtime) => {
      await assert.rejects(() => runtime.rebootToDfu(), /signed\) firmware blocks it/i)
    },
    { result: MAV_RESULT.FAILED }
  )
})

test('an unanswered request fails rather than silently claiming success', async () => {
  // Deliberately waits out the real 3s ack timeout: the point is that silence
  // resolves as a rejection, and shortening it would mean not testing the path
  // that actually runs. The rejection comes from the ack waiter, which names
  // the command — more useful than anything this method could add.
  await withRuntime(
    async (runtime) => {
      await assert.rejects(() => runtime.rebootToDfu(), /Timed out waiting for PREFLIGHT_REBOOT_SHUTDOWN/i)
    },
    { answer: false }
  )
})
