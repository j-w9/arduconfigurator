// The "one row per id" view (CANalyzer calls it the trace window in fixed
// mode): each distinct id with its count, rate, period and last payload, and
// which bytes changed in the last frame -- how an unknown bus is read.

import type { CanFrame } from './frame.js'

export interface CanIdTraceEntry {
  key: string
  bus: number
  id: number
  extended: boolean
  count: number
  firstSeenMs: number
  lastSeenMs: number
  /** Mean interval between frames, ms; undefined until two have arrived. */
  periodMs?: number
  last: CanFrame
  /** Bit i set: byte i differs from the previous frame with this id. */
  changedBytes: number
}

export function canTraceKey(frame: Pick<CanFrame, 'bus' | 'id' | 'extended'>): string {
  return `${frame.bus}:${frame.extended ? 'x' : 's'}:${frame.id}`
}

/** Incrementally maintained per-id table. Feed it frames in arrival order. */
export class CanIdTrace {
  private readonly entries = new Map<string, CanIdTraceEntry>()

  add(frame: CanFrame): void {
    const key = canTraceKey(frame)
    const existing = this.entries.get(key)
    if (!existing) {
      this.entries.set(key, {
        key,
        bus: frame.bus,
        id: frame.id,
        extended: frame.extended,
        count: 1,
        firstSeenMs: frame.timestampMs,
        lastSeenMs: frame.timestampMs,
        last: frame,
        changedBytes: 0
      })
      return
    }
    let changed = 0
    const length = Math.max(existing.last.data.length, frame.data.length)
    for (let index = 0; index < length && index < 31; index += 1) {
      if (existing.last.data[index] !== frame.data[index]) changed |= 1 << index
    }
    existing.count += 1
    existing.periodMs =
      existing.count > 1 ? (frame.timestampMs - existing.firstSeenMs) / (existing.count - 1) : undefined
    existing.lastSeenMs = frame.timestampMs
    existing.last = frame
    existing.changedBytes = changed
  }

  /** Entries sorted by bus then id (the stable order a trace view wants). */
  list(): CanIdTraceEntry[] {
    return [...this.entries.values()].sort(
      (left, right) => left.bus - right.bus || Number(left.extended) - Number(right.extended) || left.id - right.id
    )
  }

  get size(): number {
    return this.entries.size
  }

  clear(): void {
    this.entries.clear()
  }
}
