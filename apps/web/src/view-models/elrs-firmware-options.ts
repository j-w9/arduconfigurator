// Port of ExpressLRS's binary_configurator / UnifiedConfiguration options
// patching: inject the user's bind phrase, regulatory domain, wifi, etc. into a
// prebuilt "unified" ELRS release .bin. The release appends fixed null-padded
// regions after the ESP firmware image — product name (128B), lua/device name
// (16B), a 512B "defines" JSON (the options), a 2048B hardware-layout JSON, a
// logo, and a trailing 0xBEEFCAFE + prior-target-name. Configuring rewrites only
// the 512B defines region in place.
//
// BRICK-CRITICAL: a wrong offset writes garbage into the firmware. findElrsFirmwareEnd
// is ported byte-for-byte from UnifiedConfiguration.findFirmwareEnd and unit-tested.

import { md5 } from 'js-md5'

const ESP_IMAGE_MAGIC = 0xe9
const PRODUCT_NAME_BYTES = 128
const DEVICE_NAME_BYTES = 16
const DEFINES_BYTES = 512

/**
 * Byte offset in an ESP firmware image where the appended unified regions begin,
 * ported from ExpressLRS UnifiedConfiguration.findFirmwareEnd. ESP32 images have
 * a 24-byte header before their segments; ESP8285 images place the real image at
 * 0x1000 (detected by segment count 2 in the outer header).
 */
export function findElrsFirmwareEnd(firmware: Uint8Array): number {
  const view = new DataView(firmware.buffer, firmware.byteOffset, firmware.byteLength)
  const magic = view.getUint8(0)
  if (magic !== ESP_IMAGE_MAGIC) {
    throw new Error('Not an ESP firmware image (bad magic byte) — is this an ELRS receiver .bin?')
  }
  let segments = view.getUint8(1)
  let is8285 = false
  let pos: number
  if (segments === 2) {
    // ESP8266/8285: the real application image starts at 0x1000.
    segments = view.getUint8(0x1001)
    is8285 = true
    pos = 0x1000 + 8
  } else {
    // ESP32-family: skip the 8-byte image header + 16-byte extended header.
    pos = 24
  }
  for (let segment = 0; segment < segments; segment += 1) {
    // Each segment header is <II> = load address (skipped) + data size.
    const size = view.getUint32(pos + 4, true)
    pos += 8 + size
  }
  pos = (pos + 16) & ~15
  if (!is8285) {
    pos += 32
  }
  return pos
}

/**
 * ELRS UID (6 bytes) from a bind phrase, matching binary_configurator.generateUID:
 * a comma-separated list of 4–6 integers (0–255) is used directly (zero-padded to
 * 6); anything else is the first 6 bytes of MD5(`-DMY_BINDING_PHRASE="<phrase>"`).
 */
export function generateElrsUid(bindPhrase: string): number[] {
  const parts = bindPhrase.split(',').map((part) => part.trim())
  const asInts = parts.map((part) => (/^\d+$/.test(part) ? Number(part) : -1))
  if (asInts.length >= 4 && asInts.length <= 6 && asInts.every((value) => value >= 0 && value < 256)) {
    return [...new Array(6 - asInts.length).fill(0), ...asInts]
  }
  const digest = new Uint8Array(md5.arrayBuffer(`-DMY_BINDING_PHRASE="${bindPhrase}"`))
  return [...digest.slice(0, 6)]
}

export interface ElrsFirmwareOptions {
  /** Bind phrase (→ UID). Overridden by an explicit `uid`. */
  bindPhrase?: string
  /** Explicit 6-byte UID (wins over bindPhrase). */
  uid?: number[]
  /** Regulatory domain number (firmware-defined; e.g. 0=AU915, 1=FCC915…). */
  domain?: number
  wifiSsid?: string
  wifiPassword?: string
  wifiOnInterval?: number
  tlmInterval?: number
  rxUartBaud?: number
  lockOnFirstConnection?: boolean
  /** Random cache-buster the firmware stores; supply for deterministic tests. */
  flashDiscriminator?: number
}

/** The `defines` JSON string ELRS writes into the options region. */
export function buildElrsDefinesJson(options: ElrsFirmwareOptions): string {
  const flags: Record<string, unknown> = {}
  const uid = options.uid ?? (options.bindPhrase ? generateElrsUid(options.bindPhrase) : undefined)
  if (uid) {
    flags.uid = uid
  }
  if (options.domain !== undefined) {
    flags.domain = options.domain
  }
  if (options.wifiSsid !== undefined) {
    flags['wifi-ssid'] = options.wifiSsid
  }
  if (options.wifiPassword !== undefined) {
    flags['wifi-password'] = options.wifiPassword
  }
  if (options.wifiOnInterval !== undefined) {
    flags['wifi-on-interval'] = options.wifiOnInterval
  }
  if (options.tlmInterval !== undefined) {
    flags['tlm-interval'] = options.tlmInterval
  }
  if (options.rxUartBaud !== undefined) {
    flags['rcvr-uart-baud'] = options.rxUartBaud
  }
  if (options.lockOnFirstConnection !== undefined) {
    flags['lock-on-first-connection'] = options.lockOnFirstConnection
  }
  flags['flash-discriminator'] =
    options.flashDiscriminator ?? Math.floor(Math.random() * 0xffffffff) + 1
  return JSON.stringify(flags)
}

/**
 * Return a new firmware image with the 512-byte options (`defines`) region
 * overwritten with the user's config. The image must already carry the unified
 * regions (a real ELRS release .bin) — otherwise we throw rather than write past
 * the end and corrupt it.
 */
export function patchElrsFirmwareOptions(firmware: Uint8Array, options: ElrsFirmwareOptions): Uint8Array {
  const end = findElrsFirmwareEnd(firmware)
  const definesOffset = end + PRODUCT_NAME_BYTES + DEVICE_NAME_BYTES
  if (definesOffset + DEFINES_BYTES > firmware.length) {
    throw new Error(
      'This .bin has no ELRS options region — use a "unified" ELRS release image, or flash it as-is without configuring.'
    )
  }
  const json = buildElrsDefinesJson(options)
  const jsonBytes = new TextEncoder().encode(json)
  if (jsonBytes.length > DEFINES_BYTES) {
    throw new Error(`ELRS options JSON is ${jsonBytes.length} bytes, over the ${DEFINES_BYTES}-byte limit.`)
  }
  const patched = new Uint8Array(firmware)
  patched.fill(0, definesOffset, definesOffset + DEFINES_BYTES)
  patched.set(jsonBytes, definesOffset)
  return patched
}
