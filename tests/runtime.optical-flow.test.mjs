import assert from 'node:assert/strict'
import test from 'node:test'

import { ArduPilotConfiguratorRuntime } from '../packages/ardupilot-core/dist/index.js'
import { arducopterMetadata } from '../packages/param-metadata/dist/index.js'
import {
  MavlinkSession,
  MavlinkV2Codec
} from '../packages/protocol-mavlink/dist/index.js'
import { MockTransport } from '../packages/transport/dist/index.js'

// Phase 1 of the optical-flow chip: snapshot.liveVerification.opticalFlow
// flips to verified the moment OPTICAL_FLOW (msgid 100) arrives, and
// carries the last-seen timestamp + the most recent quality / sensor id.
// The chip's freshness window is computed in App.tsx, so the runtime test
// only pins the write path.

function encodeFlowFrame(codec, fields, sequence) {
  return codec.encode({
    header: { systemId: 1, componentId: 1, sequence },
    message: {
      type: 'OPTICAL_FLOW',
      timeUsec: 0n,
      sensorId: 0,
      flowX: 0,
      flowY: 0,
      flowCompMx: 0,
      flowCompMy: 0,
      groundDistance: -1,
      quality: 0,
      flowRateX: 0,
      flowRateY: 0,
      ...fields
    },
    timestampMs: Date.now()
  })
}

async function awaitSnapshot(runtime, predicate, timeoutMs = 1500) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate(runtime.getSnapshot())) {
      return runtime.getSnapshot()
    }
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  return undefined
}

test('runtime records OPTICAL_FLOW arrivals as a sensor pulse', async () => {
  const codec = new MavlinkV2Codec()
  const frame = encodeFlowFrame(codec, {
    sensorId: 0,
    quality: 180,
    flowX: 12,
    flowY: -7,
    flowCompMx: 0.42,
    flowCompMy: -0.18,
    groundDistance: 1.05,
    flowRateX: 0.12,
    flowRateY: -0.05
  }, 0)

  const transport = new MockTransport('optical-flow-pulse', {
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
    const snapshot = await awaitSnapshot(
      runtime,
      (s) => s.liveVerification.opticalFlow.verified
    )
    assert.ok(snapshot, 'expected OPTICAL_FLOW to flip the verified flag')

    const flow = snapshot.liveVerification.opticalFlow
    assert.equal(flow.verified, true)
    assert.equal(flow.sensorId, 0)
    assert.equal(flow.quality, 180)
    assert.equal(typeof flow.lastSeenAtMs, 'number')
    assert.ok(Date.now() - (flow.lastSeenAtMs ?? 0) < 1000)
  } finally {
    await runtime.disconnect().catch(() => {})
    runtime.destroy()
  }
})

test('a later OPTICAL_FLOW arrival refreshes lastSeenAtMs and overwrites quality', async () => {
  const codec = new MavlinkV2Codec()
  const earlyFrame = encodeFlowFrame(codec, { sensorId: 0, quality: 32 }, 0)
  const lateFrame = encodeFlowFrame(codec, { sensorId: 0, quality: 220 }, 1)

  const transport = new MockTransport('optical-flow-refresh', {
    initialFrames: [earlyFrame, lateFrame],
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
      (s) => s.liveVerification.opticalFlow.quality === 220
    )
    assert.ok(snapshot, 'expected the second OPTICAL_FLOW to overwrite quality')
    assert.equal(snapshot.liveVerification.opticalFlow.quality, 220)
  } finally {
    await runtime.disconnect().catch(() => {})
    runtime.destroy()
  }
})

test('OPTICAL_FLOW truncated to the 26-byte min payload still decodes (extension fields default to 0)', async () => {
  // Hand-craft a MAVLink v2 frame whose payload is exactly the documented
  // minimum length (26 bytes) — i.e. the wire form a sender that does not
  // know about the flow_rate_x/y extension fields would emit. The codec
  // zero-pads on receive, so flowRateX/Y must come back as 0 without
  // throwing or dropping the frame.
  const codec = new MavlinkV2Codec()
  // Round-trip via the codec to construct correctly-checksummed bytes,
  // then truncate the payload to 26 by re-encoding directly.
  const fullFrame = encodeFlowFrame(codec, { sensorId: 0, quality: 64 }, 0)
  // Find STX + truncate. Frame layout: 0xfd | len(1) | ...header... | payload(len) | crc(2).
  const STX = 0xfd
  assert.equal(fullFrame[0], STX)
  // Trim payloadLen byte to 26, drop the extension bytes, recompute CRC.
  fullFrame[1] = 26
  const headerPlusPayload = fullFrame.slice(1, 10 + 26)
  // Manually compute MAVLink CRC (X.25 over header+payload + crc_extra=175).
  function mavlinkCrc(bytes, extra) {
    let crc = 0xffff
    const all = new Uint8Array(bytes.length + 1)
    all.set(bytes, 0)
    all[bytes.length] = extra
    for (const byte of all) {
      let tmp = byte ^ (crc & 0xff)
      tmp = (tmp ^ (tmp << 4)) & 0xff
      crc = ((crc >> 8) ^ (tmp << 8) ^ (tmp << 3) ^ (tmp >> 4)) & 0xffff
    }
    return crc
  }
  const checksum = mavlinkCrc(headerPlusPayload, 175)
  const truncated = new Uint8Array(10 + 26 + 2)
  truncated.set(fullFrame.subarray(0, 10 + 26), 0)
  truncated[10 + 26] = checksum & 0xff
  truncated[10 + 26 + 1] = (checksum >> 8) & 0xff

  const transport = new MockTransport('optical-flow-truncated', {
    initialFrames: [truncated],
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
      (s) => s.liveVerification.opticalFlow.verified && s.liveVerification.opticalFlow.quality === 64
    )
    assert.ok(snapshot, 'expected the 26-byte (truncated) OPTICAL_FLOW to decode')
    assert.equal(snapshot.liveVerification.opticalFlow.quality, 64)
  } finally {
    await runtime.disconnect().catch(() => {})
    runtime.destroy()
  }
})
