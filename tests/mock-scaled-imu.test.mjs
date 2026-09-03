import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createArduCopterMockScenario,
  MavlinkV2Codec,
  MAVLINK_MESSAGE_IDS
} from '../packages/protocol-mavlink/dist/index.js'

// SCALED_IMU carries the IMU temperature (TCAL) and the accelerometer the
// board-orientation surface measures. The mock only streams it once it has been
// asked for, exactly like a vehicle: a dropped LIVE_TELEMETRY_REQUESTS entry has
// to go dark here too, rather than passing in the demo and failing on hardware.
test('the mock streams SCALED_IMU once it is requested, and not before', async () => {
  const codec = new MavlinkV2Codec()
  const scenario = createArduCopterMockScenario({ dynamicCadenceMs: 300 })

  const seen = new Map()
  const emit = (frame) => {
    for (const envelope of codec.push(frame) ?? []) {
      seen.set(envelope.message.type, (seen.get(envelope.message.type) ?? 0) + 1)
    }
  }

  const stop = scenario.attachDynamicEmitter(emit)
  try {
    await new Promise((resolve) => setTimeout(resolve, 700))
    assert.equal(seen.get('SCALED_IMU'), undefined, 'must not stream before it is requested')

    const request = codec.encode({
      header: { systemId: 255, componentId: 190, sequence: 1 },
      message: {
        type: 'COMMAND_LONG',
        targetSystem: 1,
        targetComponent: 1,
        command: 511, // MAV_CMD_SET_MESSAGE_INTERVAL
        confirmation: 0,
        params: [MAVLINK_MESSAGE_IDS.SCALED_IMU, 100000, 0, 0, 0, 0, 0]
      }
    })
    for (const frame of scenario.respondToOutbound(request) ?? []) emit(frame)

    await new Promise((resolve) => setTimeout(resolve, 900))
    const count = seen.get('SCALED_IMU') ?? 0
    // Consecutive readings, not one frame per tick: anything deciding whether
    // the vehicle is STILL needs several in a row to see movement at all.
    assert.ok(count >= 12, `expected a burst of SCALED_IMU frames, saw ${count}`)
  } finally {
    stop()
  }
})

test('SCALED_IMU survives an encode/decode round trip with its accelerometer', () => {
  const codec = new MavlinkV2Codec()
  const frame = codec.encode({
    header: { systemId: 1, componentId: 1, sequence: 7 },
    message: {
      type: 'SCALED_IMU',
      timeBootMs: 1234,
      accelMg: { x: 31, y: -7, z: -969 },
      temperatureCdeg: 3562
    }
  })
  const [envelope] = codec.push(frame)
  assert.equal(envelope.message.type, 'SCALED_IMU')
  // ArduPilot sends accel * 1000 / GRAVITY_MSS, so milli-g on the wire.
  assert.deepEqual(envelope.message.accelMg, { x: 31, y: -7, z: -969 })
  assert.equal(envelope.message.temperatureCdeg, 3562)
})
