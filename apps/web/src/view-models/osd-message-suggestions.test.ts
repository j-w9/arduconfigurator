import { describe, expect, it } from 'vitest'

import { buildOsdMessageSuggestions, toFromKey } from './osd-message-suggestions'

describe('toFromKey', () => {
  it('keeps short messages as-is', () => {
    expect(toFromKey('GPS Glitch')).toBe('GPS Glitch')
  })

  it('cuts at the first runtime format arg, stripping trailing punctuation', () => {
    expect(toFromKey('EKF primary changed:%d')).toBe('EKF primary')
  })

  it('truncates >15-char messages on a word boundary', () => {
    const key = toFromKey('ADSB Sagetech MXS: Init')
    expect(key.length).toBeLessThanOrEqual(15)
    expect(key).toBe('ADSB Sagetech')
  })
})

describe('buildOsdMessageSuggestions', () => {
  it('lists the favorites first as label===from entries', () => {
    expect(buildOsdMessageSuggestions([])[0]).toEqual({ label: 'PreArm:', from: 'PreArm:' })
  })

  it('includes the source-derived catalog', () => {
    expect(buildOsdMessageSuggestions([]).some((entry) => entry.from === 'ADSB Sagetech')).toBe(true)
  })

  it('appends live-seen messages and dedupes by from (case-insensitively)', () => {
    const result = buildOsdMessageSuggestions(['My custom message', 'ADSB Sagetech extra telem'])
    // A brand-new live message is appended with its derived key.
    expect(result.some((entry) => entry.label === 'My custom message' && entry.from === 'My custom')).toBe(true)
    // 'ADSB Sagetech extra telem' → from 'ADSB Sagetech', already in the catalog → deduped out.
    const froms = result.map((entry) => entry.from.toLowerCase())
    expect(new Set(froms).size).toBe(froms.length)
  })
})
