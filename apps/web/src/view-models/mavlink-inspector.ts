// Pure view-model helpers for the read-only MAVLink inspector. The hook
// (use-mavlink-inspector) owns accumulation; these functions shape its stats
// for display — summary, filter, sort, field rendering, copy-to-clipboard JSON,
// and the per-row rate sparkline geometry. Unit-tested off the runtime.

import type { MavlinkMessageStat } from '../hooks/use-mavlink-inspector'

export type MavlinkSortKey = 'name' | 'rate' | 'recent'

export interface MavlinkInspectorSummary {
  /** Distinct message types seen this session. */
  typeCount: number
  /** Combined messages/sec across every type, over the trailing window. */
  totalRateHz: number
  /** Combined lifetime message count across every type. */
  totalCount: number
}

export function summarizeMavlinkStats(stats: readonly MavlinkMessageStat[]): MavlinkInspectorSummary {
  let totalRateHz = 0
  let totalCount = 0
  for (const stat of stats) {
    totalRateHz += stat.rateHz
    totalCount += stat.count
  }
  return { typeCount: stats.length, totalRateHz, totalCount }
}

export function filterMavlinkStats(
  stats: readonly MavlinkMessageStat[],
  filter: string
): MavlinkMessageStat[] {
  const needle = filter.trim().toLowerCase()
  if (!needle) {
    return [...stats]
  }
  return stats.filter((stat) => stat.type.toLowerCase().includes(needle))
}

export function sortMavlinkStats(
  stats: readonly MavlinkMessageStat[],
  key: MavlinkSortKey
): MavlinkMessageStat[] {
  const sorted = [...stats]
  switch (key) {
    case 'rate':
      sorted.sort((left, right) => right.rateHz - left.rateHz || left.type.localeCompare(right.type))
      break
    case 'recent':
      sorted.sort((left, right) => right.lastSeenMs - left.lastSeenMs || left.type.localeCompare(right.type))
      break
    case 'name':
    default:
      sorted.sort((left, right) => left.type.localeCompare(right.type))
      break
  }
  return sorted
}

export interface MavlinkFieldRow {
  key: string
  value: string
}

/** Render a single decoded field value: round floats, stringify bigints,
 *  flatten small arrays, and JSON the rest. Falls back to raw for anything
 *  exotic so nothing is ever hidden. */
export function formatMavlinkFieldValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '—'
  }
  if (typeof value === 'bigint') {
    return value.toString()
  }
  if (typeof value === 'number') {
    if (Number.isInteger(value)) {
      return String(value)
    }
    return value.toFixed(4).replace(/\.?0+$/, '')
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false'
  }
  if (Array.isArray(value)) {
    return `[${value.map(formatMavlinkFieldValue).join(', ')}]`
  }
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value, (_key, inner) => (typeof inner === 'bigint' ? inner.toString() : inner))
    } catch {
      return String(value)
    }
  }
  return String(value)
}

/** Build label/value rows for a decoded message, dropping the synthetic
 *  `type` discriminator (it's already the row header). */
export function buildMavlinkFieldRows(message: Record<string, unknown>): MavlinkFieldRow[] {
  const { type: _type, ...rest } = message
  return Object.entries(rest).map(([key, value]) => ({ key, value: formatMavlinkFieldValue(value) }))
}

/** Pretty-printed JSON of the last decoded fields for copy-to-clipboard. */
export function messageToJson(message: Record<string, unknown>): string {
  const { type: _type, ...rest } = message
  try {
    return JSON.stringify(rest, (_key, value) => (typeof value === 'bigint' ? value.toString() : value), 2)
  } catch {
    return String(rest)
  }
}

/**
 * SVG polyline `points` for a per-type rate sparkline, normalized to the
 * peak in the window so a flat stream sits at the bottom and a burst peaks
 * at the top. Returns '' for fewer than two samples (nothing to draw).
 */
export function buildSparklinePoints(
  history: readonly number[],
  width = 64,
  height = 16
): string {
  if (history.length < 2) {
    return ''
  }
  const peak = Math.max(...history, 0.0001)
  const step = width / (history.length - 1)
  return history
    .map((value, index) => {
      const x = index * step
      const y = height - (value / peak) * height
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
}
