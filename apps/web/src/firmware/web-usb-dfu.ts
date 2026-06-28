// Browser glue between WebUSB (navigator.usb) and the firmware-flash package's
// transport-agnostic DfuSeDevice. When an ArduPilot board is in DFU mode it
// re-enumerates as an STM32 system-bootloader USB DFU device; this picks that
// device, claims its DFU interface, and exposes the class control transfers the
// DfuSeDevice needs. Mirrors web-serial-bootloader.ts (which does the same for
// the serial bootloader). WebUSB is Chrome/Edge-only, same as Web Serial.

import {
  DfuSeDevice,
  parseDfuSeMemoryLayout,
  type DfuFlashProgress,
  type DfuUsbInterface,
  type IntelHexSegment
} from '@arduconfig/firmware-flash'

// USB DFU interface descriptor (class 0xFE = application-specific, subclass 1 = DFU).
const DFU_INTERFACE_CLASS = 0xfe
const DFU_INTERFACE_SUBCLASS = 0x01
// STM32 system bootloader (ST-Microelectronics) VID — the fallback device filter.
const STM32_VENDOR_ID = 0x0483
// DFU functional descriptor type; carries wTransferSize.
const DFU_FUNCTIONAL_DESCRIPTOR = 0x21
const DEFAULT_TRANSFER_SIZE = 2048
const GET_DESCRIPTOR = 0x06
const CONFIGURATION_DESCRIPTOR = 0x0200

// Minimal WebUSB shims — lib.dom's WebUSB types aren't guaranteed in this
// tsconfig, and we only touch a small slice of the surface.
interface UsbControlSetup {
  requestType: 'standard' | 'class' | 'vendor'
  recipient: 'device' | 'interface' | 'endpoint' | 'other'
  request: number
  value: number
  index: number
}
interface UsbInTransferResult {
  status?: string
  data?: DataView
}
interface UsbOutTransferResult {
  status?: string
}
interface UsbAlternateInterface {
  alternateSetting: number
  interfaceClass: number
  interfaceSubclass: number
  interfaceName?: string
}
interface UsbInterface {
  interfaceNumber: number
  alternates: UsbAlternateInterface[]
}
interface UsbConfiguration {
  interfaces: UsbInterface[]
}
interface UsbDeviceLike {
  productName?: string
  configuration?: UsbConfiguration
  open(): Promise<void>
  close(): Promise<void>
  selectConfiguration(configurationValue: number): Promise<void>
  claimInterface(interfaceNumber: number): Promise<void>
  releaseInterface(interfaceNumber: number): Promise<void>
  selectAlternateInterface(interfaceNumber: number, alternateSetting: number): Promise<void>
  controlTransferIn(setup: UsbControlSetup, length: number): Promise<UsbInTransferResult>
  controlTransferOut(setup: UsbControlSetup, data?: BufferSource): Promise<UsbOutTransferResult>
}
interface UsbLike {
  requestDevice(options: { filters: Array<{ classCode?: number; subclassCode?: number; vendorId?: number }> }): Promise<UsbDeviceLike>
}

function getUsb(): UsbLike | undefined {
  if (typeof navigator === 'undefined') {
    return undefined
  }
  return (navigator as unknown as { usb?: UsbLike }).usb
}

export function isWebUsbSupported(): boolean {
  return getUsb() !== undefined
}

/** Prompt the user to pick a DFU device. Must run inside a user gesture. */
async function requestDfuDevice(): Promise<UsbDeviceLike> {
  const usb = getUsb()
  if (!usb) {
    throw new Error('This browser does not support WebUSB. Use Chrome or Edge to flash over DFU.')
  }
  return usb.requestDevice({
    filters: [
      { classCode: DFU_INTERFACE_CLASS, subclassCode: DFU_INTERFACE_SUBCLASS },
      { vendorId: STM32_VENDOR_ID }
    ]
  })
}

interface OpenDfuInterface {
  device: UsbDeviceLike
  iface: DfuUsbInterface
  memoryLayoutName: string
  transferSize: number
  close(): Promise<void>
}

/** Find the DFU interface (preferring the internal-flash alt), claim it, and
 *  wire up class control transfers. */
async function openDfuInterface(device: UsbDeviceLike): Promise<OpenDfuInterface> {
  await device.open()
  if (!device.configuration) {
    await device.selectConfiguration(1)
  }
  const config = device.configuration
  let interfaceNumber: number | undefined
  let alternate: UsbAlternateInterface | undefined
  for (const candidate of config?.interfaces ?? []) {
    for (const alt of candidate.alternates) {
      if (alt.interfaceClass !== DFU_INTERFACE_CLASS || alt.interfaceSubclass !== DFU_INTERFACE_SUBCLASS) {
        continue
      }
      // Prefer the "@Internal Flash" alt setting (the one we program); fall back
      // to the first DFU alt if names aren't exposed.
      const prefersInternal = (alt.interfaceName ?? '').startsWith('@Internal Flash')
      if (alternate === undefined || prefersInternal) {
        interfaceNumber = candidate.interfaceNumber
        alternate = alt
        if (prefersInternal) {
          break
        }
      }
    }
  }
  if (interfaceNumber === undefined || alternate === undefined) {
    await device.close().catch(() => undefined)
    throw new Error('No DFU interface found on this USB device. Is the board in DFU mode (re-plugged into the bootloader)?')
  }
  await device.claimInterface(interfaceNumber)
  if (alternate.alternateSetting !== 0) {
    await device.selectAlternateInterface(interfaceNumber, alternate.alternateSetting)
  }

  const targetInterface = interfaceNumber
  const iface: DfuUsbInterface = {
    async controlOut(request, value, data) {
      const result = await device.controlTransferOut(
        { requestType: 'class', recipient: 'interface', request, value, index: targetInterface },
        // Feed a fresh plain ArrayBuffer (unambiguously BufferSource) — passing
        // the Uint8Array directly trips the @types/node vs lib.dom mismatch.
        data.length > 0 ? data.slice().buffer : undefined
      )
      if (result.status !== 'ok') {
        throw new Error(`DFU control OUT failed (${result.status ?? 'no status'})`)
      }
    },
    async controlIn(request, value, length) {
      const result = await device.controlTransferIn(
        { requestType: 'class', recipient: 'interface', request, value, index: targetInterface },
        length
      )
      if (result.status !== 'ok' || !result.data) {
        throw new Error(`DFU control IN failed (${result.status ?? 'no status'})`)
      }
      return new Uint8Array(result.data.buffer, result.data.byteOffset, result.data.byteLength)
    }
  }

  const transferSize = await readTransferSize(device).catch(() => DEFAULT_TRANSFER_SIZE)
  return {
    device,
    iface,
    memoryLayoutName: alternate.interfaceName ?? '',
    transferSize,
    close: async () => {
      await device.releaseInterface(targetInterface).catch(() => undefined)
      await device.close().catch(() => undefined)
    }
  }
}

/** Read wTransferSize from the DFU functional descriptor; default 2048 (STM32). */
async function readTransferSize(device: UsbDeviceLike): Promise<number> {
  const result = await device.controlTransferIn(
    { requestType: 'standard', recipient: 'device', request: GET_DESCRIPTOR, value: CONFIGURATION_DESCRIPTOR, index: 0 },
    4096
  )
  if (result.status !== 'ok' || !result.data) {
    return DEFAULT_TRANSFER_SIZE
  }
  const blob = new Uint8Array(result.data.buffer, result.data.byteOffset, result.data.byteLength)
  let i = 0
  while (i + 1 < blob.length) {
    const bLength = blob[i]
    if (bLength < 2) {
      break
    }
    if (blob[i + 1] === DFU_FUNCTIONAL_DESCRIPTOR && i + 7 <= blob.length) {
      const transferSize = blob[i + 5] | (blob[i + 6] << 8)
      return transferSize > 0 ? transferSize : DEFAULT_TRANSFER_SIZE
    }
    i += bLength
  }
  return DEFAULT_TRANSFER_SIZE
}

/**
 * Prompt for a DFU device and flash the given Intel-HEX segments to it. Must be
 * invoked from a user gesture (it calls navigator.usb.requestDevice). Returns
 * the picked device's product name for the success message.
 */
export async function flashSegmentsOverDfu(
  segments: readonly IntelHexSegment[],
  onProgress?: (progress: DfuFlashProgress) => void
): Promise<{ deviceName: string }> {
  const device = await requestDfuDevice()
  const open = await openDfuInterface(device)
  try {
    const memory = parseDfuSeMemoryLayout(open.memoryLayoutName)
    const dfu = new DfuSeDevice(open.iface, memory, open.transferSize)
    await dfu.flash(segments, onProgress)
    return { deviceName: device.productName ?? 'DFU device' }
  } finally {
    await open.close()
  }
}
