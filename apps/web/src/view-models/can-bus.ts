import type {
  CanBusState,
  DronecanInspectedNode,
  DronecanParamEntry,
  DronecanParamValueState
} from '@arduconfig/ardupilot-core'

// View-model helpers for the CAN tab. Pure functions that transform the
// runtime's CanBusState into shapes the React view can render without
// chasing nested unions inside the JSX.

export type CanNodeTone = 'success' | 'warning' | 'danger' | 'neutral'

export interface CanBusNodeRow {
  nodeId: number
  /** Display name — falls back to "Node <id>" until the GetNodeInfo
   *  response arrives and populates `node.name`. */
  label: string
  /** Sub-label with name + UID if both known, else just one of them. */
  detail?: string
  health: DronecanInspectedNode['health']
  mode: DronecanInspectedNode['mode']
  tone: CanNodeTone
  uptimeSec?: number
  paramFetchStatus: DronecanInspectedNode['paramFetch']['status']
  paramCount: number
  hwVersion?: string
  swVersion?: string
  /** Firmware git hash from the software version's VCS commit field, as a
   *  zero-padded hex string (the same identity ArduPilot prints in its boot
   *  banner). Undefined when the node didn't report a non-zero commit. */
  gitHash?: string
  /** Full hardware unique id (hex), for the expanded node detail. */
  hwUniqueId?: string
  /** Vendor-defined status code from NodeStatus, surfaced for diagnostics. */
  vendorStatusCode?: number
}

export function toneForHealth(health: DronecanInspectedNode['health']): CanNodeTone {
  switch (health) {
    case 'ok':
      return 'success'
    case 'warning':
      return 'warning'
    case 'error':
    case 'critical':
      return 'danger'
    default:
      return 'neutral'
  }
}

export function modeLabel(mode: DronecanInspectedNode['mode']): string {
  switch (mode) {
    case 'operational':
      return 'Operational'
    case 'initialization':
      return 'Initializing'
    case 'maintenance':
      return 'Maintenance'
    case 'software_update':
      return 'Updating firmware'
    case 'offline':
      return 'Offline'
    case 'unknown':
    default:
      return 'Unknown'
  }
}

export function healthLabel(health: DronecanInspectedNode['health']): string {
  switch (health) {
    case 'ok':
      return 'OK'
    case 'warning':
      return 'Warning'
    case 'error':
      return 'Error'
    case 'critical':
      return 'Critical'
    case 'unknown':
    default:
      return 'Unknown'
  }
}

export function buildCanBusNodeRows(state: CanBusState): CanBusNodeRow[] {
  return state.nodes.map((node): CanBusNodeRow => {
    const label = node.name && node.name.length > 0 ? node.name : `Node ${node.nodeId}`
    let detail: string | undefined
    if (node.name && node.hwUniqueId) {
      detail = `UID ${node.hwUniqueId.slice(0, 16)}…`
    }
    return {
      nodeId: node.nodeId,
      label,
      detail,
      health: node.health,
      mode: node.mode,
      tone: toneForHealth(node.health),
      uptimeSec: node.uptimeSec,
      paramFetchStatus: node.paramFetch.status,
      paramCount: node.parameters.length,
      hwVersion: node.hwVersion ? `${node.hwVersion.major}.${node.hwVersion.minor}` : undefined,
      swVersion: node.swVersion ? `${node.swVersion.major}.${node.swVersion.minor}` : undefined,
      gitHash:
        node.swVersion && node.swVersion.vcsCommit
          ? (node.swVersion.vcsCommit >>> 0).toString(16).padStart(8, '0')
          : undefined,
      hwUniqueId: node.hwUniqueId,
      vendorStatusCode: node.vendorStatusCode
    }
  })
}

/** Format a parameter value for display in the table. */
export function formatParamValue(value: DronecanParamValueState | undefined): string {
  if (!value) return '—'
  switch (value.tag) {
    case 'empty':
      return '—'
    case 'int64':
      return value.int64 ?? '0'
    case 'real32':
      return typeof value.real32 === 'number' ? value.real32.toString() : '—'
    case 'bool':
      return value.bool ? 'true' : 'false'
    case 'string':
      return value.string ?? ''
  }
}

/** Parse a user-typed input back into a DronecanParamValueState matching
 *  the current value's variant. Returns undefined on invalid input. */
export function parseParamInput(
  raw: string,
  reference: DronecanParamValueState
): DronecanParamValueState | undefined {
  switch (reference.tag) {
    case 'empty':
      return undefined
    case 'int64': {
      const trimmed = raw.trim()
      if (!/^-?\d+$/.test(trimmed)) return undefined
      try {
        // Test parse — bigint() throws on bad input.
        BigInt(trimmed)
        return { tag: 'int64', int64: trimmed }
      } catch {
        return undefined
      }
    }
    case 'real32': {
      const value = Number.parseFloat(raw)
      if (!Number.isFinite(value)) return undefined
      return { tag: 'real32', real32: value }
    }
    case 'bool': {
      const trimmed = raw.trim().toLowerCase()
      if (['1', 'true', 'yes', 'y', 'on'].includes(trimmed)) return { tag: 'bool', bool: true }
      if (['0', 'false', 'no', 'n', 'off'].includes(trimmed)) return { tag: 'bool', bool: false }
      return undefined
    }
    case 'string':
      return { tag: 'string', string: raw }
  }
}

/** Comparator for stable parameter display: by index (which roughly
 *  mirrors enumeration order on the node). */
export function compareParamEntries(left: DronecanParamEntry, right: DronecanParamEntry): number {
  return left.index - right.index
}

export interface CanBusStagedChange {
  name: string
  /** Formatted live value as the node last reported it. */
  currentLabel: string
  /** Formatted staged value the apply-all will write. */
  nextLabel: string
  /** Parsed wire value; undefined when the raw text doesn't parse, in
   *  which case the row is shown as invalid and apply-all skips it. */
  parsed: DronecanParamValueState | undefined
  rawValue: string
}

/**
 * Build the show-changes comparison list for one node from the view's
 * staged raw inputs (keyed `nodeId:paramName`, same convention as the
 * CanBus view's draft map). Rows whose raw text equals the live value's
 * formatted form are NOT changes and are dropped — typing a value back
 * to what the node already reports un-stages it.
 */
export function buildCanBusStagedChanges(
  node: DronecanInspectedNode,
  draftValues: Record<string, string>
): CanBusStagedChange[] {
  const changes: CanBusStagedChange[] = []
  for (const entry of [...node.parameters].sort(compareParamEntries)) {
    const raw = draftValues[`${node.nodeId}:${entry.name}`]
    if (raw === undefined) {
      continue
    }
    const currentLabel = formatParamValue(entry.value)
    if (raw === currentLabel) {
      continue
    }
    const parsed = parseParamInput(raw, entry.value)
    changes.push({
      name: entry.name,
      currentLabel,
      nextLabel: parsed ? formatParamValue(parsed) : raw,
      parsed,
      rawValue: raw
    })
  }
  return changes
}
