import { describe, expect, it } from 'vitest'

import { describeBitmaskSelections, hasBitmaskFlag, toggleBitmaskFlag } from './bitmask'

/**
 * These three drive every bitmask parameter in the app — arming checks, RC
 * options, the BLHeli output masks, serial options. The high-bit handling is
 * deliberate and load-bearing: `1 << 31` is NEGATIVE in JavaScript, so a
 * "simplification" back to shifts would write a negative value into a parameter
 * and corrupt it. Nothing tested that until now.
 */
describe('hasBitmaskFlag', () => {
  it('reads low bits', () => {
    expect(hasBitmaskFlag(0b1010, 1)).toBe(true)
    expect(hasBitmaskFlag(0b1010, 0)).toBe(false)
    expect(hasBitmaskFlag(0b1010, 3)).toBe(true)
  })

  it('reads bit 31 without falling into the signed-32-bit sign bit', () => {
    // 2 ** 31 has bit 31 set and nothing else. `1 << 31` would be -2147483648.
    expect(hasBitmaskFlag(2 ** 31, 31)).toBe(true)
    expect(hasBitmaskFlag(2 ** 31, 30)).toBe(false)
    expect(hasBitmaskFlag(2 ** 32 - 1, 31)).toBe(true)
  })

  it('treats missing and non-finite values as no flags rather than throwing', () => {
    expect(hasBitmaskFlag(undefined, 3)).toBe(false)
    expect(hasBitmaskFlag(Number.NaN, 3)).toBe(false)
  })
})

describe('toggleBitmaskFlag', () => {
  it('sets and clears a bit', () => {
    expect(toggleBitmaskFlag(0, 2, true)).toBe(4)
    expect(toggleBitmaskFlag(5, 0, false)).toBe(4)
    // Setting an already-set bit is a no-op, not a toggle.
    expect(toggleBitmaskFlag(4, 2, true)).toBe(4)
  })

  it('returns an UNSIGNED value for bit 31', () => {
    // Without the >>> 0 this is -2147483648, which is what would reach the FC.
    const result = toggleBitmaskFlag(0, 31, true)
    expect(result).toBe(2 ** 31)
    expect(result).toBeGreaterThan(0)
    expect(toggleBitmaskFlag(2 ** 31, 31, false)).toBe(0)
  })

  it('ignores bits outside 0..31 instead of wrapping into a real bit', () => {
    // `1 << 32` is 1 in JavaScript, so an unguarded shift would silently
    // toggle bit 0 when asked for bit 32.
    expect(toggleBitmaskFlag(0, 32, true)).toBe(0)
    expect(toggleBitmaskFlag(0, -1, true)).toBe(0)
    expect(toggleBitmaskFlag(6, 1.5, true)).toBe(6)
  })
})

describe('describeBitmaskSelections', () => {
  const labels = { 0: 'Alpha', 2: 'Gamma', 31: 'High' }

  it('lists the set bits in map order', () => {
    expect(describeBitmaskSelections(0b101, labels)).toBe('Alpha, Gamma')
  })

  it('includes bit 31', () => {
    expect(describeBitmaskSelections(2 ** 31, labels)).toBe('High')
  })

  it('distinguishes "nothing selected" from "value unknown"', () => {
    // These are different states and must not collapse: 0 is a real answer.
    expect(describeBitmaskSelections(0, labels)).toBe('None')
    expect(describeBitmaskSelections(undefined, labels)).toBe('Unknown')
  })
})
