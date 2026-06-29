// DroneCAN bus inspector (expert-only): starts the CAN_FORWARD tunnel and shows
// live node traffic — node id, name, health, mode, uptime, last-seen — plus bus
// stats (frames/s, unique nodes) and an expandable per-node detail panel. Beyond
// the read-only NodeStatus view it brings Mission Planner-style per-node DroneCAN
// management over MAVLink CAN forwarding: read/edit/save a node's parameters,
// restart a node (uavcan.protocol.RestartNode), and observe ESC telemetry
// (uavcan.equipment.esc.Status). Presentational — state + handlers come from App.
// Distinct from (and does not touch) the normal CAN tab.

import { useState } from 'react'

import { Panel, StatusBadge, buttonStyle } from '@arduconfig/ui-kit'
import type {
  CanBusState,
  DronecanEscTelemetry,
  DronecanFirmwareUpdateState,
  DronecanInspectedNode,
  DronecanParamValueState
} from '@arduconfig/ardupilot-core'

import {
  buildDronecanEscRows,
  buildDronecanFirmwareUpdateView,
  buildDronecanNodeDetailRows,
  buildDronecanParamRows,
  summarizeDronecanNodes
} from '../view-models/dronecan-inspector'
import { buildCanBusStagedChanges } from '../view-models/can-bus'

export interface DronecanInspectorViewProps {
  status: CanBusState['status']
  bus: number | undefined
  framesReceived: number
  framesPerSec: number
  error: string | undefined
  nodes: readonly DronecanInspectedNode[]
  escTelemetry: readonly DronecanEscTelemetry[]
  /** The single in-flight (or just-finished) node firmware update, if any. */
  firmwareUpdate: DronecanFirmwareUpdateState | undefined
  connected: boolean
  busy: boolean
  onStart: (bus: number) => void
  onStop: () => void
  /** Re-walk a node's full parameter table from index 0. */
  onFetchParams: (nodeId: number) => void
  /** Write the staged params to a node, then persist to flash once acked. */
  onApplyAndSave: (nodeId: number, writes: Array<{ name: string; value: DronecanParamValueState }>) => void
  /** Restart a node via uavcan.protocol.RestartNode (with a confirm step). */
  onRestartNode: (nodeId: number) => void
  /** Begin a firmware update on a node (GCS serves the selected .bin image). */
  onStartFirmwareUpdate: (nodeId: number, fileName: string, image: Uint8Array) => void
  /** Cancel an in-flight update, or dismiss a finished one. */
  onCancelFirmwareUpdate: () => void
}

/** Per-node firmware-update affordance: file picker, prominent brick-risk
 *  confirmation, progress bar, and clear success/error. Only one update runs at
 *  a time — all the node's other actions are disabled while one is underway. */
function NodeFirmwareUpdate(props: {
  nodeId: number
  view: ReturnType<typeof buildDronecanFirmwareUpdateView>
  /** True when ANY update (this node or another) is occupying the bus. */
  anotherUpdateActive: boolean
  busy: boolean
  onStart: (nodeId: number, fileName: string, image: Uint8Array) => void
  onCancel: () => void
}) {
  const { nodeId, view, anotherUpdateActive, busy, onStart, onCancel } = props
  const [file, setFile] = useState<{ name: string; bytes: Uint8Array } | null>(null)
  const [acknowledged, setAcknowledged] = useState(false)
  const [readError, setReadError] = useState<string | null>(null)

  // This node's own update (progress / result) takes over the section.
  if (view && view.nodeId === nodeId) {
    return (
      <div className="dronecan-inspector__fwupdate" data-testid={`dronecan-fwupdate-${nodeId}`}>
        <div className="dronecan-inspector__fwupdate-head">
          <span>Firmware update — {view.fileName}</span>
          <StatusBadge tone={view.tone}>{view.statusLabel}</StatusBadge>
        </div>
        <div
          className="dronecan-inspector__fwupdate-bar"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={view.percent}
          data-testid={`dronecan-fwupdate-progress-${nodeId}`}
        >
          <div
            className={`dronecan-inspector__fwupdate-fill is-${view.tone}`}
            style={{ width: `${view.percent}%` }}
          />
        </div>
        <p className="dronecan-inspector__fwupdate-bytes">
          {view.bytesLabel} · {view.percent}%
        </p>
        {view.status === 'completed' ? (
          <p className="dronecan-inspector__fwupdate-note" data-testid={`dronecan-fwupdate-done-${nodeId}`}>
            Image transferred. The node is rebooting into the new firmware and will reappear on the bus.
          </p>
        ) : null}
        {view.error ? (
          <p className="dronecan-inspector__fwupdate-error" data-testid={`dronecan-fwupdate-error-${nodeId}`}>
            {view.error}
          </p>
        ) : null}
        <button
          type="button"
          style={buttonStyle()}
          onClick={onCancel}
          data-testid={`dronecan-fwupdate-cancel-${nodeId}`}
        >
          {view.terminal ? 'Dismiss' : 'Cancel update'}
        </button>
      </div>
    )
  }

  const disabled = busy || anotherUpdateActive

  const pickFile = (selected: File | undefined): void => {
    setAcknowledged(false)
    setReadError(null)
    if (!selected) {
      setFile(null)
      return
    }
    selected
      .arrayBuffer()
      .then((buffer) => setFile({ name: selected.name, bytes: new Uint8Array(buffer) }))
      .catch(() => {
        setFile(null)
        setReadError('Could not read the selected file.')
      })
  }

  return (
    <div className="dronecan-inspector__fwupdate" data-testid={`dronecan-fwupdate-${nodeId}`}>
      <div className="dronecan-inspector__fwupdate-head">
        <span>Firmware update</span>
      </div>
      {anotherUpdateActive ? (
        <p className="telemetry-note">Another node is updating — wait for it to finish.</p>
      ) : null}
      <label className="dronecan-inspector__fwupdate-file">
        <span>Image (.bin)</span>
        <input
          type="file"
          accept=".bin,application/octet-stream"
          disabled={disabled}
          onChange={(event) => pickFile(event.target.files?.[0])}
          data-testid={`dronecan-fwupdate-file-${nodeId}`}
        />
      </label>
      {readError ? <p className="dronecan-inspector__fwupdate-error">{readError}</p> : null}
      {file ? (
        <>
          <p className="dronecan-inspector__fwupdate-selected">
            {file.name} · {(file.bytes.length / 1024).toFixed(1)} KiB
          </p>
          <label className="dronecan-inspector__fwupdate-ack">
            <input
              type="checkbox"
              checked={acknowledged}
              disabled={disabled}
              onChange={(event) => setAcknowledged(event.target.checked)}
              data-testid={`dronecan-fwupdate-ack-${nodeId}`}
            />
            <span>
              <strong>Brick risk:</strong> flashing the wrong or corrupt image can permanently disable node #{nodeId}.
              Keep the bus connected and powered until the update completes. I have selected the correct firmware for this
              node.
            </span>
          </label>
          <button
            type="button"
            className="dronecan-inspector__fwupdate-go"
            style={buttonStyle('primary')}
            disabled={disabled || !acknowledged || file.bytes.length === 0}
            onClick={() => onStart(nodeId, file.name, file.bytes)}
            data-testid={`dronecan-fwupdate-start-${nodeId}`}
          >
            Update firmware
          </button>
        </>
      ) : null}
    </div>
  )
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
  const {
    status,
    bus,
    framesReceived,
    framesPerSec,
    error,
    nodes,
    escTelemetry,
    firmwareUpdate,
    connected,
    busy,
    onStart,
    onStop,
    onFetchParams,
    onApplyAndSave,
    onRestartNode,
    onStartFirmwareUpdate,
    onCancelFirmwareUpdate
  } = props
  const [busSelection, setBusSelection] = useState<number>(bus ?? 1)
  const [expanded, setExpanded] = useState<number | null>(null)
  const fwView = buildDronecanFirmwareUpdateView(firmwareUpdate)
  // While an update is transferring, lock every node's other actions (one
  // update at a time, and a write/restart mid-flash could corrupt the node).
  const updateInProgress = !!(fwView && fwView.inProgress)
  // Draft param edits, keyed `${nodeId}:${name}` (same convention as the CAN
  // tab's pure staged-changes helper). Nothing is written until Apply & Save.
  const [draftValues, setDraftValues] = useState<Record<string, string>>({})
  // Node id awaiting a restart confirmation (two-step button).
  const [confirmRestart, setConfirmRestart] = useState<number | null>(null)
  const active = status === 'active'
  const summary = summarizeDronecanNodes(nodes)
  const escRows = buildDronecanEscRows(escTelemetry)
  const statusBadge = active
    ? `CAN${bus ?? 0} live`
    : status === 'requesting'
      ? 'connecting'
      : status === 'stopping'
        ? 'stopping'
        : status === 'error'
          ? 'error'
          : 'idle'

  const draftKey = (nodeId: number, name: string): string => `${nodeId}:${name}`

  const setDraft = (nodeId: number, name: string, raw: string, current: string): void => {
    setDraftValues((prev) => {
      const next = { ...prev }
      const key = draftKey(nodeId, name)
      if (raw === current) {
        // Typed back to the live value — un-stage it.
        delete next[key]
      } else {
        next[key] = raw
      }
      return next
    })
  }

  const applyAndSave = (
    nodeId: number,
    changes: ReturnType<typeof buildCanBusStagedChanges>
  ): void => {
    const writes = changes
      .filter((change) => change.parsed !== undefined)
      .map((change) => ({ name: change.name, value: change.parsed as DronecanParamValueState }))
    if (writes.length === 0) {
      return
    }
    onApplyAndSave(nodeId, writes)
    // Optimistic: clear the applied drafts so the rows reflect each write's echo.
    setDraftValues((prev) => {
      const next = { ...prev }
      for (const write of writes) {
        delete next[draftKey(nodeId, write.name)]
      }
      return next
    })
  }

  return (
    <section className="grid one-up" id="setup-panel-dronecan-inspector">
      <Panel
        title="DroneCAN Inspector"
        subtitle="Live DroneCAN bus over the CAN_FORWARD tunnel — discover nodes, read/edit/save their parameters, restart them, and watch ESC telemetry."
      >
        <div className="telemetry-stack" data-testid="dronecan-inspector">
          <div className="telemetry-header">
            <div>
              <h3>Bus traffic</h3>
              <p data-testid="dronecan-inspector-summary">
                {summary.nodeCount} node{summary.nodeCount === 1 ? '' : 's'}
                {summary.unhealthyCount > 0 ? ` (${summary.unhealthyCount} unhealthy)` : ''} ·{' '}
                {framesPerSec.toFixed(0)} frames/s · {framesReceived} this session
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
              <>
                <label className="dronecan-inspector__bus-select">
                  <span>Bus</span>
                  <select
                    value={String(busSelection)}
                    onChange={(event) => setBusSelection(Number(event.target.value))}
                    disabled={busy || !connected || status === 'requesting'}
                    data-testid="dronecan-inspector-bus"
                  >
                    <option value="1">CAN1</option>
                    <option value="2">CAN2</option>
                  </select>
                </label>
                <button
                  type="button"
                  style={buttonStyle('primary')}
                  onClick={() => onStart(busSelection)}
                  disabled={busy || !connected || status === 'requesting'}
                  title={!connected ? 'Connect to a vehicle first.' : undefined}
                  data-testid="dronecan-inspector-start"
                >
                  {status === 'requesting' ? 'Starting…' : `Start CAN${busSelection} inspection`}
                </button>
              </>
            )}
          </div>

          {!connected ? (
            <p className="telemetry-note">Connect to a vehicle to inspect the DroneCAN bus.</p>
          ) : !active && nodes.length === 0 ? (
            <p className="telemetry-note">
              Start the bus to discover DroneCAN nodes over the CAN_FORWARD tunnel, then expand a node to read, edit, save,
              or restart it.
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
                .map((node) => {
                  const isOpen = expanded === node.nodeId
                  const paramRows = buildDronecanParamRows(node)
                  const stagedChanges = buildCanBusStagedChanges(node, draftValues)
                  const validChanges = stagedChanges.filter((change) => change.parsed !== undefined)
                  return (
                    <div
                      key={node.nodeId}
                      className="mavlink-inspector__entry"
                      data-testid={`dronecan-node-${node.nodeId}`}
                    >
                      <button
                        type="button"
                        className="dronecan-inspector__row dronecan-inspector__row--button"
                        onClick={() => setExpanded(isOpen ? null : node.nodeId)}
                        aria-expanded={isOpen}
                      >
                        <span className="mavlink-inspector__type">#{node.nodeId}</span>
                        <span>{node.name ?? '—'}</span>
                        <span>{node.health}</span>
                        <span>{node.mode}</span>
                        <span>{uptimeLabel(node.uptimeSec)}</span>
                        <span>{ageLabel(node.lastSeenAtMs)}</span>
                      </button>
                      {isOpen ? (
                        <div
                          className="dronecan-inspector__detail"
                          data-testid={`dronecan-node-detail-${node.nodeId}`}
                        >
                          <dl className="mavlink-inspector__fields">
                            {buildDronecanNodeDetailRows(node).map((row) => (
                              <div key={row.label} className="mavlink-inspector__field-row">
                                <dt>{row.label}</dt>
                                <dd>{row.value}</dd>
                              </div>
                            ))}
                          </dl>

                          {/* ---- Per-node parameter grid ---- */}
                          <div className="dronecan-inspector__params" data-testid={`dronecan-params-${node.nodeId}`}>
                            <div className="dronecan-inspector__params-head">
                              <span>
                                {node.paramFetch.status === 'fetching'
                                  ? `Reading parameters… (index ${node.paramFetch.nextIndex})`
                                  : `${paramRows.length} parameter${paramRows.length === 1 ? '' : 's'}`}
                              </span>
                              <button
                                type="button"
                                style={buttonStyle()}
                                onClick={() => onFetchParams(node.nodeId)}
                                disabled={busy || updateInProgress}
                                data-testid={`dronecan-refetch-${node.nodeId}`}
                              >
                                Re-fetch
                              </button>
                            </div>

                            {paramRows.length === 0 ? (
                              <p className="telemetry-note">
                                {node.paramFetch.status === 'fetching'
                                  ? 'Walking the parameter table…'
                                  : 'No parameters reported by this node.'}
                              </p>
                            ) : (
                              <div className="dronecan-inspector__param-grid">
                                <div className="dronecan-inspector__param-row dronecan-inspector__param-row--head">
                                  <span>Name</span>
                                  <span>Value</span>
                                  <span>Type</span>
                                </div>
                                {paramRows.map((row) => {
                                  const key = draftKey(node.nodeId, row.name)
                                  const draft = draftValues[key]
                                  const inputValue = draft ?? row.valueLabel
                                  const dirty = draft !== undefined && draft !== row.valueLabel
                                  return (
                                    <label
                                      key={row.name}
                                      className={`dronecan-inspector__param-row${dirty ? ' is-dirty' : ''}`}
                                      data-testid={`dronecan-param-${node.nodeId}-${row.name}`}
                                    >
                                      <span className="dronecan-inspector__param-name">
                                        {row.name}
                                        {row.rangeLabel ? (
                                          <small className="dronecan-inspector__param-range"> {row.rangeLabel}</small>
                                        ) : null}
                                      </span>
                                      <input
                                        type="text"
                                        value={inputValue}
                                        disabled={!row.editable || busy || updateInProgress}
                                        onChange={(event) =>
                                          setDraft(node.nodeId, row.name, event.target.value, row.valueLabel)
                                        }
                                        data-testid={`dronecan-param-input-${node.nodeId}-${row.name}`}
                                      />
                                      <span className="dronecan-inspector__param-type">{row.type}</span>
                                    </label>
                                  )
                                })}
                              </div>
                            )}

                            {stagedChanges.length > 0 ? (
                              <div className="dronecan-inspector__staged" data-testid={`dronecan-staged-${node.nodeId}`}>
                                <ul className="dronecan-inspector__staged-list">
                                  {stagedChanges.map((change) => (
                                    <li key={change.name}>
                                      <code>{change.name}</code> {change.currentLabel} →{' '}
                                      {change.parsed ? change.nextLabel : <em>invalid</em>}
                                    </li>
                                  ))}
                                </ul>
                                <div className="dronecan-inspector__staged-actions">
                                  <button
                                    type="button"
                                    style={buttonStyle('primary')}
                                    onClick={() => applyAndSave(node.nodeId, stagedChanges)}
                                    disabled={busy || updateInProgress || validChanges.length === 0}
                                    data-testid={`dronecan-apply-save-${node.nodeId}`}
                                  >
                                    Apply &amp; Save ({validChanges.length})
                                  </button>
                                  <button
                                    type="button"
                                    style={buttonStyle()}
                                    onClick={() =>
                                      setDraftValues((prev) => {
                                        const next = { ...prev }
                                        for (const change of stagedChanges) {
                                          delete next[draftKey(node.nodeId, change.name)]
                                        }
                                        return next
                                      })
                                    }
                                    disabled={busy}
                                    data-testid={`dronecan-discard-${node.nodeId}`}
                                  >
                                    Discard
                                  </button>
                                </div>
                              </div>
                            ) : null}
                          </div>

                          {/* ---- Restart node (confirm step) ---- */}
                          <div className="dronecan-inspector__node-actions">
                            {confirmRestart === node.nodeId ? (
                              <>
                                <span className="dronecan-inspector__confirm-text">
                                  Restart node #{node.nodeId}? It will reboot and drop off the bus briefly.
                                </span>
                                <button
                                  type="button"
                                  style={buttonStyle('primary')}
                                  onClick={() => {
                                    onRestartNode(node.nodeId)
                                    setConfirmRestart(null)
                                  }}
                                  disabled={busy || updateInProgress}
                                  data-testid={`dronecan-restart-confirm-${node.nodeId}`}
                                >
                                  Confirm restart
                                </button>
                                <button
                                  type="button"
                                  style={buttonStyle()}
                                  onClick={() => setConfirmRestart(null)}
                                  data-testid={`dronecan-restart-cancel-${node.nodeId}`}
                                >
                                  Cancel
                                </button>
                              </>
                            ) : (
                              <button
                                type="button"
                                style={buttonStyle()}
                                onClick={() => setConfirmRestart(node.nodeId)}
                                disabled={busy || updateInProgress}
                                data-testid={`dronecan-restart-${node.nodeId}`}
                              >
                                Restart node
                              </button>
                            )}
                          </div>

                          {/* ---- Firmware update (file server over CAN_FORWARD) ---- */}
                          <NodeFirmwareUpdate
                            nodeId={node.nodeId}
                            view={fwView}
                            anotherUpdateActive={updateInProgress && fwView?.nodeId !== node.nodeId}
                            busy={busy}
                            onStart={onStartFirmwareUpdate}
                            onCancel={onCancelFirmwareUpdate}
                          />
                        </div>
                      ) : null}
                    </div>
                  )
                })}
            </div>
          )}

          {/* ---- ESC telemetry (observe-only) ---- */}
          {escRows.length > 0 ? (
            <div className="dronecan-inspector__esc" data-testid="dronecan-esc-telemetry">
              <h3>ESC telemetry</h3>
              <p className="telemetry-note">
                Live uavcan.equipment.esc.Status per ESC index. Observe-only.
              </p>
              <div className="mavlink-inspector__table" data-testid="dronecan-esc-table">
                <div className="dronecan-inspector__esc-row dronecan-inspector__esc-row--head">
                  <span>ESC</span>
                  <span>RPM</span>
                  <span>Voltage</span>
                  <span>Current</span>
                  <span>Temp</span>
                  <span>Power</span>
                  <span>Errors</span>
                  <span>Last</span>
                </div>
                {escRows.map((row) => (
                  <div
                    key={row.escIndex}
                    className="dronecan-inspector__esc-row"
                    data-testid={`dronecan-esc-${row.escIndex}`}
                  >
                    <span>
                      #{row.escIndex}
                      <small className="dronecan-inspector__esc-node"> (node {row.nodeId})</small>
                    </span>
                    <span>{row.rpmLabel}</span>
                    <span>{row.voltageLabel}</span>
                    <span>{row.currentLabel}</span>
                    <span>{row.temperatureLabel}</span>
                    <span>{row.powerLabel}</span>
                    <span>{row.errorCountLabel}</span>
                    <span>{row.ageLabel}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </Panel>
    </section>
  )
}
