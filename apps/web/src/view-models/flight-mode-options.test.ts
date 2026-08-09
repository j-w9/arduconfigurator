import { describe, expect, it } from 'vitest'
import type { AvailableFlightMode } from '@arduconfig/ardupilot-core'

import { buildFlightModeOptions } from './flight-mode-options'

const CATALOG = [
  { value: 0, label: 'Stabilize' },
  { value: 2, label: 'AltHold' },
  { value: 5, label: 'Loiter' }
]

function mode(customMode: number, name: string, properties = 0): AvailableFlightMode {
  return { customMode, name, standardMode: 0, properties }
}

describe('buildFlightModeOptions', () => {
  it('falls back to the catalogue when the vehicle has not answered', () => {
    // Firmware without AVAILABLE_MODES, or before the enumeration completes,
    // must behave exactly as it did before any of this existed.
    expect(buildFlightModeOptions({ availableModes: [], catalogOptions: CATALOG })).toEqual(CATALOG)
  })

  it('offers a fork-custom mode the catalogue has never heard of', () => {
    // The whole point: Fiber is mode 31 on a fork. A curated table cannot know
    // it, so without this the operator cannot assign it from the dropdown.
    const options = buildFlightModeOptions({
      availableModes: [mode(0, 'Stabilize'), mode(2, 'Altitude Hold'), mode(31, 'Fiber')],
      catalogOptions: CATALOG
    })
    expect(options).toContainEqual({ value: 31, label: 'Fiber' })
  })

  it('keeps the catalogue wording for modes we already name', () => {
    // The firmware calls it "Altitude Hold"; the rest of the app says
    // "AltHold". Familiar modes should not be renamed just because the vehicle
    // now supplies the list.
    const options = buildFlightModeOptions({
      availableModes: [mode(2, 'Altitude Hold'), mode(31, 'Fiber')],
      catalogOptions: CATALOG
    })
    expect(options.find((option) => option.value === 2)?.label).toBe('AltHold')
  })

  it('drops modes the vehicle says an operator cannot select', () => {
    // Advertising a mode that cannot be assigned is worse than omitting it.
    const options = buildFlightModeOptions({
      availableModes: [mode(0, 'Stabilize'), mode(27, 'Auto RTL', 1)],
      catalogOptions: CATALOG
    })
    expect(options.some((option) => option.value === 27)).toBe(false)
  })

  it('returns the catalogue when every reported mode is unselectable', () => {
    // Not "return an empty dropdown", which would strand the operator.
    const options = buildFlightModeOptions({
      availableModes: [mode(27, 'Auto RTL', 1)],
      catalogOptions: CATALOG
    })
    expect(options).toEqual(CATALOG)
  })

  it('never drops the value that is currently assigned', () => {
    // A select that silently discards the value it is displaying reads as the
    // parameter having changed on its own.
    const options = buildFlightModeOptions({
      availableModes: [mode(0, 'Stabilize')],
      catalogOptions: CATALOG,
      currentValue: 31
    })
    expect(options).toContainEqual({ value: 31, label: 'Mode 31' })
  })

  it('names an unnamed mode by its number rather than showing a blank row', () => {
    const options = buildFlightModeOptions({
      availableModes: [mode(0, 'Stabilize'), mode(44, '')],
      catalogOptions: CATALOG
    })
    expect(options).toContainEqual({ value: 44, label: 'Mode 44' })
  })

  it('sorts by mode number so the list order is stable', () => {
    const options = buildFlightModeOptions({
      availableModes: [mode(31, 'Fiber'), mode(0, 'Stabilize'), mode(29, 'VALT Hold')],
      catalogOptions: CATALOG
    })
    expect(options.map((option) => option.value)).toEqual([0, 29, 31])
  })
})
