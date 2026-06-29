import { describe, expect, it } from 'vitest'

import type { MavlinkMessageStat } from '../hooks/use-mavlink-inspector'
import {
  buildMavlinkFieldRows,
  buildSparklinePoints,
  describeMavlinkSource,
  describeMessageRequestOutcome,
  filterMavlinkStats,
  filterMavlinkStatsBySource,
  formatBytesPerSec,
  formatMavlinkFieldType,
  formatMavlinkFieldValue,
  groupMavlinkStatsBySource,
  intervalUsForRate,
  isPlottableFieldValue,
  listMavlinkSources,
  mavlinkComponentLabel,
  messageNameForId,
  messageToJson,
  REQUESTABLE_MESSAGES,
  sortMavlinkStats,
  summarizeMavlinkStats
} from './mavlink-inspector'

function stat(overrides: Partial<MavlinkMessageStat> & { type: string }): MavlinkMessageStat {
  const systemId = overrides.systemId ?? 1
  const componentId = overrides.componentId ?? 1
  return {
    key: overrides.key ?? `${systemId}:${componentId}:${overrides.type}`,
    systemId,
    componentId,
    count: 1,
    rateHz: 1,
    bytesPerSec: 0,
    totalBytes: 0,
    lastSeenMs: 0,
    lastMessage: { type: overrides.type },
    rateHistory: [],
    ...overrides
  }
}

describe('summarizeMavlinkStats', () => {
  it('sums rate, bandwidth, count and distinct sources', () => {
    const summary = summarizeMavlinkStats([
      stat({ type: 'ATTITUDE', rateHz: 10, count: 100, bytesPerSec: 360, systemId: 1, componentId: 1 }),
      stat({ type: 'HEARTBEAT', rateHz: 1, count: 5, bytesPerSec: 21, systemId: 1, componentId: 1 }),
      stat({ type: 'HEARTBEAT', rateHz: 1, count: 3, bytesPerSec: 21, systemId: 1, componentId: 154 })
    ])
    expect(summary).toEqual({
      typeCount: 3,
      sourceCount: 2,
      totalRateHz: 12,
      totalBytesPerSec: 402,
      totalCount: 108
    })
  })

  it('is zero for an empty stream', () => {
    expect(summarizeMavlinkStats([])).toEqual({
      typeCount: 0,
      sourceCount: 0,
      totalRateHz: 0,
      totalBytesPerSec: 0,
      totalCount: 0
    })
  })
})

describe('source identity', () => {
  it('labels common component ids by role', () => {
    expect(mavlinkComponentLabel(1)).toBe('autopilot')
    expect(mavlinkComponentLabel(154)).toBe('gimbal')
    expect(mavlinkComponentLabel(190)).toBe('GCS')
    expect(mavlinkComponentLabel(191)).toBe('companion')
    expect(mavlinkComponentLabel(220)).toBe('GPS')
    expect(mavlinkComponentLabel(42)).toBe('user')
    expect(mavlinkComponentLabel(7)).toBe('comp 7')
  })

  it('describes a source as id + label', () => {
    expect(describeMavlinkSource(1, 1)).toEqual({
      id: '1:1',
      systemId: 1,
      componentId: 1,
      label: '1:1 · autopilot'
    })
  })

  it('lists distinct sources sorted by sys then comp', () => {
    const sources = listMavlinkSources([
      stat({ type: 'A', systemId: 1, componentId: 154 }),
      stat({ type: 'B', systemId: 1, componentId: 1 }),
      stat({ type: 'C', systemId: 1, componentId: 1 })
    ])
    expect(sources.map((source) => source.id)).toEqual(['1:1', '1:154'])
  })

  it('filters to a single source', () => {
    const stats = [
      stat({ type: 'A', systemId: 1, componentId: 1 }),
      stat({ type: 'B', systemId: 1, componentId: 154 })
    ]
    expect(filterMavlinkStatsBySource(stats, '1:154').map((s) => s.type)).toEqual(['B'])
    expect(filterMavlinkStatsBySource(stats, '').map((s) => s.type)).toEqual(['A', 'B'])
  })
})

describe('groupMavlinkStatsBySource', () => {
  it('buckets rows by source and aggregates rate + bandwidth', () => {
    const groups = groupMavlinkStatsBySource([
      stat({ type: 'ATTITUDE', systemId: 1, componentId: 1, rateHz: 10, bytesPerSec: 360 }),
      stat({ type: 'HEARTBEAT', systemId: 1, componentId: 1, rateHz: 1, bytesPerSec: 21 }),
      stat({ type: 'HEARTBEAT', systemId: 1, componentId: 154, rateHz: 1, bytesPerSec: 21 })
    ])
    expect(groups.map((group) => group.id)).toEqual(['1:1', '1:154'])
    expect(groups[0].rateHz).toBe(11)
    expect(groups[0].bytesPerSec).toBe(381)
    expect(groups[0].stats.map((s) => s.type)).toEqual(['ATTITUDE', 'HEARTBEAT'])
    expect(groups[1].stats).toHaveLength(1)
  })
})

describe('formatBytesPerSec', () => {
  it('scales bytes to B/kB/MB per second', () => {
    expect(formatBytesPerSec(0)).toBe('0 B/s')
    expect(formatBytesPerSec(812)).toBe('812 B/s')
    expect(formatBytesPerSec(2048)).toBe('2.0 kB/s')
    expect(formatBytesPerSec(3 * 1024 * 1024)).toBe('3.0 MB/s')
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

  it('sorts by bandwidth descending', () => {
    const byBytes = [
      stat({ type: 'HEARTBEAT', bytesPerSec: 21 }),
      stat({ type: 'ATTITUDE', bytesPerSec: 360 }),
      stat({ type: 'RC_CHANNELS', bytesPerSec: 120 })
    ]
    expect(sortMavlinkStats(byBytes, 'bandwidth').map((s) => s.type)).toEqual(['ATTITUDE', 'RC_CHANNELS', 'HEARTBEAT'])
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

describe('formatMavlinkFieldType', () => {
  it('classifies value kinds for the type column', () => {
    expect(formatMavlinkFieldType(5)).toBe('int')
    expect(formatMavlinkFieldType(1.5)).toBe('float')
    expect(formatMavlinkFieldType(9n)).toBe('uint64')
    expect(formatMavlinkFieldType(true)).toBe('bool')
    expect(formatMavlinkFieldType('hi')).toBe('string')
    expect(formatMavlinkFieldType([1, 2])).toBe('array')
    expect(formatMavlinkFieldType({ a: 1 })).toBe('object')
    expect(formatMavlinkFieldType(null)).toBe('empty')
  })
})

describe('isPlottableFieldValue', () => {
  it('accepts finite numbers, bigints and booleans only', () => {
    expect(isPlottableFieldValue(1.5)).toBe(true)
    expect(isPlottableFieldValue(7n)).toBe(true)
    expect(isPlottableFieldValue(true)).toBe(true)
    expect(isPlottableFieldValue(Number.NaN)).toBe(false)
    expect(isPlottableFieldValue('3')).toBe(false)
    expect(isPlottableFieldValue([1])).toBe(false)
  })
})

describe('buildMavlinkFieldRows', () => {
  it('drops the type discriminator and renders each field with its kind', () => {
    const rows = buildMavlinkFieldRows({ type: 'ATTITUDE', roll: 0.5, pitch: 0, count: 7n })
    expect(rows).toEqual([
      { key: 'roll', value: '0.5', type: 'float' },
      { key: 'pitch', value: '0', type: 'int' },
      { key: 'count', value: '7', type: 'uint64' }
    ])
  })
})

describe('messageToJson', () => {
  it('pretty-prints without the type field and survives bigints', () => {
    const json = messageToJson({ type: 'HEARTBEAT', custom_mode: 5n })
    expect(json).toBe('{\n  "custom_mode": "5"\n}')
  })
})

describe('message requests', () => {
  it('converts a rate to a SET_MESSAGE_INTERVAL micros value', () => {
    expect(intervalUsForRate(10)).toBe(100000)
    expect(intervalUsForRate(1)).toBe(1000000)
    expect(intervalUsForRate(4)).toBe(250000)
    // 0 requests the firmware default; non-positive disables (-1).
    expect(intervalUsForRate(0)).toBe(0)
    expect(intervalUsForRate(-1)).toBe(-1)
  })

  it('exposes a curated, unique list of requestable messages', () => {
    const ids = REQUESTABLE_MESSAGES.map((entry) => entry.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(REQUESTABLE_MESSAGES.find((entry) => entry.name === 'ATTITUDE')?.id).toBe(30)
  })

  it('resolves message names with a fallback for unknown ids', () => {
    expect(messageNameForId(30)).toBe('ATTITUDE')
    expect(messageNameForId(9999)).toBe('msg 9999')
  })

  it('describes accepted and rejected outcomes per kind', () => {
    expect(describeMessageRequestOutcome('once', 'ATTITUDE', { ok: true, resultLabel: 'ACCEPTED' })).toBe(
      'Requested ATTITUDE — accepted (ACCEPTED).'
    )
    expect(describeMessageRequestOutcome('stream', 'RC_CHANNELS', { ok: true, resultLabel: 'ACCEPTED' })).toBe(
      'Streaming RC_CHANNELS — accepted (ACCEPTED).'
    )
    expect(describeMessageRequestOutcome('disable', 'VIBRATION', { ok: true, resultLabel: 'ACCEPTED' })).toBe(
      'Disabled VIBRATION — accepted (ACCEPTED).'
    )
    expect(describeMessageRequestOutcome('stream', 'ATTITUDE', { ok: false, resultLabel: 'DENIED' })).toBe(
      'ATTITUDE request rejected (DENIED).'
    )
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
