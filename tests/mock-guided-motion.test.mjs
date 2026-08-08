// The guided-setup exercises are driven entirely by live motion. Against the
// mock's previous fixed level attitude and fixed stick positions none of them
// could ever complete, so guided setup could not progress past the Airframe
// step in demo mode. These tests pin the scripted motion to the thresholds the
// exercises actually check — if either side drifts, the demo silently goes back
// to being unfinishable, which is exactly the failure this replaces.

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createArduCopterMockScenario,
  MAV_CMD,
  MAVLINK_MESSAGE_IDS,
  MavlinkV2Codec,
  mockAttitudeForTick,
  mockRcChannelsForTick
} from '@arduconfig/protocol-mavlink'

/**
 * Ask the scenario for a stream, the way the runtime does at connect.
 *
 * The mock now emits a live message ONLY once its id has been requested with
 * SET_MESSAGE_INTERVAL, mirroring a real ArduCopter (whose SRx_* defaults are
 * all zero). That is deliberate: emitting unconditionally is what let a
 * missing stream request pass a green demo and e2e suite while being dead on
 * hardware.
 */
function requestStream(scenario, messageId) {
  const codec = new MavlinkV2Codec()
  scenario.respondToOutbound(
    codec.encode({
      header: { systemId: 255, componentId: 190, sequence: 0 },
      message: {
        type: 'COMMAND_LONG',
        command: MAV_CMD.SET_MESSAGE_INTERVAL,
        targetSystem: 1,
        targetComponent: 1,
        confirmation: 0,
        params: [messageId, 100000, 0, 0, 0, 0, 0]
      },
      timestampMs: 0
    })
  )
}

// Mirrors orientationStepSatisfied in apps/web/src/setup-exercise-helpers.ts.
const LEVEL = (roll, pitch) => Math.abs(roll) <= 8 && Math.abs(pitch) <= 8
const PITCH_FORWARD = (_roll, pitch) => pitch <= -12
const ROLL_RIGHT = (roll) => roll >= 12

test('the attitude loop hits level, pitch-forward and roll-right in exercise order', () => {
  // Walk two full loops so a run starting mid-cycle still completes.
  const samples = Array.from({ length: 120 }, (_, tick) => mockAttitudeForTick(tick))

  let stage = 0
  const order = [LEVEL, PITCH_FORWARD, ROLL_RIGHT]
  for (const { rollDeg, pitchDeg } of samples) {
    if (stage < order.length && order[stage](rollDeg, pitchDeg)) {
      stage += 1
    }
  }

  assert.equal(stage, order.length, 'The orientation exercise must be able to run to completion on the mock stream.')
})

test('the attitude loop is deterministic and periodic', () => {
  for (let tick = 0; tick < 40; tick += 1) {
    assert.deepEqual(mockAttitudeForTick(tick), mockAttitudeForTick(tick + 52))
  }
})

test('the attitude loop returns to level, so it never parks the horizon tilted', () => {
  const levelSamples = Array.from({ length: 52 }, (_, tick) => mockAttitudeForTick(tick)).filter(({ rollDeg, pitchDeg }) =>
    LEVEL(rollDeg, pitchDeg)
  )
  assert.ok(levelSamples.length > 0, 'Expected the loop to spend time level.')
})

test('the stick loop moves exactly one axis at a time off its rest position', () => {
  // RC mapping locks onto the channel that moves ALONE — overlapping axes would
  // make the capture ambiguous and the exercise would never resolve a channel.
  const rest = [1500, 1500, 1100, 1500]
  for (let tick = 0; tick < 60; tick += 1) {
    const channels = mockRcChannelsForTick(tick)
    const movedAxes = rest.filter((restPwm, index) => Math.abs(channels[index] - restPwm) > 50)
    assert.ok(movedAxes.length <= 1, `Tick ${tick} moved ${movedAxes.length} control axes at once.`)
  }
})

test('every control axis reaches both ends of travel across one stick loop', () => {
  const seen = [0, 1, 2, 3].map(() => ({ low: false, high: false }))
  for (let tick = 0; tick < 60; tick += 1) {
    const channels = mockRcChannelsForTick(tick)
    for (const index of [0, 1, 2, 3]) {
      if (channels[index] <= 1250) seen[index].low = true
      if (channels[index] >= 1750) seen[index].high = true
    }
  }

  // Throttle rests low, so its "low" end is its rest position; the other three
  // must be driven to both ends for the stick-range exercise to pass.
  assert.ok(seen[0].low && seen[0].high, 'Roll must sweep both ends.')
  assert.ok(seen[1].low && seen[1].high, 'Pitch must sweep both ends.')
  assert.ok(seen[2].low && seen[2].high, 'Throttle must sweep both ends.')
  assert.ok(seen[3].low && seen[3].high, 'Yaw must sweep both ends.')
})

test('the motion stream stays off unless guidedMotionCadenceMs is passed', async () => {
  // Every existing caller and test omits the option, so the mock must stay
  // byte-for-byte equivalent to the previous static scenario for them.
  const scenario = createArduCopterMockScenario({ dynamicCadenceMs: 0 })
  const frames = []
  const stop = scenario.attachDynamicEmitter((frame) => frames.push(frame))
  await new Promise((resolve) => setTimeout(resolve, 120))
  stop()
  assert.equal(frames.length, 0, 'No motion frames may be emitted without the opt-in.')
})

test('the motion stream emits once guidedMotionCadenceMs is passed AND the streams are requested', async () => {
  const scenario = createArduCopterMockScenario({ guidedMotionCadenceMs: 10 })
  requestStream(scenario, MAVLINK_MESSAGE_IDS.ATTITUDE)
  requestStream(scenario, MAVLINK_MESSAGE_IDS.RC_CHANNELS)
  const frames = []
  const stop = scenario.attachDynamicEmitter((frame) => frames.push(frame))
  await new Promise((resolve) => setTimeout(resolve, 120))
  stop()
  assert.ok(frames.length > 0, 'Expected ATTITUDE/RC_CHANNELS frames on the motion stream.')

  const countAfterStop = frames.length
  await new Promise((resolve) => setTimeout(resolve, 60))
  assert.equal(frames.length, countAfterStop, 'The returned detach must stop the motion stream.')
})

test('the motion stream stays silent until the runtime asks for those streams', async () => {
  // The guard that makes this mock a witness rather than a rubber stamp.
  // Attitude and RC drive the orientation exercise, the horizon, RC
  // calibration and the endpoints check — if their LIVE_TELEMETRY_REQUESTS
  // entries were ever dropped, demo mode and the whole e2e suite must go dark
  // exactly as a flight controller would, instead of passing green.
  const scenario = createArduCopterMockScenario({ guidedMotionCadenceMs: 10 })
  const frames = []
  const stop = scenario.attachDynamicEmitter((frame) => frames.push(frame))
  await new Promise((resolve) => setTimeout(resolve, 120))
  stop()
  assert.equal(frames.length, 0, 'nothing may stream before SET_MESSAGE_INTERVAL')
})
