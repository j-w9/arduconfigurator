// "Messages on the bus": one live row per DroneCAN message stream -- a type
// from a source node (and, for services, request/response to a destination)
// -- with its count, rate and latest decoded transfer. Fed from the bus
// monitor's transfer decoder; pure, so it is unit-tested off the DOM.

import type { DronecanTransfer, DronecanTransferKind } from '@arduconfig/dronecan-dsdl'

export interface CanTopicEntry {
  key: string
  /** The device index this stream is split on (esc_index 2, say), when its type multiplexes devices. */
  index?: { field: string; value: number }
  bus: number
  kind: DronecanTransferKind
  dataTypeId: number
  sourceNodeId: number
  destinationNodeId?: number
  count: number
  firstSeenMs: number
  lastSeenMs: number
  /** Mean rate over the stream's life, Hz; undefined until two transfers. */
  rateHz?: number
  last: DronecanTransfer
}

/**
 * Index fields that multiplex several devices through one message stream:
 * an ESC node sends esc.Status for each of its ESCs, told apart only by
 * esc_index; likewise actuators, batteries, sensors. A stream is split on
 * them, so each ESC gets its own row and its own plot (one row for all four
 * plotted a sawtooth).
 */
const DEVICE_INDEX_FIELDS = ['esc_index', 'actuator_id', 'battery_id', 'sensor_id', 'circuit_id', 'hardpoint_id'] as const

/** The device index a message carries, if its type multiplexes devices. */
export function canTopicIndex(transfer: Pick<DronecanTransfer, 'kind' | 'value'>): { field: string; value: number } | undefined {
  if (transfer.kind !== 'message' || !transfer.value) return undefined
  for (const field of DEVICE_INDEX_FIELDS) {
    const value = transfer.value[field]
    if (typeof value === 'number') return { field, value }
  }
  return undefined
}

export function canTopicKey(
  transfer: Pick<DronecanTransfer, 'bus' | 'kind' | 'dataTypeId' | 'sourceNodeId' | 'destinationNodeId' | 'value'>
): string {
  const index = canTopicIndex(transfer)
  return `${transfer.bus}:${transfer.kind}:${transfer.dataTypeId}:${transfer.sourceNodeId}:${transfer.destinationNodeId ?? '-'}${index ? `#${index.value}` : ''}`
}

export class CanTopicTable {
  private readonly entries = new Map<string, CanTopicEntry>()

  add(transfer: DronecanTransfer): void {
    const key = canTopicKey(transfer)
    const existing = this.entries.get(key)
    if (!existing) {
      this.entries.set(key, {
        key,
        index: canTopicIndex(transfer),
        bus: transfer.bus,
        kind: transfer.kind,
        dataTypeId: transfer.dataTypeId,
        sourceNodeId: transfer.sourceNodeId,
        destinationNodeId: transfer.destinationNodeId,
        count: 1,
        firstSeenMs: transfer.timestampMs,
        lastSeenMs: transfer.timestampMs,
        last: transfer
      })
      return
    }
    existing.count += 1
    existing.lastSeenMs = transfer.timestampMs
    const span = existing.lastSeenMs - existing.firstSeenMs
    existing.rateHz = span > 0 ? ((existing.count - 1) * 1000) / span : undefined
    existing.last = transfer
  }

  /** Entries for one node (as source or destination), or all; ordered by node then type. */
  list(nodeId?: number): CanTopicEntry[] {
    const all = [...this.entries.values()].filter(
      (entry) => nodeId === undefined || entry.sourceNodeId === nodeId || entry.destinationNodeId === nodeId
    )
    return all.sort(
      (left, right) =>
        left.sourceNodeId - right.sourceNodeId ||
        Number(left.kind !== 'message') - Number(right.kind !== 'message') ||
        left.dataTypeId - right.dataTypeId
    )
  }

  get size(): number {
    return this.entries.size
  }

  clear(): void {
    this.entries.clear()
  }
}

/** A stream is stale when nothing arrived for three of its periods (at least 3 s). */
export function isCanTopicStale(entry: CanTopicEntry, nowMs: number): boolean {
  const periodMs = entry.rateHz ? 1000 / entry.rateHz : 0
  return nowMs - entry.lastSeenMs > Math.max(3000, periodMs * 3)
}

/**
 * The monitor id filter that shows exactly this stream's frames: the 29-bit
 * id with the priority bits masked off (priority can vary per transfer).
 */
export function canTopicIdFilter(entry: Pick<CanTopicEntry, 'kind' | 'dataTypeId' | 'sourceNodeId' | 'destinationNodeId'>): string {
  let id: number
  if (entry.kind === 'request' || entry.kind === 'response') {
    id =
      ((entry.dataTypeId & 0xff) << 16) |
      ((entry.kind === 'request' ? 1 : 0) << 15) |
      (((entry.destinationNodeId ?? 0) & 0x7f) << 8) |
      0x80 |
      (entry.sourceNodeId & 0x7f)
  } else {
    id = ((entry.dataTypeId & 0xffff) << 8) | (entry.sourceNodeId & 0x7f)
  }
  return `${(id >>> 0).toString(16).toUpperCase().padStart(8, '0')}/00FFFFFF`
}

export function formatCanTopicRate(rateHz: number | undefined): string {
  if (rateHz === undefined) return '—'
  return rateHz >= 10 ? `${Math.round(rateHz)} Hz` : `${rateHz.toFixed(1)} Hz`
}
