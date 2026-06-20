// ArduPilot serial-bootloader protocol client.
//
// Pure protocol logic over an abstract byte stream (`BootloaderSerial`)
// so it is unit-testable with a scripted mock and reusable from
// WebSerialTransport. Assumes the board is ALREADY in bootloader mode —
// the reboot-to-bootloader handshake (MAVLink reboot / 1200bps touch over
// the live link) belongs to the transport-integration slice, not here.
//
// Protocol constants and flow are verbatim from ArduPilot
// Tools/scripts/uploader.py.

import { arduPilotCrc32, firmwareCrc } from './crc.js'
import { checkImageFitsFlash } from './board-guard.js'

const INSYNC = 0x12
const EOC = 0x20
const OK = 0x10
const FAILED = 0x11
const INVALID = 0x13
const BAD_SILICON_REV = 0x14

const GET_SYNC = 0x21
const GET_DEVICE = 0x22
const CHIP_ERASE = 0x23
// rev-2-only opcodes. CHIP_VERIFY resets the bootloader's flash read
// pointer to 0x0000; READ_MULTI streams `length` bytes from the
// auto-incrementing read cursor with NO INSYNC prefix on the data payload.
const CHIP_VERIFY = 0x24
const PROG_MULTI = 0x27
const READ_MULTI = 0x28
const GET_CRC = 0x29
const REBOOT = 0x30

// extflash opcodes for dual-image boards (CubeOrange+, Pixhawk6X,
// Pixhawk6C, Holybro Durandal H7, Hex Here4). The bootloader manages
// QSPI sectors internally; the client just streams the size and bytes.
const EXTF_ERASE = 0x34
const EXTF_PROG_MULTI = 0x35
// EXTF_READ_MULTI = 0x36 — defined upstream but not used here yet (would
// back a rev-2-style byte-compare verify; this client uses EXTF_GET_CRC).
const EXTF_GET_CRC = 0x37

const INFO_BL_REV = 0x01
const INFO_BOARD_ID = 0x02
const INFO_BOARD_REV = 0x03
const INFO_FLASH_SIZE = 0x04

// PROG_MULTI chunk size. uploader.py's ceiling is 252 (the bootloader's
// PROG_MULTI buffer limit); 128 here raises the ACK rate over Web Serial
// so corruption surfaces sooner, and stays well within the buffer.
const PROG_MULTI_MAX = 128
// READ_MULTI ceiling for the rev-2 byte-compare verify path; matches the
// 128 chosen for PROG_MULTI (upstream uploader.py uses 252).
const READ_MULTI_MAX = 128
// Bootloader protocol revisions supported. Rev 3-5 use GET_CRC for the
// post-flash verify; rev 2 has no GET_CRC and uses the CHIP_VERIFY +
// READ_MULTI byte-compare path (early PX4FMUv1/v2 and some clone boards).
const BL_REV_MIN = 2
const BL_REV_MAX = 5
const BL_REV_READBACK_VERIFY = 2

export interface BootloaderSerial {
  write(data: Uint8Array): Promise<void>
  /** Resolve with exactly `n` bytes, or reject if `timeoutMs` elapses first. */
  read(n: number, timeoutMs: number): Promise<Uint8Array>
  /** Discard any buffered inbound bytes before a fresh command. */
  flushInput?(): Promise<void> | void
}

export interface BoardIdentity {
  bootloaderRevision: number
  boardId: number
  boardRevision: number
  flashSize: number
}

export type FlashPhase =
  | 'erase'
  | 'program'
  | 'verify'
  | 'extf-erase'
  | 'extf-program'
  | 'extf-verify'

export type FlashProgress = (phase: FlashPhase, ratio: number) => void

const SYNC_TIMEOUT_MS = 3000
// CHIP_ERASE timeout. Ports QGC's scaling (Bootloader.cc:166-171): 20s
// baseline + 4s per MB of flash above 2 MB (uploader.py uses a flat 20s).
// The fallback is a flat 40s when flashSize is unknown.
const ERASE_FALLBACK_TIMEOUT_MS = 40_000
/**
 * Pure helper for the CHIP_ERASE deadline. Exported so the scaling math
 * has a direct unit-test surface and so callers can build the same
 * budget into a UI progress estimate.
 */
export function chipEraseTimeoutMs(flashSize?: number): number {
  if (flashSize === undefined || !Number.isFinite(flashSize) || flashSize <= 0) {
    return ERASE_FALLBACK_TIMEOUT_MS
  }
  const flashMb = flashSize / (1024 * 1024)
  const extraMb = Math.max(0, Math.ceil(flashMb) - 2)
  return 20_000 + extraMb * 4_000
}
// QSPI extflash erase is slow (8MB commonly 15-30s); 60s bounds a stuck
// bootloader while leaving headroom for the largest current parts.
const EXTF_ERASE_TOTAL_TIMEOUT_MS = 60_000
// EXTF_GET_CRC walk over multi-MB extflash regions is slow; 10s matches
// uploader.py.
const EXTF_VERIFY_TIMEOUT_MS = 10_000
// Inter-byte timeout while waiting for an extflash erase percentage
// update, sized to ride out normal ChibiOS scheduling gaps.
const EXTF_ERASE_PCT_READ_TIMEOUT_MS = 2000

export class BootloaderClient {
  constructor(private readonly io: BootloaderSerial) {}

  private async getSync(timeoutMs = SYNC_TIMEOUT_MS): Promise<void> {
    const head = await this.io.read(1, timeoutMs)
    if (head[0] !== INSYNC) {
      throw new Error(`bootloader: expected INSYNC (0x12), got 0x${head[0].toString(16)}`)
    }
    const status = await this.io.read(1, timeoutMs)
    if (status[0] === INVALID) throw new Error('bootloader reports INVALID OPERATION')
    if (status[0] === FAILED) throw new Error('bootloader reports OPERATION FAILED')
    if (status[0] === BAD_SILICON_REV) {
      throw new Error('bootloader: programming not supported for this silicon revision')
    }
    if (status[0] !== OK) {
      throw new Error(`bootloader: expected OK (0x10), got 0x${status[0].toString(16)}`)
    }
  }

  private async sync(timeoutMs = SYNC_TIMEOUT_MS): Promise<void> {
    await this.io.flushInput?.()
    await this.io.write(new Uint8Array([GET_SYNC, EOC]))
    await this.getSync(timeoutMs)
  }

  private async getInfo(param: number): Promise<number> {
    // Drain any stray byte so the fixed-width 4-byte read can't be shifted
    // into a wrong board id.
    await this.io.flushInput?.()
    await this.io.write(new Uint8Array([GET_DEVICE, param, EOC]))
    const raw = await this.io.read(4, SYNC_TIMEOUT_MS)
    await this.getSync()
    return (raw[0] | (raw[1] << 8) | (raw[2] << 16) | (raw[3] << 24)) >>> 0
  }

  /**
   * Handshake + read board id / flash size. Throws if the BL rev is
   * unsupported. `syncTimeoutMs` bounds only the initial GET_SYNC reply
   * wait, so a caller probing many ports that may not be bootloaders can
   * pass a short budget to fail fast; the GET_DEVICE reads then use the
   * standard timeout.
   */
  async identify(options: { syncTimeoutMs?: number } = {}): Promise<BoardIdentity> {
    await this.sync(options.syncTimeoutMs)
    const bootloaderRevision = await this.getInfo(INFO_BL_REV)
    if (bootloaderRevision < BL_REV_MIN || bootloaderRevision > BL_REV_MAX) {
      throw new Error(
        `bootloader: unsupported protocol revision ${bootloaderRevision} (supported ${BL_REV_MIN}-${BL_REV_MAX})`
      )
    }
    const boardId = await this.getInfo(INFO_BOARD_ID)
    const boardRevision = await this.getInfo(INFO_BOARD_REV)
    const flashSize = await this.getInfo(INFO_FLASH_SIZE)
    return { bootloaderRevision, boardId, boardRevision, flashSize }
  }

  private async trySync(): Promise<boolean> {
    let head: Uint8Array
    try {
      head = await this.io.read(1, 1000)
    } catch {
      // No reply yet — the bootloader is still erasing. Keep polling.
      return false
    }
    if (head[0] !== INSYNC) return false
    // A genuine erase failure (FAILED/INVALID/bad-silicon) surfaces as an
    // error, but a lone INSYNC with no status byte in the window is a sync
    // miss, not a failure — keep polling (as uploader.py does).
    let status: Uint8Array
    try {
      status = await this.io.read(1, 1000)
    } catch {
      return false
    }
    if (status[0] === BAD_SILICON_REV) {
      throw new Error('bootloader: programming not supported for this silicon revision')
    }
    if (status[0] === INVALID) throw new Error('bootloader reports INVALID OPERATION during chip erase')
    if (status[0] === FAILED) throw new Error('bootloader reports chip erase FAILED')
    return status[0] === OK
  }

  async erase(onProgress?: FlashProgress, flashSize?: number): Promise<void> {
    await this.io.write(new Uint8Array([CHIP_ERASE, EOC]))
    const timeoutMs = chipEraseTimeoutMs(flashSize)
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      onProgress?.('erase', Math.min(0.99, 1 - (deadline - Date.now()) / timeoutMs))
      if (await this.trySync()) {
        onProgress?.('erase', 1)
        return
      }
    }
    throw new Error('bootloader: timed out waiting for chip erase')
  }

  /** Program the 4-byte-aligned image in PROG_MULTI_MAX chunks. */
  async program(alignedImage: Uint8Array, onProgress?: FlashProgress): Promise<void> {
    if (alignedImage.length % 4 !== 0) {
      throw new Error('bootloader: image must be 4-byte aligned before programming')
    }
    const total = alignedImage.length
    for (let offset = 0; offset < total; offset += PROG_MULTI_MAX) {
      const chunk = alignedImage.subarray(offset, Math.min(offset + PROG_MULTI_MAX, total))
      // Send PROG_MULTI / len / payload / EOC as four separate writes so
      // the host's USB CDC stack paces them and doesn't overflow the
      // bootloader RX buffer (uploader.py does the same). flushInput()
      // before each chunk drops any stray byte so a chunk can't be shifted.
      await this.io.flushInput?.()
      await this.io.write(new Uint8Array([PROG_MULTI]))
      await this.io.write(new Uint8Array([chunk.length]))
      await this.io.write(chunk)
      await this.io.write(new Uint8Array([EOC]))
      await this.getSync()
      onProgress?.('program', Math.min(1, (offset + chunk.length) / total))
    }
  }

  /** GET_CRC verify against the bootloader's own flash CRC. */
  async verify(alignedImage: Uint8Array, flashSize: number, onProgress?: FlashProgress): Promise<void> {
    onProgress?.('verify', 0.01)
    const expected = firmwareCrc(alignedImage, flashSize)
    // Drain stray bytes so the fixed-width 4-byte CRC read can't be shifted.
    await this.io.flushInput?.()
    await this.io.write(new Uint8Array([GET_CRC, EOC]))
    const raw = await this.io.read(4, SYNC_TIMEOUT_MS)
    await this.getSync()
    const reported = (raw[0] | (raw[1] << 8) | (raw[2] << 16) | (raw[3] << 24)) >>> 0
    if (reported !== expected) {
      throw new Error(
        `bootloader: CRC verify failed (expected 0x${expected.toString(16)}, got 0x${reported.toString(16)})`
      )
    }
    onProgress?.('verify', 1)
  }

  /** Boot the freshly-flashed firmware. The port typically drops after this. */
  async reboot(): Promise<void> {
    await this.io.write(new Uint8Array([REBOOT, EOC]))
  }

  /**
   * Skip-if-same-firmware: issue GET_CRC against the currently-flashed
   * image and return whether it matches the staged `alignedImage`. Pure
   * protocol query (no erase, no write). Throws on rev-2 bootloaders
   * (no GET_CRC), so callers must catch and fall through to a normal flash.
   */
  async currentMatches(alignedImage: Uint8Array, flashSize: number): Promise<boolean> {
    if (alignedImage.length % 4 !== 0) {
      throw new Error('bootloader: image must be 4-byte aligned before CRC check')
    }
    const expected = firmwareCrc(alignedImage, flashSize)
    await this.io.flushInput?.()
    await this.io.write(new Uint8Array([GET_CRC, EOC]))
    const raw = await this.io.read(4, SYNC_TIMEOUT_MS)
    await this.getSync()
    const reported = (raw[0] | (raw[1] << 8) | (raw[2] << 16) | (raw[3] << 24)) >>> 0
    return reported === expected
  }

  /**
   * Erase the external QSPI flash region. The bootloader manages
   * sectoring internally — we just send the total size in bytes (4-byte
   * little-endian). After the initial INSYNC/OK the bootloader streams
   * uint8 percentage updates; once the device reports >= 90% we switch
   * to trySync() polling for the final OK. Matches
   * uploader.py `erase_extflash` (Tools/scripts/uploader.py:713-725).
   */
  async eraseExtflash(sizeBytes: number, onProgress?: FlashProgress): Promise<void> {
    if (sizeBytes <= 0 || sizeBytes % 4 !== 0) {
      throw new Error('bootloader: extflash size must be a positive 4-byte multiple')
    }
    await this.io.flushInput?.()
    await this.io.write(new Uint8Array([EXTF_ERASE]))
    await this.io.write(le32(sizeBytes))
    await this.io.write(new Uint8Array([EOC]))
    await this.getSync()
    const deadline = Date.now() + EXTF_ERASE_TOTAL_TIMEOUT_MS
    let lastPct = 0
    while (Date.now() < deadline) {
      if (lastPct < 90) {
        try {
          const pctByte = await this.io.read(1, EXTF_ERASE_PCT_READ_TIMEOUT_MS)
          const pct = pctByte[0]
          if (pct !== lastPct) {
            lastPct = pct
            onProgress?.('extf-erase', Math.min(0.99, pct / 100))
          }
        } catch {
          // No byte yet — keep trying until the overall deadline. A
          // genuine bootloader failure surfaces as INVALID/FAILED on
          // the next trySync(), not as a timeout here.
        }
      } else if (await this.trySync()) {
        onProgress?.('extf-erase', 1)
        return
      }
    }
    throw new Error('bootloader: timed out waiting for extflash erase')
  }

  /**
   * Program the 4-byte-aligned extflash image in PROG_MULTI_MAX chunks,
   * using the same per-chunk write-split + flushInput pattern as program().
   */
  async programExtflash(extfImage: Uint8Array, onProgress?: FlashProgress): Promise<void> {
    if (extfImage.length % 4 !== 0) {
      throw new Error('bootloader: extflash image must be 4-byte aligned before programming')
    }
    const total = extfImage.length
    for (let offset = 0; offset < total; offset += PROG_MULTI_MAX) {
      const chunk = extfImage.subarray(offset, Math.min(offset + PROG_MULTI_MAX, total))
      await this.io.flushInput?.()
      await this.io.write(new Uint8Array([EXTF_PROG_MULTI]))
      await this.io.write(new Uint8Array([chunk.length]))
      await this.io.write(chunk)
      await this.io.write(new Uint8Array([EOC]))
      await this.getSync()
      onProgress?.('extf-program', Math.min(1, (offset + chunk.length) / total))
    }
  }

  /**
   * Verify the extflash image against the bootloader's EXTF_GET_CRC.
   * Unlike internal-flash GET_CRC (which pads with 0xFF up to
   * flash_max_size), extflash CRC is computed over JUST the image bytes
   * — uploader.py `extf_crc(size)` is literally `crc32(self.extf_image[:size], 0)`.
   * Allow up to 10s for the bootloader's CRC walk over multi-MB regions
   * (matches uploader.py:751).
   */
  async verifyExtflash(extfImage: Uint8Array, onProgress?: FlashProgress): Promise<void> {
    onProgress?.('extf-verify', 0.01)
    const expected = arduPilotCrc32(extfImage, 0)
    await this.io.flushInput?.()
    await this.io.write(new Uint8Array([EXTF_GET_CRC]))
    await this.io.write(le32(extfImage.length))
    await this.io.write(new Uint8Array([EOC]))
    const raw = await this.io.read(4, EXTF_VERIFY_TIMEOUT_MS)
    await this.getSync()
    const reported = (raw[0] | (raw[1] << 8) | (raw[2] << 16) | (raw[3] << 24)) >>> 0
    if (reported !== expected) {
      throw new Error(
        `bootloader: extflash CRC verify failed (expected 0x${expected.toString(16)}, got 0x${reported.toString(16)})`
      )
    }
    onProgress?.('extf-verify', 1)
  }

  /**
   * Rev-2 byte-compare verify. Legacy bootloaders (early
   * PX4FMUv1/v2, AUAV-X2, some clone boards) have no GET_CRC, so
   * verification must read the flash back and compare. The flow mirrors
   * uploader.py `__verify_v2` (Tools/scripts/uploader.py:1059-1074):
   * send `[CHIP_VERIFY, EOC]` once to reset the bootloader's flash read
   * pointer to 0x0000, then loop `[READ_MULTI, length, EOC]` chunks. The
   * payload reply is raw bytes with NO INSYNC prefix; getSync() follows
   * each chunk for the per-chunk ACK. The bootloader auto-increments
   * the read cursor by `length` between requests.
   */
  async verifyByReadback(alignedImage: Uint8Array, onProgress?: FlashProgress): Promise<void> {
    if (alignedImage.length % 4 !== 0) {
      throw new Error('bootloader: image must be 4-byte aligned before verify')
    }
    onProgress?.('verify', 0)
    await this.io.flushInput?.()
    // CHIP_VERIFY is a no-payload command; one EOC, then a single sync.
    await this.io.write(new Uint8Array([CHIP_VERIFY]))
    await this.io.write(new Uint8Array([EOC]))
    await this.getSync()
    const total = alignedImage.length
    for (let offset = 0; offset < total; offset += READ_MULTI_MAX) {
      const expected = alignedImage.subarray(offset, Math.min(offset + READ_MULTI_MAX, total))
      // Same per-chunk write-split + flushInput discipline as program().
      await this.io.flushInput?.()
      await this.io.write(new Uint8Array([READ_MULTI]))
      await this.io.write(new Uint8Array([expected.length]))
      await this.io.write(new Uint8Array([EOC]))
      const got = await this.io.read(expected.length, SYNC_TIMEOUT_MS)
      await this.getSync()
      for (let i = 0; i < expected.length; i += 1) {
        if (got[i] !== expected[i]) {
          throw new Error(
            `bootloader: verify failed at offset 0x${(offset + i).toString(16)} (expected 0x${expected[i].toString(16)}, got 0x${got[i].toString(16)})`
          )
        }
      }
      onProgress?.('verify', Math.min(1, (offset + expected.length) / total))
    }
  }

  /**
   * Full erase → program → verify → reboot. `image` must be 4-byte
   * aligned. When `extfImage` is supplied it is erased, programmed and
   * verified first, per uploader.py ordering (Tools/scripts/uploader.py:1049-1059),
   * then the internal flash proceeds. rev 2 uses the CHIP_VERIFY +
   * READ_MULTI byte-compare verify; rev 3+ (or undefined) uses GET_CRC.
   * A single verify retry covers transient drops on the internal flash;
   * extflash mismatches throw immediately (as upstream tools do).
   */
  async flash(
    image: Uint8Array,
    flashSize: number,
    onProgress?: FlashProgress,
    extfImage?: Uint8Array,
    bootloaderRevision?: number
  ): Promise<void> {
    // Refuse an image that cannot fit this board's flash before CHIP_ERASE,
    // while the existing firmware is still intact. Package-level net so
    // every caller, not only the UI guard, is covered.
    const fits = checkImageFitsFlash(image.length, flashSize)
    if (!fits.ok) {
      throw new Error(`${fits.reason} No erase was performed; the board still has its firmware.`)
    }
    // Length-gated, not just truthy: a zero-byte extflash cycle is
    // meaningless (and may NAK). Mirrors uploader.py's extf_image_size > 0
    // gate as a package-level net for any caller.
    if (extfImage && extfImage.length > 0) {
      await this.eraseExtflash(extfImage.length, onProgress)
      await this.programExtflash(extfImage, onProgress)
      await this.verifyExtflash(extfImage, onProgress)
    }
    await this.erase(onProgress, flashSize)
    await this.program(image, onProgress)
    const runVerify = async (): Promise<void> => {
      if (bootloaderRevision === BL_REV_READBACK_VERIFY) {
        await this.verifyByReadback(image, onProgress)
      } else {
        await this.verify(image, flashSize, onProgress)
      }
    }
    try {
      await runVerify()
    } catch (firstError) {
      // A verify mismatch usually means a transient drop corrupted one
      // PROG_MULTI chunk; the bootloader is still alive, so re-erase and
      // re-program once. Repeated failures are a real link problem, so a
      // single retry only. The regex matches both the rev 3+ "CRC verify
      // failed" and the rev-2 "verify failed at offset" messages.
      if (firstError instanceof Error && /verify failed/i.test(firstError.message)) {
        await this.erase(onProgress, flashSize)
        await this.program(image, onProgress)
        await runVerify()
      } else {
        throw firstError
      }
    }
    // Verify passed, so the flash is good. The board usually drops the
    // port on reboot, so a write rejection here must not be reported as a
    // failure.
    try {
      await this.reboot()
    } catch {
      /* verified OK; reboot is a courtesy and the port commonly drops first */
    }
  }
}

function le32(value: number): Uint8Array {
  return new Uint8Array([
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 24) & 0xff
  ])
}
