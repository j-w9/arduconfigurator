import { describe, expect, it } from 'vitest'

import {
  buildElrsDefinesJson,
  findElrsFirmwareEnd,
  generateElrsUid,
  patchElrsFirmwareOptions
} from './elrs-firmware-options'

// Build a minimal synthetic ESP32 image: 8-byte header (magic 0xE9, N segments),
// 16-byte extended header (→ segments start at 24), then N segment headers
// (<II> addr+size) each followed by `size` data bytes.
function esp32Image(segments: { size: number }[], trailerBytes = 0): Uint8Array {
  const body: number[] = []
  for (const seg of segments) {
    // addr (unused) + size, little-endian uint32 each
    body.push(0, 0, 0, 0)
    body.push(seg.size & 0xff, (seg.size >> 8) & 0xff, (seg.size >> 16) & 0xff, (seg.size >> 24) & 0xff)
    body.push(...new Array(seg.size).fill(0xaa))
  }
  const header = [0xe9, segments.length, 0, 0, 0, 0, 0, 0, ...new Array(16).fill(0)] // 24 bytes
  return Uint8Array.from([...header, ...body, ...new Array(trailerBytes).fill(0)])
}

describe('findElrsFirmwareEnd', () => {
  it('rejects a non-ESP image', () => {
    expect(() => findElrsFirmwareEnd(Uint8Array.from([0x00, 0x01, 0x02]))).toThrow(/magic/)
  })

  it('computes the aligned end of an ESP32 image (segments from offset 24, +32)', () => {
    // 1 segment of 16 bytes: pos = 24 + 8 + 16 = 48 → align(48)=64 → +32 = 96.
    expect(findElrsFirmwareEnd(esp32Image([{ size: 16 }]))).toBe(96)
    // 3 segments (8/24/16 — NOT 2, which is the ESP8285 sentinel): pos =
    // 24 + (8+8) + (8+24) + (8+16) = 96 → align(96)=112 → +32 = 144.
    expect(findElrsFirmwareEnd(esp32Image([{ size: 8 }, { size: 24 }, { size: 16 }]))).toBe(144)
  })

  it('handles an ESP8285 image (outer segment count 2 → real image at 0x1000, no +32)', () => {
    const inner = esp32Image([{ size: 16 }]) // reuse as the 0x1000 image
    const outer = new Uint8Array(0x1000 + inner.length)
    outer[0] = 0xe9
    outer[1] = 2 // triggers the 8285 path
    outer.set(inner, 0x1000)
    // inner header/segments start at 0x1000; segments read from 0x1001 = 1.
    // pos = 0x1008 + 8 + 16 = 0x1020 (4128) → align(4128)=4128 → no +32.
    expect(findElrsFirmwareEnd(outer)).toBe(0x1020)
  })
})

describe('generateElrsUid', () => {
  it('uses a comma-separated integer list directly, zero-padded to 6', () => {
    expect(generateElrsUid('1,2,3,4')).toEqual([0, 0, 1, 2, 3, 4])
    expect(generateElrsUid('10,20,30,40,50,60')).toEqual([10, 20, 30, 40, 50, 60])
  })

  it('falls back to the first 6 bytes of MD5 for a text phrase', () => {
    expect(generateElrsUid('test')).toEqual([79, 4, 253, 130, 33, 85])
  })

  it('treats an out-of-range int list as a phrase (MD5)', () => {
    expect(generateElrsUid('1,2,3,999').length).toBe(6)
    expect(generateElrsUid('1,2,3,999')).not.toEqual([0, 0, 1, 2, 3, 999])
  })
})

describe('buildElrsDefinesJson', () => {
  it('emits only the set flags plus a flash-discriminator, with uid from the phrase', () => {
    const json = buildElrsDefinesJson({ bindPhrase: 'test', domain: 1, flashDiscriminator: 42 })
    expect(JSON.parse(json)).toEqual({ uid: [79, 4, 253, 130, 33, 85], domain: 1, 'flash-discriminator': 42 })
  })

  it('prefers an explicit uid over the bind phrase', () => {
    const json = buildElrsDefinesJson({ bindPhrase: 'test', uid: [1, 2, 3, 4, 5, 6], flashDiscriminator: 1 })
    expect(JSON.parse(json).uid).toEqual([1, 2, 3, 4, 5, 6])
  })
})

describe('patchElrsFirmwareOptions', () => {
  it('overwrites the 512-byte defines region in place and leaves the rest intact', () => {
    // ESP32 image with end=96 → defines at 96+144 = 240; need >= 752 bytes.
    const image = esp32Image([{ size: 16 }], 800)
    const patched = patchElrsFirmwareOptions(image, { bindPhrase: 'test', domain: 1, flashDiscriminator: 42 })
    expect(patched.length).toBe(image.length)
    expect(patched).not.toBe(image) // a copy, not mutated in place
    const definesOffset = 240
    const json = new TextDecoder().decode(patched.slice(definesOffset, definesOffset + 512)).replace(/\0+$/, '')
    expect(JSON.parse(json)).toEqual({ uid: [79, 4, 253, 130, 33, 85], domain: 1, 'flash-discriminator': 42 })
    // Bytes before the defines region are untouched.
    expect([...patched.slice(0, 96)]).toEqual([...image.slice(0, 96)])
  })

  it('refuses an image with no options region rather than writing past the end', () => {
    const tooSmall = esp32Image([{ size: 16 }]) // ~52 bytes, no appended regions
    expect(() => patchElrsFirmwareOptions(tooSmall, { bindPhrase: 'x' })).toThrow(/options region/)
  })
})
