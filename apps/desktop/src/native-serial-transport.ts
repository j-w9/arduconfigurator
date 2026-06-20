import { SerialPort } from 'serialport'

import type { FrameListener, StatusListener, Transport, TransportStatus, Unsubscribe } from '@arduconfig/transport'

export interface NativeSerialTransportOptions {
  path: string
  baudRate: number
}

export interface NativeSerialTransportDependencies {
  createPort?: (options: NativeSerialTransportOptions & { autoOpen: false }) => NativeSerialPort
}

export interface NativeSerialPortInfo {
  path: string
  manufacturer?: string
  serialNumber?: string
  vendorId?: string
  productId?: string
}

interface NativeSerialPort {
  readonly isOpen: boolean
  on(event: 'data', listener: (data: Buffer) => void): unknown
  on(event: 'error', listener: (error: Error) => void): unknown
  on(event: 'close', listener: () => void): unknown
  open(callback: (error: Error | null | undefined) => void): void
  close(callback: (error: Error | null | undefined) => void): void
  write(data: Buffer, callback: (error: Error | null | undefined) => void): void
}

export class NativeSerialTransport implements Transport {
  readonly id: string
  readonly kind = 'native-serial' as const

  private readonly frameListeners = new Set<FrameListener>()
  private readonly statusListeners = new Set<StatusListener>()
  private readonly options: NativeSerialTransportOptions
  private readonly createPort: (options: NativeSerialTransportOptions & { autoOpen: false }) => NativeSerialPort

  private status: TransportStatus = { kind: 'idle' }
  private port?: NativeSerialPort
  /**
   * audit-34: idempotency latch for connect(). Without this, a second
   * connect() call while the first port.open() is still in flight
   * built a SECOND SerialPort, attached duplicate data/error/close
   * listeners, and left this.port pointing at whichever set finished
   * last — the older port's handlers kept mutating status invisibly.
   * Same fix pattern as WebSerialTransport (always had it) and
   * WebSocketTransport (audit-33).
   */
  private connectPromise?: Promise<void>
  /**
   * audit-38: symmetric pair to connectPromise — true while a disconnect
   * is in progress, used by doConnect() to abort BEFORE marking the
   * transport `connected` (and before runtime listeners trigger startup
   * traffic). Same pattern as WebSerialTransport's intentionalDisconnect.
   */
  private intentionalDisconnect = false

  constructor(id: string, options: NativeSerialTransportOptions, dependencies: NativeSerialTransportDependencies = {}) {
    this.id = id
    this.options = options
    this.createPort =
      dependencies.createPort ??
      ((serialOptions) =>
        new SerialPort({
          path: serialOptions.path,
          baudRate: serialOptions.baudRate,
          autoOpen: serialOptions.autoOpen
        }))
  }

  static async listPorts(): Promise<NativeSerialPortInfo[]> {
    const ports = await SerialPort.list()
    return ports.map((port) => ({
      path: port.path,
      manufacturer: port.manufacturer ?? undefined,
      serialNumber: port.serialNumber ?? undefined,
      vendorId: port.vendorId ?? undefined,
      productId: port.productId ?? undefined
    }))
  }

  getStatus(): TransportStatus {
    return this.status
  }

  async connect(): Promise<void> {
    if (this.port?.isOpen) {
      return
    }
    // audit-34: if a connect is already in flight, return its promise so
    // concurrent callers settle off the same single SerialPort. Without
    // this, the second call rebuilds the port and silently leaks the
    // first port's data/error/close listeners.
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
    // audit-38: reset for THIS attempt — a previous aborted connect may
    // have left the flag true. Cleared here so a subsequent legitimate
    // connect doesn't immediately self-abort.
    this.intentionalDisconnect = false

    let port: NativeSerialPort
    try {
      port = this.createPort({
        path: this.options.path,
        baudRate: this.options.baudRate,
        autoOpen: false
      })

      await new Promise<void>((resolve, reject) => {
        port.open((error) => {
          if (error) {
            reject(error)
            return
          }
          resolve()
        })
      })

      // audit-38: disconnect() may have flipped intentionalDisconnect while
      // port.open() was in flight. Close the just-opened port and bail
      // before attaching runtime listeners / marking connected — otherwise
      // the runtime starts sending HEARTBEATs over a link the user just
      // cancelled.
      if (this.intentionalDisconnect) {
        await new Promise<void>((resolve) => {
          port.close(() => resolve())
        })
        throw new Error('NativeSerial connect aborted by disconnect.')
      }
    } catch (error) {
      this.port = undefined
      const message = error instanceof Error ? error.message : 'Unknown native serial error.'
      // audit-38: if disconnect() triggered the abort, don't clobber the
      // 'disconnected' status the disconnect() path is about to emit with
      // an 'error' status. Same gating as WebSerialTransport.
      if (!this.intentionalDisconnect) {
        this.updateStatus({ kind: 'error', message })
      }
      throw error instanceof Error ? error : new Error(message)
    }

    port.on('data', (data: Buffer) => {
      this.frameListeners.forEach((listener) => listener(new Uint8Array(data)))
    })
    port.on('error', (error: Error) => {
      this.updateStatus({ kind: 'error', message: error.message })
    })
    port.on('close', () => {
      if (this.status.kind === 'connected') {
        this.updateStatus({ kind: 'disconnected', reason: 'Serial port closed.' })
      }
    })

    this.port = port
    this.updateStatus({ kind: 'connected' })
  }

  async disconnect(): Promise<void> {
    // audit-38: flip the flag FIRST so any in-flight doConnect that
    // resumes after port.open() will self-abort instead of marking
    // 'connected'. Then wait for the connect to settle so we know
    // whether there's a port to close.
    this.intentionalDisconnect = true
    if (this.connectPromise) {
      // catch — the aborted connect rejects with "aborted by disconnect"
      // (our own throw) or a genuine open() error; either way the
      // disconnect path shouldn't surface it.
      await this.connectPromise.catch(() => undefined)
    }
    // audit-38: capture + clear port BEFORE awaiting close() so a
    // concurrent disconnect() short-circuits on the cleared field and
    // we never double-close the same port (node-serialport throws
    // "Port is not open" on a second close).
    const port = this.port
    this.port = undefined
    if (!port) {
      // audit-38: emit terminal status even when there was no port to
      // close — covers both the legitimate "disconnect from idle" case
      // and the abort-during-connect case (where status was last set to
      // 'connecting' and would otherwise be stuck there). Matches the
      // already-disconnected emit pattern in Tcp/UdpTransport.
      this.updateStatus({ kind: 'disconnected', reason: 'NativeSerial transport already disconnected.' })
      return
    }

    await new Promise<void>((resolve, reject) => {
      port.close((error) => {
        if (error) {
          reject(error)
          return
        }
        resolve()
      })
    })

    this.updateStatus({ kind: 'disconnected', reason: 'Serial port closed.' })
  }

  async send(frame: Uint8Array): Promise<void> {
    if (!this.port?.isOpen) {
      throw new Error('NativeSerialTransport is not connected.')
    }

    await new Promise<void>((resolve, reject) => {
      this.port!.write(Buffer.from(frame), (error) => {
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
