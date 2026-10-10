// Turns graph terms into time series, with MAVExplorer's semantics: walk the
// messages in time order keeping the latest record of each type (and of each
// referenced instance); whenever a message of a type a term references
// arrives, evaluate that term — once everything it references has been seen —
// and append (t, value). Non-numeric / non-finite results are skipped.
//
// The same incremental evaluator serves live MAVLink (the caller pushes
// decoded messages as plain records) and DataFlash logs (evaluateOnDataflash
// merges the referenced message types by timestamp and pushes them).

import { compileExpression, isTruthy, termFunctions, termReferences, type CompiledExpression, type Term } from './expression.js'
import { SUPPORTED_FUNCTIONS } from './functions.js'
import type { DataAvailability } from './graph-library.js'
import type { EvalEnv, MessageRecord } from './types.js'

export interface Series {
  readonly label: string
  readonly axis: 1 | 2
  /** Seconds (DataFlash: log time since boot; live: whatever the caller pushes). */
  readonly t: number[]
  readonly v: number[]
  /** Set when the term could not be evaluated at all (e.g. an unsupported function). */
  readonly unsupported?: string
}

export interface EvaluatorOptions {
  /** Vehicle parameter lookup for functions that need one (altitude, mag_heading). */
  param?(name: string): number | undefined
}

export interface GraphEvaluator {
  /** Feed one message. `instance` is its instance number, when the type has one. */
  push(messageName: string, record: MessageRecord, timeSeconds: number, instance?: number): void
  /** The series so far, one per term (live arrays — copy them to keep a snapshot). */
  series(): Series[]
  /** Message types the terms reference (only these need pushing). */
  messageTypes(): string[]
  /** Forget all messages, points and filter state. */
  reset(): void
  /** Drop points older than this (a live window), keeping messages and filter state. */
  trimBefore(timeSeconds: number): void
}

export type TermEvaluator = Omit<GraphEvaluator, 'series'> & { series(): Series }

interface Slot {
  record: MessageRecord
  time: number
}

/** Latest record per message type, and per (type, instance). */
class LatestStore {
  readonly bare = new Map<string, Slot>()
  readonly instances = new Map<string, Map<number, Slot>>()

  put(name: string, record: MessageRecord, time: number, instance: number | undefined): void {
    const slot = this.bare.get(name)
    if (slot) {
      slot.record = record
      slot.time = time
    } else {
      this.bare.set(name, { record, time })
    }
    if (instance === undefined) return
    let byInstance = this.instances.get(name)
    if (!byInstance) {
      byInstance = new Map()
      this.instances.set(name, byInstance)
    }
    const instanceSlot = byInstance.get(instance)
    if (instanceSlot) {
      instanceSlot.record = record
      instanceSlot.time = time
    } else {
      byInstance.set(instance, { record, time })
    }
  }

  get(name: string, instance?: number): Slot | undefined {
    return instance === undefined ? this.bare.get(name) : this.instances.get(name)?.get(instance)
  }

  clear(): void {
    this.bare.clear()
    this.instances.clear()
  }
}

interface Plan {
  readonly label: string
  readonly axis: 1 | 2
  readonly unsupported?: string
  readonly value: CompiledExpression
  readonly condition?: CompiledExpression
  readonly types: readonly string[]
  /** Types referenced only as MSG[k]: other instances do not trigger the term. */
  readonly instanceFilter: Map<string, Set<number>>
  readonly required: readonly { message: string; instance?: number }[]
  readonly env: EvalEnv
  ready: boolean
  t: number[]
  v: number[]
}

function makePlan(term: Term, store: LatestStore, options: EvaluatorOptions): Plan {
  const unsupportedFn = termFunctions(term).find((name) => !SUPPORTED_FUNCTIONS.has(name))
  const refs = termReferences(term)
  const types: string[] = []
  const bareTypes = new Set<string>()
  const instanceFilter = new Map<string, Set<number>>()
  const required = new Map<string, { message: string; instance?: number }>()
  for (const ref of refs) {
    if (!types.includes(ref.message)) types.push(ref.message)
    if (ref.instance === undefined) {
      bareTypes.add(ref.message)
    } else {
      let set = instanceFilter.get(ref.message)
      if (!set) instanceFilter.set(ref.message, (set = new Set()))
      set.add(ref.instance)
    }
    required.set(`${ref.message}[${ref.instance ?? ''}]`, { message: ref.message, instance: ref.instance })
  }
  for (const name of bareTypes) instanceFilter.delete(name)
  const env: EvalEnv = {
    message: (name, instance) => store.get(name, instance)?.record,
    timestamp: (name, instance) => store.get(name, instance)?.time,
    param: options.param,
    state: new Map()
  }
  return {
    label: term.label,
    axis: term.axis,
    unsupported: unsupportedFn === undefined ? undefined : `unsupported function ${unsupportedFn}()`,
    value: compileExpression(term.ast),
    condition: term.condition ? compileExpression(term.condition) : undefined,
    types,
    instanceFilter,
    required: [...required.values()],
    env,
    ready: false,
    t: [],
    v: []
  }
}

function runPlan(plan: Plan, store: LatestStore, name: string, time: number, instance: number | undefined): void {
  const filter = plan.instanceFilter.get(name)
  if (filter !== undefined && (instance === undefined || !filter.has(instance))) return
  if (!plan.ready) {
    for (const req of plan.required) if (!store.get(req.message, req.instance)) return
    plan.ready = true
  }
  plan.env.time = time
  if (plan.condition !== undefined && !isTruthy(plan.condition(plan.env))) return
  const value = plan.value(plan.env)
  if (typeof value !== 'number' || !Number.isFinite(value)) return
  plan.t.push(time)
  plan.v.push(value)
}

function planSeries(plan: Plan): Series {
  return plan.unsupported
    ? { label: plan.label, axis: plan.axis, t: plan.t, v: plan.v, unsupported: plan.unsupported }
    : { label: plan.label, axis: plan.axis, t: plan.t, v: plan.v }
}

/** An incremental evaluator for all of a graph's terms, sharing one message store. */
export function createGraphEvaluator(terms: readonly Term[], options: EvaluatorOptions = {}): GraphEvaluator {
  const store = new LatestStore()
  const plans = terms.map((term) => makePlan(term, store, options))
  const byType = new Map<string, Plan[]>()
  for (const plan of plans) {
    if (plan.unsupported) continue
    for (const type of plan.types) {
      const list = byType.get(type)
      if (list) list.push(plan)
      else byType.set(type, [plan])
    }
  }
  return {
    push(messageName, record, timeSeconds, instance) {
      const list = byType.get(messageName)
      if (list === undefined) return
      store.put(messageName, record, timeSeconds, instance)
      for (let i = 0; i < list.length; i += 1) runPlan(list[i], store, messageName, timeSeconds, instance)
    },
    series: () => plans.map(planSeries),
    messageTypes: () => [...byType.keys()],
    trimBefore(timeSeconds) {
      for (const plan of plans) {
        let drop = 0
        while (drop < plan.t.length && plan.t[drop] < timeSeconds) drop += 1
        if (drop > 0) {
          plan.t.splice(0, drop)
          plan.v.splice(0, drop)
        }
      }
    },
    reset() {
      store.clear()
      for (const plan of plans) {
        plan.ready = false
        plan.t = []
        plan.v = []
        plan.env.state = new Map()
      }
    }
  }
}

/** An incremental evaluator for a single term. */
export function createTermEvaluator(term: Term, options: EvaluatorOptions = {}): TermEvaluator {
  const graph = createGraphEvaluator([term], options)
  return { ...graph, series: () => graph.series()[0] }
}

// --- DataFlash ---------------------------------------------------------------

/** The parts of log-analysis's ParsedDataflashLog this package reads. */
export interface DataflashFormatLike {
  readonly type: number
  readonly name: string
  readonly columns: readonly string[]
}

export interface DataflashLogLike {
  readonly messagesByType: ReadonlyMap<string, readonly MessageRecord[]>
  readonly formats: ReadonlyMap<string, DataflashFormatLike>
}

const INSTANCE_FALLBACK_COLUMNS = ['I', 'Instance', 'C', 'IMU', 'Inst']

const instanceColumnCache = new WeakMap<DataflashLogLike, Map<string, string | null>>()

/** Instance column of a message type, from FMTU (unit '#') or common column names. */
export function dataflashInstanceColumn(log: DataflashLogLike, message: string): string | undefined {
  let cache = instanceColumnCache.get(log)
  if (!cache) {
    cache = new Map()
    const nameByType = new Map<number, DataflashFormatLike>()
    for (const format of log.formats.values()) nameByType.set(format.type, format)
    for (const fmtu of log.messagesByType.get('FMTU') ?? []) {
      const format = nameByType.get(fmtu.FmtType as number)
      const units = fmtu.UnitIds
      if (!format || typeof units !== 'string') continue
      const index = units.indexOf('#')
      cache.set(format.name, index >= 0 && index < format.columns.length ? format.columns[index] : null)
    }
    instanceColumnCache.set(log, cache)
  }
  const known = cache.get(message)
  if (known !== undefined) return known ?? undefined
  // No FMTU for this type (older logs): fall back to the usual column names.
  const columns = log.formats.get(message)?.columns ?? []
  const fallback = INSTANCE_FALLBACK_COLUMNS.find((name) => columns.includes(name))
  cache.set(message, fallback ?? null)
  return fallback
}

function instanceOf(record: MessageRecord, column: string | undefined): number | undefined {
  if (column === undefined) return undefined
  const value = record[column]
  if (typeof value === 'number') return value
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value)
    return Number.isFinite(n) ? n : undefined
  }
  return undefined
}

function recordTime(record: MessageRecord): number | undefined {
  const us = record.TimeUS
  if (typeof us === 'number') return us * 1e-6
  const ms = record.TimeMS
  if (typeof ms === 'number') return ms * 1e-3
  return undefined
}

/** Parameter lookup from the log's PARM messages (the last value logged wins). */
export function dataflashParams(log: DataflashLogLike): (name: string) => number | undefined {
  let params: Map<string, number> | undefined
  return (name) => {
    if (!params) {
      params = new Map()
      for (const parm of log.messagesByType.get('PARM') ?? []) {
        if (typeof parm.Name === 'string' && typeof parm.Value === 'number') params.set(parm.Name, parm.Value)
      }
    }
    return params.get(name)
  }
}

/** Evaluate terms over a parsed DataFlash log. Only the referenced message types are walked. */
export function evaluateOnDataflash(log: DataflashLogLike, terms: readonly Term[], options: EvaluatorOptions = {}): Series[] {
  const evaluator = createGraphEvaluator(terms, { param: options.param ?? dataflashParams(log) })
  const types = evaluator.messageTypes()
  const lists = types.map((type) => log.messagesByType.get(type) ?? [])
  const columns = types.map((type) => dataflashInstanceColumn(log, type))
  const k = types.length
  const cursor = new Array<number>(k).fill(0)
  const head = new Float64Array(k)

  // Advance list i to its next timestamped record; Infinity when exhausted.
  const advance = (i: number) => {
    const list = lists[i]
    let c = cursor[i]
    while (c < list.length) {
      const t = recordTime(list[c])
      if (t !== undefined) {
        cursor[i] = c
        head[i] = t
        return
      }
      c += 1
    }
    cursor[i] = c
    head[i] = Infinity
  }
  for (let i = 0; i < k; i += 1) advance(i)

  // k-way merge by time; ties go to the earlier-referenced type (stable).
  for (;;) {
    let best = -1
    let bestTime = Infinity
    for (let i = 0; i < k; i += 1) {
      if (head[i] < bestTime) {
        bestTime = head[i]
        best = i
      }
    }
    if (best < 0) break
    const record = lists[best][cursor[best]]
    evaluator.push(types[best], record, bestTime, instanceOf(record, columns[best]))
    cursor[best] += 1
    advance(best)
  }
  return evaluator.series()
}

export interface DataflashMessageInfo {
  readonly name: string
  readonly fields: readonly string[]
  readonly count: number
}

export interface DataflashFieldIndex extends DataAvailability {
  hasInstance(message: string, instance: number): boolean
  /** Every message type with at least one record, sorted by name. */
  messages(): DataflashMessageInfo[]
  /** Distinct instance numbers logged for a type, ascending ([] when it has none). */
  instancesOf(message: string): number[]
}

/** Field index of a log, for resolveGraph and a field-tree UI. */
export function dataflashFieldIndex(log: DataflashLogLike): DataflashFieldIndex {
  const instanceCache = new Map<string, number[]>()
  const count = (message: string) => log.messagesByType.get(message)?.length ?? 0
  const instancesOf = (message: string): number[] => {
    let cached = instanceCache.get(message)
    if (!cached) {
      const column = dataflashInstanceColumn(log, message)
      const seen = new Set<number>()
      if (column !== undefined) {
        for (const record of log.messagesByType.get(message) ?? []) {
          const instance = instanceOf(record, column)
          if (instance !== undefined) seen.add(instance)
        }
      }
      cached = [...seen].sort((a, b) => a - b)
      instanceCache.set(message, cached)
    }
    return cached
  }
  return {
    hasMessage: (message) => count(message) > 0,
    hasField: (message, field) => count(message) > 0 && (log.formats.get(message)?.columns.includes(field) ?? false),
    hasInstance: (message, instance) => instancesOf(message).includes(instance),
    instancesOf,
    messages: () =>
      [...log.messagesByType.entries()]
        .filter(([, records]) => records.length > 0)
        .map(([name, records]) => ({ name, fields: log.formats.get(name)?.columns ?? [], count: records.length }))
        .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  }
}

/** One field as a series — the plain "drag a field onto a plot" path. */
export function seriesFromField(log: DataflashLogLike, message: string, field: string, instance?: number): Series {
  const label = instance === undefined ? `${message}.${field}` : `${message}[${instance}].${field}`
  const t: number[] = []
  const v: number[] = []
  const column = instance === undefined ? undefined : dataflashInstanceColumn(log, message)
  if (instance !== undefined && column === undefined) return { label, axis: 1, t, v }
  for (const record of log.messagesByType.get(message) ?? []) {
    if (column !== undefined && instanceOf(record, column) !== instance) continue
    const time = recordTime(record)
    const value = record[field]
    if (time === undefined || typeof value !== 'number' || !Number.isFinite(value)) continue
    t.push(time)
    v.push(value)
  }
  return { label, axis: 1, t, v }
}
