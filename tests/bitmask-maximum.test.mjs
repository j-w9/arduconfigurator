// Bitmask parameters get a computed ceiling.
//
// Reported: EK3_GPS_CHECK accepted any value, because ArduPilot publishes no
// @Range for bitmask params — confirmed against its metadata. Without a
// maximum, a typo'd 500 into an 8-bit mask validated cleanly and would have
// been written to the flight controller.
//
// The ceiling is derivable rather than curated: `options` on a bitmask hold BIT
// INDICES, so the highest representable value is every documented bit set.
// Deriving it means a fork that adds a bit gets the right ceiling for free,
// where a hand-maintained number would quietly go stale.

import assert from 'node:assert/strict'
import test from 'node:test'

import { bitmaskMaximum } from '../packages/ardupilot-core/dist/index.js'
import { arducopterMetadata, normalizeFirmwareMetadata } from '../packages/param-metadata/dist/index.js'

const catalog = normalizeFirmwareMetadata(arducopterMetadata)

test('every documented bit set is the ceiling', () => {
  // Bits 0..7 -> 255, which is exactly what EK3_GPS_CHECK's own description
  // says ("Set to 255 perform all checks").
  const eightBits = { bitmask: true, options: Array.from({ length: 8 }, (_, bit) => ({ value: bit })) }
  assert.equal(bitmaskMaximum(eightBits), 255)

  assert.equal(bitmaskMaximum({ bitmask: true, options: [{ value: 0 }] }), 1)
  assert.equal(bitmaskMaximum({ bitmask: true, options: [{ value: 0 }, { value: 3 }] }), 0b1001)
})

test('sparse bit lists do not imply the bits in between', () => {
  // Only the DOCUMENTED bits count; assuming a contiguous range would permit
  // values with undefined bits set.
  assert.equal(bitmaskMaximum({ bitmask: true, options: [{ value: 1 }, { value: 5 }] }), 0b100010)
})

test('a non-bitmask parameter keeps whatever range its metadata declares', () => {
  assert.equal(bitmaskMaximum({ bitmask: false, options: [{ value: 3 }] }), undefined)
  assert.equal(bitmaskMaximum({ options: [{ value: 3 }] }), undefined)
  assert.equal(bitmaskMaximum(undefined), undefined)
})

test('a bitmask with no documented bits yields no ceiling — better than a wrong one', () => {
  assert.equal(bitmaskMaximum({ bitmask: true, options: [] }), undefined)
  assert.equal(bitmaskMaximum({ bitmask: true }), undefined)
})

test('bit indices past the 32-bit boundary yield no ceiling rather than a negative one', () => {
  // 1 << 31 is negative under JS bitwise ops; silently returning a negative
  // maximum would reject every legitimate value.
  assert.equal(bitmaskMaximum({ bitmask: true, options: [{ value: 31 }] }), undefined)
  assert.equal(bitmaskMaximum({ bitmask: true, options: [{ value: -1 }] }), undefined)
  assert.equal(bitmaskMaximum({ bitmask: true, options: [{ value: 1.5 }] }), undefined)
})

test('the real EK3_GPS_CHECK definition produces a sane ceiling', () => {
  const definition = catalog.parameters.EK3_GPS_CHECK
  if (!definition?.bitmask) {
    return // not curated as a bitmask in this bundle; nothing to assert
  }
  const ceiling = bitmaskMaximum(definition)
  assert.ok(ceiling !== undefined, 'a curated bitmask should yield a ceiling')
  assert.ok(ceiling > 0 && ceiling <= 0xffffffff)
  // Its description states 255 performs all checks.
  assert.ok(ceiling <= 255, `expected an 8-bit-or-smaller mask, got ${ceiling}`)
})
