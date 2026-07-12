import assert from 'node:assert/strict'
import test from 'node:test'

import {
  VTX_TABLE_PRESETS,
  parseBetaflightVtxTable,
  serializeVtxTable,
  parseVtxTable,
  VTX_TABLE_MAX_BANDS,
  VTX_TABLE_MAX_CHANNELS,
  VTX_TABLE_MAX_POWER_LEVELS
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
