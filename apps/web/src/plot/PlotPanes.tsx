// Stacked charts over one time axis, as CAN ▸ Plot and the MAVLink Inspector
// show them. Each chart lists its series above it: a grip to drag the series
// onto another chart (or the strip below, for a chart of its own), and a
// Chart menu that does the same without dragging. Values follow the cursor.
// A chart's bottom edge drags to resize it.

import { useRef, useState, type DragEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'

import { PlotChart, type PlotBand, type PlotChartApi, type PlotDragMode, type PlotLane, type PlotMarker } from './PlotChart'
import { spectrum, spectrumPeak } from '../view-models/plot-spectrum'
import { PlotXYChart } from './PlotXYChart'
import {
  PLOT_DRAG_TYPE,
  PLOT_TRANSFORM_LABELS,
  clampPaneHeight,
  histogram,
  lanesAreDisparate,
  rangeStats,
  thinLane,
  transformTag,
  transformValues,
  valueAt,
  type PlotTransform,
  type PlotTransformKind
} from '../view-models/plot-workspace'

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
  /** Stretches of time shaded on every chart (flight modes). */
  bands?: readonly PlotBand[]
  /** Show min / max / mean / rate of each line over what is in view. */
  showStats?: boolean
  /** Something other than a series row dropped (a field from the side panel). */
  onDropPayload?: (paneId: string | undefined, payload: { kind?: string; [key: string]: unknown }) => void
  testIdPrefix: string
}

const TOOL_ICONS = {
  // Lucide (ISC) paths, as in the nav.
  zoom: '<path d="M5 3a2 2 0 0 0-2 2" /><path d="M19 3a2 2 0 0 1 2 2" /><path d="M21 19a2 2 0 0 1-2 2" /><path d="M5 21a2 2 0 0 1-2-2" /><path d="M9 3h1" /><path d="M9 21h1" /><path d="M14 3h1" /><path d="M14 21h1" /><path d="M3 9v1" /><path d="M21 9v1" /><path d="M3 14v1" /><path d="M21 14v1" />',
  pan: '<path d="M12 2v20" /><path d="m15 19-3 3-3-3" /><path d="m19 9 3 3-3 3" /><path d="M2 12h20" /><path d="m5 9-3 3 3 3" /><path d="m9 5 3-3 3 3" />',
  zoomIn: '<circle cx="11" cy="11" r="8" /><line x1="21" x2="16.65" y1="21" y2="16.65" /><line x1="11" x2="11" y1="8" y2="14" /><line x1="8" x2="14" y1="11" y2="11" />',
  zoomOut: '<circle cx="11" cy="11" r="8" /><line x1="21" x2="16.65" y1="21" y2="16.65" /><line x1="8" x2="14" y1="11" y2="11" />',
  autoscale: '<path d="M15 3h6v6" /><path d="M9 21H3v-6" /><path d="M21 3l-7 7" /><path d="M3 21l7-7" />',
  home: '<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8" /><path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />',
  axes: '<path d="M3 3v18h18" /><path d="M7 3v18" /><path d="M21 3v18" />',
  range: '<path d="M8 3H5a2 2 0 0 0-2 2v3" /><path d="M21 8V5a2 2 0 0 0-2-2h-3" /><path d="M3 16v3a2 2 0 0 0 2 2h3" /><path d="M16 21h3a2 2 0 0 0 2-2v-3" /><path d="M7 12h10" />',
  png: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" /><circle cx="12" cy="13" r="3" />'
} as const

function ToolIcon({ name }: { name: keyof typeof TOOL_ICONS }): ReactNode {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      // Static path data from the table above -- never user input.
      dangerouslySetInnerHTML={{ __html: TOOL_ICONS[name] }}
    />
  )
}

/** Scale a range about its middle: 0.5 zooms in, 2 zooms out. */
function scaleRange([from, to]: readonly [number, number], factor: number): [number, number] {
  const middle = (from + to) / 2
  const half = ((to - from) / 2) * factor
  return [middle - half, middle + half]
}

/**
 * One time chart with its toolbar, as the web plotting tools have it: box
 * zoom or pan for a drag, zoom in / out about the middle, reset, and save as
 * PNG. Time is shared by every chart (the workspace's range); the value
 * range is this chart's own.
 */
function PaneChart(props: {
  lanes: readonly PlotLane[]
  name: string
  markers?: readonly PlotMarker[]
  bands?: readonly PlotBand[]
  height: number
  syncKey: string
  xRange?: readonly [number, number]
  onXRangeChange?: (range: readonly [number, number] | undefined) => void
  xFormat: (value: number) => string
  onCursor: (x: number | undefined) => void
  testIdPrefix: string
}): ReactNode {
  const { xRange, onXRangeChange, testIdPrefix } = props
  const api = useRef<PlotChartApi | null>(null)
  const [dragMode, setDragMode] = useState<PlotDragMode>('zoom')
  const [yRange, setYRange] = useState<readonly [number, number] | undefined>(undefined)
  // Separate value axes: on by default when the lines differ wildly in size; the toolbar overrides.
  const [scaleChoice, setScaleChoice] = useState<'auto' | 'shared' | 'separate'>('auto')
  // Typing a value range (PlotJuggler's "edit range").
  const [rangeForm, setRangeForm] = useState<{ min: string; max: string } | undefined>(undefined)
  const openRangeForm = () => {
    const current = yRange ?? api.current?.scales()?.y
    setRangeForm(rangeForm ? undefined : { min: current ? String(Number.parseFloat(current[0].toPrecision(6))) : '', max: current ? String(Number.parseFloat(current[1].toPrecision(6))) : '' })
  }
  const disparate = props.lanes.length >= 2 && lanesAreDisparate(props.lanes, xRange?.[0], xRange?.[1])
  const separate = props.lanes.length >= 2 && (scaleChoice === 'separate' || (scaleChoice === 'auto' && disparate))
  const zoomBy = (factor: number) => {
    const scales = api.current?.scales()
    if (!scales) return
    onXRangeChange?.(scaleRange(scales.x, factor))
    setYRange(scaleRange(scales.y, factor))
  }
  const savePng = () => {
    const background = getComputedStyle(document.documentElement).getPropertyValue('--bg-panel').trim() || '#11151c'
    const url = api.current?.png(background)
    if (!url) return
    const link = document.createElement('a')
    link.href = url
    link.download = `${props.name.replace(/[^\w.-]+/g, '_').slice(0, 60) || 'chart'}.png`
    link.click()
  }
  const tool = (label: string, icon: keyof typeof TOOL_ICONS, onClick: () => void, extra: { pressed?: boolean; disabled?: boolean; id: string }) => (
    <button
      type="button"
      className={`plot-panes__tool${extra.pressed ? ' is-active' : ''}`}
      onClick={onClick}
      disabled={extra.disabled}
      aria-pressed={extra.pressed}
      aria-label={label}
      title={label}
      data-testid={`${testIdPrefix}-tool-${extra.id}`}
    >
      <ToolIcon name={icon} />
    </button>
  )
  const zoomable = onXRangeChange !== undefined
  return (
    <div className="plot-panes__chart-wrap">
      <div className="plot-panes__toolbar" role="toolbar" aria-label="Chart tools">
        {tool('Save as PNG', 'png', savePng, { id: 'png' })}
        {tool('Box zoom: drag across for time, up or down for values, diagonally for both', 'zoom', () => setDragMode('zoom'), { pressed: dragMode === 'zoom', disabled: !zoomable, id: 'zoom' })}
        {tool('Pan: drag to move the view', 'pan', () => setDragMode('pan'), { pressed: dragMode === 'pan', disabled: !zoomable, id: 'pan' })}
        {tool('Zoom in', 'zoomIn', () => zoomBy(0.5), { disabled: !zoomable, id: 'zoom-in' })}
        {tool('Zoom out', 'zoomOut', () => zoomBy(2), { disabled: !zoomable, id: 'zoom-out' })}
        {tool('Autoscale: fit the values to what is in view', 'autoscale', () => setYRange(undefined), { disabled: yRange === undefined, id: 'autoscale' })}
        {tool('Reset axes (or double-click the chart)', 'home', () => {
          onXRangeChange?.(undefined)
          setYRange(undefined)
        }, { disabled: !zoomable, id: 'reset' })}
        {tool('Set the value range', 'range', openRangeForm, { pressed: rangeForm !== undefined, disabled: separate, id: 'range' })}
        {props.lanes.length >= 2
          ? tool(
              separate
                ? 'Separate scales (on): each line its own axis. Click for one shared axis'
                : 'Separate scales: each line its own axis, so 100000 and a 0/1 state both read',
              'axes',
              () => setScaleChoice(separate ? 'shared' : 'separate'),
              { pressed: separate, id: 'scales' }
            )
          : null}
      </div>
      {rangeForm ? (
        <form
          className="plot-panes__range-form"
          onSubmit={(event) => {
            event.preventDefault()
            const min = Number(rangeForm.min)
            const max = Number(rangeForm.max)
            if (Number.isFinite(min) && Number.isFinite(max) && max > min) {
              setYRange([min, max])
              setRangeForm(undefined)
            }
          }}
          data-testid={`${testIdPrefix}-range-form`}
        >
          <label>
            Min
            <input type="number" step="any" value={rangeForm.min} onChange={(event) => setRangeForm({ ...rangeForm, min: event.target.value })} data-testid={`${testIdPrefix}-range-min`} />
          </label>
          <label>
            Max
            <input type="number" step="any" value={rangeForm.max} onChange={(event) => setRangeForm({ ...rangeForm, max: event.target.value })} data-testid={`${testIdPrefix}-range-max`} />
          </label>
          <button type="submit" className="can-monitor__tool" disabled={!(Number(rangeForm.max) > Number(rangeForm.min))} data-testid={`${testIdPrefix}-range-set`}>
            Set
          </button>
          <button type="button" className="can-monitor__tool" onClick={() => setRangeForm(undefined)}>
            Cancel
          </button>
        </form>
      ) : null}
      <PlotChart
        className="plot-panes__chart"
        lanes={props.lanes}
        markers={props.markers}
        bands={props.bands}
        height={props.height}
        syncKey={props.syncKey}
        xRange={xRange}
        onXRangeChange={onXRangeChange}
        yRange={yRange}
        onYRangeChange={zoomable ? setYRange : undefined}
        dragMode={dragMode}
        separateScales={separate}
        api={api}
        xFormat={props.xFormat}
        onCursor={(cursor) => props.onCursor(cursor?.x)}
      />
    </div>
  )
}

/**
 * The chart's lines as frequency spectra over what is in view (FFT view),
 * with the strongest frequency named. Its own zoom: frequency, not time.
 */
function FftOf(props: { lanes: readonly PlotLane[]; xRange?: readonly [number, number]; height: number; name: string; testIdPrefix: string }): ReactNode {
  const [zoom, setZoom] = useState<readonly [number, number] | undefined>(undefined)
  const spectra = props.lanes.map((lane) => ({ lane, result: spectrum(lane.t, lane.v, props.xRange?.[0], props.xRange?.[1]) }))
  const shown = spectra.filter((entry): entry is { lane: PlotLane; result: NonNullable<typeof entry.result> } => entry.result !== undefined)
  if (shown.length === 0) {
    return (
      <p className="plot-panes__fft-empty" data-testid={`${props.testIdPrefix}-fft-chart`}>
        Too few points in view for a spectrum. Widen the window, or wait for more samples.
      </p>
    )
  }
  return (
    <div data-testid={`${props.testIdPrefix}-fft-chart`}>
      <p className="plot-panes__fft-peaks">
        {shown.map(({ lane, result }) => {
          const peak = spectrumPeak(result)
          return (
            <span key={lane.key ?? lane.label} style={{ color: lane.color }}>
              {lane.label}: peak {peak ? `${peak.hz.toFixed(peak.hz < 10 ? 2 : 1)} Hz` : '—'}
              <span className="plot-panes__fft-rate"> · {result.sampleRateHz.toFixed(1)} Hz sampling</span>
            </span>
          )
        })}
      </p>
      <PlotChart
        className="plot-panes__chart"
        lanes={shown.map(({ lane, result }) => ({ label: lane.label, color: lane.color, key: lane.key, t: result.hz, v: result.amplitude }))}
        height={props.height}
        xRange={zoom}
        onXRangeChange={setZoom}
        xFormat={(value) => `${Number.parseFloat(value.toPrecision(3))} Hz`}
      />
    </div>
  )
}

/** A transformed line's tag and value (at the cursor, else the latest) beside its own. */
function TransformedValue(props: { row: PlotSeriesRow; lanes: readonly PlotLane[]; transform?: PlotTransform; cursorX?: number }): ReactNode {
  const tag = transformTag(props.transform)
  if (!tag) return null
  const own = props.lanes.filter((lane) => (lane.key ?? lane.label) === props.row.key)
  // A vector's elements each transform; one value only reads for a single line.
  const lane = own.length === 1 ? own[0] : undefined
  const values = lane ? transformValues(lane.t, lane.v, props.transform) : undefined
  const value =
    lane && values ? (props.cursorX !== undefined && lane.t.length > 0 && props.cursorX >= lane.t[0] ? valueAt(lane.t, values, props.cursorX) : values[values.length - 1]) : undefined
  return (
    <span className="plot-panes__transformed" data-testid="plot-transformed">
      <span className="plot-panes__transform-tag">{tag}</span>
      {value !== undefined && Number.isFinite(value) ? <span className="plot-series__value">{formatStat(value)}</span> : null}
    </span>
  )
}

/** The ƒ menu on a line: how its values are transformed before drawing. */
function TransformMenu(props: { transform?: PlotTransform; onChange: (transform: PlotTransform) => void; label: string; testId: string }): ReactNode {
  const transform = props.transform ?? { kind: 'none' as const }
  return (
    <span className="plot-panes__transform">
      <select
        className={`plot-panes__transform-menu${transform.kind !== 'none' ? ' is-active' : ''}`}
        value={transform.kind}
        onChange={(event) => {
          const kind = event.target.value as PlotTransformKind
          props.onChange(kind === 'scale' ? { kind, factor: transform.factor ?? 1, offset: transform.offset ?? 0 } : kind === 'smooth' ? { kind, windowS: transform.windowS ?? 0.5 } : { kind })
        }}
        aria-label={`Transform ${props.label}`}
        title="Transform this line: rate of change, integral, smoothed, absolute, scale & offset"
        data-testid={props.testId}
      >
        {(Object.keys(PLOT_TRANSFORM_LABELS) as PlotTransformKind[]).map((kind) => (
          <option key={kind} value={kind}>
            {kind === 'none' ? 'ƒ' : PLOT_TRANSFORM_LABELS[kind]}
          </option>
        ))}
      </select>
      {transform.kind === 'scale' ? (
        <>
          <label>
            ×
            <input type="number" step="any" value={transform.factor ?? 1} onChange={(event) => props.onChange({ ...transform, factor: Number(event.target.value) || 0 })} aria-label="Factor" />
          </label>
          <label>
            +
            <input type="number" step="any" value={transform.offset ?? 0} onChange={(event) => props.onChange({ ...transform, offset: Number(event.target.value) || 0 })} aria-label="Offset" />
          </label>
        </>
      ) : null}
      {transform.kind === 'smooth' ? (
        <label>
          <input
            type="number"
            step="0.1"
            min="0.05"
            value={transform.windowS ?? 0.5}
            onChange={(event) => props.onChange({ ...transform, windowS: Math.max(0.05, Number(event.target.value) || 0.5) })}
            aria-label="Window, seconds"
          />
          s
        </label>
      ) : null}
    </span>
  )
}

/** The values in view as a histogram: where each line spends its time. */
function HistogramOf(props: { lanes: readonly PlotLane[]; xRange?: readonly [number, number]; height: number; testIdPrefix: string }): ReactNode {
  const result = histogram(props.lanes, props.xRange?.[0], props.xRange?.[1])
  if (!result) {
    return (
      <p className="plot-panes__fft-empty" data-testid={`${props.testIdPrefix}-hist-chart`}>
        No values in view.
      </p>
    )
  }
  return (
    <div data-testid={`${props.testIdPrefix}-hist-chart`}>
      <PlotChart
        className="plot-panes__chart"
        lanes={props.lanes.map((lane, index) => ({ label: lane.label, color: lane.color, key: lane.key, t: result.centers, v: result.counts[index] }))}
        height={props.height}
        bars
        xFormat={(value) => formatStat(value)}
      />
    </div>
  )
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
  const [fft, setFft] = useState<ReadonlySet<string>>(new Set())
  const [hist, setHist] = useState<ReadonlySet<string>>(new Set())
  // Per-line transforms (PlotJuggler's curve functions), by series key.
  const [transforms, setTransforms] = useState<ReadonlyMap<string, PlotTransform>>(new Map())
  const setTransform = (key: string, transform: PlotTransform) =>
    setTransforms((current) => {
      const next = new Map(current)
      if (transform.kind === 'none') next.delete(key)
      else next.set(key, transform)
      return next
    })
  const transformLane = (lane: PlotLane): PlotLane => {
    const transform = transforms.get(lane.key ?? lane.label)
    return transform ? { ...lane, v: transformValues(lane.t, lane.v, transform) } : lane
  }
  // Lines hidden by clicking their swatch (series key, or label for a keyless lane).
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set())
  const toggleHidden = (key: string) =>
    setHidden((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
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
              <li key={row.key} className={`plot-panes__row${hidden.has(row.key) ? ' is-hidden' : ''}`} data-testid={row.testId}>
                <span
                  className="plot-panes__grip"
                  {...plotDragProps(JSON.stringify({ kind: 'series', key: row.key }))}
                  title={`Drag ${row.label} onto another chart to overlay it, or onto the strip below for its own`}
                  aria-hidden="true"
                  data-testid={`${testIdPrefix}-grip`}
                >
                  ⋮⋮
                </span>
                <button
                  type="button"
                  className={`plot-panes__swatch-button${hidden.has(row.key) ? ' is-hidden' : ''}`}
                  onClick={() => toggleHidden(row.key)}
                  aria-pressed={!hidden.has(row.key)}
                  aria-label={hidden.has(row.key) ? `Show ${row.label}` : `Hide ${row.label}`}
                  title={hidden.has(row.key) ? 'Show this line' : 'Hide this line'}
                  data-testid={`${testIdPrefix}-visibility`}
                >
                  <span className="plot-panes__swatch" style={{ background: row.color }} aria-hidden="true" />
                </button>
                <div className="plot-panes__content">
                  {row.content(cursorX)}
                  <TransformedValue row={row} lanes={pane.lanes} transform={transforms.get(row.key)} cursorX={cursorX} />
                </div>
                <TransformMenu
                  transform={transforms.get(row.key)}
                  onChange={(transform) => setTransform(row.key, transform)}
                  label={row.label}
                  testId={`${testIdPrefix}-transform`}
                />
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
          {(() => {
            // Lines hidden from the legend stay listed (dimmed) but leave the chart.
            const lanes = pane.lanes.filter((lane) => !hidden.has(lane.key ?? lane.label)).map(transformLane)
            const kind = fft.has(pane.id) ? 'fft' : hist.has(pane.id) ? 'hist' : xy.has(pane.id) && lanes.length >= 2 ? 'xy' : 'time'
            const setKind = (next: 'time' | 'xy' | 'fft' | 'hist') => {
              setPaneXy(pane.id, next === 'xy' ? xy.get(pane.id) ?? { x: 0, y: 1 } : undefined)
              const toggle = (kindName: 'fft' | 'hist') => (current: ReadonlySet<string>) => {
                const copy = new Set(current)
                if (next === kindName) copy.add(pane.id)
                else copy.delete(pane.id)
                return copy
              }
              setFft(toggle('fft'))
              setHist(toggle('hist'))
            }
            return (
              <>
                <div className="plot-panes__mode">
                  <div className="plot-panes__mode-switch" role="radiogroup" aria-label="Chart kind">
                    <button type="button" role="radio" aria-checked={kind === 'time'} className={kind === 'time' ? 'is-active' : undefined} onClick={() => setKind('time')}>
                      Time
                    </button>
                    {lanes.length >= 2 ? (
                      <button
                        type="button"
                        role="radio"
                        aria-checked={kind === 'xy'}
                        className={kind === 'xy' ? 'is-active' : undefined}
                        onClick={() => setKind('xy')}
                        title="One line against another: x against y of a magnetometer traces a circle as the craft turns"
                        data-testid={`${testIdPrefix}-xy`}
                      >
                        XY
                      </button>
                    ) : null}
                    <button
                      type="button"
                      role="radio"
                      aria-checked={kind === 'fft'}
                      className={kind === 'fft' ? 'is-active' : undefined}
                      onClick={() => setKind('fft')}
                      title="Frequency spectrum of what is in view: which frequencies a vibration or an rpm wobble holds"
                      data-testid={`${testIdPrefix}-fft`}
                    >
                      FFT
                    </button>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={kind === 'hist'}
                      className={kind === 'hist' ? 'is-active' : undefined}
                      onClick={() => setKind('hist')}
                      title="How the values in view are spread: where a line spends its time"
                      data-testid={`${testIdPrefix}-hist`}
                    >
                      Histogram
                    </button>
                  </div>
                  {kind === 'xy' ? (
                    <>
                      {(['x', 'y'] as const).map((axis) => (
                        <label key={axis} className="plot-panes__mode-pick">
                          <span>{axis.toUpperCase()}</span>
                          <select
                            value={xy.get(pane.id)![axis]}
                            onChange={(event) => setPaneXy(pane.id, { ...xy.get(pane.id)!, [axis]: Number(event.target.value) })}
                            data-testid={`${testIdPrefix}-xy-${axis}`}
                          >
                            {lanes.map((lane, index) => (
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
                {props.showStats ? <PaneStats lanes={lanes} xRange={xRange} /> : null}
                {kind === 'xy' ? (
                  <XYOf pane={{ ...pane, lanes }} pick={xy.get(pane.id)!} xRange={xRange} testId={`${testIdPrefix}-xy-chart`} />
                ) : kind === 'fft' ? (
                  <FftOf lanes={lanes} xRange={xRange} height={pane.height} name={paneName(pane)} testIdPrefix={testIdPrefix} />
                ) : kind === 'hist' ? (
                  <HistogramOf lanes={lanes} xRange={xRange} height={pane.height} testIdPrefix={testIdPrefix} />
                ) : (
                  <PaneChart
                    // Long lines are thinned to their pixels (spikes kept) before drawing.
                    lanes={lanes.map((lane) => thinLane(lane, xRange?.[0], xRange?.[1]))}
                    name={paneName(pane)}
                    markers={props.markers}
                    bands={props.bands}
                    height={pane.height}
                    syncKey={syncKey}
                    xRange={xRange}
                    onXRangeChange={onXRangeChange}
                    xFormat={xFormat}
                    onCursor={setCursorX}
                    testIdPrefix={testIdPrefix}
                  />
                )}
              </>
            )
          })()}
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
