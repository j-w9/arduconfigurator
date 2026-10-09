// Expert ▸ Messages: every decoded DroneCAN stream, filtered by node or by
// name, with the selected stream inspected on the right -- its full field
// tree, Plot beside every number, and a jump to its raw frames.

import { useMemo, useState, type ReactNode } from 'react'

import { CanMessagesView } from './CanMessages'
import { DronecanFieldTree } from './DronecanFieldTree'
import type { CanTopicEntry } from '../view-models/can-topics'
import {
  dronecanDisplayName,
  dronecanPathLabel,
  transferFieldTree,
  type DronecanFieldNode
} from '../view-models/dronecan-field-tree'

export interface CanMessagesPageProps {
  topics: readonly CanTopicEntry[]
  nodes: readonly { nodeId: number; label: string }[]
  nodeLabel: (nodeId: number) => string | undefined
  live: boolean
  onShowFrames: (topic: CanTopicEntry) => void
  onPlotField: (topic: CanTopicEntry, node: DronecanFieldNode) => void
  isPlotted: (topic: CanTopicEntry, node: DronecanFieldNode) => boolean
}

export function CanMessagesPage(props: CanMessagesPageProps): ReactNode {
  const { topics, nodes, nodeLabel, live, onShowFrames, onPlotField, isPlotted } = props
  const [nodeFilter, setNodeFilter] = useState<number | 'all'>('all')
  const [search, setSearch] = useState('')
  const [selectedKey, setSelectedKey] = useState<string | undefined>(undefined)

  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return topics.filter((topic) => {
      if (nodeFilter !== 'all' && topic.sourceNodeId !== nodeFilter && topic.destinationNodeId !== nodeFilter) return false
      if (!needle) return true
      const name = topic.last.type?.fullName.toLowerCase() ?? String(topic.dataTypeId)
      return name.includes(needle)
    })
  }, [topics, nodeFilter, search])

  const selected = topics.find((topic) => topic.key === selectedKey)
  const tree = selected ? transferFieldTree(selected.last) : undefined

  return (
    <div className="can-messages-page" data-testid="can-messages-page">
      <div className="can-messages-page__filters">
        <div className="can-messages-page__chips" role="group" aria-label="Filter by node">
          <button
            type="button"
            className={nodeFilter === 'all' ? 'is-on' : undefined}
            aria-pressed={nodeFilter === 'all'}
            onClick={() => setNodeFilter('all')}
            data-testid="can-messages-node-all"
          >
            All nodes
          </button>
          {nodes.map((entry) => (
            <button
              key={entry.nodeId}
              type="button"
              className={nodeFilter === entry.nodeId ? 'is-on' : undefined}
              aria-pressed={nodeFilter === entry.nodeId}
              onClick={() => setNodeFilter(entry.nodeId)}
              data-testid={`can-messages-node-${entry.nodeId}`}
            >
              {entry.nodeId} {entry.label}
            </button>
          ))}
        </div>
        <label className="can-monitor__field">
          <span>Find</span>
          <input
            type="search"
            value={search}
            placeholder="type name, e.g. esc"
            onChange={(event) => setSearch(event.target.value)}
            data-testid="can-messages-search"
          />
        </label>
      </div>

      <div className={`can-messages-page__body${selected ? ' has-inspector' : ''}`}>
        <CanMessagesView
          topics={shown}
          scope="bus"
          nodeLabel={nodeLabel}
          onShowFrames={onShowFrames}
          live={live}
          selectedKey={selectedKey}
          onSelect={(topic) => setSelectedKey((current) => (current === topic.key ? undefined : topic.key))}
        />
        {selected ? (
          <aside className="can-messages-page__inspector" aria-label="Message inspector" data-testid="can-message-inspector">
            <header>
              <strong title={selected.last.type?.fullName}>
                {selected.last.type ? dronecanDisplayName(selected.last.type.fullName) : `Type ${selected.dataTypeId}`}
                {selected.index ? ` #${selected.index.value}` : ''}
              </strong>
              <button type="button" className="can-monitor__icon-button" onClick={() => setSelectedKey(undefined)} aria-label="Close the inspector">
                ×
              </button>
            </header>
            <p className="can-messages-page__meta">
              {selected.last.type?.fullName ?? 'Not in this build’s DSDL'} · from {selected.sourceNodeId}
              {nodeLabel(selected.sourceNodeId) ? ` ${nodeLabel(selected.sourceNodeId)}` : ''} · {selected.count} received
            </p>
            {selected.last.problem ? <p className="can-messages__problem">⚠ {selected.last.problem}</p> : null}
            {tree ? (
              <DronecanFieldTree
                nodes={tree}
                onPlot={(node) => onPlotField(selected, node)}
                isPlotted={(node) => isPlotted(selected, node)}
              />
            ) : null}
            <button type="button" className="can-messages__frames" onClick={() => onShowFrames(selected)}>
              Show its frames
            </button>
          </aside>
        ) : null}
      </div>
    </div>
  )
}

/** The plot label for a field of a stream: "esc.Status rpm ← 50". */
export function canFieldSeriesLabel(topic: CanTopicEntry, node: DronecanFieldNode): string {
  const base = topic.last.type ? dronecanDisplayName(topic.last.type.fullName) : `Type ${topic.dataTypeId}`
  const name = topic.index ? `${base} #${topic.index.value}` : base
  return `${name} ${dronecanPathLabel(node.path)} ← ${topic.sourceNodeId}`
}
