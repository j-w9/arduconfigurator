// Auto-detect which Web Serial port is the MAVLink interface.
//
// ArduPilot F7/H7 boards with CAN enumerate as a composite USB device with TWO
// serial interfaces — MAVLink (SERIAL0) and SLCAN — that share one VID/PID, so
// the browser's port metadata (getInfo() = { usbVendorId, usbProductId } only)
// cannot tell them apart. The portable discriminator is behaviour: the MAVLink
// interface streams HEARTBEAT (~1 Hz); the SLCAN interface is silent. Confirmed
// on real hardware (MAVLink port: ~10 heartbeats/s; SLCAN port: 0). This probes
// for that heartbeat — the same signal QGroundControl's autoconnect uses.

import { MavlinkSession, MavlinkV2Codec } from '@arduconfig/protocol-mavlink'
import { WebSerialTransport, type WebSerialPortLike } from '@arduconfig/transport'

const MAV_TYPE_GCS = 6
const DEFAULT_PROBE_TIMEOUT_MS = 2500

/**
 * Open a serial port and resolve true if a non-GCS autopilot HEARTBEAT arrives
 * within `timeoutMs`. Always closes the port before resolving. Any open failure
 * (port busy, not a serial device) resolves false — it isn't the MAVLink link.
 */
export async function probeSerialPortForMavlink(
  port: WebSerialPortLike,
  baudRate: number,
  timeoutMs: number = DEFAULT_PROBE_TIMEOUT_MS
): Promise<boolean> {
  const transport = new WebSerialTransport('serial-probe', { baudRate, port })
  const session = new MavlinkSession(transport, new MavlinkV2Codec())
  let found = false
  const unsubscribe = session.onMessage((envelope) => {
    const message = envelope.message
    // Any inbound heartbeat means this interface is speaking MAVLink; exclude
    // a GCS-type heartbeat (another ground station sharing the link).
    if (message.type === 'HEARTBEAT' && message.vehicleType !== MAV_TYPE_GCS) {
      found = true
    }
  })
  try {
    await transport.connect()
    const deadline = Date.now() + timeoutMs
    while (!found && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
  } catch {
    // open/read failure — not the MAVLink interface (or in use elsewhere).
  } finally {
    unsubscribe()
    await session.disconnect().catch(() => {})
    session.destroy()
  }
  return found
}

export interface MavlinkPortDetection {
  /** The first port found speaking MAVLink, if any. */
  mavlinkPort?: WebSerialPortLike
  /** Per-port outcome, in probe order (stops after the first match). */
  results: Array<{ port: WebSerialPortLike; hasMavlink: boolean }>
}

/**
 * Probe granted ports in turn and return the first that streams MAVLink. The
 * probe function is injectable so the selection logic is testable without real
 * hardware; production passes the heartbeat probe above.
 */
export async function detectMavlinkPort(
  ports: readonly WebSerialPortLike[],
  baudRate: number,
  timeoutMs: number = DEFAULT_PROBE_TIMEOUT_MS,
  probe: (port: WebSerialPortLike, baudRate: number, timeoutMs: number) => Promise<boolean> = probeSerialPortForMavlink
): Promise<MavlinkPortDetection> {
  const results: MavlinkPortDetection['results'] = []
  let mavlinkPort: WebSerialPortLike | undefined
  for (const port of ports) {
    const hasMavlink = await probe(port, baudRate, timeoutMs)
    results.push({ port, hasMavlink })
    if (hasMavlink) {
      mavlinkPort = port
      break
    }
  }
  return { mavlinkPort, results }
}
