import assert from 'node:assert/strict'
import test from 'node:test'

import {
  arduroverMockParameters,
  ardusubMockParameters
} from '../packages/protocol-mavlink/dist/mock-scenario.js'

const COPTER_ONLY = [
  'FRAME_CLASS',
  'FRAME_TYPE',
  'FLTMODE_CH',
  'FLTMODE1',
  'FLTMODE2',
  'FLTMODE3',
  'FLTMODE4',
  'FLTMODE5',
  'FLTMODE6'
]

test('demo-rover mock does not leak Copter-only mode/frame params', () => {
  for (const key of COPTER_ONLY) {
    assert.equal(key in arduroverMockParameters, false, `${key} must not be in the Rover mock`)
  }
  // Vehicle-specific Rover params remain...
  assert.equal(arduroverMockParameters.MODE_CH, 8)
  assert.equal(arduroverMockParameters.MODE1, 0)
  // ...and the vehicle-neutral inherited base is preserved.
  assert.ok('COMPASS_USE' in arduroverMockParameters, 'neutral base param retained')
})

test('demo-sub mock does not leak Copter-only mode/frame params', () => {
  for (const key of COPTER_ONLY) {
    assert.equal(key in ardusubMockParameters, false, `${key} must not be in the Sub mock`)
  }
  assert.equal(ardusubMockParameters.FRAME_CONFIG, 1)
  assert.ok('COMPASS_USE' in ardusubMockParameters, 'neutral base param retained')
})
