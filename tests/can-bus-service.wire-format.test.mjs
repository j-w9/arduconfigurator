import assert from 'node:assert/strict'
import test from 'node:test'

import { CanBusService } from '../packages/ardupilot-core/dist/runtime-can-bus-service.js'
import { encodeDronecanGetSetResponse } from '../packages/protocol-mavlink/dist/index.js'

function seedNode(service, nodeId, paramName) {
  service.nodes.set(nodeId, {
    nodeId,
    health: 'ok',
    mode: 'operational',
    parameters: [{ index: 0, name: paramName, value: { tag: 'int64', int64: '0' }, lastFetchedAtMs: 0 }],
    paramFetch: { status: 'complete', nextIndex: 1 },
    firstSeenAtMs: 0,
    lastSeenAtMs: 0
  })
}

// Pin: outbound CAN_FRAMEs MUST set bit 31 (AP_HAL FlagEFF) so AP
// interprets the 29-bit DroneCAN id as an extended frame. Without this
// bit, AP forwards `id & 0x7FF` onto the bus — a garbage standard
// frame that no DroneCAN node responds to, which is why the first
// round of probing made MAV_CMD_CAN_FORWARD look RX-only.

function makeServiceWithActiveBus() {
  const sends = []
  const service = new CanBusService({
    session: { send: async (msg) => sends.push(msg) },
    emit: () => {},
    appendStatusEntry: () => {},
    getTargetSystem: () => 1,
    getTargetComponent: () => 1
  })
  // Bypass the COMMAND_ACK round-trip by reaching in and flipping state.
  // The service is keyed entirely on `status === 'active'` for the gate
  // that controls outbound sends.
  service.status = 'active'
  service.bus = 1
  return { service, sends }
}

test('writeParameter sets the FlagEFF (bit 31) on every outbound CAN_FRAME', async () => {
  const { service, sends } = makeServiceWithActiveBus()
  // Pre-seed a node so writeParameter doesn't trip the "unknown node"
  // guard; we only care about what gets sent over the wire.
  service.nodes.set(125, {
    nodeId: 125,
    health: 'unknown',
    mode: 'unknown',
    parameters: [],
    paramFetch: { status: 'idle', nextIndex: 0 },
    firstSeenAtMs: 0,
    lastSeenAtMs: 0
  })

  await service.writeParameter(125, 'GNSS_LOG_AT_STARTUP', { tag: 'int64', int64: '1' })

  assert.ok(sends.length >= 1, 'expected at least one CAN_FRAME to be emitted')
  for (const msg of sends) {
    assert.equal(msg.type, 'CAN_FRAME')
    // Bit 31 must be set. JS bitwise ops are signed, so cast via >>>0.
    const idUnsigned = msg.id >>> 0
    assert.ok(
      (idUnsigned & 0x80000000) !== 0,
      `CAN_FRAME id 0x${idUnsigned.toString(16).padStart(8, '0')} is missing FlagEFF (bit 31)`
    )
    // And the lower 29 bits are still the DroneCAN id we'd expect (not
    // collateral damage from the OR).
    const lower29 = idUnsigned & 0x1fffffff
    assert.ok(lower29 !== 0, 'lower 29 bits should still contain a valid DroneCAN id')
  }
})

test('CAN_FRAME bus field is 0-indexed on the wire (CAN1=0, CAN2=1)', async () => {
  // Confirms the second wire-format gotcha: MAV_CMD_CAN_FORWARD param1
  // is 1-indexed in AP (int8_t(param1)-1), but the CAN_FRAME `bus` field
  // on the wire is indexed directly into hal.can[p.bus] (0-based).
  // Without the shift, writes target CAN2 when the user picked CAN1.
  const { service: serviceCan1, sends: sendsCan1 } = makeServiceWithActiveBus()
  serviceCan1.bus = 1 // UI: CAN1
  serviceCan1.nodes.set(125, {
    nodeId: 125,
    health: 'unknown',
    mode: 'unknown',
    parameters: [],
    paramFetch: { status: 'idle', nextIndex: 0 },
    firstSeenAtMs: 0,
    lastSeenAtMs: 0
  })
  await serviceCan1.writeParameter(125, 'X', { tag: 'int64', int64: '0' })
  for (const msg of sendsCan1) {
    assert.equal(msg.bus, 0, `UI CAN1 should send bus=0 on the wire, got ${msg.bus}`)
  }

  const { service: serviceCan2, sends: sendsCan2 } = makeServiceWithActiveBus()
  serviceCan2.bus = 2 // UI: CAN2
  serviceCan2.nodes.set(125, {
    nodeId: 125,
    health: 'unknown',
    mode: 'unknown',
    parameters: [],
    paramFetch: { status: 'idle', nextIndex: 0 },
    firstSeenAtMs: 0,
    lastSeenAtMs: 0
  })
  await serviceCan2.writeParameter(125, 'X', { tag: 'int64', int64: '0' })
  for (const msg of sendsCan2) {
    assert.equal(msg.bus, 1, `UI CAN2 should send bus=1 on the wire, got ${msg.bus}`)
  }
})

test('writeParameter surfaces a failure via state.error instead of throwing', async () => {
  // The web calls writeParameter fire-and-forget, so a thrown rejection
  // would be silent — a failed write would look like success. Failures
  // must land in the snapshot's error field (the CAN view renders it).
  let emits = 0
  const service = new CanBusService({
    session: { send: async () => {} },
    emit: () => { emits += 1 },
    appendStatusEntry: () => {},
    getTargetSystem: () => 1,
    getTargetComponent: () => 1
  })
  service.status = 'active'
  service.bus = 1
  // No node 125 seeded → write should fail, surface in state, NOT throw.
  await assert.doesNotReject(() => service.writeParameter(125, 'X', { tag: 'int64', int64: '0' }))
  assert.match(service.getSnapshot().error ?? '', /No DroneCAN node 125/)
  assert.ok(emits >= 1, 'a failed write should emit so the UI re-renders')
})

test('saveParameters surfaces a failure via state.error and clears the pending save', async () => {
  const service = new CanBusService({
    session: { send: async () => {} },
    emit: () => {},
    appendStatusEntry: () => {},
    getTargetSystem: () => 1,
    getTargetComponent: () => 1
  })
  service.status = 'active'
  service.bus = 1
  await assert.doesNotReject(() => service.saveParameters(125))
  assert.match(service.getSnapshot().error ?? '', /No DroneCAN node 125/)
})

test('tick re-arms MAV_CMD_CAN_FORWARD as a keep-alive, but not within the interval', () => {
  // Regression: start() armed forwarding once and never re-sent it. ArduPilot
  // stops forwarding CAN frames to the GCS 5s after the last
  // MAV_CMD_CAN_FORWARD (AP_CANManager::can_frame_callback), so the initial
  // param walk worked, then reads/writes/saves silently got no response and
  // the node link appeared to drop. The poll tick must re-arm before 5s.
  const MAV_CMD_CAN_FORWARD = 32000
  const { service, sends } = makeServiceWithActiveBus()
  // Simulate forwarding armed >2s ago (inside AP's 5s window but past our
  // re-arm interval).
  service.lastForwardArmAtMs = Date.now() - 4000
  service.tick()
  const forwards = () => sends.filter((m) => m.type === 'COMMAND_LONG' && m.command === MAV_CMD_CAN_FORWARD)
  assert.equal(forwards().length, 1, 'tick must re-issue MAV_CMD_CAN_FORWARD as a keep-alive')
  assert.equal(forwards()[0].params[0], 1, 'keep-alive must target the active bus (1-indexed param1)')

  // A second tick immediately after is inside the re-arm interval — no dup.
  service.tick()
  assert.equal(forwards().length, 1, 'keep-alive must not re-fire within the re-arm interval')
})

test('writeParameter registers a pending write the tick re-sends until echoed', () => {
  // Best-effort CAN-over-MAVLink can drop a write; reads survive via the walk
  // retry, so writes get the same resilience — re-sent until the node echoes
  // the value back.
  const { service, sends } = makeServiceWithActiveBus()
  seedNode(service, 125, 'X')
  void service.writeParameter(125, 'X', { tag: 'int64', int64: '7' })
  assert.equal(service.pendingWrites.size, 1, 'the write is tracked as pending')
  const before = sends.length
  service.pendingWrites.get('125:X').lastSentMs = 0 // force the retry window open
  service.tick()
  assert.ok(sends.length > before, 'tick re-sent the unacknowledged write')
  assert.equal(service.pendingWrites.get('125:X').attempts, 2)
})

test('a GetSet echo clears the pending write so the tick stops re-sending', () => {
  const { service } = makeServiceWithActiveBus()
  seedNode(service, 125, 'X')
  void service.writeParameter(125, 'X', { tag: 'int64', int64: '7' })
  assert.equal(service.pendingWrites.size, 1)
  // Node echoes the param back (the post-write GetSet response).
  const payload = encodeDronecanGetSetResponse({
    value: { tag: 'int64', int64: 7n },
    defaultValue: { tag: 'empty' },
    maxValue: { tag: 'empty' },
    minValue: { tag: 'empty' },
    name: 'X'
  })
  service.handleGetSetResponse(125, payload)
  assert.equal(service.pendingWrites.size, 0, 'the echo acknowledged the write')
})

test('an unacknowledged write is abandoned with an error after the retry budget', () => {
  const { service } = makeServiceWithActiveBus()
  seedNode(service, 125, 'X')
  void service.writeParameter(125, 'X', { tag: 'int64', int64: '7' })
  // Node never echoes: drive ticks with the retry window forced open.
  for (let i = 0; i < 12 && service.pendingWrites.size > 0; i += 1) {
    const pending = service.pendingWrites.get('125:X')
    if (pending) pending.lastSentMs = 0
    service.tick()
  }
  assert.equal(service.pendingWrites.size, 0, 'the write is abandoned after the retry budget')
  assert.match(service.getSnapshot().error ?? '', /not acknowledged after/)
})

test('parameter walk stops instead of hanging when a node never sends the end marker', () => {
  // Regression: the refresh tick re-requested the current index forever. A
  // node that never returns an empty-name terminator (e.g. busy writing flash
  // right after a SAVE) left paramFetch stuck on "fetching" — the reported
  // "refresh params after save hangs". The walk must now give up after a
  // bounded number of no-progress retries and mark itself complete.
  const { service } = makeServiceWithActiveBus()
  service.nodes.set(125, {
    nodeId: 125,
    name: 'org.test.node',
    health: 'ok',
    mode: 'operational',
    parameters: [],
    paramFetch: { status: 'fetching', nextIndex: 2, lastAttemptAtMs: 0 },
    firstSeenAtMs: 0,
    lastSeenAtMs: 0
  })
  const node = service.nodes.get(125)
  // The node never answers, so the tick keeps re-requesting the same index.
  // Force the retry window open before each tick and drive it directly.
  for (let i = 0; i < 30 && node.paramFetch.status === 'fetching'; i++) {
    node.paramFetch.lastAttemptAtMs = 0
    service.tick()
  }
  assert.equal(node.paramFetch.status, 'complete', 'walk must stop, not hang on "fetching"')
  assert.ok(node.paramFetch.error, 'should record why the walk stopped early')
})

test('parameter walk that keeps making progress is not cut short by the retry bound', () => {
  // The bound must only trip on NO progress — a node still returning fresh
  // params (advancing nextIndex) should never be stopped early.
  const { service } = makeServiceWithActiveBus()
  service.nodes.set(126, {
    nodeId: 126,
    name: 'org.test.node2',
    health: 'ok',
    mode: 'operational',
    parameters: [],
    paramFetch: { status: 'fetching', nextIndex: 0, lastAttemptAtMs: 0 },
    firstSeenAtMs: 0,
    lastSeenAtMs: 0
  })
  const node = service.nodes.get(126)
  // Simulate progress: many ticks, but each time a fresh param advanced the
  // walk (handleGetSetResponse resets paramFetchRetries to 0).
  for (let i = 0; i < 30; i++) {
    node.paramFetch.lastAttemptAtMs = 0
    service.tick()
    node.paramFetchRetries = 0 // a fresh response arrived between ticks
  }
  assert.equal(node.paramFetch.status, 'fetching', 'a progressing walk must keep going')
})
