import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import {
  arducopterMetadata,
  categoryForParameterId,
  normalizeFirmwareMetadata
} from '../packages/param-metadata/dist/index.js'
import * as mockScenario from '../packages/protocol-mavlink/dist/mock-scenario.js'

// ArduPilot's own grouping, pinned in the repo for the wiki generator: the
// top-level keys of apm.pdef.json ARE the parameter groups. Checking the
// fallback against it means the mapping is measured against the real parameter
// set rather than against the handful of families someone thought of.
const PDEF = JSON.parse(
  fs.readFileSync(new URL('../wiki/data/apm.pdef.Copter-4.7.json', import.meta.url), 'utf8')
)

const groups = Object.entries(PDEF).filter(
  ([, params]) => params && typeof params === 'object' && Object.keys(params).length > 0
)

/**
 * Families this app deliberately has no home for, so "Uncategorized" is the
 * honest answer rather than a forced fit:
 *   SIM_*      SITL only — a real board never reports them
 *   Lua Script scripting parameters, which are whatever a script declares
 *   json       a metadata artefact, not a parameter group
 */
const INTENTIONALLY_UNMAPPED = [/^SIM_/, /^Lua Script$/, /^json$/]
const intentional = (name) => INTENTIONALLY_UNMAPPED.some((pattern) => pattern.test(name))

test('every ArduPilot parameter group maps to a category', () => {
  const unmapped = new Map()
  for (const [group, params] of groups) {
    if (intentional(group)) continue
    for (const name of Object.keys(params)) {
      if (categoryForParameterId(name) === undefined) {
        if (!unmapped.has(group)) unmapped.set(group, [])
        unmapped.get(group).push(name)
      }
    }
  }
  const summary = [...unmapped.entries()]
    .map(([group, names]) => `${group} (${names.length}, e.g. ${names.slice(0, 3).join(', ')})`)
    .join('\n  ')
  assert.equal(unmapped.size, 0, `parameter groups with no category:\n  ${summary}`)
})

test('the families that prompted this are categorised', () => {
  // The report: "a ton of items in uncategorized — RC channels above 6, ATC
  // params, OSD params".
  assert.equal(categoryForParameterId('RC7_MIN'), 'radio')
  assert.equal(categoryForParameterId('RC16_OPTION'), 'radio')
  assert.equal(categoryForParameterId('ATC_ANG_PIT_P'), 'tuning')
  assert.equal(categoryForParameterId('OSD1_ACRVOLT_EN'), 'osd')
  assert.equal(categoryForParameterId('OSD_CELL_COUNT'), 'osd')
})

test('an instance number never changes the answer', () => {
  // A rule per instance goes stale the moment ArduPilot adds another battery
  // monitor or rangefinder, so the family is what is matched.
  for (const [a, b] of [
    ['BATT_AMP_OFFSET', 'BATTG_AMP_OFFSET'],
    ['RNGFND1_TYPE', 'RNGFND9_TYPE'],
    ['EK2_ENABLE', 'EK3_ENABLE'],
    ['SERVO1_FUNCTION', 'SERVO16_FUNCTION'],
    ['RC1_MIN', 'RC16_MIN']
  ]) {
    assert.equal(categoryForParameterId(a), categoryForParameterId(b), `${a} vs ${b}`)
  }
})

test('a more specific rule wins over the family it sits in', () => {
  // The harmonic notch is filtering that happens to live on INS_.
  assert.equal(categoryForParameterId('INS_HNTCH_FREQ'), 'filters')
  assert.equal(categoryForParameterId('INS_HNTC2_FREQ'), 'filters')
  assert.equal(categoryForParameterId('INS_LOG_BAT_MASK'), 'logging')
  assert.equal(categoryForParameterId('INS_GYRO_FILTER'), 'sensors')
})

test('SITL and script parameters stay uncategorised rather than forced', () => {
  assert.equal(categoryForParameterId('SIM_GPS1_TYPE'), undefined)
})


// The pdef above is ArduCopter only, and it is UPSTREAM — so it cannot see the
// fork's own parameters (ACC_ZBIAS_LEARN, RCL_*, VALT_*) or the Rover/Sub
// families. ACC_ZBIAS_LEARN was found sitting in "Uncategorized" in the running
// app for exactly that reason. The demo vehicles are the parameter sets this
// app actually ships against, so they close the gap.
test('every parameter the demo vehicles report has a category', () => {
  const catalog = normalizeFirmwareMetadata(arducopterMetadata)
  const curated = (id) => Boolean(catalog.parameters[id] && catalog.parameters[id].category)

  const vehicles = Object.keys(mockScenario).filter(
    (key) => /Parameters$/.test(key) && mockScenario[key] && typeof mockScenario[key] === 'object'
  )
  assert.ok(vehicles.length > 0, 'found no mock parameter sets to check')

  const gaps = []
  for (const vehicle of vehicles) {
    for (const id of Object.keys(mockScenario[vehicle])) {
      if (!curated(id) && categoryForParameterId(id) === undefined) {
        gaps.push(`${vehicle}: ${id}`)
      }
    }
  }
  assert.deepEqual(gaps, [], `demo parameters with no category:\n  ${gaps.join('\n  ')}`)
})
