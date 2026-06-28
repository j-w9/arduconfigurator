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

// DfuSe command bytes (download to block 0 = command channel).
const DFUSE_SET_ADDRESS = 0x21
const DFUSE_ERASE = 0x41

export interface DfuStatus {
  status: number
  pollTimeoutMs: number
  state: number
}

/** One erasable flash sector parsed from the DfuSe memory-layout string. */
export interface DfuMemorySector {
  start: number
  size: number
}

export type DfuFlashPhase = 'erase' | 'program' | 'manifest'

export interface DfuFlashProgress {
  phase: DfuFlashPhase
  /** 0..1 within the current phase. */
  ratio: number
  label: string
}

import type { IntelHexSegment } from './intel-hex.js'

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

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
      const match = def.trim().match(/^(\d+)\*(\d+)([\sKMkm])/)
      if (!match) {
        continue
      }
      const count = Number.parseInt(match[1], 10)
      const unit = match[3].toUpperCase()
      const size = Number.parseInt(match[2], 10) * (unit === 'M' ? 0x100000 : unit === 'K' ? 0x400 : 1)
      for (let s = 0; s < count; s += 1) {
        sectors.push({ start: address, size })
        address += size
      }
    }
  }
  return sectors
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
    private readonly transferSize = 2048
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

  /** GETSTATUS-poll until the device leaves its busy/sync states; throws on DFU error. */
  private async pollUntilIdle(): Promise<DfuStatus> {
    let status = await this.getStatus()
    while (
      status.state === STATE_DFU_DNBUSY ||
      status.state === STATE_DFU_DNLOAD_SYNC ||
      status.state === STATE_DFU_MANIFEST_SYNC ||
      status.state === STATE_DFU_MANIFEST
    ) {
      await sleep(Math.max(status.pollTimeoutMs, 1))
      status = await this.getStatus()
    }
    if (status.status !== STATUS_OK || status.state === STATE_DFU_ERROR) {
      throw new Error(`DFU operation failed (status 0x${status.status.toString(16)}, state ${status.state})`)
    }
    return status
  }

  /** DfuSe command: set the flash address pointer for subsequent block writes. */
  private async setAddress(address: number): Promise<void> {
    await this.download(0, encodeCommand(DFUSE_SET_ADDRESS, address))
    await this.pollUntilIdle()
  }

  /** DfuSe command: erase the flash page/sector containing `address`. */
  private async eraseSector(address: number): Promise<void> {
    await this.download(0, encodeCommand(DFUSE_ERASE, address))
    await this.pollUntilIdle()
  }

  /** DfuSe mass erase (ERASE command with no address) — whole chip in one op.
   *  Used for a full wipe when the memory layout isn't enumerable. */
  private async massErase(): Promise<void> {
    await this.download(0, new Uint8Array([DFUSE_ERASE]))
    await this.pollUntilIdle()
  }

  /**
   * Erase the sectors the image touches, program every segment block-by-block,
   * then manifest + leave DFU so the board boots the new firmware. Progress is
   * reported per phase.
   */
  async flash(
    segments: readonly IntelHexSegment[],
    onProgress?: (progress: DfuFlashProgress) => void,
    options?: { fullErase?: boolean }
  ): Promise<void> {
    if (segments.length === 0) {
      throw new Error('Nothing to flash: the firmware image is empty')
    }
    await this.clearErrorState()

    // 1. Erase. Full-erase wipes the whole chip (every sector in the layout, or
    //    a mass-erase when the layout is unknown); otherwise erase only the
    //    sectors the image overlaps.
    if (options?.fullErase) {
      if (this.memory.length > 0) {
        const all = this.memory.map((sector) => sector.start)
        for (let i = 0; i < all.length; i += 1) {
          await this.eraseSector(all[i])
          onProgress?.({ phase: 'erase', ratio: (i + 1) / all.length, label: `Full chip erase (${all.length} sectors)` })
        }
      } else {
        await this.massErase()
        onProgress?.({ phase: 'erase', ratio: 1, label: 'Full chip erase' })
      }
    } else {
      const eraseTargets = sectorsToErase(this.memory, segments)
      if (this.memory.length > 0 && eraseTargets.length === 0) {
        throw new Error('Firmware image lies outside the device flash memory map — refusing to flash')
      }
      for (let i = 0; i < eraseTargets.length; i += 1) {
        await this.eraseSector(eraseTargets[i])
        onProgress?.({ phase: 'erase', ratio: (i + 1) / eraseTargets.length, label: `Erasing ${eraseTargets.length} sector(s)` })
      }
    }

    // 2. Program each segment in transferSize blocks (set address pointer per
    //    segment, then stream blocks 2,3,4,... per ST AN3156).
    const totalBytes = segments.reduce((sum, segment) => sum + segment.data.length, 0)
    let sentBytes = 0
    for (const segment of segments) {
      await this.setAddress(segment.address)
      let block = 2
      for (let offset = 0; offset < segment.data.length; offset += this.transferSize) {
        const chunk = segment.data.slice(offset, offset + this.transferSize)
        await this.download(block, chunk)
        await this.pollUntilIdle()
        block += 1
        sentBytes += chunk.length
        onProgress?.({ phase: 'program', ratio: sentBytes / totalBytes, label: `Writing ${formatBytes(totalBytes)}` })
      }
    }

    // 3. Manifest + leave: point at the image start and issue a zero-length
    //    download. The board resets into the new firmware, so the final status
    //    read may fail as the device drops off the bus — that is success.
    onProgress?.({ phase: 'manifest', ratio: 0, label: 'Finishing and rebooting' })
    await this.setAddress(segments[0].address)
    await this.download(0, new Uint8Array(0))
    try {
      await this.getStatus()
    } catch {
      // Expected: the device re-enumerated into the application.
    }
    onProgress?.({ phase: 'manifest', ratio: 1, label: 'Finishing and rebooting' })
  }
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
