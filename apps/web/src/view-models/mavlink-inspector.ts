// Pure view-model helpers for the read-only MAVLink inspector. The hook
// (use-mavlink-inspector) owns accumulation; these functions shape its stats
// for display — summary, filter, sort, field rendering, copy-to-clipboard JSON,
// and the per-row rate sparkline geometry. Unit-tested off the runtime.

import type { MavlinkMessageStat } from '../hooks/use-mavlink-inspector'

export type MavlinkSortKey = 'name' | 'rate' | 'recent' | 'bandwidth'

export interface MavlinkInspectorSummary {
  /** Distinct (source, type) rows seen this session. */
  typeCount: number
  /** Distinct message sources (systemId:componentId) seen this session. */
  sourceCount: number
  /** Combined messages/sec across every row, over the trailing window. */
  totalRateHz: number
  /** Combined on-the-wire bytes/sec across every row, over the window. */
  totalBytesPerSec: number
  /** Combined lifetime message count across every row. */
  totalCount: number
}

export function summarizeMavlinkStats(stats: readonly MavlinkMessageStat[]): MavlinkInspectorSummary {
  let totalRateHz = 0
  let totalBytesPerSec = 0
  let totalCount = 0
  const sources = new Set<string>()
  for (const stat of stats) {
    totalRateHz += stat.rateHz
    totalBytesPerSec += stat.bytesPerSec
    totalCount += stat.count
    sources.add(`${stat.systemId}:${stat.componentId}`)
  }
  return {
    typeCount: stats.length,
    sourceCount: sources.size,
    totalRateHz,
    totalBytesPerSec,
    totalCount
  }
}

/** Filter by message type (case-insensitive substring on the type name). */
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

/** Narrow to a single source `${systemId}:${componentId}`; `''` keeps all. */
export function filterMavlinkStatsBySource(
  stats: readonly MavlinkMessageStat[],
  sourceId: string
): MavlinkMessageStat[] {
  if (!sourceId) {
    return [...stats]
  }
  return stats.filter((stat) => `${stat.systemId}:${stat.componentId}` === sourceId)
}

/**
 * Friendly role name for a MAVLink component id, drawn from the common.xml
 * MAV_COMPONENT enum (ranges collapsed to a role). Best-effort and cosmetic —
 * unrecognised ids fall back to `comp N`.
 */
export function mavlinkComponentLabel(componentId: number): string {
  if (componentId === 0) return 'broadcast'
  if (componentId === 1) return 'autopilot'
  if (componentId === 68) return 'telem radio'
  if (componentId >= 25 && componentId <= 99) return 'user'
  if (componentId >= 100 && componentId <= 119) return 'camera'
  if (componentId >= 140 && componentId <= 153) return 'servo'
  if (componentId === 154 || (componentId >= 171 && componentId <= 175)) return 'gimbal'
  if (componentId === 156) return 'ADS-B'
  if (componentId === 158) return 'peripheral'
  if (componentId === 159) return 'FLARM'
  if (componentId === 160) return 'OSD'
  if (componentId === 190) return 'GCS'
  if (componentId >= 191 && componentId <= 194) return 'companion'
  if (componentId === 195) return 'path planner'
  if (componentId === 196) return 'avoidance'
  if (componentId === 197) return 'odometry'
  if (componentId >= 200 && componentId <= 202) return 'IMU'
  if (componentId >= 220 && componentId <= 221) return 'GPS'
  if (componentId >= 240 && componentId <= 242) return 'bridge'
  if (componentId >= 250 && componentId <= 253) return 'system control'
  return `comp ${componentId}`
}

/** Source identity + display label, e.g. "1:1 · autopilot". */
export interface MavlinkSource {
  /** `${systemId}:${componentId}` — stable selector value. */
  id: string
  systemId: number
  componentId: number
  /** "1:1 · autopilot" style label. */
  label: string
}

export function describeMavlinkSource(systemId: number, componentId: number): MavlinkSource {
  return {
    id: `${systemId}:${componentId}`,
    systemId,
    componentId,
    label: `${systemId}:${componentId} · ${mavlinkComponentLabel(componentId)}`
  }
}

/** Distinct sources present in the stats, sorted by systemId then componentId. */
export function listMavlinkSources(stats: readonly MavlinkMessageStat[]): MavlinkSource[] {
  const seen = new Map<string, MavlinkSource>()
  for (const stat of stats) {
    const source = describeMavlinkSource(stat.systemId, stat.componentId)
    if (!seen.has(source.id)) {
      seen.set(source.id, source)
    }
  }
  return [...seen.values()].sort(
    (left, right) => left.systemId - right.systemId || left.componentId - right.componentId
  )
}

export interface MavlinkSourceGroup extends MavlinkSource {
  stats: MavlinkMessageStat[]
  /** Combined msg/s across the group's rows. */
  rateHz: number
  /** Combined bytes/s across the group's rows. */
  bytesPerSec: number
}

/**
 * Bucket stats under their source, preserving the order of the (already
 * sorted/filtered) input within each group. Groups are ordered by systemId
 * then componentId so the autopilot leads and peripherals follow.
 */
export function groupMavlinkStatsBySource(stats: readonly MavlinkMessageStat[]): MavlinkSourceGroup[] {
  const groups = new Map<string, MavlinkSourceGroup>()
  for (const stat of stats) {
    const source = describeMavlinkSource(stat.systemId, stat.componentId)
    let group = groups.get(source.id)
    if (!group) {
      group = { ...source, stats: [], rateHz: 0, bytesPerSec: 0 }
      groups.set(source.id, group)
    }
    group.stats.push(stat)
    group.rateHz += stat.rateHz
    group.bytesPerSec += stat.bytesPerSec
  }
  return [...groups.values()].sort(
    (left, right) => left.systemId - right.systemId || left.componentId - right.componentId
  )
}

/** Human bandwidth label: "812 B/s", "1.4 kB/s", "2.1 MB/s". */
export function formatBytesPerSec(bytesPerSec: number): string {
  if (!Number.isFinite(bytesPerSec) || bytesPerSec <= 0) {
    return '0 B/s'
  }
  if (bytesPerSec < 1024) {
    return `${Math.round(bytesPerSec)} B/s`
  }
  if (bytesPerSec < 1024 * 1024) {
    return `${(bytesPerSec / 1024).toFixed(1)} kB/s`
  }
  return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`
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
    case 'bandwidth':
      sorted.sort((left, right) => right.bytesPerSec - left.bytesPerSec || left.type.localeCompare(right.type))
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
  /** Display string (rounded floats, flattened arrays, JSON objects). */
  value: string
  /** Coarse value kind for the table's type column. */
  type: MavlinkFieldType
}

export type MavlinkFieldType =
  | 'int'
  | 'float'
  | 'uint64'
  | 'bool'
  | 'string'
  | 'array'
  | 'object'
  | 'empty'

/** Coarse value kind for the field table's type column. */
export function formatMavlinkFieldType(value: unknown): MavlinkFieldType {
  if (value === null || value === undefined) return 'empty'
  if (typeof value === 'bigint') return 'uint64'
  if (typeof value === 'number') return Number.isInteger(value) ? 'int' : 'float'
  if (typeof value === 'boolean') return 'bool'
  if (Array.isArray(value)) return 'array'
  if (typeof value === 'object') return 'object'
  return 'string'
}

/** True when a field carries a single finite number worth plotting. */
export function isPlottableFieldValue(value: unknown): boolean {
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value === 'bigint') return true
  if (typeof value === 'boolean') return true
  return false
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
  return Object.entries(rest).map(([key, value]) => ({
    key,
    value: formatMavlinkFieldValue(value),
    type: formatMavlinkFieldType(value)
  }))
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
