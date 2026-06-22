import type { FrameListener, StatusListener, Transport, TransportStatus, Unsubscribe } from './types.js'

// Direct Sockets (`TCPSocket`) transport — the IWA counterpart to
// DirectSocketsUdpTransport, for MAVLink-over-TCP (e.g. SITL's tcp:5760). Like
// the UDP one it only resolves inside an Isolated Web App; normal tabs use the
// bridge. TCP is a byte stream, so frames are forwarded as-is and the codec
// reassembles them — no per-datagram addressing. The real `TCPSocket` is
// isolated behind an injectable factory for unit-testing.

interface TcpSocketOpenInfo {
  readable: ReadableStream<Uint8Array>
  writable: WritableStream<Uint8Array>
}

export interface TcpSocketLike {
  readonly opened: Promise<TcpSocketOpenInfo>
  close(): Promise<void> | void
}

export interface DirectSocketsTcpTransportOptions {
  remoteAddress: string
  remotePort: number
  socketFactory?: (options: DirectSocketsTcpTransportOptions) => TcpSocketLike
}

interface TCPSocketConstructor {
  new (remoteAddress: string, remotePort: number): TcpSocketLike
}

function defaultTcpSocketFactory(options: DirectSocketsTcpTransportOptions): TcpSocketLike {
  const ctor = (globalThis as { TCPSocket?: TCPSocketConstructor }).TCPSocket
  if (typeof ctor !== 'function') {
    throw new Error(
      'Direct Sockets TCPSocket is unavailable. Raw TCP only works inside an Isolated Web App on a ' +
        'Chromium browser; use the WebSocket bridge in a normal tab.'
    )
  }
  return new ctor(options.remoteAddress, options.remotePort)
}

export class DirectSocketsTcpTransport implements Transport {
  readonly kind = 'tcp' as const
  readonly id: string

  private readonly frameListeners = new Set<FrameListener>()
  private readonly statusListeners = new Set<StatusListener>()
  private readonly options: DirectSocketsTcpTransportOptions

  private status: TransportStatus = { kind: 'idle' }
  private socket?: TcpSocketLike
  private writer?: WritableStreamDefaultWriter<Uint8Array>
  private reader?: ReadableStreamDefaultReader<Uint8Array>
  private connectPromise?: Promise<void>
  private intentionalDisconnect = false

  constructor(id = 'direct-tcp', options: DirectSocketsTcpTransportOptions) {
    this.id = id
    this.options = options
  }

  static isSupported(): boolean {
    return typeof (globalThis as { TCPSocket?: unknown }).TCPSocket === 'function'
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
    const factory = this.options.socketFactory ?? defaultTcpSocketFactory

    try {
      const socket = factory(this.options)
      const open = await socket.opened
      if (this.intentionalDisconnect) {
        await socket.close()
        throw new Error('TCP connect aborted by disconnect.')
      }
      this.socket = socket
      this.writer = open.writable.getWriter()
      this.reader = open.readable.getReader()
      this.updateStatus({ kind: 'connected' })
      void this.readLoop(this.reader)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to open TCP socket.'
      if (!this.intentionalDisconnect) {
        this.updateStatus({ kind: 'error', message })
      }
      throw error instanceof Error ? error : new Error(message)
    }
  }

  private async readLoop(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
    try {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) {
          break
        }
        if (!value || value.length === 0) {
          continue
        }
        const frame = value instanceof Uint8Array ? value.slice() : new Uint8Array(value)
        this.frameListeners.forEach((listener) => listener(frame))
      }
    } catch (error) {
      if (!this.intentionalDisconnect && this.status.kind === 'connected') {
        const message = error instanceof Error ? error.message : 'TCP read failed.'
        this.updateStatus({ kind: 'error', message })
      }
    }
  }

  async disconnect(): Promise<void> {
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
    this.updateStatus({ kind: 'disconnected', reason: 'TCP socket closed.' })
  }

  async send(frame: Uint8Array): Promise<void> {
    if (!this.writer) {
      throw new Error('DirectSocketsTcpTransport is not connected.')
    }
    await this.writer.write(frame)
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
