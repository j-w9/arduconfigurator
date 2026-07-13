import { describe, expect, it } from 'vitest'

import { buildElrsBootloaderCommand, crsfCrc8, espSyncTraining } from './elrs-bootloader'

describe('crsfCrc8', () => {
  it('matches known CRSF CRC8 (poly 0xD5) vectors', () => {
    expect(crsfCrc8(Uint8Array.from([0x00]))).toBe(0x00)
    expect(crsfCrc8(Uint8Array.from([0x18, 0x2a]))).toBe(0x1a)
    expect(crsfCrc8(Uint8Array.from([0x32, 0x62, 0x6c]))).toBe(0x0a)
  })
})

describe('buildElrsBootloaderCommand', () => {
  it('builds the ELRS init frame [0xEC,0x04,0x32,bl,crc] with no key (matches bootloader.py INIT_SEQ)', () => {
    expect([...buildElrsBootloaderCommand()]).toEqual([0xec, 0x04, 0x32, 0x62, 0x6c, 0x0a])
  })

  it('grows the length byte and re-CRCs when a bind key is supplied', () => {
    const key = Uint8Array.from([1, 2, 3, 4, 5, 6])
    const frame = buildElrsBootloaderCommand(key)
    // [0xEC][len][0x32]['b']['l'][6 key bytes][crc] — len = type+bl+key+crc = 1+2+6+1 = 10
    expect(frame[0]).toBe(0xec)
    expect(frame[1]).toBe(0x0a)
    expect([...frame.slice(2, 5)]).toEqual([0x32, 0x62, 0x6c])
    expect([...frame.slice(5, 11)]).toEqual([1, 2, 3, 4, 5, 6])
    expect(frame[frame.length - 1]).toBe(crsfCrc8(frame.slice(2, frame.length - 1)))
    expect(frame.length).toBe(12)
  })
})

describe('espSyncTraining', () => {
  it('is 0x07 0x07 0x12 0x20 then 32x 0x55', () => {
    const seq = espSyncTraining()
    expect(seq.length).toBe(36)
    expect([...seq.slice(0, 4)]).toEqual([0x07, 0x07, 0x12, 0x20])
    expect([...seq.slice(4)].every((b) => b === 0x55)).toBe(true)
  })
})
