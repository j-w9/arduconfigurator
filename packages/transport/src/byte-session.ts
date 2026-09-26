// A raw byte session over a Web Serial port: write, then read exactly `n`
// bytes or time out.
//
// `Transport` is push-only — send() plus a callback firehose — which suits a
// self-delimiting protocol like MAVLink and does not suit a request/response
// one where a reply's length is computed from its own header. Bootloaders and
// the BLHeli 4-way interface are the latter: a missing reply has to surface as
// a timeout rather than hang, and the next fixed-width read must not be
// shifted by bytes left over from the last one.
//
// This was `WebSerialBootloaderSerial` in apps/web, where no package could
// reach it. It is unchanged in substance; what is new is that the baud is a
// parameter and that it can attach to a port the caller has already opened —
// needed when two protocols share one port in turn, as MSP and the ESC 4-way
// interface do across `enterPassthrough`.
//
// It deliberately does not import `BootloaderSerial` from
// `@arduconfig/firmware-flash`: this package has no dependencies, and the
// three-method shape is satisfied structurally.

import { release, withDeadline } from './deadline.js'
import type { WebSerialPortLike } from './web-serial-transport.js'

/** Buffer cap; the oldest bytes are dropped, so an abandoned session stays bounded. */
export const MAX_BUFFERED = 64 * 1024

/** A write to a working port takes under a millisecond; a second is generous. */
const WRITE_DEADLINE_MS = 1000

export interface WebSerialByteSessionOptions {
  /** Open the port at this baud. Ignored when `attach` is true. */
  baudRate?: number
  bufferSize?: number
  /**
   * Attach to a port the caller has already opened, and leave it open on
   * close(). Use this when another protocol opened the port and this session
   * is taking over the bytes rather than the port.
   */
  attach?: boolean
}

/**
 * Implements the `BootloaderSerial` shape (`write` / `read(n, timeoutMs)` /
 * `flushInput`) over a Web Serial port.
 */
export class WebSerialByteSession {
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null
  private buffer: Uint8Array = new Uint8Array(0)
  private closed = false
  private pumpError: Error | null = null
  private wakeups: Array<() => void> = []

  private constructor(
    private readonly port: WebSerialPortLike,
    private readonly ownsPort: boolean
  ) {}

  /** Open (or attach to) the port and start the read pump. */
  static async open(
    port: WebSerialPortLike,
    options: WebSerialByteSessionOptions = {}
  ): Promise<WebSerialByteSession> {
    const attach = options.attach ?? false
    if (!attach) {
      const baudRate = options.baudRate
      if (baudRate === undefined) {
        throw new Error('WebSerialByteSession.open: baudRate is required unless attaching')
      }
      await port.open(
        options.bufferSize === undefined ? { baudRate } : { baudRate, bufferSize: options.bufferSize }
      )
    }
    const session = new WebSerialByteSession(port, !attach)
    session.startPump()
    return session
  }

  private wake(): void {
    const pending = this.wakeups
    this.wakeups = []
    for (const resolve of pending) resolve()
  }

  // A single background loop owns the reader and continuously drains the
  // stream into `buffer`. This is what makes `flushInput()` correct (the
  // in-flight bytes it must discard are already pulled into `buffer`, so
  // clearing it actually drops them) and avoids the speculative
  // `Promise.race([reader.read(), timeout])` pattern, which abandoned a
  // pending read on timeout and could let it swallow a later reply.
  private startPump(): void {
    if (!this.port.readable) {
      this.pumpError = new Error('serial port not readable')
      this.closed = true
      return
    }
    const reader = this.port.readable.getReader()
    this.reader = reader
    void (async () => {
      try {
        for (;;) {
          const { value, done } = await reader.read()
          if (done) break
          if (value && value.length > 0) {
            const merged = new Uint8Array(this.buffer.length + value.length)
            merged.set(this.buffer)
            merged.set(value, this.buffer.length)
            // Keep only the newest MAX_BUFFERED bytes.
            this.buffer =
              merged.length > MAX_BUFFERED ? merged.slice(merged.length - MAX_BUFFERED) : merged
            this.wake()
          }
        }
      } catch (error) {
        this.pumpError = error instanceof Error ? error : new Error('serial read pump failed')
      } finally {
        this.closed = true
        this.wake()
      }
    })()
  }

  /** Write with a deadline: a device that stops reading never accepts the bytes. */
  async write(data: Uint8Array): Promise<void> {
    if (!this.port.writable) throw new Error('serial port not writable')
    const writer = this.port.writable.getWriter()
    try {
      await withDeadline(writer.write(data), WRITE_DEADLINE_MS, 'writing to the port')
    } finally {
      try {
        writer.releaseLock()
      } catch {
        // A timed-out write still holds the lock: leak it rather than throw.
      }
    }
  }

  async read(n: number, timeoutMs: number): Promise<Uint8Array> {
    const deadline = Date.now() + timeoutMs
    while (this.buffer.length < n) {
      if (this.pumpError) throw this.pumpError
      if (this.closed) throw new Error('serial port closed mid-read')
      const remaining = deadline - Date.now()
      if (remaining <= 0) throw new Error(`serial read timed out waiting for ${n} bytes`)
      let timer: ReturnType<typeof setTimeout> | undefined
      await new Promise<void>((resolve) => {
        this.wakeups.push(resolve)
        timer = setTimeout(resolve, remaining)
      })
      if (timer) clearTimeout(timer)
    }
    // Return a COPY, not a subarray view: brick-class callers (verify()
    // reads 4 CRC bytes, then getSync() reads more before using them)
    // must not have already-read protocol bytes mutate underneath them.
    const out = this.buffer.slice(0, n)
    this.buffer = this.buffer.slice(n)
    return out
  }

  async flushInput(): Promise<void> {
    // Give the pump a turn to pull anything already sitting in the stream
    // (an async boot banner / the tail of a prior reply) into `buffer`, then
    // drop the lot. Clearing alone left those in-flight bytes to shift the
    // next fixed-width read.
    await new Promise((resolve) => setTimeout(resolve, 0))
    this.buffer = new Uint8Array(0)
  }

  /**
   * Stop pumping and release the reader, each step time-limited. The port is
   * closed only if this session opened it.
   */
  async close(): Promise<void> {
    this.closed = true
    try {
      if (this.reader) {
        const reader = this.reader
        this.reader = null
        await release(() => reader.cancel())
        try {
          reader.releaseLock()
        } catch {
          // The cancel above may have timed out and still hold it.
        }
      }
    } finally {
      this.wake()
      if (this.ownsPort) {
        await release(() => this.port.close())
      }
    }
  }
}
