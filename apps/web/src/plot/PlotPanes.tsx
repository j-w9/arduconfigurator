// Stacked charts over one time axis, as CAN ▸ Plot and the MAVLink Inspector
// show them. Each chart lists its series above it: a grip to drag the series
// onto another chart (or the strip below, for a chart of its own), and a
// Chart menu that does the same without dragging. Values follow the cursor.
// A chart's bottom edge drags to resize it.

import { useRef, useState, type DragEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'

import { PlotChart, type PlotLane, type PlotMarker } from './PlotChart'
import { PlotXYChart } from './PlotXYChart'
import { PLOT_DRAG_TYPE, clampPaneHeight, rangeStats, thinLane, valueAt } from '../view-models/plot-workspace'

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
  /** Moments to mark on every chart's time axis. */
  markers?: readonly PlotMarker[]
  /** Show min / max / mean / rate of each line over what is in view. */
  showStats?: boolean
  /** Something other than a series row dropped (a field from the side panel). */
  onDropPayload?: (paneId: string | undefined, payload: { kind?: string; [key: string]: unknown }) => void
  testIdPrefix: string
}

function formatStat(value: number): string {
  return Math.abs(value) >= 1e5 || (Math.abs(value) < 1e-3 && value !== 0) ? value.toExponential(2) : Number.parseFloat(value.toPrecision(5)).toString()
}

/** Min / max / mean / rate of each line over what is in view. */
function PaneStats({ lanes, xRange }: { lanes: readonly PlotLane[]; xRange?: readonly [number, number] }): ReactNode {
  return (
    <table className="plot-panes__stats" data-testid="plot-pane-stats">
      <thead>
        <tr>
          <th scope="col">In view</th>
          <th scope="col">min</th>
          <th scope="col">max</th>
          <th scope="col">mean</th>
          <th scope="col">rate</th>
        </tr>
      </thead>
      <tbody>
        {lanes.map((lane, index) => {
          const stats = rangeStats(lane.t, lane.v, xRange?.[0] ?? Number.NEGATIVE_INFINITY, xRange?.[1] ?? Number.POSITIVE_INFINITY)
          return (
            <tr key={index}>
              <th scope="row">
                <span className="plot-panes__swatch" style={{ background: lane.color }} aria-hidden="true" /> {lane.label}
              </th>
              <td>{stats ? formatStat(stats.min) : '—'}</td>
              <td>{stats ? formatStat(stats.max) : '—'}</td>
              <td>{stats ? formatStat(stats.mean) : '—'}</td>
              <td>{stats ? `${stats.rateHz.toFixed(1)} Hz` : '—'}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

/** The pane's two chosen lines as XY, over what is in view; y read at x's times when the clocks differ. */
function XYOf({ pane, pick, xRange, testId }: { pane: PlotPaneModel; pick: { x: number; y: number }; xRange?: readonly [number, number]; testId: string }): ReactNode {
  const xLane = pane.lanes[pick.x] ?? pane.lanes[0]
  const yLane = pane.lanes[pick.y] ?? pane.lanes[1]
  const xs: number[] = []
  const ys: number[] = []
  for (let index = 0; index < xLane.t.length; index += 1) {
    const time = xLane.t[index]
    if (xRange && (time < xRange[0] || time > xRange[1])) continue
    xs.push(xLane.v[index])
    ys.push(yLane.t === xLane.t ? yLane.v[index] : valueAt(yLane.t, yLane.v, time) ?? Number.NaN)
  }
  return <PlotXYChart x={xs} y={ys} color={yLane.color} xLabel={xLane.label} yLabel={yLane.label} height={Math.max(pane.height, 220)} testId={testId} />
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
  // Charts drawn as XY (lane indexes for x and y), by pane.
  const [xy, setXy] = useState<ReadonlyMap<string, { x: number; y: number }>>(new Map())
  const setPaneXy = (paneId: string, value: { x: number; y: number } | undefined) =>
    setXy((current) => {
      const next = new Map(current)
      if (value) next.set(paneId, value)
      else next.delete(paneId)
      return next
    })

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
                    {/* The current choice reads as a short "Chart" button; the list says where it can go. */}
                    <option value={pane.id}>Chart</option>
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
          {pane.lanes.length >= 2 ? (
            <div className="plot-panes__mode">
              <div className="plot-panes__mode-switch" role="radiogroup" aria-label="Chart kind">
                <button type="button" role="radio" aria-checked={!xy.has(pane.id)} className={!xy.has(pane.id) ? 'is-active' : undefined} onClick={() => setPaneXy(pane.id, undefined)}>
                  Time
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={xy.has(pane.id)}
                  className={xy.has(pane.id) ? 'is-active' : undefined}
                  onClick={() => setPaneXy(pane.id, { x: 0, y: 1 })}
                  title="One line against another: x against y of a magnetometer traces a circle as the craft turns"
                  data-testid={`${testIdPrefix}-xy`}
                >
                  XY
                </button>
              </div>
              {xy.has(pane.id) ? (
                <>
                  {(['x', 'y'] as const).map((axis) => (
                    <label key={axis} className="plot-panes__mode-pick">
                      <span>{axis.toUpperCase()}</span>
                      <select
                        value={xy.get(pane.id)![axis]}
                        onChange={(event) => setPaneXy(pane.id, { ...xy.get(pane.id)!, [axis]: Number(event.target.value) })}
                        data-testid={`${testIdPrefix}-xy-${axis}`}
                      >
                        {pane.lanes.map((lane, index) => (
                          <option key={index} value={index}>
                            {lane.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                </>
              ) : null}
            </div>
          ) : null}
          {props.showStats ? <PaneStats lanes={pane.lanes} xRange={xRange} /> : null}
          {xy.has(pane.id) ? (
            <XYOf pane={pane} pick={xy.get(pane.id)!} xRange={xRange} testId={`${testIdPrefix}-xy-chart`} />
          ) : (
            <PlotChart
              className="plot-panes__chart"
              // Long lines are thinned to their pixels (spikes kept) before drawing.
              lanes={pane.lanes.map((lane) => thinLane(lane, xRange?.[0], xRange?.[1]))}
              markers={props.markers}
              height={pane.height}
              syncKey={syncKey}
              xRange={xRange}
              onXRangeChange={onXRangeChange}
              xFormat={xFormat}
              onCursor={(cursor) => setCursorX(cursor?.x)}
            />
          )}
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
