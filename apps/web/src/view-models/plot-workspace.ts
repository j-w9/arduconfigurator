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
