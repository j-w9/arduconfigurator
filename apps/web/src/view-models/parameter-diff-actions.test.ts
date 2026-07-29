import type { ParameterDraftEntry, ParameterDraftGroup } from '@arduconfig/ardupilot-core'
import { describe, expect, it } from 'vitest'

import {
  isOverridableInvalidEntry,
  overridableInvalidParamIds,
  paramIdsForGroup,
  stageableDraftValues
} from './parameter-diff-actions'

function entry(over: Partial<ParameterDraftEntry> & { id: string }): ParameterDraftEntry {
  return {
    label: over.id,
    category: 'general',
    rawValue: '1',
    status: 'staged',
    ...over
  } as ParameterDraftEntry
}

describe('overridableInvalidParamIds', () => {
  it('returns only invalid rows the core marks overridable', () => {
    // The flag is the authority. The Parameters tab used to string-match the
    // reason text instead, so rewording a validator message would silently
    // remove its Override button.
    const ids = overridableInvalidParamIds(
      [
        entry({ id: 'RANGE_LOW', status: 'invalid', overridable: true }),
        entry({ id: 'NON_NUMERIC', status: 'invalid', overridable: false }),
        entry({ id: 'MISSING', status: 'invalid' }),
        entry({ id: 'FINE', status: 'staged', overridable: true })
      ],
      new Set()
    )
    expect(ids).toEqual(['RANGE_LOW'])
  })

  it('excludes rows already overridden, so a bulk count never over-promises', () => {
    const entries = [
      entry({ id: 'A', status: 'invalid', overridable: true }),
      entry({ id: 'B', status: 'invalid', overridable: true })
    ]
    expect(overridableInvalidParamIds(entries, new Set(['A']))).toEqual(['B'])
    expect(overridableInvalidParamIds(entries, new Set(['A', 'B']))).toEqual([])
  })
})

describe('isOverridableInvalidEntry', () => {
  it('is true only for an invalid row flagged overridable', () => {
    expect(isOverridableInvalidEntry(entry({ id: 'X', status: 'invalid', overridable: true }))).toBe(true)
    expect(isOverridableInvalidEntry(entry({ id: 'X', status: 'invalid', overridable: false }))).toBe(false)
    // A staged row is not an override candidate even if the flag lingers.
    expect(isOverridableInvalidEntry(entry({ id: 'X', status: 'staged', overridable: true }))).toBe(false)
  })
})

describe('paramIdsForGroup', () => {
  it('lists every id in the group', () => {
    const group = { category: 'tuning', entries: [entry({ id: 'A' }), entry({ id: 'B' })] } as ParameterDraftGroup
    expect(paramIdsForGroup(group)).toEqual(['A', 'B'])
  })
})

describe('stageableDraftValues', () => {
  it('keys resolved next values for mergeDrafts', () => {
    expect(stageableDraftValues([entry({ id: 'A', nextValue: 4 }), entry({ id: 'B', nextValue: 0 })])).toEqual({
      A: '4',
      B: '0'
    })
  })

  it('skips rows with no resolved value rather than staging an empty string', () => {
    // Staging '' would turn an unreadable row into an invalid draft that then
    // blocks the whole write.
    expect(stageableDraftValues([entry({ id: 'A', nextValue: 2 }), entry({ id: 'NOPE' })])).toEqual({ A: '2' })
  })
})
