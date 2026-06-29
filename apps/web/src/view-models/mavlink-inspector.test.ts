import { describe, expect, it } from 'vitest'

import type { MavlinkMessageStat } from '../hooks/use-mavlink-inspector'
import {
  buildMavlinkFieldRows,
  buildSparklinePoints,
  filterMavlinkStats,
  formatMavlinkFieldValue,
  messageToJson,
  sortMavlinkStats,
  summarizeMavlinkStats
} from './mavlink-inspector'

function stat(overrides: Partial<MavlinkMessageStat> & { type: string }): MavlinkMessageStat {
  return {
    count: 1,
    rateHz: 1,
    lastSeenMs: 0,
    lastMessage: { type: overrides.type },
    rateHistory: [],
    ...overrides
  }
}

describe('summarizeMavlinkStats', () => {
  it('sums rate and count across types', () => {
    const summary = summarizeMavlinkStats([
      stat({ type: 'ATTITUDE', rateHz: 10, count: 100 }),
      stat({ type: 'HEARTBEAT', rateHz: 1, count: 5 })
    ])
    expect(summary).toEqual({ typeCount: 2, totalRateHz: 11, totalCount: 105 })
  })

  it('is zero for an empty stream', () => {
    expect(summarizeMavlinkStats([])).toEqual({ typeCount: 0, totalRateHz: 0, totalCount: 0 })
  })
})

describe('filterMavlinkStats', () => {
  const stats = [stat({ type: 'ATTITUDE' }), stat({ type: 'RC_CHANNELS' }), stat({ type: 'BATTERY_STATUS' })]

  it('returns a copy unfiltered when the needle is blank', () => {
    expect(filterMavlinkStats(stats, '   ').map((s) => s.type)).toEqual(['ATTITUDE', 'RC_CHANNELS', 'BATTERY_STATUS'])
  })

  it('matches case-insensitive substrings', () => {
    expect(filterMavlinkStats(stats, 'chan').map((s) => s.type)).toEqual(['RC_CHANNELS'])
    expect(filterMavlinkStats(stats, 'atti').map((s) => s.type)).toEqual(['ATTITUDE'])
  })
})

describe('sortMavlinkStats', () => {
  const stats = [
    stat({ type: 'HEARTBEAT', rateHz: 1, lastSeenMs: 300 }),
    stat({ type: 'ATTITUDE', rateHz: 50, lastSeenMs: 100 }),
    stat({ type: 'RC_CHANNELS', rateHz: 10, lastSeenMs: 500 })
  ]

  it('sorts by name', () => {
    expect(sortMavlinkStats(stats, 'name').map((s) => s.type)).toEqual(['ATTITUDE', 'HEARTBEAT', 'RC_CHANNELS'])
  })

  it('sorts by rate descending', () => {
    expect(sortMavlinkStats(stats, 'rate').map((s) => s.type)).toEqual(['ATTITUDE', 'RC_CHANNELS', 'HEARTBEAT'])
  })

  it('sorts by most-recent first', () => {
    expect(sortMavlinkStats(stats, 'recent').map((s) => s.type)).toEqual(['RC_CHANNELS', 'HEARTBEAT', 'ATTITUDE'])
  })

  it('does not mutate the input', () => {
    const input = [...stats]
    sortMavlinkStats(input, 'rate')
    expect(input.map((s) => s.type)).toEqual(['HEARTBEAT', 'ATTITUDE', 'RC_CHANNELS'])
  })
})

describe('formatMavlinkFieldValue', () => {
  it('renders an em-dash for null/undefined', () => {
    expect(formatMavlinkFieldValue(null)).toBe('—')
    expect(formatMavlinkFieldValue(undefined)).toBe('—')
  })

  it('stringifies bigints and integers exactly', () => {
    expect(formatMavlinkFieldValue(123n)).toBe('123')
    expect(formatMavlinkFieldValue(42)).toBe('42')
  })

  it('trims trailing zeros from floats', () => {
    expect(formatMavlinkFieldValue(2.5)).toBe('2.5')
    expect(formatMavlinkFieldValue(0.10009999)).toBe('0.1001')
  })

  it('flattens arrays and JSONs objects', () => {
    expect(formatMavlinkFieldValue([1, 2, 3])).toBe('[1, 2, 3]')
    expect(formatMavlinkFieldValue({ a: 1 })).toBe('{"a":1}')
  })
})

describe('buildMavlinkFieldRows', () => {
  it('drops the type discriminator and renders each field', () => {
    const rows = buildMavlinkFieldRows({ type: 'ATTITUDE', roll: 0.5, pitch: 0, count: 7n })
    expect(rows).toEqual([
      { key: 'roll', value: '0.5' },
      { key: 'pitch', value: '0' },
      { key: 'count', value: '7' }
    ])
  })
})

describe('messageToJson', () => {
  it('pretty-prints without the type field and survives bigints', () => {
    const json = messageToJson({ type: 'HEARTBEAT', custom_mode: 5n })
    expect(json).toBe('{\n  "custom_mode": "5"\n}')
  })
})

describe('buildSparklinePoints', () => {
  it('returns empty for fewer than two samples', () => {
    expect(buildSparklinePoints([])).toBe('')
    expect(buildSparklinePoints([3])).toBe('')
  })

  it('normalizes to the peak so the max sample reaches the top (y=0)', () => {
    const points = buildSparklinePoints([0, 10], 10, 20)
    expect(points).toBe('0.0,20.0 10.0,0.0')
  })

  it('spaces samples evenly across the width', () => {
    const points = buildSparklinePoints([5, 5, 5], 40, 10)
    // Flat line: every sample at the peak, so y=0 across an even x-step.
    expect(points).toBe('0.0,0.0 20.0,0.0 40.0,0.0')
  })
})
