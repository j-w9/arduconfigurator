// Read-only MAVLink inspector view: a live, source-aware table of decoded
// message rows grouped by their (systemId, componentId) origin — so the
// autopilot, a gimbal, a companion computer and CAN nodes never collapse into
// one row. Each row shows rate (+ a mini sparkline), bandwidth, count and
// last-seen age, and expands to a live field table (name / value / type) that
// flashes on change and supports per-field + whole-message copy. A source
// selector and type filter narrow the view; Pause freezes it to inspect a
// moment. Presentational — stats come from useMavlinkInspector via App; all
// shaping lives in the mavlink-inspector view-model.

import { useEffect, useRef, useState, type ReactNode } from 'react'

import { Panel, StatusBadge, buttonStyle } from '@arduconfig/ui-kit'

import type { MavlinkMessageStat, MavlinkPlot, MavlinkPlotSpec } from '../hooks/use-mavlink-inspector'
import {
  buildMavlinkFieldRows,
  buildSparklinePoints,
  classifyRowHealth,
  describeMessageRequestOutcome,
  describeSourceHealth,
  disableGuardForMessage,
  filterMavlinkStats,
  filterMavlinkStatsBySource,
  formatBytesPerSec,
  groupMavlinkStatsBySource,
  isRowStale,
  listMavlinkSources,
  messageNameForId,
  messageToJson,
  REQUESTABLE_MESSAGES,
  sortMavlinkStats,
  summarizeMavlinkStats,
  type MavlinkRequestKind,
  type MavlinkSortKey,
  type MavlinkSourceHealth
} from '../view-models/mavlink-inspector'

export interface MavlinkMessageRequest {
  kind: MavlinkRequestKind
  messageId: number
  rateHz: number
}

export interface MavlinkMessageRequestOutcome {
  ok: boolean
  resultLabel: string
}

export interface MavlinkInspectorViewProps {
  stats: readonly MavlinkMessageStat[]
  /** Per-type stats for what this app SENT (outbound), shown as a separate section. */
  sentStats?: readonly MavlinkMessageStat[]
  connected: boolean
  paused: boolean
  onTogglePause: () => void
  onClear: () => void
  /** Issue a SET_MESSAGE_INTERVAL / REQUEST_MESSAGE on the operator's behalf. */
  onRequestMessage?: (request: MavlinkMessageRequest) => Promise<MavlinkMessageRequestOutcome>
  /** Per-source link health (packet loss), keyed by `${systemId}:${componentId}`. */
  sourceHealth?: readonly MavlinkSourceHealth[]
  /** Download the current inspector state (sources/types/loss) as JSON. */
  onExportSnapshot?: () => void
  /** Stream-recording state + controls (bounded buffer → JSON download). */
  recording?: boolean
  recordedCount?: number
  recordingCapped?: boolean
  recordingMax?: number
  onStartRecording?: () => void
  onStopRecording?: () => void
  onDownloadRecording?: () => void
  /** Live field plots and the controls to add/remove them. */
  plots?: readonly MavlinkPlot[]
  onAddPlot?: (spec: MavlinkPlotSpec) => void
  onRemovePlot?: (key: string) => void
  /** Download a plot's sample buffer as CSV (timestamp,value). */
  onExportPlotCsv?: (key: string) => void
  /** Cap on simultaneous plots, surfaced when the limit is reached. */
  maxPlots?: number
  /** The Plot sub-tab -- field plots and predefined graphs on shared charts: a slot. */
  plotWorkspace?: ReactNode
  /** Series on the Plot sub-tab, for its label. */
  plotCount?: number
}

function ageLabel(lastSeenMs: number): string {
  const age = Date.now() - lastSeenMs
  if (age < 1200) {
    return 'now'
  }
  return `${(age / 1000).toFixed(age < 10000 ? 1 : 0)}s ago`
}

function RateSparkline({ history }: { history: readonly number[] }) {
  const points = buildSparklinePoints(history, 64, 16)
  if (!points) {
    return <span className="mavlink-inspector__spark mavlink-inspector__spark--empty" aria-hidden="true" />
  }
  return (
    <svg className="mavlink-inspector__spark" viewBox="0 0 64 16" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

const FLASH_MS = 600

// Outbound field tables have no plot toggle, so no field is ever "plotted".
const NO_PLOTTED_KEYS: Set<string> = new Set()

/** Live field table for one message: name / value / type, flashing a row when
 *  its value changes, with per-field and whole-message copy, plus a per-field
 *  "graph" toggle that adds/removes a live plot. */
function MavlinkFieldTable({
  stat,
  plottedKeys,
  onTogglePlot
}: {
  stat: MavlinkMessageStat
  plottedKeys: Set<string>
  onTogglePlot?: (stat: MavlinkMessageStat, field: string) => void
}) {
  const rows = buildMavlinkFieldRows(stat.lastMessage)
  const previous = useRef(new Map<string, string>())
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const [flashing, setFlashing] = useState<Set<string>>(new Set())
  const [copied, setCopied] = useState<string | null>(null)

  useEffect(() => {
    const changed: string[] = []
    for (const row of rows) {
      const prior = previous.current.get(row.key)
      if (prior !== undefined && prior !== row.value) {
        changed.push(row.key)
      }
      previous.current.set(row.key, row.value)
    }
    if (changed.length === 0) {
      return
    }
    setFlashing((current) => {
      const next = new Set(current)
      changed.forEach((key) => next.add(key))
      return next
    })
    changed.forEach((key) => {
      const existing = timers.current.get(key)
      if (existing) {
        clearTimeout(existing)
      }
      timers.current.set(
        key,
        setTimeout(() => {
          setFlashing((current) => {
            const next = new Set(current)
            next.delete(key)
            return next
          })
          timers.current.delete(key)
        }, FLASH_MS)
      )
    })
    // rows is rebuilt each render; key off the message identity instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stat.lastMessage])

  useEffect(
    () => () => {
      timers.current.forEach((timer) => clearTimeout(timer))
      timers.current.clear()
    },
    []
  )

  const copyValue = (key: string, value: string): void => {
    void navigator.clipboard?.writeText(value).then(
      () => {
        setCopied(key)
        window.setTimeout(() => setCopied((current) => (current === key ? null : current)), 1200)
      },
      () => undefined
    )
  }

  const copyAll = (): void => {
    void navigator.clipboard?.writeText(messageToJson(stat.lastMessage)).then(
      () => {
        setCopied('__all__')
        window.setTimeout(() => setCopied((current) => (current === '__all__' ? null : current)), 1500)
      },
      () => undefined
    )
  }

  return (
    <div className="mavlink-inspector__detail">
      <div className="mavlink-inspector__detail-head">
        <span>{stat.type} fields</span>
        <button
          type="button"
          style={buttonStyle()}
          onClick={copyAll}
          data-testid={`mavlink-copy-${stat.key}`}
        >
          {copied === '__all__' ? 'Copied' : 'Copy JSON'}
        </button>
      </div>
      <div className="mavlink-inspector__fields" data-testid={`mavlink-field-table-${stat.key}`}>
        <div className="mavlink-inspector__field-row mavlink-inspector__field-row--head">
          <span>Field</span>
          <span>Value</span>
          <span>Type</span>
          <span aria-hidden="true" />
        </div>
        {rows.map((row) => {
          const plotKey = `${stat.key}:${row.key}`
          const plotted = plottedKeys.has(plotKey)
          return (
            <div
              key={row.key}
              className={`mavlink-inspector__field-row${flashing.has(row.key) ? ' mavlink-inspector__field-row--flash' : ''}`}
              data-testid={`mavlink-field-row-${stat.key}-${row.key}`}
            >
              <span className="mavlink-inspector__field-name">{row.key}</span>
              <span className="mavlink-inspector__field-value">{row.value}</span>
              <span className="mavlink-inspector__field-type">{row.type}</span>
              <span className="mavlink-inspector__field-actions">
                {onTogglePlot && row.plottable ? (
                  <button
                    type="button"
                    className="mavlink-inspector__field-graph"
                    aria-pressed={plotted}
                    title={plotted ? `Stop plotting ${row.key}` : `Plot ${row.key}`}
                    onClick={() => onTogglePlot(stat, row.key)}
                    data-testid={`mavlink-field-graph-${stat.key}-${row.key}`}
                  >
                    {plotted ? 'graphing' : 'graph'}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="mavlink-inspector__field-copy"
                  title={`Copy ${row.key}`}
                  onClick={() => copyValue(row.key, row.value)}
                  data-testid={`mavlink-field-copy-${stat.key}-${row.key}`}
                >
                  {copied === row.key ? '✓' : 'copy'}
                </button>
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** Operator control to request a message once or set its stream interval. */
function MavlinkRequestControl({
  connected,
  onRequestMessage
}: {
  connected: boolean
  onRequestMessage: (request: MavlinkMessageRequest) => Promise<MavlinkMessageRequestOutcome>
}) {
  const [messageId, setMessageId] = useState(30)
  const [rateHz, setRateHz] = useState(4)
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<string | null>(null)
  // Message id currently armed for a guarded disable (needs a second click).
  const [armedDisableId, setArmedDisableId] = useState<number | null>(null)

  const run = (kind: MavlinkRequestKind): void => {
    if (busy || !connected) {
      return
    }
    if (kind === 'disable') {
      const guard = disableGuardForMessage(messageId)
      if (guard?.level === 'blocked') {
        setArmedDisableId(null)
        setOutcome(guard.message)
        return
      }
      if (guard?.level === 'warn' && armedDisableId !== messageId) {
        // First click on a critical stream: warn and require a confirming click.
        setArmedDisableId(messageId)
        setOutcome(`${guard.message} Click Disable again to confirm.`)
        return
      }
    }
    setArmedDisableId(null)
    setBusy(true)
    setOutcome(null)
    const name = messageNameForId(messageId)
    onRequestMessage({ kind, messageId, rateHz }).then(
      (result) => {
        setOutcome(describeMessageRequestOutcome(kind, name, result))
        setBusy(false)
      },
      (error: unknown) => {
        const detail = error instanceof Error ? error.message : 'request failed'
        setOutcome(`${name} request failed — ${detail}`)
        setBusy(false)
      }
    )
  }

  return (
    <div className="mavlink-inspector__request" data-testid="mavlink-inspector-request">
      <span className="mavlink-inspector__request-title">Request message</span>
      <label className="dronecan-inspector__bus-select">
        <span>Message</span>
        <select
          value={REQUESTABLE_MESSAGES.some((entry) => entry.id === messageId) ? String(messageId) : ''}
          onChange={(event) => {
            if (event.target.value !== '') {
              setMessageId(Number(event.target.value))
            }
          }}
          data-testid="mavlink-request-message"
        >
          <option value="">Custom…</option>
          {REQUESTABLE_MESSAGES.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name} ({entry.id})
            </option>
          ))}
        </select>
      </label>
      <label className="dronecan-inspector__bus-select">
        <span>ID</span>
        <input
          type="number"
          min={0}
          className="mavlink-inspector__request-id"
          value={messageId}
          onChange={(event) => setMessageId(Math.max(0, Math.round(Number(event.target.value) || 0)))}
          data-testid="mavlink-request-id"
        />
      </label>
      <label className="dronecan-inspector__bus-select">
        <span>Rate (Hz)</span>
        <input
          type="number"
          min={0}
          max={200}
          className="mavlink-inspector__request-rate"
          value={rateHz}
          onChange={(event) => setRateHz(Math.max(0, Number(event.target.value) || 0))}
          data-testid="mavlink-request-rate"
        />
      </label>
      <button
        type="button"
        style={buttonStyle()}
        disabled={busy || !connected}
        onClick={() => run('once')}
        data-testid="mavlink-request-once"
      >
        Request once
      </button>
      <button
        type="button"
        style={buttonStyle('primary')}
        disabled={busy || !connected}
        onClick={() => run('stream')}
        data-testid="mavlink-request-stream"
      >
        Set stream
      </button>
      <button
        type="button"
        style={buttonStyle()}
        disabled={busy || !connected}
        onClick={() => run('disable')}
        data-testid="mavlink-request-disable"
      >
        {armedDisableId === messageId ? 'Disable anyway' : 'Disable'}
      </button>
      {outcome ? (
        <p className="mavlink-inspector__request-result" data-testid="mavlink-request-result" role="status">
          {outcome}
        </p>
      ) : null}
    </div>
  )
}

export function MavlinkInspectorView({
  stats,
  sentStats = [],
  connected,
  paused,
  onTogglePause,
  onClear,
  onRequestMessage,
  sourceHealth = [],
  onExportSnapshot,
  recording = false,
  recordedCount = 0,
  recordingCapped = false,
  recordingMax,
  onStartRecording,
  onStopRecording,
  onDownloadRecording,
  plots = [],
  onAddPlot,
  onRemovePlot,
  plotWorkspace,
  plotCount = 0,
  maxPlots
}: MavlinkInspectorViewProps) {
  const [expanded, setExpanded] = useState<string | null>(null)
  // Outbound rows expand independently of inbound: a type can appear in both
  // sections (e.g. HEARTBEAT is sent and received), so they can't share state.
  const [expandedSent, setExpandedSent] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [sortKey, setSortKey] = useState<MavlinkSortKey>('name')
  const [source, setSource] = useState('')

  const summary = summarizeMavlinkStats(stats)
  const sources = listMavlinkSources(stats)
  // A previously-selected source can disappear (link churn); fall back to all.
  const activeSource = sources.some((entry) => entry.id === source) ? source : ''
  const visible = sortMavlinkStats(
    filterMavlinkStats(filterMavlinkStatsBySource(stats, activeSource), filter),
    sortKey
  )
  const groups = groupMavlinkStatsBySource(visible)
  const matched = filter.trim().length > 0 || activeSource.length > 0
  const healthById = new Map(sourceHealth.map((entry) => [entry.id, entry]))
  // Single clock read drives every row's stale/age check this render; the hook
  // re-flushes (and so re-renders) on a fixed interval, so a stream that stops
  // visibly tips to "stale" rather than freezing its last rate.
  const now = Date.now()

  const plottedKeys = new Set(plots.map((plot) => plot.key))
  const atPlotLimit = typeof maxPlots === 'number' && plots.length >= maxPlots
  const togglePlot = onAddPlot
    ? (stat: MavlinkMessageStat, field: string): void => {
        const key = `${stat.key}:${field}`
        if (plottedKeys.has(key)) {
          onRemovePlot?.(key)
          return
        }
        if (atPlotLimit) {
          return
        }
        onAddPlot({
          key,
          systemId: stat.systemId,
          componentId: stat.componentId,
          type: stat.type,
          field
        })
      }
    : undefined

  const [page, setPage] = useState<'messages' | 'plot'>('messages')

  return (
    <section className="grid one-up mavlink-inspector-tab" id="setup-panel-mavlink-inspector">
      <Panel
        title="MAVLink Inspector"
      >
        <div className="telemetry-stack" data-testid="mavlink-inspector">
          {plotWorkspace ? (
            // Messages (the live table) and Plot (charts of fields and predefined graphs), as on the CAN tab.
            <div className="tab-strip can-subtabs" role="tablist" aria-label="Inspector views" data-testid="mavlink-subtabs">
              {(['messages', 'plot'] as const).map((id) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={page === id}
                  className={`tab-strip__tab${page === id ? ' is-active' : ''}`}
                  onClick={() => setPage(id)}
                  data-testid={`mavlink-subtab-${id}`}
                >
                  <span className="tab-strip__tab-title">
                    {id === 'messages' ? 'Messages' : plotCount > 0 ? `Plot (${plotCount})` : 'Plot'}
                  </span>
                </button>
              ))}
            </div>
          ) : null}

          {/* The live summary belongs to Messages; Plot has its own toolbar. */}
          {!plotWorkspace || page === 'messages' ? (
            <>
              <div className="telemetry-header">
                <div>
                  <h3>Live messages</h3>
                  <p data-testid="mavlink-inspector-summary">
                    {summary.sourceCount} source{summary.sourceCount === 1 ? '' : 's'} ·{' '}
                    {summary.typeCount} row{summary.typeCount === 1 ? '' : 's'} ·{' '}
                    {summary.totalRateHz.toFixed(0)} msg/s · {formatBytesPerSec(summary.totalBytesPerSec)} ·{' '}
                    {summary.totalCount} total
                  </p>
                </div>
                <StatusBadge tone={paused ? 'warning' : connected ? 'success' : 'neutral'}>
                  {paused ? 'paused' : connected ? 'live' : 'no link'}
                </StatusBadge>
              </div>
            </>
          ) : null}


          {plotWorkspace && page === 'plot' ? (
            plotWorkspace
          ) : (
            <>
            <div className="mavlink-inspector__controls">
              <input
                type="search"
                className="mavlink-inspector__filter"
                placeholder="Filter message types…"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                data-testid="mavlink-inspector-filter"
              />
              <label className="dronecan-inspector__bus-select">
                <span>Source</span>
                <select
                  value={activeSource}
                  onChange={(event) => setSource(event.target.value)}
                  data-testid="mavlink-inspector-source"
                >
                  <option value="">All sources</option>
                  {sources.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="dronecan-inspector__bus-select">
                <span>Sort</span>
                <select
                  value={sortKey}
                  onChange={(event) => setSortKey(event.target.value as MavlinkSortKey)}
                  data-testid="mavlink-inspector-sort"
                >
                  <option value="name">Name</option>
                  <option value="rate">Rate</option>
                  <option value="bandwidth">Bandwidth</option>
                  <option value="recent">Last seen</option>
                </select>
              </label>
              {/* The same toolbar grammar as CAN ▸ Frames: red Pause, green Resume,
                  a red-dot Record. Recording and export sit on this row too, so
                  the table is not pushed down by a strip of three buttons. */}
              <button
                type="button"
                className={`can-monitor__tool ${paused ? 'can-monitor__tool--resume' : 'can-monitor__tool--pause'}`}
                onClick={onTogglePause}
                aria-pressed={paused}
                data-testid="mavlink-inspector-pause"
              >
                {paused ? 'Resume' : 'Pause'}
              </button>
              <button type="button" className="can-monitor__tool" onClick={onClear} data-testid="mavlink-inspector-clear">
                Clear
              </button>
              {onExportSnapshot || onStartRecording ? (
                <span className="mavlink-inspector__export" data-testid="mavlink-inspector-export">
                  <span className="plot-workspace__divider" aria-hidden="true" />
                  {onStartRecording && onStopRecording ? (
                    <button
                      type="button"
                      className={`can-monitor__tool can-monitor__tool--record${recording ? ' is-recording' : ''}`}
                      onClick={recording ? onStopRecording : onStartRecording}
                      aria-pressed={recording}
                      data-testid="mavlink-record-toggle"
                    >
                      <span className="can-monitor__rec-dot" aria-hidden="true" />
                      {recording ? 'Stop recording' : 'Record stream'}
                    </button>
                  ) : null}
                  {onDownloadRecording ? (
                    <button
                      type="button"
                      className="can-monitor__tool"
                      onClick={onDownloadRecording}
                      disabled={recording || recordedCount === 0}
                      data-testid="mavlink-record-download"
                    >
                      Download capture
                    </button>
                  ) : null}
                  {onExportSnapshot ? (
                    <button
                      type="button"
                      className="can-monitor__tool"
                      onClick={onExportSnapshot}
                      disabled={stats.length === 0}
                      title="The sources, message types, rates and loss as they stand, as JSON"
                      data-testid="mavlink-export-snapshot"
                    >
                      Export JSON
                    </button>
                  ) : null}
                  <span className="mavlink-inspector__record-meta" data-testid="mavlink-record-status" role="status">
                    {recording ? 'recording · ' : ''}
                    {recording || recordedCount > 0 ? `${recordedCount} msg` : ''}
                    {recording && typeof recordingMax === 'number' ? ` of ${recordingMax}` : ''}
                    {recordingCapped ? ' · capped' : ''}
                  </span>
                </span>
              ) : null}
            </div>

            {onRequestMessage ? (
              <MavlinkRequestControl connected={connected} onRequestMessage={onRequestMessage} />
            ) : null}

            {!connected && stats.length === 0 ? (
              <p className="telemetry-note">Connect to a vehicle to see the live MAVLink message stream.</p>
            ) : groups.length === 0 ? (
              <p className="telemetry-note">No messages {matched ? 'match the filter' : 'received yet'}.</p>
            ) : (
              <div className="mavlink-inspector__table" data-testid="mavlink-inspector-table">
                {groups.map((group) => {
                  const health = healthById.get(group.id)
                  const staleCount = group.stats.reduce(
                    (count, stat) => count + (isRowStale(stat.lastSeenMs, now) ? 1 : 0),
                    0
                  )
                  const lossPct = health?.lossPct ?? 0
                  const healthTone = lossPct >= 5 || staleCount > 0 ? 'warn' : 'ok'
                  return (
                  <div
                    key={group.id}
                    className="mavlink-inspector__group"
                    data-testid={`mavlink-source-${group.id}`}
                  >
                    <div className="mavlink-inspector__source-head">
                      <span className="mavlink-inspector__source-label">{group.label}</span>
                      <span className="mavlink-inspector__source-meta">
                        {group.rateHz.toFixed(0)} msg/s · {formatBytesPerSec(group.bytesPerSec)}
                      </span>
                      <span
                        className={`mavlink-inspector__source-health mavlink-inspector__source-health--${healthTone}`}
                        data-testid={`mavlink-source-health-${group.id}`}
                        title={
                          health
                            ? `${health.dropped} dropped of ${health.received + health.dropped} frames`
                            : 'No sequence data yet'
                        }
                      >
                        {describeSourceHealth(lossPct, staleCount)}
                      </span>
                    </div>
                    <div className="mavlink-inspector__row mavlink-inspector__row--head">
                      <span>Message</span>
                      <span>Rate</span>
                      <span>Trend</span>
                      <span>Bandwidth</span>
                      <span>Count</span>
                      <span>Last</span>
                    </div>
                    {group.stats.map((stat) => {
                      const isOpen = expanded === stat.key
                      const rowHealth = classifyRowHealth(stat.lastSeenMs, now, stat.rateHistory, stat.rateHz)
                      return (
                        <div
                          key={stat.key}
                          className={`mavlink-inspector__entry mavlink-inspector__entry--${rowHealth}`}
                          data-testid={`mavlink-row-${stat.key}`}
                          data-health={rowHealth}
                        >
                          <button
                            type="button"
                            className="mavlink-inspector__row"
                            onClick={() => setExpanded(isOpen ? null : stat.key)}
                            aria-expanded={isOpen}
                          >
                            <span className="mavlink-inspector__type">{stat.type}</span>
                            <span>{stat.rateHz.toFixed(1)} Hz</span>
                            <RateSparkline history={stat.rateHistory} />
                            <span>{formatBytesPerSec(stat.bytesPerSec)}</span>
                            <span>{stat.count}</span>
                            <span className="mavlink-inspector__last">
                              {ageLabel(stat.lastSeenMs)}
                              {rowHealth !== 'ok' ? (
                                <span
                                  className={`mavlink-inspector__tone mavlink-inspector__tone--${rowHealth}`}
                                  data-testid={`mavlink-row-tone-${stat.key}`}
                                >
                                  {rowHealth}
                                </span>
                              ) : null}
                            </span>
                          </button>
                          {isOpen ? (
                            <MavlinkFieldTable stat={stat} plottedKeys={plottedKeys} onTogglePlot={togglePlot} />
                          ) : null}
                        </div>
                      )
                    })}
                  </div>
                  )
                })}
              </div>
            )}

            {sentStats.length > 0 ? (
              <div className="mavlink-inspector__sent" data-testid="mavlink-inspector-sent">
                <div className="mavlink-inspector__sent-head">
                  <span className="mavlink-inspector__sent-title">Sent (outbound)</span>
                  <span className="mavlink-inspector__sent-meta">
                    {sentStats.length} type{sentStats.length === 1 ? '' : 's'}
                  </span>
                </div>
                <div className="mavlink-inspector__sent-row mavlink-inspector__sent-row--head">
                  <span>Message</span>
                  <span>Rate</span>
                  <span>Count</span>
                  <span>Last sent</span>
                </div>
                {[...sentStats]
                  .sort((left, right) => right.count - left.count)
                  .map((stat) => {
                    const isOpen = expandedSent === stat.key
                    return (
                      <div
                        key={stat.key}
                        className="mavlink-inspector__entry"
                        data-testid={`mavlink-sent-row-${stat.type}`}
                      >
                        <button
                          type="button"
                          className="mavlink-inspector__sent-row"
                          onClick={() => setExpandedSent(isOpen ? null : stat.key)}
                          aria-expanded={isOpen}
                        >
                          <span className="mavlink-inspector__type">{stat.type}</span>
                          <span>{stat.rateHz >= 0.05 ? `${stat.rateHz.toFixed(1)} Hz` : '—'}</span>
                          <span>{stat.count}</span>
                          <span className="mavlink-inspector__last">{ageLabel(stat.lastSeenMs)}</span>
                        </button>
                        {isOpen ? <MavlinkFieldTable stat={stat} plottedKeys={NO_PLOTTED_KEYS} /> : null}
                      </div>
                    )
                  })}
              </div>
            ) : null}
            </>
          )}
        </div>
      </Panel>
    </section>
  )
}
