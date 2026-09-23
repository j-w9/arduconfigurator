import type { FrameListener, StatusListener, Transport, TransportStatus, Unsubscribe } from './types.js'

/**
 * The Emscripten module ArduPilot's `--board wasm` build produces.
 *
 * Only the parts used here are described. `cwrap` and `HEAPU8` are
 * Emscripten's own; the five `ardupilot_*` functions are ArduPilot's, exported
 * with EMSCRIPTEN_KEEPALIVE from AP_HAL_SITL/UARTDriver.cpp.
 */
export interface ArduPilotWasmModule {
  cwrap(name: string, returnType: string | null, argTypes: string[]): (...args: number[]) => number
  readonly HEAPU8: Uint8Array
}

export type ArduPilotWasmFactory = (options: {
  arguments: string[]
  print?: (line: string) => void
  printErr?: (line: string) => void
}) => Promise<ArduPilotWasmModule>

export interface WasmSitlTransportOptions {
  /**
   * Loads the Emscripten factory, normally a dynamic import of the built
   * `arducopter.js`. A function rather than a URL so the caller decides how
   * the module is fetched -- and so tests can hand over a stub without a
   * network or a real 3.4 MB binary.
   */
  readonly loadModule: () => Promise<ArduPilotWasmFactory>
  /**
   * SITL's own command line: `--model quad`, `--speedup 5`, a home location.
   * `--serial0 wasm` is added here, because that is what routes the MAVLink
   * console to the read/write exports rather than to a socket the browser
   * has no way to open.
   */
  readonly args?: readonly string[]
  /** Which SITL serial port to read and write. SERIAL0 is the console. */
  readonly serialPort?: number
  /** How often to drain the module's output buffer. */
  readonly pollIntervalMs?: number
  /** Console output from SITL itself, which the UI shows while it boots. */
  readonly onOutput?: (line: string) => void
  readonly id?: string
}

/** Big enough for a burst of MAVLink without being re-allocated per poll. */
const READ_BUFFER_BYTES = 16384

/**
 * ArduPilot SITL compiled to WebAssembly, as a transport.
 *
 * The vehicle firmware runs in this tab. There is no process, no socket and no
 * bridge: `--serial0 wasm` routes SITL's MAVLink console to a pair of exported
 * functions, and this reads and writes them on a timer. Everything above --
 * the MAVLink codec, the parameter model, the whole app -- sees an ordinary
 * byte stream and cannot tell the difference.
 *
 * The one real constraint is that the module is single-threaded and shares
 * this tab's main thread, so a slow poll here shows up as a slow vehicle.
 */
export class WasmSitlTransport implements Transport {
  // Deliberately reported as 'tcp': everything above treats SITL over a socket
  // exactly the same way, and inventing a kind would mean touching every
  // switch that handles a transport without changing what any of them do.
  readonly kind = 'tcp' as const
  readonly id: string

  private readonly frameListeners = new Set<FrameListener>()
  private readonly statusListeners = new Set<StatusListener>()
  private readonly options: WasmSitlTransportOptions

  private status: TransportStatus = { kind: 'idle' }
  private module?: ArduPilotWasmModule
  private read?: (port: number, buffer: number, max: number) => number
  private write?: (port: number, buffer: number, length: number) => number
  private free?: (pointer: number) => number
  private readBuffer = 0
  private writeBuffer = 0
  private writeBufferBytes = 0
  private timer?: ReturnType<typeof setInterval>
  /** Shared by concurrent connect() calls so one tab never boots two vehicles. */
  private pending?: Promise<void>

  constructor(options: WasmSitlTransportOptions) {
    this.options = options
    this.id = options.id ?? 'wasm-sitl'
  }

  getStatus(): TransportStatus {
    return this.status
  }

  async connect(): Promise<void> {
    if (this.status.kind === 'connected') return
    if (this.pending) return this.pending
    this.pending = this.boot().finally(() => {
      this.pending = undefined
    })
    return this.pending
  }

  private async boot(): Promise<void> {
    this.updateStatus({ kind: 'connecting' })
    try {
      const createModule = await this.options.loadModule()
      const module = await createModule({
        // --serial0 wasm is not optional: without it SITL tries to open a
        // socket, which in a browser silently produces a vehicle that never
        // says anything.
        arguments: ['--serial0', 'wasm', ...(this.options.args ?? [])],
        print: (line) => this.options.onOutput?.(line),
        printErr: (line) => this.options.onOutput?.(line)
      })

      const malloc = module.cwrap('ardupilot_malloc', 'number', ['number'])
      this.module = module
      this.read = module.cwrap('ardupilot_serial_read', 'number', ['number', 'number', 'number'])
      this.write = module.cwrap('ardupilot_serial_write', 'number', ['number', 'number', 'number'])
      this.free = module.cwrap('ardupilot_free', null, ['number']) as (pointer: number) => number
      this.readBuffer = malloc(READ_BUFFER_BYTES)

      this.updateStatus({ kind: 'connected' })
      this.timer = setInterval(() => this.drain(), this.options.pollIntervalMs ?? 10)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.updateStatus({ kind: 'error', message: `WASM SITL failed to start: ${message}` })
      throw error
    }
  }

  async disconnect(): Promise<void> {
    if (this.timer !== undefined) {
      clearInterval(this.timer)
      this.timer = undefined
    }
    // The buffers are freed but the module is not torn down: Emscripten has no
    // general way to unload one, and the vehicle stops mattering once nothing
    // is draining it. A fresh connect() builds a new module.
    if (this.free) {
      if (this.readBuffer) this.free(this.readBuffer)
      if (this.writeBuffer) this.free(this.writeBuffer)
    }
    this.readBuffer = 0
    this.writeBuffer = 0
    this.writeBufferBytes = 0
    this.module = undefined
    this.read = undefined
    this.write = undefined
    this.updateStatus({ kind: 'disconnected' })
  }

  async send(frame: Uint8Array): Promise<void> {
    const module = this.module
    const write = this.write
    if (!module || !write || this.status.kind !== 'connected') {
      throw new Error('WASM SITL transport is not connected.')
    }
    if (frame.length === 0) return

    const buffer = this.ensureWriteBuffer(module, frame.length)
    module.HEAPU8.set(frame, buffer)
    write(this.options.serialPort ?? 0, buffer, frame.length)
  }

  /**
   * A write buffer that grows to the largest frame seen and is then reused.
   *
   * Allocating per send would churn the heap on every parameter write, and
   * MAVLink frames are small and bounded.
   */
  private ensureWriteBuffer(module: ArduPilotWasmModule, bytes: number): number {
    if (this.writeBuffer && this.writeBufferBytes >= bytes) return this.writeBuffer
    const malloc = module.cwrap('ardupilot_malloc', 'number', ['number'])
    if (this.writeBuffer && this.free) this.free(this.writeBuffer)
    this.writeBuffer = malloc(bytes)
    this.writeBufferBytes = bytes
    return this.writeBuffer
  }

  private drain(): void {
    const module = this.module
    const read = this.read
    if (!module || !read || !this.readBuffer) return

    // Read until the module has nothing more, so a burst is delivered in the
    // same tick rather than one bufferful per poll interval.
    for (;;) {
      const length = read(this.options.serialPort ?? 0, this.readBuffer, READ_BUFFER_BYTES)
      if (length <= 0) return
      // Copied out of the heap before anyone sees it: HEAPU8 is a view over
      // memory the module will overwrite on the next read, and may detach
      // entirely if the heap grows.
      const frame = module.HEAPU8.slice(this.readBuffer, this.readBuffer + length)
      for (const listener of this.frameListeners) listener(frame)
      if (length < READ_BUFFER_BYTES) return
    }
  }

  onFrame(listener: FrameListener): Unsubscribe {
    this.frameListeners.add(listener)
    return () => this.frameListeners.delete(listener)
  }

  onStatus(listener: StatusListener): Unsubscribe {
    this.statusListeners.add(listener)
    return () => this.statusListeners.delete(listener)
  }

  private updateStatus(status: TransportStatus): void {
    this.status = status
    for (const listener of this.statusListeners) listener(status)
  }
}
