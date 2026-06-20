import { describe, expect, it } from 'vitest'

import { applyDraftSelectionClick, pruneDraftSelection } from './draft-selection'

const IDS = ['A', 'B', 'C', 'D', 'E'] as const

describe('applyDraftSelectionClick', () => {
  it('plain click toggles a single id on and off', () => {
    const on = applyDraftSelectionClick(new Set(), IDS, 'C', { shiftKey: false, anchorId: null })
    expect([...on]).toEqual(['C'])
    const off = applyDraftSelectionClick(on, IDS, 'C', { shiftKey: false, anchorId: 'C' })
    expect(off.size).toBe(0)
  })

  it('shift-click selects the inclusive range from the anchor, in either direction', () => {
    const down = applyDraftSelectionClick(new Set(['B']), IDS, 'D', { shiftKey: true, anchorId: 'B' })
    expect([...down].sort()).toEqual(['B', 'C', 'D'])
    const up = applyDraftSelectionClick(new Set(['D']), IDS, 'B', { shiftKey: true, anchorId: 'D' })
    expect([...up].sort()).toEqual(['B', 'C', 'D'])
  })

  it('shift-click on an already-selected target DESELECTS the range', () => {
    const all = new Set(['A', 'B', 'C', 'D'])
    const next = applyDraftSelectionClick(all, IDS, 'C', { shiftKey: true, anchorId: 'A' })
    expect([...next].sort()).toEqual(['D'])
  })

  it('shift-click without a usable anchor falls back to a single toggle', () => {
    const noAnchor = applyDraftSelectionClick(new Set(), IDS, 'B', { shiftKey: true, anchorId: null })
    expect([...noAnchor]).toEqual(['B'])
    const staleAnchor = applyDraftSelectionClick(new Set(), IDS, 'B', { shiftKey: true, anchorId: 'GONE' })
    expect([...staleAnchor]).toEqual(['B'])
  })

  it('does not mutate the input set', () => {
    const input = new Set(['A'])
    applyDraftSelectionClick(input, IDS, 'B', { shiftKey: false, anchorId: null })
    expect([...input]).toEqual(['A'])
  })
})

describe('pruneDraftSelection', () => {
  it('drops ids that left the staged list and keeps the same reference when nothing changed', () => {
    const current = new Set(['A', 'C'])
    expect(pruneDraftSelection(current, IDS)).toBe(current)
    const pruned = pruneDraftSelection(new Set(['A', 'GONE']), IDS)
    expect([...pruned]).toEqual(['A'])
  })
})
