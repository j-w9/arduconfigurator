// SLCAN (Lawicel ASCII CAN over a serial port), as USB-CAN adapters and
// ArduPilot's own SLCAN port speak it -- plus the adapter interface the CAN
// tab drives, so a later adapter (SocketCAN on the desktop) plugs in the same.
//
// Wire format (one command per line, '\r' terminated):
//   t<iii><L><dd..>         standard data frame, DLC one digit 0-8
//   T<iiiiiiii><L><dd..>    extended data frame
//   r<iii><L> / R<iiiiiiii><L>   remote frames
//   d / D                    CAN FD (ArduPilot), DLC one hex digit 0-F
//   ... optionally followed by a 4-hex-digit timestamp (ms, wraps at 60000)
// Commands: S0..S8 bitrate, O open, L listen-only, C close, V version.
// Replies: '\r' ok, '\a' (BEL) error; a sent frame is acked 'z\r' / 'Z\r'.
// ArduPilot: libraries/AP_CANManager/AP_SLCANIface.cpp.

import { CAN_EFF_FLAG, CAN_RTR_FLAG, canDlcForLength, canLengthForDlc, type CanFrameInput } from './frame.js'

/** The Lawicel S-codes. */
export const SLCAN_BITRATES = [
  { code: 0, bitrate: 10_000 },
  { code: 1, bitrate: 20_000 },
  { code: 2, bitrate: 50_000 },
  { code: 3, bitrate: 100_000 },
  { code: 4, bitrate: 125_000 },
  { code: 5, bitrate: 250_000 },
  { code: 6, bitrate: 500_000 },
  { code: 7, bitrate: 800_000 },
  { code: 8, bitrate: 1_000_000 }
] as const

export function slcanBitrateCommand(bitrate: number): string | undefined {
  const entry = SLCAN_BITRATES.find((candidate) => candidate.bitrate === bitrate)
  return entry ? `S${entry.code}\r` : undefined
}

/** A frame to put on the bus. */
export interface CanAdapterFrame {
  id: number
  extended: boolean
  data: Uint8Array
  fd?: boolean
  rtr?: boolean
}

const hex = (value: number, digits: number) => (value >>> 0).toString(16).toUpperCase().padStart(digits, '0').slice(-digits)

/** One frame as an SLCAN command, '\r' included. FD payloads pad to the next valid FD length. */
export function encodeSlcanFrame(frame: CanAdapterFrame): string {
  const fd = frame.fd ?? false
  const rtr = !fd && (frame.rtr ?? false)
  if (!fd && frame.data.length > 8) throw new Error('A classic frame carries at most 8 bytes.')
  if (frame.data.length > 64) throw new Error('A CAN FD frame carries at most 64 bytes.')
  const dlc = fd ? canDlcForLength(frame.data.length) : frame.data.length
  const length = fd ? canLengthForDlc(dlc) : frame.data.length
  const type = rtr ? (frame.extended ? 'R' : 'r') : fd ? (frame.extended ? 'D' : 'd') : frame.extended ? 'T' : 't'
  let line = type + (frame.extended ? hex(frame.id & 0x1fffffff, 8) : hex(frame.id & 0x7ff, 3)) + dlc.toString(16).toUpperCase()
  if (!rtr) {
    for (let index = 0; index < length; index += 1) line += hex(frame.data[index] ?? 0, 2)
  }
  return `${line}\r`
}

export type SlcanLine =
  | { kind: 'frame'; rawId: number; data: Uint8Array; fd: boolean; adapterTimestampMs?: number }
  | { kind: 'ok' }
  | { kind: 'error' }
  | { kind: 'reply'; text: string }

const HEX = /^[0-9a-fA-F]*$/

/** One received line (without its '\r'). Undefined for anything unreadable. */
export function parseSlcanLine(line: string): SlcanLine | undefined {
  if (line === '' ) return { kind: 'ok' }
  const type = line[0]
  // Acks for frames this side sent.
  if ((type === 'z' || type === 'Z') && line.length === 1) return { kind: 'ok' }
  const extended = type === 'T' || type === 'R' || type === 'D'
  const isFrame = 'tTrRdD'.includes(type)
  if (!isFrame) return { kind: 'reply', text: line }
  const idDigits = extended ? 8 : 3
  const idText = line.slice(1, 1 + idDigits)
  const dlcText = line[1 + idDigits]
  if (idText.length !== idDigits || dlcText === undefined || !HEX.test(idText) || !HEX.test(dlcText)) return undefined
  const fd = type === 'd' || type === 'D'
  const rtr = type === 'r' || type === 'R'
  const dlc = Number.parseInt(dlcText, 16)
  if (!fd && dlc > 8) return undefined
  const length = fd ? canLengthForDlc(dlc) : dlc
  const id = Number.parseInt(idText, 16)
  if (extended ? id > 0x1fffffff : id > 0x7ff) return undefined
  let cursor = 2 + idDigits
  const data = new Uint8Array(rtr ? 0 : length)
  if (!rtr) {
    const dataText = line.slice(cursor, cursor + length * 2)
    if (dataText.length !== length * 2 || !HEX.test(dataText)) return undefined
    for (let index = 0; index < length; index += 1) data[index] = Number.parseInt(dataText.slice(index * 2, index * 2 + 2), 16)
    cursor += length * 2
  }
  // An optional 4-digit timestamp (and ArduPilot may add flag letters after it).
  const rest = line.slice(cursor)
  const stamp = /^[0-9a-fA-F]{4}/.test(rest) ? Number.parseInt(rest.slice(0, 4), 16) : undefined
  let rawId = id
  if (extended) rawId |= CAN_EFF_FLAG
  if (rtr) rawId |= CAN_RTR_FLAG
  return { kind: 'frame', rawId: rawId >>> 0, data, fd, adapterTimestampMs: stamp }
}

/** Splits a byte stream into SLCAN lines: '\r' ends a line, BEL is an error reply of its own. */
export class SlcanLineSplitter {
  private buffer = ''

  push(bytes: Uint8Array): SlcanLine[] {
    const out: SlcanLine[] = []
    for (const byte of bytes) {
      if (byte === 0x0d) {
        const parsed = parseSlcanLine(this.buffer)
        if (parsed) out.push(parsed)
        this.buffer = ''
      } else if (byte === 0x07) {
        out.push({ kind: 'error' })
        this.buffer = ''
      } else if (byte === 0x0a) {
        // Some adapters end lines "\r\n"; the '\n' starts nothing.
      } else if (byte >= 0x20 && byte < 0x7f) {
        this.buffer += String.fromCharCode(byte)
        // A runaway line (noise, the wrong port): drop it.
        if (this.buffer.length > 200) this.buffer = ''
      }
    }
    return out
  }

  reset(): void {
    this.buffer = ''
  }
}

/** A way onto a CAN bus that is not the autopilot's MAVLink forwarding. */
export interface CanAdapter {
  /** "SLCAN adapter", for the UI. */
  readonly label: string
  open(): Promise<void>
  close(): Promise<void>
  send(frame: CanAdapterFrame): Promise<void>
  /** Received frames. `bus` is always 1: an adapter is one bus. */
  onFrame(listener: (frame: CanFrameInput) => void): () => void
  /** The adapter went away (unplugged, port closed). */
  onClose(listener: (reason: string) => void): () => void
}

/** The byte pipe an SLCAN adapter sits on (a Web Serial port, in the browser). */
export interface SlcanByteIo {
  connect(): Promise<void>
  disconnect(): Promise<void>
  send(bytes: Uint8Array): Promise<void>
  onFrame(listener: (bytes: Uint8Array) => void): () => void
  onStatus(listener: (status: { kind: string; reason?: string; message?: string }) => void): () => void
}

export interface SlcanAdapterOptions {
  bitrate: number
  /** Open listen-only ('L'): the adapter never ACKs or sends. */
  listenOnly?: boolean
  /** How long open() waits for each command's reply. */
  replyTimeoutMs?: number
}

const encoder = new TextEncoder()

/** An SLCAN adapter on a byte pipe. */
export class SlcanAdapter implements CanAdapter {
  readonly label = 'SLCAN adapter'
  private readonly splitter = new SlcanLineSplitter()
  private readonly frameListeners = new Set<(frame: CanFrameInput) => void>()
  private readonly closeListeners = new Set<(reason: string) => void>()
  private unsubscribers: (() => void)[] = []
  private replyWaiter: ((line: SlcanLine | undefined) => void) | undefined
  private opened = false
  /** Frames the adapter refused (BEL after a send). */
  txErrors = 0

  constructor(
    private readonly io: SlcanByteIo,
    private readonly options: SlcanAdapterOptions
  ) {}

  async open(): Promise<void> {
    const bitrateCommand = slcanBitrateCommand(this.options.bitrate)
    if (!bitrateCommand) throw new Error(`${this.options.bitrate} bit/s is not an SLCAN bitrate.`)
    this.unsubscribers.push(
      this.io.onFrame((bytes) => this.handleBytes(bytes)),
      this.io.onStatus((status) => {
        if (this.opened && (status.kind === 'disconnected' || status.kind === 'error')) {
          this.opened = false
          const reason = status.message ?? status.reason ?? 'The adapter disconnected.'
          for (const listener of this.closeListeners) listener(reason)
        }
      })
    )
    try {
      await this.io.connect()
      // Clear whatever half-command the adapter holds, close it if it was left
      // open, then bitrate and open. A reply that never comes is tolerated
      // (some adapters stay silent); an explicit error is not.
      await this.io.send(encoder.encode('\r\r\r'))
      // The flush draws replies of its own (ArduPilot answers an empty line
      // with BEL); let them pass before anything is waited on.
      await new Promise((resolve) => setTimeout(resolve, this.options.replyTimeoutMs ?? 300))
      await this.command('C\r', true)
      if ((await this.command(bitrateCommand, true)) === 'error') throw new Error('The adapter refused the bitrate.')
      if ((await this.command(this.options.listenOnly ? 'L\r' : 'O\r', true)) === 'error') {
        throw new Error('The adapter refused to open the bus.')
      }
      this.opened = true
    } catch (error) {
      await this.teardown()
      throw error
    }
  }

  async close(): Promise<void> {
    if (this.opened) {
      this.opened = false
      try {
        await this.io.send(encoder.encode('C\r'))
      } catch {
        // Unplugged already.
      }
    }
    await this.teardown()
  }

  async send(frame: CanAdapterFrame): Promise<void> {
    if (!this.opened) throw new Error('Open the adapter first.')
    if (this.options.listenOnly) throw new Error('The adapter is open listen-only.')
    await this.io.send(encoder.encode(encodeSlcanFrame(frame)))
  }

  onFrame(listener: (frame: CanFrameInput) => void): () => void {
    this.frameListeners.add(listener)
    return () => this.frameListeners.delete(listener)
  }

  onClose(listener: (reason: string) => void): () => void {
    this.closeListeners.add(listener)
    return () => this.closeListeners.delete(listener)
  }

  private async teardown(): Promise<void> {
    for (const unsubscribe of this.unsubscribers) unsubscribe()
    this.unsubscribers = []
    this.splitter.reset()
    try {
      await this.io.disconnect()
    } catch {
      // Already gone.
    }
  }

  /** Send a command; resolve with the reply ('ok' / 'error'), or 'none' after the timeout. */
  private async command(text: string, waitForReply: boolean): Promise<'ok' | 'error' | 'none'> {
    this.replyWaiter = undefined
    const reply = waitForReply
      ? new Promise<SlcanLine | undefined>((resolve) => {
          const timer = setTimeout(() => {
            this.replyWaiter = undefined
            resolve(undefined)
          }, this.options.replyTimeoutMs ?? 300)
          this.replyWaiter = (line) => {
            clearTimeout(timer)
            this.replyWaiter = undefined
            resolve(line)
          }
        })
      : undefined
    await this.io.send(encoder.encode(text))
    const line = await reply
    return line === undefined ? 'none' : line.kind === 'error' ? 'error' : 'ok'
  }

  private handleBytes(bytes: Uint8Array): void {
    const now = Date.now()
    for (const line of this.splitter.push(bytes)) {
      if (line.kind === 'frame') {
        if (!this.opened) continue
        const input: CanFrameInput = { timestampMs: now, bus: 1, rawId: line.rawId, data: line.data, fd: line.fd, direction: 'rx' }
        for (const listener of this.frameListeners) listener(input)
        continue
      }
      if (this.replyWaiter && (line.kind === 'ok' || line.kind === 'error')) {
        this.replyWaiter(line)
        continue
      }
      if (line.kind === 'error' && this.opened) this.txErrors += 1
    }
  }
}
