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
  error?: string
  /** True once the board has been asked to enter DFU — the link is gone. */
  handedToDfu: boolean
  connect: () => Promise<void>
  disconnect: () => Promise<void>
  rebootToDfu: () => Promise<void>
  downloadDump: () => void
}

export function useBetaflightMsp(): UseBetaflightMspResult {
  const [status, setStatus] = useState<BetaflightStatus>('idle')
  const [identity, setIdentity] = useState<MspIdentity | undefined>(undefined)
  const [ports, setPorts] = useState<MspSerialPortConfig[]>([])
  const [error, setError] = useState<string | undefined>(undefined)
  const [handedToDfu, setHandedToDfu] = useState(false)
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

  const downloadDump = useCallback(() => {
    // A record of what the board was before it gets overwritten. Deliberately
    // captured from what we READ, not re-queried: the file should describe the
    // board as shown, and after a DFU reboot there is nothing left to ask.
    const dump = {
      capturedAt: new Date().toISOString(),
      source: 'ArduConfigurator MSP read',
      identity,
      serialPorts: ports
    }
    const blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `betaflight-${identity?.boardName ?? identity?.targetName ?? 'board'}-settings.json`
    link.click()
    URL.revokeObjectURL(url)
  }, [identity, ports])

  return { status, identity, ports, error, handedToDfu, connect, disconnect, rebootToDfu, downloadDump }
}
