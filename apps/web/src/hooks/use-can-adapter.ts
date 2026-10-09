// A USB-CAN adapter (SLCAN over Web Serial) as the CAN tab's bus: no vehicle,
// no MAVLink -- the adapter is the bus. While one is open the CAN tab reads
// this instead of the autopilot's forwarding; everything else in the app is
// untouched.
//
// Test seam: ?canAdapter=demo opens a simulated adapter on the demo DroneCAN
// bus instead of asking for a serial port.

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { SlcanAdapter } from '@arduconfig/can-core'
import { AdapterCanBus, createDemoSlcanIo, type CanBusState } from '@arduconfig/ardupilot-core'
import { WebSerialTransport, type WebSerialNavigatorLike } from '@arduconfig/transport'

/** USB CDC ignores it; serial-bridge adapters (CAN232-style) commonly default to this. */
const SLCAN_SERIAL_BAUD = 115_200
const BITRATE_STORAGE_KEY = 'arduconfig:can-adapter-bitrate'

function demoRequested(): boolean {
  try {
    return new URLSearchParams(window.location.search).get('canAdapter') === 'demo'
  } catch {
    return false
  }
}

function webSerial(): WebSerialNavigatorLike | undefined {
  return (navigator as unknown as { serial?: WebSerialNavigatorLike }).serial
}

function storedBitrate(): number {
  try {
    const value = Number(window.localStorage.getItem(BITRATE_STORAGE_KEY))
    return Number.isFinite(value) && value > 0 ? value : 1_000_000
  } catch {
    return 1_000_000
  }
}

export interface UseCanAdapterResult {
  /** Web Serial is there (or the demo seam is on). */
  supported: boolean
  /** The open adapter's bus, while one is open. */
  bus: AdapterCanBus | undefined
  /** Its state; undefined when no adapter is in use. */
  state: CanBusState | undefined
  opening: boolean
  error: string | undefined
  bitrate: number
  setBitrate: (bitrate: number) => void
  /** Ask for a port (needs the click's user gesture) and open it. */
  connect: () => Promise<void>
  disconnect: () => Promise<void>
}

const noop = () => () => {}

export function useCanAdapter(): UseCanAdapterResult {
  const [bus, setBus] = useState<AdapterCanBus | undefined>(undefined)
  const [opening, setOpening] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const [bitrate, setBitrateState] = useState(storedBitrate)
  const demo = demoRequested()
  const supported = demo || webSerial() !== undefined

  const state = useSyncExternalStore(
    bus ? (listener) => bus.subscribe(listener) : noop,
    () => bus?.getSnapshot()
  )

  // An adapter that closes by itself (unplugged) leaves the CAN tab, and says why.
  useEffect(() => {
    if (bus && state?.status === 'idle') {
      setError(bus.closedReason)
      setBus(undefined)
    }
  }, [bus, state?.status])

  useEffect(() => () => void bus?.stop(), [bus])

  const setBitrate = useCallback((value: number) => {
    setBitrateState(value)
    try {
      window.localStorage.setItem(BITRATE_STORAGE_KEY, String(value))
    } catch {
      // Remembering it is a convenience.
    }
  }, [])

  const connect = useCallback(async () => {
    setError(undefined)
    let io
    if (demo) {
      io = createDemoSlcanIo()
    } else {
      const serial = webSerial()
      if (!serial) {
        setError('This browser cannot open serial ports. Use Chrome or Edge on a desktop.')
        return
      }
      let port
      try {
        port = await serial.requestPort()
      } catch {
        return // Picker dismissed.
      }
      io = new WebSerialTransport('slcan', { baudRate: SLCAN_SERIAL_BAUD, port })
    }
    setOpening(true)
    const next = new AdapterCanBus(new SlcanAdapter(io, { bitrate }))
    try {
      await next.start()
      setBus(next)
    } catch (caught) {
      setError(
        `${caught instanceof Error ? caught.message : String(caught)} Check it is an SLCAN adapter (or the autopilot's SLCAN port) and not in use elsewhere.`
      )
    } finally {
      setOpening(false)
    }
  }, [bitrate, demo])

  const disconnect = useCallback(async () => {
    const current = bus
    setBus(undefined)
    await current?.stop()
  }, [bus])

  return { supported, bus, state: bus ? state : undefined, opening, error, bitrate, setBitrate, connect, disconnect }
}
