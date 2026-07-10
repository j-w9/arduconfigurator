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
