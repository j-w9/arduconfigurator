// The one chart every plot in the app draws with: CAN Plot, the MAVLink
// Inspector, and the log graphs. uPlot (MIT) underneath -- canvas, built for
// millions of points, which is what scrubbing a whole flight log needs.
//
// Each lane brings its own timestamps (streams and log messages do not tick
// together); lanes that share one time array are drawn as they are, others
// are joined onto one x axis with gaps bridged. Charts that share a syncKey
// move one cursor together. A drag zooms -- across for time, up or down for
// values, diagonally for both -- or, in pan mode, moves the view; a
// double-click asks for the full range back. The toolbar over each chart
// (PlotPanes) drives the same ranges through `api`.

import { useEffect, useMemo, useRef, type MutableRefObject, type ReactNode } from 'react'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'

export interface PlotLane {
  label: string
  /** Any CSS colour, var(--token) included. */
  color: string
  /** x of each point (seconds, or whatever xFormat reads). */
  t: ArrayLike<number>
  v: ArrayLike<number>
  /** 2: drawn against the right-hand axis. */
  axis?: 1 | 2
}

/** A moment to mark on the time axis: a vertical line with a short tag (a node's log line, say). */
export interface PlotMarker {
  x: number
  label: string
  color: string
}

/** What a chart's toolbar needs from it. */
export interface PlotChartApi {
  /** The x and (left) y ranges on screen now. */
  scales: () => { x: [number, number]; y: [number, number] } | undefined
  /** The chart as a PNG data URL, on the given background. */
  png: (background: string) => string | undefined
}

export type PlotDragMode = 'zoom' | 'pan'

export interface PlotChartProps {
  lanes: readonly PlotLane[]
  /** A fixed value range for the left axis; otherwise it fits the data. */
  yRange?: readonly [number, number]
  /** A drag (or pan) set a value range; undefined asks for the fit back. */
  onYRangeChange?: (range: readonly [number, number] | undefined) => void
  /** What a drag on the chart does (default zoom). */
  dragMode?: PlotDragMode
  /**
   * Every line on its own value axis (coloured like it, left and right in
   * turn), so lines of very different size -- 100000 and a 0/1 state -- all
   * read. The time zoom still applies; value zoom and pan are off.
   */
  separateScales?: boolean
  /** Filled in with the chart's toolbar hooks. */
  api?: MutableRefObject<PlotChartApi | null>
  markers?: readonly PlotMarker[]
  height?: number
  /** Charts with the same key share the cursor. */
  syncKey?: string
  /** A fixed x range (a live window); otherwise the data's own extent. */
  xRange?: readonly [number, number]
  /** Drag-select to zoom: called with the range, or undefined on double-click. */
  onXRangeChange?: (range: readonly [number, number] | undefined) => void
  /** x tick labels (default: seconds). */
  xFormat?: (value: number) => string
  /** Where the cursor sits, for a legend outside the chart. */
  onCursor?: (index: { x: number; values: (number | undefined)[] } | undefined) => void
  testId?: string
  className?: string
}

function cssVar(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value || fallback
}

/** A canvas cannot paint var(--name): resolve it against the chart's host. */
function resolveColor(color: string, host: HTMLElement): string {
  const match = /^var\((--[\w-]+)(?:,\s*(.+))?\)$/.exec(color.trim())
  if (!match) return color
  return getComputedStyle(host).getPropertyValue(match[1]).trim() || match[2] || '#4c8dff'
}

const defaultXFormat = (value: number) => `${Number.parseFloat(value.toPrecision(6))}s`

const sharesClock = (lanes: readonly PlotLane[]) => lanes.every((lane) => lane.t === lanes[0].t)

/** The lanes as uPlot's aligned table: one shared x, one y column per lane. */
export function alignPlotLanes(lanes: readonly PlotLane[]): uPlot.AlignedData {
  if (lanes.length === 0) return [[], []]
  const first = lanes[0].t
  if (sharesClock(lanes)) {
    // NaN is a gap (a lost sample); uPlot reads gaps as null.
    return [Array.from(first), ...lanes.map((lane) => Array.from(lane.v, (value) => (Number.isFinite(value) ? value : null)))] as uPlot.AlignedData
  }
  // Different clocks: merge every x, each lane null where it has no point.
  const tables = lanes.map((lane) => [Array.from(lane.t), Array.from(lane.v)] as uPlot.AlignedData)
  return uPlot.join(tables)
}

export function PlotChart(props: PlotChartProps): ReactNode {
  const { lanes, markers, height = 160, syncKey, xRange, onXRangeChange, xFormat = defaultXFormat, onCursor, testId, className } = props
  const { yRange, onYRangeChange, dragMode = 'zoom', api, separateScales = false } = props
  const hostRef = useRef<HTMLDivElement | null>(null)
  const plotRef = useRef<uPlot | null>(null)
  const callbacks = useRef({ onXRangeChange, onYRangeChange, onCursor, xRange, yRange, markers, dragMode })
  callbacks.current = { onXRangeChange, onYRangeChange, onCursor, xRange, yRange, markers, dragMode }

  const aligned = useMemo(() => alignPlotLanes(lanes), [lanes])
  // The chart is rebuilt when its shape changes; data and range flow in below.
  const shape = `${separateScales ? 'separate' : 'shared'}\n${lanes.map((lane) => `${lane.color}|${lane.axis ?? 1}|${lane.label}`).join('\n')}`
  const hasRight = lanes.some((lane) => lane.axis === 2)
  // Joined lanes are null wherever another lane ticked: bridge those. On one
  // clock a null is a real gap, and stays one.
  const joined = lanes.length > 0 && !sharesClock(lanes)
  const zoomable = onXRangeChange !== undefined
  const panning = dragMode === 'pan'

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const axisColor = cssVar('--text-dim', '#7f8aa0')
    const gridColor = cssVar('--border-soft', '#222934')
    // Canvas text cannot read a CSS variable: take the tab's type scale once.
    const axisFont = `${getComputedStyle(host).getPropertyValue('--text-xs').trim() || '12px'} system-ui, sans-serif`
    // A value axis as wide as its longest label ("490,000" must not lose a digit).
    const fontPx = Number.parseFloat(axisFont) || 12
    // It only grows, so the plot does not shift sideways as live labels change length.
    const axisWidths = new Map<number, number>()
    const valueAxisSize: uPlot.Axis.Size = (_u, values, axisIndex) => {
      const wanted = Math.max(40, Math.ceil(Math.max(0, ...(values ?? []).map((value) => String(value).length)) * fontPx * 0.62) + 18)
      const width = Math.max(wanted, axisWidths.get(axisIndex) ?? 0)
      axisWidths.set(axisIndex, width)
      return width
    }
    const axis = (extra: Partial<uPlot.Axis>): uPlot.Axis => ({
      stroke: axisColor,
      font: axisFont,
      grid: { stroke: gridColor, width: 1 },
      ticks: { stroke: gridColor },
      ...extra
    })
    const plot = new uPlot(
      {
        width: Math.max(200, host.clientWidth),
        height,
        legend: { show: false },
        cursor: {
          sync: syncKey ? { key: syncKey } : undefined,
          // A box: mostly across zooms time, mostly up or down zooms values (uni).
          drag: { x: zoomable && !panning, y: !panning && !separateScales && onYRangeChange !== undefined, setScale: false, uni: 30 }
        },
        scales: {
          x: {
            time: false,
            range: (_u, min, max) => {
              const fixed = callbacks.current.xRange
              return fixed ? [fixed[0], fixed[1]] : [min, max]
            }
          },
          y: {
            range: (_u, min, max) => {
              const fixed = callbacks.current.yRange
              return fixed ? [fixed[0], fixed[1]] : uPlot.rangeNum(min, max, 0.1, true)
            }
          },
          ...(hasRight ? { y2: {} } : {}),
          ...(separateScales ? Object.fromEntries(lanes.map((_lane, index) => [`s${index}`, { range: (_u: uPlot, min: number, max: number) => uPlot.rangeNum(min, max, 0.1, true) }])) : {})
        },
        axes: [
          axis({ values: (_u, splits) => splits.map((value) => xFormat(value)) }),
          ...(separateScales
            ? // One axis per line, in its colour; the first keeps the grid.
              lanes.map((lane, index) =>
                axis({
                  scale: `s${index}`,
                  side: index % 2 === 0 ? 3 : 1,
                  size: valueAxisSize,
                  stroke: resolveColor(lane.color, host),
                  grid: { show: index === 0, stroke: gridColor, width: 1 }
                })
              )
            : [axis({ size: valueAxisSize }), ...(hasRight ? [axis({ scale: 'y2', side: 1, size: valueAxisSize, grid: { show: false } })] : [])])
        ],
        series: [
          {},
          ...lanes.map((lane, index) => ({
            label: lane.label,
            stroke: resolveColor(lane.color, host),
            width: 1.5,
            scale: separateScales ? `s${index}` : lane.axis === 2 ? 'y2' : 'y',
            points: { show: false },
            spanGaps: joined
          }))
        ],
        hooks: {
          draw: [
            (u) => {
              const list = callbacks.current.markers
              if (!list || list.length === 0) return
              const ctx = u.ctx
              const ratio = window.devicePixelRatio || 1
              const top = u.bbox.top
              const bottom = u.bbox.top + u.bbox.height
              ctx.save()
              ctx.font = `${10 * ratio}px system-ui, sans-serif`
              ctx.textBaseline = 'top'
              let lastLabelEnd = Number.NEGATIVE_INFINITY
              for (const marker of list) {
                const x = Math.round(u.valToPos(marker.x, 'x', true))
                if (x < u.bbox.left || x > u.bbox.left + u.bbox.width) continue
                ctx.strokeStyle = marker.color
                ctx.globalAlpha = 0.75
                ctx.setLineDash([3 * ratio, 3 * ratio])
                ctx.lineWidth = ratio
                ctx.beginPath()
                ctx.moveTo(x, top)
                ctx.lineTo(x, bottom)
                ctx.stroke()
                // A tag at the top, skipped where it would overlap the previous one.
                const text = marker.label.length > 28 ? `${marker.label.slice(0, 27)}…` : marker.label
                const width = ctx.measureText(text).width
                if (x + 3 * ratio > lastLabelEnd) {
                  ctx.globalAlpha = 1
                  ctx.fillStyle = marker.color
                  ctx.fillText(text, x + 3 * ratio, top + 2 * ratio)
                  lastLabelEnd = x + 3 * ratio + width + 6 * ratio
                }
              }
              ctx.restore()
            }
          ],
          setSelect: [
            (u) => {
              const { left, top, width, height: tall } = u.select
              if (width < 4 && tall < 4) return
              u.setSelect({ left: 0, top: 0, width: 0, height: 0 }, false)
              const plotWidth = u.over.clientWidth
              const plotHeight = u.over.clientHeight
              // A selection spanning the whole height is a time zoom; the whole width, a value zoom.
              if (width >= 4 && width < plotWidth - 1) callbacks.current.onXRangeChange?.([u.posToVal(left, 'x'), u.posToVal(left + width, 'x')])
              if (tall >= 4 && tall < plotHeight - 1) callbacks.current.onYRangeChange?.([u.posToVal(top + tall, 'y'), u.posToVal(top, 'y')])
            }
          ],
          setCursor: [
            (u) => {
              const report = callbacks.current.onCursor
              if (!report) return
              const index = u.cursor.idx
              if (index === null || index === undefined) {
                report(undefined)
                return
              }
              const x = u.data[0][index]
              report({ x, values: u.data.slice(1).map((column) => (column[index] ?? undefined) as number | undefined) })
            }
          ]
        }
      },
      aligned,
      host
    )
    plotRef.current = plot
    const onDoubleClick = () => {
      callbacks.current.onXRangeChange?.(undefined)
      callbacks.current.onYRangeChange?.(undefined)
    }
    host.addEventListener('dblclick', onDoubleClick)
    // Pan: drag moves the view by what is under the pointer.
    let pan: { x: number; y: number; xs: [number, number]; ys: [number, number] } | undefined
    const onPointerDown = (event: PointerEvent) => {
      if (callbacks.current.dragMode !== 'pan' || event.button !== 0) return
      const xs: [number, number] = [plot.scales.x.min ?? 0, plot.scales.x.max ?? 1]
      const ys: [number, number] = [plot.scales.y.min ?? 0, plot.scales.y.max ?? 1]
      pan = { x: event.clientX, y: event.clientY, xs, ys }
      plot.over.setPointerCapture(event.pointerId)
    }
    const onPointerMove = (event: PointerEvent) => {
      if (!pan) return
      const perPxX = (pan.xs[1] - pan.xs[0]) / Math.max(1, plot.over.clientWidth)
      const perPxY = (pan.ys[1] - pan.ys[0]) / Math.max(1, plot.over.clientHeight)
      const dx = (event.clientX - pan.x) * perPxX
      const dy = (event.clientY - pan.y) * perPxY
      callbacks.current.onXRangeChange?.([pan.xs[0] - dx, pan.xs[1] - dx])
      if (!separateScales) callbacks.current.onYRangeChange?.([pan.ys[0] + dy, pan.ys[1] + dy])
    }
    const onPointerUp = () => {
      pan = undefined
    }
    plot.over.addEventListener('pointerdown', onPointerDown)
    plot.over.addEventListener('pointermove', onPointerMove)
    plot.over.addEventListener('pointerup', onPointerUp)
    plot.over.addEventListener('pointercancel', onPointerUp)
    if (api) {
      api.current = {
        scales: () => {
          const y = separateScales ? plot.scales.s0 : plot.scales.y
          return plot.scales.x.min === undefined || y?.min === undefined
            ? undefined
            : { x: [plot.scales.x.min, plot.scales.x.max!], y: [y.min, y.max!] }
        },
        png: (background) => {
          const source = plot.ctx.canvas
          const copy = document.createElement('canvas')
          copy.width = source.width
          copy.height = source.height
          const context = copy.getContext('2d')
          if (!context) return undefined
          context.fillStyle = background
          context.fillRect(0, 0, copy.width, copy.height)
          context.drawImage(source, 0, 0)
          return copy.toDataURL('image/png')
        }
      }
    }
    const observer = new ResizeObserver(() => plot.setSize({ width: Math.max(200, host.clientWidth), height }))
    observer.observe(host)
    return () => {
      if (api) api.current = null
      host.removeEventListener('dblclick', onDoubleClick)
      observer.disconnect()
      plot.destroy()
      plotRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shape, height, syncKey, hasRight, zoomable, joined, panning, onYRangeChange !== undefined, separateScales])

  useEffect(() => {
    const plot = plotRef.current
    if (!plot) return
    plot.setData(aligned)
  }, [aligned])

  // New markers alone (no new data) still need a redraw.
  const markerKey = markers?.map((marker) => `${marker.x}:${marker.label}`).join('|') ?? ''
  useEffect(() => {
    plotRef.current?.redraw(false)
  }, [markerKey])

  // A new fixed range without new data (zoom on a static log): rescale.
  const rangeKey = xRange ? `${xRange[0]}:${xRange[1]}` : ''
  useEffect(() => {
    const plot = plotRef.current
    if (!plot) return
    const xs = plot.data[0]
    const min = xRange ? xRange[0] : xs.length > 0 ? xs[0] : 0
    const max = xRange ? xRange[1] : xs.length > 0 ? xs[xs.length - 1] : 1
    plot.setScale('x', { min, max })
  }, [rangeKey])

  // A value range set, or given back to the data's fit.
  const yKey = yRange ? `${yRange[0]}:${yRange[1]}` : ''
  useEffect(() => {
    const plot = plotRef.current
    if (!plot) return
    if (yRange && !separateScales) plot.setScale('y', { min: yRange[0], max: yRange[1] })
    else plot.setData(plot.data)
  }, [yKey])

  return <div className={`${className ?? 'plot-chart'}${dragMode === 'pan' ? ' is-panning' : ''}`} ref={hostRef} data-testid={testId} />
}
