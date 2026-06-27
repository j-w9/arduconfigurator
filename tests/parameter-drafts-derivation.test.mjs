import assert from 'node:assert/strict'
import test from 'node:test'

import {
  deriveParameterDraftEntries,
  groupParameterDraftEntries,
  summarizeParameterDraftEntries
} from '../packages/ardupilot-core/dist/index.js'

// Edge-case coverage for the draft-derivation core (status/reason/delta rules),
// which the UI relies on to decide what is staged, invalid, or unchanged before
// a write. Pure functions — minimal ParameterState stand-ins are sufficient.
function param(id, value, definition) {
  return { id, value, definition }
}
function def(extra = {}) {
  return { label: `${extra.label ?? 'P'}`, category: extra.category ?? 'general', ...extra }
}

function entryFor(parameters, draftValues, id) {
  return deriveParameterDraftEntries(parameters, draftValues).find((e) => e.id === id)
}

test('unknown parameter (not in snapshot) is invalid with a clear reason', () => {
  const e = entryFor([], { GHOST_PARAM: '1' }, 'GHOST_PARAM')
  assert.equal(e.status, 'invalid')
  assert.match(e.reason, /not present in the synced snapshot/i)
  assert.equal(e.definition, undefined)
})

test('blank / whitespace-only value is invalid', () => {
  const params = [param('A', 1, def())]
  for (const raw of ['', '   ', '\t']) {
    const e = entryFor(params, { A: raw }, 'A')
    assert.equal(e.status, 'invalid', `raw ${JSON.stringify(raw)} should be invalid`)
    assert.match(e.reason, /numeric value/i)
  }
})

test('non-finite values (text, Infinity, overflow) are invalid', () => {
  const params = [param('A', 1, def())]
  for (const raw of ['abc', 'NaN', 'Infinity', '1e999']) {
    const e = entryFor(params, { A: raw }, 'A')
    assert.equal(e.status, 'invalid', `raw ${raw} should be invalid`)
    assert.match(e.reason, /finite numeric/i)
  }
})

test('below minimum / above maximum are invalid but still expose nextValue', () => {
  const params = [param('A', 5, def({ minimum: 0, maximum: 10 }))]
  const below = entryFor(params, { A: '-1' }, 'A')
  assert.equal(below.status, 'invalid')
  assert.match(below.reason, /below the documented minimum of 0/)
  assert.equal(below.nextValue, -1)
  const above = entryFor(params, { A: '11' }, 'A')
  assert.equal(above.status, 'invalid')
  assert.match(above.reason, /above the documented maximum of 10/)
  assert.equal(above.nextValue, 11)
})

test('values exactly at the min/max bounds are accepted (inclusive)', () => {
  const params = [param('A', 5, def({ minimum: 0, maximum: 10 }))]
  assert.equal(entryFor(params, { A: '0' }, 'A').status, 'staged')
  assert.equal(entryFor(params, { A: '10' }, 'A').status, 'staged')
})

test('enum parameters reject off-list values and accept on-list (Object.is float match)', () => {
  const params = [param('A', 0, def({ options: [{ value: 0 }, { value: 0.5 }, { value: 1 }] }))]
  const bad = entryFor(params, { A: '0.7' }, 'A')
  assert.equal(bad.status, 'invalid')
  assert.match(bad.reason, /enum values/i)
  assert.equal(entryFor(params, { A: '0.5' }, 'A').status, 'staged')
})

test('bitmask parameters accept any value formed by OR-ing bits (no strict-enum match)', () => {
  // ARMING_CHECK / SERIALn_OPTIONS / RC_OPTIONS shape: `options` lists BIT
  // INDICES (0, 1, 2, …) and the stored value is an arbitrary OR of those
  // bits. The strict "must equal one option value" check used to reject
  // any combination that wasn't a single power-of-two — e.g., 5 (bits 0+2)
  // when options were [{value:0},{value:1},{value:2},{value:3}] — flagging
  // legit multi-bit bitmasks as "outside the known enum values".
  const bitmaskDef = def({
    bitmask: true,
    minimum: 0,
    maximum: 15,
    options: [{ value: 0 }, { value: 1 }, { value: 2 }, { value: 3 }]
  })
  const params = [param('ARMING_CHECK', 1, bitmaskDef)]
  // 5 = 0b0101 — bits 0 and 2 set. Not in `options.value`, but a legal
  // bitmask. With bitmask:true the strict enum check is skipped, so this
  // stages cleanly.
  const e = entryFor(params, { ARMING_CHECK: '5' }, 'ARMING_CHECK')
  assert.equal(e.status, 'staged')
  assert.equal(e.nextValue, 5)
  // Still bounded by minimum/maximum, so 99 over the cap is rejected.
  const tooBig = entryFor(params, { ARMING_CHECK: '99' }, 'ARMING_CHECK')
  assert.equal(tooBig.status, 'invalid')
  assert.match(tooBig.reason, /maximum/i)
})

test('value equal to current is unchanged with delta 0; a real change is staged with delta', () => {
  const params = [param('A', 5, def())]
  const same = entryFor(params, { A: '5' }, 'A')
  assert.equal(same.status, 'unchanged')
  assert.equal(same.delta, 0)
  const changed = entryFor(params, { A: '8' }, 'A')
  assert.equal(changed.status, 'staged')
  assert.equal(changed.delta, 3)
  assert.equal(changed.nextValue, 8)
  assert.equal(changed.reason, undefined)
})

test('a draft within 32-bit float precision of the FC value is unchanged, not staged', () => {
  // MAVLink params are float32 on the wire: the FC reports 0.135 as
  // 0.13500000536441803. An imported/preset/edited "0.135" must NOT stage (and
  // then write) hundreds of these as phantom changes.
  const params = [param('ATC_RAT_RLL_P', Math.fround(0.135), def())]
  const noop = entryFor(params, { ATC_RAT_RLL_P: '0.135' }, 'ATC_RAT_RLL_P')
  assert.equal(noop.status, 'unchanged')
  // A genuine tuning change still stages.
  assert.equal(entryFor(params, { ATC_RAT_RLL_P: '0.18' }, 'ATC_RAT_RLL_P').status, 'staged')
})

test('surrounding whitespace is trimmed before parsing', () => {
  const params = [param('A', 1, def())]
  const e = entryFor(params, { A: '  8  ' }, 'A')
  assert.equal(e.status, 'staged')
  assert.equal(e.nextValue, 8)
})

test('summarize counts staged/invalid and lists unique sorted staged categories', () => {
  const params = [
    param('A', 1, def({ category: 'tuning' })),
    param('B', 1, def({ category: 'tuning' })),
    param('C', 1, def({ category: 'arming' }))
  ]
  const entries = deriveParameterDraftEntries(params, { A: '2', B: '3', C: '' })
  const summary = summarizeParameterDraftEntries(entries)
  assert.equal(summary.stagedCount, 2)
  assert.equal(summary.invalidCount, 1)
  assert.deepEqual(summary.stagedCategories, ['tuning'])
})

test('enumOverrides rescues an enum-mismatch draft into staged with override:true', () => {
  // The metadata sometimes lags the firmware on legitimate new enum values
  // (e.g. a brand-new GPS_TYPE). The override path lets the operator push
  // those values through without disabling the whole apply set.
  const params = [param('GPS_TYPE', 0, def({ options: [{ value: 0 }, { value: 1 }] }))]

  // Without override, an unknown enum value is invalid.
  const blocked = entryFor(params, { GPS_TYPE: '99' }, 'GPS_TYPE')
  assert.equal(blocked.status, 'invalid')
  assert.match(blocked.reason, /outside the known enum values/i)

  // With override, the same value is staged with delta against the current.
  const overrides = new Set(['GPS_TYPE'])
  const allowed = deriveParameterDraftEntries(params, { GPS_TYPE: '99' }, overrides).find(
    (e) => e.id === 'GPS_TYPE'
  )
  assert.equal(allowed.status, 'staged')
  assert.equal(allowed.nextValue, 99)
  assert.equal(allowed.delta, 99)
  assert.equal(allowed.override, true)
})

test('without override, min/max violations are invalid with documented bounds in the reason', () => {
  const params = [param('A', 5, def({ minimum: 0, maximum: 10 }))]
  const tooLow = deriveParameterDraftEntries(params, { A: '-1' }).find((e) => e.id === 'A')
  assert.equal(tooLow.status, 'invalid')
  assert.match(tooLow.reason, /below the documented minimum/i)

  const tooHigh = deriveParameterDraftEntries(params, { A: '11' }).find((e) => e.id === 'A')
  assert.equal(tooHigh.status, 'invalid')
  assert.match(tooHigh.reason, /above the documented maximum/i)
})

test('enumOverrides also rescues min/max violations (legacy name; same flag now covers any metadata-validation override)', () => {
  // User-reported case: SERIAL7_BAUD typed 12500000 above the metadata's
  // documented maximum of 12500 — a valid high-bandwidth baud the
  // metadata's @Range hasn't caught up to. The operator's explicit
  // "Override and write anyway" carries the value through, same as
  // the existing enum-mismatch override.
  const params = [param('SERIAL7_BAUD', 115, def({ minimum: 1, maximum: 12500 }))]
  const overrides = new Set(['SERIAL7_BAUD'])

  const above = deriveParameterDraftEntries(params, { SERIAL7_BAUD: '12500000' }, overrides).find(
    (entry) => entry.id === 'SERIAL7_BAUD'
  )
  assert.equal(above.status, 'staged')
  assert.equal(above.nextValue, 12500000)
  assert.equal(above.override, true)

  const below = deriveParameterDraftEntries(params, { SERIAL7_BAUD: '0' }, overrides).find(
    (entry) => entry.id === 'SERIAL7_BAUD'
  )
  assert.equal(below.status, 'staged')
  assert.equal(below.nextValue, 0)
  assert.equal(below.override, true)
})

test('group filters by status and sorts categories then ids', () => {
  const params = [
    param('Z', 1, def({ category: 'beta' })),
    param('A', 1, def({ category: 'alpha' })),
    param('B', 1, def({ category: 'alpha' }))
  ]
  const entries = deriveParameterDraftEntries(params, { Z: '2', A: '2', B: '2' })
  const groups = groupParameterDraftEntries(entries) // default: staged only
  assert.deepEqual(groups.map((g) => g.category), ['alpha', 'beta'])
  assert.deepEqual(groups[0].entries.map((e) => e.id), ['A', 'B'])

  const invalidGroups = groupParameterDraftEntries(
    deriveParameterDraftEntries(params, { A: 'oops' }),
    ['invalid']
  )
  assert.equal(invalidGroups[0].entries[0].status, 'invalid')
})
