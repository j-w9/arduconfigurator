import { describe, expect, it } from 'vitest'

import { SCOPED_CHIP_MAX_OPTIONS, shouldRenderOptionChips } from './ScopedField'

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
