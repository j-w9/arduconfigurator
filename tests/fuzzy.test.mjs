import assert from 'node:assert/strict'
import test from 'node:test'

import { fuzzyScore, fuzzyScoreFields } from '../packages/param-metadata/dist/index.js'

test('empty query matches everything with score 0', () => {
  assert.equal(fuzzyScore('', 'BATT_VOLT'), 0)
  assert.equal(fuzzyScore('   ', 'BATT_VOLT'), 0)
})

test('non-subsequence returns null', () => {
  assert.equal(fuzzyScore('xyz', 'BATT_VOLT'), null)
  assert.equal(fuzzyScore('voltb', 'BATT_VOLT'), null) // out of order
})

test('subsequence matches and is case-insensitive', () => {
  assert.notEqual(fuzzyScore('btvolt', 'BATT_VOLT_MULT'), null)
  assert.notEqual(fuzzyScore('BTVOLT', 'batt_volt_mult'), null)
})

test('exact substring outranks a scattered subsequence', () => {
  const substr = fuzzyScore('volt', 'BATT_VOLT') // contiguous
  const scatter = fuzzyScore('bvt', 'BATT_VOLT') // subsequence
  assert.ok(substr !== null && scatter !== null)
  assert.ok(substr > scatter)
})

test('word-boundary / earlier match scores higher', () => {
  const boundary = fuzzyScore('gps', 'GPS_TYPE') // starts the string
  const mid = fuzzyScore('gps', 'X_GPS_RATE') // mid-string but on a boundary
  assert.ok(boundary !== null && mid !== null)
  assert.ok(boundary >= mid)
})

test('fuzzyScoreFields takes the best across fields', () => {
  // id has no match, label does.
  const score = fuzzyScoreFields('battery', ['BATT_MONITOR', 'Battery Monitor'])
  assert.ok(score !== null)
  // Neither field matches.
  assert.equal(fuzzyScoreFields('zzz', ['BATT_MONITOR', 'Battery Monitor']), null)
  // Undefined fields are skipped.
  assert.ok(fuzzyScoreFields('batt', ['BATT_MONITOR', undefined]) !== null)
})
