// "Messages": every DroneCAN message stream, decoded and live. One row per
// stream (a type from a node; services as request / response), with its rate
// and the latest value; a row opens into the full field tree, and "Frames"
// points the bus monitor at exactly that stream. Presentational: the streams
// come from the bus monitor's transfer decoder.

import { useState, type ReactNode } from 'react'

import { InfoDot } from './InfoDot'
import { DronecanFieldTree } from './DronecanFieldTree'
import { formatCanTopicRate, isCanTopicStale, type CanTopicEntry } from '../view-models/can-topics'
import { dronecanDisplayName, summarizeDronecanValue, transferFieldTree } from '../view-models/dronecan-field-tree'

export interface CanMessagesViewProps {
  topics: readonly CanTopicEntry[]
  /** 'bus' lists every node's streams (with a From column); a node id lists that node's. */
  scope: 'bus' | number
  /** Display name for a node id ("Here3"), when known. */
  nodeLabel: (nodeId: number) => string | undefined
  onShowFrames: (topic: CanTopicEntry) => void
  /** Frames are flowing (forwarding active, or a log open). */
  live: boolean
  /**
   * With a selection handler, a row is selected (and shown in an inspector
   * beside the table) instead of opening inline.
   */
  selectedKey?: string
  onSelect?: (topic: CanTopicEntry) => void
}

function kindLabel(topic: CanTopicEntry): string {
  return topic.kind === 'message' ? 'broadcast' : topic.kind === 'anonymous' ? 'anonymous' : topic.kind === 'request' ? 'request' : 'response'
}

function route(topic: CanTopicEntry, nodeLabel: (nodeId: number) => string | undefined): string {
  const name = (id: number) => {
    // A frame this app sent came from its own (GCS) node, not a bus node.
    if (id === topic.sourceNodeId && topic.last.direction === 'tx') return 'this app'
    const label = nodeLabel(id)
    if (label === 'this app') return label
    return label ? `${id} ${label}` : String(id)
  }
  if (topic.destinationNodeId !== undefined) return `${name(topic.sourceNodeId)} → ${name(topic.destinationNodeId)}`
  return name(topic.sourceNodeId)
}

export function CanMessagesView({ topics, scope, nodeLabel, onShowFrames, live, selectedKey, onSelect }: CanMessagesViewProps): ReactNode {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  const now = Date.now()
  const toggle = (key: string) =>
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  return (
    <section className="can-messages" data-testid={scope === 'bus' ? 'can-messages-bus' : `can-messages-node-${scope}`}>
      <header className="can-messages__head">
        <h3>
          {scope === 'bus' ? 'Messages on the bus' : 'Messages from this node'}
          <InfoDot label="About the message table" wide>
            Every DroneCAN message stream seen on the bus, decoded with the DSDL bundled in this build: one row per
            type and sending node (services as request and response), its rate, and the latest value. Open a row for
            every field; Frames shows that stream's raw frames in the bus monitor below.
          </InfoDot>
        </h3>
        <span className="can-messages__count">
          {topics.length} stream{topics.length === 1 ? '' : 's'}
        </span>
      </header>
      {topics.length === 0 ? (
        <p className="can-messages__empty" data-testid="can-messages-empty">
          {!live
            ? 'Connect to the bus (or open a log in the bus monitor) to see its messages.'
            : scope === 'bus'
              ? 'Listening… no DroneCAN messages yet.'
              : 'This node has not sent anything yet.'}
        </p>
      ) : (
        <div className="can-messages__table" role="table" aria-label="DroneCAN messages">
          <div className={`can-messages__row can-messages__row--head${scope === 'bus' ? ' has-route' : ''}`} role="row">
            <span role="columnheader">Message</span>
            {scope === 'bus' ? <span role="columnheader">From</span> : null}
            <span role="columnheader">Kind</span>
            <span role="columnheader">Rate</span>
            <span role="columnheader">Latest</span>
            <span role="columnheader" aria-label="Actions" />
          </div>
          {topics.map((topic) => {
            const open = !onSelect && expanded.has(topic.key)
            const selected = onSelect !== undefined && topic.key === selectedKey
            const tree = transferFieldTree(topic.last)
            // Services are one-shot exchanges, not streams: a count, never "stale".
            const isService = topic.kind === 'request' || topic.kind === 'response'
            const stale = !isService && isCanTopicStale(topic, now)
            const baseName = topic.last.type
              ? dronecanDisplayName(topic.last.type.fullName)
              : topic.kind === 'anonymous'
                ? 'Anonymous'
                : `Type ${topic.dataTypeId}`
            const name = topic.index ? `${baseName} #${topic.index.value}` : baseName
            return (
              <div
                key={topic.key}
                className={`can-messages__item${open ? ' is-open' : ''}${selected ? ' is-selected' : ''}${stale ? ' is-stale' : ''}`}
                data-testid={`can-message-${topic.last.type?.shortName ?? topic.dataTypeId}-${topic.sourceNodeId}${topic.index ? `-${topic.index.value}` : ''}`}
              >
                <div className={`can-messages__row${scope === 'bus' ? ' has-route' : ''}`} role="row">
                  <button
                    type="button"
                    className="can-messages__name"
                    onClick={() => (onSelect ? onSelect(topic) : toggle(topic.key))}
                    aria-expanded={onSelect ? undefined : open}
                    aria-pressed={onSelect ? selected : undefined}
                    title={topic.last.type?.fullName}
                  >
                    <span className="can-messages__chevron" aria-hidden="true">
                      ▸
                    </span>
                    {name}
                  </button>
                  {scope === 'bus' ? <span className="can-messages__route">{route(topic, nodeLabel)}</span> : null}
                  <span className={`can-messages__kind can-messages__kind--${topic.kind}`}>{kindLabel(topic)}</span>
                  <span className="can-messages__rate">
                    {isService ? `${topic.count}×` : stale ? 'stale' : formatCanTopicRate(topic.rateHz)}
                  </span>
                  <span className="can-messages__latest" title={topic.last.problem}>
                    {topic.last.problem ? `⚠ ${topic.last.problem.split(':')[0]}` : tree ? summarizeDronecanValue(tree, 3) : '—'}
                  </span>
                  <button
                    type="button"
                    className="can-messages__frames"
                    onClick={() => onShowFrames(topic)}
                    data-testid="can-message-show-frames"
                    title="Show this stream's frames in the bus monitor"
                  >
                    Frames
                  </button>
                </div>
                {open ? (
                  <div className="can-messages__detail">
                    <p className="can-messages__detail-head">
                      <strong>{topic.last.type?.fullName ?? `Type ${topic.dataTypeId}`}</strong>
                      <span>
                        {' '}
                        · {topic.count} received · last transfer #{topic.last.transferId}, {topic.last.frameSeqs.length}{' '}
                        frame{topic.last.frameSeqs.length === 1 ? '' : 's'}, {topic.last.payload.length} bytes
                      </span>
                    </p>
                    {topic.last.problem ? <p className="can-messages__problem">⚠ {topic.last.problem}</p> : null}
                    {tree ? <DronecanFieldTree nodes={tree} /> : null}
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
