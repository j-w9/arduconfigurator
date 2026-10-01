import assert from 'node:assert/strict'
import test from 'node:test'

// The BLOB format lives in vtx-table-v2.test.mjs — it is version 2 and bands
// only. What remains here is the Betaflight CLI interchange, which is a
// separate format and still carries power levels, so importing a snippet has to
// hand them back for the VTX_PWRTBL* parameters to take.

import {
  VtxTableParseError,
  parseBetaflightVtxTable,
  parseVtxTable,
  serializeBetaflightVtxTable,
  serializeVtxTable
} from '../packages/ardupilot-core/dist/index.js'

const BF_SAMPLE = `# a shared Betaflight snippet
vtxtable bands 2
vtxtable channels 8
vtxtable band 1 BOSCAM_A A FACTORY 5865 5845 5825 5805 5785 5765 5745 5725
vtxtable band 2 "RACE B" R CUSTOM 5658 5695 5732 5769 5806 5843 5880 5917
vtxtable powerlevels 3
vtxtable powervalues 0 1 2
vtxtable powerlabels 25 200 1W
`

test('parseBetaflightVtxTable maps a BF CLI snippet 1:1', () => {
  const { table, powerLevels } = parseBetaflightVtxTable(BF_SAMPLE)
  assert.equal(table.numChannels, 8)
  assert.equal(table.bands.length, 2)
  assert.deepEqual(table.bands[0], {
    name: 'BOSCAM_A', letter: 'A', isFactory: true,
    frequencies: [5865, 5845, 5825, 5805, 5785, 5765, 5745, 5725]
  })
  // Quoted name with a space, CUSTOM flag.
  assert.equal(table.bands[1].name, 'RACE B')
  assert.equal(table.bands[1].isFactory, false)
  assert.deepEqual(powerLevels, [
    { value: 0, label: '25' }, { value: 1, label: '200' }, { value: 2, label: '1W' }
  ])
})

test('parse ignores non-vtxtable lines (works on a full dump)', () => {
  const dump = `# diff\nset foo = 1\nvtxtable bands 1\nvtxtable channels 2\nvtxtable band 1 X X CUSTOM 5800 5900\nvtxtable powervalues 25\nvtxtable powerlabels 25\nsave`
  const { table } = parseBetaflightVtxTable(dump)
  assert.equal(table.bands.length, 1)
  assert.equal(table.numChannels, 2)
  assert.deepEqual(table.bands[0].frequencies, [5800, 5900])
})

test('BF serialize → parse round-trips', () => {
  const { table, powerLevels } = parseBetaflightVtxTable(BF_SAMPLE)
  const roundTripped = parseBetaflightVtxTable(serializeBetaflightVtxTable(table, powerLevels))
  assert.deepEqual(roundTripped.table, table)
  assert.deepEqual(roundTripped.powerLevels, powerLevels)
})

test('BF serialize quotes names with spaces and emits FACTORY/CUSTOM', () => {
  const imported = parseBetaflightVtxTable(BF_SAMPLE)
  const text = serializeBetaflightVtxTable(imported.table, imported.powerLevels)
  assert.match(text, /vtxtable band 1 BOSCAM_A A FACTORY 5865/)
  assert.match(text, /vtxtable band 2 "RACE B" R CUSTOM 5658/)
  assert.match(text, /vtxtable powerlabels 25 200 1W/)
})

// The blob carries BANDS ONLY now, so a Betaflight import survives the binary
// round trip minus its power levels — those go to VTX_PWRTBL1..6 instead.
test('BF import round-trips through the BINARY blob codec too (bands only)', () => {
  const { table } = parseBetaflightVtxTable(BF_SAMPLE)
  assert.deepEqual(parseVtxTable(serializeVtxTable(table)), table)
})

test('parse rejects tables that exceed the firmware limits', () => {
  const tooManyBands = ['vtxtable channels 1']
  for (let i = 1; i <= 13; i += 1) tooManyBands.push(`vtxtable band ${i} B${i} ${i} CUSTOM 5800`)
  assert.throws(() => parseBetaflightVtxTable(tooManyBands.join('\n')), /Too many bands/)
})

test('parse rejects a non-contiguous band set and a missing FACTORY/CUSTOM flag', () => {
  assert.throws(
    () => parseBetaflightVtxTable('vtxtable channels 1\nvtxtable band 2 X X CUSTOM 5800'),
    /missing band 1/
  )
  assert.throws(
    () => parseBetaflightVtxTable('vtxtable channels 1\nvtxtable band 1 X X 5800'),
    /FACTORY\/CUSTOM/
  )
})

test('parse throws when there are no vtxtable band rows', () => {
  assert.throws(() => parseBetaflightVtxTable('set foo = 1\nsave'), VtxTableParseError)
})
