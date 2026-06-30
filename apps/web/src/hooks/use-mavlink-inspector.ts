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

import { downloadTextFile } from '../download-file'
import {
  accountSequence,
  appendPlotSample,
  createSeqAccounting,
  inspectorExportFilename,
  lossPercent,
  pushRecordedMessage,
  RECORDING_MAX_MESSAGES,
  serializePlotCsv,
  serializeRecording,
  serializeStatsSnapshot,
  toPlottableNumber,
  type MavlinkSourceHealth,
  type SourceSeqAccounting,
  type RecordedMavlinkMessage,
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
interface SourceAccumulator extends SourceSeqAccounting {
  systemId: number
  componentId: number
}

export interface MavlinkInspectorState {
  stats: MavlinkMessageStat[]
  /** Per-type stats for the messages this app SENDS (outbound), shown separately. */
  sentStats: MavlinkMessageStat[]
  /** Per-source link health (packet loss), keyed by `${systemId}:${componentId}`. */
  sourceHealth: MavlinkSourceHealth[]
  clear: () => void
  paused: boolean
  setPaused: (paused: boolean) => void
  plots: MavlinkPlot[]
  addPlot: (spec: MavlinkPlotSpec) => void
  removePlot: (key: string) => void
  /** Download the current inspector state (sources/types/loss) as JSON. */
  exportSnapshot: () => void
  /** Stream-recording controls (bounded ring buffer → JSON download). */
  recording: boolean
  recordedCount: number
  recordingCapped: boolean
  recordingMax: number
  startRecording: () => void
  stopRecording: () => void
  downloadRecording: () => void
  /** Download one plot's sample buffer as CSV (timestamp,value). */
  exportPlotCsv: (key: string) => void
}

function sourceKey(systemId: number, componentId: number, type: string): string {
  return `${systemId}:${componentId}:${type}`
}

export function useMavlinkInspector(
  runtime: ArduPilotConfiguratorRuntime | undefined,
  active: boolean
): MavlinkInspectorState {
  const accumulators = useRef(new Map<string, Accumulator>())
  const sentAccumulators = useRef(new Map<string, Accumulator>())
  const sources = useRef(new Map<string, SourceAccumulator>())
  const [stats, setStats] = useState<MavlinkMessageStat[]>([])
  const [sentStats, setSentStats] = useState<MavlinkMessageStat[]>([])
  const sentStatsRef = useRef<MavlinkMessageStat[]>([])
  const [sourceHealth, setSourceHealth] = useState<MavlinkSourceHealth[]>([])
  const [paused, setPaused] = useState(false)
  const pausedRef = useRef(paused)
  pausedRef.current = paused
  // Latest stats/health mirrored into refs so the snapshot/CSV exports read
  // current values without re-binding the download callbacks every flush.
  const statsRef = useRef<MavlinkMessageStat[]>([])
  const sourceHealthRef = useRef<MavlinkSourceHealth[]>([])
  // Stream recording: a bounded ring buffer on a ref (hot message path) plus
  // light React state for the count / capped badge, refreshed on flush.
  const recordBuffer = useRef<RecordedMavlinkMessage[]>([])
  const recordingRef = useRef(false)
  const recordingCappedRef = useRef(false)
  const [recording, setRecording] = useState(false)
  const [recordedCount, setRecordedCount] = useState(0)
  const [recordingCapped, setRecordingCapped] = useState(false)
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
        sources.current.get(sourceId) ?? { systemId, componentId, ...createSeqAccounting() }
      if (typeof sequence === 'number') {
        accountSequence(source, sequence)
      } else {
        source.received += 1
      }
      sources.current.set(sourceId, source)

      // Stream recording rides the same hot path but is otherwise independent
      // of the table/plots: capture into a bounded ring buffer so it never
      // grows without limit and never disturbs the live view.
      if (recordingRef.current) {
        const { type: _type, ...fields } = message
        pushRecordedMessage(
          recordBuffer.current,
          {
            t: now,
            systemId,
            componentId,
            sequence: typeof sequence === 'number' ? sequence : 0,
            type,
            fields
          },
          RECORDING_MAX_MESSAGES
        )
        if (recordBuffer.current.length >= RECORDING_MAX_MESSAGES) {
          recordingCappedRef.current = true
        }
      }

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

    // Outbound stream: what this app sends to the vehicle. Tallied per message
    // type (all from us, so no per-source grouping or loss accounting) into a
    // separate accumulator, surfaced as its own "Sent" section.
    const unsubscribeSent = runtime.onSentMessage((envelope) => {
      const message = envelope.message as unknown as Record<string, unknown> & { type?: string }
      const type = typeof message.type === 'string' ? message.type : 'UNKNOWN'
      const bytes = typeof envelope.byteLength === 'number' ? envelope.byteLength : 0
      const now = Date.now()
      const entry =
        sentAccumulators.current.get(type) ??
        {
          systemId: envelope.header.systemId,
          componentId: envelope.header.componentId,
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
      sentAccumulators.current.set(type, entry)
    })

    const flush = (): void => {
      // Recording is independent of the (pausable) live table — refresh its
      // count/capped badge first so a paused operator still sees it growing.
      if (recordingRef.current) {
        setRecordedCount(recordBuffer.current.length)
        setRecordingCapped(recordingCappedRef.current)
      }
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
      statsRef.current = next

      const sentNext: MavlinkMessageStat[] = []
      for (const [key, entry] of sentAccumulators.current) {
        let recent = 0
        let recentBytes = 0
        for (let index = 0; index < entry.arrivalsMs.length; index += 1) {
          if (entry.arrivalsMs[index] >= cutoff) {
            recent += 1
            recentBytes += entry.arrivalBytes[index] ?? 0
          }
        }
        const rateHz = recent / windowSeconds
        entry.rateHistory.push(rateHz)
        if (entry.rateHistory.length > HISTORY_SAMPLES) {
          entry.rateHistory.shift()
        }
        sentNext.push({
          key,
          systemId: entry.systemId,
          componentId: entry.componentId,
          type: entry.type,
          count: entry.count,
          rateHz,
          bytesPerSec: recentBytes / windowSeconds,
          totalBytes: entry.totalBytes,
          lastSeenMs: entry.lastSeenMs,
          lastMessage: entry.lastMessage,
          rateHistory: [...entry.rateHistory]
        })
      }
      setSentStats(sentNext)
      sentStatsRef.current = sentNext

      const health: MavlinkSourceHealth[] = []
      for (const [id, source] of sources.current) {
        health.push({
          id,
          systemId: source.systemId,
          componentId: source.componentId,
          received: source.received,
          dropped: source.dropped,
          lossPct: lossPercent(source.received, source.dropped),
          lastSeqSeen: source.expected === undefined ? undefined : (source.expected - 1) & 0xff
        })
      }
      setSourceHealth(health)
      sourceHealthRef.current = health
      snapshotPlots()
    }

    flush()
    const interval = setInterval(flush, FLUSH_INTERVAL_MS)
    return () => {
      unsubscribe()
      unsubscribeSent()
      clearInterval(interval)
    }
  }, [runtime, active])

  const clear = (): void => {
    accumulators.current.clear()
    sentAccumulators.current.clear()
    sources.current.clear()
    setStats([])
    setSentStats([])
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

  const exportSnapshot = (): void => {
    const now = Date.now()
    downloadTextFile(
      inspectorExportFilename('snapshot', 'json', now),
      serializeStatsSnapshot(statsRef.current, sourceHealthRef.current, now)
    )
  }

  const startRecording = (): void => {
    recordBuffer.current = []
    recordingCappedRef.current = false
    recordingRef.current = true
    setRecording(true)
    setRecordedCount(0)
    setRecordingCapped(false)
  }

  const stopRecording = (): void => {
    recordingRef.current = false
    setRecording(false)
    // Leave the buffer intact so the operator can still download the capture.
    setRecordedCount(recordBuffer.current.length)
  }

  const downloadRecording = (): void => {
    const now = Date.now()
    downloadTextFile(
      inspectorExportFilename('recording', 'json', now),
      serializeRecording(recordBuffer.current, now, RECORDING_MAX_MESSAGES, recordingCappedRef.current)
    )
  }

  const exportPlotCsv = (key: string): void => {
    const buffer = plotBuffers.current.get(key)
    if (!buffer) {
      return
    }
    const spec = plotSpecs.current.get(key)
    const label = spec ? `plot-${spec.type}-${spec.field}` : 'plot'
    downloadTextFile(inspectorExportFilename(label, 'csv', Date.now()), serializePlotCsv(buffer), 'text/csv')
  }

  return {
    stats,
    sentStats,
    sourceHealth,
    clear,
    paused,
    setPaused,
    plots,
    addPlot,
    removePlot,
    exportSnapshot,
    recording,
    recordedCount,
    recordingCapped,
    recordingMax: RECORDING_MAX_MESSAGES,
    startRecording,
    stopRecording,
    downloadRecording,
    exportPlotCsv
  }
}
