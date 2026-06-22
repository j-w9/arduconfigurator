import type { FrameListener, StatusListener, Transport, TransportStatus, Unsubscribe } from '@arduconfig/transport'

import type { DesktopSocketApi, DesktopSocketOpenOptions } from './desktop-bridge'

// Renderer-side Transport for the desktop app's native UDP/TCP sockets. The
// Electron renderer can't open raw sockets, so this drives a main-process
// UdpTransport/TcpTransport over the preload `socket` IPC bridge: open() starts
// it in the main process, frames/status stream back, send() relays outbound
// frames. Mirrors the Transport contract the runtime already consumes, so it
// drops into createRuntime exactly like the other transports.

export interface DesktopSocketTransportOptions extends DesktopSocketOpenOptions {
  bridge: DesktopSocketApi
}

let socketCounter = 0

export class DesktopSocketTransport implements Transport {
  readonly kind: 'udp' | 'tcp'
  readonly id: string

  private readonly frameListeners = new Set<FrameListener>()
  private readonly statusListeners = new Set<StatusListener>()
  private readonly bridge: DesktopSocketApi
  private readonly openOptions: DesktopSocketOpenOptions
  /** Client-generated id, used so we can subscribe BEFORE opening (no frame race). */
  private readonly socketId: string

  private status: TransportStatus = { kind: 'idle' }
  private unsubscribe?: () => void
  private connectPromise?: Promise<void>

  constructor(id: string, options: DesktopSocketTransportOptions) {
    this.id = id
    this.kind = options.kind
    this.bridge = options.bridge
    this.openOptions = {
      kind: options.kind,
      localPort: options.localPort,
      remoteHost: options.remoteHost,
      remotePort: options.remotePort
    }
    this.socketId = `${id}-${++socketCounter}-${Math.round(performance.now())}`
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
    // Subscribe before opening so no inbound frame/status is missed in the
    // window between the main socket binding and our listener attaching.
    this.unsubscribe = this.bridge.subscribe(
      this.socketId,
      (frame) => {
        const copy = frame instanceof Uint8Array ? frame.slice() : new Uint8Array(frame)
        this.frameListeners.forEach((listener) => listener(copy))
      },
      (status) => {
        this.updateStatus(status as TransportStatus)
      }
    )
    try {
      await this.bridge.open(this.socketId, this.openOptions)
      if (this.status.kind !== 'connected') {
        this.updateStatus({ kind: 'connected' })
      }
    } catch (error) {
      this.unsubscribe?.()
      this.unsubscribe = undefined
      const message = error instanceof Error ? error.message : 'Failed to open native socket.'
      this.updateStatus({ kind: 'error', message })
      throw error instanceof Error ? error : new Error(message)
    }
  }

  async disconnect(): Promise<void> {
    if (this.connectPromise) {
      await this.connectPromise.catch(() => undefined)
    }
    this.unsubscribe?.()
    this.unsubscribe = undefined
    await this.bridge.close(this.socketId).catch(() => {})
    this.updateStatus({ kind: 'disconnected', reason: 'Native socket closed.' })
  }

  async send(frame: Uint8Array): Promise<void> {
    await this.bridge.send(this.socketId, frame)
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
