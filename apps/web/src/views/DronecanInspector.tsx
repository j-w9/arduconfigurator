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
import type { DronecanParamCatalogLookup } from '../view-models/dronecan-param-display'

/** One AP_Periph firmware build offered for a node (already matched to the
 *  node's board id by the host). Plain display shape — no firmware-flash types
 *  cross into the view. */
export interface DronecanFirmwareCandidate {
  /** Firmware image URL — the stable list key and what the host downloads. */
  url: string
  /** Version string, e.g. "1.7.0". */
  versionLabel: string
  /** Release channel label, e.g. "Stable", "Beta". */
  releaseLabel: string
  /** Board/platform name, e.g. "FlywooF405Pro". */
  platform: string
  /** APJ board id the build targets (matches the node). */
  boardId: number
  /** True for the channel's newest build. */
  latest: boolean
}

/** Online firmware lookup capability, injected by the host. Only reachable in
 *  the desktop shell (the browser can't fetch firmware.ardupilot.org — no CORS),
 *  so the browser build passes `available: false` and the UI degrades to the
 *  local-file path with a short reason. */
export interface DronecanFirmwareOnlineSource {
  /** True when online lookup works here (desktop firmware bridge present). */
  available: boolean
  /** Shown when unavailable (e.g. desktop-only). */
  unavailableReason?: string
  /** Match a node to AP_Periph firmware builds by its board id. Rejects with a
   *  human message on fetch failure or unknown identity. */
  findCandidates: (node: DronecanInspectedNode) => Promise<DronecanFirmwareCandidate[]>
  /** Download + decode a candidate to the RAW image bytes the node's bootloader
   *  flashes (the same bytes a local .bin yields), plus a display name. The
   *  host handles the .apj→raw decode. Rejects with a human message on failure. */
  download: (candidate: DronecanFirmwareCandidate) => Promise<{ fileName: string; image: Uint8Array }>
}

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
  /** Online firmware lookup (desktop-only). Omit to hide the online affordance
   *  entirely; pass `available: false` to show the degrade note. */
  firmwareOnline?: DronecanFirmwareOnlineSource
  /** Curated-catalog lookup (by param name) to enrich a node's params with a
   *  label, range, enum value labels, and a description. AP_Periph nodes report
   *  none of that; unknown params render raw. */
  paramMetadata: DronecanParamCatalogLookup
}

/** Per-node firmware-update affordance: file picker, prominent brick-risk
 *  confirmation, progress bar, and clear success/error. Only one update runs at
 *  a time — all the node's other actions are disabled while one is underway. */
function NodeFirmwareUpdate(props: {
  node: DronecanInspectedNode
  view: ReturnType<typeof buildDronecanFirmwareUpdateView>
  /** True when ANY update (this node or another) is occupying the bus. */
  anotherUpdateActive: boolean
  busy: boolean
  onStart: (nodeId: number, fileName: string, image: Uint8Array) => void
  onCancel: () => void
  online?: DronecanFirmwareOnlineSource
}) {
  const { node, view, anotherUpdateActive, busy, onStart, onCancel, online } = props
  const nodeId = node.nodeId
  // AP_Periph nodes report a name like "org.ardupilot.<board>" (e.g.
  // org.ardupilot.Here4AP). The firmware server lays builds out as
  // /AP_Periph/<release>/<board>/AP_Periph.bin, so when we can recover the board
  // we deep-link straight to its raw .bin (which drops into the picker below as
  // the exact image the node's bootloader flashes). The browser can't fetch it
  // for us (no CORS) — this is a one-click manual download. Unknown board names
  // fall back to the AP_Periph index to browse.
  const firmwareBoard =
    node.name && node.name.startsWith('org.ardupilot.')
      ? node.name.slice('org.ardupilot.'.length)
      : undefined
  const firmwareDownloadUrl = firmwareBoard
    ? `https://firmware.ardupilot.org/AP_Periph/stable/${encodeURIComponent(firmwareBoard)}/AP_Periph.bin`
    : 'https://firmware.ardupilot.org/AP_Periph/stable/'
  // Manual download pointer, reused wherever we can't fetch+flash for the user
  // (browser, or no automatic match). For an ArduPilot AP_Periph node we know
  // the board (org.ardupilot.<board>) so we deep-link its .bin; otherwise — a
  // Here3-style vendor name, a PX4 node, etc. — we can't guess the board, so we
  // point at the AP_Periph index to browse and note PX4/vendor devices get
  // firmware from their own vendor.
  const manualFirmwareSource = firmwareBoard ? (
    <>
      Download{' '}
      <a
        href={firmwareDownloadUrl}
        target="_blank"
        rel="noreferrer"
        data-testid={`dronecan-fwupdate-online-link-${nodeId}`}
      >
        AP_Periph.bin for <code>{firmwareBoard}</code>
      </a>{' '}
      (stable), then load it below.
    </>
  ) : (
    <>
      Find this node’s build on{' '}
      <a
        href={firmwareDownloadUrl}
        target="_blank"
        rel="noreferrer"
        data-testid={`dronecan-fwupdate-online-link-${nodeId}`}
      >
        firmware.ardupilot.org/AP_Periph
      </a>{' '}
      and load its <code>AP_Periph.bin</code> below. PX4 / vendor nodes get firmware from the device vendor instead.
    </>
  )
  const [file, setFile] = useState<{ name: string; bytes: Uint8Array } | null>(null)
  const [acknowledged, setAcknowledged] = useState(false)
  const [readError, setReadError] = useState<string | null>(null)
  // Online-lookup state. `candidates === null` means "haven't searched yet";
  // `[]` means searched, nothing matched. `downloadingUrl` marks the build
  // currently being fetched + decoded.
  const [onlineBusy, setOnlineBusy] = useState(false)
  const [onlineError, setOnlineError] = useState<string | null>(null)
  const [onlineCandidates, setOnlineCandidates] = useState<DronecanFirmwareCandidate[] | null>(null)
  const [downloadingUrl, setDownloadingUrl] = useState<string | null>(null)

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
          <div className="dronecan-inspector__fwupdate-note" data-testid={`dronecan-fwupdate-done-${nodeId}`}>
            <p>Image transferred. The node is rebooting into the new firmware and will reappear on the bus.</p>
            <p
              className="dronecan-inspector__fwupdate-verify"
              data-testid={`dronecan-fwupdate-verify-${nodeId}`}
            >
              ⚠ A firmware update can reset or corrupt this node’s parameters. Once it’s back, re-fetch its
              params and check your settings (LED, GPS, compass, …) before flight.
            </p>
          </div>
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

  // Find online: match this node to AP_Periph builds on the firmware server.
  const findOnline = (): void => {
    if (!online?.available) {
      return
    }
    setOnlineError(null)
    setOnlineBusy(true)
    setOnlineCandidates(null)
    online
      .findCandidates(node)
      .then((candidates) => setOnlineCandidates(candidates))
      .catch((err) =>
        setOnlineError(err instanceof Error ? err.message : 'Could not look up firmware online.')
      )
      .finally(() => setOnlineBusy(false))
  }

  // Use a matched build: download + decode it to raw image bytes, then stage it
  // as the selected file so it flows through the SAME brick-ack + Update path as
  // a local pick (re-arm the ack — the operator must confirm the online image).
  const useCandidate = (candidate: DronecanFirmwareCandidate): void => {
    if (!online?.available) {
      return
    }
    setOnlineError(null)
    setReadError(null)
    setAcknowledged(false)
    setDownloadingUrl(candidate.url)
    online
      .download(candidate)
      .then(({ fileName, image }) => setFile({ name: fileName, bytes: image }))
      .catch((err) =>
        setOnlineError(err instanceof Error ? err.message : 'Could not download the firmware image.')
      )
      .finally(() => setDownloadingUrl(null))
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

      {/* ---- Find firmware online (desktop-only; matches the node to AP_Periph
              builds on firmware.ardupilot.org and stages the decoded image) ---- */}
      {online ? (
        online.available ? (
          <div className="dronecan-inspector__fwupdate-online" data-testid={`dronecan-fwupdate-online-${nodeId}`}>
            <button
              type="button"
              style={buttonStyle()}
              disabled={disabled || onlineBusy || downloadingUrl !== null}
              onClick={findOnline}
              data-testid={`dronecan-fwupdate-online-find-${nodeId}`}
            >
              {onlineBusy ? 'Searching…' : 'Find firmware online'}
            </button>
            <span className="dronecan-inspector__fwupdate-online-id">
              {node.name ? node.name : `node #${nodeId}`}
            </span>
            {onlineError ? (
              <p
                className="dronecan-inspector__fwupdate-error"
                data-testid={`dronecan-fwupdate-online-error-${nodeId}`}
              >
                {onlineError}
              </p>
            ) : null}
            {onlineCandidates !== null ? (
              onlineCandidates.length === 0 ? (
                <p className="telemetry-note" data-testid={`dronecan-fwupdate-online-empty-${nodeId}`}>
                  No AP_Periph build matched this node’s board id automatically. {manualFirmwareSource}
                </p>
              ) : (
                <ul
                  className="dronecan-inspector__fwupdate-online-list"
                  data-testid={`dronecan-fwupdate-online-list-${nodeId}`}
                >
                  {onlineCandidates.map((candidate) => (
                    <li key={candidate.url}>
                      <span>
                        {candidate.platform || `board ${candidate.boardId}`} · {candidate.versionLabel}{' '}
                        ({candidate.releaseLabel}){candidate.latest ? ' · latest' : ''}
                      </span>
                      <button
                        type="button"
                        style={buttonStyle()}
                        disabled={disabled || downloadingUrl !== null}
                        onClick={() => useCandidate(candidate)}
                        data-testid={`dronecan-fwupdate-online-use-${nodeId}`}
                      >
                        {downloadingUrl === candidate.url ? 'Downloading…' : 'Use this build'}
                      </button>
                    </li>
                  ))}
                </ul>
              )
            ) : null}
          </div>
        ) : (
          <div className="telemetry-note" data-testid={`dronecan-fwupdate-online-unavailable-${nodeId}`}>
            <p>
              {online.unavailableReason ??
                'Online firmware lookup needs the desktop app — the browser can’t fetch the firmware server directly.'}
            </p>
            <p>{manualFirmwareSource}</p>
          </div>
        )
      ) : null}

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
    onCancelFirmwareUpdate,
    firmwareOnline,
    paramMetadata
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
  // Nodes whose parameter grid is expanded. Params are collapsed by default —
  // the table can be large + costs a bus read-walk — so the operator opts in.
  const [openParams, setOpenParams] = useState<Set<number>>(new Set())
  const toggleParams = (nodeId: number) =>
    setOpenParams((prev) => {
      const next = new Set(prev)
      if (next.has(nodeId)) {
        next.delete(nodeId)
      } else {
        next.add(nodeId)
      }
      return next
    })
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
                  const paramsShown = openParams.has(node.nodeId)
                  const paramRows = buildDronecanParamRows(node, paramMetadata)
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
                              <button
                                type="button"
                                className="dronecan-inspector__params-toggle"
                                aria-expanded={paramsShown}
                                onClick={() => {
                                  const willOpen = !paramsShown
                                  toggleParams(node.nodeId)
                                  // Fetch on first open — params are collapsed (and
                                  // unfetched) by default, so opening pulls them.
                                  if (willOpen && paramRows.length === 0 && node.paramFetch.status !== 'fetching') {
                                    onFetchParams(node.nodeId)
                                  }
                                }}
                                data-testid={`dronecan-params-toggle-${node.nodeId}`}
                              >
                                <span aria-hidden="true">{paramsShown ? '▾' : '▸'}</span>{' '}
                                {node.paramFetch.status === 'fetching'
                                  ? `Reading parameters… (index ${node.paramFetch.nextIndex})`
                                  : `Parameters${paramRows.length ? ` (${paramRows.length})` : ''}`}
                              </button>
                              {paramsShown ? (
                                <button
                                  type="button"
                                  style={buttonStyle()}
                                  onClick={() => onFetchParams(node.nodeId)}
                                  disabled={busy || updateInProgress}
                                  data-testid={`dronecan-refetch-${node.nodeId}`}
                                >
                                  Re-fetch
                                </button>
                              ) : null}
                            </div>

                            {paramsShown ? (
                              <>
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
                                      <span className="dronecan-inspector__param-name" title={row.description}>
                                        {row.name}
                                        {row.label !== row.name ? (
                                          <small className="dronecan-inspector__param-label"> {row.label}</small>
                                        ) : null}
                                        {row.enumLabel ? (
                                          <small className="dronecan-inspector__param-enum"> = {row.enumLabel}</small>
                                        ) : null}
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
                              </>
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
                            node={node}
                            view={fwView}
                            anotherUpdateActive={updateInProgress && fwView?.nodeId !== node.nodeId}
                            busy={busy}
                            onStart={onStartFirmwareUpdate}
                            onCancel={onCancelFirmwareUpdate}
                            online={firmwareOnline}
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
