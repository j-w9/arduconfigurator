// Connect to a Betaflight board over MSP, read what it is, and hand it to DFU.
//
// A SEPARATE Web Serial connection from the app's MAVLink link: a Betaflight
// board does not speak MAVLink, so it can never appear on the normal transport.
// Owning its own transport here means connecting to one costs the ArduPilot
// session nothing and cannot disturb a live vehicle.

import { useCallback, useRef, useState } from 'react'

import { MspSession, type MspIdentity, type MspSerialPortConfig } from '@arduconfig/protocol-msp'
import { WebSerialTransport } from '@arduconfig/transport'

/** Betaflight's default MSP baud. Not configurable: a board that has been
 *  changed off it cannot be found by guessing anyway. */
const MSP_BAUD_RATE = 115200

export type BetaflightStatus = 'idle' | 'connecting' | 'connected' | 'rebooting' | 'error'

export interface UseBetaflightMspResult {
  status: BetaflightStatus
  identity?: MspIdentity
  ports: MspSerialPortConfig[]
  /** The board's `diff`, captured at connect. Carries the settings the serial
   *  config cannot express — notably whether the OSD runs over MSP. */
  cliDiff?: string
  error?: string
  /** True once the board has been asked to enter DFU — the link is gone. */
  handedToDfu: boolean
  connect: () => Promise<void>
  disconnect: () => Promise<void>
  rebootToDfu: () => Promise<void>
  /** Save the board's `diff` as CLI text — what pastes back into Betaflight. */
  downloadDump: () => Promise<void>
  dumpBusy: boolean
}

export function useBetaflightMsp(): UseBetaflightMspResult {
  const [status, setStatus] = useState<BetaflightStatus>('idle')
  const [identity, setIdentity] = useState<MspIdentity | undefined>(undefined)
  const [ports, setPorts] = useState<MspSerialPortConfig[]>([])
  const [cliDiff, setCliDiff] = useState<string | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const [handedToDfu, setHandedToDfu] = useState(false)
  const [dumpBusy, setDumpBusy] = useState(false)
  const sessionRef = useRef<MspSession | undefined>(undefined)

  const disconnect = useCallback(async () => {
    const session = sessionRef.current
    sessionRef.current = undefined
    setStatus('idle')
    if (session) {
      // A board that has already rebooted into DFU will throw here; that is the
      // expected end of this flow, not a failure worth showing.
      try {
        await session.disconnect()
      } catch {
        /* the port is already gone */
      }
    }
  }, [])

  const connect = useCallback(async () => {
    setError(undefined)
    setHandedToDfu(false)
    setCliDiff(undefined)
    setStatus('connecting')
    const transport = new WebSerialTransport('betaflight-msp', { baudRate: MSP_BAUD_RATE })
    const session = new MspSession(transport)
    try {
      await session.connect()
      sessionRef.current = session
      const readIdentity = await session.readIdentity()
      setIdentity(readIdentity)

      // Ports are a bonus, not a gate: a board that answers BOARD_INFO but not
      // CF_SERIAL_CONFIG is still worth showing and still flashable.
      try {
        setPorts(await session.readSerialConfig())
      } catch {
        setPorts([])
      }
      // Read the board's `diff` here rather than only when the operator saves
      // it. Two things need it: MSP DisplayPort cannot be seen in the serial
      // config at all (it is an OSD setting on a plain MSP port), and Save then
      // costs nothing. Best-effort — a board that will not drop into the CLI is
      // still identified, still translated, and still flashable. Safe to do
      // unasked: the capture is read-only and leaves with `exit noreboot`.
      try {
        setCliDiff(await session.readCliDiff())
      } catch {
        setCliDiff(undefined)
      }
      setStatus('connected')
    } catch (caught) {
      sessionRef.current = undefined
      await session.disconnect().catch(() => undefined)
      setStatus('error')
      setError(caught instanceof Error ? caught.message : 'Could not talk to the board over MSP.')
    }
  }, [])

  const rebootToDfu = useCallback(async () => {
    const session = sessionRef.current
    if (!session) return
    setError(undefined)
    setStatus('rebooting')
    try {
      await session.rebootToBootloader()
      // The board acknowledges and THEN reboots, so the link drops right after
      // this. Tear it down deliberately rather than leaving a dead port open.
      setHandedToDfu(true)
      sessionRef.current = undefined
      await session.disconnect().catch(() => undefined)
      setStatus('idle')
    } catch (caught) {
      setStatus('error')
      setError(caught instanceof Error ? caught.message : 'The board refused the DFU reboot.')
    }
  }, [])

  const downloadDump = useCallback(async () => {
    const session = sessionRef.current
    if (!session) return
    setError(undefined)
    setDumpBusy(true)
    try {
      // The board's own `diff`, captured over the CLI, saved as .txt.
      //
      // It used to write our JSON view of the serial config, which was neither
      // a dump nor loadable: it held the ports and nothing else, in a format no
      // Betaflight tool reads. A diff is what a Betaflight user means, it is
      // what pastes back into Betaflight Configurator, and on a real board it
      // was ~80 lines against ~1200 for a full dump because it lists only what
      // was actually changed.
      const diff = cliDiff ?? (await session.readCliDiff())
      const board = identity?.boardName ?? identity?.targetName ?? 'board'
      const stamp = new Date()
        .toISOString()
        .replace(/[-:]/g, '')
        .replace(/\..+$/, '')
        .replace('T', '_')
      const blob = new Blob([diff], { type: 'text/plain' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      // Betaflight's own naming, so it sits alongside files saved by their
      // Configurator rather than looking like something else.
      link.download = `BTFL_cli_${stamp}_${board}.txt`
      link.click()
      URL.revokeObjectURL(url)
    } catch (caught) {
      setError(
        caught instanceof Error
          ? `Could not read the board's settings: ${caught.message}`
          : "Could not read the board's settings."
      )
    } finally {
      setDumpBusy(false)
    }
  }, [cliDiff, identity])

  return {
    status,
    identity,
    ports,
    cliDiff,
    error,
    handedToDfu,
    dumpBusy,
    connect,
    disconnect,
    rebootToDfu,
    downloadDump
  }
}
