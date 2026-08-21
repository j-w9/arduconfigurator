import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import {
  DirectSocketsTcpTransport,
  DirectSocketsUdpTransport,
  getAvailableWebSerialPorts,
  getWebSerialPortInfo,
  type WebSerialPortInfo,
  type WebSerialPortLike
} from '@arduconfig/transport'

import { desktopSocketsSupported } from '../desktop-bridge'

export type TransportMode =
  | 'demo'
  | 'demo-plane'
  | 'demo-rover'
  | 'demo-sub'
  | 'web-serial'
  // Serial over WebUSB. Android only in practice -- see webUsbSerialSupported.
  | 'web-usb-serial'
  | 'websocket'
  | 'udp'
  | 'tcp'

export const DEFAULT_WEBSOCKET_URL = 'ws://127.0.0.1:14550'
// ":14550" → bind locally and learn the peer (ELRS / Mission-Planner UDP-listen).
export const DEFAULT_UDP_TARGET = ':14550'
// TCP is always a fixed remote; SITL's default is 127.0.0.1:5760.
export const DEFAULT_TCP_TARGET = '127.0.0.1:5760'

/**
 * Android, where a present navigator.serial does not mean a usable serial port.
 *
 * Chrome shipped Web Serial on Android in M148/149, but only Bluetooth RFCOMM
 * works broadly: USB serial rides the new Android Serial API, which the
 * Chromium PSA says arrives "in 2026Q2 on a limited set of devices". So the
 * API answers, the picker opens, and there is nothing in it -- which is exactly
 * the "No port selected by user" a Galaxy reports with a board plugged in.
 *
 * Feature detection cannot see that difference, so the platform is the signal.
 * userAgentData first, since the UA string is the thing browsers keep freezing.
 */
export function isAndroidPlatform(): boolean {
  if (typeof navigator === 'undefined') {
    return false
  }
  const platform = (navigator as { userAgentData?: { platform?: string } }).userAgentData?.platform
  if (typeof platform === 'string' && platform.length > 0) {
    return platform.toLowerCase() === 'android'
  }
  return /android/i.test(navigator.userAgent ?? '')
}

/**
 * Serial over WebUSB: offered where Web Serial cannot reach a USB board.
 *
 * That is Android -- whether or not navigator.serial exists there, per above --
 * and any browser missing Web Serial entirely. NOT desktop: there the OS owns
 * the CDC interface, claiming it fails with "busy", and offering the option
 * would put a button that cannot work beside one that does.
 */
export function webUsbSerialSupported(webSerialSupported: boolean): boolean {
  if (typeof navigator === 'undefined') {
    return false
  }
  if (typeof (navigator as { usb?: unknown }).usb !== 'object') {
    return false
  }
  return !webSerialSupported || isAndroidPlatform()
}

// Raw UDP/TCP need either the desktop app (native sockets over IPC) or an
// Isolated Web App on Chromium (Direct Sockets). A normal tab has neither.
const nativeSocketsAvailable = desktopSocketsSupported()
export const udpSupported = DirectSocketsUdpTransport.isSupported() || nativeSocketsAvailable
export const tcpSupported = DirectSocketsTcpTransport.isSupported() || nativeSocketsAvailable

const TRANSPORT_MODE_STORAGE_KEY = 'arduconfig:transport-mode'
const WEBSOCKET_URL_STORAGE_KEY = 'arduconfig:websocket-url'
const UDP_TARGET_STORAGE_KEY = 'arduconfig:udp-target'
const TCP_TARGET_STORAGE_KEY = 'arduconfig:tcp-target'
const SERIAL_PORT_INFO_STORAGE_KEY = 'arduconfig:web-serial-port'

function defaultTransportMode(webSerialSupported: boolean): TransportMode {
  // WebUSB wins where it is offered at all, which is only where Web Serial
  // cannot reach a USB board: opening on the transport that works beats
  // opening on one whose picker is empty.
  if (webUsbSerialSupported(webSerialSupported)) {
    return 'web-usb-serial'
  }
  return webSerialSupported ? 'web-serial' : 'demo'
}

function readStoredTransportMode(webSerialSupported: boolean): TransportMode {
  if (typeof window === 'undefined') {
    return defaultTransportMode(webSerialSupported)
  }

  try {
    const stored = window.localStorage.getItem(TRANSPORT_MODE_STORAGE_KEY)
    if (
      stored === 'demo' ||
      stored === 'demo-plane' ||
      stored === 'demo-rover' ||
      stored === 'demo-sub' ||
      stored === 'websocket'
    ) {
      return stored
    }
    if (stored === 'web-serial' && webSerialSupported) {
      return stored
    }
    if (stored === 'web-usb-serial' && webUsbSerialSupported(webSerialSupported)) {
      return stored
    }
    if (stored === 'udp' && udpSupported) {
      return stored
    }
    if (stored === 'tcp' && tcpSupported) {
      return stored
    }
  } catch {
    return defaultTransportMode(webSerialSupported)
  }

  return defaultTransportMode(webSerialSupported)
}

function readStoredTarget(key: string, fallback: string): string {
  if (typeof window === 'undefined') {
    return fallback
  }

  try {
    const stored = window.localStorage.getItem(key)?.trim()
    return stored ? stored : fallback
  } catch {
    return fallback
  }
}

function persistTarget(key: string, value: string): void {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.setItem(key, value)
  } catch {}
}

function readStoredWebsocketUrl(): string {
  if (typeof window === 'undefined') {
    return DEFAULT_WEBSOCKET_URL
  }

  try {
    const stored = window.localStorage.getItem(WEBSOCKET_URL_STORAGE_KEY)?.trim()
    return stored ? stored : DEFAULT_WEBSOCKET_URL
  } catch {
    return DEFAULT_WEBSOCKET_URL
  }
}

function readStoredSerialPortInfo(): WebSerialPortInfo | undefined {
  if (typeof window === 'undefined') {
    return undefined
  }

  try {
    const stored = window.localStorage.getItem(SERIAL_PORT_INFO_STORAGE_KEY)
    if (!stored) {
      return undefined
    }

    const parsed = JSON.parse(stored) as WebSerialPortInfo
    return typeof parsed === 'object' && parsed !== null ? parsed : undefined
  } catch {
    return undefined
  }
}

function persistTransportMode(value: TransportMode): void {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.setItem(TRANSPORT_MODE_STORAGE_KEY, value)
  } catch {}
}

function persistWebsocketUrl(value: string): void {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.setItem(WEBSOCKET_URL_STORAGE_KEY, value)
  } catch {}
}

function persistSerialPortInfo(portInfo: WebSerialPortInfo | undefined): void {
  if (typeof window === 'undefined') {
    return
  }

  try {
    if (portInfo && (portInfo.usbVendorId !== undefined || portInfo.usbProductId !== undefined)) {
      window.localStorage.setItem(SERIAL_PORT_INFO_STORAGE_KEY, JSON.stringify(portInfo))
    } else {
      window.localStorage.removeItem(SERIAL_PORT_INFO_STORAGE_KEY)
    }
  } catch {}
}

function sameSerialPortInfo(left: WebSerialPortInfo | undefined, right: WebSerialPortInfo | undefined): boolean {
  if (!left || !right) {
    return false
  }

  return left.usbVendorId === right.usbVendorId && left.usbProductId === right.usbProductId
}

export interface TransportSelection {
  transportMode: TransportMode
  setTransportMode: Dispatch<SetStateAction<TransportMode>>
  websocketUrl: string
  setWebsocketUrl: Dispatch<SetStateAction<string>>
  udpTarget: string
  setUdpTarget: Dispatch<SetStateAction<string>>
  tcpTarget: string
  setTcpTarget: Dispatch<SetStateAction<string>>
  selectedSerialPort: WebSerialPortLike | undefined
  rememberedSerialPortInfo: WebSerialPortInfo | undefined
  autoReconnectAvailable: boolean
  /** Record an operator-picked serial port: select it, remember it, persist it. */
  rememberSelectedSerialPort: (port: WebSerialPortLike) => void
  /**
   * Re-query the browser's authorized ports and re-select the remembered
   * FC's CURRENT handle (what a page refresh does on mount). Used to
   * recover inline from a stale/lost handle after a re-enumeration,
   * without a reload. Resolves to the re-acquired port, or undefined.
   */
  reacquireSerialPort: () => Promise<WebSerialPortLike | undefined>
}

/**
 * Owns the transport-selection state (mode, websocket URL, serial port +
 * remembered port info, auto-reconnect availability) plus its localStorage
 * persistence and the navigator.serial auto-reconnect probe. Extracted
 * verbatim from App.tsx; `setSelectedSerialPort` /
 * `setRememberedSerialPortInfo` / `setAutoReconnectAvailable` are now fully
 * internal (every external mutation went through the port-selected callback
 * or the probe effect), so the public surface is the state values plus the
 * two operator-driven setters and `rememberSelectedSerialPort`.
 *
 * `webSerialSupported` stays computed by the caller (`App`) because it is
 * also read directly in the connect UI; it is passed in so the stored-mode
 * fallback and the probe stay consistent with what the UI shows.
 */
export function useTransportSelection(webSerialSupported: boolean): TransportSelection {
  const [transportMode, setTransportMode] = useState<TransportMode>(() => readStoredTransportMode(webSerialSupported))
  const [websocketUrl, setWebsocketUrl] = useState<string>(readStoredWebsocketUrl)
  const [udpTarget, setUdpTarget] = useState<string>(() => readStoredTarget(UDP_TARGET_STORAGE_KEY, DEFAULT_UDP_TARGET))
  const [tcpTarget, setTcpTarget] = useState<string>(() => readStoredTarget(TCP_TARGET_STORAGE_KEY, DEFAULT_TCP_TARGET))
  const [selectedSerialPort, setSelectedSerialPort] = useState<WebSerialPortLike | undefined>(undefined)
  const [rememberedSerialPortInfo, setRememberedSerialPortInfo] = useState<WebSerialPortInfo | undefined>(
    readStoredSerialPortInfo
  )
  const [autoReconnectAvailable, setAutoReconnectAvailable] = useState(false)

  useEffect(() => {
    persistTransportMode(transportMode)
  }, [transportMode])

  useEffect(() => {
    persistWebsocketUrl(websocketUrl)
  }, [websocketUrl])

  useEffect(() => {
    persistTarget(UDP_TARGET_STORAGE_KEY, udpTarget)
  }, [udpTarget])

  useEffect(() => {
    persistTarget(TCP_TARGET_STORAGE_KEY, tcpTarget)
  }, [tcpTarget])

  // Query the browser's authorized ports and pick the one matching the
  // remembered FC by USB vendor/product id (or the first port). Pure: no
  // state writes, so the mount effect can keep its out-of-order /
  // post-unmount guard while the imperative path commits immediately.
  const probeSerialPort = useCallback(async (): Promise<{
    port: WebSerialPortLike | undefined
    matched: boolean
  }> => {
    if (!webSerialSupported) {
      return { port: undefined, matched: false }
    }
    try {
      const ports = await getAvailableWebSerialPorts()
      const matchedPort = ports.find((port) => sameSerialPortInfo(getWebSerialPortInfo(port), rememberedSerialPortInfo))
      return { port: matchedPort ?? ports[0], matched: matchedPort !== undefined }
    } catch {
      return { port: undefined, matched: false }
    }
  }, [rememberedSerialPortInfo, webSerialSupported])

  // Re-acquire and COMMIT the current handle. This is exactly what makes
  // a PAGE REFRESH connect: a Cube/Pixhawk re-enumerates over USB CDC as
  // its bootloader hands off to firmware, so the handle picked at connect
  // time goes stale ("The device has been lost") and only a fresh
  // getPorts() handle points at the re-enumerated device. Exposed so a
  // failed connect can run that same recovery inline instead of forcing a
  // reload. Resolves to the re-acquired port (or undefined when none).
  const reacquireSerialPort = useCallback(async (): Promise<WebSerialPortLike | undefined> => {
    const { port, matched } = await probeSerialPort()
    setSelectedSerialPort(port)
    setAutoReconnectAvailable(matched)
    return port
  }, [probeSerialPort])

  useEffect(() => {
    let cancelled = false
    void probeSerialPort().then(({ port, matched }) => {
      if (cancelled) {
        return
      }
      setSelectedSerialPort(port)
      setAutoReconnectAvailable(matched)
    })
    return () => {
      cancelled = true
    }
  }, [probeSerialPort])

  const rememberSelectedSerialPort = useCallback((port: WebSerialPortLike) => {
    setSelectedSerialPort(port)
    const portInfo = getWebSerialPortInfo(port)
    setRememberedSerialPortInfo(portInfo)
    persistSerialPortInfo(portInfo)
  }, [])

  return {
    transportMode,
    setTransportMode,
    websocketUrl,
    setWebsocketUrl,
    udpTarget,
    setUdpTarget,
    tcpTarget,
    setTcpTarget,
    selectedSerialPort,
    rememberedSerialPortInfo,
    autoReconnectAvailable,
    rememberSelectedSerialPort,
    reacquireSerialPort
  }
}
