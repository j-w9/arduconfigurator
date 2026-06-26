import { describe, expect, it } from 'vitest'

import { parseStoredCanNodeNames } from './use-can-node-names'

describe('parseStoredCanNodeNames', () => {
  it('returns an empty map for null / empty / malformed input', () => {
    expect(parseStoredCanNodeNames(null)).toEqual({})
    expect(parseStoredCanNodeNames('')).toEqual({})
    expect(parseStoredCanNodeNames('not json')).toEqual({})
    expect(parseStoredCanNodeNames('[1,2,3]')).toEqual({})
    expect(parseStoredCanNodeNames('"a string"')).toEqual({})
  })

  it('keeps string→non-empty-string entries and lower-cases UID keys', () => {
    const raw = JSON.stringify({ '1A2B3C': 'Front ESC', 'deadbeef': '  Rear ESC  ' })
    expect(parseStoredCanNodeNames(raw)).toEqual({ '1a2b3c': 'Front ESC', deadbeef: 'Rear ESC' })
  })

  it('drops empty / whitespace-only / non-string values', () => {
    const raw = JSON.stringify({ aa: '', bb: '   ', cc: 42, dd: 'GPS' })
    expect(parseStoredCanNodeNames(raw)).toEqual({ dd: 'GPS' })
  })
})
