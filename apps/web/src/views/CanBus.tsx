import { useMemo, useState } from 'react'

import type {
  CanBusState,
  DronecanEscTelemetry,
  DronecanParamValueState
} from '@arduconfig/ardupilot-core'
import { Panel, StatusBadge, buttonStyle } from '@arduconfig/ui-kit'

import { buildCanBusNodeRows, healthLabel, modeLabel } from '../view-models/can-bus'
import { buildCanBusTrafficSummary } from '../view-models/can-device-inspector'
import { buildDronecanEscRows, summarizeDronecanNodes } from '../view-models/dronecan-inspector'
import type { DronecanParamCatalogLookup } from '../view-models/dronecan-param-display'
import { useCanNodeNames } from '../hooks/use-can-node-names'
import { CanDeviceInspectorView, type CanDeviceExpertActions } from './CanDeviceInspector'
import { CanEnablePrompt } from './CanEnablePrompt'

// The single CAN surface. Mission Planner-equivalent DroneCAN workflow: connect
// via MAV_CMD_CAN_FORWARD (so MAVLink stays alive on the same channel), discover
// nodes from passive uavcan.protocol.NodeStatus broadcasts + active
// uavcan.protocol.GetNodeInfo polling, then inspect ONE device at a time —
// identity, parameters (GetSet walk, staged edits, write + ExecuteOpcode(SAVE)),
// restart, firmware update, ESC telemetry.
//
// This tab used to have a twin: an expert-only "DroneCAN Inspector" tab showing
// the same bus over the same tunnel from a different angle. The two are merged
// here, and every device row can instead pop its inspector out into its own
// window (see use-can-device-popouts) so several devices are watchable side by
// side, the way Mission Planner and the DroneCAN GUI do it.

export interface CanBusViewProps {
  state: CanBusState
  vehicleConnected: boolean
  /** The autopilot's own DroneCAN node id(s) (CAN_Dn_UC_NODE). A node matching
   *  one of these is the FC itself — labelled as such, since it answers neither
   *  GetNodeInfo nor a DroneCAN param walk (its params live on MAVLink). */
  selfNodeIds: number[]
  onStartForward: (bus: number) => void
  onStopForward: () => void
  onRefreshNode: (nodeId: number) => void
  onFetchAllParameters: (nodeId: number) => void
  /** Write the staged params to the node, then persist to flash once acked. */
  onApplyAndSave: (nodeId: number, writes: Array<{ name: string; value: DronecanParamValueState }>) => void
  /** Curated-catalog lookup (by param name) used to enrich a node's params with
   *  a label, range, enum value labels, and a description — AP_Periph nodes
   *  usually report none of that. Returns undefined for unknown/periph-specific
   *  params, which then render raw. */
  paramMetadata: DronecanParamCatalogLookup
  /** Panel title/subtitle override (the networking variant reframes the copy).
   *  The DroneNet section in the Networking tab passes a NET_-filtered `state`,
   *  so no param-level filtering is needed here — count, staged changes, and the
   *  param list all derive from `state`. */
  title?: string
  subtitle?: string
  /** "A DroneCAN peripheral is selected but the CAN bus is off" prompt: the
   *  reasons to show and the one-click enable handler. Absent when the bus is
   *  already enabled or no DroneCAN driver is selected. */
  enablement?: { triggerLabels: string[] }
  onEnableCanBus?: () => void
  /** Disables the enable button while a write is in flight. */
  enableBusy?: boolean
  /** Smoothed frames/s over the tunnel — the bus-traffic read-out the standalone
   *  inspector used to own. Omitted by the DroneNet embed, which is about one
   *  peripheral's settings rather than bus health. */
  framesPerSec?: number
  /** Bus-wide ESC telemetry (uavcan.equipment.esc.Status), rendered under the
   *  device list. Omitted by the DroneNet embed. */
  escTelemetry?: readonly DronecanEscTelemetry[]
  /** Some other write is in flight; gates the destructive device actions. */
  busy?: boolean
  /** Expert-only per-device actions (restart, firmware update) — see
   *  CanDeviceExpertActions. Omitted outside Expert mode, which is exactly where
   *  they lived before the tab merge. */
  expertActions?: CanDeviceExpertActions
  /** Pop-out wiring, supplied by App.tsx (the windows outlive this tab). Absent
   *  in the DroneNet embed, which has no pop-out affordance. */
  popout?: {
    openNodeIds: number[]
    /** Called straight from the click handler — window.open needs the gesture. */
    onOpen: (nodeId: number, label: string | undefined) => void
    onClose: (nodeId: number) => void
    /** Node whose window the browser blocked, so we can say so in place. */
    blockedNodeId?: number
  }
}

/** "12.3s ago" / "now" for a node's last NodeStatus broadcast. */
function lastSeenLabel(lastSeenAtMs: number): string {
  const age = Math.max(0, Date.now() - lastSeenAtMs)
  if (age < 1500) {
    return 'now'
  }
  return `${(age / 1000).toFixed(age < 10000 ? 1 : 0)}s ago`
}

export function CanBusView(props: CanBusViewProps) {
  const {
    state,
    vehicleConnected,
    selfNodeIds,
    onStartForward,
    onStopForward,
    onRefreshNode,
    onFetchAllParameters,
    onApplyAndSave,
    paramMetadata,
    title = 'DroneCAN Bus',
    subtitle = 'Discover DroneCAN devices on the CAN bus and read, edit, and save their parameters — without dropping your vehicle connection.',
    enablement,
    onEnableCanBus,
    enableBusy = false,
    framesPerSec,
    escTelemetry,
    busy = false,
    expertActions,
    popout
  } = props

  const rows = useMemo(() => buildCanBusNodeRows(state), [state])
  const [expandedNode, setExpandedNode] = useState<number | undefined>(undefined)
  const [draftValues, setDraftValues] = useState<Record<string, string>>({})
  const [busSelection, setBusSelection] = useState<number>(state.bus ?? 1)
  // Persistent operator-assigned node names, keyed by hardware UID.
  const { getName, setName } = useCanNodeNames()
  const [renamingNode, setRenamingNode] = useState<number | undefined>(undefined)
  const [nameDraft, setNameDraft] = useState('')

  const isActive = state.status === 'active'
  const isBusy = state.status === 'requesting' || state.status === 'stopping'
  const headerTone =
    state.status === 'active'
      ? 'success'
      : state.status === 'error'
        ? 'danger'
        : state.status === 'idle'
          ? 'neutral'
          : 'warning'
  const busSummary = summarizeDronecanNodes(state.nodes)
  const escRows = escTelemetry ? buildDronecanEscRows(escTelemetry) : []

  function draftKey(nodeId: number, name: string): string {
    return `${nodeId}:${name}`
  }

  // Staged-changes model (field request: "stage and show changes,
  // comparison menus, almost like Parameters"). Edits accumulate in
  // draftValues; the comparison panel shows current → new per row and
  // one Apply all writes the whole set, after which Save to node
  // persists it. Nothing is written until Apply all.
  function setDraft(nodeId: number, name: string, raw: string) {
    setDraftValues((current) => ({ ...current, [draftKey(nodeId, name)]: raw }))
  }

  function dropDraft(nodeId: number, name: string) {
    setDraftValues((current) => {
      const next = { ...current }
      delete next[draftKey(nodeId, name)]
      return next
    })
  }

  function dropAllDrafts(nodeId: number) {
    setDraftValues((current) => {
      const prefix = `${nodeId}:`
      return Object.fromEntries(Object.entries(current).filter(([key]) => !key.startsWith(prefix)))
    })
  }

  function applyAndSave(nodeId: number, writes: Array<{ name: string; value: DronecanParamValueState }>) {
    // Write all staged values, then persist to flash + re-fetch (handled in the
    // runtime once every write is acked).
    onApplyAndSave(nodeId, writes)
    // Optimistic: clear the applied drafts so rows reflect each write's
    // GetSet read-back the moment it arrives. Invalid rows stay staged.
    setDraftValues((current) => {
      const next = { ...current }
      for (const write of writes) {
        delete next[draftKey(nodeId, write.name)]
      }
      return next
    })
  }

  return (
    <div id="setup-panel-can">
      <Panel title={title} subtitle={subtitle}>
        {/* Extracted to CanEnablePrompt so the Servos ▸ Peripherals optical-flow
            section can raise the identical offer; the default test ids keep this
            instance byte-identical in the DOM. */}
        {enablement && onEnableCanBus ? (
          <CanEnablePrompt
            triggerLabels={enablement.triggerLabels}
            onEnable={onEnableCanBus}
            busy={enableBusy}
          />
        ) : null}
        <header className="can-bus-header">
          <div className="can-bus-header__status">
            <StatusBadge tone={headerTone}>
              {state.status === 'active'
                ? `Connected · CAN${state.bus}`
                : state.status === 'requesting'
                  ? 'Connecting…'
                  : state.status === 'stopping'
                    ? 'Disconnecting…'
                    : state.status === 'error'
                      ? 'Error'
                      : 'Disconnected'}
            </StatusBadge>
            {state.status === 'active' ? (
              framesPerSec !== undefined ? (
                // Bus-traffic read-out inherited from the standalone inspector:
                // node count, unhealthy count, live frame rate, session frames.
                <small data-testid="can-bus-traffic-summary">
                  {buildCanBusTrafficSummary({
                    nodeCount: busSummary.nodeCount,
                    unhealthyCount: busSummary.unhealthyCount,
                    framesPerSec,
                    framesReceived: state.framesReceived
                  })}
                </small>
              ) : (
                <small>
                  {state.framesReceived} frames received · {state.nodes.length} node
                  {state.nodes.length === 1 ? '' : 's'}
                </small>
              )
            ) : null}
            {state.error ? <small className="can-bus-header__error">{state.error}</small> : null}
          </div>

          <div className="can-bus-header__controls">
            {isActive ? (
              <button
                type="button"
                style={buttonStyle()}
                onClick={onStopForward}
                disabled={isBusy}
                data-testid="can-bus-stop"
              >
                Disconnect
              </button>
            ) : (
              <>
                <label className="can-bus-header__bus-select">
                  <span>Bus</span>
                  <select
                    value={String(busSelection)}
                    onChange={(event) => setBusSelection(Number(event.target.value))}
                    disabled={isBusy || !vehicleConnected}
                    data-testid="can-bus-select"
                  >
                    <option value="1">CAN1</option>
                    <option value="2">CAN2</option>
                  </select>
                </label>
                <button
                  type="button"
                  style={buttonStyle('primary')}
                  onClick={() => onStartForward(busSelection)}
                  disabled={isBusy || !vehicleConnected}
                  data-testid="can-bus-start"
                >
                  {isBusy ? 'Working…' : `Connect to CAN${busSelection}`}
                </button>
              </>
            )}
          </div>
        </header>

        {!vehicleConnected ? (
          <p className="can-bus-empty">Connect to a vehicle first. The CAN inspector talks to the autopilot over MAVLink.</p>
        ) : !isActive ? (
          <div className="can-bus-intro">
            <p>
              Mission Planner-style DroneCAN inspector. Click <strong>Connect</strong> above and the configurator will:
            </p>
            <ol>
              <li>Send <code>MAV_CMD_CAN_FORWARD</code> to start forwarding the chosen bus.</li>
              <li>Listen passively for <code>uavcan.protocol.NodeStatus</code> broadcasts from every node.</li>
              <li>Issue <code>uavcan.protocol.GetNodeInfo</code> to populate name + HW/SW versions.</li>
              <li>Walk each node's parameter table via <code>uavcan.protocol.param.GetSet</code>.</li>
              <li>Let you edit values + persist with <code>uavcan.protocol.param.ExecuteOpcode</code>.</li>
            </ol>
          </div>
        ) : rows.length === 0 ? (
          <p className="can-bus-empty">
            Forwarding is active ({state.framesReceived} frames so far) but no <code>NodeStatus</code> broadcasts have
            arrived yet. Verify <code>CAN_P{state.bus}_DRIVER</code> = 1 and <code>CAN_D{state.bus}_PROTOCOL</code> = 1 on
            the autopilot; reboot if either was just changed.
          </p>
        ) : (
          <ul className="can-bus-nodes">
            {rows.map((row) => {
              const node = state.nodes.find((n) => n.nodeId === row.nodeId)
              const isPoppedOut = popout?.openNodeIds.includes(row.nodeId) ?? false
              const isExpanded = expandedNode === row.nodeId
              // Prefer the stable hardware UID; fall back to the node id so a
              // node that hasn't returned GetNodeInfo yet (e.g. the autopilot's
              // own node) is still nameable.
              const nameKey = row.hwUniqueId ?? `node-${row.nodeId}`
              const customName = getName(nameKey)
              const isRenaming = renamingNode === row.nodeId
              // The autopilot's own DroneCAN node: give it a clear default label
              // instead of a bare "Node N" (it answers neither GetNodeInfo nor a
              // param walk — its params live on MAVLink).
              const isSelf = selfNodeIds.includes(row.nodeId)
              const baseLabel = isSelf && row.label === `Node ${row.nodeId}` ? 'Autopilot (this FC)' : row.label
              return (
                <li
                  key={row.nodeId}
                  className={`can-bus-node${isExpanded ? ' is-expanded' : ''}`}
                  data-testid={`can-bus-node-${row.nodeId}`}
                >
                  <header className="can-bus-node__header">
                    <div className="can-bus-node__label">
                      {isRenaming ? (
                        <form
                          className="can-bus-node__rename"
                          onSubmit={(event) => {
                            event.preventDefault()
                            setName(nameKey, nameDraft)
                            setRenamingNode(undefined)
                          }}
                        >
                          <input
                            autoFocus
                            value={nameDraft}
                            placeholder={baseLabel}
                            aria-label={`Name for node ${row.nodeId}`}
                            onChange={(event) => setNameDraft(event.target.value)}
                            data-testid={`can-bus-node-name-input-${row.nodeId}`}
                          />
                          <button type="submit" style={buttonStyle('primary')} data-testid={`can-bus-node-name-save-${row.nodeId}`}>
                            Save
                          </button>
                          <button type="button" style={buttonStyle()} onClick={() => setRenamingNode(undefined)}>
                            Cancel
                          </button>
                        </form>
                      ) : (
                        <div className="can-bus-node__name-row">
                          <strong>{customName ?? baseLabel}</strong>
                          {isSelf ? <StatusBadge tone="neutral">Autopilot</StatusBadge> : null}
                          <button
                            type="button"
                            className="can-bus-node__rename-button"
                            title={
                              row.hwUniqueId
                                ? 'Give this node a persistent name (kept by its hardware UID)'
                                : 'Give this node a persistent name (kept by node id until it reports a UID)'
                            }
                            onClick={() => {
                              setNameDraft(customName ?? '')
                              setRenamingNode(row.nodeId)
                            }}
                            data-testid={`can-bus-node-rename-${row.nodeId}`}
                          >
                            {customName ? 'Rename' : 'Name'}
                          </button>
                        </div>
                      )}
                      <small>
                        {customName ? `${row.label} · ` : ''}Node {row.nodeId}
                        {row.uptimeSec !== undefined ? ` · up ${row.uptimeSec}s` : ''}
                        {node ? ` · seen ${lastSeenLabel(node.lastSeenAtMs)}` : ''}
                        {row.hwVersion ? ` · HW ${row.hwVersion}` : ''}
                        {row.swVersion ? ` · SW ${row.swVersion}` : ''}
                        {row.gitHash ? ` · git ${row.gitHash}` : ''}
                        {row.vendorStatusCode !== undefined ? ` · vss ${row.vendorStatusCode}` : ''}
                      </small>
                      {row.hwUniqueId ? (
                        <small className="can-bus-node__uid" data-testid={`can-bus-node-uid-${row.nodeId}`}>
                          UID <code>{row.hwUniqueId}</code>
                        </small>
                      ) : null}
                    </div>
                    <div className="can-bus-node__status">
                      <StatusBadge tone={row.tone}>
                        {healthLabel(row.health)} · {modeLabel(row.mode)}
                      </StatusBadge>
                      <button
                        type="button"
                        style={buttonStyle()}
                        onClick={() => setExpandedNode(isExpanded ? undefined : row.nodeId)}
                        disabled={isPoppedOut}
                        title={isPoppedOut ? 'This device is open in its own window.' : undefined}
                        data-testid={`can-bus-node-toggle-${row.nodeId}`}
                      >
                        {isExpanded ? 'Collapse' : `Params (${row.paramCount})`}
                      </button>
                      {popout ? (
                        // window.open is called straight out of this click: a
                        // popout opened from an effect (or any async hop) is
                        // killed by the browser's popup blocker.
                        <button
                          type="button"
                          style={buttonStyle()}
                          onClick={() =>
                            isPoppedOut
                              ? popout.onClose(row.nodeId)
                              : popout.onOpen(row.nodeId, customName ?? baseLabel)
                          }
                          title={
                            isPoppedOut
                              ? 'Close this device’s inspector window'
                              : 'Open this device’s inspector in its own window'
                          }
                          data-testid={`can-bus-node-popout-${row.nodeId}`}
                        >
                          {isPoppedOut ? 'Close window' : 'Pop out'}
                        </button>
                      ) : null}
                    </div>
                  </header>
                  {isPoppedOut ? (
                    <p className="can-bus-node__popped-out" data-testid={`can-bus-node-popped-out-${row.nodeId}`}>
                      Inspecting this device in its own window. Close that window to bring it back inline.
                    </p>
                  ) : popout?.blockedNodeId === row.nodeId ? (
                    <p className="can-bus-node__popout-blocked" data-testid={`can-bus-node-popout-blocked-${row.nodeId}`}>
                      Your browser blocked the inspector window. Allow pop-ups for this site, then try again — the device
                      stays fully usable inline in the meantime.
                    </p>
                  ) : null}
                  {isExpanded && node && !isPoppedOut ? (
                    <CanDeviceInspectorView
                      node={node}
                      isSelf={isSelf}
                      paramMetadata={paramMetadata}
                      draftValues={draftValues}
                      onDraftChange={setDraft}
                      onDropDraft={dropDraft}
                      onDropAllDrafts={dropAllDrafts}
                      onApplyAndSave={applyAndSave}
                      onRefreshNode={onRefreshNode}
                      onFetchAllParameters={onFetchAllParameters}
                      busy={busy}
                      expertActions={expertActions}
                    />
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}

        {/* ---- Bus-wide ESC telemetry (observe-only), from the merged inspector ---- */}
        {escRows.length > 0 ? (
          <div className="dronecan-inspector__esc" data-testid="dronecan-esc-telemetry">
            <h3>ESC telemetry</h3>
            <p className="telemetry-note">Live uavcan.equipment.esc.Status per ESC index. Observe-only.</p>
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
      </Panel>
    </div>
  )
}
