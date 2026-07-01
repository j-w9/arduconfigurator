import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createParameterBackup,
  deriveDraftValuesFromParameterBackup,
  isInternalUseOnlyParameter,
  parameterImportExclusionCategory
} from '../packages/ardupilot-core/dist/index.js'

// Importing a parameter file from a DIFFERENT airframe should let the operator
// strip board/airframe-specific values they will re-measure or re-tune locally:
// sensor calibration (offsets/scales/trim), MAVLink stream rates, and mission
// params. The toggles are opt-in — by default nothing is stripped.

test('parameterImportExclusionCategory classifies calibration / stream-rate / mission families', () => {
  // Calibration = offsets/scales/trim only.
  for (const id of [
    'COMPASS_OFS_X', 'COMPASS_OFS2_Y', 'COMPASS_OFS3_Z',
    'COMPASS_DIA_X', 'COMPASS_ODI2_Y', 'COMPASS_MOT_Z',
    'COMPASS_SCALE', 'COMPASS_SCALE3',
    'INS_ACCOFFS_X', 'INS_ACC2OFFS_Y', 'INS_ACCSCAL_Z', 'INS_ACC3SCAL_X',
    'INS_GYROFFS_X', 'INS_GYR2OFFS_Z',
    'AHRS_TRIM_X', 'AHRS_TRIM_Y'
  ]) {
    assert.equal(parameterImportExclusionCategory(id), 'calibration', id)
  }

  for (const id of ['SR0_POSITION', 'SR1_EXTRA1', 'SR6_RAW_SENS']) {
    assert.equal(parameterImportExclusionCategory(id), 'stream-rates', id)
  }

  for (const id of ['MIS_TOTAL', 'MIS_RESTART', 'MIS_OPTIONS']) {
    assert.equal(parameterImportExclusionCategory(id), 'mission', id)
  }

  // Compass *identity* and config are NOT calibration — stripping them would
  // disturb which compasses the target treats as present/enabled.
  for (const id of [
    'COMPASS_DEV_ID', 'COMPASS_PRIO1_ID', 'COMPASS_USE', 'COMPASS_USE2',
    'COMPASS_ORIENT', 'COMPASS_EXTERNAL', 'COMPASS_ENABLE',
    'ATC_RAT_RLL_P', 'INS_GYR_CAL', 'SERVO1_FUNCTION'
  ]) {
    assert.equal(parameterImportExclusionCategory(id), undefined, id)
  }
})

function backupOf(values) {
  return createParameterBackup({
    parameters: Object.entries(values).map(([id, value]) => ({ id, value })),
    vehicle: undefined
  })
}

const LIVE = [
  { id: 'ATC_RAT_RLL_P', value: 0.135 },
  { id: 'COMPASS_OFS_X', value: 10 },
  { id: 'INS_ACCOFFS_X', value: 0.1 },
  { id: 'AHRS_TRIM_X', value: 0.01 },
  { id: 'SR0_POSITION', value: 5 },
  { id: 'MIS_TOTAL', value: 0 }
]

// Every backup value differs from LIVE, so with no exclusions all six stage.
const BACKUP = backupOf({
  ATC_RAT_RLL_P: 0.2,
  COMPASS_OFS_X: 99,
  INS_ACCOFFS_X: 0.9,
  AHRS_TRIM_X: 0.05,
  SR0_POSITION: 10,
  MIS_TOTAL: 3
})

test('import with no exclusions stages every differing entry (default behavior unchanged)', () => {
  const result = deriveDraftValuesFromParameterBackup(LIVE, BACKUP)
  assert.equal(result.changedCount, 6)
  assert.equal(result.excludedCount, 0)
  assert.ok('COMPASS_OFS_X' in result.draftValues)
})

test('excluding calibration drops only offset/scale/trim entries', () => {
  const result = deriveDraftValuesFromParameterBackup(LIVE, BACKUP, {
    excludeCategories: ['calibration']
  })
  assert.equal(result.excludedCount, 3) // COMPASS_OFS_X, INS_ACCOFFS_X, AHRS_TRIM_X
  assert.equal(result.changedCount, 3) // ATC, SR0, MIS still staged
  assert.equal('COMPASS_OFS_X' in result.draftValues, false)
  assert.equal('AHRS_TRIM_X' in result.draftValues, false)
  assert.ok('ATC_RAT_RLL_P' in result.draftValues)
  assert.ok('SR0_POSITION' in result.draftValues)
})

test('excluding all three categories leaves only the unrelated tuning param', () => {
  const result = deriveDraftValuesFromParameterBackup(LIVE, BACKUP, {
    excludeCategories: ['calibration', 'stream-rates', 'mission']
  })
  assert.equal(result.excludedCount, 5)
  assert.equal(result.changedCount, 1)
  assert.deepEqual(Object.keys(result.draftValues), ['ATC_RAT_RLL_P'])
})

test('internal-use-only params (BAROn_GND_PRESS) are ALWAYS dropped on import — they can never be verify-written', () => {
  assert.equal(isInternalUseOnlyParameter('BARO1_GND_PRESS'), true)
  assert.equal(isInternalUseOnlyParameter('BARO2_GND_PRESS'), true)
  assert.equal(isInternalUseOnlyParameter('BARO3_GND_PRESS'), true)
  // The user-settable ground temperature + unrelated params are NOT internal-use-only.
  assert.equal(isInternalUseOnlyParameter('BARO_GND_TEMP'), false)
  assert.equal(isInternalUseOnlyParameter('ATC_RAT_RLL_P'), false)

  const live = [
    { id: 'ATC_RAT_RLL_P', value: 0.135 },
    { id: 'BARO1_GND_PRESS', value: 101000 }
  ]
  const backup = backupOf({ ATC_RAT_RLL_P: 0.2, BARO1_GND_PRESS: 99000 })
  // No exclusion categories opted in — the baro reference is STILL dropped, so a
  // mass restore can't stall on a value the FC re-derives live.
  const result = deriveDraftValuesFromParameterBackup(live, backup)
  assert.equal('BARO1_GND_PRESS' in result.draftValues, false)
  assert.ok('ATC_RAT_RLL_P' in result.draftValues)
  assert.equal(result.excludedCount, 1)
  assert.equal(result.changedCount, 1)
})

test('excluded entries never count as unknown even when absent from the live table', () => {
  // SR7_* / MIS_* not present in the baseline at all: without exclusion they
  // would land in unknownParameterIds; excluded, they vanish cleanly.
  const sparseLive = [{ id: 'ATC_RAT_RLL_P', value: 0.135 }]
  const backup = backupOf({ ATC_RAT_RLL_P: 0.2, SR7_PARAMS: 10, MIS_TOTAL: 3 })
  const result = deriveDraftValuesFromParameterBackup(sparseLive, backup, {
    excludeCategories: ['stream-rates', 'mission']
  })
  assert.equal(result.excludedCount, 2)
  assert.equal(result.unknownParameterIds.length, 0)
  assert.equal(result.changedCount, 1)
})

test('createParameterBackup leaves opt-in categories out of the exported backup', () => {
  const snapshot = {
    parameters: [
      { id: 'COMPASS_OFS_X', value: 10 },
      { id: 'INS_ACCOFFS_X', value: 0.1 },
      { id: 'SR0_POSITION', value: 5 },
      { id: 'ATC_RAT_RLL_P', value: 0.135 }
    ],
    hardware: {},
    vehicle: { vehicle: 'ArduCopter' }
  }
  const ids = (backup) => backup.parameters.map((entry) => entry.id)

  // Default export keeps everything (minus always-excluded volatile params).
  assert.ok(ids(createParameterBackup(snapshot, {})).includes('COMPASS_OFS_X'))

  // Skipping calibration drops the offsets/scales but keeps the rest.
  const lean = createParameterBackup(snapshot, {}, { excludeCategories: ['calibration'] })
  assert.equal(ids(lean).includes('COMPASS_OFS_X'), false, 'compass offset skipped')
  assert.equal(ids(lean).includes('INS_ACCOFFS_X'), false, 'accel offset skipped')
  assert.ok(ids(lean).includes('SR0_POSITION'), 'stream rate kept (not in the skip set)')
  assert.ok(ids(lean).includes('ATC_RAT_RLL_P'), 'tuning kept')
  assert.equal(lean.parameterCount, 2)
})
