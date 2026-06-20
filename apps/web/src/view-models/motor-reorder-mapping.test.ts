import { describe, expect, it } from 'vitest'

import {
  invertGuidedReorderMapping,
  isGuidedReorderComplete,
  pickedReorderPositions
} from './motor-reorder-mapping'

describe('invertGuidedReorderMapping', () => {
  it('identity wiring inverts to identity selections', () => {
    expect(invertGuidedReorderMapping({ 1: 1, 2: 2, 3: 3, 4: 4 })).toEqual({
      1: '1',
      2: '2',
      3: '3',
      4: '4'
    })
  })

  it('a transposition: OUT1 moved position 2, OUT2 moved position 1', () => {
    // mapping[output] = position. Inverse must say motor-position 2 is
    // driven by OUT1 and position 1 by OUT2.
    expect(invertGuidedReorderMapping({ 1: 2, 2: 1, 3: 3, 4: 4 })).toEqual({
      2: '1',
      1: '2',
      3: '3',
      4: '4'
    })
  })

  it('a 3-cycle (OUT1→pos2, OUT2→pos3, OUT3→pos1) inverts correctly', () => {
    // selections[position] = output-that-moves-it.
    expect(invertGuidedReorderMapping({ 1: 2, 2: 3, 3: 1 })).toEqual({
      2: '1',
      3: '2',
      1: '3'
    })
  })
})

describe('isGuidedReorderComplete', () => {
  it('true only when every output is assigned a DISTINCT position', () => {
    expect(isGuidedReorderComplete({ 1: 1, 2: 2, 3: 3, 4: 4 }, 4)).toBe(true)
    expect(isGuidedReorderComplete({ 1: 2, 2: 1 }, 2)).toBe(true)
  })

  it('false when a position is double-picked (a motor would be dropped)', () => {
    // OUT1 and OUT3 both claimed position 2 → position 4 never assigned.
    expect(isGuidedReorderComplete({ 1: 2, 2: 1, 3: 2, 4: 3 }, 4)).toBe(false)
  })

  it('false when fewer outputs were identified than expected', () => {
    expect(isGuidedReorderComplete({ 1: 1, 2: 2 }, 4)).toBe(false)
  })
})

describe('pickedReorderPositions', () => {
  it('returns the set of positions already claimed', () => {
    expect([...pickedReorderPositions({ 1: 3, 2: 1 })].sort()).toEqual([1, 3])
    expect(pickedReorderPositions({}).size).toBe(0)
  })
})
