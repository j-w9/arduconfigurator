// The predefined-graph library: a category tree, search, and choosing which of
// a graph's alternative expressions fits the data at hand (MAVExplorer's
// expression_ok, done statically against what the log / link provides).

import { parseExpression, termFunctions, termReferences, type Reference, type Term } from './expression.js'
import { SUPPORTED_FUNCTIONS } from './functions.js'

export interface GraphDefinition {
  /** Full name, '/'-separated category path ("Attitude/Roll and Pitch"). */
  readonly name: string
  /** `name` split on '/'. */
  readonly path: readonly string[]
  readonly description: string
  /** Alternative expressions, best first; the first that fits the data is plotted. */
  readonly expressions: readonly string[]
}

export interface GraphTreeNode {
  /** This category's own name ('' for the root). */
  readonly name: string
  /** Category path from the root. */
  readonly path: readonly string[]
  readonly children: GraphTreeNode[]
  /** Graphs directly in this category. */
  readonly graphs: GraphDefinition[]
}

/** Group graphs by their category path; categories and graphs sorted by name. */
export function graphTree(graphs: readonly GraphDefinition[]): GraphTreeNode {
  const root: GraphTreeNode = { name: '', path: [], children: [], graphs: [] }
  for (const graph of graphs) {
    let node = root
    for (const part of graph.path.slice(0, -1)) {
      let child = node.children.find((c) => c.name === part)
      if (!child) {
        child = { name: part, path: [...node.path, part], children: [], graphs: [] }
        node.children.push(child)
      }
      node = child
    }
    node.graphs.push(graph)
  }
  const sort = (node: GraphTreeNode) => {
    node.children.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    node.graphs.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    node.children.forEach(sort)
  }
  sort(root)
  return root
}

/** Graphs whose name or description contains every word of `query` (case-insensitive). */
export function searchGraphs(graphs: readonly GraphDefinition[], query: string): GraphDefinition[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return [...graphs]
  return graphs.filter((graph) => {
    const haystack = `${graph.name} ${graph.description}`.toLowerCase()
    return words.every((word) => haystack.includes(word))
  })
}

/** What data is available to plot (a log's field index, or the live link's). */
export interface DataAvailability {
  hasMessage(message: string): boolean
  /** Exact match: DataFlash names as logged, MAVLink fields lowercase. */
  hasField(message: string, field: string): boolean
  /** Whether `MSG[instance]` exists. Omitted = any instance is assumed to exist. */
  hasInstance?(message: string, instance: number): boolean
}

export type ResolvedGraph =
  | { readonly expression: string; readonly terms: readonly Term[] }
  | { readonly unavailable: string }

function describeRef(ref: Reference): string {
  const base = ref.instance === undefined ? ref.message : `${ref.message}[${ref.instance}]`
  return ref.field === undefined ? base : `${base}.${ref.field}`
}

/** Why a term cannot be plotted against `available`, or undefined if it can. */
export function termUnavailableReason(term: Term, available: DataAvailability): string | undefined {
  for (const name of termFunctions(term)) {
    if (!SUPPORTED_FUNCTIONS.has(name)) return `unsupported function ${name}()`
  }
  for (const ref of termReferences(term)) {
    if (!available.hasMessage(ref.message)) return `no ${ref.message} messages`
    if (ref.instance !== undefined && available.hasInstance && !available.hasInstance(ref.message, ref.instance)) {
      return `no ${describeRef({ message: ref.message, instance: ref.instance })}`
    }
    // `_timestamp` is the message time, present on every message.
    if (ref.field !== undefined && ref.field !== '_timestamp' && !available.hasField(ref.message, ref.field)) {
      return `no field ${describeRef(ref)}`
    }
  }
  return undefined
}

/**
 * The first of a graph's expressions whose every term parses, uses only
 * supported functions and references only available data.
 */
export function resolveGraph(graph: GraphDefinition, available: DataAvailability): ResolvedGraph {
  const reasons: string[] = []
  for (const expression of graph.expressions) {
    const { terms, errors } = parseExpression(expression)
    if (errors.length > 0) {
      reasons.push(`cannot parse ${errors[0].text}: ${errors[0].message}`)
      continue
    }
    if (terms.length === 0) continue
    let reason: string | undefined
    for (const term of terms) {
      reason = termUnavailableReason(term, available)
      if (reason) break
    }
    if (!reason) return { expression, terms }
    reasons.push(reason)
  }
  return { unavailable: reasons.length > 0 ? [...new Set(reasons)].join('; ') : 'no expressions' }
}
