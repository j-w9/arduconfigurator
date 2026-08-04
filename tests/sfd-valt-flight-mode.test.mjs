// The SFD fork's VALT flight mode (29) in the flight-mode enums.
//
// Stock ArduCopter's mode enum stops at 28 (Turtle), so assigning 29 failed
// validation in BOTH the Modes dropdown and the raw parameter editor — draft
// validation reads the same options. The fork adds `VALT = 29` (ArduCopter
// mode.h), compile-gated on MODE_VALT_ENABLED.
//
// Detection is by parameter presence, not by matching "-SFD" in the version
// string: VALT_POS_EXPO sits inside the same `#if MODE_VALT_ENABLED` block as
// the mode, so it is on the wire exactly when the mode exists. The version
// string would break on any rebuild or rename.
//
// The load-bearing assertion here is the NEGATIVE one: a stock catalog must
// come back unchanged BY IDENTITY, which is what keeps ArduCopter
// byte-identical.

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  applySfdValtCatalogOverrides,
  detectSfdValtMode,
  SFD_VALT_DETECTION_PARAM_ID,
  SFD_VALT_FLIGHT_MODE_VALUE
} from '../packages/ardupilot-core/dist/index.js'
import { arducopterMetadata, normalizeFirmwareMetadata } from '../packages/param-metadata/dist/index.js'

const FLIGHT_MODE_PARAM_IDS = ['FLTMODE1', 'FLTMODE2', 'FLTMODE3', 'FLTMODE4', 'FLTMODE5', 'FLTMODE6']

function baseCatalog() {
  return normalizeFirmwareMetadata(arducopterMetadata)
}

test('VALT is mode 29, matching ArduCopter mode.h', () => {
  assert.equal(SFD_VALT_FLIGHT_MODE_VALUE, 29)
})

test('detection keys on VALT_POS_EXPO, not on the firmware version string', () => {
  assert.equal(SFD_VALT_DETECTION_PARAM_ID, 'VALT_POS_EXPO')
  assert.equal(detectSfdValtMode(['FLTMODE1', 'VALT_POS_EXPO', 'INS_ACC_ID']), true)
  assert.equal(detectSfdValtMode(['FLTMODE1', 'INS_ACC_ID']), false)
  assert.equal(detectSfdValtMode([]), false)
})

test('stock ArduCopter mode enums stop at 28 — 29 is genuinely absent', () => {
  const catalog = baseCatalog()
  for (const id of FLIGHT_MODE_PARAM_IDS) {
    const values = catalog.parameters[id].options.map((option) => option.value)
    assert.ok(values.includes(28), `${id} should offer Turtle (28)`)
    assert.ok(!values.includes(29), `${id} must not offer VALT (29) on stock firmware`)
  }
})

test('a stock build gets the SAME catalog object back — ArduCopter byte-identical', () => {
  const catalog = baseCatalog()
  // Identity, not deep equality: the stock path must not even rebuild the map.
  assert.equal(applySfdValtCatalogOverrides(catalog, false), catalog)
})

test('a fork build gains VALT (29) on every FLTMODEn', () => {
  const patched = applySfdValtCatalogOverrides(baseCatalog(), true)
  for (const id of FLIGHT_MODE_PARAM_IDS) {
    const option = patched.parameters[id].options.find((entry) => entry.value === 29)
    assert.ok(option, `${id} should offer VALT (29) on a fork build`)
    assert.equal(option.label, 'VALT Hold')
  }
})

test('adding VALT leaves every stock mode option untouched', () => {
  const base = baseCatalog()
  const patched = applySfdValtCatalogOverrides(baseCatalog(), true)
  for (const id of FLIGHT_MODE_PARAM_IDS) {
    const before = base.parameters[id].options
    const after = patched.parameters[id].options
    assert.equal(after.length, before.length + 1, `${id} should gain exactly one option`)
    assert.deepEqual(after.slice(0, before.length), before, `${id} stock options must be unchanged`)
  }
})

test('the detection parameter itself gets metadata instead of rendering bare', () => {
  const patched = applySfdValtCatalogOverrides(baseCatalog(), true)
  const definition = patched.parameters.VALT_POS_EXPO
  assert.ok(definition, 'VALT_POS_EXPO should gain a definition on a fork build')
  // @Range: 0 8 in the fork's @Param block.
  assert.equal(definition.minimum, 0)
  assert.equal(definition.maximum, 8)
  assert.ok(definition.description.length > 0)
})

test('applying twice does not duplicate the VALT option', () => {
  const once = applySfdValtCatalogOverrides(baseCatalog(), true)
  const twice = applySfdValtCatalogOverrides(once, true)
  for (const id of FLIGHT_MODE_PARAM_IDS) {
    const valtOptions = twice.parameters[id].options.filter((entry) => entry.value === 29)
    assert.equal(valtOptions.length, 1, `${id} should carry exactly one VALT option`)
  }
})
