import assert from 'node:assert/strict'
import test from 'node:test'

import {
  VTX_TABLE_HEADER_LEN,
  VTX_TABLE_LEGACY_VERSION,
  VTX_TABLE_MAGIC,
  VTX_TABLE_VERSION,
  VTX_TABLE_DEFAULT_BAND_COUNT,
  VtxTableLegacyVersionError,
  VtxTableParseError,
  defaultVtxTable,
  isDefaultVtxTable,
  parseVtxTable,
  serializeVtxTable,
  vtxTableCrc32
} from '../packages/ardupilot-core/dist/index.js'

function sampleTable() {
  return {
    version: VTX_TABLE_VERSION,
    numChannels: 3,
    bands: [
      { name: 'Boscam A', letter: 'A', isFactory: true, frequencies: [5865, 5845, 5825] },
      { name: 'Custom', letter: 'U', isFactory: false, frequencies: [5800, 0, 5900] }
    ]
  }
}

test('the blob is version 2 with a 5-byte header and no power section', () => {
  const table = sampleTable()
  const bytes = serializeVtxTable(table)

  assert.equal(VTX_TABLE_VERSION, 2)
  assert.equal(VTX_TABLE_HEADER_LEN, 5)
  assert.equal(bytes[0] | (bytes[1] << 8), VTX_TABLE_MAGIC)
  assert.equal(bytes[2], 2)
  assert.equal(bytes[3], 2, 'numBands')
  assert.equal(bytes[4], 3, 'numChannels')

  // header + bands + crc, exactly: a power section would make this longer.
  const expected = 5 + 2 * (8 + 2 + 3 * 2) + 4
  assert.equal(bytes.length, expected)
})

test('serialize -> parse round-trips', () => {
  const table = sampleTable()
  assert.deepEqual(parseVtxTable(serializeVtxTable(table)), table)
})

test('the CRC covers every preceding byte', () => {
  const bytes = serializeVtxTable(sampleTable())
  const stored =
    (bytes[bytes.length - 4] |
      (bytes[bytes.length - 3] << 8) |
      (bytes[bytes.length - 2] << 16) |
      (bytes[bytes.length - 1] << 24)) >>> 0
  assert.equal(vtxTableCrc32(bytes.subarray(0, bytes.length - 4)), stored)

  const corrupted = Uint8Array.from(bytes)
  corrupted[6] ^= 0xff
  assert.throws(() => parseVtxTable(corrupted), VtxTableParseError)
})

// v1 came only from the old fork firmware. Reading one and writing v2 back
// would silently discard its power section, so it is refused — and refused
// DISTINGUISHABLY, so the UI can say "firmware too old" not "corrupt table".
test('a version 1 blob is rejected as too old, not as corrupt', () => {
  const bytes = serializeVtxTable(sampleTable())
  const v1 = Uint8Array.from(bytes)
  v1[2] = VTX_TABLE_LEGACY_VERSION
  assert.throws(() => parseVtxTable(v1), VtxTableLegacyVersionError)
  assert.throws(() => parseVtxTable(v1), /old \(version 1\) VTX table format/)
})

test('a table with no bands or no channels is rejected', () => {
  for (const [offset, what] of [
    [3, 'numBands'],
    [4, 'numChannels']
  ]) {
    const bytes = serializeVtxTable(sampleTable())
    bytes[offset] = 0
    assert.throws(() => parseVtxTable(bytes), /at least one band and one channel/, what)
  }
})

test('a truncated blob is rejected rather than half-read', () => {
  const bytes = serializeVtxTable(sampleTable())
  assert.throws(() => parseVtxTable(bytes.subarray(0, bytes.length - 6)), VtxTableParseError)
})

// There is no reset command: restoring the defaults means uploading them, so
// the ground station has to carry a correct copy.
test('the default table is the standard 11 bands and round-trips', () => {
  const table = defaultVtxTable()
  assert.equal(table.bands.length, VTX_TABLE_DEFAULT_BAND_COUNT)
  assert.equal(table.bands.length, 11)
  assert.equal(table.numChannels, 8)
  assert.deepEqual(
    table.bands.map((band) => band.letter),
    ['A', 'B', 'E', 'F', 'R', 'L', 'U', 'V', 'X', 'C', 'D']
  )
  // Transcribed from AP_VideoTX::VIDEO_CHANNELS — spot-check each end.
  assert.deepEqual(table.bands[0].frequencies, [5865, 5845, 5825, 5805, 5785, 5765, 5745, 5725])
  assert.deepEqual(table.bands[10].frequencies, [3170, 3190, 3210, 3230, 3250, 3270, 3290, 3310])
  assert.deepEqual(parseVtxTable(serializeVtxTable(table)), table)
  assert.equal(isDefaultVtxTable(table), true)
})

test('defaultVtxTable hands back a fresh copy each time', () => {
  const first = defaultVtxTable()
  first.bands[0].frequencies[0] = 1234
  assert.equal(defaultVtxTable().bands[0].frequencies[0], 5865)
  assert.equal(isDefaultVtxTable(first), false)
})
