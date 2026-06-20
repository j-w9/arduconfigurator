// Live telemetry session recorder. Accumulates inbound/outbound MAVLink frames
// captured at the transport boundary into the EXISTING RecordedSession replay
// format (see replay-transport.ts) so a recording round-trips straight into
// ReplayTransport. Reuses createRecordedSessionEvent / serializeRecordedSession;
// it does NOT define a new wire format.
//
// Memory safety: an unbounded capture is a footgun (a 10-minute live session
// is ~360MB), so the buffer is capped. When the cap is reached the recorder
// STOPS capturing and marks the session truncated; callers surface that flag
// in the UI. The default cap (200k events) is roughly a few minutes of busy
// telemetry and well under any realistic memory pressure.

import {
  createRecordedSession,
  createRecordedSessionEvent,
  type RecordedSession,
  type RecordedSessionEvent
} from './replay-transport.js'

export const DEFAULT_MAX_RECORDED_EVENTS = 200_000

export interface SessionRecorderOptions {
  /** Label stored on the produced RecordedSession. */
  label?: string
  /** Description stored on the produced RecordedSession. */
  description?: string
  /**
   * Hard cap on captured events. On overflow the recorder stops capturing and
   * marks the session truncated. Must be a positive integer; otherwise the
   * default is used.
   */
  maxEvents?: number
}

/**
 * A RecordedSession with a truncation flag. `truncated` is true when the
 * event cap was hit and capture stopped early. The shape is otherwise a plain
 * RecordedSession and serializes/parses through the existing replay helpers
 * (the extra flag is ignored by parseRecordedSession).
 */
export interface RecordedSessionResult extends RecordedSession {
  truncated?: boolean
}

export class SessionRecorder {
  private readonly maxEvents: number
  private readonly label?: string
  private readonly description?: string

  private events: RecordedSessionEvent[] = []
  private recording = false
  private truncated = false

  constructor(options: SessionRecorderOptions = {}) {
    this.label = options.label
    this.description = options.description
    this.maxEvents =
      typeof options.maxEvents === 'number' && Number.isInteger(options.maxEvents) && options.maxEvents > 0
        ? options.maxEvents
        : DEFAULT_MAX_RECORDED_EVENTS
  }

  /** Begin a fresh capture, discarding any prior events. */
  start(): void {
    this.events = []
    this.recording = true
    this.truncated = false
  }

  /** Stop capturing. Idempotent; the accumulated events remain available. */
  stop(): void {
    this.recording = false
  }

  isRecording(): boolean {
    return this.recording
  }

  isTruncated(): boolean {
    return this.truncated
  }

  /** Number of events captured so far. */
  eventCount(): number {
    return this.events.length
  }

  /** Inbound-frame hook for MavlinkSessionOptions.onInboundFrame. */
  recordInbound = (frame: Uint8Array, atMs: number = Date.now()): void => {
    this.record(frame, 'in', atMs)
  }

  /** Outbound-frame hook for MavlinkSessionOptions.onOutboundFrame. */
  recordOutbound = (frame: Uint8Array, atMs: number = Date.now()): void => {
    this.record(frame, 'out', atMs)
  }

  /**
   * Snapshot the capture as a RecordedSession in the existing replay format.
   * Copies the events so the result is detached from this recorder's buffer.
   */
  getSession(): RecordedSessionResult {
    const session = createRecordedSession(this.label ?? 'Recorded session', this.events, this.description)
    return this.truncated ? { ...session, truncated: true } : session
  }

  private record(frame: Uint8Array, direction: RecordedSessionEvent['direction'], atMs: number): void {
    if (!this.recording) {
      return
    }
    if (this.events.length >= this.maxEvents) {
      // Cap reached: stop capturing and flag the session as truncated rather
      // than growing the buffer without bound.
      this.recording = false
      this.truncated = true
      return
    }
    // Copy the frame bytes: transport implementations may reuse/mutate the
    // backing buffer after the hook returns. createRecordedSessionEvent
    // base64-encodes immediately, so a copy is only needed if the encoder ever
    // changed; encoding now makes a detached string, so this is already safe.
    this.events.push(createRecordedSessionEvent(frame, direction, atMs))
  }
}
