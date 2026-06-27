import assert from 'node:assert/strict'
import test from 'node:test'

import { ArduPilotConfiguratorRuntime } from '../packages/ardupilot-core/dist/index.js'
import { arducopterMetadata } from '../packages/param-metadata/dist/index.js'
import { MAV_PARAM_TYPE } from '../packages/protocol-mavlink/dist/index.js'

// Field regression: a real batch write (199 params) failed mid-way on COMPASS_USE
// with "Parameter writes require a completed parameter sync" and could not roll
// back, leaving 107 changes on the vehicle. Cause: a param in the batch toggled a
// feature, so the FC echoed a HIGHER param_count; the runtime then saw
// downloaded < total and reverted sync status complete -> streaming, which blocks
// every subsequent write AND the rollback. Once synced, a passive PARAM_VALUE
// echo must keep status 'complete'.
function createCountBumpSession(sentMessages) {
  const statusListeners = []
  const messageListeners = []
  let connected = false
  const baseParams = ['EKF_ENABLE', 'COMPASS_USE', 'ATC_RAT_RLL_P']
  const values = { EKF_ENABLE: 0, COMPASS_USE: 1, ATC_RAT_RLL_P: 0.135 }
  let extra = 0 // becomes 1 after EKF_ENABLE=1 — simulates a new param appearing

  const emit = (message) =>
    messageListeners.forEach((listener) =>
      listener({ header: { systemId: 1, componentId: 1, sequence: 0 }, message, timestampMs: Date.now() })
    )
  const count = () => baseParams.length + extra

  return {
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
      emit({ type: 'HEARTBEAT', autopilot: 3, vehicleType: 2, baseMode: 0, customMode: 0, systemStatus: 4, mavlinkVersion: 3 })
    },
    async disconnect() {
      connected = false
      statusListeners.forEach((listener) => listener({ kind: 'disconnected', reason: 'test disconnect' }))
    },
    destroy() {},
    async send(message) {
      sentMessages.push(message)
      if (message.type === 'PARAM_REQUEST_LIST') {
        baseParams.forEach((paramId, index) =>
          emit({
            type: 'PARAM_VALUE',
            paramId,
            paramValue: values[paramId],
            paramType: MAV_PARAM_TYPE.REAL32,
            paramCount: count(),
            paramIndex: index
          })
        )
        return
      }
      if (message.type === 'PARAM_SET') {
        values[message.paramId] = message.paramValue
        // Enabling a subsystem grows the FC's parameter table.
        if (message.paramId === 'EKF_ENABLE' && message.paramValue === 1) {
          extra = 1
        }
        emit({
          type: 'PARAM_VALUE',
          paramId: message.paramId,
          paramValue: message.paramValue,
          paramType: MAV_PARAM_TYPE.REAL32,
          paramCount: count(),
          paramIndex: 0
        })
      }
    }
  }
}

test('a batch write that bumps the FC param_count keeps sync complete (no mid-batch block, no orphaned rollback)', async () => {
  const sentMessages = []
  const session = createCountBumpSession(sentMessages)
  const runtime = new ArduPilotConfiguratorRuntime(session, arducopterMetadata)
  try {
    await runtime.connect()
    await runtime.requestParameterList({ timeoutMs: 200 })
    await runtime.waitForParameterSync({ timeoutMs: 200 })
    assert.equal(runtime.getSnapshot().parameterStats.status, 'complete')

    // EKF_ENABLE=1 makes the FC advertise one more param; COMPASS_USE is written
    // right after — it must NOT be blocked by a spurious "sync incomplete".
    const result = await runtime.setParameters(
      [
        { paramId: 'EKF_ENABLE', paramValue: 1 },
        { paramId: 'COMPASS_USE', paramValue: 0 }
      ],
      { verifyTimeoutMs: 200 }
    )

    assert.equal(result.applied.length, 2, 'both writes applied — the count bump did not block the second')
    assert.equal(result.rolledBack.length, 0, 'no failure, so no rollback')
    // Status stays complete even though the FC now advertises one extra param.
    assert.equal(runtime.getSnapshot().parameterStats.status, 'complete')
  } finally {
    await runtime.disconnect().catch(() => {})
    runtime.destroy()
  }
})
