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

test('cloneLiveVerification is a deep copy (mutating the clone does not touch the source)', () => {
  const state = createIdleLiveVerification()
  const cloned = cloneLiveVerification(state)
  cloned.attitudeTelemetry.rollDeg = 12
  cloned.satisfiedSignals.push('rc-input')
  assert.notEqual(state.attitudeTelemetry.rollDeg, 12)
  assert.equal(state.satisfiedSignals.length, 0)
})
