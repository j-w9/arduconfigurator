// The one chart every plot in the app draws with: CAN Plot, the MAVLink
// Inspector, and the log graphs. uPlot (MIT) underneath -- canvas, built for
// millions of points, which is what scrubbing a whole flight log needs.
//
// Each lane brings its own timestamps (streams and log messages do not tick
// together); lanes that share one time array are drawn as they are, others
// are joined onto one x axis with gaps bridged. Charts that share a syncKey
// move one cursor together; a drag selects an x range (onXRangeChange), and
// a double-click asks for the full range back.

import { useEffect, useMemo, useRef, type ReactNode } from 'react'
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

export interface PlotChartProps {
  lanes: readonly PlotLane[]
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
  const hostRef = useRef<HTMLDivElement | null>(null)
  const plotRef = useRef<uPlot | null>(null)
  const callbacks = useRef({ onXRangeChange, onCursor, xRange, markers })
  callbacks.current = { onXRangeChange, onCursor, xRange, markers }

  const aligned = useMemo(() => alignPlotLanes(lanes), [lanes])
  // The chart is rebuilt when its shape changes; data and range flow in below.
  const shape = lanes.map((lane) => `${lane.color}|${lane.axis ?? 1}|${lane.label}`).join('\n')
  const hasRight = lanes.some((lane) => lane.axis === 2)
  // Joined lanes are null wherever another lane ticked: bridge those. On one
  // clock a null is a real gap, and stays one.
  const joined = lanes.length > 0 && !sharesClock(lanes)
  const zoomable = onXRangeChange !== undefined

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const axisColor = cssVar('--text-dim', '#7f8aa0')
    const gridColor = cssVar('--border-soft', '#222934')
    // Canvas text cannot read a CSS variable: take the tab's type scale once.
    const axisFont = `${getComputedStyle(host).getPropertyValue('--text-xs').trim() || '12px'} system-ui, sans-serif`
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
          drag: { x: zoomable, y: false, setScale: false }
        },
        scales: {
          x: {
            time: false,
            range: (_u, min, max) => {
              const fixed = callbacks.current.xRange
              return fixed ? [fixed[0], fixed[1]] : [min, max]
            }
          },
          ...(hasRight ? { y2: {} } : {})
        },
        axes: [
          axis({ values: (_u, splits) => splits.map((value) => xFormat(value)) }),
          axis({ size: 64 }),
          ...(hasRight ? [axis({ scale: 'y2', side: 1, size: 64, grid: { show: false } })] : [])
        ],
        series: [
          {},
          ...lanes.map((lane) => ({
            label: lane.label,
            stroke: resolveColor(lane.color, host),
            width: 1.5,
            scale: lane.axis === 2 ? 'y2' : 'y',
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
              if (!callbacks.current.onXRangeChange || u.select.width < 4) return
              const from = u.posToVal(u.select.left, 'x')
              const to = u.posToVal(u.select.left + u.select.width, 'x')
              u.setSelect({ left: 0, top: 0, width: 0, height: 0 }, false)
              callbacks.current.onXRangeChange([from, to])
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
    const onDoubleClick = () => callbacks.current.onXRangeChange?.(undefined)
    host.addEventListener('dblclick', onDoubleClick)
    const observer = new ResizeObserver(() => plot.setSize({ width: Math.max(200, host.clientWidth), height }))
    observer.observe(host)
    return () => {
      host.removeEventListener('dblclick', onDoubleClick)
      observer.disconnect()
      plot.destroy()
      plotRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shape, height, syncKey, hasRight, zoomable, joined])

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

  return <div className={className ?? 'plot-chart'} ref={hostRef} data-testid={testId} />
}
