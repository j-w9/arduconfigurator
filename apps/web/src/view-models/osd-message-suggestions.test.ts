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

  it('defaults to the source-derived catalog: favorites first, a known key present, deduped', () => {
    const result = buildOsdMessageSuggestions([])
    // (a) favorites lead the list.
    expect(result[0]).toBe('PreArm:')
    expect(COMMON_OSD_MESSAGE_SUGGESTIONS[0]).toBe('PreArm:')
    // (b) a known generated catalog key is present.
    expect(result).toContain('EKF3 IMU')
    // dedup: the result carries no case-insensitive duplicates.
    const lower = result.map((entry) => entry.toLowerCase())
    expect(new Set(lower).size).toBe(lower.length)
  })

  it('(c) live-seen messages still append and dedupe against the catalog', () => {
    const result = buildOsdMessageSuggestions(['My custom message', 'ekf3 imu'])
    expect(result).toContain('My custom message')
    // 'ekf3 imu' collapses into the catalog's 'EKF3 IMU' (no case-dupe).
    expect(result.filter((entry) => entry.toLowerCase() === 'ekf3 imu')).toHaveLength(1)
  })
})
