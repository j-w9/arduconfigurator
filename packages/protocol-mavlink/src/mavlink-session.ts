import type { Transport, TransportStatus, Unsubscribe } from '@arduconfig/transport'

import { MAV_AUTOPILOT, MAV_STATE, MAV_TYPE } from './constants.js'
import type { StreamingCodec } from './json-lines-codec.js'
import {
  MavlinkV2Codec,
  type MavlinkSignatureRejection,
  type MavlinkV2SigningConfig
} from './mavlink-v2-codec.js'
import type { MavlinkEnvelope, MavlinkMessage } from './messages.js'

type MessageListener = (envelope: MavlinkEnvelope) => void
type StatusListener = (status: TransportStatus) => void

export interface SessionSendOptions {
  systemId?: number
  componentId?: number
}

// Optional, non-breaking observation hooks for live session recording. Both
// are no-ops if unset, so existing call sites and behaviour are unaffected.
// Frames are surfaced at the wire boundary: inbound just before the codec
// parses them, outbound just after encode and before the transport sends.
export interface MavlinkSessionOptions {
  onInboundFrame?(frame: Uint8Array, atMs: number): void
  onOutboundFrame?(frame: Uint8Array, atMs: number): void
  /**
   * GCS HEARTBEAT broadcast. The MAVLink heartbeat microservice REQUIRES
   * every component — GCS included — to broadcast HEARTBEAT (~1 Hz on RF
   * links); ArduPilot's GCS failsafe keys on it (GCS_Common.cpp
   * handle_heartbeat -> sysid_mygcs_seen). Without it the failsafe is
   * never armed by our sessions — or worse, a prior Mission Planner
   * session armed it and it then FIRES mid-session because we go silent.
   * Default enabled at 1000ms; pass `false` to disable (strict replay
   * fidelity, byte-exact probes).
   */
  gcsHeartbeat?: false | { intervalMs?: number }
}

const DEFAULT_GCS_HEARTBEAT_INTERVAL_MS = 1000

export class MavlinkSession {
  private readonly messageListeners = new Set<MessageListener>()
  private readonly sentMessageListeners = new Set<MessageListener>()
  private readonly statusListeners = new Set<StatusListener>()
  private readonly transportSubscriptions: Unsubscribe[]
  private sequence = 0
  private heartbeatTimer: ReturnType<typeof setInterval> | undefined

  constructor(
    private readonly transport: Transport,
    private readonly codec: StreamingCodec<MavlinkEnvelope>,
    private readonly gcsIdentity = { systemId: 255, componentId: 190 },
    private readonly options: MavlinkSessionOptions = {}
  ) {
    this.transportSubscriptions = [
      this.transport.onFrame((frame: Uint8Array) => {
        this.options.onInboundFrame?.(frame, Date.now())
        this.codec.push(frame).forEach((envelope) => {
          this.messageListeners.forEach((listener) => listener(envelope))
        })
      }),
      this.transport.onStatus((status: TransportStatus) => {
        // Heartbeat lifecycle rides the transport status: broadcast only
        // while the link is up, stop on any other state so a disconnected
        // transport isn't asked to send (and a reconnect restarts cleanly).
        if (status.kind === 'connected') {
          this.startGcsHeartbeat()
        } else {
          this.stopGcsHeartbeat()
        }
        this.statusListeners.forEach((listener) => listener(status))
      })
    ]
  }

  /**
   * 1 Hz GCS HEARTBEAT from our identity (255/190 by default — matching
   * ArduPilot's _GCS_SYSID default of 255 so sysid_mygcs_seen fires).
   * Field set mirrors Mission Planner / QGC: type GCS(6), autopilot
   * INVALID(8) ("not a flight controller"), modes 0, state ACTIVE(4).
   * Sends immediately on link-up so the FC sees us without a 1 s gap.
   */
  private startGcsHeartbeat(): void {
    if (this.options.gcsHeartbeat === false || this.heartbeatTimer !== undefined) {
      return
    }
    const intervalMs = this.options.gcsHeartbeat?.intervalMs ?? DEFAULT_GCS_HEARTBEAT_INTERVAL_MS
    const beat = (): void => {
      // Best-effort: a send racing a link drop must not surface as an
      // unhandled rejection — the status listener stops the loop.
      void this.send({
        type: 'HEARTBEAT',
        vehicleType: MAV_TYPE.GCS,
        autopilot: MAV_AUTOPILOT.INVALID,
        baseMode: 0,
        customMode: 0,
        systemStatus: MAV_STATE.ACTIVE,
        mavlinkVersion: 3
      }).catch(() => {})
    }
    beat()
    this.heartbeatTimer = setInterval(beat, intervalMs)
  }

  private stopGcsHeartbeat(): void {
    if (this.heartbeatTimer !== undefined) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = undefined
    }
  }

  getTransportStatus(): TransportStatus {
    return this.transport.getStatus()
  }

  async connect(): Promise<void> {
    await this.transport.connect()
  }

  async disconnect(): Promise<void> {
    await this.transport.disconnect()
  }

  async send(message: MavlinkMessage, options: SessionSendOptions = {}): Promise<void> {
    const envelope: MavlinkEnvelope = {
      header: {
        systemId: options.systemId ?? this.gcsIdentity.systemId,
        componentId: options.componentId ?? this.gcsIdentity.componentId,
        sequence: this.sequence++
      },
      message,
      timestampMs: Date.now()
    }

    const frame = this.codec.encode(envelope)
    this.options.onOutboundFrame?.(frame, Date.now())
    // Fan the outbound message out to sent-message subscribers (e.g. the MAVLink
    // inspector's "Sent" view). Same envelope shape as inbound, with byteLength
    // set from the encoded frame so bandwidth accounting works symmetrically.
    if (this.sentMessageListeners.size > 0) {
      const sentEnvelope: MavlinkEnvelope = { ...envelope, byteLength: frame.length }
      this.sentMessageListeners.forEach((listener) => listener(sentEnvelope))
    }
    await this.transport.send(frame)
  }

  onMessage(listener: MessageListener): Unsubscribe {
    this.messageListeners.add(listener)
    return () => {
      this.messageListeners.delete(listener)
    }
  }

  /** Subscribe to messages this session SENDS (outbound). Mirrors onMessage. */
  onSentMessage(listener: MessageListener): Unsubscribe {
    this.sentMessageListeners.add(listener)
    return () => {
      this.sentMessageListeners.delete(listener)
    }
  }

  /**
   * Configure MAVLink v2 signing on the underlying codec. Passing
   * `undefined` (or `{ enabled: false }`) restores unsigned behaviour. No-op
   * when the session was built with a non-v2 codec (e.g. a test stub) — the
   * caller can check {@link supportsSigning} first.
   */
  setSigningConfig(config: MavlinkV2SigningConfig | undefined): void {
    if (this.codec instanceof MavlinkV2Codec) {
      this.codec.setSigningConfig(config)
    }
  }

  /** True when the session's codec can sign/verify v2 frames. */
  supportsSigning(): boolean {
    return this.codec instanceof MavlinkV2Codec
  }

  /** Total signed frames dropped by verification so far (0 if unsupported). */
  getSignatureRejectionCount(): number {
    return this.codec instanceof MavlinkV2Codec ? this.codec.getSignatureRejectionCount() : 0
  }

  /**
   * Subscribe to signed-frame rejections. Returns an unsubscribe that clears
   * the handler. Only one handler is tracked (matching the codec); a no-op
   * unsubscribe is returned when signing is unsupported.
   */
  onSignatureRejection(handler: (rejection: MavlinkSignatureRejection) => void): Unsubscribe {
    if (!(this.codec instanceof MavlinkV2Codec)) {
      return () => {}
    }
    this.codec.setSignatureRejectionHandler(handler)
    return () => {
      if (this.codec instanceof MavlinkV2Codec) {
        this.codec.setSignatureRejectionHandler(undefined)
      }
    }
  }

  onStatus(listener: StatusListener): Unsubscribe {
    this.statusListeners.add(listener)
    listener(this.transport.getStatus())
    return () => {
      this.statusListeners.delete(listener)
    }
  }

  destroy(): void {
    this.stopGcsHeartbeat()
    this.transportSubscriptions.forEach((unsubscribe) => unsubscribe())
    this.transportSubscriptions.length = 0
    this.codec.reset()
  }
}
