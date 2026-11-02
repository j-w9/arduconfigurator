// Transport-agnostic STM32 DFU (DfuSe) client. ArduPilot boards re-enumerate as
// an STM32 system-bootloader USB DFU device when put in DFU mode (BOOT0 / the
// "reboot to DFU" command); this drives that device to erase + program an
// Intel-HEX image (see ./intel-hex.ts) over USB control transfers only.
//
// The client knows nothing about WebUSB — it speaks to a small DfuUsbInterface
// (class control IN/OUT to the DFU interface), so apps/web supplies a WebUSB
// binding and tests supply a mock. The DfuSe specifics (set-address 0x21, erase
// 0x41, block-streamed program, manifest/leave) follow ST AN3156.

/** Minimal USB transport: class-specific control transfers to the DFU interface. */
export interface DfuUsbInterface {
  /** Class control OUT (host→device) to the DFU interface. */
  controlOut(request: number, value: number, data: Uint8Array): Promise<void>
  /** Class control IN (device→host) from the DFU interface. */
  controlIn(request: number, value: number, length: number): Promise<Uint8Array>
}

// DFU class requests (USB DFU 1.1 / DfuSe).
const DFU_DNLOAD = 1
const DFU_UPLOAD = 2
const DFU_GETSTATUS = 3
const DFU_CLRSTATUS = 4
const DFU_ABORT = 6

// DFU device states (subset we act on).
const STATE_DFU_IDLE = 2
const STATE_DFU_DNLOAD_SYNC = 3
const STATE_DFU_DNBUSY = 4
const STATE_DFU_DNLOAD_IDLE = 5
const STATE_DFU_MANIFEST_SYNC = 6
const STATE_DFU_MANIFEST = 7
const STATE_DFU_ERROR = 10

const STATUS_OK = 0

// GETSTATUS stalls ridden out before giving up (dfu-util allows 3).
const MAX_STATUS_STALLS = 3
const STALL_BACKOFF_MS = 5
// Tries per chunk before the flash fails.
const MAX_CHUNK_ATTEMPTS = 3
// STM32H7 programs flash in 32-byte words; a short final write is padded with
// erased bytes rather than left for the bootloader to deal with.
const FLASH_WORD_BYTES = 32
// A sector erase still busy after this long is wedged, not slow. An STM32H7
// takes up to 4 s for a 128 KiB sector (datasheet tERASE128KB max) and its ROM
// asks for a shorter wait than that, so a board still busy after the wait it
// asked for is usually just erasing; a CLRSTATUS then is stalled.
const ERASE_WEDGED_AFTER_MS = 10_000

// DfuSe command bytes (download to block 0 = command channel).
const DFUSE_SET_ADDRESS = 0x21
const DFUSE_ERASE = 0x41

export interface DfuStatus {
  status: number
  pollTimeoutMs: number
  state: number
}

/**
 * One flash sector parsed from the DfuSe memory-layout string.
 *
 * The layout encodes per-sector permissions in the type letter that follows the
 * size (ST DfuSe: the letter is 0x60 + a 3-bit mask, bit0 readable, bit1
 * erasable, bit2 writeable — so `g` is all three and anything less is not).
 * That letter used to be parsed and thrown away, which meant a board whose
 * sectors are write-protected looked identical to one that is not, right up
 * until the erase failed partway through.
 */
export interface DfuMemorySector {
  start: number
  size: number
  readable: boolean
  erasable: boolean
  writable: boolean
}

/** A sector the image needs to write but the device reports as protected. */
export interface DfuProtectedSector {
  start: number
  size: number
  erasable: boolean
  writable: boolean
}

export type DfuFlashPhase = 'erase' | 'program' | 'verify' | 'manifest'

export interface DfuFlashProgress {
  phase: DfuFlashPhase
  /** 0..1 within the current phase. */
  ratio: number
  label: string
}

import type { IntelHexSegment } from './intel-hex.js'

/** Waits out a device's poll timeout. Injectable: a browser tab in the
 *  background throttles main-thread timers to one wake a second (one a minute
 *  after five minutes), and a flash waits once per block -- so the web app
 *  passes a clock that keeps time off the main thread. */
export type DfuSleep = (ms: number) => Promise<void>

const timerSleep: DfuSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Parse a DfuSe interface name string (e.g.
 * "@Internal Flash  /0x08000000/04*016Kg,01*016Kg,01*064Kg,07*128Kg") into the
 * list of erasable flash sectors. Returns an empty list if the string is not a
 * DfuSe layout descriptor.
 */
export function parseDfuSeMemoryLayout(name: string): DfuMemorySector[] {
  if (!name || name[0] !== '@') {
    return []
  }
  const slash = name.indexOf('/')
  if (slash < 0) {
    return []
  }
  // Tokens alternate: address, sectorDefs, [address, sectorDefs, ...].
  const tokens = name
    .slice(slash)
    .split('/')
    .map((token) => token.trim())
    .filter((token) => token.length > 0)
  const sectors: DfuMemorySector[] = []
  for (let i = 0; i + 1 < tokens.length; i += 2) {
    let address = Number.parseInt(tokens[i], 16)
    if (Number.isNaN(address)) {
      continue
    }
    for (const def of tokens[i + 1].split(',')) {
      const match = def.trim().match(/^(\d+)\*(\d+)([\sKMkm])([a-gA-G])?/)
      if (!match) {
        continue
      }
      const count = Number.parseInt(match[1], 10)
      const unit = match[3].toUpperCase()
      const size = Number.parseInt(match[2], 10) * (unit === 'M' ? 0x100000 : unit === 'K' ? 0x400 : 1)
      // Missing letter: assume fully permitted rather than inventing a
      // protection the device never claimed — a false alarm on every flash
      // would be worse than the gap it closes.
      const mask = match[4] ? (match[4].toLowerCase().charCodeAt(0) - 0x60) & 0x07 : 0x07
      for (let s = 0; s < count; s += 1) {
        sectors.push({
          start: address,
          size,
          readable: (mask & 0x01) !== 0,
          erasable: (mask & 0x02) !== 0,
          writable: (mask & 0x04) !== 0
        })
        address += size
      }
    }
  }
  return sectors
}

/**
 * Sectors the image needs but the device will not let us write or erase.
 *
 * At least one major manufacturer ships boards with option-byte write
 * protection set on nWRP1/nWRP2, which silently prevents writing the ArduPilot
 * bootloader. Without this check the flash starts, fails partway through the
 * erase, and leaves a board that no longer boots what it used to — the worst
 * possible moment to discover the protection.
 */
export function findProtectedSectors(
  sectors: readonly DfuMemorySector[],
  segments: readonly IntelHexSegment[]
): DfuProtectedSector[] {
  const protectedSectors: DfuProtectedSector[] = []
  for (const sector of sectors) {
    if (sector.erasable && sector.writable) {
      continue
    }
    const sectorEnd = sector.start + sector.size
    const touched = segments.some(
      (segment) => sector.start < segment.address + segment.data.length && sectorEnd > segment.address
    )
    if (touched) {
      protectedSectors.push({
        start: sector.start,
        size: sector.size,
        erasable: sector.erasable,
        writable: sector.writable
      })
    }
  }
  return protectedSectors.sort((a, b) => a.start - b.start)
}

/**
 * Thrown instead of starting a flash the board has said it will refuse.
 *
 * Carries the sectors so the caller can offer an informed override rather than
 * re-deriving them from a message string.
 */
export class DfuProtectedSectorError extends Error {
  readonly protectedSectors: readonly DfuProtectedSector[]

  constructor(protectedSectors: readonly DfuProtectedSector[]) {
    super(describeProtectedSectors(protectedSectors))
    this.name = 'DfuProtectedSectorError'
    this.protectedSectors = protectedSectors
  }
}

/** Operator-facing explanation of a protected-sector finding. */
export function describeProtectedSectors(protectedSectors: readonly DfuProtectedSector[]): string {
  if (protectedSectors.length === 0) {
    return ''
  }
  const list = protectedSectors
    .map((sector) => `0x${sector.start.toString(16).toUpperCase()} (${Math.round(sector.size / 1024)} KiB)`)
    .join(', ')
  return (
    `${protectedSectors.length} flash sector(s) this firmware needs are reported as protected by the board: ${list}. ` +
    'This is normally STM32 option-byte write protection (nWRP) — some vendors ship boards with it set, which ' +
    'prevents writing the ArduPilot bootloader. Flashing anyway is expected to fail partway through the erase and ' +
    'can leave the board unable to boot what it had before. Clear the protection with the vendor tool (or ' +
    'STM32CubeProgrammer) before flashing.'
  )
}

/** Start addresses of every sector touched by the image segments (ascending, unique). */
export function sectorsToErase(sectors: readonly DfuMemorySector[], segments: readonly IntelHexSegment[]): number[] {
  const toErase = new Set<number>()
  for (const segment of segments) {
    const segStart = segment.address
    const segEnd = segment.address + segment.data.length
    for (const sector of sectors) {
      const sectorEnd = sector.start + sector.size
      if (sector.start < segEnd && sectorEnd > segStart) {
        toErase.add(sector.start)
      }
    }
  }
  return [...toErase].sort((a, b) => a - b)
}

export class DfuSeDevice {
  constructor(
    private readonly usb: DfuUsbInterface,
    private readonly memory: readonly DfuMemorySector[],
    /** wTransferSize from the DFU functional descriptor (STM32 default 2048). */
    private readonly transferSize = 2048,
    private readonly sleep: DfuSleep = timerSleep
  ) {}

  async getStatus(): Promise<DfuStatus> {
    const bytes = await this.usb.controlIn(DFU_GETSTATUS, 0, 6)
    if (bytes.length < 6) {
      throw new Error('DFU GETSTATUS returned a short response')
    }
    return {
      status: bytes[0],
      pollTimeoutMs: bytes[1] | (bytes[2] << 8) | (bytes[3] << 16),
      state: bytes[4]
    }
  }

  async clearStatus(): Promise<void> {
    await this.usb.controlOut(DFU_CLRSTATUS, 0, new Uint8Array(0))
  }

  async abort(): Promise<void> {
    await this.usb.controlOut(DFU_ABORT, 0, new Uint8Array(0))
  }

  /** If the device is parked in an error state, clear it back to dfuIDLE. */
  async clearErrorState(): Promise<void> {
    let status = await this.getStatus()
    if (status.state === STATE_DFU_ERROR) {
      await this.clearStatus()
      status = await this.getStatus()
    }
    if (status.state !== STATE_DFU_IDLE && status.state !== STATE_DFU_DNLOAD_IDLE) {
      // Some bootloaders linger in a download/manifest-sync state; abort returns
      // them to dfuIDLE so the program sequence starts from a known point.
      await this.abort()
    }
  }

  /** Download a block (block 0 = DfuSe command; >=2 = data payload). */
  private async download(blockNumber: number, data: Uint8Array): Promise<void> {
    await this.usb.controlOut(DFU_DNLOAD, blockNumber, data)
  }

  /**
   * GETSTATUS that rides out a few STALLs. dfu-util does the same: some
   * bootloaders stall the status request while they are busy writing, and a
   * single stall used to abort the whole flash partway through.
   */
  private async getStatusTolerant(): Promise<DfuStatus> {
    for (let stalls = 0; ; stalls += 1) {
      try {
        return await this.getStatus()
      } catch (caught) {
        if (!isStall(caught) || stalls >= MAX_STATUS_STALLS) {
          throw caught
        }
        await this.sleep(STALL_BACKOFF_MS)
      }
    }
  }

  /**
   * GETSTATUS-poll until the device leaves its busy/sync states; throws on DFU error.
   *
   * After a sector erase, some H743 rev V system bootloaders stay in dfuDNBUSY
   * past the wait they asked for and never leave it. Betaflight found that
   * STM32CubeProgrammer recovers them with two CLRSTATUS requests (the first
   * answers dfuERROR, the second dfuIDLE); the erase itself has completed. Only
   * a sector erase still busy long past any real erase gets that: a board that
   * is merely still erasing stalls a CLRSTATUS (a real H743 erases for longer
   * than the wait it asks for). The read-back verify checks the result either way.
   */
  private async pollUntilIdle(kind: 'command' | 'erase' | 'mass-erase' | 'block' = 'command'): Promise<DfuStatus> {
    let status = await this.getStatusTolerant()
    const started = Date.now()
    let waitedMs = 0
    while (
      status.state === STATE_DFU_DNBUSY ||
      status.state === STATE_DFU_DNLOAD_SYNC ||
      status.state === STATE_DFU_MANIFEST_SYNC ||
      status.state === STATE_DFU_MANIFEST
    ) {
      // Counted both ways: the waits asked for, and the clock (a board that asks for no wait at all).
      const busyMs = Math.max(waitedMs, Date.now() - started)
      if (kind === 'erase' && busyMs >= ERASE_WEDGED_AFTER_MS && status.state === STATE_DFU_DNBUSY) {
        return this.unwedgeAfterErase()
      }
      const wait = Math.max(status.pollTimeoutMs, 1)
      await this.sleep(wait)
      waitedMs += wait
      status = await this.getStatusTolerant()
    }
    if (status.status !== STATUS_OK || status.state === STATE_DFU_ERROR) {
      throw new DfuStateError(status)
    }
    return status
  }

  private async unwedgeAfterErase(): Promise<DfuStatus> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await this.clearStatus()
      const status = await this.getStatusTolerant()
      if (status.state === STATE_DFU_IDLE) {
        return status
      }
    }
    throw new Error('The board stayed busy after a sector erase and did not recover')
  }

  /** Back to a state that accepts a new command after a failed transfer. */
  private async recover(): Promise<void> {
    const status = await this.getStatusTolerant()
    if (status.state === STATE_DFU_ERROR) {
      await this.clearStatus()
    } else if (status.state !== STATE_DFU_IDLE) {
      await this.abort()
    }
  }

  /** DfuSe command: set the flash address pointer for subsequent block writes. */
  private async setAddress(address: number): Promise<void> {
    await this.download(0, encodeCommand(DFUSE_SET_ADDRESS, address))
    await this.pollUntilIdle()
  }

  /** DfuSe command: erase the flash page/sector containing `address`. Erasing
   *  twice is harmless, so a stalled erase is sent again from idle. */
  private async eraseSector(address: number): Promise<void> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        await this.download(0, encodeCommand(DFUSE_ERASE, address))
        await this.pollUntilIdle('erase')
        return
      } catch (caught) {
        if (attempt >= MAX_CHUNK_ATTEMPTS || !isStall(caught)) {
          throw caught
        }
        await this.recover()
      }
    }
  }

  /** DfuSe mass erase (ERASE command with no address) — whole chip in one op.
   *  Used for a full wipe when the memory layout isn't enumerable. */
  private async massErase(): Promise<void> {
    await this.download(0, new Uint8Array([DFUSE_ERASE]))
    await this.pollUntilIdle('mass-erase')
  }

  /** Read programmed chunks back over DFU UPLOAD and byte-compare them to what
   *  was written; throws on the first mismatch. Per ST AN3156 the DfuSe read
   *  sequence is abort -> set-address -> abort -> UPLOAD blocks 2,3,... from
   *  that address, so each run of back-to-back full blocks is one read. */
  private async verifyChunks(chunks: readonly DfuChunk[], onVerified: (bytes: number) => void): Promise<void> {
    let index = 0
    while (index < chunks.length) {
      const runStart = index
      index = await this.retryReads(() => this.verifyRun(chunks, runStart, onVerified))
    }
  }

  /**
   * A read (UPLOAD, and the ABORTs around it) changes nothing on the board, so
   * a stall in one is retried from the top after returning the board to idle.
   */
  private async retryReads<T>(read: () => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await read()
      } catch (caught) {
        if (attempt >= MAX_CHUNK_ATTEMPTS || !isStall(caught)) {
          throw caught
        }
        await this.recover()
      }
    }
  }

  /** Verify one run of back-to-back chunks from `index`; returns the index after it. */
  private async verifyRun(chunks: readonly DfuChunk[], from: number, onVerified: (bytes: number) => void): Promise<number> {
    let index = from
    let verifiedHere = 0
    try {
      const start = chunks[index].address
      await this.abort()
      await this.setAddress(start)
      await this.abort()
      let block = 2
      for (;;) {
        const chunk = chunks[index]
        const got = await this.usb.controlIn(DFU_UPLOAD, block, chunk.data.length)
        if (!bytesEqual(got, chunk.data)) {
          throw new Error(
            `Verification failed at 0x${chunk.address.toString(16)} — flash read-back does not match the firmware image`
          )
        }
        verifiedHere += chunk.data.length
        onVerified(chunk.data.length)
        index += 1
        block += 1
        const next = chunks[index]
        if (!next || chunk.data.length !== this.transferSize || next.address !== chunk.address + chunk.data.length) {
          break
        }
      }
    } catch (caught) {
      // A retried run is read again from its start; take back its progress.
      onVerified(-verifiedHere)
      throw caught
    }
    return index
  }

  /** Erase sectors one by one, saying which one is under way: a sector takes
   *  seconds on an H7, so a bar that moved only when one finished sat still. */
  private async eraseSectors(
    starts: readonly number[],
    kept: ReadonlySet<number>,
    onProgress?: (progress: DfuFlashProgress) => void
  ): Promise<void> {
    const keptNote = kept.size > 0 ? '; bootloader unchanged, left in place' : ''
    for (let i = 0; i < starts.length; i += 1) {
      onProgress?.({
        phase: 'erase',
        ratio: i / starts.length,
        label: `Erasing sector ${i + 1} of ${starts.length} at 0x${starts[i].toString(16).toUpperCase().padStart(8, '0')}${keptNote}`
      })
      await this.eraseSector(starts[i])
    }
    onProgress?.({ phase: 'erase', ratio: 1, label: `Erased ${starts.length} sector(s)${keptNote}` })
  }

  /** Read `length` bytes from `address` over DFU UPLOAD, then return to idle. */
  private async readRange(address: number, length: number): Promise<Uint8Array> {
    const bytes = new Uint8Array(length)
    await this.abort()
    await this.setAddress(address)
    await this.abort()
    let block = 2
    for (let offset = 0; offset < length; offset += this.transferSize) {
      const size = Math.min(this.transferSize, length - offset)
      const got = await this.usb.controlIn(DFU_UPLOAD, block, size)
      if (got.length < size) {
        throw new Error(`DFU UPLOAD returned ${got.length} of ${size} bytes at 0x${(address + offset).toString(16)}`)
      }
      bytes.set(got.subarray(0, size), offset)
      block += 1
    }
    await this.abort()
    return bytes
  }

  /**
   * Sectors below the app that already hold exactly what the image would put
   * there -- normally the bootloader, unchanged from the last flash. Leaving
   * them alone closes the one window a cut-off flash could not otherwise
   * survive: between erasing the bootloader's sector and writing it back, the
   * board has nothing to boot and needs BOOT0.
   */
  private async unchangedSectorsBelow(appStart: number, segments: readonly IntelHexSegment[]): Promise<Set<number>> {
    const imageStart = Math.min(...segments.map((segment) => segment.address))
    const kept = new Set<number>()
    for (const sector of this.memory) {
      if (sector.start < imageStart || sector.start + sector.size > appStart || !sector.readable) {
        continue
      }
      const expected = new Uint8Array(sector.size).fill(0xff)
      for (const segment of segments) {
        const from = Math.max(sector.start, segment.address)
        const to = Math.min(sector.start + sector.size, segment.address + segment.data.length)
        if (from < to) {
          expected.set(segment.data.subarray(from - segment.address, to - segment.address), from - sector.start)
        }
      }
      const actual = await this.retryReads(() => this.readRange(sector.start, sector.size))
      if (bytesEqual(actual, expected)) {
        kept.add(sector.start)
      }
    }
    return kept
  }

  /**
   * Write one chunk at its own address (set-address, then block 2 -- as
   * dfu-util does -- so a chunk can be sent again on its own). A stall or a
   * DFU error is retried after returning the board to idle; a disconnect is
   * not. Resending a chunk the board had already started writing fails again
   * (flash cannot be rewritten without an erase), so a retry never hides a bad
   * write -- and the read-back verify checks everything regardless.
   */
  private async writeChunk(chunk: DfuChunk): Promise<void> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        await this.setAddress(chunk.address)
        await this.download(2, chunk.data)
        await this.pollUntilIdle('block')
        return
      } catch (caught) {
        if (attempt >= MAX_CHUNK_ATTEMPTS || !(isStall(caught) || caught instanceof DfuStateError)) {
          throw caught
        }
        await this.recover()
      }
    }
  }

  /**
   * Erase the sectors the image touches, program every segment block-by-block,
   * then manifest + leave DFU so the board boots the new firmware. Progress is
   * reported per phase.
   */
  /**
   * Sectors this image needs that the device reports as protected.
   *
   * Exposed so a caller can ask BEFORE flashing and put the decision in front
   * of the operator, rather than discovering it when the erase fails.
   */
  protectedSectorsFor(segments: readonly IntelHexSegment[]): DfuProtectedSector[] {
    return findProtectedSectors(this.memory, segments)
  }

  async flash(
    segments: readonly IntelHexSegment[],
    onProgress?: (progress: DfuFlashProgress) => void,
    options?: { fullErase?: boolean; allowProtectedSectors?: boolean }
  ): Promise<void> {
    if (segments.length === 0) {
      throw new Error('Nothing to flash: the firmware image is empty')
    }

    // Refuse by default when the board says it will not accept the write. The
    // operator can override — the device's own report is not always the whole
    // truth, and someone who has just cleared protection may know better — but
    // it must be a decision, not a surprise mid-erase.
    if (!options?.allowProtectedSectors) {
      const blocked = this.protectedSectorsFor(segments)
      if (blocked.length > 0) {
        throw new DfuProtectedSectorError(blocked)
      }
    }

    await this.clearErrorState()

    const appStart = findAppStart(segments, this.memory)
    const imageStartAddress = Math.min(...segments.map((segment) => segment.address))
    const checkBootloader = appStart !== undefined && appStart > imageStartAddress && this.memory.length > 0
    if (checkBootloader) {
      onProgress?.({ phase: 'erase', ratio: 0, label: 'Reading the bootloader already on the board' })
    }
    const kept = checkBootloader ? await this.unchangedSectorsBelow(appStart, segments) : new Set<number>()
    const inKeptSector = (address: number) =>
      this.memory.some((sector) => kept.has(sector.start) && address >= sector.start && address < sector.start + sector.size)

    // 1. Erase. Full-erase wipes the whole chip (every sector in the layout, or
    //    a mass-erase when the layout is unknown); otherwise erase only the
    //    sectors the image overlaps.
    if (options?.fullErase) {
      if (this.memory.length > 0) {
        // Sectors wholly below the image stay: an image without a bootloader
        // (one that starts at the app's address) must not erase the board's
        // bootloader, or the chip has nothing to boot.
        const imageStart = Math.min(...segments.map((segment) => segment.address))
        const all = this.memory
          .filter((sector) => sector.start + sector.size > imageStart && !kept.has(sector.start))
          .map((sector) => sector.start)
        await this.eraseSectors(all, kept, onProgress)
      } else {
        onProgress?.({ phase: 'erase', ratio: 0, label: 'Erasing the whole chip' })
        await this.massErase()
        onProgress?.({ phase: 'erase', ratio: 1, label: 'Erased the whole chip' })
      }
    } else if (this.memory.length === 0) {
      // No parseable sector map (the DFU alt exposed no memory layout), so we
      // can't compute which sectors the image overlaps. Erasing nothing and then
      // programming leaves stale bits set — STM32 flash only clears on erase — so
      // the written image is corrupt and fails verify. Fall back to a mass-erase
      // (same as the full-erase-without-a-layout path) rather than silently
      // programming onto un-erased flash.
      onProgress?.({ phase: 'erase', ratio: 0, label: 'Erasing the whole chip (the board gave no sector map)' })
      await this.massErase()
      onProgress?.({ phase: 'erase', ratio: 1, label: 'Erased the whole chip' })
    } else {
      const touched = sectorsToErase(this.memory, segments)
      if (touched.length === 0) {
        throw new Error('Firmware image lies outside the device flash memory map — refusing to flash')
      }
      const eraseTargets = touched.filter((start) => !kept.has(start))
      await this.eraseSectors(eraseTargets, kept, onProgress)
    }

    // 2. Program, then 3. verify. The app's first block -- its vector table --
    //    is held back until everything else is written and read back, then
    //    written and verified last. ArduPilot's bootloader will not start an
    //    app whose first words are blank (bl_protocol.cpp holds the same words
    //    back for the same reason), so a flash cut off at any point leaves a
    //    board that waits in its bootloader, ready to be flashed again, never
    //    one that jumps into a half-written app.
    const chunks = planDfuChunks(segments, this.transferSize).filter((chunk) => !inKeptSector(chunk.address))
    // Only the first flash word (32 bytes, ArduPilot's eight RESERVE_LEAD_WORDS)
    // is held back -- a power cut halfway through a whole held block could
    // otherwise land the vector table without the code behind it.
    const first = chunks.find((chunk) => chunk.address === appStart) ?? chunks[0]
    const held: DfuChunk = { address: first.address, data: first.data.slice(0, FLASH_WORD_BYTES) }
    const rest = chunks.flatMap((chunk) =>
      chunk !== first
        ? [chunk]
        : chunk.data.length > FLASH_WORD_BYTES
          ? [{ address: chunk.address + FLASH_WORD_BYTES, data: chunk.data.slice(FLASH_WORD_BYTES) }]
          : []
    )
    const totalBytes = chunks.reduce((sum, chunk) => sum + chunk.data.length, 0)
    let sentBytes = 0
    const programmed = (bytes: number) => {
      sentBytes += bytes
      onProgress?.({ phase: 'program', ratio: sentBytes / totalBytes, label: `Flashing ${formatBytes(sentBytes)} / ${formatBytes(totalBytes)}` })
    }
    let verifiedBytes = 0
    const verified = (bytes: number) => {
      verifiedBytes += bytes
      onProgress?.({ phase: 'verify', ratio: verifiedBytes / totalBytes, label: `Verifying ${formatBytes(verifiedBytes)} / ${formatBytes(totalBytes)}` })
    }
    for (const chunk of rest) {
      await this.writeChunk(chunk)
      programmed(chunk.data.length)
    }
    await this.verifyChunks(rest, verified)
    onProgress?.({ phase: 'verify', ratio: verifiedBytes / totalBytes, label: "Writing the firmware's first bytes, last" })
    await this.writeChunk(held)
    sentBytes += held.data.length
    await this.verifyChunks([held], verified)

    // 4. Manifest + leave: point at the image start and issue a zero-length
    //    download to leave DFU. The write + read-back already succeeded, so the
    //    whole leave sequence is best-effort — as the board detaches/resets the
    //    control transfers commonly stall (DFU_GETSTATUS, or even the leave
    //    DNLOAD itself). A stall here is the board leaving, i.e. SUCCESS — never
    //    surface it as a flash failure.
    onProgress?.({ phase: 'manifest', ratio: 0, label: 'Finishing and rebooting' })
    try {
      await this.setAddress(segments[0].address)
      await this.download(0, new Uint8Array(0))
      await this.getStatus()
    } catch {
      // Expected once the device re-enumerates into the application.
    }
    onProgress?.({ phase: 'manifest', ratio: 1, label: 'Finishing and rebooting' })
  }
}

/** A board's DFU status reported an error. */
export class DfuStateError extends Error {
  readonly status: number
  readonly state: number

  constructor(status: DfuStatus) {
    super(`DFU operation failed (status 0x${status.status.toString(16)}, state ${status.state})`)
    this.name = 'DfuStateError'
    this.status = status.status
    this.state = status.state
  }
}

function isStall(caught: unknown): boolean {
  // Chrome on Windows does not report a stalled control transfer as status
  // 'stall': WinUSB fails it, and WebUSB throws "A transfer error has occurred"
  // (NetworkError). A board that is gone throws NotFoundError instead.
  return (
    caught instanceof Error &&
    (/\bstall\b/i.test(caught.message) || caught.name === 'NetworkError' || /transfer error has occurred/i.test(caught.message))
  )
}

/** One write: at most transferSize bytes at an address. */
export interface DfuChunk {
  address: number
  data: Uint8Array
}

/**
 * Split the image into transferSize writes. Each segment's last write is
 * padded with 0xFF (erased flash) to a whole flash word, where the gap to the
 * next segment allows.
 */
export function planDfuChunks(segments: readonly IntelHexSegment[], transferSize: number): DfuChunk[] {
  const sorted = [...segments].sort((a, b) => a.address - b.address)
  const chunks: DfuChunk[] = []
  sorted.forEach((segment, index) => {
    for (let offset = 0; offset < segment.data.length; offset += transferSize) {
      let data = segment.data.slice(offset, offset + transferSize)
      const end = segment.address + offset + data.length
      const short = end % FLASH_WORD_BYTES
      if (offset + transferSize >= segment.data.length && short !== 0) {
        const next = sorted[index + 1]
        const room = next ? next.address - end : Number.POSITIVE_INFINITY
        const pad = Math.min(FLASH_WORD_BYTES - short, room, transferSize - data.length)
        if (pad > 0) {
          const padded = new Uint8Array(data.length + pad).fill(0xff)
          padded.set(data)
          data = padded
        }
      }
      chunks.push({ address: segment.address + offset, data })
    }
  })
  return chunks
}

function readWord(segments: readonly IntelHexSegment[], address: number): number | undefined {
  for (const segment of segments) {
    const offset = address - segment.address
    if (offset >= 0 && offset + 4 <= segment.data.length) {
      const d = segment.data
      return (d[offset] | (d[offset + 1] << 8) | (d[offset + 2] << 16) | (d[offset + 3] << 24)) >>> 0
    }
  }
  return undefined
}

function looksLikeVectorTable(segments: readonly IntelHexSegment[], address: number, imageEnd: number): boolean {
  const stack = readWord(segments, address)
  const reset = readWord(segments, address + 4)
  if (stack === undefined || reset === undefined) {
    return false
  }
  // Initial stack pointer in RAM (CCM / SRAM / H7 AXI SRAM / H7 D2 SRAM), and a
  // Thumb reset handler inside the image.
  const ram = [0x10000000, 0x20000000, 0x24000000, 0x30000000].some((base) => stack > base && stack <= base + 0x100000)
  // STM32F7 builds may start through the ITCM alias of flash (0x0020_0000 maps 0x0800_0000).
  const target = reset >= 0x00200000 && reset < 0x00400000 ? reset - 0x00200000 + 0x08000000 : reset
  return ram && (stack & 3) === 0 && (reset & 1) === 1 && target > address && target < imageEnd
}

/**
 * Where the app starts in this image: the first sector boundary past the
 * image's start that holds a Cortex-M vector table (a _with_bl image: the
 * bootloader sits below it), else the image's start when that holds one (an
 * app-only image). Undefined when neither does.
 */
export function findAppStart(segments: readonly IntelHexSegment[], sectors: readonly DfuMemorySector[]): number | undefined {
  if (segments.length === 0) {
    return undefined
  }
  const imageStart = Math.min(...segments.map((segment) => segment.address))
  const imageEnd = Math.max(...segments.map((segment) => segment.address + segment.data.length))
  for (const sector of sectors) {
    if (sector.start > imageStart && sector.start < imageEnd && looksLikeVectorTable(segments, sector.start, imageEnd)) {
      return sector.start
    }
  }
  return looksLikeVectorTable(segments, imageStart, imageEnd) ? imageStart : undefined
}

function encodeCommand(command: number, address: number): Uint8Array {
  return new Uint8Array([
    command,
    address & 0xff,
    (address >>> 8) & 0xff,
    (address >>> 16) & 0xff,
    (address >>> 24) & 0xff
  ])
}

function formatBytes(bytes: number): string {
  return bytes >= 1024 ? `${(bytes / 1024).toFixed(0)} KiB` : `${bytes} bytes`
}

/** True when the first `expected.length` bytes of `got` match `expected`. The
 *  device may return a full transferSize buffer for a short final chunk, so
 *  only the expected prefix is compared. */
function bytesEqual(got: Uint8Array, expected: Uint8Array): boolean {
  if (got.length < expected.length) {
    return false
  }
  for (let i = 0; i < expected.length; i += 1) {
    if (got[i] !== expected[i]) {
      return false
    }
  }
  return true
}
