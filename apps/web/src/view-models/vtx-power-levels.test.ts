import { describe, expect, it } from 'vitest'

import { deriveVtxPowerLevels } from './vtx-power-levels'

describe('deriveVtxPowerLevels', () => {
  it('returns undefined for an absent table', () => {
    expect(deriveVtxPowerLevels(undefined)).toBeUndefined()
  })

  it('indexes the non-zero levels 0-based in table order', () => {
    expect(
      deriveVtxPowerLevels([
        { value: 25, label: '25' },
        { value: 400, label: '400' },
        { value: 800, label: '800' },
        { value: 1600, label: '1W6' }
      ])
    ).toEqual([
      { index: 0, mw: 25, label: '25' },
      { index: 1, mw: 400, label: '400' },
      { index: 2, mw: 800, label: '800' },
      { index: 3, mw: 1600, label: '1W6' }
    ])
  })

  it('drops a 0-value (disabled/pit) level and RE-INDEXES the survivors', () => {
    // Matches the firmware: get_power_mw_for_index counts only active (non-zero)
    // levels, so a middle zero must shift the indices of everything after it.
    const out = deriveVtxPowerLevels([
      { value: 25, label: '25' },
      { value: 0, label: 'pit' },
      { value: 800, label: '800' }
    ])
    expect(out).toEqual([
      { index: 0, mw: 25, label: '25' },
      { index: 1, mw: 800, label: '800' } // NOT index 2 — the zero row is skipped
    ])
  })

  it('returns an empty list for an all-zero table', () => {
    expect(deriveVtxPowerLevels([{ value: 0, label: '-' }])).toEqual([])
  })
})
