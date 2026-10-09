// The CAN bus monitor: a drawer docked at the foot of the CAN tab, in the
// spirit of a browser's devtools -- always one glance away, resizable, and
// never a separate page. Presentational: every frame, count and handler comes
// in through `monitor`; the only state here is UI state (drawer height, the
// table's scroll position).

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  CAN_PLAYBACK_SPEEDS,
  formatCanAscii,
  formatCanData,
  formatCanId,
  formatCandumpLine,
  type CanFrame,
  type CanFrameKinds,
  type CanIdTraceEntry
} from '@arduconfig/can-core'
import type { DronecanTransfer } from '@arduconfig/dronecan-dsdl'
import { buttonStyle } from '@arduconfig/ui-kit'

import {
  canByteRows,
  describeCanFrame,
  dronecanFrameHeader,
  formatCaptureTime,
  type CanMonitorFilterForm,
  type CanMonitorFilterState
} from '../view-models/can-bus-monitor'
import { dronecanDisplayName, summarizeDronecanValue, transferFieldTree } from '../view-models/dronecan-field-tree'
import { DronecanFieldTree } from './DronecanFieldTree'
import { InfoDot } from './InfoDot'

export type CanMonitorViewMode = 'stream' | 'by-id'

/** Everything the drawer renders and does. use-can-bus-monitor returns this shape. */
export interface CanBusMonitorModel {
  frames: readonly CanFrame[]
  idRows: readonly CanIdTraceEntry[]
  originMs: number
  stats: {
    framesPerSec: number
    busLoadPct?: number
    idCount: number
    held: number
    totalCaptured: number
    droppedOldest: number
  }
  viewMode: CanMonitorViewMode
  setViewMode: (mode: CanMonitorViewMode) => void
  filterForm: CanMonitorFilterForm
  setFilterForm: (form: CanMonitorFilterForm) => void
  filterState: CanMonitorFilterState
  paused: boolean
  togglePause: () => void
  newWhilePaused: number
  clear: () => void
  selectedSeq?: number
  selectFrame: (seq: number | undefined) => void
  selectedFrame?: CanFrame
  transferFor: (seq: number) => DronecanTransfer | undefined
  transferShade: (transfer: DronecanTransfer) => number | undefined
  selectedTransfer?: DronecanTransfer
  recording: { active: boolean; frameCount: number; startedAtMs?: number; capped: boolean; pendingSave: boolean }
  startRecording: () => void
  stopRecording: () => void
  saveRecording: (options: CanSaveOptions) => void
  discardRecording: () => void
  saveBuffer: (options: CanSaveOptions) => void
  openedLog?: { name: string; format: 'candump' | 'csv'; frameCount: number; skippedLines: number; durationMs: number }
  openLog: (file: File) => Promise<void>
  closeLog: () => void
  playback: { mode: 'all' | 'playing' | 'paused'; positionMs: number; speed: number }
  play: () => void
  pausePlayback: () => void
  showWholeLog: () => void
  seek: (positionMs: number) => void
  setPlaybackSpeed: (speed: number) => void
  logError?: string
}

export interface CanSaveOptions {
  format: 'candump' | 'csv'
  filteredOnly: boolean
}

export interface CanBusMonitorViewProps {
  monitor: CanBusMonitorModel
  /** The bus is being forwarded (frames can arrive). */
  live: boolean
  /**
   * 'drawer' docks at the foot of a page (resizable, collapsible); 'page'
   * fills a tab of its own (Expert ▸ Frames).
   */
  layout?: 'drawer' | 'page'
}

const ROW_HEIGHT = 26
const OVERSCAN = 12
const HEIGHT_STORAGE_KEY = 'arduconfig.can-monitor.height'
const DEFAULT_HEIGHT = 340
const MIN_HEIGHT = 180

const KIND_CHIPS: { key: keyof CanFrameKinds; label: string; title: string }[] = [
  { key: 'standard', label: 'STD', title: '11-bit standard ids' },
  { key: 'extended', label: 'EXT', title: '29-bit extended ids (DroneCAN is always extended)' },
  { key: 'fd', label: 'FD', title: 'CAN FD frames' },
  { key: 'remote', label: 'RTR', title: 'Remote request frames' },
  { key: 'error', label: 'ERR', title: 'Error frames' }
]

function readStoredHeight(): number {
  try {
    const stored = Number(window.localStorage.getItem(HEIGHT_STORAGE_KEY))
    return Number.isFinite(stored) && stored >= MIN_HEIGHT ? stored : DEFAULT_HEIGHT
  } catch {
    return DEFAULT_HEIGHT
  }
}

function writeStoredHeight(height: number): void {
  try {
    window.localStorage.setItem(HEIGHT_STORAGE_KEY, String(Math.round(height)))
  } catch {
    // Storage blocked: the drawer still resizes, it just is not remembered.
  }
}

const number = new Intl.NumberFormat('en-US')

function elapsedLabel(sinceMs: number | undefined): string {
  if (sinceMs === undefined) return ''
  const seconds = Math.max(0, Math.floor((Date.now() - sinceMs) / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

function FlagBadges({ frame }: { frame: Pick<CanFrame, 'extended' | 'fd' | 'rtr' | 'error'> }): ReactNode {
  return (
    <span className="can-monitor__flags">
      <span className={`can-monitor__flag can-monitor__flag--${frame.extended ? 'ext' : 'std'}`}>
        {frame.extended ? 'EXT' : 'STD'}
      </span>
      {frame.fd ? <span className="can-monitor__flag can-monitor__flag--fd">FD</span> : null}
      {frame.rtr ? <span className="can-monitor__flag can-monitor__flag--rtr">RTR</span> : null}
      {frame.error ? <span className="can-monitor__flag can-monitor__flag--err">ERR</span> : null}
    </span>
  )
}

/**
 * The Decoded column: the DSDL type and a few fields once the frame's
 * transfer has completed; the header reading (or plain-CAN note) until then.
 */
function decodedLabel(frame: CanFrame, transfer: DronecanTransfer | undefined): { text: string; title?: string } {
  if (!transfer?.type) return { text: describeCanFrame(frame) }
  const name = dronecanDisplayName(transfer.type.fullName)
  const route =
    transfer.kind === 'message'
      ? ` ← ${transfer.sourceNodeId}`
      : ` ${transfer.kind === 'request' ? 'req' : 'resp'} ${transfer.sourceNodeId}→${transfer.destinationNodeId}`
  if (transfer.problem) return { text: `${name}${route} · ⚠ ${transfer.problem.split(':')[0]}`, title: transfer.problem }
  const tree = transfer.kind === 'message' ? transferFieldTree(transfer) : undefined
  const summary = tree ? summarizeDronecanValue(tree, 2) : ''
  return { text: `${name}${route}${summary ? ` · ${summary}` : ''}`, title: transfer.type.fullName }
}

/** A fixed-row virtual list: only the rows in view (plus a margin) are in the DOM. */
function useVirtualRows(count: number, followKey: unknown) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(240)
  const [following, setFollowing] = useState(true)

  useLayoutEffect(() => {
    const node = scrollRef.current
    if (!node) return
    const observer = new ResizeObserver(() => setViewportHeight(node.clientHeight))
    observer.observe(node)
    setViewportHeight(node.clientHeight)
    return () => observer.disconnect()
  }, [])

  // Follow the newest frame until the operator scrolls up; then stay put.
  useLayoutEffect(() => {
    const node = scrollRef.current
    if (node && following) {
      node.scrollTop = node.scrollHeight
      setScrollTop(node.scrollTop)
    }
  }, [count, followKey, following])

  const onScroll = () => {
    const node = scrollRef.current
    if (!node) return
    setScrollTop(node.scrollTop)
    const atBottom = node.scrollHeight - node.scrollTop - node.clientHeight < ROW_HEIGHT * 2
    setFollowing(atBottom)
  }

  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN)
  const last = Math.min(count, Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN)
  return {
    scrollRef,
    onScroll,
    first,
    last,
    following,
    jumpToLatest: () => setFollowing(true)
  }
}

function StreamTable({ monitor }: { monitor: CanBusMonitorModel }): ReactNode {
  const { frames, originMs, selectedSeq, selectFrame } = monitor
  const virtual = useVirtualRows(frames.length, frames[frames.length - 1]?.seq)
  return (
    <div className="can-monitor__table" role="table" aria-label="CAN frames" data-testid="can-monitor-stream">
      <div className="can-monitor__row can-monitor__row--head can-monitor__row--stream" role="row">
        <span role="columnheader">Time (s)</span>
        <span role="columnheader">Bus</span>
        <span role="columnheader">Dir</span>
        <span role="columnheader">ID</span>
        <span role="columnheader">Type</span>
        <span role="columnheader">Len</span>
        <span role="columnheader">Data</span>
        <span role="columnheader">Decoded</span>
      </div>
      <div className="can-monitor__scroll" ref={virtual.scrollRef} onScroll={virtual.onScroll}>
        <div style={{ height: frames.length * ROW_HEIGHT, position: 'relative' }}>
          {frames.slice(virtual.first, virtual.last).map((frame, offset) => {
            const index = virtual.first + offset
            // A multi-frame transfer's frames share a shade (and a "2/3" part
            // tag), and selecting one lights up the rest -- which frames came
            // together, the way the DroneCAN GUI Tool shows it.
            const transfer = monitor.transferFor(frame.seq)
            const shade = transfer ? monitor.transferShade(transfer) : undefined
            const sibling =
              monitor.selectedTransfer !== undefined && monitor.selectedTransfer === transfer && frame.seq !== selectedSeq && shade !== undefined
            return (
              <div
                key={frame.seq}
                role="row"
                className={`can-monitor__row can-monitor__row--stream${frame.direction === 'tx' ? ' is-tx' : ''}${frame.seq === selectedSeq ? ' is-selected' : ''}${shade !== undefined ? ` is-multi can-monitor__row--shade-${shade}` : ''}${sibling ? ' is-sibling' : ''}`}
                style={{ top: index * ROW_HEIGHT }}
                // On press, not click: a live list moves between press and
                // release, and a click needs both on the same row.
                onMouseDown={(event) => {
                  if (event.button === 0) selectFrame(frame.seq === selectedSeq ? undefined : frame.seq)
                }}
                data-testid="can-monitor-row"
                data-transfer-part={shade !== undefined && transfer ? `${transfer.frameSeqs.indexOf(frame.seq) + 1}/${transfer.frameSeqs.length}` : undefined}
              >
                <span className="can-monitor__mono can-monitor__dim">{formatCaptureTime(frame.timestampMs, originMs)}</span>
                <span className="can-monitor__dim">{frame.bus}</span>
                <span className={`can-monitor__dir can-monitor__dir--${frame.direction}`}>{frame.direction.toUpperCase()}</span>
                <span className="can-monitor__mono can-monitor__id">{formatCanId(frame.id, frame.extended)}</span>
                <FlagBadges frame={frame} />
                <span className="can-monitor__mono can-monitor__dim">{frame.data.length}</span>
                <span className="can-monitor__mono can-monitor__data">{formatCanData(frame.data)}</span>
                {(() => {
                  const label = decodedLabel(frame, transfer)
                  return (
                    <span className="can-monitor__decoded" title={label.title}>
                      {shade !== undefined && transfer ? (
                        <span className="can-monitor__part" data-testid="can-monitor-part">
                          {transfer.frameSeqs.indexOf(frame.seq) + 1}/{transfer.frameSeqs.length}
                        </span>
                      ) : null}
                      {label.text}
                    </span>
                  )
                })()}
              </div>
            )
          })}
        </div>
      </div>
      {!virtual.following && frames.length > 0 ? (
        <button type="button" className="can-monitor__jump" onClick={virtual.jumpToLatest} data-testid="can-monitor-jump">
          ↓ Latest
        </button>
      ) : null}
    </div>
  )
}

function ByIdTable({ monitor }: { monitor: CanBusMonitorModel }): ReactNode {
  const { idRows, selectedSeq, selectFrame } = monitor
  const now = Date.now()
  return (
    <div className="can-monitor__table" role="table" aria-label="CAN ids" data-testid="can-monitor-by-id">
      <div className="can-monitor__row can-monitor__row--head can-monitor__row--by-id" role="row">
        <span role="columnheader">ID</span>
        <span role="columnheader">Bus</span>
        <span role="columnheader">Type</span>
        <span role="columnheader">Count</span>
        <span role="columnheader">Period</span>
        <span role="columnheader">Last data</span>
        <span role="columnheader">Decoded</span>
        <span role="columnheader">Seen</span>
      </div>
      <div className="can-monitor__scroll">
        {idRows.map((entry) => {
          const stale = now - entry.lastSeenMs > Math.max(2000, (entry.periodMs ?? 0) * 3)
          return (
            <div
              key={entry.key}
              role="row"
              className={`can-monitor__row can-monitor__row--by-id is-static${stale ? ' is-stale' : ''}${entry.last.seq === selectedSeq ? ' is-selected' : ''}`}
              onMouseDown={(event) => {
                if (event.button === 0) selectFrame(entry.last.seq === selectedSeq ? undefined : entry.last.seq)
              }}
              data-testid={`can-monitor-id-${formatCanId(entry.id, entry.extended)}`}
            >
              <span className="can-monitor__mono can-monitor__id">{formatCanId(entry.id, entry.extended)}</span>
              <span className="can-monitor__dim">{entry.bus}</span>
              <FlagBadges frame={entry.last} />
              <span className="can-monitor__mono">{number.format(entry.count)}</span>
              <span className="can-monitor__mono can-monitor__dim">
                {entry.periodMs !== undefined ? `${entry.periodMs.toFixed(entry.periodMs < 10 ? 1 : 0)} ms` : '—'}
              </span>
              <span className="can-monitor__mono can-monitor__data">
                {Array.from(entry.last.data, (byte, index) => (
                  <span
                    key={index}
                    className={(entry.changedBytes >> index) & 1 ? 'can-monitor__byte is-changed' : 'can-monitor__byte'}
                  >
                    {byte.toString(16).toUpperCase().padStart(2, '0')}
                  </span>
                ))}
              </span>
              {(() => {
                const label = decodedLabel(entry.last, monitor.transferFor(entry.last.seq))
                return (
                  <span className="can-monitor__decoded" title={label.title}>
                    {label.text}
                  </span>
                )
              })()}
              <span className="can-monitor__dim">{stale ? `${Math.round((now - entry.lastSeenMs) / 1000)} s ago` : 'live'}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function FrameDetails({
  frame,
  transfer,
  originMs,
  onClose
}: {
  frame: CanFrame
  transfer?: DronecanTransfer
  originMs: number
  onClose: () => void
}): ReactNode {
  const header = dronecanFrameHeader(frame)
  const tree = transfer ? transferFieldTree(transfer) : undefined
  const [copied, setCopied] = useState(false)
  return (
    <aside className="can-monitor__details" data-testid="can-monitor-details" aria-label="Frame details">
      <header className="can-monitor__details-head">
        <strong className="can-monitor__mono">{formatCanId(frame.id, frame.extended)}</strong>
        <FlagBadges frame={frame} />
        <button type="button" className="can-monitor__icon-button" onClick={onClose} aria-label="Close frame details">
          ×
        </button>
      </header>
      <dl className="can-monitor__facts">
        <dt>Time</dt>
        <dd className="can-monitor__mono">{formatCaptureTime(frame.timestampMs, originMs)} s</dd>
        <dt>Bus</dt>
        <dd>CAN{frame.bus} · {frame.direction === 'tx' ? 'sent by this app' : 'received'}</dd>
        <dt>ID</dt>
        <dd className="can-monitor__mono">
          0x{formatCanId(frame.id, frame.extended)} · {frame.id}
        </dd>
        <dt>Length</dt>
        <dd>{frame.data.length} byte{frame.data.length === 1 ? '' : 's'}</dd>
      </dl>
      {transfer ? (
        <section className="can-monitor__details-section" data-testid="can-monitor-decoded">
          <h4>
            Decoded
            <InfoDot label="About the decoded message">
              The DroneCAN transfer this frame belongs to, reassembled from its frames, checked against the type's
              CRC, and decoded with the DroneCAN DSDL bundled in this build.
            </InfoDot>
          </h4>
          <p className="can-monitor__decoded-type" title={transfer.type?.fullName}>
            <strong>{transfer.type?.fullName ?? `Type ${transfer.dataTypeId}`}</strong>
            <span className="can-monitor__dim">
              {' '}
              · {transfer.kind} · {transfer.frameSeqs.length} frame{transfer.frameSeqs.length === 1 ? '' : 's'} ·{' '}
              {transfer.payload.length} bytes
            </span>
          </p>
          {transfer.problem ? (
            <p className="can-monitor__problem" data-testid="can-monitor-decode-problem">⚠ {transfer.problem}</p>
          ) : null}
          {tree ? <DronecanFieldTree nodes={tree} /> : null}
        </section>
      ) : null}
      {header ? (
        <section className="can-monitor__details-section" data-testid="can-monitor-dronecan">
          <h4>
            Frame header
            <InfoDot label="About the DroneCAN reading">
              How this 29-bit id reads as a DroneCAN frame. The bus cannot say a frame IS DroneCAN, so a non-DroneCAN
              extended frame is read this way too; its Decoded section, when there is one, is the proof.
            </InfoDot>
          </h4>
          <dl className="can-monitor__facts">
            <dt>Kind</dt>
            <dd>
              {header.kind === 'service'
                ? `Service ${header.request ? 'request' : 'response'}`
                : header.kind === 'anonymous'
                  ? 'Anonymous message'
                  : 'Message'}
            </dd>
            <dt>Type</dt>
            <dd>
              {header.typeName ? `${header.typeName} · ` : ''}
              {header.typeId}
            </dd>
            <dt>Priority</dt>
            <dd>{header.priority}</dd>
            <dt>Source</dt>
            <dd>Node {header.sourceNodeId}</dd>
            {header.destinationNodeId !== undefined ? (
              <>
                <dt>Destination</dt>
                <dd>Node {header.destinationNodeId}</dd>
              </>
            ) : null}
            <dt>Transfer</dt>
            <dd>
              #{header.transferId} ·{' '}
              {header.sot && header.eot ? 'single frame' : header.sot ? 'first frame' : header.eot ? 'last frame' : 'middle frame'}
            </dd>
          </dl>
        </section>
      ) : null}
      <section className="can-monitor__details-section">
        <h4>Bytes</h4>
        <table className="can-monitor__bytes">
          <thead>
            <tr>
              <th>#</th>
              <th>Hex</th>
              <th>Dec</th>
              <th>Binary</th>
              <th>ASCII</th>
            </tr>
          </thead>
          <tbody>
            {canByteRows(frame.data).map((row) => (
              <tr key={row.index}>
                <td>{row.index}</td>
                <td>{row.hex}</td>
                <td>{row.dec}</td>
                <td>{row.bin}</td>
                <td>{row.ascii}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {frame.data.length > 0 ? <p className="can-monitor__ascii">{formatCanAscii(frame.data)}</p> : null}
      </section>
      <button
        type="button"
        style={buttonStyle()}
        onClick={() => {
          void navigator.clipboard?.writeText(formatCandumpLine(frame)).then(() => setCopied(true))
          window.setTimeout(() => setCopied(false), 1500)
        }}
      >
        {copied ? 'Copied' : 'Copy as candump line'}
      </button>
    </aside>
  )
}

/**
 * Save what the monitor holds, without having pressed Record: the moment
 * something odd shows up, the minutes before it are already captured.
 */
function SavePopover({ monitor, onClose }: { monitor: CanBusMonitorModel; onClose: () => void }): ReactNode {
  const panelRef = useRef<HTMLDivElement | null>(null)
  const [filteredOnly, setFilteredOnly] = useState(monitor.filterState.active)
  useEffect(() => {
    const onPointer = (event: PointerEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) onClose()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])
  const viewingLog = monitor.openedLog !== undefined
  const save = (format: 'candump' | 'csv') => {
    monitor.saveBuffer({ format, filteredOnly: filteredOnly && monitor.filterState.active })
    onClose()
  }
  return (
    <div className="can-monitor__popover" ref={panelRef} role="dialog" aria-label="Save frames" data-testid="can-monitor-save-popover">
      <p>
        {viewingLog
          ? `Save the ${number.format(monitor.stats.held)} frames shown from this log.`
          : `Save the ${number.format(monitor.stats.held)} frames held now: the last few minutes, no Record needed.`}
      </p>
      {monitor.filterState.active ? (
        <label className="can-monitor__check">
          <input
            type="checkbox"
            checked={filteredOnly}
            onChange={(event) => setFilteredOnly(event.target.checked)}
            data-testid="can-monitor-save-filtered"
          />
          <span>Only frames matching the filter ({number.format(monitor.frames.length)})</span>
        </label>
      ) : null}
      <div className="can-monitor__popover-actions">
        <button type="button" style={buttonStyle('primary')} onClick={() => save('candump')} data-testid="can-monitor-save-buffer-candump">
          Save .log
        </button>
        <button type="button" style={buttonStyle()} onClick={() => save('csv')} data-testid="can-monitor-save-buffer-csv">
          Save CSV
        </button>
      </div>
      <small>.log is candump -L: it opens in can-utils, SavvyCAN and python-can, and back here.</small>
    </div>
  )
}

function formatSeconds(ms: number): string {
  return (ms / 1000).toFixed(ms >= 100_000 ? 0 : 2)
}

/** The opened log's banner: what it is, and a player to run it against a clock. */
function LogPlayer({ monitor }: { monitor: CanBusMonitorModel }): ReactNode {
  const log = monitor.openedLog!
  const { playback } = monitor
  const playing = playback.mode === 'playing'
  return (
    <div className="can-monitor__banner can-monitor__banner--log can-monitor__player" data-testid="can-monitor-log-banner">
      <div className="can-monitor__player-info">
        <span>
          <strong>{log.name}</strong> · {number.format(log.frameCount)} frames · {formatSeconds(log.durationMs)} s
          {log.skippedLines > 0 ? ` · ${log.skippedLines} unreadable lines skipped` : ''}
        </span>
        <button type="button" style={buttonStyle()} onClick={monitor.closeLog} data-testid="can-monitor-close-log">
          Back to live
        </button>
      </div>
      <div className="can-monitor__transport">
        <button
          type="button"
          className="can-monitor__tool"
          onClick={playing ? monitor.pausePlayback : monitor.play}
          data-testid="can-monitor-play"
          aria-label={playing ? 'Pause playback' : 'Play the log'}
        >
          {playing ? '❚❚ Pause' : '▶ Play'}
        </button>
        <input
          type="range"
          className="can-monitor__scrubber"
          min={0}
          max={Math.max(1, Math.round(log.durationMs))}
          step={1}
          value={Math.round(playback.mode === 'all' ? log.durationMs : playback.positionMs)}
          onChange={(event) => monitor.seek(Number(event.target.value))}
          aria-label="Log position"
          data-testid="can-monitor-scrubber"
        />
        <span className="can-monitor__mono can-monitor__time" data-testid="can-monitor-position">
          {playback.mode === 'all' ? 'whole log' : `${formatSeconds(playback.positionMs)} / ${formatSeconds(log.durationMs)} s`}
        </span>
        <label className="can-monitor__field">
          <span>Speed</span>
          <select
            value={String(playback.speed)}
            onChange={(event) => monitor.setPlaybackSpeed(Number(event.target.value))}
            data-testid="can-monitor-speed"
          >
            {CAN_PLAYBACK_SPEEDS.map((speed) => (
              <option key={speed} value={speed}>
                {speed}×
              </option>
            ))}
          </select>
        </label>
        {playback.mode !== 'all' ? (
          <button type="button" className="can-monitor__tool" onClick={monitor.showWholeLog} data-testid="can-monitor-show-all">
            Show all
          </button>
        ) : null}
      </div>
    </div>
  )
}

export function CanBusMonitorView({ monitor, live, layout = 'drawer' }: CanBusMonitorViewProps): ReactNode {
  const isPage = layout === 'page'
  const [height, setHeight] = useState(readStoredHeight)
  const [collapsed, setCollapsed] = useState(false)
  const [saveOpen, setSaveOpen] = useState(false)
  const [recordingFilteredOnly, setRecordingFilteredOnly] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const dragRef = useRef<{ startY: number; startHeight: number } | undefined>(undefined)
  const { stats, filterForm, setFilterForm, filterState, recording, openedLog } = monitor
  const viewingLog = openedLog !== undefined
  // Re-render once a second while recording, so the elapsed clock moves.
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!recording.active) return
    const timer = window.setInterval(() => setTick((value) => value + 1), 1000)
    return () => window.clearInterval(timer)
  }, [recording.active])

  const shownCount = monitor.viewMode === 'stream' ? monitor.frames.length : monitor.idRows.length
  const totalCount = monitor.viewMode === 'stream' ? stats.held : stats.idCount
  const statusTone = viewingLog ? 'log' : !live ? 'idle' : stats.framesPerSec > 0 ? 'live' : 'quiet'

  const setKind = (key: keyof CanFrameKinds, on: boolean) =>
    setFilterForm({ ...filterForm, kinds: { ...filterForm.kinds, [key]: on } })

  const maxHeight = useMemo(() => (typeof window === 'undefined' ? 800 : Math.round(window.innerHeight * 0.8)), [])

  return (
    <section
      className={`can-monitor${isPage ? ' can-monitor--page' : ''}${collapsed && !isPage ? ' is-collapsed' : ''}`}
      style={isPage || collapsed ? undefined : { height }}
      aria-label="CAN bus monitor"
      data-testid="can-monitor"
    >
      {/* The drawer's top edge is its resize handle, as in a browser's devtools. */}
      {!collapsed && !isPage ? (
        <div
          className="can-monitor__resize"
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize the bus monitor"
          tabIndex={0}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId)
            dragRef.current = { startY: event.clientY, startHeight: height }
          }}
          onPointerMove={(event) => {
            const drag = dragRef.current
            if (!drag) return
            setHeight(Math.min(maxHeight, Math.max(MIN_HEIGHT, drag.startHeight + (drag.startY - event.clientY))))
          }}
          onPointerUp={() => {
            dragRef.current = undefined
            writeStoredHeight(height)
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
              event.preventDefault()
              const next = Math.min(maxHeight, Math.max(MIN_HEIGHT, height + (event.key === 'ArrowUp' ? 24 : -24)))
              setHeight(next)
              writeStoredHeight(next)
            }
          }}
        />
      ) : null}

      <header className="can-monitor__bar">
        <div className="can-monitor__title">
          <span className={`can-monitor__pulse can-monitor__pulse--${statusTone}`} aria-hidden="true" />
          <strong>Bus monitor</strong>
          <InfoDot label="About the bus monitor" wide>
            Every frame on the forwarded bus, DroneCAN or not, plus the frames this app sends (TX). Over MAVLink the
            autopilot forwards a frame only when the link has room, so a busy bus can lose frames before they reach
            you; the frame rate shown is what arrived.
          </InfoDot>
        </div>
        <div className="can-monitor__stats" data-testid="can-monitor-stats">
          {viewingLog ? (
            <span>{number.format(openedLog.frameCount)} frames from log</span>
          ) : (
            <>
              <span>
                <b>{number.format(stats.framesPerSec)}</b> f/s
              </span>
              {stats.busLoadPct !== undefined ? (
                <span title="Estimated from frame lengths and the bus bitrate">
                  load ~<b>{stats.busLoadPct.toFixed(stats.busLoadPct < 10 ? 1 : 0)}</b>%
                </span>
              ) : null}
              <span>
                <b>{number.format(stats.idCount)}</b> IDs
              </span>
              <span className="can-monitor__dim">{number.format(stats.held)} held</span>
            </>
          )}
        </div>
        <div className="can-monitor__controls">
          <div className="can-monitor__segmented" role="radiogroup" aria-label="Monitor view">
            {(['stream', 'by-id'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={monitor.viewMode === mode}
                className={monitor.viewMode === mode ? 'is-active' : undefined}
                onClick={() => monitor.setViewMode(mode)}
                data-testid={`can-monitor-view-${mode}`}
              >
                {mode === 'stream' ? 'Stream' : 'By ID'}
              </button>
            ))}
          </div>
          {!viewingLog ? (
            <button
              type="button"
              // Red to stop the view, green to let it run again.
              className={`can-monitor__tool ${monitor.paused ? 'can-monitor__tool--resume' : 'can-monitor__tool--pause'}`}
              onClick={monitor.togglePause}
              data-testid="can-monitor-pause"
              aria-pressed={monitor.paused}
            >
              {monitor.paused ? 'Resume' : 'Pause'}
            </button>
          ) : null}
          {!viewingLog ? (
            <button type="button" className="can-monitor__tool" onClick={monitor.clear} data-testid="can-monitor-clear">
              Clear
            </button>
          ) : null}
          {!viewingLog ? (
            <button
              type="button"
              className={`can-monitor__tool can-monitor__tool--record${recording.active ? ' is-recording' : ''}`}
              onClick={recording.active ? monitor.stopRecording : monitor.startRecording}
              disabled={!live && !recording.active}
              data-testid="can-monitor-record"
              aria-pressed={recording.active}
            >
              <span className="can-monitor__rec-dot" aria-hidden="true" />
              {recording.active
                ? `Stop · ${number.format(recording.frameCount)} · ${elapsedLabel(recording.startedAtMs)}`
                : 'Record'}
            </button>
          ) : null}
          <div className="can-monitor__popover-anchor">
            <button
              type="button"
              className="can-monitor__tool"
              onClick={() => setSaveOpen((open) => !open)}
              disabled={stats.held === 0}
              aria-expanded={saveOpen}
              data-testid="can-monitor-save-buffer"
            >
              Save…
            </button>
            {saveOpen ? <SavePopover monitor={monitor} onClose={() => setSaveOpen(false)} /> : null}
          </div>
          <button
            type="button"
            className="can-monitor__tool"
            onClick={() => fileInputRef.current?.click()}
            data-testid="can-monitor-open-log"
          >
            Open log…
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".log,.txt,.csv,text/plain,text/csv"
            hidden
            data-testid="can-monitor-log-input"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void monitor.openLog(file)
              event.target.value = ''
            }}
          />
          {isPage ? null : (
          <button
            type="button"
            className="can-monitor__icon-button"
            onClick={() => setCollapsed((value) => !value)}
            aria-expanded={!collapsed}
            aria-label={collapsed ? 'Expand the bus monitor' : 'Collapse the bus monitor'}
            data-testid="can-monitor-collapse"
          >
            {collapsed ? '▴' : '▾'}
          </button>
          )}
        </div>
      </header>

      {!collapsed || isPage ? (
        <>
          {viewingLog ? <LogPlayer monitor={monitor} /> : null}
          {monitor.logError ? <div className="can-monitor__banner can-monitor__banner--error">{monitor.logError}</div> : null}
          {recording.pendingSave ? (
            <div className="can-monitor__banner can-monitor__banner--record" data-testid="can-monitor-save">
              <span>
                {recording.capped ? 'Recording stopped at its limit' : 'Recording stopped'} ·{' '}
                {number.format(recording.frameCount)} frames.
              </span>
              {filterState.active ? (
                <label className="can-monitor__check">
                  <input
                    type="checkbox"
                    checked={recordingFilteredOnly}
                    onChange={(event) => setRecordingFilteredOnly(event.target.checked)}
                    data-testid="can-monitor-recording-filtered"
                  />
                  <span>Only frames matching the filter</span>
                </label>
              ) : null}
              <button
                type="button"
                style={buttonStyle('primary')}
                onClick={() => monitor.saveRecording({ format: 'candump', filteredOnly: recordingFilteredOnly && filterState.active })}
                data-testid="can-monitor-save-candump"
              >
                Save .log
              </button>
              <button
                type="button"
                style={buttonStyle()}
                onClick={() => monitor.saveRecording({ format: 'csv', filteredOnly: recordingFilteredOnly && filterState.active })}
                data-testid="can-monitor-save-csv"
              >
                Save CSV
              </button>
              <button type="button" style={buttonStyle()} onClick={monitor.discardRecording}>
                Discard
              </button>
            </div>
          ) : null}

          <div className="can-monitor__filters">
            <label className={`can-monitor__field can-monitor__field--ids${filterState.idError ? ' is-invalid' : ''}`}>
              <span>IDs</span>
              <input
                type="text"
                spellCheck={false}
                autoComplete="off"
                placeholder="123, 100-1FF, 1E0A3C00/1FFFFF00, !341"
                value={filterForm.idText}
                onChange={(event) => setFilterForm({ ...filterForm, idText: event.target.value })}
                aria-invalid={filterState.idError !== undefined}
                data-testid="can-monitor-filter-ids"
              />
            </label>
            <label className="can-monitor__field">
              <span>Name</span>
              <input
                type="text"
                spellCheck={false}
                autoComplete="off"
                placeholder="mag*, esc.Status"
                title="Decoded DroneCAN message names. * and ? are wildcards; a plain word matches anywhere in the name."
                value={filterForm.nameText}
                onChange={(event) => setFilterForm({ ...filterForm, nameText: event.target.value })}
                data-testid="can-monitor-filter-name"
              />
            </label>
            <label className={`can-monitor__field${filterState.dataError ? ' is-invalid' : ''}`}>
              <span>Payload</span>
              <input
                type="text"
                spellCheck={false}
                autoComplete="off"
                placeholder="contains 1F 00"
                value={filterForm.dataText}
                onChange={(event) => setFilterForm({ ...filterForm, dataText: event.target.value })}
                aria-invalid={filterState.dataError !== undefined}
                data-testid="can-monitor-filter-data"
              />
            </label>
            <div className="can-monitor__chips" role="group" aria-label="Frame kinds">
              {KIND_CHIPS.map((chip) => (
                <button
                  key={chip.key}
                  type="button"
                  title={chip.title}
                  aria-pressed={filterForm.kinds[chip.key]}
                  className={filterForm.kinds[chip.key] ? 'is-on' : undefined}
                  onClick={() => setKind(chip.key, !filterForm.kinds[chip.key])}
                  data-testid={`can-monitor-kind-${chip.key}`}
                >
                  {chip.label}
                </button>
              ))}
            </div>
            <label className="can-monitor__field can-monitor__field--dir">
              <span>Dir</span>
              <select
                value={filterForm.direction}
                onChange={(event) =>
                  setFilterForm({ ...filterForm, direction: event.target.value as CanMonitorFilterForm['direction'] })
                }
                data-testid="can-monitor-filter-dir"
              >
                <option value="all">All</option>
                <option value="rx">RX</option>
                <option value="tx">TX</option>
              </select>
            </label>
            <span className="can-monitor__count" data-testid="can-monitor-count">
              {filterState.active
                ? `${number.format(shownCount)} of ${number.format(totalCount)}`
                : `${number.format(totalCount)} ${monitor.viewMode === 'stream' ? 'frames' : 'IDs'}`}
            </span>
            {filterState.idError || filterState.dataError ? (
              <p className="can-monitor__filter-error" role="alert" data-testid="can-monitor-filter-error">
                {filterState.idError ?? filterState.dataError}
              </p>
            ) : null}
          </div>

          <div className={`can-monitor__body${monitor.selectedFrame ? ' has-details' : ''}`}>
            {totalCount === 0 ? (
              <p className="can-monitor__empty" data-testid="can-monitor-empty">
                {viewingLog
                  ? 'This log has no frames.'
                  : live
                    ? 'Listening… no frames yet.'
                    : 'Connect to a bus above to see its traffic, or open a candump log.'}
              </p>
            ) : shownCount === 0 ? (
              <p className="can-monitor__empty" data-testid="can-monitor-empty">
                No {monitor.viewMode === 'stream' ? 'frames' : 'IDs'} match the filter.
              </p>
            ) : monitor.viewMode === 'stream' ? (
              <StreamTable monitor={monitor} />
            ) : (
              <ByIdTable monitor={monitor} />
            )}
            {monitor.selectedFrame ? (
              <FrameDetails
                frame={monitor.selectedFrame}
                transfer={monitor.selectedTransfer}
                originMs={monitor.originMs}
                onClose={() => monitor.selectFrame(undefined)}
              />
            ) : null}
          </div>
        </>
      ) : null}
    </section>
  )
}
