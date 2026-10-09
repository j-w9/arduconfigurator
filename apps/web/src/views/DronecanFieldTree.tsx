// A decoded DroneCAN value as an expandable tree (field, value, constant
// meaning). Shared by the bus monitor's details pane and the message table.

import type { ReactNode } from 'react'

import type { DronecanFieldNode } from '../view-models/dronecan-field-tree'

export function DronecanFieldTree({
  nodes,
  depth = 0,
  onPlot,
  isPlotted
}: {
  nodes: readonly DronecanFieldNode[]
  depth?: number
  /** Offer a Plot button on every number. */
  onPlot?: (node: DronecanFieldNode) => void
  isPlotted?: (node: DronecanFieldNode) => boolean
}): ReactNode {
  return (
    <ul className="can-monitor__tree" role={depth === 0 ? 'tree' : 'group'}>
      {nodes.map((entry, index) => (
        <li key={`${entry.label}:${index}`} role="treeitem" aria-expanded={entry.children ? true : undefined}>
          {entry.children && entry.children.length > 0 ? (
            <details open={depth < 1}>
              <summary>
                <span className="can-monitor__tree-key" title={entry.typeLabel}>{entry.label}</span>
                <span className="can-monitor__dim"> {entry.typeLabel.includes('.') ? entry.typeLabel.slice(entry.typeLabel.lastIndexOf('.') + 1) : `${entry.children.length} items`}</span>
              </summary>
              <DronecanFieldTree nodes={entry.children} depth={depth + 1} onPlot={onPlot} isPlotted={isPlotted} />
            </details>
          ) : (
            <span className="can-monitor__tree-leaf">
              <span className="can-monitor__tree-key" title={entry.typeLabel}>{entry.label}</span>
              <span className="can-monitor__tree-value can-monitor__mono">{entry.text ?? ''}</span>
              {entry.meaning ? <span className="can-monitor__tree-meaning">{entry.meaning}</span> : null}
              {onPlot && entry.plottable ? (
                <button
                  type="button"
                  className={`can-monitor__tree-plot${isPlotted?.(entry) ? ' is-plotted' : ''}`}
                  onClick={() => onPlot(entry)}
                  disabled={isPlotted?.(entry)}
                  title={entry.elements ? 'Plot every element, a line each, on one chart' : undefined}
                  data-testid={`can-plot-field-${entry.path.join('.')}`}
                >
                  {isPlotted?.(entry) ? 'Plotted' : 'Plot'}
                </button>
              ) : null}
              {onPlot && entry.elements && entry.elements.length > 1 ? (
                // Or one element on its own.
                <span className="can-monitor__tree-elements">
                  {entry.elements.map((element) => (
                    <button
                      key={element.label}
                      type="button"
                      className={`can-monitor__tree-plot${isPlotted?.(element) ? ' is-plotted' : ''}`}
                      onClick={() => onPlot(element)}
                      disabled={isPlotted?.(element)}
                      title={`Plot ${entry.label}${element.label} on its own`}
                      data-testid={`can-plot-field-${element.path.join('.')}`}
                    >
                      {element.label}
                    </button>
                  ))}
                </span>
              ) : null}
            </span>
          )}
        </li>
      ))}
    </ul>
  )
}
