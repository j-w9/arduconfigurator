// Entering Betaflight's ESC 4-way passthrough, over a raw byte pipe.
//
// Why this does not use MspSession: SET_PASSTHROUGH is the command that stops
// the link being MSP. Once the FC replies, every byte on that port belongs to
// the sub-device, and an MSP decoder still subscribed to the transport will
// eat the sub-device's replies. MspSession.connect() installs exactly such a
// subscription for the life of the session, so the passthrough handshake is
// done here against a byte pipe the caller also owns afterwards. The same
// sidestep already exists for the CLI (`MspSession.readCliDiff` drives the
// transport directly rather than through its own decoder).

import { MSP_COMMANDS } from './constants.js'
import { MspV1Decoder, encodeMspV1Request } from './msp-v1-codec.js'
import type { MspFrame } from './msp-v1-codec.js'

/**
 * The byte pipe this needs: write, read exactly `n` bytes or time out, and
 * optionally discard what is already buffered.
 *
 * Declared structurally rather than imported so `protocol-msp` takes on no new
 * package dependency. `BootloaderSerial` (`@arduconfig/firmware-flash`) and the
 * byte sessions in `@arduconfig/transport` both satisfy it as they are.
 */
export interface PassthroughSerial {
  write(data: Uint8Array): Promise<void>
  read(n: number, timeoutMs: number): Promise<Uint8Array>
  flushInput?(): Promise<void> | void
}

export interface EnterPassthroughOptions {
  /** Bound on the MSP_API_VERSION handshake. */
  handshakeTimeoutMs?: number
  /**
   * Bound on the SET_PASSTHROUGH reply. Longer than the handshake on purpose:
   * the FC initialises the 4-way interface before it answers.
   */
  passthroughTimeoutMs?: number
}

const DEFAULTS = {
  handshakeTimeoutMs: 2000,
  passthroughTimeoutMs: 4000
} as const

/**
 * One MSP v1 request and its reply, over a byte pipe.
 *
 * Bytes are fed through `MspV1Decoder`, so boot chatter or a stale reply ahead
 * of ours costs a resync rather than a desynced read: the decoder rescans from
 * the next `$M`, and a frame answering a different command is skipped. An
 * error reply (`$M!`) throws — the FC understood the framing and refused.
 */
export async function mspRequestOverSerial(
  serial: PassthroughSerial,
  command: number,
  payload: Uint8Array = new Uint8Array(),
  timeoutMs: number = DEFAULTS.handshakeTimeoutMs
): Promise<MspFrame> {
  await serial.flushInput?.()
  await serial.write(encodeMspV1Request(command, payload))

  const decoder = new MspV1Decoder()
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const remaining = deadline - Date.now()
    if (remaining <= 0) {
      throw new Error(`no MSP reply to command ${command} in ${timeoutMs} ms`)
    }
    const chunk = await serial.read(1, remaining)
    for (const frame of decoder.push(chunk)) {
      if (frame.isError) {
        throw new Error(
          `the flight controller rejected MSP command ${command}; ` +
            'it may not support ESC 4-way passthrough'
        )
      }
      if (frame.command === command) {
        return frame
      }
    }
  }
}

/**
 * Hand the port to the ESC 4-way interface, and return how many ESC outputs
 * the flight controller will bridge to.
 *
 * MSP_API_VERSION goes first purely to prove something is speaking MSP here
 * before the link stops being MSP — a board commonly presents more than one
 * USB serial port and only one of them carries it, and failing at this point
 * is a clear "wrong port" rather than a silent 4-way timeout later.
 *
 * On return the caller owns every byte on the port until it sends the 4-way
 * interface's own exit command; nothing here reads from it again.
 */
export async function enterPassthrough(
  serial: PassthroughSerial,
  options: EnterPassthroughOptions = {}
): Promise<number> {
  const handshakeTimeoutMs = options.handshakeTimeoutMs ?? DEFAULTS.handshakeTimeoutMs
  const passthroughTimeoutMs = options.passthroughTimeoutMs ?? DEFAULTS.passthroughTimeoutMs

  await mspRequestOverSerial(serial, MSP_COMMANDS.API_VERSION, new Uint8Array(), handshakeTimeoutMs)

  const reply = await mspRequestOverSerial(
    serial,
    MSP_COMMANDS.SET_PASSTHROUGH,
    new Uint8Array(),
    passthroughTimeoutMs
  )

  // Betaflight answers with esc4wayInit()'s return value: the output count.
  // An empty payload means it took the command but bridged nothing, which is
  // not a link worth driving.
  if (reply.payload.length === 0) {
    throw new Error('the flight controller entered passthrough but reported no ESC outputs')
  }
  return reply.payload[0]
}
