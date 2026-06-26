import { useMemo, useState } from 'react'

import type {
  CanBusState,
  DronecanParamValueState
} from '@arduconfig/ardupilot-core'
import { Panel, StatusBadge, buttonStyle } from '@arduconfig/ui-kit'

import {
  buildCanBusNodeRows,
  buildCanBusStagedChanges,
  compareParamEntries,
  formatParamValue,
  healthLabel,
  modeLabel,
  parseParamInput
} from '../view-models/can-bus'
import { useCanNodeNames } from '../hooks/use-can-node-names'

// Mission Planner-equivalent DroneCAN inspector. Connects via
// MAV_CMD_CAN_FORWARD (so MAVLink stays alive on the same channel), then
// discovers nodes from passive uavcan.protocol.NodeStatus broadcasts +
// active uavcan.protocol.GetNodeInfo polling, lists every node's
// parameters via uavcan.protocol.param.GetSet, and supports per-node
// write + ExecuteOpcode(SAVE) so changes persist across reboots.

export interface CanBusViewProps {
  state: CanBusState
  vehicleConnected: boolean
  onStartForward: (bus: number) => void
  onStopForward: () => void
  onRefreshNode: (nodeId: number) => void
  onFetchAllParameters: (nodeId: number) => void
  /** Write the staged params to the node, then persist to flash once acked. */
  onApplyAndSave: (nodeId: number, writes: Array<{ name: string; value: DronecanParamValueState }>) => void
}

export function CanBusView(props: CanBusViewProps) {
  const {
    state,
    vehicleConnected,
    onStartForward,
    onStopForward,
    onRefreshNode,
    onFetchAllParameters,
    onApplyAndSave
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

  function draftKey(nodeId: number, name: string): string {
    return `${nodeId}:${name}`
  }

  // Staged-changes model (field request: "stage and show changes,
  // comparison menus, almost like Parameters"). Edits accumulate in
  // draftValues; the comparison panel shows current → new per row and
  // one Apply all writes the whole set, after which Save to node
  // persists it. Nothing is written until Apply all.
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

  function applyAndSaveDrafts(nodeId: number, changes: ReturnType<typeof buildCanBusStagedChanges>) {
    const writes = changes
      .filter((change) => change.parsed !== undefined)
      .map((change) => ({ name: change.name, value: change.parsed as DronecanParamValueState }))
    if (writes.length === 0) {
      return
    }
    // Write all staged values, then persist to flash + re-fetch (handled in the
    // runtime once every write is acked).
    onApplyAndSave(nodeId, writes)
    // Optimistic: clear the applied drafts so rows reflect each write's
    // GetSet read-back the moment it arrives. Invalid rows stay staged.
    setDraftValues((current) => {
      const next = { ...current }
      for (const change of changes) {
        if (change.parsed) {
          delete next[draftKey(nodeId, change.name)]
        }
      }
      return next
    })
  }

  return (
    <div id="setup-panel-can">
      <Panel
        title="DroneCAN Bus"
        subtitle="Discover DroneCAN devices on the CAN bus and read, edit, and save their parameters — without dropping your vehicle connection."
      >
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
              <small>
                {state.framesReceived} frames received · {state.nodes.length} node
                {state.nodes.length === 1 ? '' : 's'}
              </small>
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
              const isExpanded = expandedNode === row.nodeId
              const customName = getName(row.hwUniqueId)
              const isRenaming = renamingNode === row.nodeId
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
                            if (row.hwUniqueId) {
                              setName(row.hwUniqueId, nameDraft)
                            }
                            setRenamingNode(undefined)
                          }}
                        >
                          <input
                            autoFocus
                            value={nameDraft}
                            placeholder={row.label}
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
                          <strong>{customName ?? row.label}</strong>
                          <button
                            type="button"
                            className="can-bus-node__rename-button"
                            disabled={!row.hwUniqueId}
                            title={
                              row.hwUniqueId
                                ? 'Give this node a persistent name'
                                : 'Waiting for the node UID (GetNodeInfo) before it can be named'
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
                        data-testid={`can-bus-node-toggle-${row.nodeId}`}
                      >
                        {isExpanded ? 'Collapse' : `Params (${row.paramCount})`}
                      </button>
                    </div>
                  </header>
                  {isExpanded && node ? (
                    <div className="can-bus-node__body">
                      {(() => {
                        const stagedChanges = buildCanBusStagedChanges(node, draftValues)
                        const validChanges = stagedChanges.filter((change) => change.parsed !== undefined)
                        if (stagedChanges.length === 0) {
                          return null
                        }
                        return (
                          <div className="can-bus-staged" data-testid={`can-bus-staged-${node.nodeId}`}>
                            <header className="can-bus-staged__header">
                              <strong>
                                {stagedChanges.length} staged change{stagedChanges.length === 1 ? '' : 's'}
                              </strong>
                              <div className="can-bus-staged__buttons">
                                <button
                                  type="button"
                                  style={buttonStyle('primary')}
                                  onClick={() => applyAndSaveDrafts(node.nodeId, stagedChanges)}
                                  disabled={validChanges.length === 0}
                                  data-testid={`can-bus-apply-all-${node.nodeId}`}
                                  title="Write every staged value to the node, persist it to flash (survives a power cycle), then re-fetch."
                                >
                                  Apply &amp; Save ({validChanges.length})
                                </button>
                                <button
                                  type="button"
                                  style={buttonStyle()}
                                  onClick={() => dropAllDrafts(node.nodeId)}
                                  data-testid={`can-bus-drop-all-${node.nodeId}`}
                                >
                                  Drop all
                                </button>
                              </div>
                            </header>
                            <ul className="can-bus-staged__list">
                              {stagedChanges.map((change) => (
                                <li key={change.name} data-testid={`can-bus-staged-row-${node.nodeId}-${change.name}`}>
                                  <code>{change.name}</code>
                                  <span>
                                    {change.currentLabel} → {change.nextLabel}
                                    {change.parsed === undefined ? <em> (invalid)</em> : null}
                                  </span>
                                  <button
                                    type="button"
                                    style={buttonStyle()}
                                    onClick={() => dropDraft(node.nodeId, change.name)}
                                    data-testid={`can-bus-staged-drop-${node.nodeId}-${change.name}`}
                                  >
                                    Drop
                                  </button>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )
                      })()}
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
                            onClick={() => onRefreshNode(node.nodeId)}
                            data-testid={`can-bus-refresh-${node.nodeId}`}
                          >
                            Refresh identity
                          </button>
                          <button
                            type="button"
                            style={buttonStyle()}
                            onClick={() => onFetchAllParameters(node.nodeId)}
                            data-testid={`can-bus-refetch-${node.nodeId}`}
                          >
                            Re-fetch params
                          </button>
                        </div>
                      </div>
                      {node.parameters.length === 0 ? (
                        <p className="can-bus-empty">No parameters discovered yet.</p>
                      ) : (
                        <table className="can-bus-params">
                          <thead>
                            <tr>
                              <th>Name</th>
                              <th>Value</th>
                              <th>Default</th>
                              <th>Range</th>
                            </tr>
                          </thead>
                          <tbody>
                            {[...node.parameters].sort(compareParamEntries).map((entry) => {
                              const key = draftKey(node.nodeId, entry.name)
                              const draft = draftValues[key]
                              const displayed = draft ?? formatParamValue(entry.value)
                              const editable = entry.value.tag !== 'empty'
                              const draftValid = draft === undefined ? true : parseParamInput(draft, entry.value) !== undefined
                              return (
                                <tr key={entry.name} data-testid={`can-bus-param-${node.nodeId}-${entry.name}`}>
                                  <td>
                                    <code>{entry.name}</code>
                                    <small>({entry.value.tag})</small>
                                  </td>
                                  <td>
                                    {editable ? (
                                      <input
                                        type="text"
                                        value={displayed}
                                        onChange={(event) =>
                                          setDraftValues((current) => ({ ...current, [key]: event.target.value }))
                                        }
                                        className={!draftValid ? 'can-bus-params__input--invalid' : undefined}
                                        data-testid={`can-bus-param-input-${node.nodeId}-${entry.name}`}
                                      />
                                    ) : (
                                      <span>{displayed}</span>
                                    )}
                                  </td>
                                  <td>{formatParamValue(entry.defaultValue)}</td>
                                  <td>
                                    {formatParamValue(entry.minValue)} … {formatParamValue(entry.maxValue)}
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      )}
                    </div>
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}
      </Panel>
    </div>
  )
}
