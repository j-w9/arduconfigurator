import { describe, expect, it } from 'vitest'
import { canFrameFromRawId } from '@arduconfig/can-core'
import type { DronecanTransfer } from '@arduconfig/dronecan-dsdl'

import {
  CAN_PLOT_COLORS,
  CAN_PLOT_MAX_POINTS,
  canPlotFrameValue,
  canPlotSeriesKey,
  canPlotWindow,
  nextCanPlotColor,
  pushCanPlotSample,
  sampleCanPlot,
  type CanPlotSamples,
  type CanPlotSeries
} from './can-plot'
import { canTopicKey } from './can-topics'

const frame = (rawId: number, bytes: number[], timestampMs = 0) =>
  ({ ...canFrameFromRawId({ timestampMs, bus: 1, rawId, data: Uint8Array.from(bytes) }), seq: 1 })

describe('bytes series', () => {
  it('reads 1/2/4-byte values, signed or not, either byte order, from the right frame only', () => {
    const source = { kind: 'bytes' as const, bus: 1, id: 0x2a0, extended: false, offset: 2, width: 2 as const, signed: false, littleEndian: true }
    const data = [0, 0, 0xe8, 0x03, 0xff, 0xff]
    expect(canPlotFrameValue(source, frame(0x2a0, data))).toBe(1000)
    expect(canPlotFrameValue({ ...source, littleEndian: false }, frame(0x2a0, data))).toBe(0xe803)
    expect(canPlotFrameValue({ ...source, offset: 4, signed: true }, frame(0x2a0, data))).toBe(-1)
    expect(canPlotFrameValue({ ...source, width: 1, offset: 2 }, frame(0x2a0, data))).toBe(0xe8)
    expect(canPlotFrameValue(source, frame(0x2a1, data))).toBeUndefined()
    expect(canPlotFrameValue({ ...source, offset: 5 }, frame(0x2a0, data))).toBeUndefined()
  })
})

describe('field series', () => {
  it('samples a decoded field from its stream only', () => {
    const transfer = {
      bus: 1,
      kind: 'message',
      dataTypeId: 1034,
      sourceNodeId: 50,
      timestampMs: 500,
      value: { rpm: 4800, voltage: 16 }
    } as unknown as DronecanTransfer
    const series: CanPlotSeries[] = [
      { key: 'a', label: 'rpm', color: CAN_PLOT_COLORS[0], source: { kind: 'field', topicKey: canTopicKey(transfer), path: ['rpm'] } },
      { key: 'b', label: 'other', color: CAN_PLOT_COLORS[1], source: { kind: 'field', topicKey: 'elsewhere', path: ['rpm'] } }
    ]
    const samples = new Map<string, CanPlotSamples>()
    sampleCanPlot(series, samples, frame(0x80000001, [0]), transfer)
    expect(samples.get('a')).toEqual({ t: [500], v: [4800] })
    expect(samples.has('b')).toBe(false)
  })
})

describe('the sample store', () => {
  it('stays bounded, windows by time, and hands out unused colours', () => {
    const samples: CanPlotSamples = { t: [], v: [] }
    for (let index = 0; index < CAN_PLOT_MAX_POINTS + 5; index += 1) pushCanPlotSample(samples, index, index)
    expect(samples.t.length).toBeLessThanOrEqual(CAN_PLOT_MAX_POINTS)
    expect(samples.t[samples.t.length - 1]).toBe(CAN_PLOT_MAX_POINTS + 4)
    const windowed = canPlotWindow({ t: [0, 100, 200, 300], v: [1, 2, 3, 4] }, 300, 150)
    expect(windowed).toEqual({ t: [200, 300], v: [3, 4] })
    expect(nextCanPlotColor([{ key: 'k', label: '', color: CAN_PLOT_COLORS[0], source: { kind: 'field', topicKey: '', path: [] } }])).toBe(CAN_PLOT_COLORS[1])
    expect(canPlotSeriesKey({ kind: 'field', topicKey: 't', path: ['value', 'integer_value'] })).toBe('field|t|value.integer_value')
  })
})
