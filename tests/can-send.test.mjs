// Sending on the forwarded CAN bus: the wire format of what goes out
// (CAN_FRAME / CANFD_FRAME, flag bits, 0-based bus, padded payload), the TX
// echo the bus monitor shows, and the refusals (not forwarding, armed, too long).

import assert from 'node:assert/strict'
import test from 'node:test'

import { ArduPilotConfiguratorRuntime } from '../packages/ardupilot-core/dist/index.js'
import { CanBusService } from '../packages/ardupilot-core/dist/runtime-can-bus-service.js'
import { arducopterMetadata } from '../packages/param-metadata/dist/index.js'

function service({ active = true, bus = 2 } = {}) {
  const sends = []
  const canBus = new CanBusService({
    session: { send: async (message) => sends.push(message) },
    emit: () => {},
    appendStatusEntry: () => {},
    getTargetSystem: () => 1,
    getTargetComponent: () => 1
  })
  if (active) {
    canBus.status = 'active'
    canBus.bus = bus
  }
  return { canBus, sends }
}

test('a classic frame goes out as CAN_FRAME: flags in the id, bus 0-based, payload padded, len exact', async () => {
  const { canBus, sends } = service()
  await canBus.sendFrames([
    { id: 0x123, extended: false, data: Uint8Array.from([1, 2, 3]) },
    { id: 0x1e0a3c7f, extended: true, data: Uint8Array.from([9]) }
  ])
  assert.equal(sends.length, 2)
  assert.equal(sends[0].type, 'CAN_FRAME')
  assert.equal(sends[0].bus, 1, 'CAN2 is wire bus 1')
  assert.equal(sends[0].id, 0x123)
  assert.equal(sends[0].len, 3)
  assert.equal(sends[0].data.length, 8)
  assert.deepEqual([...sends[0].data.subarray(0, 3)], [1, 2, 3])
  assert.equal(sends[1].id, (0x80000000 | 0x1e0a3c7f) >>> 0, 'extended sets the EFF bit')
})

test('an FD frame goes out as CANFD_FRAME with up to 64 bytes', async () => {
  const { canBus, sends } = service()
  await canBus.sendFrames([{ id: 0x321, extended: false, fd: true, data: new Uint8Array(20).fill(7) }])
  assert.equal(sends[0].type, 'CANFD_FRAME')
  assert.equal(sends[0].len, 20)
  assert.equal(sends[0].data.length, 64)
})

test('what is sent is echoed to listeners as TX, so the monitor shows it', async () => {
  const { canBus } = service()
  const seen = []
  canBus.onFrame((frame) => seen.push(frame))
  await canBus.sendFrames([{ id: 0x2a0, extended: false, data: Uint8Array.from([5]) }])
  assert.equal(seen.length, 1)
  assert.deepEqual(
    { id: seen[0].id, direction: seen[0].direction, bus: seen[0].bus, data: [...seen[0].data] },
    { id: 0x2a0, direction: 'tx', bus: 2, data: [5] }
  )
})

test('refused when the bus is not forwarded, or a frame is too long', async () => {
  await assert.rejects(service({ active: false }).canBus.sendFrames([{ id: 1, extended: false, data: new Uint8Array(1) }]), /Connect to the CAN bus/)
  const { canBus, sends } = service()
  await assert.rejects(canBus.sendFrames([{ id: 1, extended: false, data: new Uint8Array(9) }]), /at most 8 bytes/)
  await assert.rejects(canBus.sendFrames([{ id: 1, extended: false, fd: true, data: new Uint8Array(65) }]), /at most 64 bytes/)
  assert.equal(sends.length, 0)
})

test('the runtime refuses to send while armed, before anything reaches the link', async () => {
  const sent = []
  const listeners = []
  const session = {
    getTransportStatus: () => ({ kind: 'connected' }),
    onStatus: () => () => {},
    onMessage(listener) {
      listeners.push(listener)
      return () => {}
    },
    async connect() {
      listeners.forEach((listener) =>
        listener({
          header: { systemId: 1, componentId: 1, sequence: 0 },
          // MAV_MODE_FLAG_SAFETY_ARMED = 128
          message: { type: 'HEARTBEAT', autopilot: 3, vehicleType: 2, baseMode: 128, customMode: 0, systemStatus: 4, mavlinkVersion: 3 },
          timestampMs: Date.now()
        })
      )
    },
    async disconnect() {},
    destroy() {},
    async send(message) {
      sent.push(message)
    }
  }
  const runtime = new ArduPilotConfiguratorRuntime(session, arducopterMetadata)
  try {
    await runtime.connect()
    await assert.rejects(runtime.sendCanFrames([{ id: 0x123, extended: false, data: new Uint8Array(1) }]), /Disarm/)
    assert.equal(sent.filter((message) => message.type === 'CAN_FRAME').length, 0)
  } finally {
    await runtime.disconnect().catch(() => {})
    runtime.destroy()
  }
})
