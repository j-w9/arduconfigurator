// A fixed-size ring of captured frames.
//
// A busy bus delivers thousands of frames a second; a monitor that kept them
// all would eat the tab's memory in minutes. The ring keeps the newest
// `capacity` frames, counts what fell off the back, and hands out a
// monotonically increasing sequence number per frame so a view can ask "what
// is new since seq N" without copying the whole ring every repaint.

import type { CanFrame } from './frame.js'

export class CanCaptureBuffer {
  private readonly ring: (CanFrame | undefined)[]
  private head = 0
  private count = 0
  private nextSeq = 1
  private overwritten = 0

  constructor(readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new Error('CanCaptureBuffer capacity must be a positive integer.')
    }
    this.ring = new Array<CanFrame | undefined>(capacity)
  }

  /** Store a frame, assigning its sequence number. Returns the stored frame. */
  push(frame: CanFrame): CanFrame {
    const stored: CanFrame = { ...frame, seq: this.nextSeq }
    this.nextSeq += 1
    this.ring[this.head] = stored
    this.head = (this.head + 1) % this.capacity
    if (this.count < this.capacity) {
      this.count += 1
    } else {
      this.overwritten += 1
    }
    return stored
  }

  /** Frames currently held. */
  get size(): number {
    return this.count
  }

  /** Frames ever pushed since the last clear. */
  get totalCaptured(): number {
    return this.nextSeq - 1
  }

  /** Frames pushed out of the back because the ring was full. */
  get droppedOldest(): number {
    return this.overwritten
  }

  /** Sequence number of the newest frame, 0 when empty. */
  get lastSeq(): number {
    return this.count === 0 ? 0 : this.nextSeq - 1
  }

  /** The frame at `index` from the oldest held (0) to the newest (size - 1). */
  at(index: number): CanFrame | undefined {
    if (index < 0 || index >= this.count) return undefined
    const oldest = (this.head - this.count + this.capacity) % this.capacity
    return this.ring[(oldest + index) % this.capacity]
  }

  /** All held frames, oldest first. Copies; prefer at() / forEach for hot paths. */
  toArray(): CanFrame[] {
    const out: CanFrame[] = []
    this.forEach((frame) => out.push(frame))
    return out
  }

  /** Visit held frames oldest first. */
  forEach(visit: (frame: CanFrame) => void): void {
    for (let index = 0; index < this.count; index += 1) {
      visit(this.at(index)!)
    }
  }

  /** Held frames whose seq is greater than `afterSeq`, oldest first. */
  since(afterSeq: number): CanFrame[] {
    const out: CanFrame[] = []
    for (let index = this.count - 1; index >= 0; index -= 1) {
      const frame = this.at(index)!
      if (frame.seq <= afterSeq) break
      out.push(frame)
    }
    return out.reverse()
  }

  clear(): void {
    this.ring.fill(undefined)
    this.head = 0
    this.count = 0
    this.nextSeq = 1
    this.overwritten = 0
  }
}
