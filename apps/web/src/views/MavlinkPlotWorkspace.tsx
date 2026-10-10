// The MAVLink Inspector's plots: field plots (from the message table's plot
// buttons) and MAVExplorer's predefined graphs, evaluated live, on the
// shared plot panes. A graph's lines start on one chart; any line can be
// dragged onto another chart to overlay it, or out onto one of its own.
// Presentational: the live graphs come from useMavlinkPlotWorkspace.

import { useMemo, useState, type ReactNode } from 'react'

import { PlotPanes, plotDragProps, type PlotPaneModel } from '../plot/PlotPanes'
import type { PlotLane } from '../plot/PlotChart'
import type { MavlinkPlot } from '../hooks/use-mavlink-inspector'
import type { OpenLiveGraph, LiveGraphSeries } from '../hooks/use-mavlink-plot-workspace'
import { buildPlotGeometry, formatPlotValue } from '../view-models/mavlink-inspector'
import { filterLiveGraphs, type LiveGraphEntry } from '../view-models/mavlink-live-graphs'
import { groupIntoPanes, type PlotPaneHeight } from '../view-models/plot-workspace'

export interface MavlinkPlotWorkspaceProps {
  plots: readonly MavlinkPlot[]
  onRemovePlot?: (key: string) => void
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
  /** Seconds shown: the live window. */
  windowSeconds: number
}

const COLORS = ['#4aa3ff', '#f2b400', '#3ecf8e', '#e5484d', '#b07cf7', '#ff8a3d', '#22c3c3', '#e86fb0']

type Line =
  | { kind: 'field'; key: string; plot: MavlinkPlot; color: string }
  | { kind: 'graph'; key: string; graph: string; series: LiveGraphSeries; color: string }

function GraphPicker(props: Pick<MavlinkPlotWorkspaceProps, 'graphs' | 'openGraphs' | 'maxGraphs' | 'onOpenGraph' | 'onCloseGraph'>): ReactNode {
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
    <details className="mavlink-graphs" data-testid="mavlink-graphs">
      <summary>
        Predefined graphs <span className="mavlink-graphs__count">{drawable} of {props.graphs.length} can draw from this link</span>
      </summary>
      <p className="mavlink-graphs__note">
        MAVExplorer's graph library (MAVProxy, GPLv3), evaluated live. Pick one to see what it shows; graphs that need
        messages this link has not carried are hidden unless you ask for them.
      </p>
      <div className="mavlink-graphs__controls">
        <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search: attitude, battery, GPS…" data-testid="mavlink-graphs-search" />
        <label>
          <input type="checkbox" checked={showAll} onChange={(event) => setShowAll(event.target.checked)} data-testid="mavlink-graphs-all" />
          <span>Show all</span>
        </label>
      </div>
      <div className="mavlink-graphs__list">
        {[...categories.entries()].map(([category, entries]) => (
          <div key={category} className="mavlink-graphs__group">
            <strong>{category}</strong>
            {entries.map((entry) => (
              <div key={entry.name} className={`mavlink-graphs__item${entry.unavailable ? ' is-unavailable' : ''}`}>
                <button type="button" className="mavlink-graphs__name" onClick={() => setAbout(about === entry.name ? undefined : entry.name)} title={entry.unavailable ?? entry.description}>
                  {entry.title}
                </button>
                {openNames.has(entry.name) ? (
                  <button type="button" className="mavlink-graphs__toggle is-open" onClick={() => props.onCloseGraph(entry.name)} data-testid={`mavlink-graph-close-${entry.name}`}>
                    Plotted
                  </button>
                ) : (
                  <button
                    type="button"
                    className="mavlink-graphs__toggle"
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
        {visible.length === 0 ? <p className="mavlink-graphs__note">{props.graphs.some((entry) => !entry.unavailable) || showAll ? 'No graph matches.' : 'Nothing to draw yet: no message a graph needs has arrived.'}</p> : null}
      </div>
      {picked ? (
        <div className="mavlink-graphs__about" data-testid="mavlink-graph-about">
          <strong>{picked.name}</strong>
          <p>{picked.description || 'No description.'}</p>
          {picked.unavailable ? <p className="mavlink-graphs__note">{picked.unavailable}</p> : null}
        </div>
      ) : null}
    </details>
  )
}

export function MavlinkPlotWorkspace(props: MavlinkPlotWorkspaceProps): ReactNode {
  const { plots, openGraphs, windowSeconds } = props
  const nowMs = Date.now()
  const lines = useMemo<Line[]>(() => {
    const field = plots.map((plot, index): Line => ({ kind: 'field', key: plot.key, plot, color: COLORS[index % COLORS.length] }))
    const graph = openGraphs.flatMap((open) =>
      open.series.map((series, index): Line => ({ kind: 'graph', key: series.key, graph: open.name, series, color: COLORS[index % COLORS.length] }))
    )
    return [...field, ...graph]
  }, [plots, openGraphs])
  const xRange = useMemo(() => [-windowSeconds, 0] as const, [windowSeconds])

  const lane = (line: Line): PlotLane =>
    line.kind === 'field'
      ? { label: `${line.plot.type}.${line.plot.field}`, color: line.color, t: line.plot.samples.map((sample) => (sample.t - nowMs) / 1000), v: line.plot.samples.map((sample) => sample.value) }
      : { label: line.series.label, color: line.color, axis: line.series.axis, t: line.series.t.map((t) => t - nowMs / 1000), v: line.series.v }

  const row = (line: Line): ReactNode => {
    const drag = plotDragProps(JSON.stringify({ kind: 'series', key: line.key }))
    if (line.kind === 'field') {
      const { plot } = line
      const geometry = buildPlotGeometry(plot.samples, 240, 60)
      return (
        <div key={line.key} className="mavlink-plot-row" {...drag} title="Drag onto another chart to overlay" data-testid={`mavlink-plot-${plot.key}`}>
          <span className="mavlink-plot-row__swatch" style={{ background: line.color }} aria-hidden="true" />
          <span className="mavlink-plot-row__name">
            {plot.systemId}:{plot.componentId} · {plot.type}.{plot.field}
          </span>
          <span className="mavlink-plot-row__value" data-testid={`mavlink-plot-current-${plot.key}`}>
            now {formatPlotValue(geometry.current)}
          </span>
          <span className="mavlink-plot-row__meta">
            min {formatPlotValue(geometry.min)} · max {formatPlotValue(geometry.max)} · {geometry.sampleCount} pts
          </span>
          {props.onExportPlotCsv ? (
            <button type="button" className="mavlink-inspector__field-copy" onClick={() => props.onExportPlotCsv?.(plot.key)} disabled={plot.samples.length === 0} data-testid={`mavlink-plot-csv-${plot.key}`}>
              CSV
            </button>
          ) : null}
          <button type="button" className="mavlink-inspector__field-copy" onClick={() => props.onRemovePlot?.(plot.key)} data-testid={`mavlink-plot-remove-${plot.key}`}>
            remove
          </button>
        </div>
      )
    }
    const { series } = line
    const last = series.v[series.v.length - 1]
    return (
      <div key={line.key} className="mavlink-plot-row" {...drag} title={series.unsupported ?? 'Drag onto another chart to overlay'} data-testid="mavlink-graph-line">
        <span className="mavlink-plot-row__swatch" style={{ background: line.color }} aria-hidden="true" />
        <span className="mavlink-plot-row__name">
          {series.label}
          {series.axis === 2 ? ' (right axis)' : ''}
        </span>
        <span className="mavlink-plot-row__value">{last === undefined ? '—' : formatPlotValue(last)}</span>
        <span className="mavlink-plot-row__meta">{line.graph}</span>
        <button type="button" className="mavlink-inspector__field-copy" onClick={() => props.onCloseGraph(line.graph)} title={`Close ${line.graph}`}>
          close graph
        </button>
      </div>
    )
  }

  const panes: PlotPaneModel[] = groupIntoPanes(lines, (line) => line.key, props.paneOf).map((pane) => ({
    id: pane.id,
    height: props.paneHeights.get(pane.id) ?? 'm',
    rows: pane.series.map(row),
    lanes: pane.series.map(lane)
  }))

  return (
    <div className="mavlink-plot-workspace">
      <GraphPicker graphs={props.graphs} openGraphs={openGraphs} maxGraphs={props.maxGraphs} onOpenGraph={props.onOpenGraph} onCloseGraph={props.onCloseGraph} />
      {panes.length > 0 ? (
        <div data-testid="mavlink-plots">
          <PlotPanes
            panes={panes}
            syncKey="arduconfig-mavlink-plot"
            xRange={xRange}
            xFormat={(value) => `${Math.round(value)}s`}
            onPaneHeight={props.onPaneHeight}
            onDrop={(paneId, payload) => {
              try {
                const drop = JSON.parse(payload) as { kind?: string; key?: string }
                if (drop.kind === 'series' && drop.key) props.onMoveSeries(drop.key, paneId)
              } catch {
                // Not a series.
              }
            }}
            testIdPrefix="mavlink-chart"
          />
        </div>
      ) : null}
    </div>
  )
}
