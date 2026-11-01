// CAN ▸ All devices ▸ Fleet: one change across many DroneCAN nodes -- a
// parameter set on every node that has it, or one firmware image flashed to
// every node of a board, one node at a time. Pure; the fleet hook and view use it.

import type { DronecanInspectedNode, DronecanParamValueState } from '@arduconfig/ardupilot-core'
import { dronecanNodeBoardId } from '@arduconfig/firmware-flash'

import { formatParamValue, parseParamInput } from './can-bus'

/** A parameter name and the nodes that report it. */
export interface FleetParamOption {
  name: string
  nodeIds: number[]
}

/**
 * Params a fleet change never offers: a node's own ID (one value on several
 * nodes is an ID clash that takes them off the bus) and the bootloader-flash
 * trigger (that is a per-node action, with its own checks).
 */
export const FLEET_EXCLUDED_PARAMS: ReadonlySet<string> = new Set(['CAN_NODE', 'CANNODE_NODE_ID', 'FLASH_BOOTLOADER', 'BRD_SERIAL_NUM'])

/** Every param name reported by the given nodes, most-shared first, then by name. */
export function buildFleetParamOptions(nodes: readonly DronecanInspectedNode[]): FleetParamOption[] {
  const byName = new Map<string, number[]>()
  for (const node of nodes) {
    for (const entry of node.parameters) {
      if (FLEET_EXCLUDED_PARAMS.has(entry.name)) continue
      const list = byName.get(entry.name) ?? []
      if (!list.includes(node.nodeId)) list.push(node.nodeId)
      byName.set(entry.name, list)
    }
  }
  return [...byName.entries()]
    .map(([name, nodeIds]) => ({ name, nodeIds: nodeIds.sort((a, b) => a - b) }))
    .sort((left, right) => right.nodeIds.length - left.nodeIds.length || left.name.localeCompare(right.name))
}

export type FleetParamRowState = 'change' | 'same' | 'invalid' | 'missing'

export interface FleetParamRow {
  nodeId: number
  currentLabel: string
  nextLabel: string
  parsed?: DronecanParamValueState
  state: FleetParamRowState
}

/** For each selected node: its current value and what `raw` becomes in its param's type. */
export function buildFleetParamPlan(
  nodes: readonly DronecanInspectedNode[],
  selected: readonly number[],
  name: string,
  raw: string
): FleetParamRow[] {
  return selected
    .map((nodeId) => nodes.find((node) => node.nodeId === nodeId))
    .filter((node): node is DronecanInspectedNode => node !== undefined)
    .map((node): FleetParamRow => {
      const entry = node.parameters.find((param) => param.name === name)
      if (!entry) return { nodeId: node.nodeId, currentLabel: '—', nextLabel: '—', state: 'missing' }
      const currentLabel = formatParamValue(entry.value)
      const parsed = raw.trim() === '' ? undefined : parseParamInput(raw.trim(), entry.value)
      if (!parsed) return { nodeId: node.nodeId, currentLabel, nextLabel: raw.trim() || '—', state: 'invalid' }
      const nextLabel = formatParamValue(parsed)
      return { nodeId: node.nodeId, currentLabel, nextLabel, parsed, state: nextLabel === currentLabel ? 'same' : 'change' }
    })
}

/** The rows a fleet write would send. */
export function fleetParamWrites(plan: readonly FleetParamRow[]): Array<{ nodeId: number; value: DronecanParamValueState }> {
  return plan.filter((row) => row.state === 'change' && row.parsed).map((row) => ({ nodeId: row.nodeId, value: row.parsed as DronecanParamValueState }))
}

/** A node whose firmware can be updated: identified (its board id is known) and not the autopilot. */
export function fleetFirmwareCandidates(nodes: readonly DronecanInspectedNode[], selfNodeIds: readonly number[]): DronecanInspectedNode[] {
  return nodes.filter((node) => !selfNodeIds.includes(node.nodeId) && dronecanNodeBoardId(node.hwVersion) !== undefined)
}

/**
 * Whether one image may go to every selected node: they must all be the same
 * board (one APJ board id), or flashing it is how a fleet gets bricked.
 */
export function fleetFirmwareCheck(
  nodes: readonly DronecanInspectedNode[],
  selected: readonly number[]
): { ok: true; boardId: number } | { ok: false; reason: string } {
  if (selected.length === 0) return { ok: false, reason: 'Pick the nodes to update.' }
  const boards = new Set<number>()
  for (const nodeId of selected) {
    const node = nodes.find((candidate) => candidate.nodeId === nodeId)
    const board = node ? dronecanNodeBoardId(node.hwVersion) : undefined
    if (board === undefined) return { ok: false, reason: `Node ${nodeId} has not said which board it is yet.` }
    boards.add(board)
  }
  if (boards.size > 1) return { ok: false, reason: 'These nodes are different boards. One image can only go to nodes of one board.' }
  return { ok: true, boardId: [...boards][0] }
}

export type FleetFirmwareStepState = 'waiting' | 'updating' | 'done' | 'failed' | 'skipped'

export interface FleetFirmwareStep {
  nodeId: number
  state: FleetFirmwareStepState
  note?: string
}
