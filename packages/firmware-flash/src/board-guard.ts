// Point-of-no-return brick guards, kept as pure functions so they are
// node-testable independently of the React flasher and provide a
// defense-in-depth layer below the UI.

import { formatBoardId } from './board-names.js'

export interface BoardMatchResult {
  ok: boolean
  /** Operator-facing refusal message when ok === false. */
  reason?: string
  /**
   * Non-refusal advisory note from a compat-table match (a known-good
   * cross-id exception rather than strict board_id equality).
   */
  note?: string
}

// Known board-id equivalences — the only exceptions upstream uploader.py
// and QGroundControl recognise; strict equality otherwise. Adding entries
// without verifying upstream support risks bricking incompatible boards.
const PX4FMUv2_ID = 9
const PX4FMUv3_ID = 255
const AUAVX2_1_ID = 33
/** QGC's threshold: an FMUv2 board reporting > this much flash is the
 *  silent "v2 with corrected bootloader, actually v3" case. Source:
 *  qgroundcontrol Bootloader.cc:128-138. */
const FMUV3_LARGE_FLASH_THRESHOLD = 1032192
/** QGC also requires bootloader rev >= 5 on the same path. */
const FMUV3_LARGE_FLASH_MIN_BL_REV = 5

/**
 * An .apj may only be written to a bootloader reporting the SAME board
 * id, with two upstream-recognised exceptions:
 *   - AUAV-X2.1 (33) ↔ PX4FMUv2 (9): bidirectional hardcoded compat
 *     (uploader.py:110-111 + Tools/scripts/uploader.py:922-931).
 *   - PX4FMUv3 firmware → PX4FMUv2 board, ONLY when the connected
 *     bootloader is rev >= 5 AND reports > 1032192 bytes of flash
 *     (QGroundControl Bootloader.cc:128-138 — handles the
 *     "FMUv2-with-corrected-bootloader-is-actually-FMUv3" case).
 *
 * This is the last line before CHIP_ERASE — a mismatch here is the
 * classic wrong-image brick.
 */
export function checkBoardMatch(
  firmwareBoardId: number,
  connectedBoardId: number,
  connectedBootloaderRevision?: number,
  connectedFlashSize?: number
): BoardMatchResult {
  if (firmwareBoardId === connectedBoardId) {
    return { ok: true }
  }
  // AUAVX2.1 ↔ PX4FMUv2 (bidirectional; uploader.py:922-931 wording).
  if (
    (firmwareBoardId === AUAVX2_1_ID && connectedBoardId === PX4FMUv2_ID) ||
    (firmwareBoardId === PX4FMUv2_ID && connectedBoardId === AUAVX2_1_ID)
  ) {
    return {
      ok: true,
      note:
        `Allowing AUAV-X2.1 (33) ↔ PX4FMUv2 (9) compatibility (uploader.py compat table). ` +
        `If this is not the board you meant to flash, stop now.`
    }
  }
  // FMUv3 firmware → FMUv2 board IFF the bootloader signature matches
  // the corrected-bootloader/larger-flash case. Never the other
  // direction (a strict FMUv2 board with old bootloader cannot take an
  // FMUv3 image safely — QGC explicitly filters out fmuv2-flagged
  // entries when on real v3 hardware).
  if (
    firmwareBoardId === PX4FMUv3_ID &&
    connectedBoardId === PX4FMUv2_ID &&
    connectedBootloaderRevision !== undefined &&
    connectedBootloaderRevision >= FMUV3_LARGE_FLASH_MIN_BL_REV &&
    connectedFlashSize !== undefined &&
    connectedFlashSize > FMUV3_LARGE_FLASH_THRESHOLD
  ) {
    return {
      ok: true,
      note:
        `Allowing PX4FMUv3 firmware (255) on a PX4FMUv2 board (9) with corrected ` +
        `bootloader (rev ${connectedBootloaderRevision} >= 5) and ${connectedFlashSize}-byte ` +
        `flash (> ${FMUV3_LARGE_FLASH_THRESHOLD}). QGroundControl compat case.`
    }
  }
  return {
    ok: false,
    reason:
      `Refusing to flash: this firmware is built for board id ${formatBoardId(firmwareBoardId)}, ` +
      `but the connected board reports id ${formatBoardId(connectedBoardId)}. ` +
      `Download the .apj for your exact board.`
  }
}

/**
 * The image must fit the connected board's flash. Mirrors uploader.py,
 * which refuses an over-large image before CHIP_ERASE so the board stays
 * bootable rather than being wiped first.
 *
 * `imageBytes` is the 4-byte-aligned image length; `flashSize` is the
 * FLASH_SIZE from `identify()`.
 */
export function checkImageFitsFlash(imageBytes: number, flashSize: number): BoardMatchResult {
  if (imageBytes <= flashSize) {
    return { ok: true }
  }
  return {
    ok: false,
    reason:
      `Refusing to flash: the firmware image is ${imageBytes} bytes but the connected ` +
      `board reports only ${flashSize} bytes of flash. This is the wrong build for this ` +
      `board — download the .apj for your exact board.`
  }
}
