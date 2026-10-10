// Stacked plot panes over one time axis: the workspace CAN ▸ Plot and the
// MAVLink Inspector share. Each pane is one PlotChart with its series' rows
// above it (the surface renders those rows: names, live values, remove).
// Drag a series row onto another pane to overlay it there, or onto the strip
// below for a pane of its own; a field dragged in from a picker lands the
// same way. All panes share the cursor and, when the surface allows it, a
// drag-to-zoom range.

import { useState, type DragEvent, type ReactNode } from 'react'

import { PlotChart, type PlotLane } from './PlotChart'
import { PLOT_DRAG_TYPE, PLOT_PANE_PIXELS, type PlotPaneHeight } from '../view-models/plot-workspace'

export interface PlotPaneModel {
  id: string
  height: PlotPaneHeight
  /** The series' rows over the chart. */
  rows: ReactNode
  lanes: readonly PlotLane[]
}

export interface PlotPanesProps {
  panes: readonly PlotPaneModel[]
  syncKey: string
  xRange?: readonly [number, number]
  /** Drag-select zoom; leave out where the range is fixed (live). */
  onXRangeChange?: (range: readonly [number, number] | undefined) => void
  xFormat: (value: number) => string
  onPaneHeight: (paneId: string, height: PlotPaneHeight) => void
  /** Something dropped (PLOT_DRAG_TYPE payload) on a pane, or on the new-pane strip (undefined). */
  onDrop: (paneId: string | undefined, payload: string) => void
  /** Class prefix, so a surface can keep its own look. */
  className?: string
  testIdPrefix: string
}

/** Make a row draggable with a payload the panes understand. */
export function plotDragProps(payload: string) {
  return {
    draggable: true,
    onDragStart: (event: DragEvent) => {
      event.dataTransfer.setData(PLOT_DRAG_TYPE, payload)
      event.dataTransfer.effectAllowed = 'copyMove'
    }
  }
}

export function PlotPanes(props: PlotPanesProps): ReactNode {
  const { panes, syncKey, xRange, onXRangeChange, xFormat, onPaneHeight, onDrop, testIdPrefix } = props
  const [dropTarget, setDropTarget] = useState<string | undefined>(undefined)

  const dropProps = (paneId: string | undefined) => ({
    onDragOver: (event: DragEvent) => {
      if (!event.dataTransfer.types.includes(PLOT_DRAG_TYPE)) return
      event.preventDefault()
      setDropTarget(paneId ?? '')
    },
    onDragLeave: (event: DragEvent) => {
      // Leaving for a child is not leaving.
      if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
      setDropTarget(undefined)
    },
    onDrop: (event: DragEvent) => {
      setDropTarget(undefined)
      const payload = event.dataTransfer.getData(PLOT_DRAG_TYPE)
      if (!payload) return
      event.preventDefault()
      onDrop(paneId, payload)
    }
  })

  return (
    <div className={`plot-panes ${props.className ?? ''}`}>
      {panes.map((pane) => (
        <article key={pane.id} className={`plot-panes__pane${dropTarget === pane.id ? ' is-drop' : ''}`} {...dropProps(pane.id)} data-testid={`${testIdPrefix}-pane`}>
          <div className="plot-panes__head">
            <div className="plot-panes__rows">{pane.rows}</div>
            <div className="plot-panes__heights" role="radiogroup" aria-label="Chart height">
              {(['s', 'm', 'l'] as const).map((height) => (
                <button
                  key={height}
                  type="button"
                  role="radio"
                  aria-checked={pane.height === height}
                  className={pane.height === height ? 'is-active' : undefined}
                  onClick={() => onPaneHeight(pane.id, height)}
                  title={height === 's' ? 'Short' : height === 'm' ? 'Medium' : 'Tall'}
                >
                  {height.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
          <PlotChart
            className="plot-panes__chart"
            lanes={pane.lanes}
            height={PLOT_PANE_PIXELS[pane.height]}
            syncKey={syncKey}
            xRange={xRange}
            onXRangeChange={onXRangeChange}
            xFormat={xFormat}
          />
        </article>
      ))}
      <div className={`plot-panes__new${dropTarget === '' ? ' is-drop' : ''}`} {...dropProps(undefined)} data-testid={`${testIdPrefix}-new-pane`}>
        Drag a series here for a chart of its own, or onto another chart to overlay it
      </div>
    </div>
  )
}
