// Read-only MAVLink inspector view: a live table of decoded message types with
// their rate (+ a mini rate sparkline), count, and last-seen age; each row
// expands to the last decoded field values with a copy-to-clipboard affordance.
// Pause freezes the table to inspect a moment. Presentational — stats come from
// useMavlinkInspector via App; all shaping is in the mavlink-inspector view-model.

import { useState } from 'react'

import { Panel, StatusBadge, buttonStyle } from '@arduconfig/ui-kit'

import type { MavlinkMessageStat } from '../hooks/use-mavlink-inspector'
import {
  buildMavlinkFieldRows,
  buildSparklinePoints,
  filterMavlinkStats,
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

export function MavlinkInspectorView({ stats, connected, paused, onTogglePause, onClear }: MavlinkInspectorViewProps) {
  const [expanded, setExpanded] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [sortKey, setSortKey] = useState<MavlinkSortKey>('name')
  const [copiedType, setCopiedType] = useState<string | null>(null)

  const summary = summarizeMavlinkStats(stats)
  const filtered = sortMavlinkStats(filterMavlinkStats(stats, filter), sortKey)
  const matched = filter.trim().length > 0

  const copyFields = (stat: MavlinkMessageStat): void => {
    void navigator.clipboard?.writeText(messageToJson(stat.lastMessage)).then(
      () => {
        setCopiedType(stat.type)
        window.setTimeout(() => setCopiedType((current) => (current === stat.type ? null : current)), 1500)
      },
      () => undefined
    )
  }

  return (
    <section className="grid one-up" id="setup-panel-mavlink-inspector">
      <Panel
        title="MAVLink Inspector"
        subtitle="Live decoded MAVLink message stream — rate, count, and last value per type. Read-only."
      >
        <div className="telemetry-stack" data-testid="mavlink-inspector">
          <div className="telemetry-header">
            <div>
              <h3>Live messages</h3>
              <p data-testid="mavlink-inspector-summary">
                {summary.typeCount} message type{summary.typeCount === 1 ? '' : 's'} ·{' '}
                {summary.totalRateHz.toFixed(0)} msg/s · {summary.totalCount} total
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
              <span>Sort</span>
              <select
                value={sortKey}
                onChange={(event) => setSortKey(event.target.value as MavlinkSortKey)}
                data-testid="mavlink-inspector-sort"
              >
                <option value="name">Name</option>
                <option value="rate">Rate</option>
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
          ) : filtered.length === 0 ? (
            <p className="telemetry-note">No messages {matched ? 'match the filter' : 'received yet'}.</p>
          ) : (
            <div className="mavlink-inspector__table" data-testid="mavlink-inspector-table">
              <div className="mavlink-inspector__row mavlink-inspector__row--head">
                <span>Message</span>
                <span>Rate</span>
                <span>Trend</span>
                <span>Count</span>
                <span>Last</span>
              </div>
              {filtered.map((stat) => {
                const isOpen = expanded === stat.type
                return (
                  <div key={stat.type} className="mavlink-inspector__entry" data-testid={`mavlink-row-${stat.type}`}>
                    <button
                      type="button"
                      className="mavlink-inspector__row"
                      onClick={() => setExpanded(isOpen ? null : stat.type)}
                      aria-expanded={isOpen}
                    >
                      <span className="mavlink-inspector__type">{stat.type}</span>
                      <span>{stat.rateHz.toFixed(1)} Hz</span>
                      <RateSparkline history={stat.rateHistory} />
                      <span>{stat.count}</span>
                      <span>{ageLabel(stat.lastSeenMs)}</span>
                    </button>
                    {isOpen ? (
                      <div className="mavlink-inspector__detail">
                        <div className="mavlink-inspector__detail-head">
                          <span>{stat.type} fields</span>
                          <button
                            type="button"
                            style={buttonStyle()}
                            onClick={() => copyFields(stat)}
                            data-testid={`mavlink-copy-${stat.type}`}
                          >
                            {copiedType === stat.type ? 'Copied' : 'Copy JSON'}
                          </button>
                        </div>
                        <dl className="mavlink-inspector__fields">
                          {buildMavlinkFieldRows(stat.lastMessage).map((row) => (
                            <div key={row.key} className="mavlink-inspector__field-row">
                              <dt>{row.key}</dt>
                              <dd>{row.value}</dd>
                            </div>
                          ))}
                        </dl>
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </Panel>
    </section>
  )
}
