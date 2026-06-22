import type { FrameListener, StatusListener, Transport, TransportStatus, Unsubscribe } from './types.js'

// Direct Sockets (`UDPSocket`) transport. The browser sandbox forbids raw UDP
// in a normal tab; this only resolves inside an Isolated Web App, where the
// Direct Sockets API is exposed. For regular tabs the WebSocket-bridge path
// stays the supported route — callers feature-detect with `isSupported()`
// before offering this.
//
// The real `UDPSocket` is isolated behind an injectable factory + a minimal
// structural interface (the same shape WebSocketTransport uses for
// `WebSocketLike`), so the transport is unit-testable with a mock and the one
// spot that touches the platform API stays adaptable.
//
// Two modes, mirroring the Node UdpTransport in sitl-harness:
//   - bound/listen (no remoteAddress): bind a local port, learn the peer from
//     the first inbound datagram, and address replies back to it. This is the
//     ELRS / Mission-Planner-UDP-listen case.
//   - connected (remoteAddress + remotePort): datagrams flow to/from a fixed
//     remote and are written without a per-message address.

export interface UdpMessage {
  data: Uint8Array
  remoteAddress?: string
  remotePort?: number
}

interface UdpSocketOpenInfo {
  readable: ReadableStream<UdpMessage>
  writable: WritableStream<UdpMessage>
  localAddress?: string
  localPort?: number
}

export interface UdpSocketLike {
  readonly opened: Promise<UdpSocketOpenInfo>
  close(): Promise<void> | void
}

export interface DirectSocketsUdpTransportOptions {
  /** Bound/listen mode: local port to bind (e.g. 14550 for an ELRS UDP feed). */
  localPort?: number
  localAddress?: string
  /** Connected mode: fixed remote to talk to. Presence selects connected mode. */
  remoteAddress?: string
  remotePort?: number
  socketFactory?: (options: DirectSocketsUdpTransportOptions) => UdpSocketLike
}

interface UDPSocketConstructor {
  new (options: {
    localAddress?: string
    localPort?: number
    remoteAddress?: string
    remotePort?: number
  }): UdpSocketLike
}

function defaultUdpSocketFactory(options: DirectSocketsUdpTransportOptions): UdpSocketLike {
  const ctor = (globalThis as { UDPSocket?: UDPSocketConstructor }).UDPSocket
  if (typeof ctor !== 'function') {
    throw new Error(
      'Direct Sockets UDPSocket is unavailable. Raw UDP only works inside an Isolated Web App on a ' +
        'Chromium browser; use the WebSocket bridge in a normal tab.'
    )
  }
  if (options.remoteAddress !== undefined && options.remotePort !== undefined) {
    return new ctor({
      remoteAddress: options.remoteAddress,
      remotePort: options.remotePort,
      localAddress: options.localAddress,
      localPort: options.localPort
    })
  }
  return new ctor({ localAddress: options.localAddress, localPort: options.localPort })
}

export class DirectSocketsUdpTransport implements Transport {
  readonly kind = 'udp' as const
  readonly id: string

  private readonly frameListeners = new Set<FrameListener>()
  private readonly statusListeners = new Set<StatusListener>()
  private readonly options: DirectSocketsUdpTransportOptions
  /** Bound/listen mode addresses each reply to the learned peer; connected mode does not. */
  private readonly boundMode: boolean

  private status: TransportStatus = { kind: 'idle' }
  private socket?: UdpSocketLike
  private writer?: WritableStreamDefaultWriter<UdpMessage>
  private reader?: ReadableStreamDefaultReader<UdpMessage>
  /** Last peer seen on an inbound datagram (bound mode), so writes reply to it. */
  private remoteEndpoint?: { address: string; port: number }
  /** Idempotency latch for connect() — see UdpTransport / TcpTransport. */
  private connectPromise?: Promise<void>
  /** True while a disconnect is in flight so an in-progress connect self-aborts. */
  private intentionalDisconnect = false

  constructor(id = 'direct-udp', options: DirectSocketsUdpTransportOptions) {
    this.id = id
    this.options = options
    this.boundMode = options.remoteAddress === undefined || options.remotePort === undefined
  }

  static isSupported(): boolean {
    return typeof (globalThis as { UDPSocket?: unknown }).UDPSocket === 'function'
  }

  getStatus(): TransportStatus {
    return this.status
  }

  async connect(): Promise<void> {
    if (this.status.kind === 'connected') {
      return
    }
    if (this.connectPromise) {
      return this.connectPromise
    }
    this.connectPromise = this.doConnect().finally(() => {
      this.connectPromise = undefined
    })
    return this.connectPromise
  }

  private async doConnect(): Promise<void> {
    this.updateStatus({ kind: 'connecting' })
    this.intentionalDisconnect = false
    const factory = this.options.socketFactory ?? defaultUdpSocketFactory

    try {
      const socket = factory(this.options)
      const open = await socket.opened
      // If disconnect() flipped the flag while opening, close and bail before
      // exposing the socket / marking 'connected'.
      if (this.intentionalDisconnect) {
        await socket.close()
        throw new Error('UDP connect aborted by disconnect.')
      }
      this.socket = socket
      this.writer = open.writable.getWriter()
      this.reader = open.readable.getReader()
      this.updateStatus({ kind: 'connected' })
      void this.readLoop(this.reader)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to open UDP socket.'
      if (!this.intentionalDisconnect) {
        this.updateStatus({ kind: 'error', message })
      }
      throw error instanceof Error ? error : new Error(message)
    }
  }

  private async readLoop(reader: ReadableStreamDefaultReader<UdpMessage>): Promise<void> {
    try {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) {
          break
        }
        if (!value) {
          continue
        }
        if (value.remoteAddress !== undefined && value.remotePort !== undefined) {
          this.remoteEndpoint = { address: value.remoteAddress, port: value.remotePort }
        }
        const frame = value.data instanceof Uint8Array ? value.data.slice() : new Uint8Array(value.data)
        this.frameListeners.forEach((listener) => listener(frame))
      }
    } catch (error) {
      if (!this.intentionalDisconnect && this.status.kind === 'connected') {
        const message = error instanceof Error ? error.message : 'UDP read failed.'
        this.updateStatus({ kind: 'error', message })
      }
    }
  }

  async disconnect(): Promise<void> {
    // Flip the flag FIRST so an in-flight doConnect aborts at its opened
    // boundary instead of marking 'connected'.
    this.intentionalDisconnect = true
    if (this.connectPromise) {
      await this.connectPromise.catch(() => undefined)
    }
    const socket = this.socket
    this.socket = undefined

    try {
      await this.reader?.cancel()
    } catch {}
    try {
      this.writer?.releaseLock()
    } catch {}
    this.reader = undefined
    this.writer = undefined

    if (socket) {
      try {
        await socket.close()
      } catch {}
    }
    this.updateStatus({ kind: 'disconnected', reason: 'UDP socket closed.' })
  }

  async send(frame: Uint8Array): Promise<void> {
    if (!this.writer) {
      throw new Error('DirectSocketsUdpTransport is not connected.')
    }
    if (!this.boundMode) {
      await this.writer.write({ data: frame })
      return
    }
    const peer = this.remoteEndpoint
    if (!peer) {
      throw new Error('DirectSocketsUdpTransport has not observed a remote endpoint yet.')
    }
    await this.writer.write({ data: frame, remoteAddress: peer.address, remotePort: peer.port })
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

  private updateStatus(status: TransportStatus): void {
    this.status = status
    this.statusListeners.forEach((listener) => listener(status))
  }
}
