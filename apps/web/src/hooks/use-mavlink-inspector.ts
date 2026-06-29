// Live MAVLink message stats for the read-only MAVLink inspector. Subscribes to
// the runtime's raw envelope stream and accumulates per-(systemId, componentId,
// type) count / rate / bandwidth / last value in a ref, flushing to React state
// on a fixed interval so high-rate traffic (ATTITUDE, RC_CHANNELS, etc.) never
// thrashes the render loop. Keying by source keeps the same message type from
// the autopilot, a gimbal, a companion computer and CAN nodes on separate rows.
// Each flush also samples the per-row rate into a trailing ring buffer for the
// sparkline. A pause toggle freezes the displayed table (accumulation keeps
// running underneath, so rates stay accurate on resume).

import { useEffect, useRef, useState } from 'react'

import type { ArduPilotConfiguratorRuntime } from '@arduconfig/ardupilot-core'

import {
  appendPlotSample,
  lossPercent,
  sequenceGap,
  toPlottableNumber,
  type MavlinkSourceHealth,
  type PlotSample
} from '../view-models/mavlink-inspector'

export interface MavlinkMessageStat {
  /** Stable identity for React keys: `${systemId}:${componentId}:${type}`. */
  key: string
  systemId: number
  componentId: number
  type: string
  count: number
  /** Messages/sec over a trailing window. */
  rateHz: number
  /** On-the-wire bytes/sec over the same trailing window. */
  bytesPerSec: number
  /** Cumulative on-the-wire bytes seen for this row this session. */
  totalBytes: number
  lastSeenMs: number
  /** The most recent decoded message record (field name -> value). */
  lastMessage: Record<string, unknown>
  /** Trailing per-flush rate samples (oldest → newest) for the sparkline. */
  rateHistory: number[]
}

const RATE_WINDOW_MS = 3000
const FLUSH_INTERVAL_MS = 500
const HISTORY_SAMPLES = 40

/** Trailing window of field samples kept per live plot. */
const PLOT_WINDOW_MS = 20_000
const PLOT_MAX_SAMPLES = 600
/** Cap on simultaneous live plots. */
export const MAX_MAVLINK_PLOTS = 6

/** A field selected for live plotting. `key` is `${stat.key}:${field}`. */
export interface MavlinkPlotSpec {
  key: string
  systemId: number
  componentId: number
  type: string
  field: string
}

/** A live plot with its trailing sample buffer (oldest → newest). */
export interface MavlinkPlot extends MavlinkPlotSpec {
  samples: PlotSample[]
}

interface Accumulator {
  systemId: number
  componentId: number
  type: string
  count: number
  totalBytes: number
  arrivalsMs: number[]
  arrivalBytes: number[]
  lastSeenMs: number
  lastMessage: Record<string, unknown>
  rateHistory: number[]
}

/** Per-source (sys:comp) sequence + loss accounting, across all message types. */
interface SourceAccumulator {
  systemId: number
  componentId: number
  received: number
  dropped: number
  lastSeq: number | undefined
}

export interface MavlinkInspectorState {
  stats: MavlinkMessageStat[]
  /** Per-source link health (packet loss), keyed by `${systemId}:${componentId}`. */
  sourceHealth: MavlinkSourceHealth[]
  clear: () => void
  paused: boolean
  setPaused: (paused: boolean) => void
  plots: MavlinkPlot[]
  addPlot: (spec: MavlinkPlotSpec) => void
  removePlot: (key: string) => void
}

function sourceKey(systemId: number, componentId: number, type: string): string {
  return `${systemId}:${componentId}:${type}`
}

export function useMavlinkInspector(
  runtime: ArduPilotConfiguratorRuntime | undefined,
  active: boolean
): MavlinkInspectorState {
  const accumulators = useRef(new Map<string, Accumulator>())
  const sources = useRef(new Map<string, SourceAccumulator>())
  const [stats, setStats] = useState<MavlinkMessageStat[]>([])
  const [sourceHealth, setSourceHealth] = useState<MavlinkSourceHealth[]>([])
  const [paused, setPaused] = useState(false)
  const pausedRef = useRef(paused)
  pausedRef.current = paused
  // Plot specs + their trailing sample buffers live in refs (sampled on the
  // hot message path); `plots` mirrors them into React state on each flush.
  const plotSpecs = useRef(new Map<string, MavlinkPlotSpec>())
  const plotBuffers = useRef(new Map<string, PlotSample[]>())
  const [plots, setPlots] = useState<MavlinkPlot[]>([])

  const snapshotPlots = (): void => {
    const now = Date.now()
    const next: MavlinkPlot[] = []
    for (const [key, spec] of plotSpecs.current) {
      const buffer = (plotBuffers.current.get(key) ?? []).filter((sample) => sample.t >= now - PLOT_WINDOW_MS)
      plotBuffers.current.set(key, buffer)
      next.push({ ...spec, samples: [...buffer] })
    }
    setPlots(next)
  }

  useEffect(() => {
    if (!runtime || !active) {
      return
    }
    const unsubscribe = runtime.onMessage((envelope) => {
      const message = envelope.message as unknown as Record<string, unknown> & { type?: string }
      const type = typeof message.type === 'string' ? message.type : 'UNKNOWN'
      const systemId = envelope.header.systemId
      const componentId = envelope.header.componentId
      const key = sourceKey(systemId, componentId, type)
      // byteLength is set by the v2 codec; a stub/non-v2 codec leaves it
      // undefined, in which case bandwidth stays 0 rather than guessing.
      const bytes = typeof envelope.byteLength === 'number' ? envelope.byteLength : 0
      const now = Date.now()
      const entry =
        accumulators.current.get(key) ??
        {
          systemId,
          componentId,
          type,
          count: 0,
          totalBytes: 0,
          arrivalsMs: [],
          arrivalBytes: [],
          lastSeenMs: 0,
          lastMessage: {},
          rateHistory: []
        }
      entry.count += 1
      entry.totalBytes += bytes
      entry.lastSeenMs = now
      entry.lastMessage = message
      entry.arrivalsMs.push(now)
      entry.arrivalBytes.push(bytes)
      const cutoff = now - RATE_WINDOW_MS
      while (entry.arrivalsMs.length > 0 && entry.arrivalsMs[0] < cutoff) {
        entry.arrivalsMs.shift()
        entry.arrivalBytes.shift()
      }
      accumulators.current.set(key, entry)

      // Per-source packet-loss accounting off the MAVLink v2 sequence byte,
      // tracked across all of this source's message types (the sequence
      // increments once per frame regardless of type).
      const sourceId = `${systemId}:${componentId}`
      const sequence = envelope.header.sequence
      const source =
        sources.current.get(sourceId) ??
        { systemId, componentId, received: 0, dropped: 0, lastSeq: undefined }
      if (typeof sequence === 'number' && source.lastSeq !== undefined) {
        source.dropped += sequenceGap(source.lastSeq, sequence)
      }
      if (typeof sequence === 'number') {
        source.lastSeq = sequence
      }
      source.received += 1
      sources.current.set(sourceId, source)

      // Sample any plotted field of this exact source+type into its buffer.
      if (plotSpecs.current.size > 0) {
        const sourceTypeKey = `${key}:`
        for (const [plotKey, spec] of plotSpecs.current) {
          if (!plotKey.startsWith(sourceTypeKey)) {
            continue
          }
          const numeric = toPlottableNumber(message[spec.field])
          if (numeric === undefined) {
            continue
          }
          const buffer = plotBuffers.current.get(plotKey) ?? []
          plotBuffers.current.set(
            plotKey,
            appendPlotSample(buffer, { t: now, value: numeric }, PLOT_WINDOW_MS, PLOT_MAX_SAMPLES)
          )
        }
      }
    })

    const flush = (): void => {
      // Frozen: keep accumulating in the ref but don't disturb the table.
      if (pausedRef.current) {
        return
      }
      const now = Date.now()
      const cutoff = now - RATE_WINDOW_MS
      const windowSeconds = RATE_WINDOW_MS / 1000
      const next: MavlinkMessageStat[] = []
      for (const [key, entry] of accumulators.current) {
        let recent = 0
        let recentBytes = 0
        for (let index = 0; index < entry.arrivalsMs.length; index += 1) {
          if (entry.arrivalsMs[index] >= cutoff) {
            recent += 1
            recentBytes += entry.arrivalBytes[index] ?? 0
          }
        }
        const rateHz = recent / windowSeconds
        const bytesPerSec = recentBytes / windowSeconds
        entry.rateHistory.push(rateHz)
        if (entry.rateHistory.length > HISTORY_SAMPLES) {
          entry.rateHistory.shift()
        }
        next.push({
          key,
          systemId: entry.systemId,
          componentId: entry.componentId,
          type: entry.type,
          count: entry.count,
          rateHz,
          bytesPerSec,
          totalBytes: entry.totalBytes,
          lastSeenMs: entry.lastSeenMs,
          lastMessage: entry.lastMessage,
          rateHistory: [...entry.rateHistory]
        })
      }
      setStats(next)

      const health: MavlinkSourceHealth[] = []
      for (const [id, source] of sources.current) {
        health.push({
          id,
          systemId: source.systemId,
          componentId: source.componentId,
          received: source.received,
          dropped: source.dropped,
          lossPct: lossPercent(source.received, source.dropped),
          lastSeqSeen: source.lastSeq
        })
      }
      setSourceHealth(health)
      snapshotPlots()
    }

    flush()
    const interval = setInterval(flush, FLUSH_INTERVAL_MS)
    return () => {
      unsubscribe()
      clearInterval(interval)
    }
  }, [runtime, active])

  const clear = (): void => {
    accumulators.current.clear()
    sources.current.clear()
    setStats([])
    setSourceHealth([])
  }

  const addPlot = (spec: MavlinkPlotSpec): void => {
    if (plotSpecs.current.has(spec.key) || plotSpecs.current.size >= MAX_MAVLINK_PLOTS) {
      return
    }
    plotSpecs.current.set(spec.key, spec)
    plotBuffers.current.set(spec.key, [])
    snapshotPlots()
  }

  const removePlot = (key: string): void => {
    plotSpecs.current.delete(key)
    plotBuffers.current.delete(key)
    snapshotPlots()
  }

  return { stats, sourceHealth, clear, paused, setPaused, plots, addPlot, removePlot }
}
