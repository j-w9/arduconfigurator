// Browser glue between a raw Web Serial port and the firmware-flash
// package's transport-agnostic BootloaderSerial. The bootloader speaks
// raw bytes (NOT MAVLink), so this bypasses the normal Transport and
// drives the port directly at the bootloader baud.

import { MAX_FIRMWARE_IMAGE_BYTES } from '@arduconfig/firmware-flash'
import { WebSerialByteSession, type WebSerialPortLike } from '@arduconfig/transport'

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
 * BootloaderSerial over an open Web Serial port, at the ArduPilot bootloader
 * baud.
 *
 * The pump itself now lives in `@arduconfig/transport` as
 * `WebSerialByteSession`, so other products can use it. This is the binding
 * layer that holds this app's baud, the same way `theme.ts` holds this app's
 * storage key — so no call site here had to change.
 */
export type WebSerialBootloaderSerial = WebSerialByteSession

export const WebSerialBootloaderSerial = {
  /** Open the port at the bootloader baud and start the read pump. */
  open: (port: WebSerialPortLike): Promise<WebSerialByteSession> =>
    WebSerialByteSession.open(port, { baudRate: BOOTLOADER_BAUD })
}
