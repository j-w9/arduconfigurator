// Plot: live charts of decoded DroneCAN fields and raw frame bytes.
//
// One small chart per series, stacked, sharing the time window and a synced
// cursor. CAN fields mix units (rpm beside volts beside a raw byte), so one
// shared y axis would flatten most of them; small multiples keep every series
// readable, and each chart keeps its own timestamps (streams do not tick
// together). Charts are uPlot (MIT): canvas, built for many live points.

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import { buttonStyle } from '@arduconfig/ui-kit'

import { InfoDot } from './InfoDot'
import { downloadTextFile } from '../download-file'
import { DronecanFieldTree } from './DronecanFieldTree'
import { canPlotLaneColor, canPlotWindow, type CanPlotSamples, type CanPlotSeries, type CanPlotSource } from '../view-models/can-plot'
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
}

const WINDOWS = [
  { ms: 10_000, label: '10 s' },
  { ms: 30_000, label: '30 s' },
  { ms: 60_000, label: '1 min' },
  { ms: 300_000, label: '5 min' }
] as const

const SYNC_KEY = 'arduconfig-can-plot'

function cssVar(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value || fallback
}

/** One series' chart. Created once; data updates go through setData. */
function SeriesChart({ entry, data, windowMs, nowMs }: { entry: CanPlotSeries; data: CanPlotSamples; windowMs: number; nowMs: number }): ReactNode {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const plotRef = useRef<uPlot | null>(null)

  // x in seconds relative to the window's end, so the axis reads "-30 .. 0";
  // then one y array per lane (one for a number, three for a vector).
  const aligned = useMemo<uPlot.AlignedData>(
    () => [data.t.map((t) => (t - nowMs) / 1000), ...(data.v.length > 0 ? data.v : [[]])],
    [data, nowMs]
  )
  const lanes = Math.max(1, data.v.length)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const axisColor = cssVar('--text-dim', '#7f8aa0')
    const gridColor = cssVar('--border-soft', '#222934')
    // The axis labels follow the tab's type scale (canvas text cannot read a CSS variable).
    const axisFont = `${getComputedStyle(host).getPropertyValue('--text-xs').trim() || '12px'} system-ui, sans-serif`
    const plot = new uPlot(
      {
        width: Math.max(200, host.clientWidth),
        height: 120,
        legend: { show: false },
        cursor: { sync: { key: SYNC_KEY }, drag: { x: false, y: false } },
        scales: { x: { time: false, range: () => [-windowMs / 1000, 0] } },
        axes: [
          { stroke: axisColor, font: axisFont, grid: { stroke: gridColor, width: 1 }, ticks: { stroke: gridColor }, values: (_u, splits) => splits.map((value) => `${value}s`) },
          { stroke: axisColor, font: axisFont, grid: { stroke: gridColor, width: 1 }, ticks: { stroke: gridColor }, size: 64 }
        ],
        series: [
          {},
          ...Array.from({ length: lanes }, (_unused, lane) => ({ stroke: canPlotLaneColor(entry, lanes, lane), width: 1.5, points: { show: false }, spanGaps: false }))
        ]
      },
      aligned,
      host
    )
    plotRef.current = plot
    const observer = new ResizeObserver(() => plot.setSize({ width: Math.max(200, host.clientWidth), height: 120 }))
    observer.observe(host)
    return () => {
      observer.disconnect()
      plot.destroy()
      plotRef.current = null
    }
    // Rebuilt when the window, colour or lane count changes; data flows through setData below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry.color, windowMs, lanes])

  useEffect(() => {
    plotRef.current?.setData(aligned)
  }, [aligned])

  return <div className="can-plot__chart" ref={hostRef} />
}

function formatPlotValue(value: number | undefined): string {
  if (value === undefined || Number.isNaN(value)) return '—'
  return Number.isInteger(value) ? String(value) : Number.parseFloat(value.toPrecision(6)).toString()
}

/** The latest value of each lane. */
function lastValues(data: CanPlotSamples): (number | undefined)[] {
  return data.v.map((lane) => lane[lane.length - 1])
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
  const [windowMs, setWindowMs] = useState<number>(30_000)
  const [frozenAt, setFrozenAt] = useState<number | undefined>(undefined)
  const endMs = frozenAt ?? nowMs
  const windows = series.map((entry) => ({ entry, data: canPlotWindow(samplesFor(entry.key), endMs, windowMs) }))

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
    <section className="can-plot" data-testid="can-plot">
      <header className="can-plot__bar">
        <h3>
          Plot
          <InfoDot label="About plotting" wide>
            Live charts of decoded DroneCAN fields (pick a device, message and field under Add a field, or choose Plot
            in Messages) and of raw frame bytes (for plain CAN). One chart per series, so different units stay
            readable; a vector (magnetic field, say) draws its elements as lines on one chart. The cursor moves across
            all of them together. Adding a series fills in what was already captured.
          </InfoDot>
        </h3>
        <div className="can-monitor__segmented" role="radiogroup" aria-label="Time window">
          {WINDOWS.map((option) => (
            <button
              key={option.ms}
              type="button"
              role="radio"
              aria-checked={windowMs === option.ms}
              className={windowMs === option.ms ? 'is-active' : undefined}
              onClick={() => setWindowMs(option.ms)}
              data-testid={`can-plot-window-${option.ms}`}
            >
              {option.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          // Same grammar as Frames: red Pause stops the charts, green Resume runs them again.
          className={`can-monitor__tool ${frozenAt !== undefined ? 'can-monitor__tool--resume' : 'can-monitor__tool--pause'}`}
          onClick={() => setFrozenAt((current) => (current === undefined ? nowMs : undefined))}
          aria-pressed={frozenAt !== undefined}
          disabled={series.length === 0}
          data-testid="can-plot-freeze"
        >
          {frozenAt !== undefined ? 'Resume' : 'Pause'}
        </button>
        <button type="button" className="can-monitor__tool" onClick={exportCsv} disabled={series.length === 0} data-testid="can-plot-export">
          Export CSV
        </button>
        <button type="button" className="can-monitor__tool" onClick={onClear} disabled={series.length === 0}>
          Clear all
        </button>
      </header>

      <div className="can-plot__body">
        <div className="can-plot__charts">
          {series.length === 0 ? (
            <div className="can-plot__empty" data-testid="can-plot-empty">
              <p>Nothing plotted yet.</p>
              <p>
                Pick a device, a message and a field under <strong>Add a field</strong>, choose <strong>Plot</strong> beside any
                number in <button type="button" className="can-plot__link" onClick={onPickFields}>Messages</button>, or plot a
                frame's bytes.
              </p>
            </div>
          ) : (
            <div className="can-plot__list">
              {windows.map(({ entry, data }) => (
                <article key={entry.key} className="can-plot__series" data-testid="can-plot-series">
                  <header className="can-plot__series-head">
                    {data.v.length > 1 ? null : <span className="can-plot__swatch" style={{ background: entry.color }} aria-hidden="true" />}
                    <strong title={entry.label}>{entry.label}</strong>
                    {data.v.length > 1 ? (
                      // A vector: each element's latest value in its line's colour.
                      <span className="can-plot__lanes can-monitor__mono" data-testid="can-plot-lanes">
                        {lastValues(data).map((value, lane) => (
                          <span key={lane} style={{ color: canPlotLaneColor(entry, data.v.length, lane) }} data-testid="can-plot-lane">
                            [{lane}] {formatPlotValue(value)}
                          </span>
                        ))}
                      </span>
                    ) : (
                      <span className="can-plot__last can-monitor__mono" data-testid="can-plot-last">
                        {formatPlotValue(lastValues(data)[0])}
                      </span>
                    )}
                    <span className="can-monitor__dim can-monitor__mono">{data.t.length} pts</span>
                    <button type="button" className="can-monitor__icon-button" onClick={() => onRemove(entry.key)} aria-label={`Remove ${entry.label}`}>
                      ×
                    </button>
                  </header>
                  <SeriesChart entry={entry} data={data} windowMs={windowMs} nowMs={endMs} />
                </article>
              ))}
            </div>
          )}
        </div>
        <aside className="can-plot__side">
          <FieldPicker
            topics={props.topics}
            nodeLabel={props.nodeLabel}
            onPlotField={props.onPlotField}
            isPlotted={props.isPlotted}
            onUnplotField={props.onUnplotField}
          />
          <BytesForm onAdd={onAddBytes} />
        </aside>
      </div>
    </section>
  )
}
