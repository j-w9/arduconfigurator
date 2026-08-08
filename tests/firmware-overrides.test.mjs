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

test('base catalog carries the 4.6 values for everything that genuinely changed in 4.7', () => {
  // Only real version deltas belong here. Four entries that used to be asserted
  // in this test were removed from the override table entirely: SERVO_DSHOT_RATE,
  // MOT_PWM_TYPE, RSSI_TYPE and RSSI_CHAN_LOW/HIGH are IDENTICAL on
  // Copter-4.6.3 and 4.7 (verified by regenerating apm.pdef.json at both refs),
  // so treating them as 4.7-only served WRONG metadata to 4.6 — the firmware
  // line this repo treats as its validated trust anchor. See the next test.
  assert.equal(optLabel(base.parameters.FS_THR_ENABLE, 6), 'Auto DO_LAND_START or RTL')
  assert.equal(optLabel(base.parameters.BATT_FS_LOW_ACT, 0), 'None')
  assert.equal(base.parameters.VTX_POWER.maximum, 5000)
  // FLOW_TYPE 10:SITL is a genuine 4.7 addition; the base must not offer it.
  assert.equal(optLabel(base.parameters.FLOW_TYPE, 10), undefined)
})

test('values that were never 4.7-only are correct in the BASE catalog, so 4.6 gets them too', () => {
  // Each of these was verified against tag Copter-4.6.3:
  //   SRV_Channels.cpp  "0:1Khz,1:loop-rate,...,4:quadruple loop rate"
  //   AP_MotorsMulticopter.cpp  "...,8:PWMRange,9:PWMAngle"
  //   AP_RSSI.cpp  "...,4:PWMInputPin,5:TelemetryRadioRSSI" and "@Range: 0 2000"
  assert.equal(base.parameters.SERVO_DSHOT_RATE.maximum, 4)
  assert.match(optLabel(base.parameters.SERVO_DSHOT_RATE, 0) ?? '', /1 kHz/i)
  // 5-7 were phantoms the firmware clamps, and 0 did not mean "1x loop rate".
  assert.equal(optLabel(base.parameters.SERVO_DSHOT_RATE, 5), undefined)

  assert.equal(base.parameters.MOT_PWM_TYPE.maximum, 9)
  assert.equal(optLabel(base.parameters.MOT_PWM_TYPE, 9), 'PWMAngle')

  assert.equal(base.parameters.RSSI_TYPE.maximum, 5)
  assert.match(optLabel(base.parameters.RSSI_TYPE, 5) ?? '', /telemetry radio/i)
  assert.equal(base.parameters.RSSI_CHAN_LOW.minimum, 0)
  assert.equal(base.parameters.RSSI_CHAN_LOW.maximum, 2000)
})

test('COMPASS_DISBLMSK does not offer bit 23, which no ArduPilot release defines', () => {
  // AP_Compass.h: "DRIVER_LIS2MDL = 23, // DO NOT re-use this ID; same sensor
  // as IIS2MDC". Offering it meant ticking "LIS2MDL" wrote a bit the firmware
  // ignores, so the compass stayed enabled with no error shown.
  const bits = base.parameters.COMPASS_DISBLMSK.options ?? []
  assert.equal(bits.find((option) => option.value === 23), undefined)
  assert.match(bits.find((option) => option.value === 22)?.label ?? '', /IIS2MDC/)
})

test('catalog override is a no-op for 4.6 / unknown / non-copter (same object)', () => {
  assert.equal(applyArducopter47CatalogOverrides(base, undefined, true), base)
  assert.equal(applyArducopter47CatalogOverrides(base, V46, true), base)
  assert.equal(applyArducopter47CatalogOverrides(base, V47, false), base)
})

test('catalog override applies every 4.7 correction for a >= 4.7 copter build', () => {
  const c = applyArducopter47CatalogOverrides(base, V47, true)
  assert.notEqual(c, base)

  // Ranges.
  assert.equal(c.parameters.VTX_POWER.maximum, 1000)
  assert.equal(c.parameters.VTX_MAX_POWER.minimum, 25)
  assert.equal(c.parameters.VTX_MAX_POWER.maximum, 1000)

  // Failsafe labels gain DO_RETURN_PATH_START; battery value 0 becomes "Warn only".
  assert.match(optLabel(c.parameters.FS_THR_ENABLE, 6) ?? '', /DO_RETURN_PATH_START/)
  assert.match(optLabel(c.parameters.FS_GCS_ENABLE, 6) ?? '', /DO_RETURN_PATH_START/)
  assert.match(optLabel(c.parameters.BATT_FS_LOW_ACT, 0) ?? '', /warn only/i)
  assert.match(optLabel(c.parameters.BATT_FS_CRT_ACT, 6) ?? '', /DO_RETURN_PATH_START/)

  // The base catalog must NOT be mutated in place.
  assert.equal(base.parameters.VTX_POWER.maximum, 5000)
  assert.equal(optLabel(base.parameters.FS_THR_ENABLE, 6), 'Auto DO_LAND_START or RTL')
})

test('per-definition override gates on version and only touches mapped params', () => {
  const flowDef = base.parameters.FLOW_TYPE
  assert.equal(applyArducopter47Override(flowDef, V46), flowDef) // < 4.7 → unchanged (identity)
  assert.equal(applyArducopter47Override(flowDef, undefined), flowDef) // unknown → unchanged
  const overridden = applyArducopter47Override(flowDef, V47)
  assert.notEqual(overridden, flowDef)
  assert.equal(overridden.maximum, 10)

  // A param with no 4.7 override is returned unchanged even on 4.7.
  const tuning = base.parameters.ATC_RAT_RLL_P
  assert.equal(applyArducopter47Override(tuning, V47), tuning)
})
