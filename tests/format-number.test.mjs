import assert from 'node:assert/strict'
import test from 'node:test'

import { formatParamNumber, formatParamNumberInput } from '../packages/param-metadata/dist/index.js'

test('formatParamNumber renders exact integers with zero decimals', () => {
  assert.equal(formatParamNumber(0), '0')
  assert.equal(formatParamNumber(1500), '1500')
  assert.equal(formatParamNumber(-42), '-42')
})

test('formatParamNumber strips float32 mantissa noise past ~1e-7', () => {
  // Classic ArduPilot float32 round-trip noise: firmware stores 0.05 but
  // the PARAM_VALUE wire value is 0.0500000007450580596923828125.
  assert.equal(formatParamNumber(0.0500000007450580596923828125), '0.05')
  // 1.5 round-trips cleanly through float32 — should render as "1.5"
  // even without an explicit digits override.
  assert.equal(formatParamNumber(1.5), '1.5')
  // A genuinely noisy value within precision: 0.1 in float32 is
  // 0.100000001490116119384765625. We want to see "0.1", not the tail.
  assert.equal(formatParamNumber(0.1), '0.1')
})

test('formatParamNumber honors the digits override', () => {
  // Default rounds to 6 places; explicit digits=2 truncates further.
  assert.equal(formatParamNumber(1.23456789, { digits: 2 }), '1.23')
  assert.equal(formatParamNumber(3.14159265, { digits: 4 }), '3.1416')
})

test('formatParamNumber appends a unit suffix when provided', () => {
  assert.equal(formatParamNumber(11.1, { unit: 'V' }), '11.1 V')
  assert.equal(formatParamNumber(1500, { unit: 'us' }), '1500 us')
})

test('formatParamNumber returns the fallback for non-finite values', () => {
  assert.equal(formatParamNumber(undefined), '—')
  assert.equal(formatParamNumber(Number.NaN), '—')
  assert.equal(formatParamNumber(Number.POSITIVE_INFINITY), '—')
  assert.equal(formatParamNumber(undefined, { fallback: 'n/a' }), 'n/a')
})

test('formatParamNumberInput renders pure numeric strings for editors', () => {
  // No unit, empty fallback for non-finite, integer + float behavior
  // matches formatParamNumber otherwise.
  assert.equal(formatParamNumberInput(undefined), '')
  assert.equal(formatParamNumberInput(0), '0')
  assert.equal(formatParamNumberInput(0.0500000007450580596923828125), '0.05')
  assert.equal(formatParamNumberInput(1500), '1500')
})
