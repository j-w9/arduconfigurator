import { describe, expect, it } from 'vitest'

import { mergeSelectedPresetDrafts } from './use-preset-catalog'

type Preview = { diff: { draftValues: Record<string, string>; unknownParameterIds: readonly string[] } }

const preview = (draftValues: Record<string, string>, unknownParameterIds: readonly string[] = []): Preview => ({
  diff: { draftValues, unknownParameterIds }
})

describe('mergeSelectedPresetDrafts', () => {
  it('unions the desired values of presets from different categories', () => {
    const previews = new Map<string, Preview>([
      ['a', preview({ ANGLE_MAX: '3000', PILOT_Y_RATE: '90' })],
      ['b', preview({ ACRO_RP_RATE: '360' })]
    ])
    const result = mergeSelectedPresetDrafts([{ id: 'a' }, { id: 'b' }], previews)
    expect(result.mergedDraftValues).toEqual({ ANGLE_MAX: '3000', PILOT_Y_RATE: '90', ACRO_RP_RATE: '360' })
    expect(result.conflicts).toEqual([])
    expect(result.touchedCount).toBe(3)
  })

  it('flags a param set by two presets to differing values as a conflict, later selection wins', () => {
    const previews = new Map<string, Preview>([
      ['a', preview({ ANGLE_MAX: '3000' })],
      ['b', preview({ ANGLE_MAX: '4500' })]
    ])
    const result = mergeSelectedPresetDrafts([{ id: 'a' }, { id: 'b' }], previews)
    expect(result.mergedDraftValues.ANGLE_MAX).toBe('4500') // later (b) wins
    expect(result.conflicts).toEqual(['ANGLE_MAX'])
  })

  it('does not flag a param two presets agree on', () => {
    const previews = new Map<string, Preview>([
      ['a', preview({ ANGLE_MAX: '3000' })],
      ['b', preview({ ANGLE_MAX: '3000', ACRO_Y_RATE: '180' })]
    ])
    const result = mergeSelectedPresetDrafts([{ id: 'a' }, { id: 'b' }], previews)
    expect(result.conflicts).toEqual([])
    expect(result.mergedDraftValues).toEqual({ ANGLE_MAX: '3000', ACRO_Y_RATE: '180' })
  })

  it('unions unknown parameter ids and skips presets with no preview', () => {
    const previews = new Map<string, Preview>([
      ['a', preview({ ANGLE_MAX: '3000' }, ['GHOST_PARAM'])],
      ['b', preview({ ACRO_RP_RATE: '360' }, ['GHOST_PARAM', 'OTHER_GHOST'])]
    ])
    const result = mergeSelectedPresetDrafts([{ id: 'a' }, { id: 'missing' }, { id: 'b' }], previews)
    expect(result.unknownIds.sort()).toEqual(['GHOST_PARAM', 'OTHER_GHOST'])
    expect(result.touchedCount).toBe(2)
  })

  it('returns an empty merge for an empty selection', () => {
    const result = mergeSelectedPresetDrafts([], new Map())
    expect(result.mergedDraftValues).toEqual({})
    expect(result.conflicts).toEqual([])
    expect(result.touchedCount).toBe(0)
  })
})
