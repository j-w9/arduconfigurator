import assert from 'node:assert/strict'
import test from 'node:test'

import {
  deriveDraftValuesFromParameterPreset,
  evaluateParameterPresetApplicability
} from '../packages/ardupilot-core/dist/index.js'

// Edge-case coverage for preset applicability + diffing. The existing
// presets.test.mjs covers the frame-class block + compatible-multirotor paths;
// this fills in the remaining branches (non-Copter block, unknown frame class,
// no-compatibility presets, plural frame-class formatting, FRAME_CLASS rounding,
// and the diff's unknown/unchanged/changed accounting). Both functions read only
// snapshot.vehicle?.vehicle and snapshot.parameters, so a minimal shape suffices.
function snap(vehicle, params = {}) {
  return {
    vehicle: vehicle ? { vehicle } : undefined,
    parameters: Object.entries(params).map(([id, value]) => ({ id, value }))
  }
}
function preset(values, frameClasses) {
  return {
    id: 'test-preset',
    values: values.map(([paramId, value]) => ({ paramId, value })),
    ...(frameClasses ? { compatibility: { frameClasses } } : {})
  }
}

test('applicability blocks any non-ArduCopter vehicle outright', () => {
  for (const vehicle of ['ArduPlane', 'ArduRover', 'ArduSub']) {
    const result = evaluateParameterPresetApplicability(snap(vehicle, { FRAME_CLASS: 1 }), preset([['ANGLE_MAX', 4200]], [1]))
    assert.equal(result.status, 'blocked', `${vehicle} should be blocked`)
    assert.match(result.reasons[0], /ArduCopter/)
  }
})

test('applicability is ready when no vehicle is set yet and frame class matches', () => {
  const result = evaluateParameterPresetApplicability(snap(undefined, { FRAME_CLASS: 1 }), preset([['ANGLE_MAX', 4200]], [1]))
  assert.equal(result.status, 'ready')
  assert.deepEqual(result.reasons, [])
})

test('applicability is caution when the preset has frame compatibility but FRAME_CLASS is unknown', () => {
  const result = evaluateParameterPresetApplicability(snap('ArduCopter', {}), preset([['ANGLE_MAX', 4200]], [1]))
  assert.equal(result.status, 'caution')
  assert.match(result.reasons[0], /not known yet/i)
})

test('applicability is ready for a preset with no frame-class compatibility, any frame', () => {
  const result = evaluateParameterPresetApplicability(snap('ArduCopter', { FRAME_CLASS: 6 }), preset([['ANGLE_MAX', 4200]]))
  assert.equal(result.status, 'ready')
})

test('applicability blocks on frame mismatch with plural frame-class formatting', () => {
  const result = evaluateParameterPresetApplicability(snap('ArduCopter', { FRAME_CLASS: 6 }), preset([['ANGLE_MAX', 4200]], [1, 2]))
  assert.equal(result.status, 'blocked')
  assert.match(result.reasons[0], /FRAME_CLASS values 1, 2/)
})

test('applicability rounds FRAME_CLASS before matching', () => {
  // 1.4 rounds to 1 (match → ready); 5.6 rounds to 6 (no match → blocked).
  assert.equal(evaluateParameterPresetApplicability(snap('ArduCopter', { FRAME_CLASS: 1.4 }), preset([['ANGLE_MAX', 4200]], [1])).status, 'ready')
  assert.equal(evaluateParameterPresetApplicability(snap('ArduCopter', { FRAME_CLASS: 5.6 }), preset([['ANGLE_MAX', 4200]], [1])).status, 'blocked')
})

test('diff tracks unknown params separately and excludes them from draftValues/matchedCount', () => {
  const s = snap('ArduCopter', { ANGLE_MAX: 3000 })
  const diff = deriveDraftValuesFromParameterPreset(s.parameters, preset([['ANGLE_MAX', 4200], ['GHOST_PARAM', 1]]))
  assert.deepEqual(diff.unknownParameterIds, ['GHOST_PARAM'])
  assert.deepEqual(diff.draftValues, { ANGLE_MAX: '4200' })
  assert.equal(diff.changedCount, 1)
  assert.equal(diff.matchedCount, 1) // unknown excluded from matched
})

test('diff stages only changed values; unchanged are counted but not staged', () => {
  const s = snap('ArduCopter', { ANGLE_MAX: 4200, PILOT_Y_EXPO: 0.1 })
  const diff = deriveDraftValuesFromParameterPreset(s.parameters, preset([['ANGLE_MAX', 4200], ['PILOT_Y_EXPO', 0.2]]))
  assert.equal(diff.unchangedCount, 1)
  assert.equal(diff.changedCount, 1)
  assert.deepEqual(diff.draftValues, { PILOT_Y_EXPO: '0.2' })
  assert.equal(diff.matchedCount, 2)
})
