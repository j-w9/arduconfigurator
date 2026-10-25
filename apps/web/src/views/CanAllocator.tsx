// Node ID allocation: this app as the bus's dynamic node ID allocator (DNA
// server), for nodes that boot without an ID (AP_Periph with CAN_NODE = 0).
// The autopilot runs its own on its buses, so this is for a bus with no
// autopilot on it -- a USB-CAN adapter on the bench. Presentational.

import type { ReactElement } from 'react'
import type { DronecanAllocatorState } from '@arduconfig/ardupilot-core'

import { InfoDot } from './InfoDot'

export interface CanAllocatorViewProps {
  state: DronecanAllocatorState | undefined
  /** Why it cannot be switched on here, if it cannot. */
  unavailableReason?: string
  /** A node without an ID has been asking recently. */
  nodeAsking: boolean
  onToggle: (enabled: boolean) => void
  /** Forget the IDs handed out in earlier sessions. */
  onForget: () => void
  nodeLabel: (nodeId: number) => string | undefined
}

function shortUid(hex: string): string {
  return hex.length > 12 ? `${hex.slice(0, 8)}…${hex.slice(-4)}` : hex
}

export function CanAllocatorView(props: CanAllocatorViewProps): ReactElement {
  const { state, unavailableReason, nodeAsking } = props
  const enabled = state?.enabled ?? false
  const allocated = state?.entries.filter((entry) => entry.source === 'allocated') ?? []
  const status = state?.otherAllocatorNodeId !== undefined
    ? `Node ${state.otherAllocatorNodeId} already hands out IDs on this bus, so this one stays off.`
    : enabled
      ? state?.pending
        ? `A node is asking (unique ID ${shortUid(state.pending.uniqueId)}…).`
        : allocated.length > 0
          ? `On. ${allocated.length} ID${allocated.length === 1 ? '' : 's'} in the table.`
          : 'On, waiting for a node to ask.'
      : nodeAsking
        ? 'A node without an ID is asking for one.'
        : 'Off.'
  return (
    <section className="can-allocator" data-testid="can-allocator">
      <header className="can-allocator__head">
        <h4>
          Node ID allocation
          <InfoDot label="About node ID allocation" wide>
            A node set to ask for its ID (AP_Periph with CAN_NODE = 0) needs an allocator on the bus. The autopilot is
            one; on a bench bus with only a USB-CAN adapter, this app can be. A node gets the ID it had before, else the
            highest free one, and the table is remembered in this browser so a fleet keeps its IDs.
          </InfoDot>
        </h4>
        <label className="can-allocator__toggle">
          <input
            type="checkbox"
            checked={enabled}
            disabled={unavailableReason !== undefined || state?.otherAllocatorNodeId !== undefined}
            onChange={(event) => props.onToggle(event.target.checked)}
            data-testid="can-allocator-toggle"
          />
          <span>Hand out node IDs</span>
        </label>
      </header>
      <p className={`can-allocator__status${nodeAsking && !enabled ? ' is-asking' : ''}`} data-testid="can-allocator-status">
        {unavailableReason ?? status}
      </p>
      {allocated.length > 0 ? (
        <>
          <ul className="can-allocator__table" data-testid="can-allocator-table">
            {allocated.map((entry) => (
              <li key={entry.uniqueId}>
                <strong>Node {entry.nodeId}</strong>
                <span className="can-monitor__mono" title={entry.uniqueId}>
                  {shortUid(entry.uniqueId)}
                </span>
                <span className="can-monitor__dim">
                  {props.nodeLabel(entry.nodeId) ?? (entry.atMs ? `handed out ${new Date(entry.atMs).toLocaleTimeString()}` : 'from an earlier session')}
                </span>
              </li>
            ))}
          </ul>
          <button type="button" className="can-monitor__tool" onClick={props.onForget} disabled={enabled}>
            Forget the table
          </button>
        </>
      ) : null}
    </section>
  )
}
