// Controller gains never go negative in ArduPilot: a negative P, I or D turns
// the loop's correction around. Many gains carry no documented minimum (the
// position controller, 4.7's renamed ones), so the range check let a negative
// value through, and where a minimum of 0 exists the "Override and write
// anyway" button bypassed it. A negative gain is now refused with no override.

import assert from 'node:assert/strict'
import test from 'node:test'

import { deriveParameterDraftEntries, isNonNegativeGainParameterId } from '../packages/ardupilot-core/dist/index.js'

const param = (id, value, definition) => ({ id, value, definition })
const entry = (parameters, drafts, overrides) =>
  deriveParameterDraftEntries(parameters, drafts, overrides)[0]

test('gain ids: rate, angle, position controller (4.6 and 4.7 names) and Plane rate loops', () => {
  for (const id of [
    'ATC_RAT_RLL_P', 'ATC_RAT_PIT_I', 'ATC_RAT_YAW_D', 'ATC_RAT_RLL_FF', 'ATC_RAT_PIT_D_FF',
    'ATC_RAT_YAW_IMAX', 'ATC_RAT_RLL_PDMX', 'ATC_RAT_PIT_SMAX', 'ATC_ANG_RLL_P', 'ATC_ANG_YAW_P',
    'PSC_POSXY_P', 'PSC_VELXY_I', 'PSC_ACCZ_P', 'PSC_ACCZ_IMAX', 'PSC_D_ACC_P', 'PSC_D_VEL_P', 'PSC_NE_POS_P',
    'RLL_RATE_P', 'PTCH_RATE_D', 'YAW_RATE_FF'
  ]) {
    assert.equal(isNonNegativeGainParameterId(id), true, id)
  }
})

test('not gains: filters, time constants, limits that are not gain caps, and unrelated params', () => {
  for (const id of ['ATC_RAT_RLL_FLTD', 'ATC_INPUT_TC', 'ATC_ACC_R_MAX', 'INS_GYRO_FILTER', 'SERVO1_TRIM', 'FS_OPTIONS', 'PSC_JERK_XY']) {
    assert.equal(isNonNegativeGainParameterId(id), false, id)
  }
})

test('a negative gain is invalid even with no documented minimum, and cannot be overridden', () => {
  const parameters = [param('PSC_D_ACC_P', 0.05, undefined)]
  const blocked = entry(parameters, { PSC_D_ACC_P: '-0.05' })
  assert.equal(blocked.status, 'invalid')
  assert.equal(blocked.overridable, false)
  assert.match(blocked.reason, /negative/i)
  // "Override and write anyway" does not carry it through either.
  const overridden = entry(parameters, { PSC_D_ACC_P: '-0.05' }, new Set(['PSC_D_ACC_P']))
  assert.equal(overridden.status, 'invalid')
})

test('a curated gain with minimum 0 is refused without the override offer', () => {
  const parameters = [param('ATC_RAT_RLL_P', 0.135, { id: 'ATC_RAT_RLL_P', label: 'Roll rate P', minimum: 0, maximum: 0.5 })]
  const blocked = entry(parameters, { ATC_RAT_RLL_P: '-0.1' })
  assert.equal(blocked.status, 'invalid')
  assert.equal(blocked.overridable, false)
})

test('zero and positive gains still stage, and other params keep their old rules', () => {
  const parameters = [param('ATC_RAT_RLL_D', 0.003, undefined), param('SERVO1_TRIM', 1500, undefined)]
  assert.equal(entry(parameters, { ATC_RAT_RLL_D: '0' }).status, 'staged')
  assert.equal(entry(parameters, { ATC_RAT_RLL_D: '0.004' }).status, 'staged')
  // A non-gain with no minimum is unaffected by this rule.
  assert.equal(entry([parameters[1]], { SERVO1_TRIM: '-5' }).status, 'staged')
})
