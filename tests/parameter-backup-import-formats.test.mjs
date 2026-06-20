import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createParameterBackup,
  parseParameterBackup,
  serializeParameterBackup,
  serializeParameterBackupAsParm,
  serializeParameterBackupAsParams
} from '../packages/ardupilot-core/dist/index.js'

// `parseParameterBackup` historically only accepted the ArduConfigurator JSON
// schema. Real users have Mission Planner `.parm` and QGroundControl `.params`
// files lying around — the loader should accept those too, because they ARE
// the canonical "param backup" formats in the ArduPilot world.

test('parseParameterBackup round-trips an ArduConfigurator JSON backup', () => {
  const snapshot = {
    parameters: [
      { id: 'BATT_MONITOR', value: 4 },
      { id: 'ARMING_CHECK', value: 1 }
    ],
    vehicle: undefined
  }
  const serialized = serializeParameterBackup(createParameterBackup(snapshot))
  const parsed = parseParameterBackup(serialized)
  assert.equal(parsed.schemaVersion, 1)
  assert.equal(parsed.application, 'ArduConfigurator')
  assert.deepEqual(
    parsed.parameters.map((entry) => [entry.id, entry.value]),
    [['ARMING_CHECK', 1], ['BATT_MONITOR', 4]]
  )
})

test('parseParameterBackup accepts a Mission Planner .parm (comma-separated)', () => {
  const parm = [
    '# Mission Planner saved parameters',
    '# Vehicle: ArduCopter 4.6.3',
    '',
    'ARMING_CHECK,1',
    'BATT_MONITOR,4',
    'FLTMODE1,0',
    'FLTMODE6,7',
    'TUNE,0.0'
  ].join('\n')
  const parsed = parseParameterBackup(parm)
  assert.equal(parsed.parameterCount, 5)
  assert.deepEqual(
    parsed.parameters.map((entry) => [entry.id, entry.value]),
    [
      ['ARMING_CHECK', 1],
      ['BATT_MONITOR', 4],
      ['FLTMODE1', 0],
      ['FLTMODE6', 7],
      ['TUNE', 0]
    ]
  )
})

test('parseParameterBackup accepts a Mission Planner .parm with whitespace separators', () => {
  const parm = ['# legacy MP export', 'ARMING_CHECK 1', 'BATT_MONITOR   4'].join('\n')
  const parsed = parseParameterBackup(parm)
  assert.deepEqual(
    parsed.parameters.map((entry) => [entry.id, entry.value]),
    [['ARMING_CHECK', 1], ['BATT_MONITOR', 4]]
  )
})

test('parseParameterBackup accepts a QGroundControl .params (tab-separated, 5 columns)', () => {
  const params = [
    '# Onboard parameters for Vehicle 1',
    '#',
    '# MAV ID  Component ID  Name  Value  Type',
    '1\t1\tARMING_CHECK\t1\t6',
    '1\t1\tBATT_MONITOR\t4\t6',
    '1\t1\tFLTMODE1\t0\t6'
  ].join('\n')
  const parsed = parseParameterBackup(params)
  assert.equal(parsed.parameterCount, 3)
  assert.deepEqual(
    parsed.parameters.map((entry) => [entry.id, entry.value]),
    [['ARMING_CHECK', 1], ['BATT_MONITOR', 4], ['FLTMODE1', 0]]
  )
})

test('parseParameterBackup parses floating-point values correctly', () => {
  const parm = 'ATC_RAT_RLL_P,0.135\nATC_RAT_RLL_D,0.0036\n'
  const parsed = parseParameterBackup(parm)
  assert.equal(parsed.parameters.find((e) => e.id === 'ATC_RAT_RLL_P')?.value, 0.135)
  assert.equal(parsed.parameters.find((e) => e.id === 'ATC_RAT_RLL_D')?.value, 0.0036)
})

test('parseParameterBackup rejects an empty file with a helpful error', () => {
  assert.throws(
    () => parseParameterBackup('# only a comment\n\n# another comment\n'),
    /empty|NAME,VALUE/i
  )
})

test('parseParameterBackup rejects a JSON file that does not match the schema', () => {
  assert.throws(
    () => parseParameterBackup('{"foo": "bar"}'),
    /ArduConfigurator parameter backup schema/
  )
})

test('parseParameterBackup rejects duplicate ids in a text file', () => {
  assert.throws(
    () => parseParameterBackup('ARMING_CHECK,1\nARMING_CHECK,2\n'),
    /more than once/
  )
})

function richSnapshot() {
  return {
    parameters: [
      { id: 'BATT_MONITOR', value: 4 },
      { id: 'ATC_RAT_RLL_P', value: 0.135 },
      { id: 'ARMING_CHECK', value: 1 }
    ],
    vehicle: {
      firmware: 'ArduPilot',
      vehicle: 'ArduCopter',
      systemId: 1,
      componentId: 1,
      flightMode: 'Stabilize'
    },
    hardware: {
      board: {
        boardVersion: 39,
        boardType: 50,
        vendorId: 0x1209,
        productId: 0x5740,
        uid: '01020304050607080900',
        ftpSupported: true,
        firmwareVersion: '4.5.3 (official)',
        firmwareGitHash: 'abc123de',
        lastUpdatedAtMs: 0
      }
    }
  }
}

test('createParameterBackup embeds app + firmware + board metadata', () => {
  const backup = createParameterBackup(richSnapshot(), {
    appVersion: '0.3.0-alpha',
    appGitHash: 'a188961',
    appGitBranch: 'main'
  })
  assert.equal(backup.appVersion, '0.3.0-alpha')
  assert.equal(backup.appGitHash, 'a188961')
  assert.equal(backup.appGitBranch, 'main')
  assert.equal(backup.firmware, 'ArduCopter')
  assert.equal(backup.firmwareVersion, '4.5.3 (official)')
  assert.equal(backup.firmwareGitHash, 'abc123de')
  assert.equal(backup.hardware?.vendorId, 0x1209)
  assert.equal(backup.hardware?.productId, 0x5740)
  assert.equal(backup.hardware?.uid, '01020304050607080900')
})

test('serializeParameterBackupAsParm puts metadata in # header and NAME,VALUE in body', () => {
  const backup = createParameterBackup(richSnapshot(), {
    appVersion: '0.3.0-alpha',
    appGitHash: 'a188961',
    appGitBranch: 'main'
  })
  const parm = serializeParameterBackupAsParm(backup)
  const lines = parm.trim().split('\n')
  // Header section
  assert.ok(lines[0].startsWith('# ArduConfigurator'))
  assert.ok(parm.includes('v0.3.0-alpha'))
  assert.ok(parm.includes('a188961'))
  assert.ok(parm.includes('# Firmware: ArduCopter'))
  assert.ok(parm.includes('# Board:'))
  assert.ok(parm.includes('vendor=0x1209'))
  assert.ok(parm.includes('uid=01020304050607080900'))
  // User feedback: each Board attribute on its own line so a long
  // UID doesn't push the whole line off-screen. Lock the multi-line
  // shape so a future "let's bundle them back onto one line" edit
  // surfaces in tests.
  const boardLines = lines.filter((line) => line.startsWith('# Board:'))
  assert.ok(boardLines.length >= 4, `expected >=4 separate # Board: lines (vendor/product/boardType/uid…), got ${boardLines.length}`)
  assert.ok(boardLines.some((line) => line === '# Board: vendor=0x1209'), 'vendor on its own line')
  assert.ok(boardLines.some((line) => line === '# Board: uid=01020304050607080900'), 'uid on its own line')
  // Body
  assert.ok(parm.includes('\nBATT_MONITOR,4\n'))
  assert.ok(parm.includes('\nATC_RAT_RLL_P,0.135\n'))
})

test('serializeParameterBackupAsParams emits tab-separated 5 columns', () => {
  const backup = createParameterBackup(richSnapshot(), {
    appVersion: '0.3.0-alpha'
  })
  const params = serializeParameterBackupAsParams(backup)
  assert.ok(params.startsWith('# Onboard parameters for vehicle 1'))
  assert.ok(params.includes('# Vehicle-Id Component-Id Name Value Type'))
  const dataLines = params.split('\n').filter((line) => /^\d/.test(line))
  assert.ok(dataLines.length >= 3)
  const battery = dataLines.find((line) => line.includes('BATT_MONITOR'))
  assert.ok(battery, 'expected a BATT_MONITOR line')
  const cols = battery.split('\t')
  assert.equal(cols.length, 5)
  assert.equal(cols[0], '1')
  assert.equal(cols[1], '1')
  assert.equal(cols[2], 'BATT_MONITOR')
  assert.equal(cols[3], '4')
  assert.equal(cols[4], '9')
})

test('export → import round-trips values across all three formats', () => {
  const backup = createParameterBackup(richSnapshot(), { appVersion: '0.3.0-alpha' })
  for (const serialized of [
    serializeParameterBackup(backup),
    serializeParameterBackupAsParm(backup),
    serializeParameterBackupAsParams(backup)
  ]) {
    const parsed = parseParameterBackup(serialized)
    const byId = Object.fromEntries(parsed.parameters.map((e) => [e.id, e.value]))
    assert.equal(byId.BATT_MONITOR, 4)
    assert.equal(byId.ATC_RAT_RLL_P, 0.135)
    assert.equal(byId.ARMING_CHECK, 1)
  }
})

test('parseParameterBackup handles Windows files (UTF-8 BOM + CRLF)', () => {
  const bomParm = '﻿# Mission Planner backup\r\nARMING_CHECK,1\r\nBATT_MONITOR,4\r\n'
  const parsed = parseParameterBackup(bomParm)
  assert.equal(parsed.parameterCount, 2)
  assert.deepEqual(
    parsed.parameters.map((e) => [e.id, e.value]),
    [['ARMING_CHECK', 1], ['BATT_MONITOR', 4]]
  )
})

test('parseParameterBackup handles negative and scientific-notation values', () => {
  const parm = 'AHRS_TRIM_X,-0.02\nAHRS_TRIM_Y,-0.05\nSOME_PARAM,1.5e-4\n'
  const parsed = parseParameterBackup(parm)
  assert.equal(parsed.parameters.find((e) => e.id === 'AHRS_TRIM_X')?.value, -0.02)
  assert.equal(parsed.parameters.find((e) => e.id === 'AHRS_TRIM_Y')?.value, -0.05)
  assert.equal(parsed.parameters.find((e) => e.id === 'SOME_PARAM')?.value, 1.5e-4)
})

test('serialized floats keep f32 precision without surfacing round-off (0.35 not 0.349999994)', () => {
  // ArduPilot stores params as IEEE-754 single precision; 0.35 stored as
  // f32 reads back as 0.34999999403953552 in a JS double. The exporter
  // must round to f32's 7-sig-fig actual precision so users see "0.35",
  // not "0.349999994" (the bug a real verify run caught).
  const snapshot = {
    parameters: [
      { id: 'ACRO_RP_EXPO', value: 0.34999999403953552 },
      { id: 'ACRO_Y_EXPO', value: 0.20000000298023224 },
      { id: 'TINY', value: 0.00012345 }
    ],
    vehicle: undefined
  }
  const backup = createParameterBackup(snapshot)
  const parm = serializeParameterBackupAsParm(backup)
  assert.ok(parm.includes('\nACRO_RP_EXPO,0.35\n'), `expected 0.35, got: ${parm.split('\n').find((l) => l.includes('ACRO_RP_EXPO'))}`)
  assert.ok(parm.includes('\nACRO_Y_EXPO,0.2\n'), `expected 0.2, got: ${parm.split('\n').find((l) => l.includes('ACRO_Y_EXPO'))}`)
})

test('parseParameterBackup skips QGC header lines that include "Name" but no number', () => {
  // The QGC header `# MAV ID Component ID Name Value Type` is comment-gated by `#`,
  // but some scuffed exports drop the `#`. Make sure we don't try to import the
  // header tokens as a param.
  const params = ['MAV-ID Component-ID Name Value Type', '1\t1\tARMING_CHECK\t1\t6'].join('\n')
  const parsed = parseParameterBackup(params)
  assert.equal(parsed.parameterCount, 1)
  assert.equal(parsed.parameters[0].id, 'ARMING_CHECK')
})
