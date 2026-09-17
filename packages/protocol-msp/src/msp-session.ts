// A request/reply session over any Transport.
//
// MSP has no sequence numbers or message ids: a reply is matched by its command
// byte and nothing else. So this issues one request at a time and waits for a
// reply carrying the same command, rather than pipelining — two in flight for
// the same command would be indistinguishable.

import type { Transport, Unsubscribe } from '@arduconfig/transport'

import { MSP_COMMANDS, MSP_REBOOT_MODES } from './constants.js'
import { encodeMspV1Request, MspV1Decoder, type MspFrame } from './msp-v1-codec.js'
import {
  decodeApiVersion,
  decodeBoardInfo,
  decodeFcVariant,
  decodeFcVersion,
  decodeSerialConfig,
  type MspBoardInfo,
  type MspSerialPortConfig
} from './messages.js'

/** What a connected board says it is. Every field is optional: a partial answer
 *  from older firmware is still worth showing. */
export interface MspIdentity {
  /** "BTFL" (Betaflight), "INAV", "ARDU", … — raw, not interpreted. */
  fcVariant?: string
  fcVersion?: string
  apiVersion?: string
  boardIdentifier?: string
  targetName?: string
  boardName?: string
  manufacturerId?: string
}

export interface MspSessionOptions {
  /** Per-request timeout. MSP replies are immediate on a healthy link. */
  timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 2000

export class MspSession {
  private readonly decoder = new MspV1Decoder()
  private readonly waiters = new Map<number, (frame: MspFrame) => void>()
  private unsubscribe?: Unsubscribe
  private readonly timeoutMs: number

  constructor(
    private readonly transport: Transport,
    options: MspSessionOptions = {}
  ) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  }

  async connect(): Promise<void> {
    this.unsubscribe = this.transport.onFrame((chunk) => {
      for (const frame of this.decoder.push(chunk)) {
        this.waiters.get(frame.command)?.(frame)
      }
    })
    await this.transport.connect()
  }

  async disconnect(): Promise<void> {
    this.unsubscribe?.()
    this.unsubscribe = undefined
    this.waiters.clear()
    this.decoder.reset()
    await this.transport.disconnect()
  }

  /** Send one command and wait for the reply carrying the same command byte. */
  async request(command: number, payload?: Uint8Array): Promise<MspFrame> {
    if (this.waiters.has(command)) {
      throw new Error(`MSP command ${command} is already in flight`)
    }

    const reply = new Promise<MspFrame>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters.delete(command)
        reject(new Error(`MSP command ${command} timed out after ${this.timeoutMs} ms`))
      }, this.timeoutMs)

      this.waiters.set(command, (frame) => {
        clearTimeout(timer)
        this.waiters.delete(command)
        resolve(frame)
      })
    })

    await this.transport.send(encodeMspV1Request(command, payload))
    return reply
  }

  /**
   * Ask the board what it is.
   *
   * Each query is independent and a failure is swallowed: firmware that does
   * not implement one of these should still yield the fields it does answer,
   * and "we could not read the board name" is not a reason to report no board.
   */
  async readIdentity(): Promise<MspIdentity> {
    const identity: MspIdentity = {}

    const tryRead = async <T>(command: number, decode: (payload: Uint8Array) => T): Promise<T | undefined> => {
      try {
        const frame = await this.request(command)
        return frame.isError ? undefined : decode(frame.payload)
      } catch {
        return undefined
      }
    }

    identity.fcVariant = await tryRead(MSP_COMMANDS.FC_VARIANT, decodeFcVariant)
    identity.fcVersion = await tryRead(MSP_COMMANDS.FC_VERSION, decodeFcVersion)

    const api = await tryRead(MSP_COMMANDS.API_VERSION, decodeApiVersion)
    if (api) {
      identity.apiVersion = `${api.apiMajor}.${api.apiMinor}`
    }

    const board = await tryRead<MspBoardInfo | undefined>(MSP_COMMANDS.BOARD_INFO, decodeBoardInfo)
    if (board) {
      identity.boardIdentifier = board.boardIdentifier
      identity.targetName = board.targetName
      identity.boardName = board.boardName
      identity.manufacturerId = board.manufacturerId
    }

    return identity
  }

  async readSerialConfig(): Promise<MspSerialPortConfig[]> {
    const frame = await this.request(MSP_COMMANDS.CF_SERIAL_CONFIG)
    return frame.isError ? [] : decodeSerialConfig(frame.payload)
  }

  /**
   * Reboot into the STM32 ROM DFU bootloader.
   *
   * The board echoes the mode back and THEN reboots, so the reply confirms the
   * command was understood — not that the board is in DFU yet. It also means
   * the link drops immediately afterwards, which is expected and not a failure.
   *
   * Only ever BOOTLOADER_ROM: this exists to hand the board to a DFU flasher,
   * and the other modes (MSC, firmware) would silently do something else.
   */
  async rebootToBootloader(): Promise<void> {
    const frame = await this.request(
      MSP_COMMANDS.REBOOT,
      Uint8Array.from([MSP_REBOOT_MODES.BOOTLOADER_ROM])
    )
    if (frame.isError) {
      throw new Error('The flight controller refused the DFU reboot request.')
    }
    if (frame.payload.length > 0 && frame.payload[0] !== MSP_REBOOT_MODES.BOOTLOADER_ROM) {
      // It answered with a DIFFERENT mode, so it is about to do something other
      // than enter DFU. Better to stop than to sit waiting for a DFU device.
      throw new Error(
        `The flight controller acknowledged a different reboot mode (${frame.payload[0]}), not DFU.`
      )
    }
  }
}
