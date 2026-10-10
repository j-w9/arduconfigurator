import { useMemo, useState, type ReactNode } from 'react'

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
import { CanDeviceInspectorView, type CanDeviceSection, type CanDeviceExpertActions } from './CanDeviceInspector'
import { CanEnablePrompt } from './CanEnablePrompt'
import { InfoDot } from './InfoDot'

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

/** The CAN tab's sub-tabs. */
export type CanSubTab = 'devices' | 'messages' | 'frames' | 'plot' | 'send'

const CAN_SUB_TABS: { id: CanSubTab; label: string; title: string }[] = [
  { id: 'devices', label: 'Devices', title: 'The nodes on the bus and their configuration' },
  { id: 'messages', label: 'Messages', title: 'Every DroneCAN message stream, decoded and live' },
  { id: 'frames', label: 'Frames', title: 'Every raw frame on the bus: filter, record, open logs' },
  { id: 'plot', label: 'Plot', title: 'Live charts of decoded fields and frame bytes' },
  { id: 'send', label: 'Send', title: 'Send DroneCAN messages, service requests and raw frames' }
]

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
  /** Reboot a node (offered after a change that needs one). */
  onRebootNode?: (nodeId: number) => void
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
  /**
   * The CAN tab's workspace (node rail + selection + message tables). The
   * DroneNet embed omits it and keeps the plain node list.
   */
  workspace?: {
    /** Nodes seen only in decoded traffic (e.g. an opened log), for the rail. */
    extraNodeIds?: readonly number[]
    /** A notice shown above every sub-tab (an opened log, say). */
    notice?: ReactNode
    /** Shown under All devices: node ID allocation. */
    allocator?: ReactNode
    /** Node messages, for the rail's scope: the whole bus, or one node. */
    nodeMessages?: (scope: 'bus' | number) => ReactNode
    /** The sub-tabs: Devices (this view's rail and node cards), Messages, Frames, Plot. */
    pages?: {
      page: CanSubTab
      onPage: (page: CanSubTab) => void
      messages: ReactNode
      frames: ReactNode
      plot: ReactNode
      /** Send: Expert-only (it acts on the bus), so absent hides the sub-tab. */
      send?: ReactNode
    }
  }
  /**
   * A USB-CAN adapter (SLCAN) as the bus instead of the autopilot's
   * forwarding. Absent: the autopilot is the only way onto the bus.
   */
  adapter?: {
    /** The bus shown is the adapter's. */
    active: boolean
    opening: boolean
    error?: string
    bitrate: number
    bitrates: readonly number[]
    onBitrate: (bitrate: number) => void
    /** Opens the port picker; must run in the click. */
    onConnect: () => void
  }
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
    adapter,
    selfNodeIds,
    onStartForward,
    onStopForward,
    onRefreshNode,
    onFetchAllParameters,
    onRebootNode,
    onApplyAndSave,
    paramMetadata,
    title = 'DroneCAN Bus',
    subtitle,
    enablement,
    onEnableCanBus,
    enableBusy = false,
    framesPerSec,
    escTelemetry,
    busy = false,
    expertActions,
    popout,
    workspace
  } = props

  const rows = useMemo(() => buildCanBusNodeRows(state), [state])
  // The rail's selection: the whole bus, or one node.
  const [scope, setScope] = useState<'bus' | number>('bus')
  const rowsShown = scope === 'bus' ? rows : rows.filter((row) => row.nodeId === scope)
  // Which device is open and WHICH of its surfaces. Previously one boolean per
  // device that opened everything at once; each feature now has its own button
  // so an operator opens the thing they came for — params, identity, live ESC
  // telemetry, or the restart/firmware actions — instead of scrolling an
  // everything-panel to find it.
  const [expandedNode, setExpandedNode] = useState<{ nodeId: number; section: CanDeviceSection } | undefined>(
    undefined
  )
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

  // The rail: every node the runtime knows (named as in its card), then any
  // seen only in decoded traffic (an opened log, a node that never sent a
  // NodeStatus to this session).
  const railNodes = (() => {
    const known = rows.map((row) => {
      const customName = getName(row.hwUniqueId ?? `node-${row.nodeId}`)
      const isSelf = selfNodeIds.includes(row.nodeId)
      const baseLabel = isSelf && row.label === `Node ${row.nodeId}` ? 'Autopilot (this FC)' : row.label
      return {
        nodeId: row.nodeId,
        label: customName ?? baseLabel,
        status: `${healthLabel(row.health)} · ${modeLabel(row.mode)}`,
        tone: row.tone as string
      }
    })
    const seen = new Set(known.map((entry) => entry.nodeId))
    const extra = (workspace?.extraNodeIds ?? [])
      .filter((nodeId) => !seen.has(nodeId))
      .map((nodeId) => ({ nodeId, label: `Node ${nodeId}`, status: 'traffic only', tone: 'neutral' }))
    return [...known, ...extra].sort((left, right) => left.nodeId - right.nodeId)
  })()

  // Bus-wide ESC telemetry (observe-only). Under the node list in the plain
  // layout; after the message table on the workspace's whole-bus page.
  const escSingleNode = escRows.length > 0 && escRows.every((row) => row.nodeId === escRows[0].nodeId) ? escRows[0].nodeId : undefined
  const escTable =
    escRows.length > 0 ? (
          <div className="dronecan-inspector__esc" data-testid="dronecan-esc-telemetry">
            <h4 className="dronecan-inspector__esc-title">
              ESC telemetry
              {escSingleNode !== undefined ? <small className="dronecan-inspector__esc-node">node {escSingleNode}</small> : null}
              <InfoDot label="About ESC telemetry">
                Live uavcan.equipment.esc.Status, one row per ESC index. Read-only.
              </InfoDot>
            </h4>
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
                    {/* Which node, only where the ESCs come from more than one. */}
                    {escSingleNode === undefined ? <small className="dronecan-inspector__esc-node"> (node {row.nodeId})</small> : null}
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
    ) : null

  const body = (
    <>
        {!vehicleConnected && !isActive ? (
          <p className="can-bus-empty">
            {adapter
              ? 'Connect to a vehicle to reach its CAN bus, or plug in a USB-CAN adapter (SLCAN) and choose Use a USB-CAN adapter.'
              : 'Connect to a vehicle first. The CAN inspector talks to the autopilot over MAVLink.'}
          </p>
        ) : !isActive ? (
          <div className="can-bus-intro">
            <p>
              Connect to a bus to find its DroneCAN nodes, then read and edit each node&rsquo;s parameters. The
              autopilot forwards the bus over MAVLink with <code>MAV_CMD_CAN_FORWARD</code>.
            </p>
            {/* The protocol walk-through is for the curious; it stays a click away. */}
            <details>
              <summary>How it works</summary>
              <ol>
                <li>Listen for <code>uavcan.protocol.NodeStatus</code> broadcasts from every node.</li>
                <li>Ask each with <code>uavcan.protocol.GetNodeInfo</code> for its name and HW/SW versions.</li>
                <li>Walk its parameter table with <code>uavcan.protocol.param.GetSet</code>.</li>
                <li>Save edits on the node with <code>uavcan.protocol.param.ExecuteOpcode</code>.</li>
              </ol>
            </details>
          </div>
        ) : rows.length === 0 ? (
          adapter?.active ? (
            <p className="can-bus-empty">
              The adapter is open ({state.framesReceived} frames so far) but no <code>NodeStatus</code> broadcasts have
              arrived yet. Check the bitrate matches the bus and the bus is terminated.
            </p>
          ) : (
            <p className="can-bus-empty">
              Forwarding is active ({state.framesReceived} frames so far) but no <code>NodeStatus</code> broadcasts have
              arrived yet. Verify <code>CAN_P{state.bus}_DRIVER</code> = 1 and <code>CAN_D{state.bus}_PROTOCOL</code> = 1 on
              the autopilot; reboot if either was just changed.
            </p>
          )
        ) : (
          <ul className="can-bus-nodes">
            {rowsShown.map((row) => {
              const node = state.nodes.find((n) => n.nodeId === row.nodeId)
              const isPoppedOut = popout?.openNodeIds.includes(row.nodeId) ?? false
              const isExpanded = expandedNode?.nodeId === row.nodeId
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
                        {/* Its own fixed-width slot: the ticking age must not change
                            the line's width. */}
                        {node ? (
                          <>
                            {' · seen '}
                            <span className="can-bus-node__seen">{lastSeenLabel(node.lastSeenAtMs)}</span>
                          </>
                        ) : null}
                      </small>
                      {/* Versions + UID on a quieter data line of their own; each
                          segment stays whole when the line wraps (the git hash was
                          splitting from its label). The vendor status code lives
                          in Details. */}
                      {row.hwVersion || row.swVersion || row.gitHash || row.hwUniqueId ? (
                        <small className="can-bus-node__ids">
                          {row.hwVersion ? <span>HW {row.hwVersion}</span> : null}
                          {row.swVersion ? <span>SW {row.swVersion}</span> : null}
                          {row.gitHash ? <span>git {row.gitHash}</span> : null}
                          {row.hwUniqueId ? (
                            <span className="can-bus-node__uid" data-testid={`can-bus-node-uid-${row.nodeId}`}>
                              UID <code>{row.hwUniqueId}</code>
                            </span>
                          ) : null}
                        </small>
                      ) : null}
                    </div>
                    <StatusBadge tone={row.tone}>
                      {healthLabel(row.health)} · {modeLabel(row.mode)}
                    </StatusBadge>
                  </header>
                  {/* One toggle per surface, on a row of their own under the
                      identity so the name and versions get the card's full width.
                      Each opens its own box below; Pop out sits apart at the end. */}
                  <div className="can-bus-node__status" role="group" aria-label={`${customName ?? baseLabel} sections`}>
                    {(
                      [
                        { section: 'params' as const, label: `Params (${row.paramCount})`, testId: 'toggle' },
                        { section: 'detail' as const, label: 'Details', testId: 'detail' },
                        { section: 'esc' as const, label: 'Messages', testId: 'messages' },
                        { section: 'actions' as const, label: 'Actions', testId: 'actions' }
                      ] as const
                    )
                      // Restart/firmware is Expert-only upstream; without
                      // those handlers the button would open an empty box.
                      .filter((entry) => entry.section !== 'actions' || expertActions !== undefined)
                      .map((entry) => {
                        const isOpen = isExpanded && expandedNode?.section === entry.section
                        return (
                          <button
                            key={entry.section}
                            type="button"
                            style={buttonStyle(isOpen ? 'primary' : undefined)}
                            aria-pressed={isOpen}
                            onClick={() =>
                              setExpandedNode(
                                isOpen ? undefined : { nodeId: row.nodeId, section: entry.section }
                              )
                            }
                            disabled={isPoppedOut}
                            title={isPoppedOut ? 'This device is open in its own window.' : undefined}
                            data-testid={`can-bus-node-${entry.testId}-${row.nodeId}`}
                          >
                            {entry.label}
                          </button>
                        )
                      })}
                    {popout ? (
                      // window.open is called straight out of this click: a
                      // popout opened from an effect (or any async hop) is
                      // killed by the browser's popup blocker.
                      <button
                        type="button"
                        className="can-bus-node__popout"
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
                      onRebootNode={onRebootNode}
                      busy={busy}
                      expertActions={expertActions}
                      sections={expandedNode ? [expandedNode.section] : undefined}
                    />
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}

        {/* ---- Bus-wide ESC telemetry (observe-only), from the merged inspector ---- */}
        {!workspace && scope === 'bus' ? escTable : null}
    </>
  )

  return (
    // The CAN tab reads one size up from the app's dense default: it is a tool
    // people read at length (frames, decoded fields, charts). Only the CAN tab --
    // the DroneNet embed in Networking keeps the app's scale.
    <div id="setup-panel-can" className={workspace ? 'can-tab' : undefined}>
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
                ? adapter?.active
                  ? 'Connected · USB-CAN adapter'
                  : `Connected · CAN${state.bus}`
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
            {adapter?.error && !isActive ? (
              <small className="can-bus-header__error" data-testid="can-adapter-error">
                {adapter.error}
              </small>
            ) : null}
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
                  style={buttonStyle(vehicleConnected || !adapter ? 'primary' : 'secondary')}
                  onClick={() => onStartForward(busSelection)}
                  disabled={isBusy || !vehicleConnected}
                  data-testid="can-bus-start"
                >
                  {isBusy ? 'Working…' : `Connect to CAN${busSelection}`}
                </button>
                {adapter ? (
                  // The other way onto a bus: a USB-CAN adapter, no vehicle needed.
                  <span className="can-bus-header__adapter" data-testid="can-adapter-controls">
                    <span className="can-bus-header__or">or</span>
                    <label className="can-bus-header__bus-select">
                      <span>Bitrate</span>
                      <select
                        value={String(adapter.bitrate)}
                        onChange={(event) => adapter.onBitrate(Number(event.target.value))}
                        disabled={adapter.opening}
                        data-testid="can-adapter-bitrate"
                      >
                        {adapter.bitrates.map((bitrate) => (
                          <option key={bitrate} value={bitrate}>
                            {bitrate >= 1_000_000 ? `${bitrate / 1_000_000} Mbit/s` : `${bitrate / 1000} kbit/s`}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      type="button"
                      style={buttonStyle(vehicleConnected ? 'secondary' : 'primary')}
                      onClick={adapter.onConnect}
                      disabled={adapter.opening}
                      title="An SLCAN USB-CAN adapter, or the autopilot's own SLCAN port"
                      data-testid="can-adapter-connect"
                    >
                      {adapter.opening ? 'Opening…' : 'Use a USB-CAN adapter'}
                    </button>
                  </span>
                ) : null}
              </>
            )}
          </div>
        </header>

        {workspace ? (
          // The CAN tab: Devices (a node rail and each node's configuration --
          // where someone setting up a GPS lives), Messages (decoded streams),
          // Frames (raw traffic, recording, logs) and Plot. Devices is first
          // and the default, so the deeper tools never get in the way.
          <>
            {workspace.pages ? (
              <div className="tab-strip can-subtabs" role="tablist" aria-label="CAN views" data-testid="can-subtabs">
                {CAN_SUB_TABS.filter((tab) => tab.id !== 'send' || workspace.pages!.send !== undefined).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={workspace.pages!.page === tab.id}
                    className={`tab-strip__tab${workspace.pages!.page === tab.id ? ' is-active' : ''}`}
                    title={tab.title}
                    onClick={() => workspace.pages!.onPage(tab.id)}
                    data-testid={`can-subtab-${tab.id}`}
                  >
                    <span className="tab-strip__tab-title">{tab.label}</span>
                  </button>
                ))}
              </div>
            ) : null}
            {workspace.notice}
            {!workspace.pages || workspace.pages.page === 'devices' ? (
              <div className="can-workspace">
                <nav className="can-workspace__rail" aria-label="CAN nodes" data-testid="can-node-rail">
                  <button
                    type="button"
                    className={`can-workspace__rail-item can-workspace__rail-item--bus${scope === 'bus' ? ' is-active' : ''}`}
                    aria-pressed={scope === 'bus'}
                    onClick={() => setScope('bus')}
                    data-testid="can-rail-bus"
                  >
                    <span className="can-workspace__rail-icon" aria-hidden="true">▣</span>
                    <span className="can-workspace__rail-text">
                      <strong>All devices</strong>
                      <small>
                        {railNodes.length} node{railNodes.length === 1 ? '' : 's'}
                      </small>
                    </span>
                  </button>
                  {railNodes.map((entry) => (
                    <button
                      key={entry.nodeId}
                      type="button"
                      className={`can-workspace__rail-item${scope === entry.nodeId ? ' is-active' : ''}`}
                      aria-pressed={scope === entry.nodeId}
                      onClick={() => setScope(entry.nodeId)}
                      data-testid={`can-rail-node-${entry.nodeId}`}
                    >
                      <span className={`can-workspace__rail-dot can-workspace__rail-dot--${entry.tone}`} aria-hidden="true" />
                      <span className="can-workspace__rail-text">
                        <strong>{entry.label}</strong>
                        <small>
                          Node {entry.nodeId}
                          {entry.status ? ` · ${entry.status}` : ''}
                        </small>
                      </span>
                    </button>
                  ))}
                </nav>
                <div className="can-workspace__main">
                  {scope !== 'bus' && rowsShown.length === 0 ? (
                    <p className="can-bus-empty">
                      Node {scope} has been seen on the bus but has not sent a NodeStatus to this session, so there is
                      nothing to configure here.
                    </p>
                  ) : (
                    body
                  )}
                  {workspace.nodeMessages ? workspace.nodeMessages(scope) : null}
                  {scope === 'bus' ? workspace.allocator : null}
                  {scope === 'bus' ? escTable : null}
                </div>
              </div>
            ) : workspace.pages.page === 'messages' ? (
              workspace.pages.messages
            ) : workspace.pages.page === 'frames' ? (
              workspace.pages.frames
            ) : workspace.pages.page === 'send' && workspace.pages.send !== undefined ? (
              workspace.pages.send
            ) : (
              workspace.pages.plot
            )}
          </>
        ) : (
          body
        )}
      </Panel>
    </div>
  )
}
