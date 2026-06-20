import dgram, { type RemoteInfo, type Socket } from 'node:dgram'

import type { FrameListener, StatusListener, Transport, TransportStatus, Unsubscribe } from '@arduconfig/transport'

export interface UdpTransportOptions {
  bindHost?: string
  bindPort: number
  remoteHost?: string
  remotePort?: number
}

export class UdpTransport implements Transport {
  readonly kind = 'udp' as const
  readonly id: string

  private readonly frameListeners = new Set<FrameListener>()
  private readonly statusListeners = new Set<StatusListener>()
  private readonly options: UdpTransportOptions
  private socket?: Socket
  private status: TransportStatus = { kind: 'idle' }
  private remoteEndpoint?: { host: string; port: number }
  /** Idempotency latch for connect() — see TcpTransport. */
  private connectPromise?: Promise<void>
  /**
   * Symmetric pair to connectPromise — true while a disconnect is in
   * progress so a concurrent doConnect() aborts at the 'listening'
   * boundary instead of marking 'connected'.
   */
  private intentionalDisconnect = false

  constructor(id: string, options: UdpTransportOptions) {
    this.id = id
    this.options = options
    this.remoteEndpoint =
      options.remoteHost !== undefined && options.remotePort !== undefined
        ? { host: options.remoteHost, port: options.remotePort }
        : undefined
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
    // Reset for this attempt so an earlier aborted connect doesn't make a
    // fresh legitimate connect self-abort immediately.
    this.intentionalDisconnect = false
    const socket = dgram.createSocket('udp4')

    socket.on('message', (message: Buffer, remote: RemoteInfo) => {
      this.remoteEndpoint = {
        host: remote.address,
        port: remote.port
      }
      const frame = new Uint8Array(message.buffer, message.byteOffset, message.byteLength)
      const copy = frame.slice()
      this.frameListeners.forEach((listener) => listener(copy))
    })
    socket.on('error', (error: Error) => {
      this.updateStatus({ kind: 'error', message: error.message })
    })
    socket.on('close', () => {
      if (this.status.kind === 'connected') {
        this.updateStatus({ kind: 'disconnected', reason: 'UDP socket closed.' })
      }
    })

    await new Promise<void>((resolve, reject) => {
      socket.once('listening', () => {
        // If disconnect() flipped the flag while binding, close the socket
        // and bail before exposing it as this.socket / marking 'connected'.
        if (this.intentionalDisconnect) {
          socket.close()
          reject(new Error('UDP connect aborted by disconnect.'))
          return
        }
        this.socket = socket
        this.updateStatus({ kind: 'connected' })
        resolve()
      })
      socket.once('error', (error) => {
        socket.close()
        reject(error)
      })
      socket.bind(this.options.bindPort, this.options.bindHost)
    })
  }

  async disconnect(): Promise<void> {
    // Flip the flag FIRST so an in-flight doConnect aborts at its
    // 'listening' boundary instead of marking 'connected'. Then wait for
    // the connect to settle so the socket-to-close (if any) is known.
    this.intentionalDisconnect = true
    if (this.connectPromise) {
      await this.connectPromise.catch(() => undefined)
    }
    const socket = this.socket
    this.socket = undefined

    if (!socket) {
      this.updateStatus({ kind: 'disconnected', reason: 'UDP transport already disconnected.' })
      return
    }

    await new Promise<void>((resolve) => {
      socket.once('close', () => resolve())
      socket.close()
    })
    this.updateStatus({ kind: 'disconnected', reason: 'UDP socket closed.' })
  }

  async send(frame: Uint8Array): Promise<void> {
    if (!this.socket) {
      throw new Error('UdpTransport is not connected.')
    }

    const remoteEndpoint = this.remoteEndpoint
    if (!remoteEndpoint) {
      throw new Error('UdpTransport has not observed a remote endpoint yet.')
    }

    await new Promise<void>((resolve, reject) => {
      this.socket!.send(frame, remoteEndpoint.port, remoteEndpoint.host, (error) => {
        if (error) {
          reject(error)
          return
        }
        resolve()
      })
    })
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
