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
