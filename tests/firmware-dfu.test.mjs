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

test('parseIntelHex: parses a large contiguous image in roughly linear time (no O(n^2) re-copy)', () => {
  // Regression guard: coalesce() used to reallocate + copy the WHOLE
  // accumulated segment on every single contiguous data record, which is
  // O(n^2) in the segment size — a real ~1.5 MB ArduPilot .hex (tens of
  // thousands of 16-byte records) made the browser feel hung just parsing
  // the file. A real STM32F4 image is ~1-2 MB; use a representative size and
  // assert it completes quickly, not just correctly.
  const RECORD_BYTES = 16
  const RECORD_COUNT = 100_000 // ~1.6 MB of contiguous data
  const BASE_ADDRESS = 0x08000000
  const lines = []
  let lastUpper16 = -1
  for (let i = 0; i < RECORD_COUNT; i += 1) {
    const absoluteAddress = BASE_ADDRESS + i * RECORD_BYTES
    const upper16 = (absoluteAddress / 0x10000) & 0xffff // record's ELA field: absoluteAddress = upper16 * 0x10000 + offset
    if (upper16 !== lastUpper16) {
      lines.push(record(0x04, 0x0000, [(upper16 >> 8) & 0xff, upper16 & 0xff]))
      lastUpper16 = upper16
    }
    const data = Array.from({ length: RECORD_BYTES }, (_, b) => (i + b) & 0xff)
    lines.push(record(0x00, absoluteAddress & 0xffff, data))
  }
  lines.push(EOF)
  const hex = lines.join('\n')

  const start = performance.now()
  const parsed = parseIntelHex(hex)
  const elapsedMs = performance.now() - start

  assert.equal(parsed.segments.length, 1)
  assert.equal(parsed.totalBytes, RECORD_COUNT * RECORD_BYTES)
  assert.equal(parsed.segments[0].data[0], 0)
  assert.equal(parsed.segments[0].data[RECORD_BYTES], 1 & 0xff)
  // O(n^2) re-copying at this size took multiple seconds locally; O(n)
  // finishes in well under a second. Generous ceiling so this doesn't flake
  // on a slow CI runner while still catching a quadratic regression.
  assert.ok(elapsedMs < 3000, `expected roughly-linear parse time, took ${elapsedMs.toFixed(0)}ms`)
})

test('parseDfuSeMemoryLayout: parses a mixed STM32F4 sector map', () => {
  const sectors = parseDfuSeMemoryLayout('@Internal Flash  /0x08000000/04*016Kg,01*016Kg,01*064Kg,07*128Kg')
  assert.equal(sectors.length, 4 + 1 + 1 + 7)
  // Sectors now carry the DfuSe permission bits from the type letter; `g` is
  // readable + erasable + writeable.
  assert.deepEqual(sectors[0], {
    start: 0x08000000,
    size: 16 * 1024,
    readable: true,
    erasable: true,
    writable: true
  })
  assert.deepEqual(sectors[4], {
    start: 0x08010000,
    size: 16 * 1024,
    readable: true,
    erasable: true,
    writable: true
  }) // after 4*16K
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
function mockDfu(uploadOverride, failLeave) {
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
        // Emulate the board detaching on the zero-length leave (control stall).
        if (failLeave && request === 1 && value === 0 && data.length === 0) {
          throw new Error('DFU control OUT failed (stall)')
        }
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

  // Each chunk goes to its own address as block 2 (so one can be resent on its
  // own); the image's first 32-byte flash word goes last, and the tail is
  // padded to a whole flash word with erased bytes.
  const dataBlocks = dnloads.filter((o) => o.value >= 2)
  assert.ok(dataBlocks.every((o) => o.value === 2))
  assert.deepEqual(dataBlocks.map((o) => o.data.length), [2016, 2048, 928, 32]) // 5000 -> 5024
  const writtenAt = []
  let pointer = 0
  for (const o of dnloads) {
    if (o.value === 0 && o.data[0] === 0x21) pointer = (o.data[1] | (o.data[2] << 8) | (o.data[3] << 16) | (o.data[4] << 24)) >>> 0
    else if (o.value >= 2) writtenAt.push(pointer)
  }
  assert.deepEqual(writtenAt, [0x08000020, 0x08000800, 0x08001000, 0x08000000])
  assert.deepEqual([...mock.flash.entries()].filter(([a]) => a >= 0x08000000 + 5000).map(([, v]) => v), new Array(24).fill(0xff))

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

test('DfuSeDevice.flash: a control stall during the manifest/leave is treated as success', async () => {
  // The board commonly detaches mid-leave on real hardware, stalling the final
  // control transfer. The write + verify already succeeded, so this must NOT
  // surface as a flash failure.
  const mock = mockDfu(undefined, true)
  const memory = parseDfuSeMemoryLayout('@Internal Flash  /0x08000000/16*128Kg')
  const device = new DfuSeDevice(mock.iface, memory, 2048)
  await device.flash([{ address: 0x08000000, data: new Uint8Array(64).fill(0xab) }])
  // No throw == the leave stall was tolerated.
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

test('DfuSeDevice.flash: a partial erase with no sector map falls back to a mass-erase (never programs un-erased flash)', async () => {
  const mock = mockDfu()
  const device = new DfuSeDevice(mock.iface, [], 2048) // no memory layout
  // Default (partial) erase path — no fullErase. Without a sector map the old
  // code erased nothing and then programmed onto un-erased flash (corrupt image).
  await device.flash([{ address: 0x08000000, data: new Uint8Array(64).fill(0xab) }])
  const erases = mock.out.filter((o) => o.request === 1 && o.value === 0 && o.data[0] === 0x41)
  assert.equal(erases.length, 1, 'a mass-erase ran instead of erasing nothing')
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

test('DfuSeDevice.flash: waits out the poll timeout on the clock it is given, not a page timer', async () => {
  const mock = mockDfu()
  // After each download the board reports busy for one poll, asking for 25 ms.
  const busyAfterDownload = mock.iface.controlOut
  let busy = false
  mock.iface.controlOut = async (request, value, data) => {
    await busyAfterDownload(request, value, data)
    if (request === 1) busy = true
  }
  const statusIn = mock.iface.controlIn
  mock.iface.controlIn = async (request, value, length) => {
    if (request === 3 && busy) {
      busy = false
      return new Uint8Array([0, 25, 0, 0, 4, 0]) // dfuDNBUSY, bwPollTimeout 25
    }
    return statusIn(request, value, length)
  }
  const waits = []
  const memory = parseDfuSeMemoryLayout('@Internal Flash  /0x08000000/16*128Kg')
  const device = new DfuSeDevice(mock.iface, memory, 2048, async (ms) => {
    waits.push(ms)
  })
  await device.flash([{ address: 0x08000000, data: new Uint8Array(5000).fill(0xab) }])
  // erase + set-address + 3 blocks (+ verify's set-address), each one wait of 25 ms.
  assert.ok(waits.length >= 5)
  assert.ok(waits.every((ms) => ms === 25))
})
