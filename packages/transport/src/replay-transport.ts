import type { FrameListener, StatusListener, Transport, TransportStatus, Unsubscribe } from './types.js'

export interface RecordedSessionEvent {
  atMs: number
  direction: 'in' | 'out'
  frameBase64: string
}

export interface RecordedSession {
  version: 1
  label?: string
  description?: string
  events: RecordedSessionEvent[]
}

export interface ReplayTransportOptions {
  session: RecordedSession
  speedMultiplier?: number
  strictOutbound?: boolean
}

export class ReplayTransport implements Transport {
  readonly kind = 'replay' as const
  readonly id: string

  private readonly frameListeners = new Set<FrameListener>()
  private readonly statusListeners = new Set<StatusListener>()
  private readonly options: ReplayTransportOptions

  private status: TransportStatus = { kind: 'idle' }
  private readonly scheduledTimers = new Set<ReturnType<typeof setTimeout>>()
  private eventIndex = 0
  private lastProcessedAtMs = 0
  private connected = false

  constructor(id = 'replay-session', options: ReplayTransportOptions) {
    this.id = id
    this.options = options
  }

  getStatus(): TransportStatus {
    return this.status
  }

  async connect(): Promise<void> {
    if (this.connected) {
      return
    }

    this.connected = true
    this.eventIndex = 0
    this.lastProcessedAtMs = 0
    this.updateStatus({ kind: 'connecting' })
    this.updateStatus({ kind: 'connected' })

    if (this.options.strictOutbound) {
      this.advanceStrictReplay()
      return
    }

    const speedMultiplier = this.options.speedMultiplier ?? 1
    const inboundEvents = [...this.options.session.events]
      .filter((event) => event.direction === 'in')
      .sort((left, right) => left.atMs - right.atMs)

    // Schedule relative to the FIRST inbound event, not to absolute
    // atMs-from-connect. A real recorder timestamps frames with a
    // monotonic/wall clock, so the first frame's atMs is rarely ~0
    // (seconds for a relative clock, ~decades for epoch ms). Using the
    // raw atMs as the delay made the desktop bridge's --source=replay
    // sit silent until that offset elapsed. Strict mode already paces
    // session-relative (atMs - lastProcessedAtMs); this makes non-strict
    // consistent. Byte-identical for recordings that already start at 0.
    const baseAtMs = inboundEvents[0]?.atMs ?? 0

    inboundEvents.forEach((event) => {
      const delayMs = speedMultiplier <= 0 ? 0 : Math.max(0, event.atMs - baseAtMs) / speedMultiplier
      const timer = setTimeout(() => {
        this.scheduledTimers.delete(timer)
        if (!this.connected) {
          return
        }

        const frame = decodeRecordedSessionFrame(event)
        this.frameListeners.forEach((listener) => listener(frame))
      }, delayMs)
      this.scheduledTimers.add(timer)
    })
  }

  async disconnect(): Promise<void> {
    this.connected = false
    this.clearTimers()

    const remainingOutboundEvents = this.options.strictOutbound
      ? this.options.session.events.slice(this.eventIndex).filter((event) => event.direction === 'out')
      : []

    if (remainingOutboundEvents.length > 0) {
      const noun = remainingOutboundEvents.length === 1 ? 'frame was' : 'frames were'
      const message = `Replay session ${this.id} ended before ${remainingOutboundEvents.length} required outbound ${noun} emitted.`
      this.updateStatus({ kind: 'error', message })
      throw new Error(message)
    }

    this.updateStatus({ kind: 'disconnected', reason: 'Replay session disconnected.' })
  }

  async send(frame: Uint8Array): Promise<void> {
    if (!this.connected) {
      throw new Error('ReplayTransport is not connected.')
    }

    if (!this.options.strictOutbound) {
      return
    }

    const expected = this.options.session.events[this.eventIndex]
    if (!expected || expected.direction !== 'out') {
      const message = `Unexpected outbound frame at replay event ${this.eventIndex + 1} for session ${this.id}.`
      this.updateStatus({ kind: 'error', message })
      throw new Error(message)
    }

    const expectedFrame = decodeRecordedSessionFrame(expected)
    if (!bytesEqual(expectedFrame, frame)) {
      const message = `Outbound frame at replay event ${this.eventIndex + 1} did not match the recorded session.`
      this.updateStatus({ kind: 'error', message })
      throw new Error(message)
    }

    this.lastProcessedAtMs = expected.atMs
    this.eventIndex += 1
    this.advanceStrictReplay()
  }

  onFrame(listener: FrameListener): Unsubscribe {
    this.frameListeners.add(listener)
    return () => {
      this.frameListeners.delete(listener)
    }
  }

  onStatus(listener: StatusListener): Unsubscribe {
    this.statusListeners.add(listener)
    listener(this.status)
    return () => {
      this.statusListeners.delete(listener)
    }
  }

  private clearTimers(): void {
    this.scheduledTimers.forEach((timer) => clearTimeout(timer))
    this.scheduledTimers.clear()
  }

  private updateStatus(status: TransportStatus): void {
    this.status = status
    this.statusListeners.forEach((listener) => listener(status))
  }

  private advanceStrictReplay(): void {
    if (!this.connected) {
      return
    }

    const event = this.options.session.events[this.eventIndex]
    if (!event) {
      return
    }

    if (event.direction === 'out') {
      return
    }

    const speedMultiplier = this.options.speedMultiplier ?? 1
    const delayMs = speedMultiplier <= 0 ? 0 : Math.max(0, event.atMs - this.lastProcessedAtMs) / speedMultiplier
    const timer = setTimeout(() => {
      this.scheduledTimers.delete(timer)
      if (!this.connected) {
        return
      }

      const frame = decodeRecordedSessionFrame(event)
      this.frameListeners.forEach((listener) => listener(frame))
      this.lastProcessedAtMs = event.atMs
      this.eventIndex += 1
      this.advanceStrictReplay()
    }, delayMs)

    this.scheduledTimers.add(timer)
  }
}

export function createRecordedSession(label: string, events: RecordedSessionEvent[], description?: string): RecordedSession {
  return {
    version: 1,
    label,
    description,
    events: [...events].sort((left, right) => left.atMs - right.atMs)
  }
}

export function createRecordedSessionEvent(frame: Uint8Array, direction: RecordedSessionEvent['direction'], atMs: number): RecordedSessionEvent {
  return {
    atMs,
    direction,
    frameBase64: encodeBase64(frame)
  }
}

export function serializeRecordedSession(session: RecordedSession): string {
  return JSON.stringify(session, null, 2)
}

export function parseRecordedSession(raw: string): RecordedSession {
  const parsed = JSON.parse(raw) as Partial<RecordedSession>
  if (parsed.version !== 1 || !Array.isArray(parsed.events)) {
    throw new Error('Invalid recorded session payload.')
  }

  return {
    version: 1,
    label: typeof parsed.label === 'string' ? parsed.label : undefined,
    description: typeof parsed.description === 'string' ? parsed.description : undefined,
    events: parsed.events
      .map((event) => {
        const candidate = event as Partial<RecordedSessionEvent>
        if (
          typeof candidate.atMs !== 'number' ||
          (candidate.direction !== 'in' && candidate.direction !== 'out') ||
          typeof candidate.frameBase64 !== 'string'
        ) {
          throw new Error('Invalid recorded session event payload.')
        }

        return {
          atMs: candidate.atMs,
          direction: candidate.direction,
          frameBase64: candidate.frameBase64
        }
      })
      .sort((left, right) => left.atMs - right.atMs)
  }
}

export function decodeRecordedSessionFrame(event: RecordedSessionEvent): Uint8Array {
  return decodeBase64(event.frameBase64)
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) {
    return false
  }

  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false
    }
  }

  return true
}

function encodeBase64(frame: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(frame).toString('base64')
  }

  let binary = ''
  frame.forEach((byte) => {
    binary += String.fromCharCode(byte)
  })
  return btoa(binary)
}

function decodeBase64(value: string): Uint8Array {
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(value, 'base64'))
  }

  const binary = atob(value)
  const frame = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    frame[index] = binary.charCodeAt(index)
  }
  return frame
}
