// Read-only MAVLink inspector view: a live table of decoded message types with
// their rate, count, and last-seen age; each row expands to the last decoded
// field values. Presentational — stats come from useMavlinkInspector via App.

import { useState } from 'react'

import { Panel, StatusBadge, buttonStyle } from '@arduconfig/ui-kit'

import type { MavlinkMessageStat } from '../hooks/use-mavlink-inspector'

export interface MavlinkInspectorViewProps {
  stats: readonly MavlinkMessageStat[]
  connected: boolean
  onClear: () => void
}

function ageLabel(lastSeenMs: number): string {
  const age = Date.now() - lastSeenMs
  if (age < 1200) {
    return 'now'
  }
  return `${(age / 1000).toFixed(age < 10000 ? 1 : 0)}s ago`
}

function formatFields(message: Record<string, unknown>): string {
  const { type: _type, ...rest } = message
  try {
    return JSON.stringify(rest, (_key, value) => (typeof value === 'bigint' ? value.toString() : value), 2)
  } catch {
    return String(rest)
  }
}

export function MavlinkInspectorView({ stats, connected, onClear }: MavlinkInspectorViewProps) {
  const [expanded, setExpanded] = useState<string | null>(null)
  const [filter, setFilter] = useState('')

  const totalRate = stats.reduce((sum, stat) => sum + stat.rateHz, 0)
  const needle = filter.trim().toLowerCase()
  const filtered = needle ? stats.filter((stat) => stat.type.toLowerCase().includes(needle)) : stats

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
              <p>
                {stats.length} message type{stats.length === 1 ? '' : 's'} · {totalRate.toFixed(0)} msg/s total
              </p>
            </div>
            <StatusBadge tone={connected ? 'success' : 'neutral'}>{connected ? 'live' : 'no link'}</StatusBadge>
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
            <button type="button" style={buttonStyle()} onClick={onClear} data-testid="mavlink-inspector-clear">
              Clear
            </button>
          </div>

          {!connected && stats.length === 0 ? (
            <p className="telemetry-note">Connect to a vehicle to see the live MAVLink message stream.</p>
          ) : filtered.length === 0 ? (
            <p className="telemetry-note">No messages {needle ? 'match the filter' : 'received yet'}.</p>
          ) : (
            <div className="mavlink-inspector__table" data-testid="mavlink-inspector-table">
              <div className="mavlink-inspector__row mavlink-inspector__row--head">
                <span>Message</span>
                <span>Rate</span>
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
                      <span>{stat.count}</span>
                      <span>{ageLabel(stat.lastSeenMs)}</span>
                    </button>
                    {isOpen ? <pre className="mavlink-inspector__fields">{formatFields(stat.lastMessage)}</pre> : null}
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
