import { describe, expect, it } from 'vitest'

import {
  buildFilterBank,
  buildFilterIndexOptions,
  filterSlotParamIds,
  FILTER_BANK_SIZE
} from './filter-bank'

const values = (entries: Record<string, number>): ReadonlyMap<string, number> => new Map(Object.entries(entries))

describe('buildFilterBank', () => {
  it('reports nothing on firmware without a filter bank', () => {
    const bank = buildFilterBank(values({ INS_GYRO_FILTER: 40 }))
    expect(bank.supported).toBe(false)
    expect(bank.slots).toEqual([])
    expect(bank.nextFreeIndex).toBeUndefined()
  })

  it('separates configured slots from empty ones', () => {
    const bank = buildFilterBank(
      values({
        FILT1_TYPE: 1,
        FILT1_NOTCH_FREQ: 80,
        FILT1_NOTCH_Q: 2,
        FILT1_NOTCH_ATT: 40,
        FILT2_TYPE: 0,
        FILT3_TYPE: 1,
        FILT3_NOTCH_FREQ: 120
      })
    )
    expect(bank.supported).toBe(true)
    expect(bank.slots.map((slot) => slot.index)).toEqual([1, 2, 3])
    expect(bank.configured.map((slot) => slot.index)).toEqual([1, 3])
    // The next empty slot is where "add another filter" goes.
    expect(bank.nextFreeIndex).toBe(2)
  })

  it('describes a slot by what it actually is', () => {
    const bank = buildFilterBank(
      values({ FILT1_TYPE: 1, FILT1_NOTCH_FREQ: 80, FILT1_NOTCH_ATT: 40, FILT2_TYPE: 0, FILT3_TYPE: 1 })
    )
    expect(bank.slots[0]?.summary).toBe('Notch 80 Hz, 40 dB')
    expect(bank.slots[1]?.summary).toBe('not configured')
    // Enabled but never given a frequency: say so rather than claiming 0 Hz.
    expect(bank.slots[2]?.summary).toBe('Notch no frequency set')
  })

  it('stops at ArduPilot ceiling of eight slots', () => {
    const everySlot = Object.fromEntries(
      Array.from({ length: FILTER_BANK_SIZE + 2 }, (_, index) => [`FILT${index + 1}_TYPE`, 1])
    )
    expect(buildFilterBank(values(everySlot)).slots).toHaveLength(FILTER_BANK_SIZE)
  })
})

describe('buildFilterIndexOptions', () => {
  it('offers None plus every slot, labelled with what it holds', () => {
    const bank = buildFilterBank(values({ FILT1_TYPE: 1, FILT1_NOTCH_FREQ: 80, FILT2_TYPE: 0 }))
    expect(buildFilterIndexOptions(bank)).toEqual([
      { value: 0, label: 'None' },
      { value: 1, label: 'FILT1 — Notch 80 Hz' },
      { value: 2, label: 'FILT2 — not configured' }
    ])
  })

  it('is just None when the firmware has no bank', () => {
    expect(buildFilterIndexOptions(buildFilterBank(values({})))).toEqual([{ value: 0, label: 'None' }])
  })
})

describe('filterSlotParamIds', () => {
  it('names the parameters one slot owns', () => {
    expect(filterSlotParamIds(2)).toEqual(['FILT2_TYPE', 'FILT2_NOTCH_FREQ', 'FILT2_NOTCH_Q', 'FILT2_NOTCH_ATT'])
  })
})
