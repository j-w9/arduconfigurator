import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildParametersFromBackup,
  deriveDraftValuesFromParameterBackup
} from '../packages/ardupilot-core/dist/index.js'

// buildParametersFromBackup synthesizes a ParameterState[] from a saved
// backup file so the snapshot-vs-snapshot compare path can reuse the
// SAME diff machinery (deriveDraftValuesFromParameterBackup) that the
// snapshot-vs-live path already uses. Tests cover the load-bearing
// invariants: alias mirrors filtered out, definitions hydrated from
// the reference snapshot, unknown ids preserved as bare entries, and
// the end-to-end diff over two backups producing the expected drafts.

function makeBackup(entries) {
  return {
    schemaVersion: 1,
    application: 'ArduConfigurator',
    appVersion: '0.0.0-test',
    firmware: 'ArduCopter',
    exportedAt: new Date('2026-06-08').toISOString(),
    parameterCount: entries.length,
    parameters: entries.map((entry) => ({ ...entry }))
  }
}

function definition(extra = {}) {
  return { label: 'p', category: 'tuning', ...extra }
}

test('buildParametersFromBackup hydrates definition from the reference map where ids match', () => {
  const backup = makeBackup([
    { id: 'PILOT_SPEED_UP', value: 250 },
    { id: 'PILOT_SPEED_DN', value: 250 }
  ])
  const referenceById = new Map([
    ['PILOT_SPEED_UP', { id: 'PILOT_SPEED_UP', value: 100, index: 0, count: 2, definition: definition({ unit: 'cm/s' }) }],
    ['PILOT_SPEED_DN', { id: 'PILOT_SPEED_DN', value: 100, index: 1, count: 2, definition: definition({ unit: 'cm/s' }) }]
  ])

  const out = buildParametersFromBackup(backup, referenceById)

  assert.equal(out.length, 2)
  assert.equal(out[0].id, 'PILOT_SPEED_UP')
  assert.equal(out[0].value, 250, 'value comes from the backup, NOT the reference (the reference is just for definition hydration)')
  assert.equal(out[0].definition?.unit, 'cm/s', 'definition is hydrated from the reference map')
  assert.equal(out[0].count, 2)
  assert.equal(out[0].index, 0)
})

test('buildParametersFromBackup leaves definition undefined for ids the reference does not know', () => {
  // A snapshot from an older firmware version may carry params that no
  // longer exist in the current live metadata. The diff entries should
  // still surface them (as bare-id rows) rather than silently dropping.
  const backup = makeBackup([
    { id: 'DELETED_PARAM_FROM_OLDER_FIRMWARE', value: 42 }
  ])
  const referenceById = new Map()

  const out = buildParametersFromBackup(backup, referenceById)

  assert.equal(out.length, 1)
  assert.equal(out[0].id, 'DELETED_PARAM_FROM_OLDER_FIRMWARE')
  assert.equal(out[0].value, 42)
  assert.equal(out[0].definition, undefined)
})

test('buildParametersFromBackup applies the snapshot-excluded prefix filter (STAT_*) so volatile system counters never enter the baseline', () => {
  // Same prefix exclusion the serializer + the snapshot-vs-live diff
  // already use. Without this, STAT_BOOTCNT / STAT_RUNTIME / etc.
  // would surface as "changed" between any two snapshots taken at
  // different uptimes even when the operator changed nothing.
  const backup = makeBackup([
    { id: 'PILOT_SPEED_UP', value: 250 },
    { id: 'STAT_BOOTCNT', value: 42 },
    { id: 'STAT_RUNTIME', value: 12345 }
  ])

  const out = buildParametersFromBackup(backup, new Map())
  const ids = out.map((parameter) => parameter.id)

  assert.deepEqual(ids, ['PILOT_SPEED_UP'], 'STAT_* volatile counters filtered out of the baseline')
})

test('end-to-end: snapshot-vs-snapshot diff over two backups via build + derive', () => {
  // Mirrors the actual App.tsx flow: take two backup files, build the
  // baseline ParameterState[] from backup A, then run
  // deriveDraftValuesFromParameterBackup(baseline, backup-B) to get
  // the "what changed from A to B" draft set.
  const baselineBackup = makeBackup([
    { id: 'ATC_RAT_RLL_P', value: 0.135 },
    { id: 'ATC_RAT_PIT_P', value: 0.135 },
    { id: 'ANGLE_MAX', value: 4500 }
  ])
  const targetBackup = makeBackup([
    { id: 'ATC_RAT_RLL_P', value: 0.135 },        // unchanged
    { id: 'ATC_RAT_PIT_P', value: 0.142 },        // CHANGED
    { id: 'ANGLE_MAX', value: 6000 }              // CHANGED
  ])

  const baselineParameters = buildParametersFromBackup(baselineBackup, new Map())
  const result = deriveDraftValuesFromParameterBackup(baselineParameters, targetBackup)

  assert.equal(result.matchedCount, 3, 'all 3 backup params resolved against the baseline')
  assert.equal(result.changedCount, 2, 'two real diffs: ATC_RAT_PIT_P and ANGLE_MAX')
  assert.equal(result.unchangedCount, 1, 'ATC_RAT_RLL_P matched')
  assert.equal(result.unknownParameterIds.length, 0)
  assert.equal(result.draftValues.ATC_RAT_PIT_P, '0.142')
  assert.equal(result.draftValues.ANGLE_MAX, '6000')
  assert.equal(result.draftValues.ATC_RAT_RLL_P, undefined, 'unchanged params are NOT in draftValues')
})
