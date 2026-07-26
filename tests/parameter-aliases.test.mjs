import assert from 'node:assert/strict'
import test from 'node:test'

import { parameterAlias } from '../packages/ardupilot-core/dist/index.js'

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
