// Stacked charts over one time axis, as CAN ▸ Plot and the MAVLink Inspector
// show them. Each chart lists its series above it: a grip to drag the series
// onto another chart (or the strip below, for a chart of its own), and a
// Chart menu that does the same without dragging. Values follow the cursor.
// A chart's bottom edge drags to resize it.

import { useRef, useState, type DragEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'

import { PlotChart, type PlotLane } from './PlotChart'
import { PLOT_DRAG_TYPE, clampPaneHeight } from '../view-models/plot-workspace'

export interface PlotSeriesRow {
  key: string
  /** For the Chart menu ("With <label>") and the grip's tooltip. */
  label: string
  color: string
  /** The row's own content (name, value, actions); gets the cursor's x, when the cursor is on a chart. */
  content: (cursorX: number | undefined) => ReactNode
  testId?: string
}

export interface PlotPaneModel {
  id: string
  /** Pixels. */
  height: number
  rows: readonly PlotSeriesRow[]
  lanes: readonly PlotLane[]
}

export interface PlotPanesProps {
  panes: readonly PlotPaneModel[]
  syncKey: string
  xRange?: readonly [number, number]
  /** Drag-select zoom; leave out where the range is fixed (live). */
  onXRangeChange?: (range: readonly [number, number] | undefined) => void
  xFormat: (value: number) => string
  onMoveSeries: (key: string, paneId: string | undefined) => void
  onPaneHeight: (paneId: string, height: number) => void
  /** Something other than a series row dropped (a field from the side panel). */
  onDropPayload?: (paneId: string | undefined, payload: { kind?: string; [key: string]: unknown }) => void
  testIdPrefix: string
}

/** Make an element draggable onto the charts, carrying this payload. */
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
  const { panes, syncKey, xRange, onXRangeChange, xFormat, onMoveSeries, onPaneHeight, testIdPrefix } = props
  const [dropTarget, setDropTarget] = useState<string | undefined>(undefined)
  const [cursorX, setCursorX] = useState<number | undefined>(undefined)
  const resizing = useRef<{ paneId: string; startY: number; startHeight: number } | undefined>(undefined)

  const drop = (paneId: string | undefined, raw: string) => {
    let payload: { kind?: string; key?: string; [key: string]: unknown }
    try {
      payload = JSON.parse(raw)
    } catch {
      return
    }
    if (payload.kind === 'series' && typeof payload.key === 'string') onMoveSeries(payload.key, paneId)
    else props.onDropPayload?.(paneId, payload)
  }

  const dropProps = (paneId: string | undefined) => ({
    onDragOver: (event: DragEvent) => {
      if (!event.dataTransfer.types.includes(PLOT_DRAG_TYPE)) return
      event.preventDefault()
      setDropTarget(paneId ?? '')
    },
    onDragLeave: (event: DragEvent) => {
      if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
      setDropTarget(undefined)
    },
    onDrop: (event: DragEvent) => {
      setDropTarget(undefined)
      const raw = event.dataTransfer.getData(PLOT_DRAG_TYPE)
      if (!raw) return
      event.preventDefault()
      drop(paneId, raw)
    }
  })

  const startResize = (pane: PlotPaneModel) => (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    resizing.current = { paneId: pane.id, startY: event.clientY, startHeight: pane.height }
  }
  const moveResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    const active = resizing.current
    if (!active) return
    onPaneHeight(active.paneId, clampPaneHeight(active.startHeight + event.clientY - active.startY))
  }
  const endResize = () => {
    resizing.current = undefined
  }

  // "With <first series>" names a chart in the menu.
  const paneName = (pane: PlotPaneModel) => (pane.rows.length > 1 ? `${pane.rows[0].label} +${pane.rows.length - 1}` : pane.rows[0]?.label ?? 'chart')

  return (
    <div className="plot-panes">
      {panes.map((pane) => (
        <article key={pane.id} className={`plot-panes__pane${dropTarget === pane.id ? ' is-drop' : ''}`} {...dropProps(pane.id)} data-testid={`${testIdPrefix}-pane`}>
          <ul className="plot-panes__rows">
            {pane.rows.map((row) => (
              <li key={row.key} className="plot-panes__row" data-testid={row.testId}>
                <span
                  className="plot-panes__grip"
                  {...plotDragProps(JSON.stringify({ kind: 'series', key: row.key }))}
                  title={`Drag ${row.label} onto another chart to overlay it, or onto the strip below for its own`}
                  aria-hidden="true"
                  data-testid={`${testIdPrefix}-grip`}
                >
                  ⋮⋮
                </span>
                <span className="plot-panes__swatch" style={{ background: row.color }} aria-hidden="true" />
                <div className="plot-panes__content">{row.content(cursorX)}</div>
                {panes.length > 1 || pane.rows.length > 1 ? (
                  <select
                    className="plot-panes__chart-menu"
                    value={pane.id}
                    onChange={(event) => onMoveSeries(row.key, event.target.value === '' ? undefined : event.target.value)}
                    aria-label={`Chart for ${row.label}`}
                    title="Which chart this series is on"
                    data-testid={`${testIdPrefix}-chart-menu`}
                  >
                    <option value={pane.id}>{pane.rows.length > 1 ? 'Shared chart' : 'Own chart'}</option>
                    {pane.rows.length > 1 ? <option value="">Own chart</option> : null}
                    {panes
                      .filter((other) => other.id !== pane.id)
                      .map((other) => (
                        <option key={other.id} value={other.id}>
                          With {paneName(other)}
                        </option>
                      ))}
                  </select>
                ) : null}
              </li>
            ))}
          </ul>
          <PlotChart
            className="plot-panes__chart"
            lanes={pane.lanes}
            height={pane.height}
            syncKey={syncKey}
            xRange={xRange}
            onXRangeChange={onXRangeChange}
            xFormat={xFormat}
            onCursor={(cursor) => setCursorX(cursor?.x)}
          />
          <div
            className="plot-panes__resize"
            onPointerDown={startResize(pane)}
            onPointerMove={moveResize}
            onPointerUp={endResize}
            onPointerCancel={endResize}
            role="separator"
            aria-orientation="horizontal"
            aria-label="Drag to resize the chart"
            title="Drag to resize"
          />
        </article>
      ))}
      <div className={`plot-panes__new${dropTarget === '' ? ' is-drop' : ''}`} {...dropProps(undefined)} data-testid={`${testIdPrefix}-new-pane`}>
        Drop here for a chart of its own
      </div>
    </div>
  )
}
