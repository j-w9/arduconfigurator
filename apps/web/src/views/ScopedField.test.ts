import { describe, expect, it } from 'vitest'

import {
  SCOPED_CHIP_MAX_OPTIONS,
  formatBitmaskSummary,
  optionsAreHintList,
  shouldRenderOptionChips,
  unlistedSetBits
} from './ScopedField'

// The single-select chip grid (matching the bitmask box look) is only usable
// for small/moderate enums; larger ones (GPS_TYPE, SERVOn_FUNCTION, …) must
// fall back to the native dropdown. Guard the threshold behaviour here so the
// chips-vs-dropdown decision stays off the DOM.
describe('shouldRenderOptionChips', () => {
  it('renders chips for a small/moderate option count', () => {
    expect(shouldRenderOptionChips(1)).toBe(true)
    expect(shouldRenderOptionChips(4)).toBe(true)
    expect(shouldRenderOptionChips(SCOPED_CHIP_MAX_OPTIONS)).toBe(true)
  })

  it('falls back to the dropdown once the option count exceeds the threshold', () => {
    expect(shouldRenderOptionChips(SCOPED_CHIP_MAX_OPTIONS + 1)).toBe(false)
    expect(shouldRenderOptionChips(24)).toBe(false)
  })

  it('falls back to the dropdown when there are no options', () => {
    expect(shouldRenderOptionChips(0)).toBe(false)
  })
})

// A param whose range runs past its named options treats those options as HINTS
// (RELAY_PIN: -1..1015, only ~30 GPIO pins named). It must render as a number
// field so an unlisted pin (81) shows the value instead of falling to "Disabled".
describe('optionsAreHintList', () => {
  it('is true for RELAY_PIN — sparse named pins across a wide range', () => {
    // ~36 options scattered across -1..1015 (AUXOUT + DroneCAN hardpoints),
    // with pin 81 in a gap.
    const options = [{ value: -1 }, { value: 50 }, { value: 51 }, { value: 1015 }]
    expect(optionsAreHintList({ minimum: -1, maximum: 1015, options })).toBe(true)
  })

  it('is false for a closed enum that densely covers its range', () => {
    expect(
      optionsAreHintList({ minimum: 0, maximum: 3, options: [{ value: 0 }, { value: 1 }, { value: 2 }, { value: 3 }] })
    ).toBe(false)
  })

  it('is false for a moderate enum even if a little sparse (range under the floor)', () => {
    // e.g. a 0..27 flight-mode enum — a dropdown, not a pin field.
    const options = Array.from({ length: 20 }, (_, i) => ({ value: i }))
    expect(optionsAreHintList({ minimum: 0, maximum: 27, options })).toBe(false)
  })

  it('is false without a min/max range, or with no options', () => {
    expect(optionsAreHintList({ options: [{ value: 0 }, { value: 1 }] })).toBe(false)
    expect(optionsAreHintList({ minimum: -1, maximum: 1015, options: [] })).toBe(false)
    expect(optionsAreHintList(undefined)).toBe(false)
  })
})

// A bitmask can carry a bit the metadata does not list (a fork option such as
// FS_OPTIONS bit 6). It has to show up so it can be seen and cleared.
describe('unlistedSetBits', () => {
  const sixBits = [0, 1, 2, 3, 4, 5].map((value) => ({ value }))
  it('returns set bits missing from the list, lowest first', () => {
    expect(unlistedSetBits(64, sixBits)).toEqual([6])
    expect(unlistedSetBits(64 + 16 + 256, sixBits)).toEqual([6, 8])
  })
  it('returns nothing when every set bit is listed', () => {
    expect(unlistedSetBits(0, sixBits)).toEqual([])
    expect(unlistedSetBits(16 + 1, sixBits)).toEqual([])
  })
})

describe('formatBitmaskSummary', () => {
  it('leads with the raw value', () => {
    expect(formatBitmaskSummary(0, 0, 6, [])).toBe('0 · None set')
    expect(formatBitmaskSummary(17, 2, 6, [])).toBe('17 · 2 of 6 set')
  })
  it('names a set bit that is not in the list', () => {
    expect(formatBitmaskSummary(64, 0, 6, [6])).toBe('64 · bit 6 not in list')
    expect(formatBitmaskSummary(80, 1, 6, [6])).toBe('80 · 1 of 6 set, bit 6 not in list')
  })
})
