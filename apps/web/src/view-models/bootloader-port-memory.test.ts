import { describe, expect, it } from 'vitest'

import { formatUsbIds, knownBootloaderPort, parseBootloaderPortMemory, rememberBootloaderPort } from './bootloader-port-memory'

describe('bootloader port memory', () => {
  it('remembers the device a board’s bootloader was caught on, by board id', () => {
    let memory = rememberBootloaderPort({}, 1013, { vendorId: 0x1209, productId: 0x5741 })
    expect(knownBootloaderPort(memory, 1013)).toEqual({ vendorId: 0x1209, productId: 0x5741 })
    expect(knownBootloaderPort(memory, 140)).toBeUndefined()
    expect(knownBootloaderPort(memory, undefined)).toBeUndefined()
    // Same again: the same object, nothing to store.
    expect(rememberBootloaderPort(memory, 1013, { vendorId: 0x1209, productId: 0x5741 })).toBe(memory)
    memory = rememberBootloaderPort(memory, 1013, undefined)
    expect(formatUsbIds(knownBootloaderPort(memory, 1013)!)).toBe('1209:5741')
  })

  it('round-trips through storage and drops what does not parse', () => {
    const memory = rememberBootloaderPort({}, 140, { vendorId: 0x2dae, productId: 0x1016 })
    expect(parseBootloaderPortMemory(JSON.stringify(memory))).toEqual(memory)
    expect(parseBootloaderPortMemory(JSON.stringify({ x: { vendorId: 1, productId: 2 }, 5: { vendorId: 'a' }, 7: { vendorId: 3, productId: 4 } }))).toEqual({ 7: { vendorId: 3, productId: 4 } })
    expect(parseBootloaderPortMemory('not json')).toEqual({})
    expect(parseBootloaderPortMemory(null)).toEqual({})
  })
})
