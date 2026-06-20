import { Socket } from 'node:net'

import type { FrameListener, StatusListener, Transport, TransportStatus, Unsubscribe } from '@arduconfig/transport'

export interface TcpTransportOptions {
  host: string
  port: number
  connectTimeoutMs?: number
  noDelay?: boolean
}

export class TcpTransport implements Transport {
  readonly kind = 'tcp' as const
  readonly id: string

  private readonly frameListeners = new Set<FrameListener>()
  private readonly statusListeners = new Set<StatusListener>()
  private readonly options: Required<TcpTransportOptions>
  private socket?: Socket
  private status: TransportStatus = { kind: 'idle' }
  /**
   * Idempotency latch for connect() so concurrent calls share one attempt
   * rather than constructing a second socket. Same pattern across the
   * transports.
   */
  private connectPromise?: Promise<void>
  /**
   * Symmetric pair to connectPromise — true while a disconnect is in
   * progress so a concurrent doConnect() aborts before marking the
   * transport `connected`.
   */
  private intentionalDisconnect = false

  constructor(id: string, options: TcpTransportOptions) {
    this.id = id
    this.options = {
      host: options.host,
      port: options.port,
      connectTimeoutMs: options.connectTimeoutMs ?? 10000,
      noDelay: options.noDelay ?? true
    }
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

    const socket = new Socket()
    socket.setNoDelay(this.options.noDelay)

    await new Promise<void>((resolve, reject) => {
      const handleConnect = (): void => {
        cleanup()
        // If disconnect() flipped the flag while connecting, destroy the
        // socket and bail before exposing it as this.socket / marking
        // 'connected'.
        if (this.intentionalDisconnect) {
          socket.destroy()
          reject(new Error('TCP connect aborted by disconnect.'))
          return
        }
        this.socket = socket
        this.updateStatus({ kind: 'connected' })
        resolve()
      }

      const handleError = (error: Error): void => {
        cleanup()
        socket.destroy()
        this.updateStatus({ kind: 'error', message: error.message })
        reject(error)
      }

      const handleTimeout = (): void => {
        cleanup()
        socket.destroy()
        const error = new Error(`Timed out connecting to ${this.options.host}:${this.options.port}.`)
        this.updateStatus({ kind: 'error', message: error.message })
        reject(error)
      }

      const cleanup = (): void => {
        socket.off('connect', handleConnect)
        socket.off('error', handleError)
        socket.off('timeout', handleTimeout)
      }

      socket.once('connect', handleConnect)
      socket.once('error', handleError)
      socket.once('timeout', handleTimeout)
      socket.setTimeout(this.options.connectTimeoutMs)
      socket.connect(this.options.port, this.options.host)
    })

    socket.on('data', (chunk: Buffer) => {
      const frame = new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength)
      const copy = frame.slice()
      this.frameListeners.forEach((listener) => listener(copy))
    })
    socket.on('close', () => {
      this.socket = undefined
      if (this.status.kind === 'connected') {
        this.updateStatus({ kind: 'disconnected', reason: 'TCP socket closed.' })
      }
    })
    socket.on('error', (error: Error) => {
      this.updateStatus({ kind: 'error', message: error.message })
    })
  }

  async disconnect(): Promise<void> {
    // Flip the flag FIRST so an in-flight doConnect aborts at its
    // handleConnect boundary instead of marking 'connected'. Then wait
    // for the connect to settle so the socket-to-close (if any) is known.
    this.intentionalDisconnect = true
    if (this.connectPromise) {
      await this.connectPromise.catch(() => undefined)
    }
    const socket = this.socket
    this.socket = undefined

    if (!socket) {
      this.updateStatus({ kind: 'disconnected', reason: 'TCP transport already disconnected.' })
      return
    }

    await new Promise<void>((resolve) => {
      socket.once('close', () => resolve())
      socket.end()
      setTimeout(() => {
        if (!socket.destroyed) {
          socket.destroy()
        }
        resolve()
      }, 500)
    })

    this.updateStatus({ kind: 'disconnected', reason: 'TCP socket closed.' })
  }

  async send(frame: Uint8Array): Promise<void> {
    if (!this.socket) {
      throw new Error('TcpTransport is not connected.')
    }

    await new Promise<void>((resolve, reject) => {
      this.socket!.write(frame, (error?: Error | null) => {
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
