// Dynamic node ID allocation and node ID changes.
//
// The allocator follows pydronecan's CentralizedServer: a node without an ID
// sends its unique ID anonymously in three parts (6 + 6 + 4 bytes), the
// allocator echoes what it has, then answers the last part with an ID -- the
// one the node had before, else its preference, else the highest free one.

import assert from 'node:assert/strict'
import test from 'node:test'

import { SlcanAdapter } from '../packages/can-core/dist/index.js'
import { AdapterCanBus, createDemoSlcanIo } from '../packages/ardupilot-core/dist/index.js'
import { CanBusService } from '../packages/ardupilot-core/dist/runtime-can-bus-service.js'
import { dronecanCatalogue } from '../packages/dronecan-dsdl/dist/index.js'
import {
  DRONECAN_ALLOCATION_SIGNATURE,
  decodeDronecanAllocation,
  dronecanBuildBroadcastFrames,
  dronecanIsAnonymousAllocationFrame,
  encodeDronecanAllocation,
  dronecanEncodeAnonymousCanId
} from '../packages/protocol-mavlink/dist/index.js'

/** The demo's unallocated node (mock-dronecan uid(77)). */
const DEMO_UID = Array.from({ length: 16 }, (_, index) => (77 * 31 + index * 7) & 0xff)
const hex = (bytes) => bytes.map((byte) => byte.toString(16).padStart(2, '0')).join('')

test('the Allocation codec matches the DSDL', () => {
  const catalogue = dronecanCatalogue()
  const info = catalogue.info('uavcan.protocol.dynamic_node_id.Allocation')
  assert.equal(info.signature, DRONECAN_ALLOCATION_SIGNATURE)
  const value = { node_id: 42, first_part_of_unique_id: true, unique_id: [1, 2, 3, 4, 5, 6] }
  const ours = encodeDronecanAllocation({ nodeId: 42, firstPartOfUniqueId: true, uniqueId: Uint8Array.from([1, 2, 3, 4, 5, 6]) })
  assert.deepEqual([...ours], [...catalogue.encode(info.fullName, 'msg', value)])
  assert.deepEqual(decodeDronecanAllocation(ours), { nodeId: 42, firstPartOfUniqueId: true, uniqueId: Uint8Array.from([1, 2, 3, 4, 5, 6]) })
  assert.ok(dronecanIsAnonymousAllocationFrame(dronecanEncodeAnonymousCanId(24, 1, 0x1abc)))
  assert.ok(!dronecanIsAnonymousAllocationFrame(dronecanEncodeAnonymousCanId(24, 2, 0x1abc)))
})

async function demoBus() {
  const bus = new AdapterCanBus(new SlcanAdapter(createDemoSlcanIo(), { bitrate: 1_000_000, replyTimeoutMs: 20 }))
  await bus.start()
  const until = async (predicate, ms = 6000) => {
    const deadline = Date.now() + ms
    while (!predicate(bus.getSnapshot())) {
      if (Date.now() > deadline) throw new Error(`timed out: ${JSON.stringify(bus.getSnapshot().allocator ?? {})}`)
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
  }
  return { bus, until }
}

test('a node without an ID gets the highest free one, and joins the bus', async () => {
  const { bus, until } = await demoBus()
  try {
    // Off: the node keeps asking and never appears (and is never "node 0").
    await new Promise((resolve) => setTimeout(resolve, 1300))
    assert.ok(!bus.getSnapshot().nodes.some((node) => node.nodeId === 0 || node.name === 'org.ardupilot.ap_periph' && node.nodeId > 71))
    bus.setCanNodeAllocator(true)
    await until((state) => state.allocator?.entries.some((entry) => entry.source === 'allocated'))
    const entry = bus.getSnapshot().allocator.entries.find((candidate) => candidate.source === 'allocated')
    assert.equal(entry.uniqueId, hex(DEMO_UID))
    assert.equal(entry.nodeId, 125)
    await until((state) => state.nodes.some((node) => node.nodeId === 125 && node.name === 'org.ardupilot.ap_periph'))
  } finally {
    await bus.stop()
  }
})

test('a node the table knows gets its ID back', async () => {
  const { bus, until } = await demoBus()
  try {
    bus.setCanNodeAllocator(true, [{ nodeId: 42, uniqueId: hex(DEMO_UID) }])
    await until((state) => state.nodes.some((node) => node.nodeId === 42))
  } finally {
    await bus.stop()
  }
})

test('another allocator on the bus: this one steps aside', () => {
  const service = new CanBusService({
    session: { send: async () => {} },
    emit: () => {},
    appendStatusEntry: () => {},
    getTargetSystem: () => 1,
    getTargetComponent: () => 1
  })
  service.status = 'active'
  service.bus = 1
  service.setAllocatorEnabled(true)
  const [frame] = dronecanBuildBroadcastFrames(
    { messageTypeId: 1, signature: DRONECAN_ALLOCATION_SIGNATURE, sourceNodeId: 10, transferId: 0 },
    encodeDronecanAllocation({ nodeId: 0, firstPartOfUniqueId: false, uniqueId: Uint8Array.from([1, 2, 3]) })
  )
  const data = new Uint8Array(8)
  data.set(frame.data)
  service.processCanFrame({ type: 'CAN_FRAME', targetSystem: 0, targetComponent: 0, bus: 0, len: frame.data.length, id: (frame.canId | 0x80000000) >>> 0, data })
  const allocator = service.getSnapshot().allocator
  assert.equal(allocator.enabled, false)
  assert.equal(allocator.otherAllocatorNodeId, 10)
})

test('changing a node ID writes CAN_NODE, saves, restarts, and the node comes back under it', async () => {
  const { bus, until } = await demoBus()
  try {
    await until((state) => state.nodes.some((node) => node.nodeId === 124))
    bus.fetchAllCanBusParameters(124)
    await until((state) => state.nodes.find((node) => node.nodeId === 124)?.paramFetch.status === 'complete')
    await bus.changeCanBusNodeId(124, 50)
    assert.match(bus.getSnapshot().error ?? '', /already on the bus/)
    await bus.changeCanBusNodeId(124, 100)
    await until((state) => state.nodes.some((node) => node.nodeId === 100 && node.name === 'com.hex.here3'))
    assert.ok(!bus.getSnapshot().nodes.some((node) => node.nodeId === 124), 'the old ID does not linger')
  } finally {
    await bus.stop()
  }
})
