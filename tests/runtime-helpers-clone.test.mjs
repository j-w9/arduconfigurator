import assert from 'node:assert/strict'
import test from 'node:test'

// Deep-import the internal helpers (not part of the package's public surface).
import {
  cloneLiveVerification,
  createIdleLiveVerification
} from '../packages/ardupilot-core/dist/runtime-helpers.js'

// Regression: cloneLiveVerification is used to build every emitted snapshot's
// liveVerification. It rebuilds the object field-by-field, so any field it
// forgets is silently dropped out of all snapshots. imuTemperatureC (the live
// IMU temperature from SCALED_IMU, for the thermal-calibration readout) was
// omitted, so the runtime decoded the temperature but it never reached the UI.
// Verified live on real hardware: the snapshot went from `undefined` to 35.62 C
// once the clone carried the field.

test('cloneLiveVerification carries imuTemperatureC through to the snapshot', () => {
  const state = createIdleLiveVerification()
  state.imuTemperatureC = 35.62
  const cloned = cloneLiveVerification(state)
  assert.equal(cloned.imuTemperatureC, 35.62)
})

test('cloneLiveVerification leaves imuTemperatureC undefined when unset', () => {
  const cloned = cloneLiveVerification(createIdleLiveVerification())
  assert.equal(cloned.imuTemperatureC, undefined)
})

// The same omission, a second time, in the same function: accelMss (the
// accelerometer from the same SCALED_IMU frame) was added to the state and to
// the decoder but not here, so the board-orientation capture that runs during
// an accelerometer calibration silently had no input. Caught on hardware --
// the live IMU temperature was updating while accelMss stayed unset, which is
// only possible if the clone is dropping it.
test('cloneLiveVerification carries accelMss through to the snapshot', () => {
  const state = createIdleLiveVerification()
  state.accelMss = { x: 0.17, y: 0.09, z: 9.82 }
  const cloned = cloneLiveVerification(state)
  assert.deepEqual(cloned.accelMss, { x: 0.17, y: 0.09, z: 9.82 })
})

test('cloneLiveVerification copies accelMss rather than sharing it', () => {
  // The live object is rewritten in place as frames arrive at 10 Hz, so a
  // shared reference would let an already-emitted snapshot change underneath
  // whoever is reading it.
  const state = createIdleLiveVerification()
  state.accelMss = { x: 1, y: 2, z: 3 }
  const cloned = cloneLiveVerification(state)
  state.accelMss.x = 99
  assert.equal(cloned.accelMss.x, 1)
})

test('cloneLiveVerification leaves accelMss undefined when unset', () => {
  const cloned = cloneLiveVerification(createIdleLiveVerification())
  assert.equal(cloned.accelMss, undefined)
})

test('cloneLiveVerification is a deep copy (mutating the clone does not touch the source)', () => {
  const state = createIdleLiveVerification()
  const cloned = cloneLiveVerification(state)
  cloned.attitudeTelemetry.rollDeg = 12
  cloned.satisfiedSignals.push('rc-input')
  assert.notEqual(state.attitudeTelemetry.rollDeg, 12)
  assert.equal(state.satisfiedSignals.length, 0)
})
