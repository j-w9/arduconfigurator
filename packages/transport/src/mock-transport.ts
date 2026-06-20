import type {
  FrameListener,
  MockTransportOptions,
  StatusListener,
  Transport,
  TransportStatus,
  Unsubscribe,
} from './types.js'

const DEFAULT_STATUS: TransportStatus = { kind: 'idle' }

export class MockTransport implements Transport {
  readonly id: string
  readonly kind = 'mock' as const

  private readonly frameListeners = new Set<FrameListener>()
  private readonly statusListeners = new Set<StatusListener>()
  private readonly outboundFramesLog: Uint8Array[] = []
  private readonly options: Required<Omit<MockTransportOptions, 'dynamicEmitter'>> & {
    dynamicEmitter: NonNullable<MockTransportOptions['dynamicEmitter']> | undefined
  }
  private readonly pendingTimers = new Set<ReturnType<typeof setTimeout>>()

  private status: TransportStatus = DEFAULT_STATUS
  private isConnected = false
  private nextInboundChunkAtMs = 0
  private dynamicEmitterCleanup: (() => void) | undefined

  constructor(id: string, options: MockTransportOptions = {}) {
    this.id = id
    this.options = {
      initialFrames: options.initialFrames ?? [],
      frameIntervalMs: options.frameIntervalMs ?? 150,
      responseDelayMs: options.responseDelayMs ?? 80,
      chunkSize: options.chunkSize ?? 0,
      respondToOutbound: options.respondToOutbound ?? (() => []),
      dynamicEmitter: options.dynamicEmitter
    }
  }

  getStatus(): TransportStatus {
    return this.status
  }

  async connect(): Promise<void> {
    if (this.isConnected) {
      return
    }

    this.updateStatus({ kind: 'connecting' })
    this.isConnected = true
    this.nextInboundChunkAtMs = Date.now()
    this.updateStatus({ kind: 'connected' })

    this.options.initialFrames.forEach((frame, index) => {
      this.queueInboundFrame(frame, this.options.frameIntervalMs * index)
    })

    if (this.options.dynamicEmitter) {
      this.dynamicEmitterCleanup = this.options.dynamicEmitter((frame) => {
        if (!this.isConnected) {
          return
        }
        this.queueInboundFrame(frame, 0)
      })
    }
  }

  async disconnect(): Promise<void> {
    if (this.dynamicEmitterCleanup) {
      try {
        this.dynamicEmitterCleanup()
      } finally {
        this.dynamicEmitterCleanup = undefined
      }
    }
    this.pendingTimers.forEach((timer) => clearTimeout(timer))
    this.pendingTimers.clear()
    this.isConnected = false
    this.nextInboundChunkAtMs = 0
    this.updateStatus({ kind: 'disconnected', reason: 'Mock transport disconnected.' })
  }

  async send(frame: Uint8Array): Promise<void> {
    this.outboundFramesLog.push(frame)
    const responseFrames = await this.options.respondToOutbound(frame)
    responseFrames.forEach((responseFrame, index) => {
      this.queueInboundFrame(responseFrame, this.options.responseDelayMs + this.options.frameIntervalMs * index)
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

  outboundFrames(): Uint8Array[] {
    return [...this.outboundFramesLog]
  }

  private queueInboundFrame(frame: Uint8Array, delayMs: number): void {
    const chunks = chunkFrame(frame, this.options.chunkSize)
    const chunkSpacingMs = 2
    const earliestStartAtMs = Date.now() + Math.max(delayMs, 0)

    // The monotonic cursor (`nextInboundChunkAtMs`) globally serializes chunk
    // delivery so the bytes of different frames can never interleave in the
    // single byte stream feeding the codec. That serialization is only required
    // when a frame is split into multiple chunks (chunkSize > 0) — with
    // whole-frame delivery (the default, and every demo/e2e transport) each
    // frame is atomic and cannot interleave, so the cursor buys nothing there.
    //
    // Worse, for whole frames the cursor actively breaks realism: the
    // connect-time parameter-sync batch is solicited (a respondToOutbound reply
    // to PARAM_REQUEST_LIST), so it pushes the shared cursor far into the future,
    // and any *later* solicited response — a post-connect LOG_REQUEST_LIST reply
    // or a command ACK — was queued behind that entire residual backlog and
    // starved under load. (This is why the documented stream-vs-solicited
    // two-cursor idea could not fix it: param-sync is itself solicited.) Gating
    // the cursor on chunkSize sidesteps the chunk-interleave risk by construction
    // while letting whole-frame solicited responses arrive at their own offset.
    // Order within a single response is still preserved: its frame delays
    // increase with index.
    const serializeChunks = this.options.chunkSize > 0
    const startAtMs = serializeChunks
      ? Math.max(earliestStartAtMs, this.nextInboundChunkAtMs)
      : earliestStartAtMs

    chunks.forEach((chunk, index) => {
      const scheduledAtMs = startAtMs + index * chunkSpacingMs
      const timer = setTimeout(() => {
        this.pendingTimers.delete(timer)
        if (!this.isConnected) {
          return
        }

        this.frameListeners.forEach((listener) => listener(chunk))
      }, Math.max(0, scheduledAtMs - Date.now()))

      this.pendingTimers.add(timer)
    })

    if (serializeChunks) {
      this.nextInboundChunkAtMs = startAtMs + chunks.length * chunkSpacingMs
    }
  }

  private updateStatus(status: TransportStatus): void {
    this.status = status
    this.statusListeners.forEach((listener) => listener(status))
  }
}

function chunkFrame(frame: Uint8Array, chunkSize: number): Uint8Array[] {
  if (chunkSize <= 0 || frame.length <= chunkSize) {
    return [frame]
  }

  const chunks: Uint8Array[] = []
  for (let index = 0; index < frame.length; index += chunkSize) {
    chunks.push(frame.slice(index, index + chunkSize))
  }
  return chunks
}
