import assert from 'node:assert/strict'
import test from 'node:test'

import { ArduPilotConfiguratorRuntime } from '../packages/ardupilot-core/dist/index.js'
import { arducopterMetadata } from '../packages/param-metadata/dist/index.js'
import { MAV_AUTOPILOT, MAV_CMD, MAV_TYPE, MavlinkSession, MavlinkV2Codec, createArduCopterMockScenario } from '../packages/protocol-mavlink/dist/index.js'
import { MockTransport } from '../packages/transport/dist/index.js'

// Phase 1 of the DroneCAN peripherals integration. The autopilot's
// MAVLink-UAVCAN bridge advertises each node as a sibling MAVLink component
// (component_id == UAVCAN node_id) via UAVCAN_NODE_STATUS (310) and
// UAVCAN_NODE_INFO (311). These tests pin that the runtime decodes both
// messages, scopes them by component_id, and exposes a stable canNodes
// snapshot — without touching the authoritative vehicle identity lock.

function encodeFrame(codec, message, componentId, sequence) {
  return codec.encode({
    header: { systemId: 1, componentId, sequence },
    message,
    timestampMs: Date.now()
  })
}

function makeUavcanNodeStatus(componentId, fields = {}) {
  return {
    type: 'UAVCAN_NODE_STATUS',
    timeUsec: 0n,
    uptimeSec: 123,
    health: 0,
    mode: 0,
    subMode: 0,
    vendorSpecificStatusCode: 0,
    ...fields
  }
}

function makeUavcanNodeInfo(componentId, name, hwUniqueId) {
  return {
    type: 'UAVCAN_NODE_INFO',
    timeUsec: 0n,
    uptimeSec: 123,
    name,
    hwVersionMajor: 2,
    hwVersionMinor: 1,
    hwUniqueId,
    swVersionMajor: 1,
    swVersionMinor: 3,
    swVcsCommit: 0xabcdef01
  }
}

async function awaitSnapshot(runtime, predicate, timeoutMs = 1500) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate(runtime.getSnapshot())) {
      return runtime.getSnapshot()
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  return undefined
}

test('runtime exposes DroneCAN nodes discovered via UAVCAN_NODE_STATUS + UAVCAN_NODE_INFO', async () => {
  const codec = new MavlinkV2Codec()

  const here3Status = encodeFrame(
    codec,
    makeUavcanNodeStatus(11, { uptimeSec: 42, health: 1, mode: 0, vendorSpecificStatusCode: 0x1234 }),
    11,
    0
  )
  const here3Info = encodeFrame(
    codec,
    makeUavcanNodeInfo(11, 'org.cubepilot.here3', new Uint8Array([
      0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08,
      0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f, 0x10
    ])),
    11,
    1
  )

  const escStatus = encodeFrame(
    codec,
    makeUavcanNodeStatus(12, { uptimeSec: 7, health: 0, mode: 0 }),
    12,
    2
  )
  const escInfo = encodeFrame(
    codec,
    makeUavcanNodeInfo(12, 'com.hobbywing.escv4', new Uint8Array(16).fill(0xa5)),
    12,
    3
  )

  const transport = new MockTransport('dronecan-nodes-phase1', {
    initialFrames: [here3Status, here3Info, escStatus, escInfo],
    frameIntervalMs: 0,
    responseDelayMs: 0,
    chunkSize: 0
  })

  const runtime = new ArduPilotConfiguratorRuntime(
    new MavlinkSession(transport, new MavlinkV2Codec()),
    arducopterMetadata
  )

  try {
    await runtime.connect()
    const snapshot = await awaitSnapshot(runtime, (s) => s.canNodes.length === 2)
    assert.ok(snapshot, 'expected two DroneCAN nodes to be discovered within timeout')

    const [here3, esc] = snapshot.canNodes
    assert.equal(here3.componentId, 11)
    assert.equal(here3.name, 'org.cubepilot.here3')
    assert.equal(here3.health, 'warning')
    assert.equal(here3.mode, 'operational')
    assert.equal(here3.uptimeSec, 42)
    assert.equal(here3.vendorStatusCode, 0x1234)
    assert.equal(here3.hwUniqueId, '0102030405060708090a0b0c0d0e0f10')
    assert.deepEqual(here3.hwVersion, { major: 2, minor: 1 })
    assert.deepEqual(here3.swVersion, { major: 1, minor: 3, vcsCommit: 0xabcdef01 })
    assert.equal(here3.lastSeenSource, 'uavcan-node-status')

    assert.equal(esc.componentId, 12)
    assert.equal(esc.name, 'com.hobbywing.escv4')
    assert.equal(esc.health, 'ok')
    assert.equal(esc.mode, 'operational')

    // Sibling DroneCAN nodes must NOT have stolen vehicle identity; the
    // authoritative-heartbeat filter still gates that path.
    assert.equal(snapshot.vehicle, undefined)
  } finally {
    await runtime.disconnect().catch(() => {})
    runtime.destroy()
  }
})

test('a later UAVCAN_NODE_STATUS overwrites health/mode but preserves NODE_INFO identity', async () => {
  const codec = new MavlinkV2Codec()

  const frames = [
    encodeFrame(codec, makeUavcanNodeStatus(15, { health: 0, mode: 0, uptimeSec: 3 }), 15, 0),
    encodeFrame(
      codec,
      makeUavcanNodeInfo(15, 'org.uavcan.gps', new Uint8Array(16).fill(0x11)),
      15,
      1
    ),
    encodeFrame(codec, makeUavcanNodeStatus(15, { health: 2, mode: 2, uptimeSec: 30, vendorSpecificStatusCode: 7 }), 15, 2)
  ]

  const transport = new MockTransport('dronecan-status-update', {
    initialFrames: frames,
    frameIntervalMs: 0,
    responseDelayMs: 0,
    chunkSize: 0
  })

  const runtime = new ArduPilotConfiguratorRuntime(
    new MavlinkSession(transport, new MavlinkV2Codec()),
    arducopterMetadata
  )

  try {
    await runtime.connect()
    const snapshot = await awaitSnapshot(
      runtime,
      (s) => s.canNodes.length === 1 && s.canNodes[0].health === 'error'
    )
    assert.ok(snapshot, 'expected the third UAVCAN_NODE_STATUS to land')

    const [node] = snapshot.canNodes
    assert.equal(node.componentId, 15)
    assert.equal(node.health, 'error')
    assert.equal(node.mode, 'maintenance')
    assert.equal(node.uptimeSec, 30)
    assert.equal(node.vendorStatusCode, 7)
    // Identity from NODE_INFO must survive a later NODE_STATUS update.
    assert.equal(node.name, 'org.uavcan.gps')
    assert.equal(node.hwUniqueId, '11'.repeat(16))
  } finally {
    await runtime.disconnect().catch(() => {})
    runtime.destroy()
  }
})

test('unknown health/mode codes map to "unknown" rather than silently falling through', async () => {
  const codec = new MavlinkV2Codec()
  const frame = encodeFrame(
    codec,
    makeUavcanNodeStatus(22, { health: 250, mode: 99, uptimeSec: 1 }),
    22,
    0
  )

  const transport = new MockTransport('dronecan-unknown-codes', {
    initialFrames: [frame],
    frameIntervalMs: 0,
    responseDelayMs: 0,
    chunkSize: 0
  })

  const runtime = new ArduPilotConfiguratorRuntime(
    new MavlinkSession(transport, new MavlinkV2Codec()),
    arducopterMetadata
  )

  try {
    await runtime.connect()
    const snapshot = await awaitSnapshot(runtime, (s) => s.canNodes.length === 1)
    assert.ok(snapshot, 'expected the unknown-code node to be ingested')
    assert.equal(snapshot.canNodes[0].health, 'unknown')
    assert.equal(snapshot.canNodes[0].mode, 'unknown')
  } finally {
    await runtime.disconnect().catch(() => {})
    runtime.destroy()
  }
})

test('after NODE_STATUS arrives for an un-named node, the runtime requests UAVCAN_NODE_INFO refresh', async () => {
  // The autopilot's MAVLink-UAVCAN bridge emits UAVCAN_NODE_INFO only on
  // discovery / reboot. If we tuned in mid-session and only see NODE_STATUS,
  // the configurator nudges the bridge to re-broadcast NODE_INFO so node
  // identity (name, UID, versions) catches up. This test pins that nudge.
  const codec = new MavlinkV2Codec()
  // The runtime only sends commands once a vehicle identity has been locked
  // in via HEARTBEAT — without it, vehicle is undefined and the refresh path
  // bails out. Feed a HEARTBEAT first, then the unnamed-node NODE_STATUS.
  const heartbeat = codec.encode({
    header: { systemId: 1, componentId: 1, sequence: 0 },
    message: {
      type: 'HEARTBEAT',
      autopilot: MAV_AUTOPILOT.ARDUPILOTMEGA,
      vehicleType: MAV_TYPE.QUADROTOR,
      baseMode: 0,
      customMode: 0,
      systemStatus: 4,
      mavlinkVersion: 3
    },
    timestampMs: Date.now()
  })
  const nodeStatus = encodeFrame(codec, makeUavcanNodeStatus(11), 11, 1)

  const transport = new MockTransport('dronecan-info-refresh', {
    initialFrames: [heartbeat, nodeStatus],
    frameIntervalMs: 0,
    responseDelayMs: 0,
    chunkSize: 0
  })

  const runtime = new ArduPilotConfiguratorRuntime(
    new MavlinkSession(transport, new MavlinkV2Codec()),
    arducopterMetadata
  )

  try {
    await runtime.connect()
    await awaitSnapshot(runtime, (s) => s.canNodes.length === 1)
    // Give the async maybeRequestCanNodeInfo() a tick to flush.
    await new Promise((resolve) => setTimeout(resolve, 50))

    const probe = new MavlinkV2Codec()
    const refreshCommands = []
    for (const frame of transport.outboundFrames()) {
      for (const envelope of probe.push(frame)) {
        if (
          envelope.message.type === 'COMMAND_LONG' &&
          envelope.message.command === MAV_CMD.UAVCAN_GET_NODE_INFO
        ) {
          refreshCommands.push(envelope.message)
        }
      }
    }

    assert.equal(refreshCommands.length, 1, 'expected exactly one MAV_CMD_UAVCAN_GET_NODE_INFO broadcast')
  } finally {
    await runtime.disconnect().catch(() => {})
    runtime.destroy()
  }
})

test('repeated NODE_STATUS within the debounce window does not re-fire UAVCAN_NODE_INFO', async () => {
  const codec = new MavlinkV2Codec()
  const heartbeat = codec.encode({
    header: { systemId: 1, componentId: 1, sequence: 0 },
    message: {
      type: 'HEARTBEAT',
      autopilot: MAV_AUTOPILOT.ARDUPILOTMEGA,
      vehicleType: MAV_TYPE.QUADROTOR,
      baseMode: 0,
      customMode: 0,
      systemStatus: 4,
      mavlinkVersion: 3
    },
    timestampMs: Date.now()
  })
  const frames = [heartbeat]
  for (let sequence = 1; sequence <= 5; sequence += 1) {
    frames.push(encodeFrame(codec, makeUavcanNodeStatus(11, { uptimeSec: 10 + sequence }), 11, sequence))
  }

  const transport = new MockTransport('dronecan-info-refresh-debounce', {
    initialFrames: frames,
    frameIntervalMs: 0,
    responseDelayMs: 0,
    chunkSize: 0
  })

  const runtime = new ArduPilotConfiguratorRuntime(
    new MavlinkSession(transport, new MavlinkV2Codec()),
    arducopterMetadata
  )

  try {
    await runtime.connect()
    await awaitSnapshot(runtime, (s) => s.canNodes.length === 1 && s.canNodes[0].uptimeSec === 15)
    await new Promise((resolve) => setTimeout(resolve, 50))

    const probe = new MavlinkV2Codec()
    let refreshCount = 0
    for (const frame of transport.outboundFrames()) {
      for (const envelope of probe.push(frame)) {
        if (
          envelope.message.type === 'COMMAND_LONG' &&
          envelope.message.command === MAV_CMD.UAVCAN_GET_NODE_INFO
        ) {
          refreshCount += 1
        }
      }
    }

    // Five NODE_STATUS frames should still produce only one refresh broadcast
    // until the debounce window elapses.
    assert.equal(refreshCount, 1, `expected 1 refresh command, saw ${refreshCount}`)
  } finally {
    await runtime.disconnect().catch(() => {})
    runtime.destroy()
  }
})

test('demo DroneCAN simulator populates the inspector with named nodes + params', async () => {
  // Full demo path: connect the ArduCopter mock, start CAN forwarding, and
  // confirm the simulated bus is discovered end to end — NodeStatus broadcasts
  // surface the nodes, GetNodeInfo names them, and the param walk fills their
  // tables — all decoded by the real CanBusService.
  const scenario = createArduCopterMockScenario({ dynamicCadenceMs: 50 })
  const transport = new MockTransport('mock-dronecan-sim', {
    initialFrames: scenario.initialFrames,
    respondToOutbound: scenario.respondToOutbound,
    dynamicEmitter: scenario.attachDynamicEmitter,
    // Deliver the 1030-param sync as fast as possible (matching the simpler
    // sibling tests). frameIntervalMs:1 spaced 1030 setTimeout(1ms) callbacks
    // into a chain that, under CI timer coalescing, could stretch the param
    // burst past the CAN-walk awaitSnapshot budgets below and flake.
    frameIntervalMs: 0,
    responseDelayMs: 0,
    chunkSize: 0
  })
  const runtime = new ArduPilotConfiguratorRuntime(
    new MavlinkSession(transport, new MavlinkV2Codec()),
    arducopterMetadata
  )

  try {
    await runtime.connect()
    await runtime.waitForVehicle({ timeoutMs: 1500 })
    runtime.startCanBusForward(1)

    const snapshot = await awaitSnapshot(
      runtime,
      (snap) => {
        const gps = snap.canBus.nodes.find((node) => node.nodeId === 124)
        const power = snap.canBus.nodes.find((node) => node.nodeId === 50)
        return (
          Boolean(gps?.name) &&
          Boolean(power?.name) &&
          gps.parameters.some((param) => param.name === 'GPS_TYPE') &&
          power.parameters.some((param) => param.name === 'BATT_CAPACITY')
        )
      },
      8000
    )
    assert.ok(snapshot, 'two named nodes with their parameter tables were discovered')

    const names = snapshot.canBus.nodes.map((node) => node.name).sort()
    assert.deepEqual(names, ['com.hex.here3', 'org.ardupilot.ap_periph'])

    const gps = snapshot.canBus.nodes.find((node) => node.nodeId === 124)
    assert.ok(gps, 'GPS node 124 present')
    const gpsType = gps.parameters.find((param) => param.name === 'GPS_TYPE')
    assert.ok(gpsType, 'GPS_TYPE param fetched')

    const power = snapshot.canBus.nodes.find((node) => node.nodeId === 50)
    assert.ok(power, 'power node 50 present')
    assert.ok(power.parameters.find((param) => param.name === 'BATT_CAPACITY'), 'BATT_CAPACITY param fetched')
  } finally {
    await runtime.disconnect().catch(() => {})
    runtime.destroy()
  }
})

test('demo DroneCAN simulator honors a param write + save (full edit round-trip)', async () => {
  // The inspector lets the operator edit + persist a node param. The demo bus
  // simulator must apply a GetSet write (by name) and reflect the new value in
  // its GetSet response, and ACK the ExecuteOpcode save — otherwise the demo
  // edit flow would silently no-op.
  const scenario = createArduCopterMockScenario({ dynamicCadenceMs: 50 })
  const transport = new MockTransport('mock-dronecan-write', {
    initialFrames: scenario.initialFrames,
    respondToOutbound: scenario.respondToOutbound,
    dynamicEmitter: scenario.attachDynamicEmitter,
    // Deliver the 1030-param sync as fast as possible (matching the simpler
    // sibling tests). frameIntervalMs:1 spaced 1030 setTimeout(1ms) callbacks
    // into a chain that, under CI timer coalescing, could stretch the param
    // burst past the CAN-walk awaitSnapshot budgets below and flake.
    frameIntervalMs: 0,
    responseDelayMs: 0,
    chunkSize: 0
  })
  const runtime = new ArduPilotConfiguratorRuntime(
    new MavlinkSession(transport, new MavlinkV2Codec()),
    arducopterMetadata
  )
  const gpsType = () =>
    runtime.getSnapshot().canBus.nodes.find((node) => node.nodeId === 124)?.parameters.find((p) => p.name === 'GPS_TYPE')

  try {
    await runtime.connect()
    await runtime.waitForVehicle({ timeoutMs: 1500 })
    runtime.startCanBusForward(1)

    assert.ok(await awaitSnapshot(runtime, () => gpsType()?.value !== undefined, 6000), 'GPS_TYPE param fetched')
    assert.equal(gpsType().value.int64, '1', 'seeded GPS_TYPE = 1')

    // Write GPS_TYPE = 9; the simulator must echo the new value back.
    await runtime.writeCanBusParameter(124, 'GPS_TYPE', { tag: 'int64', int64: '9' })
    assert.ok(
      await awaitSnapshot(runtime, () => gpsType()?.value?.int64 === '9', 6000),
      'GPS_TYPE reflects the written value 9'
    )

    // Save must complete without surfacing an error on the CAN state.
    await runtime.saveCanBusParameters(124)
    assert.equal(runtime.getSnapshot().canBus.error, undefined, 'save did not surface an error')
  } finally {
    await runtime.disconnect().catch(() => {})
    runtime.destroy()
  }
})
