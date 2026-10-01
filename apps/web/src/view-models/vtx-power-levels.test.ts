import { describe, expect, it } from 'vitest'

import { deriveVtxPowerLevels } from './vtx-power-levels'

// Power levels are VTX_PWRTBL1..6 now, so this derives from parameter SLOTS:
// 'power' carries milliwatts, 'pit' is 0, 'unused' is -1.
const slot = (kind: string, milliwatts?: number) => ({ kind, milliwatts })
const label = (mw: number): string => String(mw)

describe('deriveVtxPowerLevels', () => {
  it('returns undefined when the firmware exposes no power table', () => {
    expect(deriveVtxPowerLevels(undefined, label)).toBeUndefined()
  })

  it('indexes the powered slots 0-based in slot order', () => {
    expect(
      deriveVtxPowerLevels(
        [slot('power', 25), slot('power', 400), slot('power', 800), slot('power', 1600)],
        label
      )
    ).toEqual([
      { index: 0, mw: 25, label: '25' },
      { index: 1, mw: 400, label: '400' },
      { index: 2, mw: 800, label: '800' },
      { index: 3, mw: 1600, label: '1600' }
    ])
  })

  it('drops pit and unused slots and RE-INDEXES the survivors', () => {
    // Matches the firmware: get_power_mw_for_index counts only slots that carry
    // a power, so a pit slot in the middle shifts everything after it.
    expect(
      deriveVtxPowerLevels([slot('power', 25), slot('pit', undefined), slot('power', 800)], label)
    ).toEqual([
      { index: 0, mw: 25, label: '25' },
      { index: 1, mw: 800, label: '800' } // NOT index 2 — the pit slot is skipped
    ])

    expect(
      deriveVtxPowerLevels([slot('unused'), slot('power', 25), slot('unused')], label)
    ).toEqual([{ index: 0, mw: 25, label: '25' }])
  })

  it('returns an empty list when no slot carries a power', () => {
    expect(deriveVtxPowerLevels([slot('pit'), slot('unused')], label)).toEqual([])
  })

  it('derives the display label from the value, since none is stored any more', () => {
    const out = deriveVtxPowerLevels([slot('power', 1600)], (mw) => `${mw / 1000}W`)
    expect(out).toEqual([{ index: 0, mw: 1600, label: '1.6W' }])
  })
})
