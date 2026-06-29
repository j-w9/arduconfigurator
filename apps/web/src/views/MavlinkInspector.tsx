// Read-only MAVLink inspector view: a live, source-aware table of decoded
// message rows grouped by their (systemId, componentId) origin — so the
// autopilot, a gimbal, a companion computer and CAN nodes never collapse into
// one row. Each row shows rate (+ a mini sparkline), bandwidth, count and
// last-seen age, and expands to a live field table (name / value / type) that
// flashes on change and supports per-field + whole-message copy. A source
// selector and type filter narrow the view; Pause freezes it to inspect a
// moment. Presentational — stats come from useMavlinkInspector via App; all
// shaping lives in the mavlink-inspector view-model.

import { useEffect, useRef, useState } from 'react'

import { Panel, StatusBadge, buttonStyle } from '@arduconfig/ui-kit'

import type { MavlinkMessageStat } from '../hooks/use-mavlink-inspector'
import {
  buildMavlinkFieldRows,
  buildSparklinePoints,
  filterMavlinkStats,
  filterMavlinkStatsBySource,
  formatBytesPerSec,
  groupMavlinkStatsBySource,
  listMavlinkSources,
  messageToJson,
  sortMavlinkStats,
  summarizeMavlinkStats,
  type MavlinkSortKey
} from '../view-models/mavlink-inspector'

export interface MavlinkInspectorViewProps {
  stats: readonly MavlinkMessageStat[]
  connected: boolean
  paused: boolean
  onTogglePause: () => void
  onClear: () => void
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

/** Live field table for one message: name / value / type, flashing a row when
 *  its value changes, with per-field and whole-message copy. */
function MavlinkFieldTable({ stat }: { stat: MavlinkMessageStat }) {
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
        {rows.map((row) => (
          <div
            key={row.key}
            className={`mavlink-inspector__field-row${flashing.has(row.key) ? ' mavlink-inspector__field-row--flash' : ''}`}
            data-testid={`mavlink-field-row-${stat.key}-${row.key}`}
          >
            <span className="mavlink-inspector__field-name">{row.key}</span>
            <span className="mavlink-inspector__field-value">{row.value}</span>
            <span className="mavlink-inspector__field-type">{row.type}</span>
            <button
              type="button"
              className="mavlink-inspector__field-copy"
              title={`Copy ${row.key}`}
              onClick={() => copyValue(row.key, row.value)}
              data-testid={`mavlink-field-copy-${stat.key}-${row.key}`}
            >
              {copied === row.key ? '✓' : 'copy'}
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

export function MavlinkInspectorView({ stats, connected, paused, onTogglePause, onClear }: MavlinkInspectorViewProps) {
  const [expanded, setExpanded] = useState<string | null>(null)
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

  return (
    <section className="grid one-up" id="setup-panel-mavlink-inspector">
      <Panel
        title="MAVLink Inspector"
        subtitle="Live decoded MAVLink stream — per-source rate, bandwidth, and last value per message. Read-only."
      >
        <div className="telemetry-stack" data-testid="mavlink-inspector">
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
            <button
              type="button"
              style={buttonStyle(paused ? 'primary' : 'secondary')}
              onClick={onTogglePause}
              aria-pressed={paused}
              data-testid="mavlink-inspector-pause"
            >
              {paused ? 'Resume' : 'Pause'}
            </button>
            <button type="button" style={buttonStyle()} onClick={onClear} data-testid="mavlink-inspector-clear">
              Clear
            </button>
          </div>

          {!connected && stats.length === 0 ? (
            <p className="telemetry-note">Connect to a vehicle to see the live MAVLink message stream.</p>
          ) : groups.length === 0 ? (
            <p className="telemetry-note">No messages {matched ? 'match the filter' : 'received yet'}.</p>
          ) : (
            <div className="mavlink-inspector__table" data-testid="mavlink-inspector-table">
              {groups.map((group) => (
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
                    return (
                      <div
                        key={stat.key}
                        className="mavlink-inspector__entry"
                        data-testid={`mavlink-row-${stat.key}`}
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
                          <span>{ageLabel(stat.lastSeenMs)}</span>
                        </button>
                        {isOpen ? <MavlinkFieldTable stat={stat} /> : null}
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
          )}
        </div>
      </Panel>
    </section>
  )
}
