import type { Page } from '@playwright/test'

// A fake `navigator.serial` with ONE port behind it: an ArduPilot serial
// bootloader, modelled on Tools/AP_Bootloader/bl_protocol.cpp. It is the
// Web Serial counterpart of fake-dfu.ts: the app's whole .apj flash path
// (FirmwareFlasher -> WebSerialBootloaderSerial -> BootloaderClient) runs
// unchanged against it, so Playwright can drive the flash end to end in
// any Chromium build without a serial port on the machine.
//
// What it is faithful about, because this is what bit users in the field:
//
//   - the frame windows. After a PROG_MULTI command byte the bootloader
//     gives the host 50 ms for the length byte (cin(50)), 1000 ms per
//     payload byte and 200 ms for the EOC (wait_for_eoc(200)); every other
//     command wants its EOC within 2 ms (BOOT: 1000 ms). A missed window
//     is cmd_bad: INSYNC/INVALID, the frame is dropped and the write
//     address does NOT advance. Our client sends each frame as one write,
//     which always passes; the fake exists so a regression back to several
//     writes per frame fails here. In-page writes are too fast for the real
//     windows to catch that on their own, so `requireOneWriteFrames`
//     (default on) also refuses any PROG_MULTI frame whose bytes arrived in
//     more than one write() call -- the host stall the windows guard
//     against, made deterministic.
//   - what happens to the rest of a refused frame: the bootloader goes back
//     to reading command bytes, so the leftover length/payload/EOC bytes
//     are parsed as commands (mostly ignored, the odd one answered). The
//     client's post-refusal drain exists for exactly that tail.
//   - the GET_DEVICE gate: CHIP_ERASE and PROG_MULTI are refused until
//     GET_SYNC and the BL_REV / BOARD_ID / FW_SIZE queries have run this
//     session (CHECK_GET_DEVICE_FINISHED, mask 0xB).
//   - GET_CRC returns the bootloader's own CRC of the whole flash region:
//     the ArduPilot CRC-32 (reflected 0xEDB88320 table, init 0, no final
//     inversion) over the image plus 0xFF padding to the flash size.
//   - unknown command bytes are skipped in silence (`default: continue`);
//     commands a real bootloader knows but this fake does not implement
//     (extflash, READ_MULTI, OTP/SN/chip queries) answer INSYNC/INVALID.
//
// It runs in the page (addInitScript) and keeps time with performance.now()
// so the windows are measured against the host's real pacing. Replies are
// queued the moment the command completes, like a device answering over a
// USB CDC link; CHIP_ERASE and the post-BOOT drop are the only timers.

export interface FakeSerialOptions {
  /** The bootloader's board id (GET_DEVICE BOARD_ID). */
  boardId?: number
  boardRevision?: number
  /** FW_SIZE: the programmable region, which GET_CRC covers in full. */
  flashSize?: number
  /** Bootloader protocol revision (2-5). */
  bootloaderRevision?: number
  /**
   * The GET_VERSION reply (GIT_VERSION_EXTENDED). `null` answers
   * INSYNC/INVALID instead, the shape of a board built without
   * PROTO_GET_VERSION; the client then takes its re-sync path.
   */
  bootloaderVersion?: string | null
  usbVendorId?: number
  usbProductId?: number
  /** The device is present from page load; otherwise the test calls plug(). */
  plugged?: boolean
  /**
   * The browser already holds a grant for the port: getPorts() lists it and
   * plugging it in fires a `connect` event. Otherwise only requestPort()
   * (the picker) can reach it.
   */
  granted?: boolean
  /** CHIP_ERASE takes this long before its INSYNC/OK. */
  eraseMs?: number
  /** Answer INSYNC/INVALID to the `rejectProgMultiAt`-th PROG_MULTI frame, once. */
  rejectProgMultiOnce?: boolean
  /** 1-based index of the PROG_MULTI frame to refuse. */
  rejectProgMultiAt?: number
  /** Refuse a PROG_MULTI frame spread over more than one write() call. */
  requireOneWriteFrames?: boolean
}

export type FakeSerialState = 'unplugged' | 'plugged' | 'open' | 'rebooted'

export interface FakeSerialFrame {
  /** Command byte. */
  command: number
  /** 'ignored' is a byte the bootloader does not know: skipped, no reply. */
  status: 'ok' | 'invalid' | 'failed' | 'ignored'
  /** Distinct write() calls the frame's bytes came from. */
  writes: number
  /** PROG_MULTI only: the write address the frame was aimed at. */
  offset?: number
  /** PROG_MULTI / GET_DEVICE: the length / info argument. */
  arg?: number
  /** Why it was refused. */
  reason?: string
}

export interface FakeSerialStats {
  state: FakeSerialState
  granted: boolean
  opens: number
  baudRates: number[]
  /** write() calls on the port. */
  writes: number
  getPortsCalls: number
  requestPortCalls: number
  connectEvents: number
  disconnectEvents: number
  /** Every command the bootloader parsed, in order. */
  frames: FakeSerialFrame[]
  progMulti: {
    sent: number
    accepted: number
    refused: number
    injectedRefusals: number
    splitFrames: number
    windowMisses: number
  }
  erases: number
  crcQueries: number
  /** Highest address programmed since the last erase. */
  programmedBytes: number
  rebooted: boolean
  log: string[]
}

/** The in-page handle on window.__fakeSerial. */
export interface FakeSerialHandle extends FakeSerialStats {
  options: Required<FakeSerialOptions>
  /** The device appears: listed by getPorts() if granted, with a `connect` event. */
  plug(): void
  /** The device goes away mid-session: streams error, `disconnect` fires. */
  unplug(): void
  /** Flash contents [start, end) as lower-case hex. */
  flashHex(start: number, end: number): string
}

export function fakeSerialOptions(options: FakeSerialOptions = {}): Required<FakeSerialOptions> {
  return {
    boardId: options.boardId ?? 140,
    boardRevision: options.boardRevision ?? 0,
    flashSize: options.flashSize ?? 1966080,
    bootloaderRevision: options.bootloaderRevision ?? 5,
    bootloaderVersion: options.bootloaderVersion === undefined ? 'fake-bl-e2e' : options.bootloaderVersion,
    usbVendorId: options.usbVendorId ?? 0x1209,
    usbProductId: options.usbProductId ?? 0x5741,
    plugged: options.plugged ?? false,
    granted: options.granted ?? true,
    eraseMs: options.eraseMs ?? 300,
    rejectProgMultiOnce: options.rejectProgMultiOnce ?? false,
    rejectProgMultiAt: options.rejectProgMultiAt ?? 3,
    requireOneWriteFrames: options.requireOneWriteFrames ?? true
  }
}

/** The fake, as one self-contained function to run in the page before any
 *  app code (Playwright's addInitScript). */
export const fakeSerialInit = (options: Required<FakeSerialOptions>): void => {
  const INSYNC = 0x12
  const EOC = 0x20
  const OK = 0x10
  const INVALID = 0x13

  const GET_SYNC = 0x21
  const GET_DEVICE = 0x22
  const CHIP_ERASE = 0x23
  const PROG_MULTI = 0x27
  const GET_CRC = 0x29
  const GET_VERSION = 0x2f
  const REBOOT = 0x30
  // Known to bl_protocol.cpp, not implemented here: answered INSYNC/INVALID.
  const KNOWN_UNSUPPORTED = new Set([
    0x24, // CHIP_VERIFY
    0x28, // READ_MULTI
    0x2a, // GET_OTP
    0x2b, // GET_SN
    0x2c, // GET_CHIP
    0x2d, // SET_DELAY
    0x2e, // GET_CHIP_DES
    0x33, // SET_BAUD
    0x34, // EXTF_ERASE
    0x35, // EXTF_PROG_MULTI
    0x36, // EXTF_READ_MULTI
    0x37, // EXTF_GET_CRC
    0x40 // CHIP_FULL_ERASE
  ])

  const INFO_BL_REV = 1
  const INFO_BOARD_ID = 2
  const INFO_BOARD_REV = 3
  const INFO_FLASH_SIZE = 4
  // CHECK_GET_DEVICE_FINISHED(x): (x & 0xB) == 0xB -- BL_REV, BOARD_ID, FW_SIZE.
  const GET_DEVICE_DONE_MASK = 0x0b

  // ArduPilot CRC-32: the standard reflected table, state 0, no inversion.
  const crcTable = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    crcTable[n] = c >>> 0
  }
  const crc32 = (bytes: Uint8Array, state = 0): number => {
    let crc = state >>> 0
    for (let i = 0; i < bytes.length; i += 1) crc = (crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8)) >>> 0
    return crc >>> 0
  }

  const flash = new Uint8Array(options.flashSize).fill(0xff)

  const stats: FakeSerialStats = {
    state: options.plugged ? 'plugged' : 'unplugged',
    granted: options.granted,
    opens: 0,
    baudRates: [],
    writes: 0,
    getPortsCalls: 0,
    requestPortCalls: 0,
    connectEvents: 0,
    disconnectEvents: 0,
    frames: [],
    progMulti: { sent: 0, accepted: 0, refused: 0, injectedRefusals: 0, splitFrames: 0, windowMisses: 0 },
    erases: 0,
    crcQueries: 0,
    programmedBytes: 0,
    rebooted: false,
    log: []
  }
  const log = (line: string): void => {
    stats.log.push(`${performance.now().toFixed(1)} ${line}`)
  }

  // ---- the port's streams -------------------------------------------------
  let readController: ReadableStreamDefaultController<Uint8Array> | null = null
  let readable: ReadableStream<Uint8Array> | null = null
  let writable: WritableStream<Uint8Array> | null = null
  let writeSeq = 0

  const reply = (bytes: number[]): void => {
    try {
      readController?.enqueue(new Uint8Array(bytes))
    } catch {
      // Stream already closed (port dropped): the bytes go nowhere, as on a
      // device that re-enumerated.
    }
  }
  const word = (value: number): number[] => [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff]
  const syncResponse = (): void => reply([INSYNC, OK])
  const invalidResponse = (): void => reply([INSYNC, INVALID])

  // ---- bootloader state -------------------------------------------------------
  let doneSync = false
  let doneGetDeviceFlags = 0
  let address = 0
  let progMultiIndex = 0
  let injectedRefusal = false

  // The command parser. bl_protocol.cpp reads bytes one at a time with a
  // per-byte timeout; here the bytes arrive in write() chunks, so each byte
  // carries the write it came from and the time it arrived.
  type Expecting = 'command' | 'arg' | 'payload' | 'eoc'
  let expecting: Expecting = 'command'
  let command = 0
  let arg = 0
  let payload: number[] = []
  let frameWrites = new Set<number>()
  let windowMs = 0
  let lastByteAt = 0
  let windowTimer: ReturnType<typeof setTimeout> | undefined
  // CHIP_ERASE blocks the bootloader; bytes that arrive meanwhile queue up
  // in its UART buffer and are read once it is back.
  let busy = false
  const pendingBytes: Array<{ byte: number; writeId: number; at: number }> = []

  const resetParser = (): void => {
    expecting = 'command'
    payload = []
    frameWrites = new Set()
    if (windowTimer !== undefined) {
      clearTimeout(windowTimer)
      windowTimer = undefined
    }
  }

  const record = (status: FakeSerialFrame['status'], reason?: string): void => {
    const frame: FakeSerialFrame = { command, status, writes: frameWrites.size }
    if (command === PROG_MULTI) {
      frame.offset = address
      frame.arg = arg
    } else if (command === GET_DEVICE) {
      frame.arg = arg
    }
    if (reason) frame.reason = reason
    stats.frames.push(frame)
  }

  const cmdBad = (reason: string): void => {
    log(`cmd_bad 0x${command.toString(16)}: ${reason}`)
    if (command === PROG_MULTI && expecting !== 'command') {
      stats.progMulti.refused += 1
    }
    record('invalid', reason)
    invalidResponse()
    resetParser()
  }

  const getDeviceDone = (): boolean => (doneGetDeviceFlags & GET_DEVICE_DONE_MASK) === GET_DEVICE_DONE_MASK

  const startCommand = (byte: number, writeId: number): void => {
    command = byte
    arg = 0
    frameWrites = new Set([writeId])
    switch (byte) {
      case GET_SYNC:
      case GET_CRC:
      case GET_VERSION:
        expecting = 'eoc'
        windowMs = 2
        return
      case REBOOT:
        expecting = 'eoc'
        windowMs = 1000
        return
      case GET_DEVICE:
        expecting = 'arg'
        windowMs = 1000
        return
      case CHIP_ERASE:
        if (!doneSync || !getDeviceDone()) {
          expecting = 'eoc'
          cmdBad('CHIP_ERASE before GET_SYNC + GET_DEVICE this session')
          return
        }
        expecting = 'eoc'
        windowMs = 2
        return
      case PROG_MULTI:
        if (!doneSync || !getDeviceDone()) {
          expecting = 'arg'
          cmdBad('PROG_MULTI before GET_SYNC + GET_DEVICE this session')
          return
        }
        stats.progMulti.sent += 1
        progMultiIndex += 1
        expecting = 'arg'
        windowMs = 50
        return
      default:
        if (KNOWN_UNSUPPORTED.has(byte)) {
          expecting = 'eoc'
          cmdBad('command not supported by this fake')
          return
        }
        // bl_protocol.cpp `default: continue;` -- line noise is skipped.
        record('ignored')
        expecting = 'command'
    }
  }

  const handleArg = (byte: number): void => {
    arg = byte
    if (command === GET_DEVICE) {
      expecting = 'eoc'
      windowMs = 2
      return
    }
    // PROG_MULTI length: the same sanity checks as the bootloader, then the
    // optional injected refusal. Refusing here, with the payload still to
    // come, is the shape of a real refusal: the payload and EOC are then
    // read as commands, which is what the client's drain has to absorb.
    if (byte % 4 !== 0) {
      cmdBad(`PROG_MULTI length ${byte} not a multiple of 4`)
      return
    }
    if (address + byte > options.flashSize) {
      cmdBad(`PROG_MULTI past the end of flash (${address} + ${byte})`)
      return
    }
    if (options.rejectProgMultiOnce && !injectedRefusal && progMultiIndex === options.rejectProgMultiAt) {
      injectedRefusal = true
      stats.progMulti.injectedRefusals += 1
      cmdBad(`injected refusal of PROG_MULTI frame #${progMultiIndex}`)
      return
    }
    if (byte === 0) {
      expecting = 'eoc'
      windowMs = 200
    } else {
      expecting = 'payload'
      windowMs = 1000
    }
  }

  const rebootNow = (): void => {
    stats.rebooted = true
    stats.state = 'rebooted'
    plugged = false
    log('rebooted into the new firmware: port dropped')
    try {
      readController?.close()
    } catch {
      // already closed
    }
    dispatchPortEvent('disconnect')
  }

  const complete = (): void => {
    switch (command) {
      case GET_SYNC:
        doneSync = true
        record('ok')
        syncResponse()
        return
      case GET_DEVICE: {
        let value: number
        switch (arg) {
          case INFO_BL_REV:
            value = options.bootloaderRevision
            break
          case INFO_BOARD_ID:
            value = options.boardId
            break
          case INFO_BOARD_REV:
            value = options.boardRevision
            break
          case INFO_FLASH_SIZE:
            value = options.flashSize
            break
          default:
            cmdBad(`GET_DEVICE unknown info ${arg}`)
            return
        }
        doneGetDeviceFlags |= 1 << (arg - 1)
        record('ok')
        reply(word(value))
        syncResponse()
        return
      }
      case CHIP_ERASE:
        record('ok')
        busy = true
        resetParser()
        log(`CHIP_ERASE: busy for ${options.eraseMs} ms`)
        setTimeout(() => {
          flash.fill(0xff)
          address = 0
          stats.programmedBytes = 0
          stats.erases += 1
          busy = false
          syncResponse()
          log('CHIP_ERASE done')
          const queued = pendingBytes.splice(0)
          for (const { byte, writeId, at } of queued) onByte(byte, writeId, at)
          armWindowTimer()
        }, options.eraseMs)
        return
      case PROG_MULTI:
        record('ok')
        flash.set(payload, address)
        address += payload.length
        stats.programmedBytes = Math.max(stats.programmedBytes, address)
        stats.progMulti.accepted += 1
        syncResponse()
        return
      case GET_CRC:
        stats.crcQueries += 1
        record('ok')
        reply(word(crc32(flash)))
        syncResponse()
        return
      case GET_VERSION: {
        if (options.bootloaderVersion === null) {
          cmdBad('GET_VERSION not built into this bootloader')
          return
        }
        const text = new TextEncoder().encode(options.bootloaderVersion).subarray(0, 32)
        record('ok')
        reply(word(text.length))
        reply(Array.from(text))
        syncResponse()
        return
      }
      case REBOOT:
        record('ok')
        syncResponse()
        // sync_response(); delay(100); jump -- the USB device goes with it.
        setTimeout(rebootNow, 100)
        return
      default:
        cmdBad('unreachable')
    }
  }

  const onByte = (byte: number, writeId: number, at: number): void => {
    if (expecting !== 'command') {
      if (at - lastByteAt > windowMs) {
        if (command === PROG_MULTI) stats.progMulti.windowMisses += 1
        cmdBad(`byte arrived ${(at - lastByteAt).toFixed(1)} ms after the last, window ${windowMs} ms`)
      } else if (options.requireOneWriteFrames && command === PROG_MULTI && !frameWrites.has(writeId)) {
        stats.progMulti.splitFrames += 1
        cmdBad('PROG_MULTI frame split across write() calls')
      }
    }
    lastByteAt = at
    switch (expecting) {
      case 'command':
        startCommand(byte, writeId)
        return
      case 'arg':
        frameWrites.add(writeId)
        handleArg(byte)
        return
      case 'payload':
        frameWrites.add(writeId)
        payload.push(byte)
        if (payload.length === arg) {
          expecting = 'eoc'
          windowMs = 200
        }
        return
      case 'eoc':
        frameWrites.add(writeId)
        if (byte !== EOC) {
          cmdBad(`expected EOC, got 0x${byte.toString(16)}`)
          return
        }
        complete()
        resetParser()
    }
  }

  // Mid-command with nothing more arriving: the bootloader's cin() times
  // out on its own, without waiting for the host's next byte.
  const armWindowTimer = (): void => {
    if (windowTimer !== undefined) clearTimeout(windowTimer)
    windowTimer = undefined
    if (expecting === 'command' || busy) return
    const remaining = Math.max(0, windowMs - (performance.now() - lastByteAt))
    windowTimer = setTimeout(() => {
      windowTimer = undefined
      if (expecting === 'command') return
      if (command === PROG_MULTI) stats.progMulti.windowMisses += 1
      cmdBad(`no byte within ${windowMs} ms`)
    }, remaining + 1)
  }

  const feed = (chunk: Uint8Array): void => {
    const writeId = ++writeSeq
    stats.writes += 1
    const at = performance.now()
    if (windowTimer !== undefined) {
      clearTimeout(windowTimer)
      windowTimer = undefined
    }
    for (const byte of chunk) {
      if (busy) pendingBytes.push({ byte, writeId, at })
      else onByte(byte, writeId, at)
    }
    armWindowTimer()
  }

  // ---- the SerialPort -----------------------------------------------------
  let plugged = options.plugged
  let granted = options.granted

  const port = {
    readable: null as ReadableStream<Uint8Array> | null,
    writable: null as WritableStream<Uint8Array> | null,
    getInfo: () => ({ usbVendorId: options.usbVendorId, usbProductId: options.usbProductId }),
    open: async ({ baudRate }: { baudRate: number }): Promise<void> => {
      if (!plugged) throw new DOMException('Failed to open serial port.', 'NetworkError')
      if (readable) throw new DOMException('The port is already open.', 'InvalidStateError')
      stats.opens += 1
      stats.baudRates.push(baudRate)
      stats.state = 'open'
      log(`open at ${baudRate} baud`)
      readable = new ReadableStream<Uint8Array>({
        start(controller) {
          readController = controller
        },
        cancel() {
          readController = null
        }
      })
      writable = new WritableStream<Uint8Array>({
        write(chunk) {
          if (!plugged) throw new DOMException('The device has been lost.', 'NetworkError')
          feed(chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk as ArrayBuffer))
        }
      })
      port.readable = readable
      port.writable = writable
    },
    close: async (): Promise<void> => {
      log('close')
      try {
        readController?.close()
      } catch {
        // already closed by a reboot / unplug
      }
      readController = null
      readable = null
      writable = null
      port.readable = null
      port.writable = null
      resetParser()
      if (stats.state === 'open') stats.state = plugged ? 'plugged' : 'unplugged'
    }
  }

  // ---- navigator.serial ---------------------------------------------------
  class FakeSerial extends EventTarget {
    async getPorts(): Promise<unknown[]> {
      stats.getPortsCalls += 1
      return plugged && granted ? [port] : []
    }

    async requestPort(): Promise<unknown> {
      stats.requestPortCalls += 1
      if (!plugged) throw new DOMException('No port selected by the user.', 'NotFoundError')
      granted = true
      stats.granted = true
      log('requestPort: the operator picked the bootloader port')
      return port
    }
  }
  const serial = new FakeSerial()

  // The W3C SerialConnectionEvent carries the port on `.port`.
  function dispatchPortEvent(type: 'connect' | 'disconnect'): void {
    const event = new Event(type)
    Object.defineProperty(event, 'port', { value: port })
    if (type === 'connect') stats.connectEvents += 1
    else stats.disconnectEvents += 1
    serial.dispatchEvent(event)
  }

  const handle: FakeSerialHandle = Object.assign(stats, {
    options,
    plug(): void {
      if (plugged) return
      plugged = true
      stats.state = 'plugged'
      log(`plug (granted: ${granted})`)
      // Only a granted port announces itself; an unknown one is reachable
      // through the picker alone.
      if (granted) dispatchPortEvent('connect')
    },
    unplug(): void {
      if (!plugged) return
      plugged = false
      stats.state = 'unplugged'
      log('unplug')
      try {
        readController?.error(new DOMException('The device has been lost.', 'NetworkError'))
      } catch {
        // not open
      }
      if (granted) dispatchPortEvent('disconnect')
    },
    flashHex(start: number, end: number): string {
      return Array.from(flash.subarray(start, end), (b) => b.toString(16).padStart(2, '0')).join('')
    }
  })

  Object.defineProperty(navigator, 'serial', { configurable: true, value: serial })
  ;(window as unknown as { __fakeSerial: FakeSerialHandle }).__fakeSerial = handle
}

export async function installFakeSerial(page: Page, options: FakeSerialOptions = {}): Promise<void> {
  await page.addInitScript(fakeSerialInit, fakeSerialOptions(options))
}

/** The fake's counters and frame log (the in-page methods are not carried over). */
export async function fakeSerialStats(page: Page): Promise<FakeSerialStats> {
  return page.evaluate(() => {
    const handle = (window as unknown as { __fakeSerial: FakeSerialHandle }).__fakeSerial
    return JSON.parse(JSON.stringify(handle)) as FakeSerialStats
  })
}

/** Plug the device in (fires `connect` when the port is granted). */
export async function plugFakeSerial(page: Page): Promise<void> {
  await page.evaluate(() => (window as unknown as { __fakeSerial: FakeSerialHandle }).__fakeSerial.plug())
}

/** Flash contents [start, end) as hex. */
export async function fakeSerialFlashHex(page: Page, start: number, end: number): Promise<string> {
  return page.evaluate(
    ([from, to]) => (window as unknown as { __fakeSerial: FakeSerialHandle }).__fakeSerial.flashHex(from, to),
    [start, end] as const
  )
}
