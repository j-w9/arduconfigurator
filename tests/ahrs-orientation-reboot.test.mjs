// AHRS_ORIENTATION takes effect on the next boot.
//
// Field report: changing board orientation appeared to do nothing, because the
// app never told the operator to reboot.
//
// ArduPilot says so only in the DESCRIPTION PROSE of AP_AHRS.cpp @Param:
// ORIENTATION — "This option takes affect on next boot. After changing you
// will need to re-level your vehicle." — and does NOT tag the parameter
// @RebootRequired: True. A metadata scrape of apm.pdef.json therefore misses
// it, which is exactly how it shipped untagged.
//
// So this is asserted here rather than left to upstream: a future regeneration
// that trusts the @RebootRequired tag would silently drop the flag and
// reintroduce the bug with nothing failing.

import assert from 'node:assert/strict'
import test from 'node:test'

import { arducopterMetadata, normalizeFirmwareMetadata } from '../packages/param-metadata/dist/index.js'

const catalog = normalizeFirmwareMetadata(arducopterMetadata)

test('AHRS_ORIENTATION is flagged reboot-required', () => {
  const definition = catalog.parameters.AHRS_ORIENTATION
  assert.ok(definition, 'AHRS_ORIENTATION should be in the catalog')
  assert.equal(
    definition.rebootRequired,
    true,
    'ArduPilot applies board orientation on next boot only — the app must prompt for one'
  )
})

test('the operator is told to reboot AND to re-level, not just one of them', () => {
  const notes = (catalog.parameters.AHRS_ORIENTATION.notes ?? []).join(' ').toLowerCase()
  assert.match(notes, /reboot/, 'a reboot is required for the new orientation to take effect')
  // Re-levelling matters as much: the old AHRS trims describe the old mounting.
  assert.match(notes, /re-level|level/, 'the vehicle must be re-levelled after an orientation change')
  assert.match(notes, /accelerometer/, 'accel calibration should be repeated')
})

test('the description states the next-boot behaviour', () => {
  // The dropdown shows the description; leaving it silent is what made the
  // change look like it had done nothing.
  assert.match(catalog.parameters.AHRS_ORIENTATION.description.toLowerCase(), /next boot|reboot/)
})

test('the reboot flag is not applied indiscriminately to sibling rotations', () => {
  // COMPASS_ORIENT shares the rotation enum but is NOT documented as
  // next-boot-only upstream, so tagging it would train operators to ignore the
  // prompt. Only AHRS_ORIENTATION carries the "takes affect on next boot" text.
  const compassOrient = catalog.parameters.COMPASS_ORIENT
  if (compassOrient) {
    assert.notEqual(
      compassOrient.rebootRequired,
      true,
      'COMPASS_ORIENT is not documented as next-boot-only in AP_Compass'
    )
  }
})
