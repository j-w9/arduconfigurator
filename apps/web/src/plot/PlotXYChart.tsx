// An XY chart: one series against another (PlotJuggler's XY mode). A
// magnetometer's x against y traces a circle as the craft turns -- a quick
// compass check -- so the scales stay equal by default. Points pair by
// index (series on one clock, like a vector's elements); the trail fades
// with age and the newest point is marked.

import { useEffect, useRef, type ReactNode } from 'react'

export interface PlotXYChartProps {
  x: ArrayLike<number>
  y: ArrayLike<number>
  color: string
  xLabel: string
  yLabel: string
  height: number
  /** Same units per pixel on both axes (default true): a circle stays a circle. */
  equalAspect?: boolean
  testId?: string
}

function cssVar(element: HTMLElement, name: string, fallback: string): string {
  return getComputedStyle(element).getPropertyValue(name).trim() || fallback
}

function niceLabel(value: number): string {
  return Number.parseFloat(value.toPrecision(3)).toString()
}

export function PlotXYChart(props: PlotXYChartProps): ReactNode {
  const { x, y, color, xLabel, yLabel, height, equalAspect = true } = props
  const hostRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const host = hostRef.current
    const canvas = canvasRef.current
    if (!host || !canvas) return
    const draw = () => {
      const ratio = window.devicePixelRatio || 1
      const width = Math.max(200, host.clientWidth)
      canvas.width = width * ratio
      canvas.height = height * ratio
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.scale(ratio, ratio)
      const text = cssVar(host, '--text-dim', '#7f8aa0')
      const grid = cssVar(host, '--border-soft', '#222934')
      const font = `${cssVar(host, '--text-xs', '12px')} system-ui, sans-serif`
      const pad = { left: 56, right: 12, top: 10, bottom: 28 }
      const plotW = width - pad.left - pad.right
      const plotH = height - pad.top - pad.bottom
      const n = Math.min(x.length, y.length)
      let minX = Number.POSITIVE_INFINITY
      let maxX = Number.NEGATIVE_INFINITY
      let minY = Number.POSITIVE_INFINITY
      let maxY = Number.NEGATIVE_INFINITY
      for (let i = 0; i < n; i += 1) {
        if (!Number.isFinite(x[i]) || !Number.isFinite(y[i])) continue
        minX = Math.min(minX, x[i])
        maxX = Math.max(maxX, x[i])
        minY = Math.min(minY, y[i])
        maxY = Math.max(maxY, y[i])
      }
      ctx.font = font
      ctx.fillStyle = text
      ctx.strokeStyle = grid
      ctx.lineWidth = 1
      ctx.strokeRect(pad.left, pad.top, plotW, plotH)
      if (!Number.isFinite(minX)) {
        ctx.fillText('Waiting for points…', pad.left + 8, pad.top + 18)
        return
      }
      // A little room around the data; equal aspect widens the narrower axis.
      let spanX = Math.max(maxX - minX, 1e-9)
      let spanY = Math.max(maxY - minY, 1e-9)
      const cx = (minX + maxX) / 2
      const cy = (minY + maxY) / 2
      if (equalAspect) {
        const unitsPerPx = Math.max(spanX / plotW, spanY / plotH)
        spanX = unitsPerPx * plotW
        spanY = unitsPerPx * plotH
      }
      spanX *= 1.1
      spanY *= 1.1
      const toX = (value: number) => pad.left + ((value - (cx - spanX / 2)) / spanX) * plotW
      const toY = (value: number) => pad.top + plotH - ((value - (cy - spanY / 2)) / spanY) * plotH
      // Axes through zero when zero is in view, else just the frame.
      ctx.setLineDash([3, 3])
      if (cx - spanX / 2 < 0 && cx + spanX / 2 > 0) {
        ctx.beginPath()
        ctx.moveTo(toX(0), pad.top)
        ctx.lineTo(toX(0), pad.top + plotH)
        ctx.stroke()
      }
      if (cy - spanY / 2 < 0 && cy + spanY / 2 > 0) {
        ctx.beginPath()
        ctx.moveTo(pad.left, toY(0))
        ctx.lineTo(pad.left + plotW, toY(0))
        ctx.stroke()
      }
      ctx.setLineDash([])
      ctx.textAlign = 'center'
      ctx.fillText(niceLabel(cx - spanX / 2), pad.left, height - 12)
      ctx.fillText(niceLabel(cx + spanX / 2), pad.left + plotW, height - 12)
      ctx.fillText(xLabel, pad.left + plotW / 2, height - 12)
      ctx.textAlign = 'right'
      ctx.fillText(niceLabel(cy + spanY / 2), pad.left - 6, pad.top + 10)
      ctx.fillText(niceLabel(cy - spanY / 2), pad.left - 6, pad.top + plotH)
      ctx.save()
      ctx.translate(14, pad.top + plotH / 2)
      ctx.rotate(-Math.PI / 2)
      ctx.textAlign = 'center'
      ctx.fillText(yLabel, 0, 0)
      ctx.restore()
      // The trail, older segments fainter.
      ctx.strokeStyle = color
      ctx.lineWidth = 1.5
      let previous: [number, number] | undefined
      for (let i = 0; i < n; i += 1) {
        if (!Number.isFinite(x[i]) || !Number.isFinite(y[i])) {
          previous = undefined
          continue
        }
        const point: [number, number] = [toX(x[i]), toY(y[i])]
        if (previous) {
          ctx.globalAlpha = 0.15 + 0.85 * (i / n)
          ctx.beginPath()
          ctx.moveTo(previous[0], previous[1])
          ctx.lineTo(point[0], point[1])
          ctx.stroke()
        }
        previous = point
      }
      ctx.globalAlpha = 1
      if (previous) {
        ctx.fillStyle = color
        ctx.beginPath()
        ctx.arc(previous[0], previous[1], 3.5, 0, Math.PI * 2)
        ctx.fill()
      }
    }
    draw()
    const observer = new ResizeObserver(draw)
    observer.observe(host)
    return () => observer.disconnect()
  }, [x, y, color, xLabel, yLabel, height, equalAspect])

  return (
    <div className="plot-xy" ref={hostRef} data-testid={props.testId}>
      <canvas ref={canvasRef} role="img" aria-label={`${yLabel} against ${xLabel}`} />
    </div>
  )
}
