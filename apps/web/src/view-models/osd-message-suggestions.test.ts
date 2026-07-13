import { describe, expect, it } from 'vitest'

import { buildOsdMessageSuggestions, COMMON_OSD_MESSAGE_SUGGESTIONS } from './osd-message-suggestions'

describe('buildOsdMessageSuggestions', () => {
  it('lists curated fragments first, then live messages', () => {
    const result = buildOsdMessageSuggestions(['Custom live message'], ['PreArm:', 'GPS'])
    expect(result).toEqual(['PreArm:', 'GPS', 'Custom live message'])
  })

  it('dedupes case-insensitively across curated + live and drops blanks', () => {
    const result = buildOsdMessageSuggestions(['gps', 'PreArm: GPS 1: not healthy', '  '], ['PreArm:', 'GPS'])
    expect(result).toEqual(['PreArm:', 'GPS', 'PreArm: GPS 1: not healthy'])
  })

  it('defaults to the curated list when no live messages are given', () => {
    expect(buildOsdMessageSuggestions([])).toEqual([...COMMON_OSD_MESSAGE_SUGGESTIONS])
  })
})
