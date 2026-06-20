import type { FrameListener, StatusListener, Transport, TransportStatus, Unsubscribe } from './types.js'

export interface WebSerialPortInfo {
  usbVendorId?: number
  usbProductId?: number
  bluetoothServiceClassId?: number | string
}

export interface WebSerialPortLike {
  readable: ReadableStream<Uint8Array> | null
  writable: WritableStream<Uint8Array> | null
  open(options: { baudRate: number; bufferSize?: number }): Promise<void>
  close(): Promise<void>
  getInfo?(): WebSerialPortInfo
}

export interface WebSerialNavigatorLike {
  requestPort(): Promise<WebSerialPortLike>
  getPorts?(): Promise<WebSerialPortLike[]>
}

export interface WebSerialTransportOptions {
  baudRate: number
  bufferSize?: number
  // Either a concrete port, or a resolver invoked at connect() time. The
  // resolver lets the app supply the latest selected port without
  // rebuilding (and thus tearing down) the transport mid-connect.
  port?: WebSerialPortLike | (() => WebSerialPortLike | undefined)
  onPortSelected?: (port: WebSerialPortLike) => void
}

export class WebSerialTransport implements Transport {
  readonly kind = 'web-serial' as const
  readonly id: string

  private readonly frameListeners = new Set<FrameListener>()
  private readonly statusListeners = new Set<StatusListener>()
  private readonly options: WebSerialTransportOptions

  private status: TransportStatus = { kind: 'idle' }
  private port?: WebSerialPortLike
  private reader?: ReadableStreamDefaultReader<Uint8Array>
  private writer?: WritableStreamDefaultWriter<Uint8Array>
  private intentionalDisconnect = false
  private connectPromise?: Promise<void>
  private readLoopPromise?: Promise<void>

  constructor(id = 'web-serial', options: WebSerialTransportOptions) {
    this.id = id
    this.options = options
    // A resolver port is read lazily at connect() time, not captured here.
    this.port = typeof options.port === 'function' ? undefined : options.port
  }

  private resolveOptionPort(): WebSerialPortLike | undefined {
    const provided = this.options.port
    return typeof provided === 'function' ? provided() : provided
  }

  // Open the port, self-healing a stale OS handle left open/locked by a
  // prior attempt (the classic Web Serial "Failed to open serial port"):
  // close it and reopen — re-resolving a fresh handle for the resolver
  // case — once. The outer doConnect catch owns the terminal 'error' if
  // the retry also fails.
  private async openPortWithStaleHandleRecovery(): Promise<void> {
    const openOptions = {
      baudRate: this.options.baudRate,
      bufferSize: this.options.bufferSize
    }
    try {
      await this.port!.open(openOptions)
      return
    } catch (openError) {
      if (this.intentionalDisconnect) {
        throw openError instanceof Error ? openError : new Error(String(openError))
      }
      try {
        await this.port?.close?.()
      } catch {
        // The reopen below is the real test of whether the port is usable.
      }
      if (typeof this.options.port === 'function') {
        const fresh = this.resolveOptionPort()
        if (fresh) {
          this.port = fresh
        }
      }
      if (!this.port) {
        throw openError instanceof Error ? openError : new Error(String(openError))
      }
      await this.port.open(openOptions)
    }
  }

  static isSupported(): boolean {
    return getWebSerialNavigator() !== undefined
  }

  getStatus(): TransportStatus {
    return this.status
  }

  async connect(): Promise<void> {
    if (this.status.kind === 'connected') {
      return
    }
    // Dedupe concurrent connects so a second call awaits the in-flight
    // attempt rather than starting a second requestPort()/getReader().
    if (this.connectPromise) {
      return this.connectPromise
    }
    this.connectPromise = this.doConnect().finally(() => {
      this.connectPromise = undefined
    })
    return this.connectPromise
  }

  private async doConnect(): Promise<void> {
    const serial = getWebSerialNavigator()
    // Re-resolve a function-supplied port every connect so a fresh handle
    // is used instead of a stale one from a prior failed attempt; the
    // no-port manual path still falls through to requestPort() below. A
    // fixed concrete port is kept as-is.
    if (typeof this.options.port === 'function' || !this.port) {
      this.port = this.resolveOptionPort()
    }
    if (!this.port && !serial) {
      const error = new Error('Web Serial is not available in this browser.')
      this.updateStatus({ kind: 'error', message: error.message })
      throw error
    }

    this.updateStatus({ kind: 'connecting' })
    this.intentionalDisconnect = false

    let openedPort = false
    try {
      this.port = this.port ?? (await serial!.requestPort())
      // disconnect() can be called while requestPort()/open() is pending;
      // re-check so a resumed connect doesn't mark the transport
      // 'connected' over a link the user just dropped.
      if (this.intentionalDisconnect) {
        throw new Error('Web Serial connect aborted by disconnect.')
      }
      this.options.onPortSelected?.(this.port)
      await this.openPortWithStaleHandleRecovery()
      openedPort = true
      if (this.intentionalDisconnect) {
        throw new Error('Web Serial connect aborted by disconnect.')
      }

      if (!this.port.readable || !this.port.writable) {
        throw new Error('Selected serial port does not expose readable/writable streams.')
      }

      this.reader = this.port.readable.getReader()
      this.writer = this.port.writable.getWriter()
      this.updateStatus({ kind: 'connected' })
      this.readLoopPromise = this.readLoop()
    } catch (error) {
      this.reader?.releaseLock()
      this.writer?.releaseLock()
      this.reader = undefined
      this.writer = undefined

      if (openedPort) {
        await this.port?.close().catch(() => {})
      }

      // Drop a resolver-supplied handle so the next connect re-resolves a
      // fresh port instead of reusing this failed/stale one (no refresh).
      if (typeof this.options.port === 'function') {
        this.port = undefined
      }

      const message = error instanceof Error ? error.message : 'Unknown Web Serial error.'
      // A mid-connect disconnect already set the terminal status; don't
      // clobber 'disconnected' with 'error'.
      if (!this.intentionalDisconnect) {
        this.updateStatus({ kind: 'error', message })
      }
      throw error instanceof Error ? error : new Error(message)
    }
  }

  async disconnect(): Promise<void> {
    this.intentionalDisconnect = true
    await this.reader?.cancel().catch(() => {})
    this.reader?.releaseLock()
    this.writer?.releaseLock()
    this.reader = undefined
    this.writer = undefined
    // Let the read loop observe the cancel and fully exit before closing
    // the port — closing mid-read leaves the port half-closed and breaks
    // the next reconnect. Bounded so a stuck loop can't hang disconnect.
    if (this.readLoopPromise) {
      await Promise.race([
        this.readLoopPromise,
        new Promise<void>((resolve) => setTimeout(resolve, 1000))
      ]).catch(() => {})
      this.readLoopPromise = undefined
    }
    let reason = 'Serial port closed.'
    try {
      await this.port?.close()
    } catch (error) {
      // Surface a close failure in the reason rather than swallowing it.
      reason = `Serial port close failed: ${error instanceof Error ? error.message : 'unknown error'}`
    }
    // Drop a resolver-supplied handle so the next connect re-resolves a
    // fresh port rather than reusing this one across a disconnect.
    if (typeof this.options.port === 'function') {
      this.port = undefined
    }
    this.updateStatus({ kind: 'disconnected', reason })
  }

  async send(frame: Uint8Array): Promise<void> {
    if (!this.writer) {
      throw new Error('WebSerialTransport is not connected.')
    }

    try {
      await this.writer.write(frame)
    } catch (error) {
      // A write rejection mid-stream (e.g. device unplugged) must move the
      // status machine off 'connected'.
      const message = error instanceof Error ? error.message : 'Serial write failed.'
      if (!this.intentionalDisconnect) {
        this.updateStatus({ kind: 'error', message })
      }
      throw error instanceof Error ? error : new Error(message)
    }
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

  private async readLoop(): Promise<void> {
    while (this.reader) {
      try {
        const { value, done } = await this.reader.read()
        if (done) {
          break
        }
        if (!value) {
          continue
        }

        this.frameListeners.forEach((listener) => listener(value))
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown Web Serial error.'
        if (this.intentionalDisconnect) {
          break
        }

        if (isRecoverableWebSerialReadError(message) && this.port?.readable) {
          // Re-acquiring the reader can itself throw; catch so the failure
          // surfaces as a status transition rather than an unhandled
          // rejection escaping readLoop.
          try {
            this.reader?.releaseLock()
            this.reader = this.port.readable.getReader()
          } catch (reacquireError) {
            this.updateStatus({
              kind: 'error',
              message: reacquireError instanceof Error ? reacquireError.message : message
            })
            return
          }
          continue
        }

        this.updateStatus({
          kind: 'error',
          message
        })
        return
      }
    }

    if (!this.intentionalDisconnect && this.status.kind === 'connected') {
      this.updateStatus({ kind: 'disconnected', reason: 'Serial read loop ended.' })
    }
  }

  private updateStatus(status: TransportStatus): void {
    this.status = status
    this.statusListeners.forEach((listener) => listener(status))
  }
}

export function getWebSerialNavigator(): WebSerialNavigatorLike | undefined {
  const candidate = navigator as Navigator & { serial?: WebSerialNavigatorLike }
  return candidate.serial
}

export async function getAvailableWebSerialPorts(): Promise<WebSerialPortLike[]> {
  const serial = getWebSerialNavigator()
  if (!serial?.getPorts) {
    return []
  }

  return serial.getPorts()
}

export function getWebSerialPortInfo(port: WebSerialPortLike | undefined): WebSerialPortInfo | undefined {
  return port?.getInfo?.()
}

function isRecoverableWebSerialReadError(message: string): boolean {
  const normalized = message.toLowerCase()
  return normalized.includes('break received')
}
