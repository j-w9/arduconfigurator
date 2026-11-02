// The raw-frame feed behind the CAN bus monitor, and the guard that keeps
// plain CAN out of the DroneCAN decoder now that both share the monitor.

import assert from 'node:assert/strict'
import test from 'node:test'

import { CanBusService } from '../packages/ardupilot-core/dist/runtime-can-bus-service.js'
import {
  MavlinkV2Codec,
  dronecanBuildBroadcastFrames,
  encodeDronecanNodeStatus,
  DRONECAN_NODE_STATUS_DT_ID,
  DRONECAN_NODE_STATUS_SIGNATURE
} from '../packages/protocol-mavlink/dist/index.js'

function activeService() {
  const sends = []
  const service = new CanBusService({
    session: { send: async (message) => sends.push(message) },
    emit: () => {},
    appendStatusEntry: () => {},
    getTargetSystem: () => 1,
    getTargetComponent: () => 1
  })
  service.status = 'active'
  service.bus = 1
  return { service, sends }
}

const canFrame = (id, bytes, bus = 0) => {
  const data = new Uint8Array(8)
  data.set(bytes)
  return { type: 'CAN_FRAME', targetSystem: 0, targetComponent: 0, bus, len: bytes.length, id: id >>> 0, data }
}

function nodeStatusFrame(nodeId) {
  const [frame] = dronecanBuildBroadcastFrames(
    { messageTypeId: DRONECAN_NODE_STATUS_DT_ID, signature: DRONECAN_NODE_STATUS_SIGNATURE, sourceNodeId: nodeId, transferId: 0 },
    encodeDronecanNodeStatus({ uptimeSec: 5, health: 0, mode: 0, subMode: 0, vendorSpecificStatusCode: 0 })
  )
  return { canId: frame.canId, data: frame.data }
}

test('every forwarded frame reaches subscribers, with flags unpacked and the bus made 1-based', () => {
  const { service } = activeService()
  const seen = []
  const unsubscribe = service.onFrame((frame) => seen.push(frame))
  service.processCanFrame(canFrame(0x123, [1, 2, 3]))
  service.processCanFrame(canFrame(0x80000000 | 0x1e0a3c7f, [9], 1))
  assert.equal(seen.length, 2)
  assert.deepEqual(
    { id: seen[0].id, extended: seen[0].extended, bus: seen[0].bus, direction: seen[0].direction, data: [...seen[0].data] },
    { id: 0x123, extended: false, bus: 1, direction: 'rx', data: [1, 2, 3] }
  )
  assert.equal(seen[1].extended, true)
  assert.equal(seen[1].bus, 2, 'wire bus 1 is CAN2')
  unsubscribe()
  service.processCanFrame(canFrame(0x124, [1]))
  assert.equal(seen.length, 2, 'unsubscribed listeners hear nothing more')
})

test('CAN FD frames reach subscribers as FD, with their full payload', () => {
  const { service } = activeService()
  const seen = []
  service.onFrame((frame) => seen.push(frame))
  const data = new Uint8Array(64)
  data.set(Array.from({ length: 16 }, (_unused, index) => index))
  service.processCanFdFrame({ type: 'CANFD_FRAME', targetSystem: 0, targetComponent: 0, bus: 0, len: 16, id: 0x321, data })
  assert.equal(seen.length, 1)
  assert.equal(seen[0].fd, true)
  assert.equal(seen[0].data.length, 16)
  assert.equal(seen[0].data[15], 15)
})

test('frames this service sends are reported as TX', async () => {
  const { service, sends } = activeService()
  const seen = []
  service.onFrame((frame) => seen.push(frame))
  service.nodes.set(125, {
    nodeId: 125,
    health: 'unknown',
    mode: 'unknown',
    parameters: [],
    paramFetch: { status: 'idle', nextIndex: 0 },
    firstSeenAtMs: 0,
    lastSeenAtMs: 0
  })
  await service.writeParameter(125, 'X', { tag: 'int64', int64: '0' })
  assert.ok(sends.length > 0)
  const tx = seen.filter((frame) => frame.direction === 'tx')
  assert.equal(tx.length, sends.length, 'one TX frame per CAN_FRAME sent')
  assert.equal(tx[0].extended, true)
  assert.equal(tx[0].bus, 1)
})

test('plain CAN never reaches the DroneCAN decoder; a real NodeStatus still does', () => {
  const { service } = activeService()
  const status = nodeStatusFrame(42)
  // The same 29 bits, but sent as a standard frame (no EFF flag) -- what a
  // plain-CAN device sharing the bus can look like. It must not invent node 42.
  service.processCanFrame(canFrame(status.canId & 0x7ff, [...status.data]))
  service.processCanFrame(canFrame(0x40000000 | 0x80000000 | status.canId, [...status.data]))
  assert.equal(service.nodes.has(42), false, 'standard and remote frames are not DroneCAN')
  service.processCanFrame(canFrame(0x80000000 | status.canId, [...status.data]))
  assert.equal(service.nodes.has(42), true, 'the extended NodeStatus is decoded as before')
})

test('CANFD_FRAME round-trips through the MAVLink codec', () => {
  const codec = new MavlinkV2Codec()
  const data = new Uint8Array(64)
  data.set([0xde, 0xad, 0xbe, 0xef], 0)
  data[19] = 0x7f
  const bytes = codec.encode({
    header: { systemId: 1, componentId: 1, sequence: 7 },
    message: { type: 'CANFD_FRAME', targetSystem: 255, targetComponent: 190, bus: 1, len: 20, id: 0x80000123, data },
    timestampMs: 0
  })
  const [decoded] = codec.push(bytes)
  assert.equal(decoded.message.type, 'CANFD_FRAME')
  assert.equal(decoded.message.id >>> 0, 0x80000123)
  assert.equal(decoded.message.len, 20)
  assert.equal(decoded.message.bus, 1)
  assert.equal(decoded.message.data[0], 0xde)
  assert.equal(decoded.message.data[19], 0x7f)
})
