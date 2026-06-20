import assert from 'node:assert/strict'
import test from 'node:test'

import {
  motorTestGuardReasons,
  MOTOR_TEST_PROPS_REMOVED_REASON,
  MOTOR_TEST_AREA_CLEAR_REASON,
  MAX_MOTOR_TEST_THROTTLE_PERCENT
} from '../packages/ardupilot-core/dist/index.js'

// Minimal snapshot where evaluateMotorTestEligibility returns zero reasons:
// connected, a disarmed Copter, params complete, no running guided action,
// motor test idle, and one mapped motor output (SERVO1_FUNCTION = 33 = M1).
function eligibleSnapshot(overrides = {}) {
  return {
    connection: { kind: 'connected' },
    vehicle: { firmware: 'ArduPilot', vehicle: 'ArduCopter', systemId: 1, componentId: 1, armed: false, flightMode: 'STABILIZE' },
    parameterStats: { downloaded: 1, total: 1, duplicateFrames: 0, status: 'complete', progress: 1 },
    guidedActions: {},
    motorTest: { status: 'idle' },
    parameters: [
      { id: 'FRAME_CLASS', value: 1 },
      { id: 'FRAME_TYPE', value: 1 },
      { id: 'SERVO1_FUNCTION', value: 33 }
    ],
    ...overrides
  }
}

const validRequest = { outputChannel: 1, throttlePercent: 7, durationSeconds: 1 }
const bothAcked = { propsRemoved: true, testAreaClear: true }

test('motorTestGuardReasons returns no reasons when eligible and both acks are set', () => {
  const reasons = motorTestGuardReasons(eligibleSnapshot(), validRequest, bothAcked)
  assert.deepEqual(reasons, [])
})

test('throttle range allows up to 100% and rejects above it', () => {
  assert.equal(MAX_MOTOR_TEST_THROTTLE_PERCENT, 100)
  // Full throttle is now permitted (gated only by the safety acks).
  const full = motorTestGuardReasons(eligibleSnapshot(), { outputChannel: 1, throttlePercent: 100, durationSeconds: 1 }, bothAcked)
  assert.deepEqual(full, [])
  // Over the cap still fails.
  const over = motorTestGuardReasons(eligibleSnapshot(), { outputChannel: 1, throttlePercent: 101, durationSeconds: 1 }, bothAcked)
  assert.ok(over.length > 0)
})

test('motorTestGuardReasons surfaces each missing safety acknowledgement', () => {
  const noProps = motorTestGuardReasons(eligibleSnapshot(), validRequest, { propsRemoved: false, testAreaClear: true })
  assert.deepEqual(noProps, [MOTOR_TEST_PROPS_REMOVED_REASON])

  const noArea = motorTestGuardReasons(eligibleSnapshot(), validRequest, { propsRemoved: true, testAreaClear: false })
  assert.deepEqual(noArea, [MOTOR_TEST_AREA_CLEAR_REASON])

  const neither = motorTestGuardReasons(eligibleSnapshot(), validRequest, { propsRemoved: false, testAreaClear: false })
  assert.deepEqual(neither, [MOTOR_TEST_PROPS_REMOVED_REASON, MOTOR_TEST_AREA_CLEAR_REASON])
})

test('motorTestGuardReasons keeps eligibility reasons ahead of acknowledgement reasons', () => {
  // Armed vehicle is ineligible; both acks unset. Eligibility reason must
  // come first, then the two acknowledgement reasons, in a stable order.
  const armed = eligibleSnapshot({
    vehicle: { firmware: 'ArduPilot', vehicle: 'ArduCopter', systemId: 1, componentId: 1, armed: true, flightMode: 'STABILIZE' }
  })
  const reasons = motorTestGuardReasons(armed, validRequest, { propsRemoved: false, testAreaClear: false })
  assert.equal(reasons[0], 'The vehicle reports armed=true.')
  assert.equal(reasons[reasons.length - 2], MOTOR_TEST_PROPS_REMOVED_REASON)
  assert.equal(reasons[reasons.length - 1], MOTOR_TEST_AREA_CLEAR_REASON)
})

test('motorTestGuardReasons blocks when disconnected even with both acks', () => {
  const offline = eligibleSnapshot({ connection: { kind: 'idle' } })
  const reasons = motorTestGuardReasons(offline, validRequest, bothAcked)
  assert.ok(reasons.includes('The transport is not connected.'))
})

test('armed=true is tolerated when caused by OUR OWN motor test (running or within the grace window)', () => {
  // ArduPilot arms for the duration of a DO_MOTOR_TEST and the 1 Hz
  // heartbeat lags the disarm — during guided identify the next motor's
  // test must not be rejected because the PREVIOUS test armed the FC.
  const armedVehicle = { firmware: 'ArduPilot', vehicle: 'ArduCopter', systemId: 1, componentId: 1, armed: true, flightMode: 'STABILIZE' }

  // Our test just completed (within the grace window).
  const justEnded = eligibleSnapshot({
    vehicle: armedVehicle,
    motorTest: { status: 'succeeded', completedAtMs: Date.now() - 1000 }
  })
  assert.ok(
    !motorTestGuardReasons(justEnded, validRequest, bothAcked).includes('The vehicle reports armed=true.'),
    'armed within the post-test grace window must not block the next spin'
  )

  // Armed with NO recent motor test of ours: still hard-blocked.
  const trulyArmed = eligibleSnapshot({
    vehicle: armedVehicle,
    motorTest: { status: 'succeeded', completedAtMs: Date.now() - 60_000 }
  })
  assert.ok(
    motorTestGuardReasons(trulyArmed, validRequest, bothAcked).includes('The vehicle reports armed=true.'),
    'a genuinely armed vehicle (no recent test) must still be rejected'
  )
})
