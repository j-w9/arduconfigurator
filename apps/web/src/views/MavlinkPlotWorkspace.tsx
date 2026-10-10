// The MAVLink Inspector's Plot sub-tab: field plots and MAVExplorer's
// predefined graphs (evaluated live) on the shared plot workspace, with a
// side panel to add from -- Fields (every number the link carries) and
// Graphs (the library, each graph saying what it shows). A graph's lines
// start on one chart; any series drags onto another chart to overlay it.
// Presentational: the live graphs come from useMavlinkPlotWorkspace.

import { useMemo, useRef, useState, type ReactNode } from 'react'

import { PlotWorkspace } from '../plot/PlotWorkspace'
import { plotDragProps, type PlotPaneModel, type PlotSeriesRow } from '../plot/PlotPanes'
import type { PlotLane } from '../plot/PlotChart'
import type { MavlinkMessageStat, MavlinkPlot, MavlinkPlotSpec } from '../hooks/use-mavlink-inspector'
import type { LiveGraphSeries, OpenLiveGraph } from '../hooks/use-mavlink-plot-workspace'
import { downloadTextFile } from '../download-file'
import { buildMavlinkFieldRows, formatPlotValue } from '../view-models/mavlink-inspector'
import { filterLiveGraphs, type LiveGraphEntry } from '../view-models/mavlink-live-graphs'
import {
  PLOT_PANE_DEFAULT_HEIGHT,
  groupIntoPanes,
  parseSavedLayouts,
  serializeSavedLayouts,
  upsertLayout,
  valueAt,
  type PlotPaneHeight,
  type SavedPlotLayout
} from '../view-models/plot-workspace'

export interface MavlinkPlotWorkspaceProps {
  stats: readonly MavlinkMessageStat[]
  plots: readonly MavlinkPlot[]
  maxPlots: number
  onAddPlot: (spec: MavlinkPlotSpec) => void
  onRemovePlot: (key: string) => void
  onExportPlotCsv?: (key: string) => void
  graphs: readonly LiveGraphEntry[]
  openGraphs: readonly OpenLiveGraph[]
  maxGraphs: number
  onOpenGraph: (name: string) => void
  onCloseGraph: (name: string) => void
  paneOf: ReadonlyMap<string, string>
  paneHeights: ReadonlyMap<string, PlotPaneHeight>
  onMoveSeries: (key: string, paneId: string | undefined) => void
  onPaneHeight: (paneId: string, height: PlotPaneHeight) => void
  /** Seconds the buffers hold: the longest window offered. */
  bufferSeconds: number
}

const COLORS = ['#4aa3ff', '#f2b400', '#3ecf8e', '#e5484d', '#b07cf7', '#ff8a3d', '#22c3c3', '#e86fb0']
const SYNC_KEY = 'arduconfig-mavlink-plot'

type Line =
  | { kind: 'field'; key: string; plot: MavlinkPlot; color: string }
  | { kind: 'graph'; key: string; graph: string; series: LiveGraphSeries; color: string }

/** A layout's series: a field plot, or a whole predefined graph. */
type LayoutSeries = { kind: 'field'; spec: MavlinkPlotSpec } | { kind: 'graph'; name: string }

const LAYOUTS_KEY = 'arduconfig-mavlink-plot-layouts'

function isLayoutSeries(value: unknown): value is LayoutSeries {
  const entry = value as { kind?: unknown; name?: unknown; spec?: { key?: unknown; type?: unknown; field?: unknown } } | null
  if (entry?.kind === 'graph') return typeof entry.name === 'string'
  return entry?.kind === 'field' && typeof entry.spec?.key === 'string' && typeof entry.spec.type === 'string' && typeof entry.spec.field === 'string'
}

function readLayouts(): SavedPlotLayout<LayoutSeries>[] {
  try {
    return parseSavedLayouts(window.localStorage.getItem(LAYOUTS_KEY), isLayoutSeries)
  } catch {
    return []
  }
}

function writeLayouts(layouts: readonly SavedPlotLayout<LayoutSeries>[]): void {
  try {
    window.localStorage.setItem(LAYOUTS_KEY, serializeSavedLayouts(layouts))
  } catch {
    // Storage blocked: the layout lives until reload.
  }
}

/** Every number the link carries, by message: + (or drag) to plot one. */
function FieldsTab(props: Pick<MavlinkPlotWorkspaceProps, 'stats' | 'plots' | 'maxPlots' | 'onAddPlot' | 'onRemovePlot'>): ReactNode {
  const [query, setQuery] = useState('')
  const needle = query.trim().toLowerCase()
  const plotted = new Set(props.plots.map((plot) => plot.key))
  const full = props.plots.length >= props.maxPlots
  const messages = [...props.stats]
    .sort((a, b) => a.type.localeCompare(b.type) || a.key.localeCompare(b.key))
    .map((stat) => ({ stat, rows: buildMavlinkFieldRows(stat.lastMessage).filter((row) => row.plottable) }))
    .filter(({ stat, rows }) => rows.length > 0 && (!needle || stat.type.toLowerCase().includes(needle) || rows.some((row) => `${stat.type}.${row.key}`.toLowerCase().includes(needle))))
  return (
    <div className="plot-side-list" data-testid="mavlink-fields">
      <input type="search" className="plot-side-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter: ATTITUDE, roll, chan3…" data-testid="mavlink-fields-search" />
      <p className="plot-side-note">+ adds a field on a chart of its own; drag it onto a chart to put it there.</p>
      {messages.map(({ stat, rows }) => {
        const shown = needle && !stat.type.toLowerCase().includes(needle) ? rows.filter((row) => `${stat.type}.${row.key}`.toLowerCase().includes(needle)) : rows
        return (
          <details key={stat.key} open={needle.length > 0 || messages.length <= 3}>
            <summary>
              {stat.type}
              <span className="plot-side-list__count">
                {stat.systemId}:{stat.componentId} · {stat.rateHz.toFixed(1)} Hz
              </span>
            </summary>
            {shown.map((row) => {
              const spec: MavlinkPlotSpec = { key: `${stat.key}:${row.key}`, systemId: stat.systemId, componentId: stat.componentId, type: stat.type, field: row.key }
              const on = plotted.has(spec.key)
              return (
                <div key={row.key} className="plot-side-list__item" {...plotDragProps(JSON.stringify({ kind: 'mavlink-field', spec }))} title="Drag onto a chart">
                  <span className="plot-side-list__name plot-side-list__name--data">{row.key}</span>
                  <span className="plot-side-list__value">{row.value}</span>
                  <button
                    type="button"
                    className={`plot-side-list__add${on ? ' is-on' : ''}`}
                    onClick={() => (on ? props.onRemovePlot(spec.key) : props.onAddPlot(spec))}
                    disabled={!on && full}
                    title={!on && full ? `At most ${props.maxPlots} field plots` : on ? 'On a chart; click to take it off' : 'Plot on a chart of its own'}
                    data-testid={`mavlink-field-add-${spec.key}`}
                  >
                    {on ? 'Plotted' : '+'}
                  </button>
                </div>
              )
            })}
          </details>
        )
      })}
      {messages.length === 0 ? <p className="plot-side-note">{props.stats.length === 0 ? 'Nothing received yet.' : 'No field matches.'}</p> : null}
    </div>
  )
}

/** MAVExplorer's graph library against what the link carries. */
function GraphsTab(props: Pick<MavlinkPlotWorkspaceProps, 'graphs' | 'openGraphs' | 'maxGraphs' | 'onOpenGraph' | 'onCloseGraph'>): ReactNode {
  const [query, setQuery] = useState('')
  const [showAll, setShowAll] = useState(false)
  const [about, setAbout] = useState<string | undefined>(undefined)
  const visible = filterLiveGraphs(props.graphs, query, showAll)
  const drawable = props.graphs.filter((entry) => !entry.unavailable).length
  const openNames = new Set(props.openGraphs.map((graph) => graph.name))
  const full = props.openGraphs.length >= props.maxGraphs
  const categories = new Map<string, LiveGraphEntry[]>()
  for (const entry of visible) categories.set(entry.category, [...(categories.get(entry.category) ?? []), entry])
  const picked = props.graphs.find((entry) => entry.name === about)
  return (
    <div className="plot-side-list" data-testid="mavlink-graphs">
      <input type="search" className="plot-side-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search: attitude, battery, GPS…" data-testid="mavlink-graphs-search" />
      <label className="plot-side-check">
        <input type="checkbox" checked={showAll} onChange={(event) => setShowAll(event.target.checked)} data-testid="mavlink-graphs-all" />
        <span>
          Show all {props.graphs.length} ({drawable} can draw from this link)
        </span>
      </label>
      {picked ? (
        <div className="plot-side-about" data-testid="mavlink-graph-about">
          <strong>{picked.name}</strong>
          <p>{picked.description || 'No description.'}</p>
          {picked.unavailable ? <p className="plot-side-note">{picked.unavailable}</p> : null}
        </div>
      ) : (
        <p className="plot-side-note">MAVExplorer's graphs (MAVProxy, GPLv3). Click a name to read what it shows.</p>
      )}
      {[...categories.entries()].map(([category, entries]) => (
        <div key={category}>
          <div className="plot-side-list__group-title">{category}</div>
          {entries.map((entry) => (
            <div key={entry.name} className={`plot-side-list__item${entry.unavailable ? ' is-unavailable' : ''}${about === entry.name ? ' is-selected' : ''}`}>
              <button type="button" className="plot-side-list__name" onClick={() => setAbout(about === entry.name ? undefined : entry.name)} title={entry.unavailable ?? entry.description}>
                {entry.title}
              </button>
              {openNames.has(entry.name) ? (
                <button type="button" className="plot-side-list__add is-on" onClick={() => props.onCloseGraph(entry.name)} title="On a chart; click to take it off" data-testid={`mavlink-graph-close-${entry.name}`}>
                  Plotted
                </button>
              ) : (
                <button
                  type="button"
                  className="plot-side-list__add"
                  onClick={() => props.onOpenGraph(entry.name)}
                  disabled={entry.unavailable !== undefined || full}
                  title={full ? `At most ${props.maxGraphs} graphs at once` : undefined}
                  data-testid={`mavlink-graph-open-${entry.name}`}
                >
                  Plot
                </button>
              )}
            </div>
          ))}
        </div>
      ))}
      {visible.length === 0 ? <p className="plot-side-note">{drawable > 0 || showAll ? 'No graph matches.' : 'Nothing to draw yet: no message a graph needs has arrived.'}</p> : null}
    </div>
  )
}

export function MavlinkPlotWorkspace(props: MavlinkPlotWorkspaceProps): ReactNode {
  const { plots, openGraphs } = props
  const [windowSeconds, setWindowSeconds] = useState(20)
  const [paused, setPaused] = useState(false)
  const [zoom, setZoom] = useState<readonly [number, number] | undefined>(undefined)
  // Paused, the charts hold what they showed: the buffers keep moving underneath.
  const frozen = useRef<{ nowMs: number; plots: readonly MavlinkPlot[]; graphs: readonly OpenLiveGraph[] } | undefined>(undefined)
  if (paused && !frozen.current) frozen.current = { nowMs: Date.now(), plots, graphs: openGraphs }
  if (!paused) frozen.current = undefined
  const view = frozen.current ?? { nowMs: Date.now(), plots, graphs: openGraphs }

  const lines = useMemo<Line[]>(() => {
    const field = view.plots.map((plot, index): Line => ({ kind: 'field', key: plot.key, plot, color: COLORS[index % COLORS.length] }))
    const graph = view.graphs.flatMap((open) =>
      open.series.map((series, index): Line => ({ kind: 'graph', key: series.key, graph: open.name, series, color: COLORS[(field.length + index) % COLORS.length] }))
    )
    return [...field, ...graph]
  }, [view.plots, view.graphs])
  const xRange = useMemo(() => zoom ?? ([-windowSeconds, 0] as const), [zoom, windowSeconds])
  const nowS = view.nowMs / 1000

  // Each line on one clock: seconds before now.
  const series = (line: Line): { t: number[]; v: number[] } =>
    line.kind === 'field'
      ? { t: line.plot.samples.map((sample) => (sample.t - view.nowMs) / 1000), v: line.plot.samples.map((sample) => sample.value) }
      : { t: line.series.t.map((t) => t - nowS), v: line.series.v }

  const row = (line: Line): PlotSeriesRow => {
    const { t, v } = series(line)
    const label = line.kind === 'field' ? `${line.plot.type}.${line.plot.field}` : line.series.label
    return {
      key: line.key,
      label,
      color: line.color,
      testId: line.kind === 'field' ? `mavlink-plot-${line.plot.key}` : 'mavlink-graph-line',
      content: (cursorX) => {
        // At the cursor; where the cursor is off this series' data, its latest value (dimmed).
        const onData = cursorX !== undefined && t.length > 0 && cursorX >= t[0]
        const value = onData ? valueAt(t, v, cursorX) : v[v.length - 1]
        return (
          <>
            <span className="plot-series__name">
              {line.kind === 'field' ? `${line.plot.systemId}:${line.plot.componentId} · ` : ''}
              {label}
              {line.kind === 'graph' && line.series.axis === 2 ? ' (right axis)' : ''}
            </span>
            <span
              className={`plot-series__value${onData ? ' is-cursor' : cursorX !== undefined ? ' is-latest' : ''}`}
              data-testid={line.kind === 'field' ? `mavlink-plot-current-${line.plot.key}` : undefined}
            >
              {value === undefined ? '—' : formatPlotValue(value)}
            </span>
            <span className="plot-series__actions">
              {line.kind === 'graph' ? <span className="plot-series__meta">{line.graph}</span> : null}
              {line.kind === 'field' && props.onExportPlotCsv ? (
                <button type="button" className="mavlink-inspector__field-copy" onClick={() => props.onExportPlotCsv?.(line.plot.key)} disabled={line.plot.samples.length === 0} data-testid={`mavlink-plot-csv-${line.plot.key}`}>
                  CSV
                </button>
              ) : null}
              <button
                type="button"
                className="can-monitor__icon-button"
                onClick={() => (line.kind === 'field' ? props.onRemovePlot(line.plot.key) : props.onCloseGraph(line.graph))}
                aria-label={line.kind === 'field' ? `Remove ${label}` : `Close ${line.graph}`}
                title={line.kind === 'graph' ? `Close the ${line.graph} graph` : undefined}
                data-testid={line.kind === 'field' ? `mavlink-plot-remove-${line.plot.key}` : undefined}
              >
                ×
              </button>
            </span>
          </>
        )
      }
    }
  }

  const lane = (line: Line): PlotLane => ({
    label: line.kind === 'field' ? `${line.plot.type}.${line.plot.field}` : line.series.label,
    color: line.color,
    axis: line.kind === 'graph' ? line.series.axis : 1,
    ...series(line)
  })

  const groups = groupIntoPanes(lines, (line) => line.key, props.paneOf)
  const panes: PlotPaneModel[] = groups.map((pane) => ({
    id: pane.id,
    height: props.paneHeights.get(pane.id) ?? PLOT_PANE_DEFAULT_HEIGHT,
    rows: pane.series.map(row),
    lanes: pane.series.map(lane)
  }))

  // Layouts: field plots by spec, graphs by name, and how they are grouped.
  const [layouts, setLayouts] = useState<SavedPlotLayout<LayoutSeries>[]>(() => readLayouts())
  const storeLayouts = (next: SavedPlotLayout<LayoutSeries>[]) => {
    setLayouts(next)
    writeLayouts(next)
  }
  const saveLayout = (name: string) =>
    storeLayouts(
      upsertLayout(layouts, {
        name,
        panes: groups.map((group) => {
          const seen = new Set<string>()
          const entries: LayoutSeries[] = []
          for (const line of group.series) {
            if (line.kind === 'field') entries.push({ kind: 'field', spec: { key: line.plot.key, systemId: line.plot.systemId, componentId: line.plot.componentId, type: line.plot.type, field: line.plot.field } })
            else if (!seen.has(line.graph)) {
              seen.add(line.graph)
              entries.push({ kind: 'graph', name: line.graph })
            }
          }
          return { height: props.paneHeights.get(group.id) ?? PLOT_PANE_DEFAULT_HEIGHT, series: entries }
        })
      })
    )
  const clearAll = () => {
    plots.forEach((plot) => props.onRemovePlot(plot.key))
    openGraphs.forEach((graph) => props.onCloseGraph(graph.name))
  }
  const openLayout = (name: string) => {
    const layout = layouts.find((entry) => entry.name === name)
    if (!layout) return
    clearAll()
    for (const pane of layout.panes) {
      const keys: string[] = []
      for (const entry of pane.series) {
        if (entry.kind === 'field') {
          props.onAddPlot(entry.spec)
          keys.push(entry.spec.key)
        } else {
          props.onOpenGraph(entry.name)
          keys.push(`graph|${entry.name}|0`)
        }
      }
      keys.slice(1).forEach((key) => props.onMoveSeries(key, keys[0]))
      if (keys[0]) props.onPaneHeight(keys[0], pane.height)
    }
  }

  const exportCsv = () => {
    const out = ['series,seconds_before_now,value']
    for (const line of lines) {
      const { t, v } = series(line)
      const label = (line.kind === 'field' ? `${line.plot.type}.${line.plot.field}` : line.series.label).replace(/"/g, '""')
      t.forEach((time, index) => out.push(`"${label}",${time.toFixed(3)},${v[index]}`))
    }
    downloadTextFile(`mavlink-plot-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`, `${out.join('\n')}\n`, 'text/csv')
  }

  const keys = lines.map((line) => line.key)
  return (
    <PlotWorkspace
      title="Plot"
      info={
        <>
          Charts of live MAVLink fields and of MAVExplorer's predefined graphs (MAVProxy, GPLv3), evaluated as the
          messages arrive. Add from the panel on the right: Fields lists every number the link carries, Graphs the
          library (only what this link can draw, unless you ask for all). Drag a series by its ⋮⋮ grip onto another
          chart to overlay them, or use its chart menu. Pause, then drag across a chart to zoom; double-click for the
          whole window. Drag a chart's bottom edge to resize it.
        </>
      }
      windows={[
        { seconds: 10, label: '10 s' },
        { seconds: 20, label: '20 s' },
        { seconds: props.bufferSeconds, label: `${props.bufferSeconds} s` }
      ]}
      windowSeconds={windowSeconds}
      onWindow={(seconds) => {
        setWindowSeconds(seconds)
        setZoom(undefined)
      }}
      paused={paused}
      onTogglePause={() => {
        setPaused((current) => !current)
        setZoom(undefined)
      }}
      seriesKeys={keys}
      onOverlayAll={() => keys.slice(1).forEach((key) => props.onMoveSeries(key, keys[0]))}
      onSplitAll={() => keys.forEach((key) => props.onMoveSeries(key, undefined))}
      layouts={layouts.map((layout) => layout.name)}
      onSaveLayout={saveLayout}
      onOpenLayout={openLayout}
      onDeleteLayout={(name) => storeLayouts(layouts.filter((entry) => entry.name !== name))}
      onExportCsv={exportCsv}
      onClear={clearAll}
      panes={panes}
      syncKey={SYNC_KEY}
      xRange={xRange}
      onXRangeChange={paused ? setZoom : undefined}
      xFormat={(value) => `${Number.parseFloat(value.toFixed(1))}s`}
      onMoveSeries={props.onMoveSeries}
      onPaneHeight={props.onPaneHeight}
      onDropPayload={(paneId, drop) => {
        const spec = drop.spec as MavlinkPlotSpec | undefined
        if (drop.kind !== 'mavlink-field' || !spec || typeof spec.key !== 'string') return
        if (!plots.some((plot) => plot.key === spec.key)) props.onAddPlot(spec)
        props.onMoveSeries(spec.key, paneId)
      }}
      side={[
        { id: 'fields', label: 'Fields', content: <FieldsTab stats={props.stats} plots={plots} maxPlots={props.maxPlots} onAddPlot={props.onAddPlot} onRemovePlot={props.onRemovePlot} /> },
        {
          id: 'graphs',
          label: 'Graphs',
          content: <GraphsTab graphs={props.graphs} openGraphs={openGraphs} maxGraphs={props.maxGraphs} onOpenGraph={props.onOpenGraph} onCloseGraph={props.onCloseGraph} />
        }
      ]}
      empty={
        <>
          <p>Nothing plotted yet.</p>
          <p>
            Pick a field or a predefined graph on the right, or choose <strong>graph</strong> beside a field under Messages.
          </p>
        </>
      }
      testIdPrefix="mavlink-chart"
    />
  )
}
