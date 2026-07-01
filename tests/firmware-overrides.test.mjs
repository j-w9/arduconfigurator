import assert from 'node:assert/strict'
import test from 'node:test'

import { arducopterMetadata, normalizeFirmwareMetadata } from '../packages/param-metadata/dist/index.js'
import {
  applyArducopter47CatalogOverrides,
  applyArducopter47Override
} from '../packages/ardupilot-core/dist/index.js'

// The base catalog stays at the 4.6 values (byte-identical for a 4.6 FC /
// pre-connect / Unknown). The 4.7 corrections apply ONLY when a >= 4.7 build is
// detected — see arducopter-4.7-overrides.ts + firmware-overrides.ts.

const base = normalizeFirmwareMetadata(arducopterMetadata)
const V47 = { major: 4, minor: 7, patch: 0 }
const V46 = { major: 4, minor: 6, patch: 0 }
const optLabel = (def, value) => def?.options?.find((o) => o.value === value)?.label

test('base catalog carries the OLD 4.6 values (untouched by the revert)', () => {
  assert.equal(base.parameters.MOT_PWM_TYPE.maximum, 8)
  assert.equal(optLabel(base.parameters.MOT_PWM_TYPE, 9), undefined)
  assert.equal(optLabel(base.parameters.RSSI_TYPE, 5), undefined)
  assert.equal(optLabel(base.parameters.SERVO_DSHOT_RATE, 0), '1x loop rate')
  assert.equal(base.parameters.SERVO_DSHOT_RATE.maximum, 7)
  assert.equal(optLabel(base.parameters.FS_THR_ENABLE, 6), 'Auto DO_LAND_START or RTL')
  assert.equal(optLabel(base.parameters.BATT_FS_LOW_ACT, 0), 'None')
  assert.equal(base.parameters.RSSI_CHAN_LOW.minimum, 800)
  assert.equal(base.parameters.VTX_POWER.maximum, 5000)
})

test('catalog override is a no-op for 4.6 / unknown / non-copter (same object)', () => {
  assert.equal(applyArducopter47CatalogOverrides(base, undefined, true), base)
  assert.equal(applyArducopter47CatalogOverrides(base, V46, true), base)
  assert.equal(applyArducopter47CatalogOverrides(base, V47, false), base)
})

test('catalog override applies every 4.7 correction for a >= 4.7 copter build', () => {
  const c = applyArducopter47CatalogOverrides(base, V47, true)
  assert.notEqual(c, base)

  // SERVO_DSHOT_RATE corrected: 0 = fixed 1 kHz, only 0-4.
  assert.equal(c.parameters.SERVO_DSHOT_RATE.maximum, 4)
  assert.match(optLabel(c.parameters.SERVO_DSHOT_RATE, 0) ?? '', /1 kHz/)
  assert.equal(optLabel(c.parameters.SERVO_DSHOT_RATE, 5), undefined)

  // Enum additions.
  assert.equal(optLabel(c.parameters.MOT_PWM_TYPE, 9), 'PWMAngle')
  assert.equal(c.parameters.MOT_PWM_TYPE.maximum, 9)
  assert.match(optLabel(c.parameters.RSSI_TYPE, 5) ?? '', /telemetry radio/i)
  assert.equal(c.parameters.RSSI_TYPE.maximum, 5)

  // Ranges.
  assert.equal(c.parameters.RSSI_CHAN_LOW.minimum, 0)
  assert.equal(c.parameters.RSSI_CHAN_LOW.maximum, 2000)
  assert.equal(c.parameters.RSSI_CHAN_HIGH.maximum, 2000)
  assert.equal(c.parameters.VTX_POWER.maximum, 1000)
  assert.equal(c.parameters.VTX_MAX_POWER.minimum, 25)
  assert.equal(c.parameters.VTX_MAX_POWER.maximum, 1000)

  // Failsafe labels gain DO_RETURN_PATH_START; battery value 0 becomes "Warn only".
  assert.match(optLabel(c.parameters.FS_THR_ENABLE, 6) ?? '', /DO_RETURN_PATH_START/)
  assert.match(optLabel(c.parameters.FS_GCS_ENABLE, 6) ?? '', /DO_RETURN_PATH_START/)
  assert.match(optLabel(c.parameters.BATT_FS_LOW_ACT, 0) ?? '', /warn only/i)
  assert.match(optLabel(c.parameters.BATT_FS_CRT_ACT, 6) ?? '', /DO_RETURN_PATH_START/)

  // The base catalog must NOT be mutated in place.
  assert.equal(base.parameters.MOT_PWM_TYPE.maximum, 8)
  assert.equal(optLabel(base.parameters.FS_THR_ENABLE, 6), 'Auto DO_LAND_START or RTL')
})

test('per-definition override gates on version and only touches mapped params', () => {
  const motDef = base.parameters.MOT_PWM_TYPE
  assert.equal(applyArducopter47Override(motDef, V46), motDef) // < 4.7 → unchanged (identity)
  assert.equal(applyArducopter47Override(motDef, undefined), motDef) // unknown → unchanged
  const overridden = applyArducopter47Override(motDef, V47)
  assert.notEqual(overridden, motDef)
  assert.equal(overridden.maximum, 9)

  // A param with no 4.7 override is returned unchanged even on 4.7.
  const tuning = base.parameters.ATC_RAT_RLL_P
  assert.equal(applyArducopter47Override(tuning, V47), tuning)
})
