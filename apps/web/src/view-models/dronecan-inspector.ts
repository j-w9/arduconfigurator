// Pure view-model helpers for the DroneCAN inspector. Shape a single inspected
// node into a flat detail panel (full NodeStatus + version identity), summarize
// bus health, build the per-node parameter grid rows, and shape ESC telemetry.
// Unit-tested off the runtime. The value formatters are shared with the CAN tab
// (pure helpers in ./can-bus — imported, never the CAN-tab components).

import type {
  DronecanEscTelemetry,
  DronecanInspectedNode,
  DronecanParamEntry
} from '@arduconfig/ardupilot-core'

import { compareParamEntries, formatParamValue, healthLabel, modeLabel } from './can-bus'

export interface DronecanDetailRow {
  label: string
  value: string
}

function uptimeLabel(uptimeSec: number | undefined): string {
  if (uptimeSec === undefined) {
    return '—'
  }
  if (uptimeSec < 60) {
    return `${uptimeSec}s`
  }
  const minutes = Math.floor(uptimeSec / 60)
  if (minutes < 60) {
    return `${minutes}m ${uptimeSec % 60}s`
  }
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m`
}

function ageLabel(atMs: number, nowMs: number): string {
  const age = Math.max(0, nowMs - atMs)
  if (age < 1500) {
    return 'now'
  }
  return `${(age / 1000).toFixed(age < 10000 ? 1 : 0)}s ago`
}

/**
 * Flatten a node into label/value rows for the expanded detail panel. Only
 * surfaces fields the node actually reported — version/identity rows are
 * omitted until a GetNodeInfo response fills them in.
 */
export function buildDronecanNodeDetailRows(
  node: DronecanInspectedNode,
  nowMs: number = Date.now()
): DronecanDetailRow[] {
  const rows: DronecanDetailRow[] = [
    { label: 'Node ID', value: `#${node.nodeId}` },
    { label: 'Name', value: node.name && node.name.length > 0 ? node.name : '—' },
    { label: 'Health', value: healthLabel(node.health) },
    { label: 'Mode', value: modeLabel(node.mode) },
    { label: 'Uptime', value: uptimeLabel(node.uptimeSec) }
  ]
  if (node.subMode !== undefined) {
    rows.push({ label: 'Sub-mode', value: String(node.subMode) })
  }
  if (node.vendorStatusCode !== undefined) {
    rows.push({ label: 'Vendor status', value: String(node.vendorStatusCode) })
  }
  if (node.hwVersion) {
    rows.push({ label: 'HW version', value: `${node.hwVersion.major}.${node.hwVersion.minor}` })
  }
  if (node.swVersion) {
    rows.push({ label: 'SW version', value: `${node.swVersion.major}.${node.swVersion.minor}` })
    if (node.swVersion.vcsCommit) {
      rows.push({ label: 'Git hash', value: (node.swVersion.vcsCommit >>> 0).toString(16).padStart(8, '0') })
    }
  }
  if (node.hwUniqueId) {
    rows.push({ label: 'Unique ID', value: node.hwUniqueId })
  }
  rows.push({ label: 'Parameters', value: String(node.parameters.length) })
  rows.push({ label: 'First seen', value: ageLabel(node.firstSeenAtMs, nowMs) })
  rows.push({ label: 'Last seen', value: ageLabel(node.lastSeenAtMs, nowMs) })
  if (node.paramFetch.error) {
    rows.push({ label: 'Param fetch', value: `error — ${node.paramFetch.error}` })
  }
  return rows
}

export interface DronecanBusSummary {
  nodeCount: number
  /** Nodes reporting health === 'ok'. */
  healthyCount: number
  /** Nodes reporting warning / error / critical. */
  unhealthyCount: number
}

export function summarizeDronecanNodes(
  nodes: readonly DronecanInspectedNode[]
): DronecanBusSummary {
  let healthyCount = 0
  let unhealthyCount = 0
  for (const node of nodes) {
    if (node.health === 'ok') {
      healthyCount += 1
    } else if (node.health === 'warning' || node.health === 'error' || node.health === 'critical') {
      unhealthyCount += 1
    }
  }
  return { nodeCount: nodes.length, healthyCount, unhealthyCount }
}

// --- Per-node parameter grid --------------------------------------------------

export type DronecanParamType = 'int64' | 'real32' | 'bool' | 'string' | 'empty'

export interface DronecanParamRow {
  index: number
  name: string
  /** Formatted current value the node last reported. */
  valueLabel: string
  /** The value variant — drives the editor's input kind + parse rules. */
  type: DronecanParamType
  /** True when the value can be edited (everything except an empty/unknown). */
  editable: boolean
  /** Formatted range hint ("0..127", ">= 0", "<= 64000"), when reported. */
  rangeLabel?: string
  /** Formatted default value, when the node reported one. */
  defaultLabel?: string
}

/** Build the editable parameter grid rows for one node, sorted by index
 *  (enumeration order). The view owns the draft text + edit handlers; this only
 *  shapes display + edit metadata. */
export function buildDronecanParamRows(node: DronecanInspectedNode): DronecanParamRow[] {
  return [...node.parameters].sort(compareParamEntries).map((entry: DronecanParamEntry): DronecanParamRow => {
    const type = entry.value.tag
    const min = entry.minValue ? formatParamValue(entry.minValue) : undefined
    const max = entry.maxValue ? formatParamValue(entry.maxValue) : undefined
    let rangeLabel: string | undefined
    if (min !== undefined && min !== '—' && max !== undefined && max !== '—') {
      rangeLabel = `${min}..${max}`
    } else if (min !== undefined && min !== '—') {
      rangeLabel = `>= ${min}`
    } else if (max !== undefined && max !== '—') {
      rangeLabel = `<= ${max}`
    }
    const defaultLabel =
      entry.defaultValue && formatParamValue(entry.defaultValue) !== '—'
        ? formatParamValue(entry.defaultValue)
        : undefined
    return {
      index: entry.index,
      name: entry.name,
      valueLabel: formatParamValue(entry.value),
      type,
      editable: type !== 'empty',
      rangeLabel,
      defaultLabel
    }
  })
}

// --- ESC telemetry ------------------------------------------------------------

export interface DronecanEscRow {
  escIndex: number
  nodeId: number
  rpmLabel: string
  voltageLabel: string
  currentLabel: string
  temperatureLabel: string
  powerLabel: string
  errorCountLabel: string
  ageLabel: string
}

function numberLabel(value: number | undefined, unit: string, digits = 1): string {
  if (value === undefined || !Number.isFinite(value)) {
    return '—'
  }
  return `${value.toFixed(digits)} ${unit}`
}

/** Shape latest-per-ESC telemetry into display rows (RPM/V/A/temp/power), sorted
 *  by esc_index. Observe-only — there are no edit affordances here. */
export function buildDronecanEscRows(
  escTelemetry: readonly DronecanEscTelemetry[],
  nowMs: number = Date.now()
): DronecanEscRow[] {
  return [...escTelemetry]
    .sort((left, right) => left.escIndex - right.escIndex)
    .map((esc): DronecanEscRow => ({
      escIndex: esc.escIndex,
      nodeId: esc.nodeId,
      rpmLabel: Number.isFinite(esc.rpm) ? `${Math.round(esc.rpm)}` : '—',
      voltageLabel: numberLabel(esc.voltage, 'V', 2),
      currentLabel: numberLabel(esc.current, 'A', 2),
      temperatureLabel: numberLabel(esc.temperatureC, '°C', 0),
      powerLabel: Number.isFinite(esc.powerRatingPct) ? `${esc.powerRatingPct}%` : '—',
      errorCountLabel: `${esc.errorCount}`,
      ageLabel: ageLabel(esc.lastSeenAtMs, nowMs)
    }))
}
