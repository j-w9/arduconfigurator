// ELRS receiver flashing over the FC's transparent SERIAL_PASS bridge, using
// Espressif's browser esptool (esptool-js). The FC forwards the host USB-CDC
// baud onto the RC UART, so we open the SAME Web Serial port at the flashing
// baud and drive the ESP directly.
//
// HARDWARE-UNVALIDATED: the byte sequences + esptool wiring follow ExpressLRS's
// BFinitPassthrough and esptool-js's API, but the end-to-end flash can only be
// confirmed on a real ESP-based RX. Kept behind the Expert + detection gate and
// unshipped until bench-verified (validation ladder rung 5).

import { ESPLoader, Transport } from 'esptool-js'

import type { WebSerialPortLike } from '@arduconfig/transport'

import { buildElrsBootloaderCommand, espSyncTraining } from '../view-models/elrs-bootloader'

// esptool-js's Transport is typed against the DOM `SerialPort`; the app carries
// the structurally-compatible `WebSerialPortLike`. Cast at the boundary.
type EsptoolSerialPort = ConstructorParameters<typeof Transport>[0]

export interface ElrsFlashProgress {
  phase: 'bootloader' | 'connect' | 'flash' | 'done'
  written?: number
  total?: number
  message?: string
}

// The two bauds are DIFFERENT and must be decoupled (verified on real hardware,
// iFlight ESP8285 nano through an ArduPilot SERIAL_PASS bridge):
//  - the CRSF "enter bootloader" command is parsed by the RUNNING ELRS firmware,
//    so it must go at the RC link's CRSF baud (420000 default);
//  - esptool then syncs+flashes the ESP ROM bootloader at 115200. Higher bauds
//    (esptool's changeBaud to 230400/420000) fail through the FC bridge with
//    "No serial data received"; 115200 works reliably.
export const ELRS_CRSF_BOOTLOADER_BAUD = 420000
export const ELRS_ESPTOOL_BAUD = 115200

export interface ElrsFlashInput {
  /** The live Web Serial port (already released by the MAVLink transport). */
  port: WebSerialPortLike
  /** The ELRS firmware image to write. */
  firmware: Uint8Array
  /** The receiver's CRSF link baud for the bootloader-jump command (the running
   *  firmware parses it at this baud). Defaults to 420000. esptool always runs
   *  at 115200 regardless. */
  crsfBaud?: number
  onProgress?: (progress: ElrsFlashProgress) => void
  onLog?: (line: string) => void
}

/**
 * Put the RX into its ESP ROM bootloader by sending the CRSF "enter bootloader"
 * command + the ROM autobaud training over the bridge, then close the port. The
 * ESP stays in its bootloader across a host-side close (the FC bridge holds),
 * so esptool can reopen and sync.
 */
async function sendElrsBootloaderJump(port: WebSerialPortLike, baudRate: number): Promise<void> {
  await port.open({ baudRate })
  try {
    const writer = port.writable?.getWriter()
    if (!writer) {
      throw new Error('serial port is not writable for the bootloader jump')
    }
    try {
      await writer.write(buildElrsBootloaderCommand())
      await writer.write(espSyncTraining())
    } finally {
      writer.releaseLock()
    }
    // Give the RX firmware a moment to reboot into the ROM bootloader.
    await new Promise((resolve) => setTimeout(resolve, 500))
  } finally {
    await port.close().catch(() => undefined)
  }
}

/**
 * Flash an ESP-based ExpressLRS receiver through the (already-open) FC serial
 * pass-through bridge. The caller must have armed the bridge (SERIAL_PASS2) and
 * released the MAVLink transport first, so this owns the port exclusively.
 */
export async function flashElrsReceiver(input: ElrsFlashInput): Promise<{ chipName: string }> {
  const { port, firmware, onProgress, onLog } = input
  const crsfBaud = input.crsfBaud ?? ELRS_CRSF_BOOTLOADER_BAUD

  // Jump at the CRSF baud so the running firmware parses the command.
  onProgress?.({ phase: 'bootloader', message: 'Sending ELRS bootloader command…' })
  await sendElrsBootloaderJump(port, crsfBaud)

  // esptool at 115200 (== esptool-js's fixed romBaudrate, so main() does NO
  // changeBaud). no_reset: DTR/RTS can't reach the ESP through the FC bridge,
  // and the RX is already in its bootloader from the CRSF jump above.
  onProgress?.({ phase: 'connect', message: 'Syncing with the ESP bootloader…' })
  const transport = new Transport(port as unknown as EsptoolSerialPort, false)
  const loader = new ESPLoader({
    transport,
    baudrate: ELRS_ESPTOOL_BAUD,
    enableTracing: false,
    terminal: onLog
      ? {
          clean: () => undefined,
          writeLine: (data: string) => onLog(data),
          write: (data: string) => onLog(data)
        }
      : undefined
  })

  try {
    await loader.main('no_reset')
    const chipName = loader.chip.CHIP_NAME
    // ESP8266/ESP8285 app image starts at 0x0; ESP32-family at 0x10000.
    const address = chipName.includes('8266') || chipName.includes('8285') ? 0x0 : 0x10000
    onProgress?.({ phase: 'flash', message: `Flashing ${chipName}…`, written: 0, total: firmware.length })
    await loader.writeFlash({
      fileArray: [{ data: firmware, address }],
      // ExpressLRS's own esptool params (binary_flash.py). 'keep' for flashSize
      // left esptool without the size it needs to set up the erase, so the first
      // compressed block failed with "status 193" — 'detect' fixes it. Verified
      // on hardware (ESP8285 through an ArduPilot SERIAL_PASS bridge).
      flashMode: 'dio',
      flashFreq: '40m',
      flashSize: 'detect',
      eraseAll: false,
      compress: true,
      reportProgress: (_fileIndex: number, written: number, total: number) =>
        onProgress?.({ phase: 'flash', written, total })
    })
    onProgress?.({ phase: 'done', message: `Flashed ${chipName}.` })
    return { chipName }
  } finally {
    await transport.disconnect().catch(() => undefined)
  }
}
