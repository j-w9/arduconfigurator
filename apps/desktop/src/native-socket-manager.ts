import { TcpTransport, UdpTransport } from '@arduconfig/sitl-harness'
import type { Transport, TransportStatus } from '@arduconfig/transport'

// Main-process manager for native UDP/TCP MAVLink sockets, exposed to the
// renderer over IPC (see electron-main.ts). The Electron renderer can't open
// raw sockets — Direct Sockets is Isolated-Web-App-only — so the desktop app's
// UDP/TCP transports live here in Node and stream frames/status back to a
// renderer-side DesktopSocketTransport. Reuses the same sitl-harness
// UdpTransport / TcpTransport the bridge and SITL harness already use.

export type SocketKind = 'udp' | 'tcp'

export interface SocketOpenOptions {
  kind: SocketKind
  /** UDP bound/listen: local port to bind (e.g. 14550 for an ELRS feed). */
  localPort?: number
  /** UDP connected / TCP: fixed remote endpoint. */
  remoteHost?: string
  remotePort?: number
}

export interface SocketEventSink {
  onFrame(frame: Uint8Array): void
  onStatus(status: TransportStatus): void
}

interface SocketInstance {
  transport: Transport
  unsubscribers: Array<() => void>
}

export class NativeSocketManager {
  private readonly instances = new Map<string, SocketInstance>()

  async open(id: string, options: SocketOpenOptions, sink: SocketEventSink): Promise<void> {
    const transport = createSocketTransport(id, options)
    const unsubscribers = [
      transport.onFrame((frame) => sink.onFrame(frame)),
      transport.onStatus((status) => sink.onStatus(status))
    ]
    this.instances.set(id, { transport, unsubscribers })
    try {
      await transport.connect()
    } catch (error) {
      await this.close(id)
      throw error
    }
  }

  async send(id: string, frame: Uint8Array): Promise<void> {
    const instance = this.instances.get(id)
    if (!instance) {
      throw new Error(`Unknown native socket ${id}.`)
    }
    await instance.transport.send(frame)
  }

  async close(id: string): Promise<void> {
    const instance = this.instances.get(id)
    if (!instance) {
      return
    }
    this.instances.delete(id)
    for (const unsubscribe of instance.unsubscribers) {
      unsubscribe()
    }
    await instance.transport.disconnect().catch(() => {})
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.instances.keys()].map((id) => this.close(id)))
  }
}

function createSocketTransport(id: string, options: SocketOpenOptions): Transport {
  if (options.kind === 'tcp') {
    if (!options.remoteHost || options.remotePort === undefined) {
      throw new Error('TCP sockets need a remote host and port.')
    }
    return new TcpTransport(id, { host: options.remoteHost, port: options.remotePort })
  }

  // UDP: connected mode when a remote is given, otherwise bound/listen mode
  // that learns the peer from the first datagram (the ELRS / MP-UDP case).
  if (options.remoteHost && options.remotePort !== undefined) {
    return new UdpTransport(id, {
      bindHost: '0.0.0.0',
      bindPort: options.localPort ?? 0,
      remoteHost: options.remoteHost,
      remotePort: options.remotePort
    })
  }
  return new UdpTransport(id, { bindHost: '0.0.0.0', bindPort: options.localPort ?? 14550 })
}
