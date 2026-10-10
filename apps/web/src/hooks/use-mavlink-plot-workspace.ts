// The MAVLink Inspector's plot workspace: MAVExplorer graphs evaluated over
// the live link, plus how its charts are grouped (field plots and graph
// lines share the panes). Subscribes while the Inspector is open; open
// graphs keep a rolling window of points.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MAVGRAPHS, createGraphEvaluator, type GraphEvaluator, type Series } from '@arduconfig/plot-core'

import type { ArduPilotConfiguratorRuntime } from '@arduconfig/ardupilot-core'

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
}

export interface MavlinkPlotWorkspace {
  /** Every predefined graph against what the link has carried so far. */
  graphs: readonly LiveGraphEntry[]
  open: readonly OpenLiveGraph[]
  openGraph: (name: string) => void
  closeGraph: (name: string) => void
  paneOf: ReadonlyMap<string, string>
  moveSeries: (key: string, paneId: string | undefined) => void
  paneHeights: ReadonlyMap<string, PlotPaneHeight>
  setPaneHeight: (paneId: string, height: PlotPaneHeight) => void
}

export function useMavlinkPlotWorkspace(runtime: ArduPilotConfiguratorRuntime | undefined, active: boolean): MavlinkPlotWorkspace {
  const index = useRef(new LiveFieldIndex())
  const evaluators = useRef(new Map<string, GraphEvaluator>())
  const [fieldsVersion, setFieldsVersion] = useState(0)
  const [openNames, setOpenNames] = useState<readonly string[]>([])
  const [open, setOpen] = useState<readonly OpenLiveGraph[]>([])
  const [paneOf, setPaneOf] = useState<ReadonlyMap<string, string>>(new Map())
  const [paneHeights, setPaneHeights] = useState<ReadonlyMap<string, PlotPaneHeight>>(new Map())

  // A new link (or none) starts from nothing: other vehicle, other fields.
  useEffect(() => {
    index.current.clear()
    for (const evaluator of evaluators.current.values()) evaluator.reset()
    setFieldsVersion((value) => value + 1)
  }, [runtime])

  useEffect(() => {
    if (!runtime || !active) return
    let grew = false
    const unsubscribe = runtime.onMessage((envelope) => {
      const plot = mavlinkRecordForPlot(envelope.message as unknown as Record<string, unknown>)
      if (!plot) return
      if (index.current.record(plot.name, plot.record)) grew = true
      const now = Date.now() / 1000
      for (const evaluator of evaluators.current.values()) evaluator.push(plot.name, plot.record, now)
    })
    const timer = window.setInterval(() => {
      if (grew) {
        grew = false
        setFieldsVersion((value) => value + 1)
      }
      if (evaluators.current.size === 0) return
      const cutoff = Date.now() / 1000 - LIVE_GRAPH_WINDOW_S
      const next: OpenLiveGraph[] = []
      for (const [name, evaluator] of evaluators.current) {
        evaluator.trimBefore(cutoff)
        next.push({
          name,
          // Copies: the evaluator keeps appending to its own arrays.
          series: evaluator.series().map((series, termIndex) => ({ ...series, t: series.t.slice(), v: series.v.slice(), key: graphSeriesKey(name, termIndex) }))
        })
      }
      setOpen(next)
    }, FLUSH_MS)
    return () => {
      unsubscribe()
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

  const closeGraph = useCallback((name: string) => {
    evaluators.current.delete(name)
    setOpenNames((current) => current.filter((entry) => entry !== name))
    setOpen((current) => current.filter((entry) => entry.name !== name))
  }, [])

  return {
    graphs,
    open: open.filter((entry) => openNames.includes(entry.name)),
    openGraph,
    closeGraph,
    paneOf,
    moveSeries: useCallback((key: string, paneId: string | undefined) => setPaneOf((current) => assignPane(current, key, paneId)), []),
    paneHeights,
    // Assignments of series that are gone stay harmless: grouping only walks the series present.
    setPaneHeight: useCallback((paneId: string, height: PlotPaneHeight) => setPaneHeights((current) => new Map(current).set(paneId, height)), [])
  }
}
