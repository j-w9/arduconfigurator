import assert from 'node:assert/strict'
import test from 'node:test'

import {
  parseIntelHex,
  parseDfuSeMemoryLayout,
  sectorsToErase,
  DfuSeDevice
} from '../packages/firmware-flash/dist/index.js'

// Build a single Intel HEX record with a correct checksum.
function record(type, addr, data = []) {
  const bytes = [data.length, (addr >> 8) & 0xff, addr & 0xff, type, ...data]
  const sum = bytes.reduce((acc, b) => (acc + b) & 0xff, 0)
  bytes.push((0x100 - sum) & 0xff)
  return ':' + bytes.map((b) => b.toString(16).padStart(2, '0')).join('')
}

const EOF = ':00000001FF'

test('parseIntelHex: applies the extended linear base and returns absolute segments', () => {
  const hex = [
    record(0x04, 0x0000, [0x08, 0x00]), // upper base 0x0800_0000
    record(0x00, 0x0000, [0xde, 0xad, 0xbe, 0xef]),
    EOF
  ].join('\n')
  const parsed = parseIntelHex(hex)
  assert.equal(parsed.segments.length, 1)
  assert.equal(parsed.segments[0].address, 0x08000000)
  assert.deepEqual([...parsed.segments[0].data], [0xde, 0xad, 0xbe, 0xef])
  assert.equal(parsed.minAddress, 0x08000000)
  assert.equal(parsed.endAddress, 0x08000004)
  assert.equal(parsed.totalBytes, 4)
})

test('parseIntelHex: coalesces contiguous data records into one segment', () => {
  const hex = [
    record(0x04, 0x0000, [0x08, 0x00]),
    record(0x00, 0x0000, [1, 2, 3, 4]),
    record(0x00, 0x0004, [5, 6, 7, 8]),
    record(0x00, 0x0100, [9]), // gap -> separate segment
    EOF
  ].join('\n')
  const parsed = parseIntelHex(hex)
  assert.equal(parsed.segments.length, 2)
  assert.deepEqual([...parsed.segments[0].data], [1, 2, 3, 4, 5, 6, 7, 8])
  assert.equal(parsed.segments[1].address, 0x08000100)
})

test('parseIntelHex: rejects a bad checksum', () => {
  const good = record(0x00, 0x0000, [1, 2, 3, 4])
  const broken = good.slice(0, -2) + '00' // clobber checksum byte
  assert.throws(() => parseIntelHex([broken, EOF].join('\n')), /checksum/i)
})

test('parseIntelHex: rejects a file with no EOF record', () => {
  assert.throws(() => parseIntelHex(record(0x00, 0x0000, [1, 2])), /end-of-file/i)
})

test('parseIntelHex: rejects an unknown record type', () => {
  assert.throws(() => parseIntelHex([record(0x06, 0x0000, [1]), EOF].join('\n')), /unsupported record type/i)
})

test('parseDfuSeMemoryLayout: parses a mixed STM32F4 sector map', () => {
  const sectors = parseDfuSeMemoryLayout('@Internal Flash  /0x08000000/04*016Kg,01*016Kg,01*064Kg,07*128Kg')
  assert.equal(sectors.length, 4 + 1 + 1 + 7)
  assert.deepEqual(sectors[0], { start: 0x08000000, size: 16 * 1024 })
  assert.deepEqual(sectors[4], { start: 0x08010000, size: 16 * 1024 }) // after 4*16K
  assert.equal(sectors[6].size, 128 * 1024) // first 128K sector
})

test('parseDfuSeMemoryLayout: ignores a non-DfuSe string', () => {
  assert.deepEqual(parseDfuSeMemoryLayout('Some Serial Device'), [])
})

test('sectorsToErase: returns only the unique sectors an image overlaps', () => {
  const sectors = parseDfuSeMemoryLayout('@Internal Flash  /0x08000000/16*128Kg') // H7-style
  // A 200 KiB image spans the first two 128 KiB sectors.
  const targets = sectorsToErase(sectors, [{ address: 0x08000000, data: new Uint8Array(200 * 1024) }])
  assert.deepEqual(targets, [0x08000000, 0x08020000])
})

// A mock DFU interface that emulates flash: records every control-OUT, tracks
// the DfuSe address pointer + programmed bytes, and serves them back on UPLOAD
// (so the read-back verify pass succeeds). `uploadOverride` lets a test return
// wrong bytes to exercise a verify mismatch.
function mockDfu(uploadOverride) {
  const out = []
  const flash = new Map()
  const xfer = 2048
  let addrPtr = 0
  return {
    out,
    flash,
    iface: {
      async controlOut(request, value, data) {
        out.push({ request, value, data: [...data] })
        if (request === 1 && value === 0 && data[0] === 0x21) {
          addrPtr = (data[1] | (data[2] << 8) | (data[3] << 16) | (data[4] << 24)) >>> 0
        } else if (request === 1 && value >= 2) {
          const base = addrPtr + (value - 2) * xfer
          for (let i = 0; i < data.length; i += 1) flash.set(base + i, data[i])
        }
      },
      async controlIn(request, value, length) {
        if (request === 2) {
          // DFU_UPLOAD — serve programmed bytes (or the override for mismatch tests).
          if (uploadOverride) return uploadOverride(length)
          const base = addrPtr + (value - 2) * xfer
          const buf = new Uint8Array(length)
          for (let i = 0; i < length; i += 1) buf[i] = flash.get(base + i) ?? 0xff
          return buf
        }
        // GETSTATUS: status OK (0), pollTimeout 0, state dfuDNLOAD_IDLE (5).
        return new Uint8Array([0, 0, 0, 0, 5, 0])
      }
    }
  }
}

test('DfuSeDevice.flash: erases, sets address, streams blocks, then manifests', async () => {
  const mock = mockDfu()
  const memory = parseDfuSeMemoryLayout('@Internal Flash  /0x08000000/16*128Kg')
  const device = new DfuSeDevice(mock.iface, memory, 2048)
  const image = [{ address: 0x08000000, data: new Uint8Array(5000).fill(0xab) }]

  const phases = []
  await device.flash(image, (p) => phases.push(p.phase))

  const dnloads = mock.out.filter((o) => o.request === 1) // DFU_DNLOAD

  // Exactly one erase (5000 bytes fits in the first 128K sector).
  const erases = dnloads.filter((o) => o.value === 0 && o.data[0] === 0x41)
  assert.equal(erases.length, 1)
  assert.deepEqual(erases[0].data, [0x41, 0x00, 0x00, 0x00, 0x08]) // 0x08000000 LE

  // Set-address command present for the image start.
  assert.ok(dnloads.some((o) => o.value === 0 && o.data[0] === 0x21 && o.data[4] === 0x08))

  // Data blocks use wBlockNum >= 2 and carry the whole payload.
  const dataBlocks = dnloads.filter((o) => o.value >= 2)
  assert.deepEqual(dataBlocks.map((o) => o.value), [2, 3, 4]) // 2048 + 2048 + 904
  assert.equal(dataBlocks.reduce((sum, o) => sum + o.data.length, 0), 5000)

  // Manifest: a zero-length download terminates the sequence.
  assert.ok(dnloads.some((o) => o.value === 0 && o.data.length === 0))

  assert.deepEqual([...new Set(phases)], ['erase', 'program', 'verify', 'manifest'])
})

test('DfuSeDevice.flash: read-back verify passes when the flash matches the image', async () => {
  const mock = mockDfu()
  const memory = parseDfuSeMemoryLayout('@Internal Flash  /0x08000000/16*128Kg')
  const device = new DfuSeDevice(mock.iface, memory, 2048)
  // Emulator serves back what was written, so verify succeeds. A DFU_UPLOAD
  // (request 2) read-back happened.
  await device.flash([{ address: 0x08000000, data: new Uint8Array(3000).fill(0x5a) }])
  // (no throw == verified)
  assert.equal(mock.flash.get(0x08000000), 0x5a)
})

test('DfuSeDevice.flash: read-back verify throws on a mismatch', async () => {
  // UPLOAD always returns 0x00 bytes, never matching the 0xAB image.
  const mock = mockDfu((length) => new Uint8Array(length))
  const memory = parseDfuSeMemoryLayout('@Internal Flash  /0x08000000/16*128Kg')
  const device = new DfuSeDevice(mock.iface, memory, 2048)
  await assert.rejects(
    () => device.flash([{ address: 0x08000000, data: new Uint8Array(64).fill(0xab) }]),
    /verification failed/i
  )
})

test('DfuSeDevice.flash: full erase wipes every sector in the layout, not just the overlapped ones', async () => {
  const mock = mockDfu()
  const memory = parseDfuSeMemoryLayout('@Internal Flash  /0x08000000/16*128Kg') // 16 sectors
  const device = new DfuSeDevice(mock.iface, memory, 2048)
  // A tiny image overlapping only the first sector.
  await device.flash([{ address: 0x08000000, data: new Uint8Array(64).fill(0xab) }], undefined, { fullErase: true })
  const erases = mock.out.filter((o) => o.request === 1 && o.value === 0 && o.data[0] === 0x41)
  assert.equal(erases.length, 16, 'every sector erased on a full wipe')
})

test('DfuSeDevice.flash: full erase falls back to a mass-erase when the layout is unknown', async () => {
  const mock = mockDfu()
  const device = new DfuSeDevice(mock.iface, [], 2048) // no memory layout
  await device.flash([{ address: 0x08000000, data: new Uint8Array(64).fill(0xab) }], undefined, { fullErase: true })
  const erases = mock.out.filter((o) => o.request === 1 && o.value === 0 && o.data[0] === 0x41)
  assert.equal(erases.length, 1, 'one mass-erase command')
  assert.equal(erases[0].data.length, 1, 'mass erase carries no address')
})

test('DfuSeDevice.flash: refuses an image outside the device memory map', async () => {
  const mock = mockDfu()
  const memory = parseDfuSeMemoryLayout('@Internal Flash  /0x08000000/16*128Kg')
  const device = new DfuSeDevice(mock.iface, memory, 2048)
  await assert.rejects(
    () => device.flash([{ address: 0x90000000, data: new Uint8Array(16) }]),
    /outside the device flash memory map/i
  )
})
