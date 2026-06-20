// Browser glue between a raw Web Serial port and the firmware-flash
// package's transport-agnostic BootloaderSerial. The bootloader speaks
// raw bytes (NOT MAVLink), so this bypasses the normal Transport and
// drives the port directly at the bootloader baud.

import { MAX_FIRMWARE_IMAGE_BYTES, type BootloaderSerial } from '@arduconfig/firmware-flash'
import type { WebSerialPortLike } from '@arduconfig/transport'

const BOOTLOADER_BAUD = 115200

/** Inflate a zlib stream (.apj `image`) using the browser DecompressionStream. */
export async function inflateZlib(zlibBytes: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('This browser lacks DecompressionStream; firmware decode unavailable')
  }
  // Pump DecompressionStream manually rather than Blob/pipeThrough: the
  // latter trips a known @types/node generic-Uint8Array vs lib.dom
  // stream-types incompatibility. DecompressionStream is Uint8Array
  // in/out at runtime; this path is fully typed with no casts.
  const ds = new DecompressionStream('deflate') // zlib-wrapped deflate
  const writer = ds.writable.getWriter()
  // Feed a fresh plain ArrayBuffer (unambiguously BufferSource) — passing
  // the Uint8Array directly hits the @types/node generic-Uint8Array vs
  // lib.dom BufferSource mismatch.
  void writer.write(zlibBytes.slice().buffer)
  void writer.close()
  const reader = ds.readable.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    if (value && value.length > 0) {
      total += value.length
      if (total > MAX_FIRMWARE_IMAGE_BYTES) {
        // Decompression bomb: a tiny (proxy-served) zlib stream inflating
        // past any real firmware size. Abort the pump rather than keep
        // accumulating into OOM.
        await reader.cancel().catch(() => undefined)
        throw new Error(
          `Firmware image exceeds the ${MAX_FIRMWARE_IMAGE_BYTES}-byte safety cap during decompression`
        )
      }
      chunks.push(value)
    }
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}

/**
 * EXPERIMENTAL: the classic 1200-baud "touch" — open the running-firmware
 * port at 1200 bps then close it. Most ChibiOS/ArduPilot boards reboot
 * into their USB bootloader on this (the same trick browser flash tools
 * and Arduino use). After this the board RE-ENUMERATES as the bootloader
 * USB device, so the original port handle is dead — the caller must pick
 * the bootloader port afresh on the next Detect. Not hardware-validated
 * in this environment; the manual entry (hold DFU / replug) stays the
 * primary path.
 */
export async function bootloaderTouch1200(port: WebSerialPortLike): Promise<void> {
  try {
    await port.open({ baudRate: 1200 })
  } catch (error) {
    throw new Error(
      `could not open the port for a 1200-baud touch (${
        error instanceof Error ? error.message : 'unknown error'
      }) — it may already be open; use manual entry (hold the DFU/bootloader button while plugging in)`
    )
  }
  await new Promise((resolve) => setTimeout(resolve, 250))
  await port.close().catch(() => undefined)
}

/**
 * BootloaderSerial over an open Web Serial port. `read(n, timeoutMs)`
 * accumulates inbound chunks until `n` bytes are available or the
 * timeout elapses (the bootloader is request/response, so a missing
 * reply must surface as a timeout rather than hang the flash).
 */
export class WebSerialBootloaderSerial implements BootloaderSerial {
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null
  private buffer: Uint8Array = new Uint8Array(0)
  private closed = false
  private pumpError: Error | null = null
  private wakeups: Array<() => void> = []

  private constructor(private readonly port: WebSerialPortLike) {}

  /** Open the port at the bootloader baud and start the read pump. */
  static async open(port: WebSerialPortLike): Promise<WebSerialBootloaderSerial> {
    await port.open({ baudRate: BOOTLOADER_BAUD })
    const serial = new WebSerialBootloaderSerial(port)
    serial.startPump()
    return serial
  }

  private wake(): void {
    const pending = this.wakeups
    this.wakeups = []
    for (const resolve of pending) resolve()
  }

  // A single background loop owns the reader and continuously drains the
  // stream into `buffer`. This is what makes `flushInput()` correct (the
  // in-flight bytes it must discard are already pulled into `buffer`, so
  // clearing it actually drops them) and removes the old speculative
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
            this.buffer = merged
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

  async write(data: Uint8Array): Promise<void> {
    if (!this.port.writable) throw new Error('serial port not writable')
    const writer = this.port.writable.getWriter()
    try {
      await writer.write(data)
    } finally {
      writer.releaseLock()
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
    // (an async ChibiOS boot banner / the tail of a prior reply) into
    // `buffer`, then drop the lot. Clearing alone left those in-flight
    // bytes to shift the next fixed-width board-id/CRC read.
    await new Promise((resolve) => setTimeout(resolve, 0))
    this.buffer = new Uint8Array(0)
  }

  async close(): Promise<void> {
    this.closed = true
    try {
      if (this.reader) {
        await this.reader.cancel().catch(() => undefined)
        this.reader.releaseLock()
        this.reader = null
      }
    } finally {
      this.wake()
      await this.port.close().catch(() => undefined)
    }
  }
}
