import { describe, expect, it } from 'vitest'

import { flightModeSpans, noteParamValue } from './use-mavlink-plot-workspace'

describe('flight-mode spans', () => {
  it('turn mode changes into spans over the window, the last running to now', () => {
    const changes = [
      { t: 0, mode: 'Stabilize', armed: false },
      { t: 30, mode: 'Stabilize', armed: true },
      { t: 50, mode: 'Loiter', armed: true }
    ]
    expect(flightModeSpans(changes, 70, 40)).toEqual([
      { from: 40, to: 50, mode: 'Stabilize', armed: true },
      { from: 50, to: 70, mode: 'Loiter', armed: true }
    ])
    expect(flightModeSpans([], 70, 10)).toEqual([])
  })
})

describe('parameter changes', () => {
  it('are learned on first sight and reported when the value moves', () => {
    const known = new Map<string, number>()
    expect(noteParamValue(known, 'ATC_RAT_RLL_P', 0.135, 1)).toBeUndefined()
    expect(noteParamValue(known, 'ATC_RAT_RLL_P', 0.135, 2)).toBeUndefined()
    expect(noteParamValue(known, 'ATC_RAT_RLL_P', 0.15, 3)).toEqual({ t: 3, name: 'ATC_RAT_RLL_P', from: 0.135, to: 0.15 })
    // float32 round trip noise is not a change
    expect(noteParamValue(known, 'ATC_RAT_RLL_P', 0.15000000596, 4)).toBeUndefined()
  })
})
