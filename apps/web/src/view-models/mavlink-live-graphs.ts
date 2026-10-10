// MAVExplorer's predefined graphs over the live link, for the MAVLink
// Inspector: which messages and fields have arrived (so each graph says
// whether it can draw, and why not), and the graph list the picker shows.
// Pure; the hook feeds it decoded messages put back under MAVLink names
// (plot-live-mavlink).

import { resolveGraph, type DataAvailability, type GraphDefinition, type Term } from '@arduconfig/plot-core'

/** Fields seen per message type on the link so far. */
export class LiveFieldIndex {
  private readonly fields = new Map<string, Set<string>>()
  private size = 0

  /** Note a message; true when it brought a message type or field not seen before. */
  record(name: string, record: Readonly<Record<string, number>>): boolean {
    let known = this.fields.get(name)
    if (!known) {
      known = new Set()
      this.fields.set(name, known)
    }
    const before = known.size
    for (const field of Object.keys(record)) known.add(field)
    const grew = known.size !== before || before === 0
    if (grew) this.size += 1
    return grew
  }

  /** Changes whenever the set of fields does: a cheap memo key. */
  get version(): number {
    return this.size
  }

  availability(): DataAvailability {
    return {
      hasMessage: (message) => this.fields.has(message),
      hasField: (message, field) => this.fields.get(message)?.has(field) ?? false
    }
  }

  clear(): void {
    this.fields.clear()
    this.size += 1
  }
}

export interface LiveGraphEntry {
  name: string
  /** "Attitude/Roll and Pitch": the category, then the graph's own name. */
  category: string
  title: string
  description: string
  /** Why it cannot draw from what the link carries, or undefined when it can. */
  unavailable?: string
  /** The expression's terms when it can draw. */
  terms?: readonly Term[]
}

/** Each graph against the live link, the ones that can draw first, then by name. */
export function liveGraphEntries(graphs: readonly GraphDefinition[], available: DataAvailability): LiveGraphEntry[] {
  return graphs
    .map((graph) => {
      const resolved = resolveGraph(graph, available)
      const category = graph.path.length > 1 ? graph.path[0] : 'Other'
      const title = graph.path.length > 1 ? graph.path.slice(1).join(' / ') : graph.name
      return 'unavailable' in resolved
        ? { name: graph.name, category, title, description: graph.description, unavailable: resolved.unavailable }
        : { name: graph.name, category, title, description: graph.description, terms: resolved.terms }
    })
    .sort((a, b) => Number(a.unavailable !== undefined) - Number(b.unavailable !== undefined) || a.name.localeCompare(b.name))
}

/** Graphs whose name, category or description holds every word of the query. */
export function filterLiveGraphs(entries: readonly LiveGraphEntry[], query: string, includeUnavailable: boolean): LiveGraphEntry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  return entries.filter(
    (entry) => (includeUnavailable || !entry.unavailable) && words.every((word) => `${entry.name} ${entry.description}`.toLowerCase().includes(word))
  )
}

/** The key a graph term's series goes by in the plot panes. */
export function graphSeriesKey(graphName: string, termIndex: number): string {
  return `graph|${graphName}|${termIndex}`
}
