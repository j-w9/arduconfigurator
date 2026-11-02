// Node messages: the CAN bus's Recent Notices -- what DroneCAN nodes log about
// themselves (uavcan.protocol.debug.LogMessage), repeats folded with a count,
// warnings and errors first, each with the node it came from. Copy all and
// Clear, a text filter, and DEBUG lines on request. Presentational.

import { useState, type ReactElement } from 'react'

import { InfoDot } from './InfoDot'
import type { CanNodeMessagesModel, CoalescedCanLog } from '../view-models/can-node-messages'

export interface CanNodeMessagesViewProps {
  model: CanNodeMessagesModel
  /** Narrowed to one node (the rail's selection), or the whole bus. */
  scopeLabel: string
  nodeLabel: (nodeId: number) => string | undefined
  filter: string
  onFilter: (value: string) => void
  showDebug: boolean
  onShowDebug: (value: boolean) => void
  onClear: () => void
  hasEntries: boolean
}

function Row({ entry, nodeLabel }: { entry: CoalescedCanLog; nodeLabel: CanNodeMessagesViewProps['nodeLabel'] }): ReactElement {
  const label = nodeLabel(entry.nodeId)
  return (
    <li className={`can-node-messages__row can-node-messages__row--${entry.level}`} data-testid="can-node-message">
      <span className="can-node-messages__level">{entry.level}</span>
      <span className="can-node-messages__text">
        {entry.text}
        {entry.count > 1 ? <span className="can-node-messages__count">×{entry.count}</span> : null}
      </span>
      <span className="can-node-messages__node">
        {label ? `${entry.nodeId} ${label}` : `Node ${entry.nodeId}`}
        {entry.source ? ` · ${entry.source}` : ''}
      </span>
      <span className="can-node-messages__time">{new Date(entry.lastAtMs).toLocaleTimeString()}</span>
    </li>
  )
}

export function CanNodeMessagesView(props: CanNodeMessagesViewProps): ReactElement {
  const { model } = props
  const [copied, setCopied] = useState(false)
  const all = [...model.attention, ...model.info]
  const copy = () => {
    const text = all
      .map((entry) => `${new Date(entry.lastAtMs).toLocaleTimeString()} ${entry.level.toUpperCase()} node ${entry.nodeId}: ${entry.text}${entry.count > 1 ? ` (x${entry.count})` : ''}`)
      .join('\n')
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    })
  }
  return (
    <section className="can-node-messages" data-testid="can-node-messages">
      <header className="can-node-messages__head">
        <h4>
          Node messages
          <InfoDot label="About node messages" wide>
            What DroneCAN nodes log about themselves (uavcan.protocol.debug.LogMessage): errors, warnings and info
            from each node, repeats folded. {props.scopeLabel}.
          </InfoDot>
        </h4>
        <input
          type="search"
          value={props.filter}
          placeholder="Filter"
          onChange={(event) => props.onFilter(event.target.value)}
          data-testid="can-node-messages-filter"
        />
        <label className="can-monitor__check">
          <input type="checkbox" checked={props.showDebug} onChange={(event) => props.onShowDebug(event.target.checked)} />
          <span>Debug</span>
        </label>
        <button type="button" className="can-monitor__tool" onClick={copy} disabled={all.length === 0}>
          {copied ? 'Copied' : 'Copy all'}
        </button>
        <button type="button" className="can-monitor__tool" onClick={props.onClear} disabled={!props.hasEntries} data-testid="can-node-messages-clear">
          Clear
        </button>
      </header>
      {all.length === 0 ? (
        <p className="can-node-messages__empty" data-testid="can-node-messages-empty">
          {props.hasEntries ? 'Nothing matches.' : 'No node has logged anything yet.'}
        </p>
      ) : (
        <>
          {model.attention.length > 0 ? (
            <>
              <p className="can-node-messages__group can-node-messages__group--attention">Warnings &amp; errors</p>
              <ul className="can-node-messages__list">
                {model.attention.map((entry) => (
                  <Row key={`${entry.nodeId}|${entry.level}|${entry.text}`} entry={entry} nodeLabel={props.nodeLabel} />
                ))}
              </ul>
            </>
          ) : null}
          {model.info.length > 0 ? (
            <>
              <p className="can-node-messages__group">Info</p>
              <ul className="can-node-messages__list">
                {model.info.map((entry) => (
                  <Row key={`${entry.nodeId}|${entry.level}|${entry.text}`} entry={entry} nodeLabel={props.nodeLabel} />
                ))}
              </ul>
            </>
          ) : null}
        </>
      )}
    </section>
  )
}
