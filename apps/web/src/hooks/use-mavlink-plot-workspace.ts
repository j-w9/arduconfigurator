// The MAVLink Inspector's plot workspace: MAVExplorer graphs evaluated over
// the live link, plus how its charts are grouped (field plots and graph
// lines share the panes). Subscribes while the Inspector is open; open
// graphs keep a rolling window of points.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  MAVGRAPHS,
  SUPPORTED_FUNCTIONS,
  createGraphEvaluator,
  parseExpression,
  termFunctions,
  type GraphEvaluator,
  type Series
} from '@arduconfig/plot-core'

import type { ArduPilotConfiguratorRuntime } from '@arduconfig/ardupilot-core'
import { MAVLINK_GENERIC_ID_BY_NAME } from '@arduconfig/protocol-mavlink'

import { LiveFieldIndex, graphSeriesKey, liveGraphEntries, type LiveGraphEntry } from '../view-models/mavlink-live-graphs'
import { mavlinkRecordForPlot } from '../view-models/plot-live-mavlink'
import { assignPane, type PlotPaneHeight } from '../view-models/plot-workspace'

/** Seconds of graph points kept: the same window as the field plots (the longest the Plot tab shows). */
export const LIVE_GRAPH_WINDOW_S = 60
const FLUSH_MS = 250
export const MAX_LIVE_GRAPHS = 6

export interface LiveGraphSeries extends Series {
  key: string
}

export interface OpenLiveGraph {
  name: string
  series: LiveGraphSeries[]
  /** Typed by the operator (the name is the expression), not from the library. */
  custom?: boolean
}

/** A stretch of time in one flight mode (seconds since the epoch), for shading the charts. */
export interface FlightModeSpan {
  from: number
  to: number
  mode: string
  armed: boolean
}

/** Mode / armed changes into spans over the window, the last one running to now. */
export function flightModeSpans(changes: readonly { t: number; mode: string; armed: boolean }[], now: number, windowStart: number): FlightModeSpan[] {
  const spans: FlightModeSpan[] = []
  changes.forEach((change, index) => {
    const to = index + 1 < changes.length ? changes[index + 1].t : now
    if (to < windowStart) return
    spans.push({ from: Math.max(change.t, windowStart), to, mode: change.mode, armed: change.armed })
  })
  return spans
}

/** A parameter that changed value while the Inspector watched (seconds since the epoch). */
export interface ParamChange {
  t: number
  name: string
  from: number
  to: number
}

/**
 * Note a PARAM_VALUE: a change when the parameter was seen before with a
 * different value (the first sighting -- the initial sync -- only learns it).
 */
export function noteParamValue(known: Map<string, number>, name: string, value: number, t: number): ParamChange | undefined {
  const previous = known.get(name)
  known.set(name, value)
  if (previous === undefined || previous === value || Math.abs(previous - value) <= 1e-6 * Math.max(1, Math.abs(previous))) return undefined
  return { t, name, from: previous, to: value }
}

export interface MavlinkPlotWorkspace {
  /** Flight mode (and armed) over the buffered window, from the heartbeat. */
  modeSpans: readonly FlightModeSpan[]
  /** Parameter changes over the buffered window (yours or anyone's). */
  paramChanges: readonly ParamChange[]
  /** Every predefined graph against what the link has carried so far. */
  graphs: readonly LiveGraphEntry[]
  open: readonly OpenLiveGraph[]
  openGraph: (name: string) => void
  /** A message's id by its MAVLink name (from ArduPilot's dialect), to ask the FC to stream it. */
  messageIdOf: (name: string) => number | undefined
  /** Plot a typed expression ("degrees(ATTITUDE.roll)", or several terms); a reason when it cannot. */
  openExpression: (text: string) => string | undefined
  closeGraph: (name: string) => void
  paneOf: ReadonlyMap<string, string>
  moveSeries: (key: string, paneId: string | undefined) => void
  paneHeights: ReadonlyMap<string, PlotPaneHeight>
  setPaneHeight: (paneId: string, height: PlotPaneHeight) => void
}

const messageIdOf = (name: string): number | undefined =>
  Object.hasOwn(MAVLINK_GENERIC_ID_BY_NAME, name) ? MAVLINK_GENERIC_ID_BY_NAME[name] : undefined

export function useMavlinkPlotWorkspace(runtime: ArduPilotConfiguratorRuntime | undefined, active: boolean): MavlinkPlotWorkspace {
  const index = useRef(new LiveFieldIndex())
  const evaluators = useRef(new Map<string, GraphEvaluator>())
  const [fieldsVersion, setFieldsVersion] = useState(0)
  const [openNames, setOpenNames] = useState<readonly string[]>([])
  const custom = useRef(new Set<string>())
  const [open, setOpen] = useState<readonly OpenLiveGraph[]>([])
  const modeChanges = useRef<{ t: number; mode: string; armed: boolean }[]>([])
  const paramValues = useRef(new Map<string, number>())
  const paramLog = useRef<ParamChange[]>([])
  const [paramChanges, setParamChanges] = useState<readonly ParamChange[]>([])
  const [modeSpans, setModeSpans] = useState<readonly FlightModeSpan[]>([])
  const [paneOf, setPaneOf] = useState<ReadonlyMap<string, string>>(new Map())
  const [paneHeights, setPaneHeights] = useState<ReadonlyMap<string, PlotPaneHeight>>(new Map())

  // A new link (or none) starts from nothing: other vehicle, other fields.
  useEffect(() => {
    index.current.clear()
    modeChanges.current = []
    paramValues.current.clear()
    paramLog.current = []
    for (const evaluator of evaluators.current.values()) evaluator.reset()
    setFieldsVersion((value) => value + 1)
  }, [runtime])

  useEffect(() => {
    if (!runtime || !active) return
    let grew = false
    const unsubscribe = runtime.onMessage((envelope) => {
      if (envelope.message.type === 'PARAM_VALUE') {
        const change = noteParamValue(paramValues.current, envelope.message.paramId, envelope.message.paramValue, Date.now() / 1000)
        if (change) paramLog.current.push(change)
        return
      }
      const plot = mavlinkRecordForPlot(envelope.message as unknown as Record<string, unknown>)
      if (!plot) return
      if (index.current.record(plot.name, plot.record)) grew = true
      const now = Date.now() / 1000
      for (const evaluator of evaluators.current.values()) evaluator.push(plot.name, plot.record, now)
    })
    // Flight-mode (and armed) changes, for MAVExplorer-style bands: from the
    // runtime's vehicle state, which every heartbeat path feeds.
    const noteMode = () => {
      const vehicle = runtime.getSnapshot().vehicle
      const last = modeChanges.current[modeChanges.current.length - 1]
      if (vehicle?.flightMode && (!last || last.mode !== vehicle.flightMode || last.armed !== vehicle.armed)) {
        modeChanges.current.push({ t: Date.now() / 1000, mode: vehicle.flightMode, armed: vehicle.armed })
      }
    }
    noteMode()
    const unsubscribeSnapshot = runtime.subscribe(noteMode)
    // Start from the parameters already synced, so the first change to any of them is a change.
    for (const parameter of runtime.getSnapshot().parameters) {
      if (!paramValues.current.has(parameter.id)) paramValues.current.set(parameter.id, parameter.value)
    }
    const timer = window.setInterval(() => {
      if (grew) {
        grew = false
        setFieldsVersion((value) => value + 1)
      }
      const now = Date.now() / 1000
      // Keep the change in force at the window's start, drop older ones.
      while (modeChanges.current.length > 1 && modeChanges.current[1].t < now - LIVE_GRAPH_WINDOW_S) modeChanges.current.shift()
      const spans = flightModeSpans(modeChanges.current, now, now - LIVE_GRAPH_WINDOW_S)
      // The last span runs to now, so it moves every flush; skip the re-render while there is nothing to shade.
      setModeSpans((current) => (current.length === 0 && spans.length === 0 ? current : spans))
      while (paramLog.current.length > 0 && paramLog.current[0].t < now - LIVE_GRAPH_WINDOW_S) paramLog.current.shift()
      setParamChanges((current) => (current.length === paramLog.current.length && current[current.length - 1] === paramLog.current[paramLog.current.length - 1] ? current : [...paramLog.current]))
      if (evaluators.current.size === 0) return
      const cutoff = now - LIVE_GRAPH_WINDOW_S
      const next: OpenLiveGraph[] = []
      for (const [name, evaluator] of evaluators.current) {
        evaluator.trimBefore(cutoff)
        next.push({
          name,
          // Copies: the evaluator keeps appending to its own arrays.
          custom: custom.current.has(name),
          series: evaluator.series().map((series, termIndex) => ({ ...series, t: series.t.slice(), v: series.v.slice(), key: graphSeriesKey(name, termIndex) }))
        })
      }
      setOpen(next)
    }, FLUSH_MS)
    return () => {
      unsubscribe()
      unsubscribeSnapshot()
      window.clearInterval(timer)
    }
  }, [runtime, active])

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const graphs = useMemo(() => liveGraphEntries(MAVGRAPHS, index.current.availability()), [fieldsVersion])

  const openGraph = useCallback(
    (name: string) => {
      if (evaluators.current.has(name) || evaluators.current.size >= MAX_LIVE_GRAPHS) return
      const entry = graphs.find((graph) => graph.name === name)
      if (!entry?.terms) return
      evaluators.current.set(name, createGraphEvaluator(entry.terms))
      setOpenNames((current) => [...current, name])
      setOpen((current) => [...current, { name, series: entry.terms!.map((term, termIndex) => ({ label: term.label, axis: term.axis, t: [], v: [], key: graphSeriesKey(name, termIndex) })) }])
      // A graph's lines start on one chart together.
      setPaneOf((current) => {
        let next = new Map(current)
        const first = graphSeriesKey(name, 0)
        for (let termIndex = 1; termIndex < entry.terms!.length; termIndex += 1) next = assignPane(next, graphSeriesKey(name, termIndex), first)
        return next
      })
    },
    [graphs]
  )

  const openExpression = useCallback((text: string): string | undefined => {
    const name = text.trim()
    if (!name) return 'Type an expression.'
    if (evaluators.current.has(name)) return undefined
    if (evaluators.current.size >= MAX_LIVE_GRAPHS) return `At most ${MAX_LIVE_GRAPHS} graphs and expressions at once.`
    const { terms, errors } = parseExpression(name)
    if (errors.length > 0) return errors[0].message
    if (terms.length === 0) return 'Type an expression.'
    const unsupported = terms.flatMap((term) => termFunctions(term)).find((fn) => !SUPPORTED_FUNCTIONS.has(fn))
    if (unsupported) return `${unsupported}() is not supported.`
    custom.current.add(name)
    evaluators.current.set(name, createGraphEvaluator(terms))
    setOpenNames((current) => [...current, name])
    setOpen((current) => [...current, { name, custom: true, series: terms.map((term, termIndex) => ({ label: term.label, axis: term.axis, t: [], v: [], key: graphSeriesKey(name, termIndex) })) }])
    setPaneOf((current) => {
      let next = new Map(current)
      for (let termIndex = 1; termIndex < terms.length; termIndex += 1) next = assignPane(next, graphSeriesKey(name, termIndex), graphSeriesKey(name, 0))
      return next
    })
    return undefined
  }, [])

  const closeGraph = useCallback((name: string) => {
    custom.current.delete(name)
    evaluators.current.delete(name)
    setOpenNames((current) => current.filter((entry) => entry !== name))
    setOpen((current) => current.filter((entry) => entry.name !== name))
  }, [])

  return {
    modeSpans,
    paramChanges,
    graphs,
    open: open.filter((entry) => openNames.includes(entry.name)),
    openGraph,
    messageIdOf,
    openExpression,
    closeGraph,
    paneOf,
    moveSeries: useCallback((key: string, paneId: string | undefined) => setPaneOf((current) => assignPane(current, key, paneId)), []),
    paneHeights,
    // Assignments of series that are gone stay harmless: grouping only walks the series present.
    setPaneHeight: useCallback((paneId: string, height: PlotPaneHeight) => setPaneHeights((current) => new Map(current).set(paneId, height)), [])
  }
}
