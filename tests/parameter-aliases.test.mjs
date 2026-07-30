import assert from 'node:assert/strict'
import test from 'node:test'

import { LEGACY_PARAM_ALIASES, parameterAlias } from '../packages/ardupilot-core/dist/index.js'

test('parameterAlias resolves a legacy id to its modern name', () => {
  // GPS_TYPE (legacy) -> GPS1_TYPE (modern). The alias is NOT the legacy one.
  assert.deepEqual(parameterAlias('GPS_TYPE'), { name: 'GPS1_TYPE', aliasIsLegacy: false })
  assert.deepEqual(parameterAlias('SYSID_THISMAV'), { name: 'MAV_SYSID', aliasIsLegacy: false })
})

test('parameterAlias resolves a modern id back to its legacy (old) name', () => {
  // MAV_SYSID (modern) -> SYSID_THISMAV (legacy). The alias IS the old name.
  assert.deepEqual(parameterAlias('MAV_SYSID'), { name: 'SYSID_THISMAV', aliasIsLegacy: true })
  assert.deepEqual(parameterAlias('FLTMODE_CH'), { name: 'MODE_CH', aliasIsLegacy: true })
})

test('parameterAlias returns undefined for a param with no rename', () => {
  assert.equal(parameterAlias('ATC_RAT_RLL_P'), undefined)
  assert.equal(parameterAlias('NOT_A_PARAM'), undefined)
})

// A rename that ALSO changes units must never be aliased: the alias makes the
// two names interchangeable for metadata, so a unit change would put the wrong
// unit and range on the value the controller actually reports.
test('renames that changed units are deliberately excluded from the alias table', () => {
  for (const excluded of [
    // AP_Camera.cpp: "convert CAM_DURATION (in deci-seconds) to CAM1_DURATION
    // (in seconds)" — a *0.1 factor.
    'CAM_DURATION',
    // cm/s -> m/s.
    'TRIM_ARSPD_CM'
  ]) {
    assert.equal(
      LEGACY_PARAM_ALIASES[excluded],
      undefined,
      `${excluded} changed units across the rename and must not be aliased`
    )
  }
})

test('the camera servo renames ARE aliased (pure renames, same PWM value)', () => {
  // Verified against AP_Camera.cpp's own conversion table, k_param_camera_key
  // indices 2 and 3: same INT16, no scaling.
  assert.equal(LEGACY_PARAM_ALIASES.CAM_SERVO_ON, 'CAM1_SERVO_ON')
  assert.equal(LEGACY_PARAM_ALIASES.CAM_SERVO_OFF, 'CAM1_SERVO_OFF')
})
