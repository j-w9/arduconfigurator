import assert from 'node:assert/strict'
import test from 'node:test'

import {
  VTX_TABLE_PRESETS,
  VTX_POWER_PRESETS,
  vtxPowerPresetLevels,
  defaultVtxPowerLabel,
  parseBetaflightVtxTable,
  serializeVtxTable,
  parseVtxTable,
  VTX_TABLE_MAX_BANDS,
  VTX_TABLE_MAX_CHANNELS,
  VTX_TABLE_MAX_POWER_LEVELS,
  VTX_TABLE_POWER_LABEL_LEN
} from '../packages/ardupilot-core/dist/index.js'

test('every curated VTX preset parses into a firmware-valid table', () => {
  assert.ok(VTX_TABLE_PRESETS.length >= 1, 'at least one preset ships')
  const seenIds = new Set()
  for (const preset of VTX_TABLE_PRESETS) {
    assert.ok(preset.id && preset.label && preset.description, `preset ${preset.id} is fully described`)
    assert.ok(!seenIds.has(preset.id), `preset id ${preset.id} is unique`)
    seenIds.add(preset.id)

    const table = parseBetaflightVtxTable(preset.table)
    assert.ok(table.bands.length >= 1 && table.bands.length <= VTX_TABLE_MAX_BANDS, `${preset.id} band count in range`)
    assert.ok(table.numChannels >= 1 && table.numChannels <= VTX_TABLE_MAX_CHANNELS, `${preset.id} channel count in range`)
    assert.ok(
      table.powerLevels.length >= 1 && table.powerLevels.length <= VTX_TABLE_MAX_POWER_LEVELS,
      `${preset.id} power-level count in range`
    )
    // Band names must fit the fixed-width storage field.
    for (const band of table.bands) {
      assert.ok(band.name.length <= 8, `${preset.id} band name "${band.name}" fits`)
    }
    // The parsed table must round-trip through the on-wire codec the firmware
    // consumes (the whole point: a preset the FC will actually accept).
    const roundTripped = parseVtxTable(serializeVtxTable(table))
    assert.equal(roundTripped.bands.length, table.bands.length, `${preset.id} survives the wire codec`)
    assert.equal(roundTripped.powerLevels.length, table.powerLevels.length)
  }
})

test('the standard 40CH preset carries the canonical Raceband row', () => {
  const standard = VTX_TABLE_PRESETS.find((preset) => preset.id === 'standard-40ch-25-600')
  assert.ok(standard, 'standard 40CH preset exists')
  const table = parseBetaflightVtxTable(standard.table)
  const raceband = table.bands.find((band) => band.letter === 'R')
  assert.ok(raceband, 'Raceband present')
  // R1 and R8 are the well-known Raceband endpoints — a guard against a typo in
  // the frequency map.
  assert.equal(raceband.frequencies[0], 5658)
  assert.equal(raceband.frequencies[7], 5917)
})

test('a 1600 mW (1.6 W) high-power preset ships and fits the 3-char label field', () => {
  const highPower = VTX_TABLE_PRESETS.find((preset) => preset.id === 'standard-40ch-25-1600')
  assert.ok(highPower, 'high-power 40CH preset exists')
  const table = parseBetaflightVtxTable(highPower.table)
  const top = table.powerLevels[table.powerLevels.length - 1]
  assert.equal(top.value, 1600, 'top power level is 1600 mW')
  assert.ok(top.label.length <= VTX_TABLE_POWER_LABEL_LEN, 'its label fits the fixed field')
  assert.equal(top.label, '1.6', 'labelled as 1.6 W, not a truncated "160"')
})

test('defaultVtxPowerLabel derives a 3-char-safe label', () => {
  assert.equal(defaultVtxPowerLabel(25), '25')
  assert.equal(defaultVtxPowerLabel(800), '800')
  assert.equal(defaultVtxPowerLabel(1600), '1.6')
  assert.equal(defaultVtxPowerLabel(1000), '1')
  assert.equal(defaultVtxPowerLabel(2500), '2.5')
  for (const mw of [25, 100, 200, 400, 600, 800, 1000, 1600, 2000, 2500]) {
    assert.ok(defaultVtxPowerLabel(mw).length <= VTX_TABLE_POWER_LABEL_LEN, `${mw} label fits`)
  }
})

test('every analog power preset yields firmware-valid, label-safe levels including a 1600 mW ladder', () => {
  assert.ok(VTX_POWER_PRESETS.length >= 1)
  const ids = new Set()
  for (const preset of VTX_POWER_PRESETS) {
    assert.ok(preset.id && preset.label && preset.description)
    assert.ok(!ids.has(preset.id), `power preset id ${preset.id} unique`)
    ids.add(preset.id)
    const levels = vtxPowerPresetLevels(preset)
    assert.ok(levels.length >= 1 && levels.length <= VTX_TABLE_MAX_POWER_LEVELS, `${preset.id} level count in range`)
    for (const level of levels) {
      assert.ok(level.value >= 0 && level.value <= 0xffff, `${preset.id} value in u16`)
      assert.ok(level.label.length <= VTX_TABLE_POWER_LABEL_LEN, `${preset.id} label "${level.label}" fits`)
    }
  }
  const highPower = VTX_POWER_PRESETS.find((preset) => preset.id === 'power-25-1600')
  assert.ok(highPower, 'a 1600 mW power ladder ships')
  assert.deepEqual(highPower.valuesMw, [25, 400, 800, 1600])
})
