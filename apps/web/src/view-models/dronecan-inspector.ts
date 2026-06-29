// Pure view-model helpers for the read-only DroneCAN inspector. Shape a single
// inspected node into a flat detail panel (full NodeStatus + version identity)
// and summarize bus health across nodes. Unit-tested off the runtime.

import type { DronecanInspectedNode } from '@arduconfig/ardupilot-core'

import { healthLabel, modeLabel } from './can-bus'

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
