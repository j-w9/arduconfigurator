import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  mergeUpstreamParameters,
  UPSTREAM_PARAMETER_CATEGORY,
  arducopterMetadata,
  normalizeFirmwareMetadata
} from '../packages/param-metadata/dist/index.js'

const here = dirname(fileURLToPath(import.meta.url))
const upstreamCopter = JSON.parse(
  readFileSync(join(here, '..', 'apps', 'web', 'src', 'generated', 'param-upstream', 'arducopter.json'), 'utf8')
)

test('mergeUpstreamParameters fills gaps on curated params without overriding them', () => {
  const handAuthored = {
    FOO: { id: 'FOO', label: 'Curated Foo', description: 'Curated description', category: 'tuning' }
  }
  const upstream = {
    FOO: {
      label: 'Upstream Foo',
      description: 'Upstream description',
      unit: 'm',
      minimum: 0,
      maximum: 10,
      options: [{ value: 0, label: 'Off' }]
    }
  }
  const merged = mergeUpstreamParameters(handAuthored, upstream)
  // Curated label/description/category win.
  assert.equal(merged.FOO.label, 'Curated Foo')
  assert.equal(merged.FOO.description, 'Curated description')
  assert.equal(merged.FOO.category, 'tuning')
  // Missing scalar fields are filled from upstream.
  assert.equal(merged.FOO.unit, 'm')
  assert.equal(merged.FOO.minimum, 0)
  assert.equal(merged.FOO.maximum, 10)
  assert.deepEqual(merged.FOO.options, [{ value: 0, label: 'Off' }])
})

test('mergeUpstreamParameters adds upstream-only params into the advanced category', () => {
  const merged = mergeUpstreamParameters({}, {
    BAR_ONLY: { label: 'Bar', description: 'Bar desc', bitmask: true, options: [{ value: 0, label: 'Bit0' }] }
  })
  assert.equal(merged.BAR_ONLY.category, UPSTREAM_PARAMETER_CATEGORY)
  assert.equal(merged.BAR_ONLY.label, 'Bar')
  assert.equal(merged.BAR_ONLY.bitmask, true)
})

test('real upstream import enriches the curated ArduCopter catalog', () => {
  const before = arducopterMetadata.parameters
  const merged = mergeUpstreamParameters(before, upstreamCopter)

  // The import covers thousands of params — far more than the curated set.
  assert.ok(Object.keys(merged).length > Object.keys(before).length + 1000)

  // A curated param keeps its curated label even if upstream has one.
  const curatedId = Object.keys(before)[0]
  assert.equal(merged[curatedId].label, before[curatedId].label)

  // A representative upstream param (rate controller P gain) is present with
  // real metadata and lands in the advanced category if it wasn't curated.
  const sample = merged.ATC_RAT_RLL_P
  assert.ok(sample, 'ATC_RAT_RLL_P should exist after the merge')
  assert.ok(typeof sample.description === 'string' && sample.description.length > 0)

  // Normalizing the enriched bundle routes uncurated upstream params to the
  // Parameters view (via the fallback category) and doesn't throw.
  const normalized = normalizeFirmwareMetadata({ ...arducopterMetadata, parameters: merged })
  const advanced = normalized.categoryById[UPSTREAM_PARAMETER_CATEGORY]
  assert.ok(advanced, 'advanced category should be created for upstream-only params')
  assert.equal(advanced.viewId, 'parameters')
})

// Upstream publishes metadata under the MODERN name only. A controller on older
// firmware streams the LEGACY one, so the row rendered with no metadata at all
// even though the description existed under the other name — found by loading
// the app against the demo vehicle and counting rows showing the
// "Metadata to be expanded from upstream ArduPilot bundles" placeholder.
test('upstream metadata resolves through a legacy parameter rename', () => {
  const merged = mergeUpstreamParameters(
    {},
    {
      CAM1_SERVO_ON: {
        label: 'Camera servo ON PWM value',
        description: 'PWM value in microseconds to move servo to when shutter is activated',
        unit: 'PWM',
        minimum: 1000,
        maximum: 2000
      }
    },
    { CAM_SERVO_ON: 'CAM1_SERVO_ON' }
  )

  assert.ok(merged.CAM_SERVO_ON, 'the legacy name must resolve to the modern metadata')
  assert.equal(merged.CAM_SERVO_ON.label, 'Camera servo ON PWM value')
  assert.equal(merged.CAM_SERVO_ON.unit, 'PWM')
  // The id stays the LEGACY one: it is what the controller reports and what the
  // UI must show, even though the description came from the modern entry.
  assert.equal(merged.CAM_SERVO_ON.id, 'CAM_SERVO_ON')
  // The modern entry is untouched.
  assert.equal(merged.CAM1_SERVO_ON.id, 'CAM1_SERVO_ON')
})

test('a curated legacy definition always wins over the alias mirror', () => {
  // The mirror fills a GAP; it must never overwrite curation. CAM_DURATION is
  // the case that matters — it is curated deliberately because its rename also
  // changed units, so borrowing the modern metadata would be wrong.
  const merged = mergeUpstreamParameters(
    {
      CAM_DURATION: {
        id: 'CAM_DURATION',
        label: 'Camera Shutter Duration',
        description: 'deci-seconds',
        category: 'peripherals',
        unit: 'ds',
        minimum: 0,
        maximum: 50
      }
    },
    { CAM1_DURATION: { label: 'Camera shutter duration held open', unit: 's', minimum: 0, maximum: 5 } },
    { CAM_DURATION: 'CAM1_DURATION' }
  )

  assert.equal(merged.CAM_DURATION.unit, 'ds', 'the curated deci-second unit must survive')
  assert.equal(merged.CAM_DURATION.maximum, 50)
})

test('no alias map leaves the merge exactly as it was', () => {
  const upstream = { CAM1_SERVO_ON: { label: 'Camera servo ON PWM value' } }
  const withoutAliases = mergeUpstreamParameters({}, upstream)
  assert.equal(withoutAliases.CAM_SERVO_ON, undefined)
  assert.ok(withoutAliases.CAM1_SERVO_ON)
})

test('notch-filter index parameters are indices, not frequencies', () => {
  // ArduPilot declares NTF/NEF with no units and @Range 0 8 (AC_PID.cpp), and 0
  // -- the firmware default -- means "no notch attached". The generated
  // upstream metadata carries a stray "Hz" on ATC_RAT_YAW_NTF and a minimum of
  // 1 on all six, so the app mislabelled a filter index as a frequency and
  // refused the value the firmware ships with.
  const upstream = JSON.parse(
    readFileSync(join(here, '../apps/web/src/generated/param-upstream/arducopter.json'), 'utf8')
  )
  // Guard the premise: if the generated data is ever fixed upstream, this test
  // should stop claiming to defend against something that is no longer there.
  assert.equal(upstream.ATC_RAT_YAW_NTF.unit, 'Hz', 'the upstream defect this override exists for')
  assert.equal(upstream.ATC_RAT_YAW_NTF.minimum, 1)

  const merged = mergeUpstreamParameters(arducopterMetadata.parameters, upstream)
  for (const axis of ['RLL', 'PIT', 'YAW']) {
    for (const suffix of ['NTF', 'NEF']) {
      const id = `ATC_RAT_${axis}_${suffix}`
      const definition = merged[id]
      assert.ok(definition, `${id} should be in the catalog`)
      assert.equal(definition.unit, 'index', `${id} is an index, not a frequency`)
      assert.equal(definition.minimum, 0, `${id} must accept 0 — the firmware default, meaning no notch`)
      assert.equal(definition.maximum, 8, `${id} range from AC_PID.cpp`)
    }
  }
})
