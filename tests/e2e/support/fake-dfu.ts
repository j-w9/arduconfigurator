import type { Page } from '@playwright/test'

// A fake STM32 system-bootloader DFU device behind navigator.usb, modelled on
// how the real one paces a flash: every DNLOAD (a block, an erase, a
// set-address) puts it in dfuDNLOAD-SYNC; the next GETSTATUS answers dfuDNBUSY
// with a bwPollTimeout, and it stays busy until that much real time has
// passed. A host that polls early just gets dfuDNBUSY again; a host that sends
// another DNLOAD while it is busy gets dfuERROR, as the real ROM would.
//
// It keeps time with performance.now() and answers every transfer at once --
// never with a timer -- because a real USB transfer completes on the USB
// stack's schedule, not the page's. A timer here would itself be throttled in
// a background tab and hide exactly what a test wants to see.

export interface FakeDfuOptions {
  /** wTransferSize the device reports. */
  transferSize?: number
  /** How long a block takes to program, ms. */
  programMs?: number
  /** How long one sector erase takes, ms. */
  eraseMs?: number
  /** The DfuSe memory layout string. */
  layout?: string
}

export interface FakeDfuStats {
  blocks: number
  erases: number
  /** GETSTATUS polls answered busy (the host asked before the device was done). */
  earlyPolls: number
  /** DNLOADs refused because the device was still busy. */
  refused: number
  /** Longest gap between two host transfers, ms. */
  longestGapMs: number
  /** Flash bytes written, by address. */
  written: number
}

/** The fake device, as a self-contained function to run in the page before
 *  any app code (Playwright's addInitScript, or CDP's
 *  Page.addScriptToEvaluateOnNewDocument as `(fn)(options)`). */
export const fakeDfuInit = ({ transferSize, programMs, eraseMs, layout }: Required<FakeDfuOptions>): void => {
  const STATE_IDLE = 2
  const STATE_DNLOAD_SYNC = 3
  const STATE_DNBUSY = 4
  const STATE_DNLOAD_IDLE = 5
  const STATE_ERROR = 10
  const flash = new Map<number, number>()
  const stats = { blocks: 0, erases: 0, earlyPolls: 0, refused: 0, longestGapMs: 0, written: 0 }
  ;(window as unknown as { __fakeDfu: typeof stats }).__fakeDfu = stats
  let state = STATE_IDLE
  let status = 0
  let busyMs = 0
  let busyUntil = 0
  let addrPtr = 0
  let lastTransfer = 0
  const touch = () => {
    const now = performance.now()
    if (lastTransfer > 0) stats.longestGapMs = Math.max(stats.longestGapMs, now - lastTransfer)
    lastTransfer = now
    return now
  }
  const statusBytes = (pollMs: number) => {
    const poll = Math.max(0, Math.ceil(pollMs))
    return new DataView(new Uint8Array([status, poll & 0xff, (poll >> 8) & 0xff, (poll >> 16) & 0xff, state, 0]).buffer)
  }
  const device = {
    productName: 'STM32 BOOTLOADER',
    configuration: {
      interfaces: [
        {
          interfaceNumber: 0,
          alternates: [{ alternateSetting: 0, interfaceClass: 0xfe, interfaceSubclass: 0x01, interfaceName: layout }]
        }
      ]
    },
    open: async () => {},
    close: async () => {},
    selectConfiguration: async () => {},
    claimInterface: async () => {},
    releaseInterface: async () => {},
    selectAlternateInterface: async () => {},
    controlTransferIn: async (setup: { requestType: string; request: number; value: number }, length: number) => {
      const now = touch()
      if (setup.requestType === 'standard' && setup.request === 6) {
        // Configuration descriptor: one DFU functional descriptor carrying wTransferSize.
        return {
          status: 'ok',
          data: new DataView(new Uint8Array([0x09, 0x21, 0x0b, 0xff, 0x00, transferSize & 0xff, transferSize >> 8, 0x1a, 0x01]).buffer)
        }
      }
      if (setup.request === 3) {
        // GETSTATUS
        if (state === STATE_DNLOAD_SYNC) {
          state = STATE_DNBUSY
          busyUntil = now + busyMs
          return { status: 'ok', data: statusBytes(busyMs) }
        }
        if (state === STATE_DNBUSY) {
          if (now < busyUntil) {
            stats.earlyPolls += 1
            return { status: 'ok', data: statusBytes(busyUntil - now) }
          }
          state = STATE_DNLOAD_IDLE
        }
        return { status: 'ok', data: statusBytes(0) }
      }
      if (setup.request === 2) {
        // UPLOAD (read-back verify)
        const base = addrPtr + (setup.value - 2) * transferSize
        const buf = new Uint8Array(length)
        for (let i = 0; i < length; i += 1) buf[i] = flash.get(base + i) ?? 0xff
        return { status: 'ok', data: new DataView(buf.buffer) }
      }
      return { status: 'ok', data: new DataView(new Uint8Array(6).buffer) }
    },
    controlTransferOut: async (setup: { request: number; value: number }, data?: ArrayBuffer) => {
      touch()
      const bytes = data ? new Uint8Array(data) : new Uint8Array(0)
      if (setup.request === 4) {
        // CLRSTATUS
        state = STATE_IDLE
        status = 0
      } else if (setup.request === 6) {
        // ABORT
        state = STATE_IDLE
      } else if (setup.request === 1) {
        // DNLOAD
        if (state === STATE_DNBUSY || state === STATE_DNLOAD_SYNC || state === STATE_ERROR) {
          stats.refused += 1
          state = STATE_ERROR
          status = 0x0e // errUNKNOWN
          return { status: 'ok' }
        }
        if (setup.value === 0 && bytes.length === 0) {
          state = STATE_IDLE // leave
        } else if (setup.value === 0 && bytes[0] === 0x21) {
          addrPtr = (bytes[1] | (bytes[2] << 8) | (bytes[3] << 16) | (bytes[4] << 24)) >>> 0
          busyMs = 1
          state = STATE_DNLOAD_SYNC
        } else if (setup.value === 0 && bytes[0] === 0x41) {
          stats.erases += 1
          busyMs = eraseMs
          state = STATE_DNLOAD_SYNC
        } else if (setup.value >= 2) {
          const base = addrPtr + (setup.value - 2) * transferSize
          for (let i = 0; i < bytes.length; i += 1) flash.set(base + i, bytes[i])
          stats.blocks += 1
          stats.written += bytes.length
          busyMs = programMs
          state = STATE_DNLOAD_SYNC
        }
      }
      return { status: 'ok' }
    }
  }
  Object.defineProperty(navigator, 'usb', { configurable: true, value: { requestDevice: async () => device } })
}

export function fakeDfuOptions(options: FakeDfuOptions = {}): Required<FakeDfuOptions> {
  return {
    transferSize: options.transferSize ?? 1024,
    programMs: options.programMs ?? 5,
    eraseMs: options.eraseMs ?? 50,
    layout: options.layout ?? '@Internal Flash  /0x08000000/16*128Kg'
  }
}

export async function installFakeDfu(page: Page, options: FakeDfuOptions = {}): Promise<void> {
  await page.addInitScript(fakeDfuInit, fakeDfuOptions(options))
}

export async function fakeDfuStats(page: Page): Promise<FakeDfuStats> {
  return page.evaluate(() => (window as unknown as { __fakeDfu: FakeDfuStats }).__fakeDfu)
}

/** An Intel HEX image of `size` bytes of varied data at `base`. */
export function intelHexImage(size: number, base = 0x08000000): string {
  const record = (type: number, addr: number, data: number[]) => {
    const bytes = [data.length, (addr >> 8) & 0xff, addr & 0xff, type, ...data]
    const sum = bytes.reduce((acc, b) => (acc + b) & 0xff, 0)
    bytes.push((0x100 - sum) & 0xff)
    return ':' + bytes.map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase()
  }
  const lines: string[] = []
  let upper = -1
  for (let offset = 0; offset < size; offset += 16) {
    const address = base + offset
    if (address >>> 16 !== upper) {
      upper = address >>> 16
      lines.push(record(0x04, 0, [(upper >> 8) & 0xff, upper & 0xff]))
    }
    const data = Array.from({ length: Math.min(16, size - offset) }, (_u, i) => (offset + i * 7) & 0xff)
    lines.push(record(0x00, address & 0xffff, data))
  }
  lines.push(':00000001FF')
  return lines.join('\n')
}
