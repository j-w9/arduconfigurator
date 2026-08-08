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
/** common.xml MAV_CMD_PREFLIGHT_STORAGE. */
const PREFLIGHT_STORAGE = 245

function createSession(sent, { result = MAV_RESULT.ACCEPTED, answer = true, armed = false } = {}) {
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
        // MAV_MODE_FLAG_SAFETY_ARMED = 128.
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
      if (message.type !== 'COMMAND_LONG') return
      sent.push(message)
      // Both commands under test are acked; everything else the runtime emits
      // on connect (SET_MESSAGE_INTERVAL, the pre-arm poll) is recorded and
      // ignored, which is why assertions filter `sent` by command rather than
      // counting it.
      if ((message.command === PREFLIGHT_REBOOT_SHUTDOWN || message.command === PREFLIGHT_STORAGE) && answer) {
        emit({
          type: 'COMMAND_ACK',
          command: message.command,
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
const storageCommands = (sent) => sent.filter((message) => message.command === PREFLIGHT_STORAGE)

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

// ── Armed guards ──────────────────────────────────────────────────────────
//
// ArduPilot guards every OTHER branch of handle_preflight_reboot against an
// armed vehicle, but the DFU branch returns before that check is ever reached
// (GCS_Common.cpp: the param4==99 case is inside the magic block at :3520-3644,
// the armed refusal is at :3646). So for this one command the firmware is not a
// backstop and the guard has to be ours.

test('rebootToDfu refuses while armed — the firmware will not refuse it for us', async () => {
  await withRuntime(
    async (runtime, sent) => {
      await assert.rejects(() => runtime.rebootToDfu(), /Disarm the vehicle/i)
      assert.equal(rebootCommands(sent).length, 0, 'nothing reached the wire')
    },
    { armed: true }
  )
})

test('rebootToBootloader refuses while armed', async () => {
  // ArduPilot does refuse param1=3 when armed; this turns a bare FAILED ack
  // into a sentence and keeps the two entry points behaving alike.
  await withRuntime(
    async (runtime, sent) => {
      await assert.rejects(() => runtime.rebootToBootloader(), /Disarm the vehicle/i)
      assert.equal(rebootCommands(sent).length, 0)
    },
    { armed: true }
  )
})

test('resetParametersToDefaults refuses while armed, but not merely because sync is incomplete', async () => {
  // AP_Param::erase_all() on an armed vehicle wipes the tuning it is flying on,
  // and ArduPilot's PREFLIGHT_STORAGE handler has no armed check of its own.
  //
  // The second half of the name matters: this deliberately does NOT use the
  // full parameter-write gate, which also demands a completed sync. Resetting
  // to defaults is the recovery for a board too broken to finish syncing — the
  // disarmed case below proves it still goes out under exactly that condition.
  await withRuntime(
    async (runtime, sent) => {
      await assert.rejects(() => runtime.resetParametersToDefaults(), /Disarm the vehicle/i)
      assert.equal(storageCommands(sent).length, 0, 'nothing reached the wire')
    },
    { armed: true }
  )
})

test('resetParametersToDefaults still works on a board that never completed a parameter sync', async () => {
  // The Neros case that prompted the Flash-tab button: a board misbehaving
  // badly enough that the operator wants defaults back. Neither harness here
  // runs a parameter sync, so this is that condition.
  await withRuntime(async (runtime, sent) => {
    await runtime.resetParametersToDefaults()
    const [command] = storageCommands(sent)
    assert.ok(command, 'PREFLIGHT_STORAGE was sent')
    assert.equal(command.params[0], 2, 'PARAM_RESET_FACTORY_DEFAULT')
  })
})
