// Per-device DroneCAN inspector — everything the configurator can show or do for
// ONE node on the bus, in one component.
//
// This is the surface that used to be split across two tabs: the CAN tab owned
// the device list + parameter editor, while a separate expert-only "DroneCAN
// Inspector" tab owned identity detail, node restart, firmware update, and ESC
// telemetry. They inspected the same bus over the same CAN_FORWARD tunnel, so
// they are now one CAN tab, and this component is the per-device half of it. It
// is rendered twice over: inline under a device row in the CAN tab, and inside a
// popped-out window (Mission Planner / DroneCAN-GUI style) so several devices can
// be watched side by side.
//
// Presentational only — state and handlers come from App.tsx via CanBusView; the
// popout is a React portal into a child window, NOT a second runtime, so both
// copies read the same snapshot and share the same draft map.

import { useState } from 'react'

import { StatusBadge, buttonStyle } from '@arduconfig/ui-kit'
import type {
  DronecanEscTelemetry,
  DronecanFirmwareUpdateState,
  DronecanInspectedNode,
  DronecanParamValueState
} from '@arduconfig/ardupilot-core'

import {
  buildDronecanEscRows,
  buildDronecanFirmwareUpdateView,
  buildDronecanNodeDetailRows,
  buildDronecanParamRows
} from '../view-models/dronecan-inspector'
import { buildCanBusStagedChanges, healthLabel, modeLabel } from '../view-models/can-bus'
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

/** The destructive per-device actions. Bundled behind one optional prop because
 *  they are Expert-mode-only: before the tab merge they lived exclusively in the
 *  expert-gated DroneCAN Inspector tab, and folding that tab into the always-
 *  visible CAN tab must not hand a restart/flash button to a non-expert user who
 *  never had one. Omitted => the affordances do not render at all. */
export interface CanDeviceExpertActions {
  /** The single in-flight (or just-finished) node firmware update, if any. */
  firmwareUpdate: DronecanFirmwareUpdateState | undefined
  /** Restart a node via uavcan.protocol.RestartNode (with a confirm step). */
  onRestartNode: (nodeId: number) => void
  /** Begin a firmware update on a node (GCS serves the selected .bin image). */
  onStartFirmwareUpdate: (nodeId: number, fileName: string, image: Uint8Array) => void
  /** Cancel an in-flight update, or dismiss a finished one. */
  onCancelFirmwareUpdate: () => void
  /** Online firmware lookup (desktop-only). Omit to hide the online affordance
   *  entirely; pass `available: false` to show the degrade note. */
  firmwareOnline?: DronecanFirmwareOnlineSource
}

export interface CanDeviceInspectorViewProps {
  node: DronecanInspectedNode
  /** This node is the autopilot itself (CAN_Dn_UC_NODE) — its parameters live on
   *  MAVLink, not DroneCAN, so the empty param table says so. */
  isSelf: boolean
  paramMetadata: DronecanParamCatalogLookup
  /** Shared draft map keyed `${nodeId}:${name}`. Owned by CanBusView so an inline
   *  view and a popout of the same device stage into the SAME edits. */
  draftValues: Record<string, string>
  onDraftChange: (nodeId: number, name: string, raw: string) => void
  onDropDraft: (nodeId: number, name: string) => void
  onDropAllDrafts: (nodeId: number) => void
  onApplyAndSave: (nodeId: number, writes: Array<{ name: string; value: DronecanParamValueState }>) => void
  onRefreshNode: (nodeId: number) => void
  onFetchAllParameters: (nodeId: number) => void
  /** Something else is mid-write; the destructive actions gate on it. */
  busy?: boolean
  /** Expert-only actions (restart, firmware update). Omit outside Expert mode. */
  expertActions?: CanDeviceExpertActions
  /** Node-scoped ESC telemetry. Passed in the popout (where this device is the
   *  whole window); omitted inline, where the CAN tab renders one bus-wide table. */
  escTelemetry?: readonly DronecanEscTelemetry[]
  /** Popouts add a standalone heading — inline rows already have one. */
  heading?: string
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

export function CanDeviceInspectorView(props: CanDeviceInspectorViewProps) {
  const {
    node,
    isSelf,
    paramMetadata,
    draftValues,
    onDraftChange,
    onDropDraft,
    onDropAllDrafts,
    onApplyAndSave,
    onRefreshNode,
    onFetchAllParameters,
    busy = false,
    expertActions,
    escTelemetry,
    heading
  } = props
  const nodeId = node.nodeId
  // Node id awaiting a restart confirmation (two-step button).
  const [confirmRestart, setConfirmRestart] = useState(false)
  const fwView = buildDronecanFirmwareUpdateView(expertActions?.firmwareUpdate)
  // While an update is transferring, lock every node's other actions (one update
  // at a time, and a write/restart mid-flash could corrupt the node).
  const updateInProgress = !!(fwView && fwView.inProgress)
  const paramRows = buildDronecanParamRows(node, paramMetadata)
  const stagedChanges = buildCanBusStagedChanges(node, draftValues)
  const validChanges = stagedChanges.filter((change) => change.parsed !== undefined)
  const escRows = escTelemetry ? buildDronecanEscRows(escTelemetry) : []

  function applyAndSaveDrafts(): void {
    const writes = validChanges.map((change) => ({
      name: change.name,
      value: change.parsed as DronecanParamValueState
    }))
    if (writes.length === 0) {
      return
    }
    // Write all staged values, then persist to flash + re-fetch (handled in the
    // runtime once every write is acked). Dropping the applied drafts is the
    // parent's job so an inline view and its popout clear together.
    onApplyAndSave(nodeId, writes)
  }

  return (
    <div className="can-bus-node__body" data-testid={`can-device-inspector-${nodeId}`}>
      {heading ? (
        <header className="can-device-inspector__heading">
          <div>
            <strong>{heading}</strong>
            <small>Node {nodeId}</small>
          </div>
          <StatusBadge tone={node.health === 'ok' ? 'success' : 'danger'}>
            {healthLabel(node.health)} · {modeLabel(node.mode)}
          </StatusBadge>
        </header>
      ) : null}

      {stagedChanges.length > 0 ? (
        <div className="can-bus-staged" data-testid={`can-bus-staged-${nodeId}`}>
          <header className="can-bus-staged__header">
            <strong>
              {stagedChanges.length} staged change{stagedChanges.length === 1 ? '' : 's'}
            </strong>
            <div className="can-bus-staged__buttons">
              <button
                type="button"
                style={buttonStyle('primary')}
                onClick={applyAndSaveDrafts}
                disabled={validChanges.length === 0 || updateInProgress}
                data-testid={`can-bus-apply-all-${nodeId}`}
                title="Write every staged value to the node, persist it to flash (survives a power cycle), then re-fetch."
              >
                Apply &amp; Save ({validChanges.length})
              </button>
              <button
                type="button"
                style={buttonStyle()}
                onClick={() => onDropAllDrafts(nodeId)}
                data-testid={`can-bus-drop-all-${nodeId}`}
              >
                Drop all
              </button>
            </div>
          </header>
          <ul className="can-bus-staged__list">
            {stagedChanges.map((change) => (
              <li key={change.name} data-testid={`can-bus-staged-row-${nodeId}-${change.name}`}>
                <code>{change.name}</code>
                <span>
                  {change.currentLabel} → {change.nextLabel}
                  {change.parsed === undefined ? <em> (invalid)</em> : null}
                </span>
                <button
                  type="button"
                  style={buttonStyle()}
                  onClick={() => onDropDraft(nodeId, change.name)}
                  data-testid={`can-bus-staged-drop-${nodeId}-${change.name}`}
                >
                  Drop
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="can-bus-node__toolbar">
        <small>
          Param fetch:{' '}
          {node.paramFetch.status === 'fetching'
            ? `walking index ${node.paramFetch.nextIndex}…`
            : node.paramFetch.status === 'complete'
              ? `${node.parameters.length} parameters loaded`
              : node.paramFetch.status === 'stalled'
                ? 'stalled — retry?'
                : 'idle'}
        </small>
        <div className="can-bus-node__toolbar-buttons">
          <button
            type="button"
            style={buttonStyle()}
            onClick={() => onRefreshNode(nodeId)}
            data-testid={`can-bus-refresh-${nodeId}`}
          >
            Refresh identity
          </button>
          <button
            type="button"
            style={buttonStyle()}
            onClick={() => onFetchAllParameters(nodeId)}
            data-testid={`can-bus-refetch-${nodeId}`}
          >
            Re-fetch params
          </button>
        </div>
      </div>

      {paramRows.length === 0 ? (
        <p className="can-bus-empty">
          {isSelf
            ? "This is the autopilot's own node — its parameters live on the Parameters tab (over MAVLink), not DroneCAN."
            : 'No parameters discovered yet.'}
        </p>
      ) : (
        // A DroneCAN param table is five columns wide; in a narrow popout window
        // (or on a phone) it scrolls inside its own box rather than pushing the
        // document into a horizontal scroll.
        <div className="can-bus-params-scroll">
        <table className="can-bus-params">
          <thead>
            <tr>
              <th>Name</th>
              <th>Value</th>
              <th>Type</th>
              <th>Default</th>
              <th>Range</th>
            </tr>
          </thead>
          <tbody>
            {paramRows.map((row) => {
              const draft = draftValues[`${nodeId}:${row.name}`]
              const displayed = draft ?? row.valueLabel
              // A draft that doesn't parse for this param's type is flagged in
              // place; the staged panel above also marks it invalid and Apply
              // skips it.
              const draftInvalid =
                draft !== undefined &&
                stagedChanges.some((change) => change.name === row.name && change.parsed === undefined)
              return (
                <tr key={row.name} data-testid={`can-bus-param-${nodeId}-${row.name}`}>
                  <td title={row.description}>
                    <code>{row.name}</code>
                    {row.label !== row.name ? <small className="can-bus-params__label">{row.label}</small> : null}
                  </td>
                  <td>
                    {row.editable ? (
                      <input
                        type="text"
                        value={displayed}
                        disabled={updateInProgress}
                        onChange={(event) => onDraftChange(nodeId, row.name, event.target.value)}
                        className={draftInvalid ? 'can-bus-params__input--invalid' : undefined}
                        data-testid={`can-bus-param-input-${nodeId}-${row.name}`}
                      />
                    ) : (
                      <span>{displayed}</span>
                    )}
                    {row.enumLabel && draft === undefined ? (
                      <small className="can-bus-params__enum">{row.enumLabel}</small>
                    ) : null}
                  </td>
                  <td>{row.type}</td>
                  <td>{row.defaultLabel ?? '—'}</td>
                  <td>{row.rangeLabel ?? '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        </div>
      )}

      {/* ---- Identity detail (was the standalone inspector's expanded row) ---- */}
      <details className="can-device-inspector__detail-block">
        <summary data-testid={`can-device-detail-toggle-${nodeId}`}>Device detail</summary>
        <dl className="mavlink-inspector__fields" data-testid={`dronecan-node-detail-${nodeId}`}>
          {buildDronecanNodeDetailRows(node).map((row) => (
            <div key={row.label} className="mavlink-inspector__field-row">
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
      </details>

      {/* ---- ESC telemetry for THIS device (popout only; the CAN tab shows one
              bus-wide table under the device list) ---- */}
      {escTelemetry && escRows.length > 0 ? (
        <div className="dronecan-inspector__esc" data-testid={`can-device-esc-${nodeId}`}>
          <h3>ESC telemetry</h3>
          <p className="telemetry-note">Live uavcan.equipment.esc.Status from this node. Observe-only.</p>
          <div className="mavlink-inspector__table">
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
              <div key={row.escIndex} className="dronecan-inspector__esc-row">
                <span>#{row.escIndex}</span>
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

      {/* ---- Expert-only device actions: restart + firmware update ---- */}
      {expertActions ? (
        <>
          <div className="dronecan-inspector__node-actions">
            {confirmRestart ? (
              <>
                <span className="dronecan-inspector__confirm-text">
                  Restart node #{nodeId}? It will reboot and drop off the bus briefly.
                </span>
                <button
                  type="button"
                  style={buttonStyle('primary')}
                  onClick={() => {
                    expertActions.onRestartNode(nodeId)
                    setConfirmRestart(false)
                  }}
                  disabled={busy || updateInProgress}
                  data-testid={`dronecan-restart-confirm-${nodeId}`}
                >
                  Confirm restart
                </button>
                <button
                  type="button"
                  style={buttonStyle()}
                  onClick={() => setConfirmRestart(false)}
                  data-testid={`dronecan-restart-cancel-${nodeId}`}
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                type="button"
                style={buttonStyle()}
                onClick={() => setConfirmRestart(true)}
                disabled={busy || updateInProgress}
                data-testid={`dronecan-restart-${nodeId}`}
              >
                Restart node
              </button>
            )}
          </div>

          <NodeFirmwareUpdate
            node={node}
            view={fwView}
            anotherUpdateActive={updateInProgress && fwView?.nodeId !== nodeId}
            busy={busy}
            onStart={expertActions.onStartFirmwareUpdate}
            onCancel={expertActions.onCancelFirmwareUpdate}
            online={expertActions.firmwareOnline}
          />
        </>
      ) : null}
    </div>
  )
}
