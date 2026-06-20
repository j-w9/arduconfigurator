import assert from 'node:assert/strict'
import test from 'node:test'

import { ArduPilotConfiguratorRuntime } from '../packages/ardupilot-core/dist/index.js'
import { arducopterMetadata } from '../packages/param-metadata/dist/index.js'
import { MAV_PARAM_TYPE } from '../packages/protocol-mavlink/dist/index.js'

// Parameter-protocol conformance (mavlink.io/en/services/parameter.html):
// PARAM_SET must carry the same param_type the FC reported in PARAM_VALUE.
// We hardcoded REAL32 on every write; ArduPilot happens to ignore the field
// on set, but byte-wise-encoding implementations and strict routers do not.

function createTypedParamSession(paramTypes, sentMessages) {
  const statusListeners = []
  const messageListeners = []
  let connected = false

  const emit = (message) => {
    messageListeners.forEach((listener) =>
      listener({ header: { systemId: 1, componentId: 1, sequence: 0 }, message, timestampMs: Date.now() })
    )
  }

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
        const entries = Object.entries(paramTypes)
        entries.forEach(([paramId, [paramValue, paramType]], index) => {
          emit({ type: 'PARAM_VALUE', paramId, paramValue, paramType, paramCount: entries.length, paramIndex: index })
        })
        return
      }
      if (message.type === 'PARAM_SET') {
        // ArduPilot echoes the new value with its NATIVE type regardless of
        // what the GCS sent.
        emit({
          type: 'PARAM_VALUE',
          paramId: message.paramId,
          paramValue: message.paramValue,
          paramType: paramTypes[message.paramId]?.[1] ?? MAV_PARAM_TYPE.REAL32,
          paramCount: Object.keys(paramTypes).length,
          paramIndex: 0
        })
      }
    }
  }
}

test('PARAM_SET echoes the param_type the FC reported in PARAM_VALUE', async () => {
  const sentMessages = []
  const session = createTypedParamSession(
    {
      FRAME_CLASS: [1, MAV_PARAM_TYPE.INT8],
      FRAME_TYPE: [1, MAV_PARAM_TYPE.INT8],
      SERIAL1_BAUD: [57, MAV_PARAM_TYPE.INT32],
      ATC_RAT_RLL_P: [0.135, MAV_PARAM_TYPE.REAL32]
    },
    sentMessages
  )
  const runtime = new ArduPilotConfiguratorRuntime(session, arducopterMetadata)
  try {
    await runtime.connect()
    await runtime.requestParameterList({ timeoutMs: 200 })
    await runtime.waitForParameterSync({ timeoutMs: 200 })

    await runtime.setParameter('FRAME_CLASS', 2, { verifyTimeoutMs: 200 })
    await runtime.setParameter('SERIAL1_BAUD', 115, { verifyTimeoutMs: 200 })
    await runtime.setParameter('ATC_RAT_RLL_P', 0.2, { verifyTimeoutMs: 200 })

    const paramSets = sentMessages.filter((message) => message.type === 'PARAM_SET')
    assert.equal(paramSets.length, 3)
    assert.equal(paramSets[0].paramType, MAV_PARAM_TYPE.INT8, 'INT8 param echoes INT8')
    assert.equal(paramSets[1].paramType, MAV_PARAM_TYPE.INT32, 'INT32 param echoes INT32')
    assert.equal(paramSets[2].paramType, MAV_PARAM_TYPE.REAL32, 'REAL32 param echoes REAL32')
  } finally {
    await runtime.disconnect().catch(() => {})
    runtime.destroy()
  }
})
