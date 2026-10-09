// Live plotting for the CAN tab: what a series is, how a sample is taken
// from a frame or a decoded transfer, and the bounded sample store. Pure; the
// bus monitor hook feeds it and the chart reads it.
//
// A series is either a decoded DroneCAN field (a message stream + a path into
// its value) or bytes of a raw frame (any CAN id, so plain CAN plots too).

import type { CanFrame } from '@arduconfig/can-core'
import type { DronecanTransfer } from '@arduconfig/dronecan-dsdl'

import { canTopicKey } from './can-topics'
import { dronecanValueAt } from './dronecan-field-tree'

export type CanPlotSource =
  | {
      kind: 'field'
      /** canTopicKey of the stream: bus, kind, type, source, destination. */
      topicKey: string
      path: (string | number)[]
    }
  | {
      kind: 'bytes'
      bus: number
      id: number
      extended: boolean
      /** First byte of the value in the payload. */
      offset: number
      width: 1 | 2 | 4
      signed: boolean
      littleEndian: boolean
    }

export interface CanPlotSeries {
  key: string
  label: string
  color: string
  source: CanPlotSource
}

export interface CanPlotSamples {
  t: number[]
  v: number[]
}

/** Points kept per series: minutes of a 50 Hz stream. */
export const CAN_PLOT_MAX_POINTS = 20_000

/**
 * Distinct series colours that read on both themes (and stay apart for the
 * common colour-vision deficiencies as far as eight colours allow).
 */
export const CAN_PLOT_COLORS = ['#f2b400', '#4aa3ff', '#e5484d', '#3ecf8e', '#b07cf7', '#ff8a3d', '#22c3c3', '#e86fb0'] as const

export function canPlotSeriesKey(source: CanPlotSource): string {
  return source.kind === 'field'
    ? `field|${source.topicKey}|${source.path.join('.')}`
    : `bytes|${source.bus}|${source.extended ? 'x' : 's'}${source.id}|${source.offset}|${source.width}|${source.signed ? 's' : 'u'}|${source.littleEndian ? 'le' : 'be'}`
}

/** The value a bytes series reads from a frame, or undefined if it is not that frame or too short. */
export function canPlotFrameValue(source: Extract<CanPlotSource, { kind: 'bytes' }>, frame: CanFrame): number | undefined {
  if (frame.bus !== source.bus || frame.id !== source.id || frame.extended !== source.extended) return undefined
  if (source.offset < 0 || source.offset + source.width > frame.data.length) return undefined
  const view = new DataView(frame.data.buffer, frame.data.byteOffset + source.offset, source.width)
  switch (source.width) {
    case 1:
      return source.signed ? view.getInt8(0) : view.getUint8(0)
    case 2:
      return source.signed ? view.getInt16(0, source.littleEndian) : view.getUint16(0, source.littleEndian)
    case 4:
      return source.signed ? view.getInt32(0, source.littleEndian) : view.getUint32(0, source.littleEndian)
  }
}

/** The value a field series reads from a completed transfer, or undefined. */
export function canPlotTransferValue(source: Extract<CanPlotSource, { kind: 'field' }>, transfer: DronecanTransfer): number | undefined {
  if (!transfer.value || canTopicKey(transfer) !== source.topicKey) return undefined
  return dronecanValueAt(transfer.value, source.path)
}

export function pushCanPlotSample(samples: CanPlotSamples, t: number, v: number): void {
  samples.t.push(t)
  samples.v.push(v)
  if (samples.t.length > CAN_PLOT_MAX_POINTS) {
    // Drop in chunks so this is not a shift per sample.
    const excess = samples.t.length - Math.floor(CAN_PLOT_MAX_POINTS * 0.9)
    samples.t.splice(0, excess)
    samples.v.splice(0, excess)
  }
}

/**
 * Take every sample a frame (and the transfer it completed, if any) yields
 * for these series.
 */
export function sampleCanPlot(
  series: readonly CanPlotSeries[],
  samples: Map<string, CanPlotSamples>,
  frame: CanFrame,
  completed: DronecanTransfer | undefined
): void {
  for (const entry of series) {
    const value =
      entry.source.kind === 'bytes'
        ? canPlotFrameValue(entry.source, frame)
        : completed
          ? canPlotTransferValue(entry.source, completed)
          : undefined
    if (value === undefined || !Number.isFinite(value)) continue
    let store = samples.get(entry.key)
    if (!store) {
      store = { t: [], v: [] }
      samples.set(entry.key, store)
    }
    pushCanPlotSample(store, entry.source.kind === 'bytes' ? frame.timestampMs : (completed?.timestampMs ?? frame.timestampMs), value)
  }
}

/** The next unused colour for a new series. */
export function nextCanPlotColor(series: readonly CanPlotSeries[]): string {
  const used = new Set(series.map((entry) => entry.color))
  return CAN_PLOT_COLORS.find((color) => !used.has(color)) ?? CAN_PLOT_COLORS[series.length % CAN_PLOT_COLORS.length]
}

/** Samples inside the last `windowMs` before `nowMs` (both arrays sliced together). */
export function canPlotWindow(samples: CanPlotSamples | undefined, nowMs: number, windowMs: number): CanPlotSamples {
  if (!samples || samples.t.length === 0) return { t: [], v: [] }
  const from = nowMs - windowMs
  let low = 0
  let high = samples.t.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (samples.t[middle] < from) low = middle + 1
    else high = middle
  }
  return { t: samples.t.slice(low), v: samples.v.slice(low) }
}
