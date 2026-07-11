import assert from 'node:assert/strict'
import test from 'node:test'

import {
  VTX_TABLE_FTP_PATH,
  VTX_TABLE_MAGIC,
  VTX_TABLE_VERSION,
  VtxTableParseError,
  parseVtxTable,
  serializeVtxTable,
  vtxTableCrc32
} from '../packages/ardupilot-core/dist/index.js'

// A small but representative table: 2 bands × 3 channels + 2 power levels.
function sampleTable() {
  return {
    version: VTX_TABLE_VERSION,
    numChannels: 3,
    bands: [
      { name: 'Boscam A', letter: 'A', isFactory: true, frequencies: [5865, 5845, 5825] },
      { name: 'Custom', letter: 'U', isFactory: false, frequencies: [5800, 0, 5900] }
    ],
    powerLevels: [
      { value: 25, label: '25' },
      { value: 800, label: '1W' }
    ]
  }
}

test('serialize → parse round-trips a table exactly', () => {
  const table = sampleTable()
  const parsed = parseVtxTable(serializeVtxTable(table))
  assert.deepEqual(parsed, table)
})

test('serialize produces the byte layout the firmware expects', () => {
  const bytes = serializeVtxTable(sampleTable())
  // header: magic LE, version, numBands, numChannels, numPowerLevels
  assert.equal(bytes[0], VTX_TABLE_MAGIC & 0xff) // 0x54
  assert.equal(bytes[1], VTX_TABLE_MAGIC >> 8) // 0x56
  assert.equal(bytes[2], VTX_TABLE_VERSION)
  assert.equal(bytes[3], 2) // numBands
  assert.equal(bytes[4], 3) // numChannels
  assert.equal(bytes[5], 2) // numPowerLevels
  // first band name is 8 bytes, zero-padded, not NUL-terminated
  assert.equal(String.fromCharCode(...bytes.subarray(6, 6 + 8)).replace(/\0+$/, ''), 'Boscam A')
  // letter + is_factory
  assert.equal(bytes[14], 'A'.charCodeAt(0))
  assert.equal(bytes[15], 1) // factory
  // first channel frequency 5865 little-endian
  assert.equal(bytes[16] | (bytes[17] << 8), 5865)
  // total length = 6 + 2*(8+2+3*2) + 2*(2+3) + 4
  assert.equal(bytes.length, 6 + 2 * (8 + 2 + 3 * 2) + 2 * (2 + 3) + 4)
})

test('the trailing CRC is crc_crc32(0, everything-before-it)', () => {
  const bytes = serializeVtxTable(sampleTable())
  const body = bytes.subarray(0, bytes.length - 4)
  const stored = (bytes[bytes.length - 4] | (bytes[bytes.length - 3] << 8) |
    (bytes[bytes.length - 2] << 16) | (bytes[bytes.length - 1] << 24)) >>> 0
  assert.equal(vtxTableCrc32(body), stored)
})

test('parse rejects a corrupted CRC', () => {
  const bytes = serializeVtxTable(sampleTable())
  bytes[bytes.length - 1] ^= 0xff // flip a CRC byte
  assert.throws(() => parseVtxTable(bytes), VtxTableParseError)
})

test('parse rejects bad magic, version, and truncation', () => {
  assert.throws(() => parseVtxTable(new Uint8Array([0, 0, 1, 0, 0, 0, 0, 0, 0, 0])), VtxTableParseError)
  const wrongVersion = serializeVtxTable(sampleTable())
  wrongVersion[2] = 99
  assert.throws(() => parseVtxTable(wrongVersion), VtxTableParseError)
  assert.throws(() => parseVtxTable(new Uint8Array([0x54, 0x56, 1])), VtxTableParseError)
})

test('parse rejects counts beyond the firmware limits', () => {
  const bytes = serializeVtxTable(sampleTable())
  bytes[3] = 99 // numBands way over MAX_BANDS
  assert.throws(() => parseVtxTable(bytes), VtxTableParseError)
})

test('names/labels are trimmed of the fixed-width storage padding', () => {
  const table = {
    version: VTX_TABLE_VERSION,
    numChannels: 1,
    bands: [{ name: 'X', letter: 'X', isFactory: false, frequencies: [5800] }],
    powerLevels: [{ value: 200, label: '2' }]
  }
  const parsed = parseVtxTable(serializeVtxTable(table))
  assert.equal(parsed.bands[0].name, 'X')
  assert.equal(parsed.powerLevels[0].label, '2')
})

test('exposes the MAVLink-FTP path', () => {
  assert.equal(VTX_TABLE_FTP_PATH, '@VTX/vtxtable.dat')
})

// --- Betaflight vtxtable CLI interchange ---

import { parseBetaflightVtxTable, serializeBetaflightVtxTable } from '../packages/ardupilot-core/dist/index.js'

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
  const table = parseBetaflightVtxTable(BF_SAMPLE)
  assert.equal(table.numChannels, 8)
  assert.equal(table.bands.length, 2)
  assert.deepEqual(table.bands[0], {
    name: 'BOSCAM_A', letter: 'A', isFactory: true,
    frequencies: [5865, 5845, 5825, 5805, 5785, 5765, 5745, 5725]
  })
  // Quoted name with a space, CUSTOM flag.
  assert.equal(table.bands[1].name, 'RACE B')
  assert.equal(table.bands[1].isFactory, false)
  assert.deepEqual(table.powerLevels, [
    { value: 0, label: '25' }, { value: 1, label: '200' }, { value: 2, label: '1W' }
  ])
})

test('parse ignores non-vtxtable lines (works on a full dump)', () => {
  const dump = `# diff\nset foo = 1\nvtxtable bands 1\nvtxtable channels 2\nvtxtable band 1 X X CUSTOM 5800 5900\nvtxtable powervalues 25\nvtxtable powerlabels 25\nsave`
  const table = parseBetaflightVtxTable(dump)
  assert.equal(table.bands.length, 1)
  assert.equal(table.numChannels, 2)
  assert.deepEqual(table.bands[0].frequencies, [5800, 5900])
})

test('BF serialize → parse round-trips', () => {
  const table = parseBetaflightVtxTable(BF_SAMPLE)
  const roundTripped = parseBetaflightVtxTable(serializeBetaflightVtxTable(table))
  assert.deepEqual(roundTripped, table)
})

test('BF serialize quotes names with spaces and emits FACTORY/CUSTOM', () => {
  const text = serializeBetaflightVtxTable(parseBetaflightVtxTable(BF_SAMPLE))
  assert.match(text, /vtxtable band 1 BOSCAM_A A FACTORY 5865/)
  assert.match(text, /vtxtable band 2 "RACE B" R CUSTOM 5658/)
  assert.match(text, /vtxtable powerlabels 25 200 1W/)
})

test('BF import round-trips through the BINARY blob codec too (same model)', () => {
  const table = parseBetaflightVtxTable(BF_SAMPLE)
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
