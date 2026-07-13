import assert from 'node:assert/strict'
import test from 'node:test'

import {
  OSD_SHORTHAND_MAX_ENTRIES,
  OsdShorthandParseError,
  parseOsdShorthand,
  serializeOsdShorthand
} from '../packages/ardupilot-core/dist/index.js'

test('serialize → parse round-trips the shorthand entries', () => {
  const table = {
    entries: [
      { from: 'PreArm:', to: 'PA:' },
      { from: 'Arming motors', to: 'ARMED' }
    ]
  }
  const parsed = parseOsdShorthand(serializeOsdShorthand(table))
  assert.deepEqual(parsed, table)
})

test('an empty table round-trips (count 0)', () => {
  assert.deepEqual(parseOsdShorthand(serializeOsdShorthand({ entries: [] })), { entries: [] })
})

test('fields are truncated to their NUL-terminated width (from 15, to 9)', () => {
  const table = { entries: [{ from: 'A'.repeat(30), to: 'B'.repeat(30) }] }
  const parsed = parseOsdShorthand(serializeOsdShorthand(table))
  assert.equal(parsed.entries[0].from.length, 15)
  assert.equal(parsed.entries[0].to.length, 9)
})

test('serialize caps at MAX_ENTRIES', () => {
  const many = { entries: Array.from({ length: OSD_SHORTHAND_MAX_ENTRIES + 5 }, (_v, i) => ({ from: `f${i}`, to: `t${i}` })) }
  const parsed = parseOsdShorthand(serializeOsdShorthand(many))
  assert.equal(parsed.entries.length, OSD_SHORTHAND_MAX_ENTRIES)
})

test('parse rejects a bad magic, version, and a CRC mismatch', () => {
  const good = serializeOsdShorthand({ entries: [{ from: 'x', to: 'y' }] })

  const badMagic = good.slice()
  badMagic[0] = 0x00
  assert.throws(() => parseOsdShorthand(badMagic), OsdShorthandParseError)

  const badVersion = good.slice()
  badVersion[2] = 9
  assert.throws(() => parseOsdShorthand(badVersion), OsdShorthandParseError)

  const badCrc = good.slice()
  badCrc[badCrc.length - 1] ^= 0xff
  assert.throws(() => parseOsdShorthand(badCrc), OsdShorthandParseError)
})

test('parse rejects a truncated blob and an over-count header', () => {
  assert.throws(() => parseOsdShorthand(new Uint8Array([0x4f, 0x53, 1])), OsdShorthandParseError)
  // count byte claims more entries than the blob carries
  const overCount = new Uint8Array([0x4f, 0x53, 1, 5, 0, 0, 0, 0])
  assert.throws(() => parseOsdShorthand(overCount), OsdShorthandParseError)
})
