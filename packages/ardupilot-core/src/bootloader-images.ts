/**
 * Paths and shapes for reading the two bootloader images an "Update
 * Bootloader" would compare. See ArduPilotConfiguratorRuntime
 * .readBootloaderImages() for the full source citations; the short version is
 * that both paths are the exact addresses AP_HAL_ChibiOS/Util.cpp
 * flash_bootloader() itself uses.
 */

import { MavftpRequestError } from './mavftp.js'

/**
 * The bootloader embedded in the RUNNING firmware — the image an Update
 * Bootloader would write. AP_Filesystem_ROMFS.cpp serves this through the same
 * `AP_ROMFS::find_decompress("bootloader.bin")` call flash_bootloader() makes,
 * so these are the bytes that would be flashed, decompressed, exactly.
 *
 * Absent on firmware built without AP_BOOTLOADER_FLASHING_ENABLED (in which
 * case the Update Bootloader command would fail anyway) and on SITL.
 */
export const EMBEDDED_BOOTLOADER_FTP_PATH = '@ROMFS/bootloader.bin'

/**
 * The whole program flash mapped from 0x08000000 == STM32_FLASH_BASE
 * (AP_HAL_ChibiOS/hwdef/common/flash.c) == `hal.flash->getpageaddr(0)`, which
 * is where the installed bootloader lives. Only the leading bytes are the
 * bootloader, so this must only ever be read as a bounded prefix.
 *
 * ChibiOS-only: AP_FILESYSTEM_SYS_FLASH_ENABLED is
 * `CONFIG_HAL_BOARD == HAL_BOARD_CHIBIOS`, so SITL does not serve it.
 */
export const FLASH_REGION_FTP_PATH = '@SYS/flash.bin'

/**
 * Generous per-read budget. These are tens of kilobytes pulled 200 bytes per
 * round-trip, so individual replies are small but the operator is waiting;
 * long enough that a contended USB link does not fail spuriously.
 */
export const BOOTLOADER_IMAGE_FETCH_TIMEOUT_MS = 15000

/**
 * Refuse to treat anything larger than this as a bootloader image. The largest
 * bootloader region any in-tree board reserves is FLASH_BOOTLOADER_LOAD_KB 128
 * (libraries/AP_HAL_ChibiOS/hwdef/*\/hwdef-bl.dat); doubling that leaves room
 * for an out-of-tree board while stopping a bogus length from turning into a
 * very long read of the flash region.
 */
export const MAX_BOOTLOADER_IMAGE_BYTES = 256 * 1024

/**
 * Raw bytes of both sides, plus a per-side reason when a side is unavailable.
 *
 * Deliberately not a discriminated union: the two sides fail independently,
 * and "we have the incoming image but not the installed one" is a normal,
 * useful outcome that must survive to the UI intact.
 */
export interface BootloaderImagePair {
  /** Bytes that would be flashed, when readable. */
  embedded?: Uint8Array
  /** Why the incoming image is unavailable. Set only when `embedded` is not. */
  embeddedError?: string
  /**
   * Bytes currently in the bootloader region, of exactly `embedded.byteLength`.
   * Only ever populated alongside `embedded` — without a length from the
   * incoming image there is no defensible prefix to read.
   */
  installed?: Uint8Array
  /** Why the installed image is unavailable. Set only when `installed` is not. */
  installedError?: string
}

/**
 * Turn a failed read into something an operator can act on.
 *
 * ANY server-side NAK on one of these two paths means the same thing in
 * practice: this build does not serve that file. The specific code is not
 * worth translating — a board with no `@ROMFS` mount at all NAKs with a
 * generic failure rather than FileNotFound (observed on SITL, which answers
 * "Unknown FTP failure"), and reporting that verbatim would read as a
 * malfunction rather than the ordinary absence it is. The path is included so
 * a developer can still tell exactly what was asked for.
 *
 * A transport-level failure (timeout, dropped link) is NOT a NAK and is passed
 * through unchanged, because there the message is the useful part.
 */
export function describeBootloaderReadFailure(error: unknown, path: string): string {
  if (error instanceof MavftpRequestError) {
    return `This firmware does not serve ${path} over MAVFTP (${error.message}).`
  }
  const message = error instanceof Error ? error.message : String(error)
  if (/file not found|no such file|enoent/i.test(message)) {
    return `This firmware does not serve ${path} over MAVFTP.`
  }
  return message
}
