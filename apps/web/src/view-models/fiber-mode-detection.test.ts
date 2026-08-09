import { describe, expect, it } from 'vitest'
import type { ConfiguratorSnapshot } from '@arduconfig/ardupilot-core'

import { isFiberModeAvailable, isFiberModeNumber } from './fiber-mode-detection'

function snapshot(options: {
  modes?: Array<{ customMode: number; name: string }>
  params?: string[]
}): ConfiguratorSnapshot {
  return {
    availableModes: (options.modes ?? []).map((mode) => ({ ...mode, standardMode: 0, properties: 0 })),
    parameters: (options.params ?? []).map((id) => ({ id, value: 0 }))
  } as unknown as ConfiguratorSnapshot
}

describe('isFiberModeAvailable', () => {
  it('is false on a stock build, which is the case that matters most', () => {
    // Fiber is fork-only. Showing anything about it to the operators on stock
    // firmware would be documenting a mode their vehicle cannot fly.
    const stock = snapshot({
      modes: [
        { customMode: 0, name: 'Stabilize' },
        { customMode: 2, name: 'Altitude Hold' }
      ],
      params: ['PILOT_Y_RATE', 'ANGLE_MAX']
    })
    expect(isFiberModeAvailable(stock)).toBe(false)
  })

  it('is true when the vehicle advertises a mode called Fiber', () => {
    expect(
      isFiberModeAvailable(snapshot({ modes: [{ customMode: 31, name: 'Fiber' }] }))
    ).toBe(true)
  })

  it('is true from the parameter alone when the firmware does not advertise its modes', () => {
    // The common case for a fork: the mode flies, but nobody added it to the
    // firmware's AVAILABLE_MODES list, so no GCS can enumerate it.
    expect(isFiberModeAvailable(snapshot({ params: ['FIBER_TILT_T'] }))).toBe(true)
  })

  it('does not match a mode that merely contains the letters "fiber"', () => {
    // Word-boundary matching, so an unrelated mode name cannot switch on a
    // fork feature. "Fiberglass Test" is not Fiber mode.
    expect(
      isFiberModeAvailable(snapshot({ modes: [{ customMode: 40, name: 'Fiberglass Test' }] }))
    ).toBe(false)
    expect(
      isFiberModeAvailable(snapshot({ modes: [{ customMode: 40, name: 'Defibrillator' }] }))
    ).toBe(false)
    // The real thing still matches, including when the firmware decorates it.
    expect(isFiberModeAvailable(snapshot({ modes: [{ customMode: 31, name: 'Fiber Cruise' }] }))).toBe(true)
  })

  it('survives a snapshot with neither modes nor parameters yet', () => {
    expect(isFiberModeAvailable({} as unknown as ConfiguratorSnapshot)).toBe(false)
  })
})

describe('isFiberModeNumber', () => {
  it('uses the number the vehicle actually reported, not a hardcoded 31', () => {
    // Another fork could compile Fiber at a different number; the advertised
    // list is the authority when it exists.
    const snap = snapshot({ modes: [{ customMode: 27, name: 'Fiber' }] })
    expect(isFiberModeNumber(snap, 27)).toBe(true)
    expect(isFiberModeNumber(snap, 31)).toBe(false)
  })

  it('falls back to the originating fork’s number when only the parameter is present', () => {
    const snap = snapshot({ params: ['FIBER_TILT_T'] })
    expect(isFiberModeNumber(snap, 31)).toBe(true)
  })

  it('never claims a mode number on a stock build', () => {
    expect(isFiberModeNumber(snapshot({ modes: [{ customMode: 31, name: 'Turtle' }] }), 31)).toBe(false)
  })

  it('is false for an undefined mode number', () => {
    expect(isFiberModeNumber(snapshot({ params: ['FIBER_TILT_T'] }), undefined)).toBe(false)
  })
})
