// The CAN bus monitor's state: the capture ring, the per-id trace, pause,
// the filter, recording, saving, and an opened log with its player.
//
// Frames arrive outside React (runtime.onCanFrame), thousands a second on a
// busy bus. They go straight into mutable structures, and the view is told to
// repaint at most ~8 times a second -- a re-render per frame would freeze the
// tab long before the bus got busy.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  CanCaptureBuffer,
  CanIdTrace,
  canFrameIndexAt,
  canFramesBetween,
  canLogTimeline,
  estimateCanBusLoad,
  formatCanCsv,
  formatCandump,
  matchesCanFilter,
  parseCanLog,
  type CanFrame,
  type CanFrameFilter,
  type CanIdTraceEntry,
  type CanLogTimeline
} from '@arduconfig/can-core'
import { DronecanTransferDecoder, dronecanCatalogue, type DronecanTransfer } from '@arduconfig/dronecan-dsdl'

import { downloadTextFile } from '../download-file'
import {
  DEFAULT_CAN_MONITOR_FILTER_FORM,
  buildCanMonitorFilter,
  type CanMonitorFilterForm,
  type CanMonitorFilterState
} from '../view-models/can-bus-monitor'
import { CanTopicTable, canTopicIdFilter, type CanTopicEntry } from '../view-models/can-topics'
import {
  canPlotSeriesKey,
  nextCanPlotColor,
  sampleCanPlot,
  type CanPlotSamples,
  type CanPlotSeries,
  type CanPlotSource
} from '../view-models/can-plot'

/** The slice of the runtime the monitor needs. */
export interface CanFrameSource {
  onCanFrame(listener: (frame: CanFrame) => void): () => void
}

/** Frames held for the live view. ~50k is minutes of a busy bus, a few MB. */
export const CAN_MONITOR_CAPACITY = 50_000
/** A recording stops itself here rather than eat the tab's memory. */
export const CAN_RECORDING_MAX_FRAMES = 1_000_000
const REPAINT_INTERVAL_MS = 125
const RATE_WINDOW_MS = 1000

export type CanMonitorViewMode = 'stream' | 'by-id'
export type CanRecordingFormat = 'candump' | 'csv'

export interface CanMonitorStats {
  framesPerSec: number
  /** Estimated bus load, %, or undefined when the bitrate is unknown. */
  busLoadPct?: number
  idCount: number
  held: number
  totalCaptured: number
  /** Frames that fell out of the back of the ring. */
  droppedOldest: number
}

export interface CanRecordingState {
  active: boolean
  frameCount: number
  startedAtMs?: number
  /** Stopped itself at CAN_RECORDING_MAX_FRAMES. */
  capped: boolean
  /** A finished recording waiting to be saved or discarded. */
  pendingSave: boolean
}

export interface CanOpenedLog {
  name: string
  format: 'candump' | 'csv'
  frameCount: number
  skippedLines: number
  durationMs: number
}

/**
 * How an opened log is shown: all of it at once (for analysis), or played
 * back against a clock so the stream and the per-id trace build up the way
 * they did on the bus.
 */
export interface CanLogPlayback {
  mode: 'all' | 'playing' | 'paused'
  /** Log time, ms since the first frame. */
  positionMs: number
  speed: number
}

export interface CanSaveOptions {
  format: CanRecordingFormat
  /** Only frames that pass the current filter. */
  filteredOnly: boolean
}

export interface UseCanBusMonitorResult {
  /** Frames the table shows, oldest first, already filtered. */
  frames: readonly CanFrame[]
  /** One row per id (the trace view), filtered by the same filter. */
  idRows: readonly CanIdTraceEntry[]
  /** Time origin for the relative timestamp column. */
  originMs: number
  stats: CanMonitorStats
  viewMode: CanMonitorViewMode
  setViewMode: (mode: CanMonitorViewMode) => void
  filterForm: CanMonitorFilterForm
  setFilterForm: (form: CanMonitorFilterForm) => void
  filterState: CanMonitorFilterState
  paused: boolean
  togglePause: () => void
  /** Frames captured since the view was paused (still recorded, not shown). */
  newWhilePaused: number
  clear: () => void
  selectedSeq?: number
  selectFrame: (seq: number | undefined) => void
  selectedFrame?: CanFrame
  /** The DroneCAN transfer a frame belongs to, once it has completed and decoded. */
  transferFor: (seq: number) => DronecanTransfer | undefined
  /** A multi-frame transfer's shade (0..CAN_TRANSFER_SHADES-1), so its frames read as one. */
  transferShade: (transfer: DronecanTransfer) => number | undefined
  selectedTransfer?: DronecanTransfer
  /** DroneCAN message streams on the bus (or in the open log), optionally one node's. */
  topics: (nodeId?: number) => CanTopicEntry[]
  /** Point the drawer at one stream's frames. */
  showTopicFrames: (topic: CanTopicEntry) => void
  plotSeries: readonly CanPlotSeries[]
  /** Add a series (backfilled from what is already captured); returns its key. */
  addPlotSeries: (label: string, source: CanPlotSource) => string
  removePlotSeries: (key: string) => void
  clearPlotSeries: () => void
  plotSamplesFor: (key: string) => CanPlotSamples | undefined
  /** "Now" for the plot's time window: the clock live, the play position in a log. */
  plotNowMs: number
  recording: CanRecordingState
  startRecording: () => void
  stopRecording: () => void
  saveRecording: (options: CanSaveOptions) => void
  discardRecording: () => void
  /** Save what the monitor holds right now (no Record press needed). */
  saveBuffer: (options: CanSaveOptions) => void
  openedLog?: CanOpenedLog
  openLog: (file: File) => Promise<void>
  closeLog: () => void
  playback: CanLogPlayback
  play: () => void
  pausePlayback: () => void
  /** Show the whole log at once again (leaves playback). */
  showWholeLog: () => void
  seek: (positionMs: number) => void
  setPlaybackSpeed: (speed: number) => void
  /** Last open-log failure, shown in place. */
  logError?: string
}

interface CaptureStore {
  buffer: CanCaptureBuffer
  trace: CanIdTrace
  originMs: number | undefined
  /** DroneCAN transfers reassembled from the frames, decoded via the DSDL catalogue. */
  decoder: DronecanTransferDecoder
  /** Completed transfers by the seq of EVERY frame in them, so any frame finds its message. */
  transfers: Map<number, DronecanTransfer>
  /** One live row per DroneCAN message stream (Messages on the bus). */
  topics: CanTopicTable
  /** Samples per plot series, taken from this store's frames. */
  plotSamples: Map<string, CanPlotSamples>
  /** A shade per multi-frame transfer, in completion order, so neighbours differ. */
  shades: WeakMap<DronecanTransfer, number>
  shadeCount: number
}

function newStore(capacity: number): CaptureStore {
  return {
    buffer: new CanCaptureBuffer(capacity),
    trace: new CanIdTrace(),
    originMs: undefined,
    decoder: new DronecanTransferDecoder(dronecanCatalogue()),
    transfers: new Map(),
    topics: new CanTopicTable(),
    plotSamples: new Map(),
    shades: new WeakMap(),
    shadeCount: 0
  }
}

/** How many shades multi-frame transfers cycle through in the frame list. */
export const CAN_TRANSFER_SHADES = 4

/** The plot series every store samples (set by the hook; module-level so ingest stays a plain function). */
let activePlotSeries: readonly CanPlotSeries[] = []

function ingest(store: CaptureStore, frame: CanFrame): CanFrame {
  const stored = store.buffer.push(frame)
  store.trace.add(stored)
  if (store.originMs === undefined) store.originMs = stored.timestampMs
  const transfer = store.decoder.push(stored)
  if (activePlotSeries.length > 0) sampleCanPlot(activePlotSeries, store.plotSamples, stored, transfer)
  if (transfer) {
    store.topics.add(transfer)
    for (const seq of transfer.frameSeqs) store.transfers.set(seq, transfer)
    if (transfer.frameSeqs.length > 1) store.shades.set(transfer, store.shadeCount++ % CAN_TRANSFER_SHADES)
    // Keep the index no bigger than the ring: drop transfers whose frames
    // have all fallen out of it.
    if (store.transfers.size > store.buffer.capacity * 1.25) {
      const oldest = store.buffer.at(0)?.seq ?? 0
      for (const seq of store.transfers.keys()) {
        if (seq >= oldest) break
        store.transfers.delete(seq)
      }
    }
  }
  return stored
}

/** A store holding `frames` (already in time order), sized to fit them. */
function storeOf(frames: readonly CanFrame[]): CaptureStore {
  const store = newStore(Math.max(1, frames.length))
  for (const frame of frames) ingest(store, frame)
  return store
}

function framesFor(source: Iterable<CanFrame>, filter: CanFrameFilter | undefined): CanFrame[] {
  const out: CanFrame[] = []
  for (const frame of source) {
    if (!filter || matchesCanFilter(frame, filter)) out.push(frame)
  }
  return out
}

function downloadFrames(frames: readonly CanFrame[], format: CanRecordingFormat, stem: string, startedAtMs: number): void {
  const stamp = timestampSlug(startedAtMs)
  if (format === 'candump') {
    downloadTextFile(`${stem}-${stamp}.log`, formatCandump(frames), 'text/plain')
  } else {
    downloadTextFile(`${stem}-${stamp}.csv`, formatCanCsv(frames), 'text/csv')
  }
}

const PLAYBACK_TICK_MS = 50

function timestampSlug(ms: number): string {
  return new Date(ms).toISOString().replace(/[:.]/g, '-').replace(/Z$/, '')
}

export function useCanBusMonitor(options: {
  source: CanFrameSource | undefined
  /** Capture only while the bus is being forwarded. */
  enabled: boolean
  /** Nominal bitrate of the monitored bus (CAN_Pn_BITRATE), for the load estimate. */
  bitrate?: number
}): UseCanBusMonitorResult {
  const { source, enabled, bitrate } = options
  const live = useRef<CaptureStore>(newStore(CAN_MONITOR_CAPACITY))
  const offline = useRef<CaptureStore | undefined>(undefined)
  const recorder = useRef<{ frames: CanFrame[]; active: boolean; startedAtMs?: number; capped: boolean }>({
    frames: [],
    active: false,
    capped: false
  })
  const dirty = useRef(false)
  const [version, setVersion] = useState(0)
  const [viewMode, setViewMode] = useState<CanMonitorViewMode>('stream')
  const [filterForm, setFilterForm] = useState<CanMonitorFilterForm>(DEFAULT_CAN_MONITOR_FILTER_FORM)
  const [paused, setPaused] = useState(false)
  const pausedAtSeq = useRef(0)
  const [selectedSeq, setSelectedSeq] = useState<number | undefined>(undefined)
  const [openedLog, setOpenedLog] = useState<CanOpenedLog | undefined>(undefined)
  const [logError, setLogError] = useState<string | undefined>(undefined)
  const [recordingPending, setRecordingPending] = useState(false)
  // The opened log: every frame in time order, and its time span. The view
  // (offline.current) is either all of it or the part played so far.
  const logRef = useRef<{ frames: CanFrame[]; timeline: CanLogTimeline } | undefined>(undefined)
  const [playback, setPlayback] = useState<CanLogPlayback>({ mode: 'all', positionMs: 0, speed: 1 })
  const [plotSeries, setPlotSeries] = useState<readonly CanPlotSeries[]>([])
  useEffect(() => {
    activePlotSeries = plotSeries
    return () => {
      activePlotSeries = []
    }
  }, [plotSeries])
  const playbackRef = useRef(playback)
  playbackRef.current = playback

  // Capture. Frames land in the ring (and the recorder) as they arrive; the
  // view only learns about them on the next repaint tick.
  useEffect(() => {
    if (!source || !enabled) return
    return source.onCanFrame((frame) => {
      const stored = ingest(live.current, frame)
      const rec = recorder.current
      if (rec.active) {
        if (rec.frames.length < CAN_RECORDING_MAX_FRAMES) {
          rec.frames.push(stored)
        } else {
          rec.active = false
          rec.capped = true
        }
      }
      dirty.current = true
    })
  }, [source, enabled])

  // Repaint at most every REPAINT_INTERVAL_MS, and only when something arrived.
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (dirty.current) {
        dirty.current = false
        setVersion((value) => value + 1)
      }
    }, REPAINT_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [])

  const filterState = useMemo(() => buildCanMonitorFilter(filterForm), [filterForm])

  const store = offline.current ?? live.current
  const viewingLog = offline.current !== undefined

  // The filtered frame list. Recomputed per repaint from the ring; a full
  // scan of 50k frames against a parsed filter is a millisecond or two, which
  // keeps the logic simple and always exactly right (no incremental list to
  // drift out of step with the ring as old frames fall off the back).
  const frames = useMemo(() => {
    const out: CanFrame[] = []
    const ceiling = paused && !viewingLog ? pausedAtSeq.current : Number.POSITIVE_INFINITY
    const { filter, active } = filterState
    store.buffer.forEach((frame) => {
      if (frame.seq > ceiling) return
      if (!active || matchesCanFilter(frame, filter)) out.push(frame)
    })
    return out
    // `version` is the repaint signal for the mutable ring.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, filterState, paused, viewingLog, openedLog])

  const idRows = useMemo(() => {
    const { filter, active } = filterState
    return store.trace.list().filter((entry) => !active || matchesCanFilter(entry.last, filter))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, filterState, viewingLog, openedLog])

  const stats = useMemo<CanMonitorStats>(() => {
    const buffer = store.buffer
    let framesPerSec = 0
    let busLoadPct: number | undefined
    if (!viewingLog && buffer.size > 0) {
      const newest = buffer.at(buffer.size - 1)!
      const windowStart = Date.now() - RATE_WINDOW_MS
      const recent: CanFrame[] = []
      for (let index = buffer.size - 1; index >= 0; index -= 1) {
        const frame = buffer.at(index)!
        if (frame.timestampMs < windowStart) break
        if (frame.direction === 'rx') recent.push(frame)
      }
      framesPerSec = newest.timestampMs >= windowStart ? recent.length : 0
      busLoadPct = bitrate ? estimateCanBusLoad(recent, RATE_WINDOW_MS, bitrate) : undefined
    }
    return {
      framesPerSec,
      busLoadPct,
      idCount: store.trace.size,
      held: buffer.size,
      totalCaptured: buffer.totalCaptured,
      droppedOldest: buffer.droppedOldest
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, viewingLog, openedLog, bitrate])

  const togglePause = useCallback(() => {
    setPaused((current) => {
      if (!current) pausedAtSeq.current = live.current.buffer.lastSeq
      return !current
    })
  }, [])

  const clear = useCallback(() => {
    live.current = newStore(CAN_MONITOR_CAPACITY)
    pausedAtSeq.current = 0
    setSelectedSeq(undefined)
    setVersion((value) => value + 1)
  }, [])

  const selectedFrame = useMemo(() => {
    if (selectedSeq === undefined) return undefined
    let found: CanFrame | undefined
    store.buffer.forEach((frame) => {
      if (frame.seq === selectedSeq) found = frame
    })
    return found
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSeq, version, openedLog])

  const startRecording = useCallback(() => {
    recorder.current = { frames: [], active: true, startedAtMs: Date.now(), capped: false }
    setRecordingPending(false)
    setVersion((value) => value + 1)
  }, [])

  const stopRecording = useCallback(() => {
    recorder.current.active = false
    setRecordingPending(recorder.current.frames.length > 0)
    setVersion((value) => value + 1)
  }, [])

  const saveRecording = useCallback(
    ({ format, filteredOnly }: CanSaveOptions) => {
      const rec = recorder.current
      if (rec.frames.length === 0) return
      const frames = framesFor(rec.frames, filteredOnly && filterState.active ? filterState.filter : undefined)
      downloadFrames(frames, format, 'can-capture', rec.startedAtMs ?? Date.now())
    },
    [filterState]
  )

  const saveBuffer = useCallback(
    ({ format, filteredOnly }: CanSaveOptions) => {
      const source = (offline.current ?? live.current).buffer.toArray()
      const frames = framesFor(source, filteredOnly && filterState.active ? filterState.filter : undefined)
      if (frames.length === 0) return
      downloadFrames(frames, format, offline.current ? 'can-log-excerpt' : 'can-buffer', frames[0].timestampMs)
    },
    [filterState]
  )

  const discardRecording = useCallback(() => {
    recorder.current = { frames: [], active: false, capped: false }
    setRecordingPending(false)
    setVersion((value) => value + 1)
  }, [])

  const openLog = useCallback(async (file: File) => {
    setLogError(undefined)
    try {
      const text = await file.text()
      const parsed = parseCanLog(text)
      if (parsed.frames.length === 0) {
        setLogError(
          `${file.name} has no frames this monitor can read: a candump -L log (lines like "(1700000000.000000) can0 123#DEADBEEF") or a CSV saved here.`
        )
        return
      }
      const timeline = canLogTimeline(parsed.frames)
      logRef.current = { frames: parsed.frames, timeline }
      offline.current = storeOf(parsed.frames)
      setSelectedSeq(undefined)
      setPlayback((current) => ({ mode: 'all', positionMs: timeline.durationMs, speed: current.speed }))
      setOpenedLog({
        name: file.name,
        format: parsed.format,
        frameCount: parsed.frames.length,
        skippedLines: parsed.skippedLines.length,
        durationMs: timeline.durationMs
      })
    } catch (error) {
      setLogError(error instanceof Error ? error.message : 'Could not read that file.')
    }
  }, [])

  const closeLog = useCallback(() => {
    offline.current = undefined
    logRef.current = undefined
    setSelectedSeq(undefined)
    setOpenedLog(undefined)
    setPlayback((current) => ({ mode: 'all', positionMs: 0, speed: current.speed }))
  }, [])

  /** Rebuild the log view as it stood at `positionMs` (everything up to it). */
  const viewLogAt = useCallback((positionMs: number) => {
    const log = logRef.current
    if (!log) return
    const end = canFrameIndexAt(log.frames, log.timeline.startMs + positionMs + 0.001)
    // Sized for the WHOLE log: playback appends to this store, and a ring
    // sized to the frames shown so far (one, at the start) overwrote itself.
    const store = newStore(Math.max(1, log.frames.length))
    for (let index = 0; index < end; index += 1) ingest(store, log.frames[index])
    offline.current = store
    // Keep the clock's origin at the log's start even before its first frame shows.
    offline.current.originMs = log.timeline.startMs
  }, [])

  const play = useCallback(() => {
    const log = logRef.current
    if (!log) return
    const current = playbackRef.current
    // From the whole-log view, or from the very end, playback starts over.
    const start =
      current.mode === 'all' || current.positionMs >= log.timeline.durationMs ? 0 : current.positionMs
    if (current.mode === 'all' || start === 0) viewLogAt(start)
    setPlayback({ ...current, mode: 'playing', positionMs: start })
    setVersion((value) => value + 1)
  }, [viewLogAt])

  const pausePlayback = useCallback(() => {
    setPlayback((current) => (current.mode === 'playing' ? { ...current, mode: 'paused' } : current))
  }, [])

  const showWholeLog = useCallback(() => {
    const log = logRef.current
    if (!log) return
    offline.current = storeOf(log.frames)
    setPlayback((current) => ({ ...current, mode: 'all', positionMs: log.timeline.durationMs }))
    setVersion((value) => value + 1)
  }, [])

  const seek = useCallback(
    (positionMs: number) => {
      const log = logRef.current
      if (!log) return
      const clamped = Math.max(0, Math.min(log.timeline.durationMs, positionMs))
      viewLogAt(clamped)
      setPlayback((current) => ({ ...current, mode: current.mode === 'all' ? 'paused' : current.mode, positionMs: clamped }))
      setSelectedSeq(undefined)
      setVersion((value) => value + 1)
    },
    [viewLogAt]
  )

  const setPlaybackSpeed = useCallback((speed: number) => {
    setPlayback((current) => ({ ...current, speed }))
  }, [])

  // The playback clock: advance by real elapsed time x speed, append the
  // frames that fall in between, stop at the end.
  useEffect(() => {
    if (playback.mode !== 'playing') return
    let last = performance.now()
    const timer = window.setInterval(() => {
      const log = logRef.current
      const store = offline.current
      if (!log || !store) return
      const now = performance.now()
      const state = playbackRef.current
      const next = Math.min(log.timeline.durationMs, state.positionMs + (now - last) * state.speed)
      last = now
      const range = canFramesBetween(log.frames, log.timeline, state.positionMs, next)
      for (let index = range.from; index < range.to; index += 1) ingest(store, log.frames[index])
      const atEnd = next >= log.timeline.durationMs
      playbackRef.current = { ...state, positionMs: next, mode: atEnd ? 'paused' : 'playing' }
      setPlayback(playbackRef.current)
      dirty.current = true
    }, PLAYBACK_TICK_MS)
    return () => window.clearInterval(timer)
  }, [playback.mode])

  const addPlotSeries = useCallback((label: string, source: CanPlotSource): string => {
    const key = canPlotSeriesKey(source)
    setPlotSeries((current) => {
      if (current.some((entry) => entry.key === key)) return current
      const series: CanPlotSeries = { key, label, color: nextCanPlotColor(current), source }
      // Backfill from what is already captured, live and in an open log, so a
      // series added after the fact still shows the past.
      for (const target of [live.current, offline.current]) {
        if (!target) continue
        target.buffer.forEach((frame) => {
          const transfer = target.transfers.get(frame.seq)
          const completed = transfer && transfer.frameSeqs[transfer.frameSeqs.length - 1] === frame.seq ? transfer : undefined
          sampleCanPlot([series], target.plotSamples, frame, completed)
        })
      }
      const next = [...current, series]
      activePlotSeries = next
      return next
    })
    setVersion((value) => value + 1)
    return key
  }, [])

  const removePlotSeries = useCallback((key: string) => {
    setPlotSeries((current) => current.filter((entry) => entry.key !== key))
    live.current.plotSamples.delete(key)
    offline.current?.plotSamples.delete(key)
  }, [])

  const clearPlotSeries = useCallback(() => {
    setPlotSeries([])
    live.current.plotSamples.clear()
    offline.current?.plotSamples.clear()
  }, [])

  const plotNowMs = (() => {
    const log = logRef.current
    if (offline.current && log) {
      return playback.mode === 'all' ? log.timeline.endMs : log.timeline.startMs + playback.positionMs
    }
    return Date.now()
  })()

  const rec = recorder.current
  return {
    frames,
    idRows,
    originMs: store.originMs ?? Date.now(),
    stats,
    viewMode,
    setViewMode,
    filterForm,
    setFilterForm,
    filterState,
    paused: paused && !viewingLog,
    togglePause,
    newWhilePaused: paused ? Math.max(0, live.current.buffer.lastSeq - pausedAtSeq.current) : 0,
    clear,
    selectedSeq,
    selectFrame: setSelectedSeq,
    selectedFrame,
    transferFor: (seq: number) => store.transfers.get(seq),
    transferShade: (transfer: DronecanTransfer) => store.shades.get(transfer),
    topics: (nodeId?: number) => store.topics.list(nodeId),
    plotSeries,
    addPlotSeries,
    removePlotSeries,
    clearPlotSeries,
    plotSamplesFor: (key: string) => store.plotSamples.get(key),
    plotNowMs,
    showTopicFrames: (topic: CanTopicEntry) => {
      setFilterForm({ ...DEFAULT_CAN_MONITOR_FILTER_FORM, idText: canTopicIdFilter(topic) })
      setViewMode('stream')
    },
    selectedTransfer: selectedSeq !== undefined ? store.transfers.get(selectedSeq) : undefined,
    recording: {
      active: rec.active,
      frameCount: rec.frames.length,
      startedAtMs: rec.startedAtMs,
      capped: rec.capped,
      pendingSave: recordingPending || (!rec.active && rec.capped && rec.frames.length > 0)
    },
    startRecording,
    stopRecording,
    saveRecording,
    discardRecording,
    saveBuffer,
    openedLog,
    openLog,
    closeLog,
    playback,
    play,
    pausePlayback,
    showWholeLog,
    seek,
    setPlaybackSpeed,
    logError
  }
}
