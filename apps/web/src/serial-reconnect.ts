// One attempt at reacquiring a flight controller's serial port after the link
// went away, extracted from App.tsx's post-reboot reconnect so the watchdog
// auto-resume can reuse it verbatim rather than growing a second, subtly
// different copy.
//
// It handles both USB quirks a reconnect runs into:
//  - bootloader-first: a rebooting board enumerates as the bootloader (no
//    MAVLink heartbeat) before the firmware re-enumerates;
//  - composite device: ArduPilot FCs expose TWO CDC serial interfaces on the
//    same VID/PID and only one carries MAVLink, and nothing in the port info
//    distinguishes them.
// So it tries every currently-granted port sharing the target's VID/PID and
// keeps the first that actually answers a heartbeat; the wrong interface or a
// bootloader simply times out and it moves on.

import {
  getAvailableWebSerialPorts,
  getWebSerialPortInfo,
  type WebSerialPortLike
} from '@arduconfig/transport'

/** The slice of the runtime this needs — keeps the helper testable. */
export interface SerialReconnectRuntime {
  connect(): Promise<void>
  disconnect(): Promise<void>
  waitForVehicle(options: { timeoutMs: number }): Promise<unknown>
  requestParameterList(options?: { fresh?: boolean }): Promise<void>
}

export interface SerialReconnectAttemptOptions {
  runtime: SerialReconnectRuntime
  /** VID/PID of the port the operator originally chose, if known. */
  targetInfo: ReturnType<typeof getWebSerialPortInfo>
  /**
   * Point the transport resolver at a candidate handle. Must take effect
   * synchronously — a React state update lags a render, and the connect below
   * would then open the previous (dead) handle.
   */
  setActivePort: (port: WebSerialPortLike) => void
  /** Remember the port that actually heartbeated, for later auto-reconnects. */
  rememberPort: (port: WebSerialPortLike) => void
  /** Checked between candidates so a cancelled loop stops promptly. */
  isCancelled: () => boolean
  /**
   * `true` re-reads the whole table (post-reboot / post-flash, where inheriting
   * the previous firmware's values would be wrong). `false` resumes a download a
   * dropped link left incomplete — the watchdog case, where restarting from zero
   * every time is exactly what never converges.
   */
  fresh: boolean
  /** Bound on how long to wait for a heartbeat from each candidate. */
  heartbeatTimeoutMs?: number
  /** Called after a candidate syncs, so the caller can clear follow-up state. */
  onConnected?: () => void
}

/**
 * Try every plausible port once. Resolves true as soon as one connects and its
 * parameter pull has been issued, false if none answered.
 */
export async function attemptSerialPortReconnect({
  runtime,
  targetInfo,
  setActivePort,
  rememberPort,
  isCancelled,
  fresh,
  heartbeatTimeoutMs = 4000,
  onConnected
}: SerialReconnectAttemptOptions): Promise<boolean> {
  let ports: WebSerialPortLike[]
  try {
    ports = await getAvailableWebSerialPorts()
  } catch {
    return false
  }

  const matching = ports.filter((port) => {
    const info = getWebSerialPortInfo(port)
    return (
      targetInfo !== undefined &&
      info !== undefined &&
      info.usbVendorId === targetInfo.usbVendorId &&
      info.usbProductId === targetInfo.usbProductId
    )
  })

  for (const candidate of matching.length > 0 ? matching : ports) {
    if (isCancelled()) {
      return false
    }
    setActivePort(candidate)
    try {
      await runtime.connect()
      await runtime.waitForVehicle({ timeoutMs: heartbeatTimeoutMs })
      await runtime.requestParameterList({ fresh })
      onConnected?.()
      rememberPort(candidate)
      return true
    } catch {
      await runtime.disconnect().catch(() => {})
    }
  }

  return false
}
