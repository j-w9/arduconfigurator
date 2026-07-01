import { describe, expect, it } from 'vitest'

import type { MavlinkMessageStat } from '../hooks/use-mavlink-inspector'
import {
  appendPlotSample,
  buildMavlinkFieldRows,
  buildPlotGeometry,
  buildSparklinePoints,
  buildStatsSnapshot,
  classifyRowHealth,
  describeMavlinkSource,
  describeMessageRequestOutcome,
  describeSourceHealth,
  disableGuardForMessage,
  filterMavlinkStats,
  filterMavlinkStatsBySource,
  formatBytesPerSec,
  formatLossPercent,
  formatMavlinkFieldType,
  formatMavlinkFieldValue,
  formatPlotValue,
  groupMavlinkStatsBySource,
  inspectorExportFilename,
  intervalUsForRate,
  isPlottableFieldValue,
  isRateDropSharp,
  isRowStale,
  jsonSafeReplacer,
  listMavlinkSources,
  lossPercent,
  mavlinkComponentLabel,
  messageNameForId,
  messageToJson,
  pushRecordedMessage,
  accountSequence,
  createSeqAccounting,
  RECORDING_MAX_MESSAGES,
  REQUESTABLE_MESSAGES,
  SEQ_REORDER_WINDOW,
  serializePlotCsv,
  serializeRecording,
  serializeStatsSnapshot,
  sortMavlinkStats,
  STALE_AFTER_MS,
  summarizeMavlinkStats,
  toPlottableNumber,
  type RecordedMavlinkMessage
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
    const rows = buildMavlinkFieldRows({ type: 'ATTITUDE', roll: 0.5, name: 'x', count: 7n })
    expect(rows).toEqual([
      { key: 'roll', value: '0.5', type: 'float', plottable: true },
      { key: 'name', value: 'x', type: 'string', plottable: false },
      { key: 'count', value: '7', type: 'uint64', plottable: true }
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

describe('field plotting', () => {
  it('coerces plottable values to numbers', () => {
    expect(toPlottableNumber(1.5)).toBe(1.5)
    expect(toPlottableNumber(7n)).toBe(7)
    expect(toPlottableNumber(true)).toBe(1)
    expect(toPlottableNumber(false)).toBe(0)
    expect(toPlottableNumber('x')).toBeUndefined()
    expect(toPlottableNumber(Number.NaN)).toBeUndefined()
  })

  it('rings the buffer by window then by max count', () => {
    let samples = appendPlotSample([], { t: 1000, value: 1 }, 5000, 100)
    samples = appendPlotSample(samples, { t: 2000, value: 2 }, 5000, 100)
    // 7000 is > 5000 after 1000, so the t=1000 sample is dropped.
    samples = appendPlotSample(samples, { t: 7000, value: 3 }, 5000, 100)
    expect(samples.map((s) => s.value)).toEqual([2, 3])

    // Cap to the most recent N regardless of window.
    let capped: ReturnType<typeof appendPlotSample> = []
    for (let i = 0; i < 5; i += 1) {
      capped = appendPlotSample(capped, { t: i, value: i }, 1_000_000, 3)
    }
    expect(capped.map((s) => s.value)).toEqual([2, 3, 4])
  })

  it('does not mutate the input buffer', () => {
    const input = [{ t: 0, value: 1 }]
    appendPlotSample(input, { t: 1, value: 2 }, 1000, 10)
    expect(input).toEqual([{ t: 0, value: 1 }])
  })

  it('builds autoscaled geometry spanning the sample time range', () => {
    const geo = buildPlotGeometry(
      [
        { t: 0, value: 0 },
        { t: 50, value: 5 },
        { t: 100, value: 10 }
      ],
      100,
      20
    )
    // x across [0,100] → [0,100]; y autoscaled [0,10] inverted to [20,0].
    expect(geo.points).toBe('0.0,20.0 50.0,10.0 100.0,0.0')
    expect(geo).toMatchObject({ min: 0, max: 10, current: 10, sampleCount: 3 })
  })

  it('centres a single sample and reports empty for none', () => {
    expect(buildPlotGeometry([{ t: 5, value: 9 }], 100, 20)).toMatchObject({
      points: '0.0,10.0',
      current: 9,
      sampleCount: 1
    })
    expect(buildPlotGeometry([], 100, 20)).toMatchObject({ points: '', sampleCount: 0 })
  })

  it('formats plot read-outs compactly', () => {
    expect(formatPlotValue(5)).toBe('5')
    expect(formatPlotValue(1.25)).toBe('1.25')
    expect(formatPlotValue(0.0001)).toBe('1.00e-4')
  })
})

describe('link health — packet loss', () => {
  const feed = (seqs: number[]) => {
    const s = createSeqAccounting()
    for (const q of seqs) accountSequence(s, q & 0xff)
    return s
  }

  it('counts no loss for consecutive sequences', () => {
    expect(feed([10, 11, 12, 13]).dropped).toBe(0)
    expect(feed([254, 255, 0, 1]).dropped).toBe(0) // wraps at 256
  })

  it('recovers late / out-of-order frames within the window (no false loss)', () => {
    // forward jump skips 1,2 — then they arrive late → recovered, not lost.
    expect(feed([0, 3, 1, 2]).dropped).toBe(0)
    // same across the 8-bit wrap (skip 255, it arrives after 0).
    expect(feed([254, 0, 255]).dropped).toBe(0)
    // an exact duplicate is not loss.
    expect(feed([42, 42]).dropped).toBe(0)
  })

  it('counts a never-arriving skipped seq as loss once it falls outside the window', () => {
    const s = createSeqAccounting()
    accountSequence(s, 0)
    accountSequence(s, 2) // skips 1, which never arrives
    for (let q = 3; q < 3 + SEQ_REORDER_WINDOW + 5; q++) accountSequence(s, q & 0xff)
    expect(s.dropped).toBe(1)
  })

  it('computes loss as a percentage of expected frames', () => {
    expect(lossPercent(0, 0)).toBe(0)
    expect(lossPercent(90, 10)).toBe(10)
    expect(lossPercent(100, 0)).toBe(0)
    expect(lossPercent(3, 1)).toBe(25)
  })

  it('formats loss compactly', () => {
    expect(formatLossPercent(0)).toBe('0%')
    expect(formatLossPercent(0.3)).toBe('<1%')
    expect(formatLossPercent(3.42)).toBe('3.4%')
    expect(formatLossPercent(12.7)).toBe('13%')
  })
})

describe('link health — stale + slowed', () => {
  it('flags a row stale once its stream stops for the window', () => {
    const now = 100_000
    expect(isRowStale(now - 500, now)).toBe(false)
    expect(isRowStale(now - STALE_AFTER_MS, now)).toBe(true)
    expect(isRowStale(now - STALE_AFTER_MS - 1, now)).toBe(true)
  })

  it('flags a sharp rate drop off a lively recent peak', () => {
    // Peak ~50 Hz, now 5 Hz -> well under half: slowed.
    expect(isRateDropSharp([50, 48, 52, 5], 5)).toBe(true)
    // Still near peak: not slowed.
    expect(isRateDropSharp([50, 48, 52, 49], 49)).toBe(false)
    // Low-rate stream (1 Hz heartbeat) never reads as "slow".
    expect(isRateDropSharp([1, 1, 0.3], 0.3)).toBe(false)
    // Too little history to judge.
    expect(isRateDropSharp([10], 1)).toBe(false)
  })

  it('classifies row health stale > slow > ok', () => {
    const now = 100_000
    // Stopped: stale wins even if the history looks fine.
    expect(classifyRowHealth(now - STALE_AFTER_MS, now, [50, 50], 50)).toBe('stale')
    // Live but sharply slowed.
    expect(classifyRowHealth(now - 200, now, [50, 48, 5], 5)).toBe('slow')
    // Healthy.
    expect(classifyRowHealth(now - 200, now, [50, 49, 50], 50)).toBe('ok')
  })

  it('describes a source health line with optional stale count', () => {
    expect(describeSourceHealth(0, 0)).toBe('0% loss')
    expect(describeSourceHealth(12, 0)).toBe('12% loss')
    expect(describeSourceHealth(12, 2)).toBe('12% loss · 2 stale')
    expect(describeSourceHealth(0, 1)).toBe('0% loss · 1 stale')
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

describe('record / export — JSON safety', () => {
  it('stringifies bigints and flattens typed arrays, leaving DataView alone', () => {
    expect(jsonSafeReplacer('k', 7n)).toBe('7')
    expect(jsonSafeReplacer('k', new Uint8Array([1, 2, 3]))).toEqual([1, 2, 3])
    expect(jsonSafeReplacer('k', 5)).toBe(5)
    expect(jsonSafeReplacer('k', 'hi')).toBe('hi')
    const view = new DataView(new ArrayBuffer(4))
    expect(jsonSafeReplacer('k', view)).toBe(view)
  })
})

describe('record / export — stats snapshot', () => {
  it('captures sources, types, last fields and per-source loss', () => {
    const stats = [
      stat({ type: 'ATTITUDE', systemId: 1, componentId: 1, rateHz: 10, count: 100, bytesPerSec: 360, lastMessage: { type: 'ATTITUDE', roll: 0.5 } }),
      stat({ type: 'HEARTBEAT', systemId: 1, componentId: 1, rateHz: 1, count: 5, lastMessage: { type: 'HEARTBEAT', custom_mode: 9n } })
    ]
    const health = [
      { id: '1:1', systemId: 1, componentId: 1, received: 95, dropped: 5, lossPct: 5, lastSeqSeen: 42 }
    ]
    const snapshot = buildStatsSnapshot(stats, health, Date.parse('2026-06-29T12:00:00Z'))
    expect(snapshot.kind).toBe('stats-snapshot')
    expect(snapshot.capturedAt).toBe('2026-06-29T12:00:00.000Z')
    expect(snapshot.summary.sourceCount).toBe(1)
    expect(snapshot.sources).toHaveLength(1)
    const source = snapshot.sources[0]
    expect(source).toMatchObject({ id: '1:1', received: 95, dropped: 5, lossPct: 5 })
    // Types are name-sorted; last fields drop the synthetic discriminator.
    expect(source.types.map((entry) => entry.type)).toEqual(['ATTITUDE', 'HEARTBEAT'])
    expect(source.types[0].lastFields).toEqual({ roll: 0.5 })
  })

  it('serializes to bigint-safe JSON', () => {
    const stats = [stat({ type: 'HEARTBEAT', lastMessage: { type: 'HEARTBEAT', custom_mode: 9n } })]
    const json = serializeStatsSnapshot(stats, [], Date.parse('2026-06-29T12:00:00Z'))
    const parsed = JSON.parse(json)
    expect(parsed.sources[0].types[0].lastFields.custom_mode).toBe('9')
  })

  it('tolerates a source with no health entry (loss defaults to 0)', () => {
    const stats = [stat({ type: 'ATTITUDE', systemId: 2, componentId: 1 })]
    const snapshot = buildStatsSnapshot(stats, [], 0)
    expect(snapshot.sources[0]).toMatchObject({ received: 0, dropped: 0, lossPct: 0 })
  })
})

describe('record / export — stream recording ring buffer', () => {
  const record = (t: number): RecordedMavlinkMessage => ({
    t,
    systemId: 1,
    componentId: 1,
    sequence: t & 0xff,
    type: 'ATTITUDE',
    fields: { roll: t }
  })

  it('caps the buffer and drops the oldest beyond the limit', () => {
    const buffer: RecordedMavlinkMessage[] = []
    for (let i = 0; i < 5; i += 1) {
      pushRecordedMessage(buffer, record(i), 3)
    }
    expect(buffer.map((entry) => entry.t)).toEqual([2, 3, 4])
  })

  it('mutates the buffer in place (hot-path contract)', () => {
    const buffer: RecordedMavlinkMessage[] = []
    const returned = pushRecordedMessage(buffer, record(1), 10)
    expect(returned).toBe(buffer)
    expect(buffer).toHaveLength(1)
  })

  it('keeps a default cap that is bounded and positive', () => {
    expect(RECORDING_MAX_MESSAGES).toBeGreaterThan(0)
  })

  it('serializes a recording with metadata + bigint-safe fields', () => {
    const messages: RecordedMavlinkMessage[] = [
      { t: 1000, systemId: 1, componentId: 1, sequence: 7, type: 'X', fields: { v: 2n } }
    ]
    const json = serializeRecording(messages, Date.parse('2026-06-29T12:00:00Z'), 5000, true)
    const parsed = JSON.parse(json)
    expect(parsed).toMatchObject({
      kind: 'stream-recording',
      capturedAt: '2026-06-29T12:00:00.000Z',
      messageCount: 1,
      capped: true,
      maxMessages: 5000
    })
    expect(parsed.messages[0].fields.v).toBe('2')
  })
})

describe('record / export — plot CSV + filenames', () => {
  it('writes a header and one row per sample', () => {
    expect(serializePlotCsv([])).toBe('timestamp,value')
    expect(
      serializePlotCsv([
        { t: 1000, value: 1.5 },
        { t: 1500, value: 2 }
      ])
    ).toBe('timestamp,value\n1000,1.5\n1500,2')
  })

  it('builds a timestamped, filesystem-safe filename', () => {
    const name = inspectorExportFilename('plot-ATTITUDE.roll', 'csv', Date.parse('2026-06-29T12:00:00Z'))
    expect(name).toBe('mavlink-plot-ATTITUDE.roll-2026-06-29T12-00-00-000Z.csv')
    expect(name).not.toMatch(/[^a-zA-Z0-9_.-]/)
  })
})

describe('disableGuardForMessage', () => {
  it('blocks disabling HEARTBEAT (id 0) — killing it breaks vehicle detection', () => {
    const guard = disableGuardForMessage(0)
    expect(guard?.level).toBe('blocked')
    expect(guard?.message).toMatch(/HEARTBEAT/)
  })

  it('warns before disabling a live-telemetry stream the app depends on', () => {
    // ATTITUDE (30) and GLOBAL_POSITION_INT (33) feed the flight deck.
    expect(disableGuardForMessage(30)?.level).toBe('warn')
    expect(disableGuardForMessage(33)?.level).toBe('warn')
    expect(disableGuardForMessage(310)?.level).toBe('warn') // UAVCAN_NODE_STATUS
  })

  it('leaves an unrelated message (e.g. VIBRATION 241) unguarded', () => {
    expect(disableGuardForMessage(241)).toBeNull()
  })
})
