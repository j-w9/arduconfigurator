import { describe, expect, it } from 'vitest'

import { flightModeSpans } from './use-mavlink-plot-workspace'

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
