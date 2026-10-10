// Plot: live charts of decoded DroneCAN fields and raw frame bytes.
//
// Stacked charts sharing the time window, cursor and (paused) zoom. CAN
// fields mix units (rpm beside volts beside a raw byte), so a series starts
// on a chart of its own; drag one onto another chart to overlay them. Drawn
// with the shared plot panes (plot/PlotPanes, uPlot), as is the MAVLink
// Inspector.

import { useMemo, useState, type ReactNode } from 'react'
import { buttonStyle } from '@arduconfig/ui-kit'

import { type PlotLane } from '../plot/PlotChart'
import { type PlotPaneModel, type PlotSeriesRow } from '../plot/PlotPanes'
import { PlotWorkspace } from '../plot/PlotWorkspace'
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
import { downloadTextFile } from '../download-file'
import { DronecanFieldTree } from './DronecanFieldTree'
import { canPlotLaneColor, canPlotSeriesKey, canPlotWindow, type CanPlotSamples, type CanPlotSeries, type CanPlotSource } from '../view-models/can-plot'
import { formatCanTopicRate, type CanTopicEntry } from '../view-models/can-topics'
import { dronecanDisplayName, transferFieldTree, type DronecanFieldNode } from '../view-models/dronecan-field-tree'

export interface CanPlotViewProps {
  series: readonly CanPlotSeries[]
  samplesFor: (key: string) => CanPlotSamples | undefined
  /** End of the time window: the clock live, the play position in a log. */
  nowMs: number
  onRemove: (key: string) => void
  onClear: () => void
  onAddBytes: (label: string, source: Extract<CanPlotSource, { kind: 'bytes' }>) => void
  /** Go to Messages to pick fields. */
  onPickFields: () => void
  /** Decoded streams, for picking a field right here: device, then message, then field. */
  topics: readonly CanTopicEntry[]
  nodeLabel: (nodeId: number) => string | undefined
  onPlotField: (topic: CanTopicEntry, node: DronecanFieldNode) => void
  isPlotted: (topic: CanTopicEntry, node: DronecanFieldNode) => boolean
  onUnplotField: (topic: CanTopicEntry, node: DronecanFieldNode) => void
  /** Add any series (a saved layout coming back); returns its key. */
  onAddSeries: (label: string, source: CanPlotSource) => string
  /** Which pane each series is on; absent = a pane of its own. */
  paneOf: ReadonlyMap<string, string>
  paneHeights: ReadonlyMap<string, PlotPaneHeight>
  onMoveSeries: (key: string, paneId: string | undefined) => void
  onPaneHeight: (paneId: string, height: PlotPaneHeight) => void
}

const WINDOWS = [
  { seconds: 10, label: '10 s' },
  { seconds: 30, label: '30 s' },
  { seconds: 60, label: '1 min' },
  { seconds: 300, label: '5 min' }
] as const

const SYNC_KEY = 'arduconfig-can-plot'

/** A series' lines for its pane's chart: x in seconds before the window's end. */
function seriesLanes(entry: CanPlotSeries, data: CanPlotSamples, endMs: number): PlotLane[] {
  const t = data.t.map((time) => (time - endMs) / 1000)
  const count = Math.max(1, data.v.length)
  return Array.from({ length: count }, (_unused, lane) => ({
    label: count > 1 ? `${entry.label} [${lane}]` : entry.label,
    color: canPlotLaneColor(entry, count, lane),
    t,
    v: data.v[lane] ?? []
  }))
}

/** One series' row over its chart: name, value (at the cursor, else the latest), points, remove. */
function seriesRow(entry: CanPlotSeries, data: CanPlotSamples, endMs: number, onRemove: (key: string) => void): PlotSeriesRow {
  const vector = data.v.length > 1
  return {
    key: entry.key,
    label: entry.label,
    color: vector ? canPlotLaneColor(entry, data.v.length, 0) : entry.color,
    testId: 'can-plot-series',
    content: (cursorX) => {
      const at = cursorX === undefined ? undefined : endMs + cursorX * 1000
      const values = data.v.map((lane) => (at === undefined ? lane[lane.length - 1] : valueAt(data.t, lane, at)))
      return (
        <>
          <span className="plot-series__name" title={entry.label}>
            {entry.label}
          </span>
          {vector ? (
            // A vector: each element's value in its line's colour.
            <span className="can-plot__lanes can-monitor__mono" data-testid="can-plot-lanes">
              {values.map((value, lane) => (
                <span key={lane} style={{ color: canPlotLaneColor(entry, data.v.length, lane) }} data-testid="can-plot-lane">
                  [{lane}] {formatPlotValue(value)}
                </span>
              ))}
            </span>
          ) : (
            <span className={`plot-series__value${at !== undefined ? ' is-cursor' : ''}`} data-testid="can-plot-last">
              {formatPlotValue(values[0])}
            </span>
          )}
          <span className="plot-series__actions">
            <span className="plot-series__meta">{data.t.length} pts</span>
            <button type="button" className="can-monitor__icon-button" onClick={() => onRemove(entry.key)} aria-label={`Remove ${entry.label}`}>
              ×
            </button>
          </span>
        </>
      )
    }
  }
}

/** The field at a path in a decoded tree (elements of a vector included). */
function findFieldNode(nodes: readonly DronecanFieldNode[], path: readonly (string | number)[]): DronecanFieldNode | undefined {
  const target = path.join('.')
  for (const node of nodes) {
    if (node.path.join('.') === target) return node
    const inner = findFieldNode([...(node.children ?? []), ...(node.elements ?? [])], path)
    if (inner) return inner
  }
  return undefined
}

/** A series as a layout stores it. */
interface CanPlotLayoutSeries {
  label: string
  source: CanPlotSource
}

const LAYOUTS_KEY = 'arduconfig-can-plot-layouts'

function isLayoutSeries(value: unknown): value is CanPlotLayoutSeries {
  const entry = value as { label?: unknown; source?: { kind?: unknown } } | null
  return typeof entry?.label === 'string' && (entry.source?.kind === 'field' || entry.source?.kind === 'bytes')
}

function readCanPlotLayouts(): SavedPlotLayout<CanPlotLayoutSeries>[] {
  try {
    return parseSavedLayouts(window.localStorage.getItem(LAYOUTS_KEY), isLayoutSeries)
  } catch {
    return []
  }
}

function writeCanPlotLayouts(layouts: readonly SavedPlotLayout<CanPlotLayoutSeries>[]): void {
  try {
    window.localStorage.setItem(LAYOUTS_KEY, serializeSavedLayouts(layouts))
  } catch {
    // Private window or storage blocked: the layout lives until reload.
  }
}

function formatPlotValue(value: number | undefined): string {
  if (value === undefined || Number.isNaN(value)) return '—'
  return Number.isInteger(value) ? String(value) : Number.parseFloat(value.toPrecision(6)).toString()
}


/** Plot any frame's bytes: the path for plain CAN, where there is no DSDL. */
function BytesForm({ onAdd }: { onAdd: CanPlotViewProps['onAddBytes'] }): ReactNode {
  const [idText, setIdText] = useState('')
  const [offset, setOffset] = useState('0')
  const [width, setWidth] = useState<'1' | '2' | '4'>('1')
  const [signed, setSigned] = useState(false)
  const [littleEndian, setLittleEndian] = useState(true)
  const [bus, setBus] = useState('1')
  const clean = idText.trim().replace(/^0x/i, '')
  const id = /^[0-9a-f]{1,8}$/i.test(clean) ? Number.parseInt(clean, 16) : undefined
  const offsetNumber = Number(offset)
  const valid = id !== undefined && id <= 0x1fffffff && Number.isInteger(offsetNumber) && offsetNumber >= 0 && offsetNumber < 64
  const extended = clean.length > 3 || (id ?? 0) > 0x7ff
  return (
    <form
      className="can-plot__bytes-form"
      onSubmit={(event) => {
        event.preventDefault()
        if (!valid || id === undefined) return
        const w = Number(width) as 1 | 2 | 4
        const label = `${id.toString(16).toUpperCase().padStart(extended ? 8 : 3, '0')} byte ${offsetNumber}${w > 1 ? `..${offsetNumber + w - 1}` : ''} ${signed ? 'int' : 'uint'}${w * 8}${w > 1 ? (littleEndian ? ' LE' : ' BE') : ''}`
        onAdd(label, { kind: 'bytes', bus: Number(bus), id, extended, offset: offsetNumber, width: w, signed, littleEndian })
      }}
      data-testid="can-plot-bytes-form"
    >
      <strong>Plot frame bytes</strong>
      <label>
        <span>ID (hex)</span>
        <input value={idText} onChange={(event) => setIdText(event.target.value)} placeholder="2A0" spellCheck={false} data-testid="can-plot-bytes-id" />
      </label>
      <label>
        <span>Bus</span>
        <select value={bus} onChange={(event) => setBus(event.target.value)}>
          <option value="1">CAN1</option>
          <option value="2">CAN2</option>
        </select>
      </label>
      <label>
        <span>Byte</span>
        <input type="number" min={0} max={63} value={offset} onChange={(event) => setOffset(event.target.value)} data-testid="can-plot-bytes-offset" />
      </label>
      <label>
        <span>Width</span>
        <select value={width} onChange={(event) => setWidth(event.target.value as '1' | '2' | '4')} data-testid="can-plot-bytes-width">
          <option value="1">8-bit</option>
          <option value="2">16-bit</option>
          <option value="4">32-bit</option>
        </select>
      </label>
      <label className="can-monitor__check">
        <input type="checkbox" checked={signed} onChange={(event) => setSigned(event.target.checked)} />
        <span>Signed</span>
      </label>
      {width !== '1' ? (
        <label>
          <span>Order</span>
          <select value={littleEndian ? 'le' : 'be'} onChange={(event) => setLittleEndian(event.target.value === 'le')}>
            <option value="le">Little-endian</option>
            <option value="be">Big-endian</option>
          </select>
        </label>
      ) : null}
      <button type="submit" style={buttonStyle()} disabled={!valid} data-testid="can-plot-bytes-add">
        Add
      </button>
    </form>
  )
}

/** Pick a field right here: a device, one of its messages, then any number (or vector) in it. */
function FieldPicker(props: Pick<CanPlotViewProps, 'topics' | 'nodeLabel' | 'onPlotField' | 'isPlotted' | 'onUnplotField'>): ReactNode {
  const { topics, nodeLabel } = props
  const [device, setDevice] = useState<string>('all')
  const [topicKey, setTopicKey] = useState<string>('')
  // Only streams with decoded values have fields to plot.
  const decoded = topics.filter((topic) => topic.last.value !== undefined && topic.last.type !== undefined)
  const devices = [...new Set(decoded.map((topic) => topic.sourceNodeId))].sort((left, right) => left - right)
  const streams = decoded
    .filter((topic) => device === 'all' || topic.sourceNodeId === Number(device))
    .map((topic) => {
      const base = dronecanDisplayName(topic.last.type!.fullName)
      const name = topic.index ? `${base} #${topic.index.value}` : base
      return { topic, name }
    })
    .sort((left, right) => left.name.localeCompare(right.name) || left.topic.sourceNodeId - right.topic.sourceNodeId)
  const selected = streams.find((entry) => entry.topic.key === topicKey)?.topic
  const tree = selected ? transferFieldTree(selected.last) : undefined
  const deviceName = (nodeId: number) => {
    const label = nodeLabel(nodeId)
    return label ? `${nodeId} ${label}` : `Node ${nodeId}`
  }
  return (
    <section className="can-plot__picker" data-testid="can-plot-picker">
      <strong>Add a field</strong>
      <label>
        <span>Device</span>
        <select
          value={device}
          onChange={(event) => {
            setDevice(event.target.value)
            setTopicKey('')
          }}
          data-testid="can-plot-pick-device"
        >
          <option value="all">All devices</option>
          {devices.map((nodeId) => (
            <option key={nodeId} value={String(nodeId)}>
              {deviceName(nodeId)}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>Message</span>
        <select value={selected ? topicKey : ''} onChange={(event) => setTopicKey(event.target.value)} data-testid="can-plot-pick-message">
          <option value="">{streams.length === 0 ? 'Nothing decoded yet' : 'Choose a message…'}</option>
          {streams.map(({ topic, name }) => (
            <option key={topic.key} value={topic.key}>
              {name}
              {device === 'all' ? ` ← ${topic.sourceNodeId}` : ''}
              {topic.kind === 'message' ? ` · ${formatCanTopicRate(topic.rateHz)}` : ''}
            </option>
          ))}
        </select>
      </label>
      {selected && tree ? (
        <div className="can-plot__picker-tree" data-testid="can-plot-pick-fields">
          <DronecanFieldTree
            nodes={tree}
            onPlot={(node) => props.onPlotField(selected, node)}
            isPlotted={(node) => props.isPlotted(selected, node)}
            onUnplot={(node) => props.onUnplotField(selected, node)}
            dragPayload={(node) => JSON.stringify({ kind: 'field', topicKey: selected.key, path: node.path })}
          />
        </div>
      ) : (
        <p className="can-monitor__dim">Choose a message to see its fields.</p>
      )}
    </section>
  )
}

export function CanPlotView(props: CanPlotViewProps): ReactNode {
  const { series, samplesFor, nowMs, onRemove, onClear, onAddBytes, onPickFields } = props
  const [windowSeconds, setWindowSeconds] = useState<number>(30)
  const [frozenAt, setFrozenAt] = useState<number | undefined>(undefined)
  // Paused, a drag across any chart zooms them all (double-click: the whole window).
  const [zoom, setZoom] = useState<readonly [number, number] | undefined>(undefined)
  const endMs = frozenAt ?? nowMs
  const windowMs = windowSeconds * 1000
  const windows = series.map((entry) => ({ entry, data: canPlotWindow(samplesFor(entry.key), endMs, windowMs) }))
  const dataByKey = new Map(windows.map((entry) => [entry.entry.key, entry.data]))
  const xRange = useMemo(() => zoom ?? ([-windowSeconds, 0] as const), [zoom, windowSeconds])
  const groups = groupIntoPanes(series, (entry) => entry.key, props.paneOf)

  const panes: PlotPaneModel[] = groups.map((pane) => ({
    id: pane.id,
    height: props.paneHeights.get(pane.id) ?? PLOT_PANE_DEFAULT_HEIGHT,
    rows: pane.series.map((entry) => seriesRow(entry, dataByKey.get(entry.key)!, endMs, onRemove)),
    lanes: pane.series.flatMap((entry) => seriesLanes(entry, dataByKey.get(entry.key)!, endMs))
  }))

  // A field dragged in from the side panel lands on the chart it is dropped on.
  const onDropPayload = (paneId: string | undefined, drop: { kind?: string; topicKey?: unknown; path?: unknown }) => {
    if (drop.kind !== 'field' || typeof drop.topicKey !== 'string' || !Array.isArray(drop.path)) return
    const topic = props.topics.find((entry) => entry.key === drop.topicKey)
    const tree = topic ? transferFieldTree(topic.last) : undefined
    const node = tree ? findFieldNode(tree, drop.path as (string | number)[]) : undefined
    if (!topic || !node) return
    const key = canPlotSeriesKey({ kind: 'field', topicKey: topic.key, path: node.path })
    if (!series.some((entry) => entry.key === key)) props.onPlotField(topic, node)
    props.onMoveSeries(key, paneId)
  }

  // Saved layouts: the series (by source), their charts and heights.
  const [layouts, setLayouts] = useState<SavedPlotLayout<CanPlotLayoutSeries>[]>(() => readCanPlotLayouts())
  const storeLayouts = (next: SavedPlotLayout<CanPlotLayoutSeries>[]) => {
    setLayouts(next)
    writeCanPlotLayouts(next)
  }
  const saveLayout = (name: string) =>
    storeLayouts(
      upsertLayout(layouts, {
        name,
        panes: groups.map((group) => ({
          height: props.paneHeights.get(group.id) ?? PLOT_PANE_DEFAULT_HEIGHT,
          series: group.series.map((entry) => ({ label: entry.label, source: entry.source }))
        }))
      })
    )
  const openLayout = (name: string) => {
    const layout = layouts.find((entry) => entry.name === name)
    if (!layout) return
    onClear()
    for (const pane of layout.panes) {
      const keys = pane.series.map((entry) => props.onAddSeries(entry.label, entry.source))
      keys.slice(1).forEach((key) => props.onMoveSeries(key, keys[0]))
      if (keys[0]) props.onPaneHeight(keys[0], pane.height)
    }
  }

  const exportCsv = () => {
    const rows = ['series,time_s,value']
    for (const { entry, data } of windows) {
      data.v.forEach((lane, laneIndex) => {
        const label = data.v.length > 1 ? `${entry.label} [${laneIndex}]` : entry.label
        data.t.forEach((t, index) => {
          if (!Number.isNaN(lane[index])) rows.push(`"${label.replace(/"/g, '""')}",${(t / 1000).toFixed(6)},${lane[index]}`)
        })
      })
    }
    downloadTextFile(`can-plot-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`, `${rows.join('\n')}\n`, 'text/csv')
  }

  return (
    <PlotWorkspace
      title="Plot"
      info={
        <>
          Live charts of decoded DroneCAN fields and of raw frame bytes (for plain CAN). Add from the panel on the right
          (or Plot beside any number in Messages): each series starts on a chart of its own, so different units stay
          readable. Drag a series by its ⋮⋮ grip onto another chart to overlay them, or use its chart menu; a field can
          be dragged straight from the panel onto a chart. The cursor moves across every chart and the values follow it.
          Pause, then drag across a chart to zoom them all (double-click for the whole window). Drag a chart's bottom
          edge to resize it. A saved layout brings the series and their charts back.
        </>
      }
      windows={WINDOWS}
      windowSeconds={windowSeconds}
      onWindow={(seconds) => {
        setWindowSeconds(seconds)
        setZoom(undefined)
      }}
      paused={frozenAt !== undefined}
      onTogglePause={() => {
        setFrozenAt((current) => (current === undefined ? nowMs : undefined))
        setZoom(undefined)
      }}
      seriesKeys={series.map((entry) => entry.key)}
      onOverlayAll={() => series.slice(1).forEach((entry) => props.onMoveSeries(entry.key, series[0].key))}
      onSplitAll={() => series.forEach((entry) => props.onMoveSeries(entry.key, undefined))}
      layouts={layouts.map((layout) => layout.name)}
      onSaveLayout={saveLayout}
      onOpenLayout={openLayout}
      onDeleteLayout={(name) => storeLayouts(layouts.filter((entry) => entry.name !== name))}
      onExportCsv={exportCsv}
      onClear={onClear}
      panes={panes}
      syncKey={SYNC_KEY}
      xRange={xRange}
      onXRangeChange={frozenAt !== undefined ? setZoom : undefined}
      xFormat={(value) => `${Number.parseFloat(value.toFixed(2))}s`}
      onMoveSeries={props.onMoveSeries}
      onPaneHeight={props.onPaneHeight}
      onDropPayload={onDropPayload}
      side={[
        {
          id: 'fields',
          label: 'Fields',
          content: (
            <FieldPicker topics={props.topics} nodeLabel={props.nodeLabel} onPlotField={props.onPlotField} isPlotted={props.isPlotted} onUnplotField={props.onUnplotField} />
          )
        },
        { id: 'bytes', label: 'Frame bytes', content: <BytesForm onAdd={onAddBytes} /> }
      ]}
      empty={
        <>
          <p>Nothing plotted yet.</p>
          <p>
            Pick a device, a message and a field on the right, choose <strong>Plot</strong> beside any number in{' '}
            <button type="button" className="can-plot__link" onClick={onPickFields}>
              Messages
            </button>
            , or plot a frame's bytes.
          </p>
        </>
      }
      testIdPrefix="can-plot"
    />
  )
}
