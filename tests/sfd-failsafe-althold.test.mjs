// The SFD fork's FS_OPTIONS bit 6 (AltHold and drift instead of Land without
// position) and its FS_ALTH_TMO timeout. Stock ArduCopter 4.6.3, 4.7.0, 4.7.2
// and master stop at bit 5, so the bit is added only when FS_ALTH_TMO is on the
// wire. The load-bearing assertion is the NEGATIVE one: a stock catalog comes
// back unchanged BY IDENTITY.

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  applySfdFailsafeAltholdCatalogOverrides,
  detectSfdFailsafeAltholdDrift,
  SFD_FS_ALTHOLD_DETECTION_PARAM_ID,
  SFD_FS_ALTHOLD_OPTION_BIT
} from '../packages/ardupilot-core/dist/index.js'
import { arducopterMetadata, normalizeFirmwareMetadata } from '../packages/param-metadata/dist/index.js'

function baseCatalog() {
  return normalizeFirmwareMetadata(arducopterMetadata)
}

test('bit 6 matches Copter.h ALTHOLD_NO_POSITION = (1<<6)', () => {
  assert.equal(SFD_FS_ALTHOLD_OPTION_BIT, 6)
  assert.equal(SFD_FS_ALTHOLD_DETECTION_PARAM_ID, 'FS_ALTH_TMO')
})

test('detection keys on FS_ALTH_TMO', () => {
  assert.equal(detectSfdFailsafeAltholdDrift(['FS_OPTIONS', 'FS_ALTH_TMO']), true)
  assert.equal(detectSfdFailsafeAltholdDrift(['FS_OPTIONS']), false)
  assert.equal(detectSfdFailsafeAltholdDrift([]), false)
})

test('stock firmware gets the catalog back by identity, with bits 0-5 only', () => {
  const catalog = baseCatalog()
  assert.equal(applySfdFailsafeAltholdCatalogOverrides(catalog, false), catalog)
  assert.deepEqual(
    catalog.parameters.FS_OPTIONS.options.map((option) => option.value),
    [0, 1, 2, 3, 4, 5]
  )
  assert.equal(catalog.parameters.FS_ALTH_TMO, undefined)
})

test('the fork gains bit 6 and an FS_ALTH_TMO definition', () => {
  const base = baseCatalog()
  const patched = applySfdFailsafeAltholdCatalogOverrides(base, true)
  assert.notEqual(patched, base)
  const bit6 = patched.parameters.FS_OPTIONS.options.find((option) => option.value === 6)
  assert.match(bit6?.label ?? '', /AltHold/)
  assert.equal(patched.parameters.FS_OPTIONS.bitmask, true)
  const tmo = patched.parameters.FS_ALTH_TMO
  assert.equal(tmo.unit, 's')
  assert.equal(tmo.minimum, 0)
  assert.equal(tmo.maximum, 300)
  // The base catalog is not mutated.
  assert.equal(base.parameters.FS_OPTIONS.options.some((option) => option.value === 6), false)
})

test('applying twice adds bit 6 once', () => {
  const once = applySfdFailsafeAltholdCatalogOverrides(baseCatalog(), true)
  const twice = applySfdFailsafeAltholdCatalogOverrides(once, true)
  assert.equal(twice.parameters.FS_OPTIONS.options.filter((option) => option.value === 6).length, 1)
})
