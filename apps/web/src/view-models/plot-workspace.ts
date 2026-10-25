// The plot workspace shared by CAN ▸ Plot and the MAVLink Inspector: series
// grouped into panes over one time axis (the PlotJuggler shape -- a series
// starts on its own pane and can be dragged onto another to overlay), saved
// layouts, and thinning many points for drawing. Pure.

/** A chart's height in pixels: set by dragging its bottom edge. */
export type PlotPaneHeight = number

export const PLOT_PANE_DEFAULT_HEIGHT = 140
export const PLOT_PANE_MIN_HEIGHT = 70
export const PLOT_PANE_MAX_HEIGHT = 640

export function clampPaneHeight(height: number): number {
  return Math.round(Math.min(PLOT_PANE_MAX_HEIGHT, Math.max(PLOT_PANE_MIN_HEIGHT, height)))
}

/** What the drag of a series (or a field to plot) carries. */
export const PLOT_DRAG_TYPE = 'application/x-arduconfig-plot'

export interface PlotPaneGroup<T> {
  id: string
  series: T[]
}

/**
 * Group series into panes, in order of each pane's first series. A series
 * whose pane is unknown (or unset) gets a pane of its own, keyed by itself.
 */
export function groupIntoPanes<T>(series: readonly T[], keyOf: (entry: T) => string, paneOf: ReadonlyMap<string, string>): PlotPaneGroup<T>[] {
  const panes: PlotPaneGroup<T>[] = []
  const byId = new Map<string, PlotPaneGroup<T>>()
  for (const entry of series) {
    const key = keyOf(entry)
    const id = paneOf.get(key) ?? key
    let pane = byId.get(id)
    if (!pane) {
      pane = { id, series: [] }
      byId.set(id, pane)
      panes.push(pane)
    }
    pane.series.push(entry)
  }
  return panes
}

/** Move a series onto a pane (undefined: a pane of its own). */
export function assignPane(paneOf: ReadonlyMap<string, string>, key: string, paneId: string | undefined): Map<string, string> {
  const next = new Map(paneOf)
  if (paneId === undefined || paneId === key) next.delete(key)
  else next.set(key, paneId)
  // A pane named after a series that moved out keeps its other members together.
  if (paneId === undefined) {
    const orphaned = [...next.entries()].filter(([, pane]) => pane === key).map(([member]) => member)
    if (orphaned.length > 0) {
      const [heir, ...rest] = orphaned
      next.delete(heir)
      for (const member of rest) next.set(member, heir)
    }
  }
  return next
}

/** Every series onto the first one's chart. */
export function overlayAll(keys: readonly string[]): Map<string, string> {
  return new Map(keys.slice(1).map((key) => [key, keys[0]]))
}

/** Forget series that are gone. */
export function prunePanes(paneOf: ReadonlyMap<string, string>, keys: ReadonlySet<string>): Map<string, string> {
  return new Map([...paneOf.entries()].filter(([key]) => keys.has(key)))
}

// ---- Saved layouts ------------------------------------------------------

/** A named arrangement: each pane's series (as the surface describes them) and height. */
export interface SavedPlotLayout<T> {
  name: string
  panes: { height: PlotPaneHeight; series: T[] }[]
}

const LAYOUT_FORMAT = 1

/** Layouts as stored, dropping anything malformed rather than failing. */
export function parseSavedLayouts<T>(json: string | null | undefined, isSeries: (value: unknown) => value is T): SavedPlotLayout<T>[] {
  if (!json) return []
  try {
    const stored = JSON.parse(json) as { format?: number; layouts?: unknown[] }
    if (stored?.format !== LAYOUT_FORMAT || !Array.isArray(stored.layouts)) return []
    return stored.layouts.flatMap((entry) => {
      const layout = entry as { name?: unknown; panes?: unknown[] }
      if (typeof layout?.name !== 'string' || !Array.isArray(layout.panes)) return []
      const panes = layout.panes.flatMap((raw) => {
        const pane = raw as { series?: unknown[]; height?: unknown }
        if (!pane || !Array.isArray(pane.series)) return []
        const series = pane.series.filter(isSeries)
        if (series.length === 0) return []
        const height = typeof pane.height === 'number' && Number.isFinite(pane.height) ? clampPaneHeight(pane.height) : PLOT_PANE_DEFAULT_HEIGHT
        return [{ height, series }]
      })
      return [{ name: layout.name, panes }]
    })
  } catch {
    return []
  }
}

export function serializeSavedLayouts<T>(layouts: readonly SavedPlotLayout<T>[]): string {
  return JSON.stringify({ format: LAYOUT_FORMAT, layouts })
}

/** Save (or replace, by name) one layout, sorted by name. */
export function upsertLayout<T>(layouts: readonly SavedPlotLayout<T>[], layout: SavedPlotLayout<T>): SavedPlotLayout<T>[] {
  return [...layouts.filter((entry) => entry.name !== layout.name), layout].sort((a, b) => a.name.localeCompare(b.name))
}

// ---- Drawing many points --------------------------------------------------

/**
 * Thin a series for drawing: within [from, to], keep each pixel bucket's
 * first, min, max and last point, so spikes survive (a plain stride would
 * drop them) while a long capture draws as a few thousand points. One point
 * either side of the range is kept so lines run to the edges.
 */
export function decimateMinMax(
  t: ArrayLike<number>,
  v: ArrayLike<number>,
  from: number,
  to: number,
  buckets: number
): { t: number[]; v: number[] } {
  const n = t.length
  if (n === 0 || !(to > from)) return { t: [], v: [] }
  let start = lowerBound(t, from)
  let end = lowerBound(t, to)
  if (start > 0) start -= 1
  if (end < n) end += 1
  const count = end - start
  if (count <= buckets * 4) {
    return { t: Array.from({ length: count }, (_u, i) => t[start + i]), v: Array.from({ length: count }, (_u, i) => v[start + i]) }
  }
  const outT: number[] = []
  const outV: number[] = []
  const width = (to - from) / buckets
  let index = start
  while (index < end) {
    const bucketEnd = t[index] < from ? from : Math.min(to, from + (Math.floor((t[index] - from) / width) + 1) * width)
    const first = index
    let minI = index
    let maxI = index
    while (index < end && (t[index] < bucketEnd || index === first)) {
      // NaN (a gap) never wins min or max.
      if (v[index] < v[minI] || Number.isNaN(v[minI])) minI = index
      if (v[index] > v[maxI] || Number.isNaN(v[maxI])) maxI = index
      index += 1
    }
    const last = index - 1
    let previous = -1
    for (const pick of [first, minI, maxI, last].sort((a, b) => a - b)) {
      if (pick === previous) continue
      previous = pick
      outT.push(t[pick])
      outV.push(v[pick])
    }
  }
  return { t: outT, v: outV }
}

/** First index whose value is >= target (t ascending). */
function lowerBound(t: ArrayLike<number>, target: number): number {
  let low = 0
  let high = t.length
  while (low < high) {
    const mid = (low + high) >>> 1
    if (t[mid] < target) low = mid + 1
    else high = mid
  }
  return low
}

/** The value of a series at time x (the point at or before it), for a legend. */
export function valueAt(t: ArrayLike<number>, v: ArrayLike<number>, x: number): number | undefined {
  const index = lowerBound(t, x)
  if (index < t.length && t[index] === x) return v[index]
  return index > 0 ? v[index - 1] : undefined
}

export interface RangeStats {
  min: number
  max: number
  mean: number
  count: number
  /** Points per second over the span they cover. */
  rateHz: number
}

/** Min, max, mean and rate of the points inside [from, to] (NaN gaps skipped). */
export function rangeStats(t: ArrayLike<number>, v: ArrayLike<number>, from: number, to: number): RangeStats | undefined {
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  let sum = 0
  let count = 0
  let first: number | undefined
  let last: number | undefined
  for (let index = lowerBound(t, from); index < t.length && t[index] <= to; index += 1) {
    const value = v[index]
    if (!Number.isFinite(value)) continue
    if (value < min) min = value
    if (value > max) max = value
    sum += value
    count += 1
    first ??= t[index]
    last = t[index]
  }
  if (count === 0) return undefined
  const span = last! - first!
  return { min, max, mean: sum / count, count, rateHz: span > 0 ? (count - 1) / span : 0 }
}

/** Above this many points in view, a lane is thinned before drawing. */
export const PLOT_THIN_ABOVE = 6000
const PLOT_THIN_BUCKETS = 1500

/** A lane ready to draw: thinned to its pixel buckets when long, untouched otherwise. */
export function thinLane<L extends { t: ArrayLike<number>; v: ArrayLike<number> }>(lane: L, from: number | undefined, to: number | undefined): L {
  const n = lane.t.length
  if (n <= PLOT_THIN_ABOVE) return lane
  const start = from ?? lane.t[0]
  const end = to ?? lane.t[n - 1]
  const thinned = decimateMinMax(lane.t, lane.v, start, end, PLOT_THIN_BUCKETS)
  return { ...lane, t: thinned.t, v: thinned.v }
}

/** How far apart lines' sizes must be before each gets its own axis by default. */
export const DISPARATE_RATIO = 50

/**
 * Do these lines differ so much in size that one shared value axis would
 * flatten some of them (100000 beside a 0/1 state)? Compares each line's
 * extent over what is in view: its span, or its magnitude when flat.
 */
export function lanesAreDisparate(lanes: readonly { t: ArrayLike<number>; v: ArrayLike<number> }[], from = Number.NEGATIVE_INFINITY, to = Number.POSITIVE_INFINITY): boolean {
  const sizes: number[] = []
  for (const lane of lanes) {
    const stats = rangeStats(lane.t, lane.v, from, to)
    if (!stats) continue
    const size = Math.max(stats.max - stats.min, Math.abs(stats.max), Math.abs(stats.min))
    if (size > 0) sizes.push(size)
  }
  if (sizes.length < 2) return false
  return Math.max(...sizes) / Math.min(...sizes) > DISPARATE_RATIO
}

// ---- Transforms (PlotJuggler's per-curve functions) -------------------------

export type PlotTransformKind = 'none' | 'rate' | 'integral' | 'smooth' | 'abs' | 'scale'

export interface PlotTransform {
  kind: PlotTransformKind
  /** For 'scale': value × factor + offset. */
  factor?: number
  offset?: number
  /** For 'smooth': the moving-average window, seconds. */
  windowS?: number
}

export const PLOT_TRANSFORM_LABELS: Record<PlotTransformKind, string> = {
  none: 'As is',
  rate: 'Rate of change (/s)',
  integral: 'Integral (×s)',
  smooth: 'Smoothed',
  abs: 'Absolute',
  scale: 'Scale & offset'
}

/** The short tag a transformed line wears beside its name. */
export function transformTag(transform: PlotTransform | undefined): string | undefined {
  if (!transform || transform.kind === 'none') return undefined
  switch (transform.kind) {
    case 'rate':
      return 'd/dt'
    case 'integral':
      return '∫dt'
    case 'smooth':
      return `avg ${transform.windowS ?? 0.5}s`
    case 'abs':
      return '|x|'
    case 'scale':
      return `×${transform.factor ?? 1}${(transform.offset ?? 0) >= 0 ? '+' : ''}${transform.offset ?? 0}`
  }
}

/** A line's values through a transform (time in seconds); gaps (NaN) stay gaps. */
export function transformValues(t: ArrayLike<number>, v: ArrayLike<number>, transform: PlotTransform | undefined): ArrayLike<number> {
  if (!transform || transform.kind === 'none') return v
  const n = v.length
  const out = new Array<number>(n)
  switch (transform.kind) {
    case 'abs':
      for (let i = 0; i < n; i += 1) out[i] = Math.abs(v[i])
      return out
    case 'scale': {
      const factor = transform.factor ?? 1
      const offset = transform.offset ?? 0
      for (let i = 0; i < n; i += 1) out[i] = v[i] * factor + offset
      return out
    }
    case 'rate':
      // Backward difference per second; the first point has none.
      for (let i = 0; i < n; i += 1) {
        const dt = i > 0 ? t[i] - t[i - 1] : 0
        out[i] = dt > 0 ? (v[i] - v[i - 1]) / dt : Number.NaN
      }
      return out
    case 'integral': {
      // Trapezoids, skipping over gaps.
      let sum = 0
      for (let i = 0; i < n; i += 1) {
        if (i > 0 && Number.isFinite(v[i]) && Number.isFinite(v[i - 1])) sum += ((v[i] + v[i - 1]) / 2) * (t[i] - t[i - 1])
        out[i] = sum
      }
      return out
    }
    case 'smooth': {
      // A trailing moving average over windowS seconds.
      const window = transform.windowS ?? 0.5
      let start = 0
      let sum = 0
      let count = 0
      for (let i = 0; i < n; i += 1) {
        if (Number.isFinite(v[i])) {
          sum += v[i]
          count += 1
        }
        while (t[i] - t[start] > window) {
          if (Number.isFinite(v[start])) {
            sum -= v[start]
            count -= 1
          }
          start += 1
        }
        out[i] = count > 0 ? sum / count : Number.NaN
      }
      return out
    }
  }
}

// ---- Histogram ---------------------------------------------------------------

/** Counts of each line's values in view over shared bins, for a chart's histogram view. */
export function histogram(
  lanes: readonly { t: ArrayLike<number>; v: ArrayLike<number> }[],
  from = Number.NEGATIVE_INFINITY,
  to = Number.POSITIVE_INFINITY,
  binCount = 40
): { centers: number[]; counts: number[][] } | undefined {
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  for (const lane of lanes) {
    for (let i = 0; i < lane.t.length; i += 1) {
      if (lane.t[i] < from || lane.t[i] > to || !Number.isFinite(lane.v[i])) continue
      if (lane.v[i] < min) min = lane.v[i]
      if (lane.v[i] > max) max = lane.v[i]
    }
  }
  if (!Number.isFinite(min)) return undefined
  // A flat line still gets one visible bar.
  if (max === min) {
    min -= 0.5
    max += 0.5
  }
  const width = (max - min) / binCount
  const centers = Array.from({ length: binCount }, (_u, index) => min + width * (index + 0.5))
  const counts = lanes.map((lane) => {
    const bins = new Array<number>(binCount).fill(0)
    for (let i = 0; i < lane.t.length; i += 1) {
      if (lane.t[i] < from || lane.t[i] > to || !Number.isFinite(lane.v[i])) continue
      bins[Math.min(binCount - 1, Math.floor((lane.v[i] - min) / width))] += 1
    }
    return bins
  })
  return { centers, counts }
}

/**
 * MAVExplorer's conditions: each term of an expression gets `{condition}`
 * (before a `:2` axis suffix), so it plots only while the condition holds.
 * Spaces are dropped from the condition -- a space separates terms.
 */
export function withCondition(expression: string, condition: string): string {
  const cond = condition.replace(/\s+/g, '')
  if (!cond) return expression.trim()
  return expression
    .trim()
    .split(/\s+/)
    .map((term) => term.replace(/(:2)?$/, `{${cond}}$1`))
    .join(' ')
}
