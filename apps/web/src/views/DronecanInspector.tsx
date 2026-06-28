// Read-only DroneCAN bus inspector: starts the CAN_FORWARD tunnel and shows live
// node traffic — node id, name, health, mode, uptime, last-seen — plus the
// frames-received heartbeat. Distinct from the CAN tab (which edits per-node
// params); this is observe-only. Presentational — state + handlers from App.

import { Panel, StatusBadge, buttonStyle } from '@arduconfig/ui-kit'
import type { CanBusState, DronecanInspectedNode } from '@arduconfig/ardupilot-core'

export interface DronecanInspectorViewProps {
  status: CanBusState['status']
  bus: number | undefined
  framesReceived: number
  error: string | undefined
  nodes: readonly DronecanInspectedNode[]
  connected: boolean
  busy: boolean
  onStart: () => void
  onStop: () => void
}

function ageLabel(lastSeenAtMs: number): string {
  const age = Date.now() - lastSeenAtMs
  if (age < 1500) {
    return 'now'
  }
  return `${(age / 1000).toFixed(age < 10000 ? 1 : 0)}s ago`
}

function uptimeLabel(uptimeSec: number | undefined): string {
  if (uptimeSec === undefined) {
    return '—'
  }
  if (uptimeSec < 60) {
    return `${uptimeSec}s`
  }
  const minutes = Math.floor(uptimeSec / 60)
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

export function DronecanInspectorView(props: DronecanInspectorViewProps) {
  const { status, bus, framesReceived, error, nodes, connected, busy, onStart, onStop } = props
  const active = status === 'active'
  const statusBadge = active
    ? `CAN${bus ?? 0} live`
    : status === 'requesting'
      ? 'connecting'
      : status === 'stopping'
        ? 'stopping'
        : status === 'error'
          ? 'error'
          : 'idle'

  return (
    <section className="grid one-up" id="setup-panel-dronecan-inspector">
      <Panel
        title="DroneCAN Inspector"
        subtitle="Live DroneCAN bus traffic over the CAN_FORWARD tunnel — nodes, health, and rate. Read-only."
      >
        <div className="telemetry-stack" data-testid="dronecan-inspector">
          <div className="telemetry-header">
            <div>
              <h3>Bus traffic</h3>
              <p>
                {nodes.length} node{nodes.length === 1 ? '' : 's'} · {framesReceived} frame{framesReceived === 1 ? '' : 's'} this session
              </p>
            </div>
            <StatusBadge tone={active ? 'success' : status === 'error' ? 'danger' : 'neutral'}>{statusBadge}</StatusBadge>
          </div>

          {error ? (
            <div className="parameter-review__notice">
              <StatusBadge tone="danger">error</StatusBadge>
              <p>{error}</p>
            </div>
          ) : null}

          <div className="mavlink-inspector__controls">
            {active || status === 'stopping' ? (
              <button type="button" style={buttonStyle()} onClick={onStop} disabled={busy} data-testid="dronecan-inspector-stop">
                {status === 'stopping' ? 'Stopping…' : 'Stop bus'}
              </button>
            ) : (
              <button
                type="button"
                style={buttonStyle('primary')}
                onClick={onStart}
                disabled={busy || !connected || status === 'requesting'}
                title={!connected ? 'Connect to a vehicle first.' : undefined}
                data-testid="dronecan-inspector-start"
              >
                {status === 'requesting' ? 'Starting…' : 'Start bus inspection'}
              </button>
            )}
          </div>

          {!connected ? (
            <p className="telemetry-note">Connect to a vehicle to inspect the DroneCAN bus.</p>
          ) : !active && nodes.length === 0 ? (
            <p className="telemetry-note">
              Start the bus to discover DroneCAN nodes over the CAN_FORWARD tunnel. Per-node parameter editing lives on the
              CAN tab.
            </p>
          ) : nodes.length === 0 ? (
            <p className="telemetry-note">
              Bus is live{framesReceived > 0 ? ` (${framesReceived} frames seen)` : ''} — waiting for node status broadcasts…
            </p>
          ) : (
            <div className="mavlink-inspector__table" data-testid="dronecan-inspector-table">
              <div className="dronecan-inspector__row dronecan-inspector__row--head">
                <span>Node</span>
                <span>Name</span>
                <span>Health</span>
                <span>Mode</span>
                <span>Uptime</span>
                <span>Last</span>
              </div>
              {[...nodes]
                .sort((left, right) => left.nodeId - right.nodeId)
                .map((node) => (
                  <div key={node.nodeId} className="dronecan-inspector__row" data-testid={`dronecan-node-${node.nodeId}`}>
                    <span className="mavlink-inspector__type">#{node.nodeId}</span>
                    <span>{node.name ?? '—'}</span>
                    <span>{node.health}</span>
                    <span>{node.mode}</span>
                    <span>{uptimeLabel(node.uptimeSec)}</span>
                    <span>{ageLabel(node.lastSeenAtMs)}</span>
                  </div>
                ))}
            </div>
          )}
        </div>
      </Panel>
    </section>
  )
}
