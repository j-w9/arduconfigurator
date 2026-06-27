// Connection / session helpers, extracted from App.tsx as part of its
// decomposition. Pure helpers for the connect button label, connect-failure
// messaging, stale-serial-handle detection, and remembered-port description.

import type { ConfiguratorSnapshot } from '@arduconfig/ardupilot-core'
import type { WebSerialPortInfo } from '@arduconfig/transport'

import type { ParameterFollowUp } from './hooks/use-parameter-feedback'
import type { TransportMode } from './hooks/use-transport-selection'

export function connectButtonLabel(
  snapshot: ConfiguratorSnapshot,
  parameterFollowUp: ParameterFollowUp | undefined,
  busyAction?: string
): string {
  // A real flight controller can take up to ~20s to boot and send its
  // first heartbeat (DEFAULT_HEARTBEAT_TIMEOUT_MS). Surface that the
  // connect is in progress instead of leaving a silently-disabled button
  // for that whole window — the connect UX was the user's pain point.
  if (busyAction?.startsWith('connect')) {
    return 'Connecting…'
  }
  if (snapshot.connection.kind === 'error' || parameterFollowUp !== undefined || snapshot.vehicle !== undefined) {
    return 'Reconnect'
  }

  return 'Connect'
}

export function describeConnectFailure(
  transportMode: TransportMode,
  connection: ConfiguratorSnapshot['connection'],
  error: unknown
): string {
  const message =
    connection.kind === 'error'
      ? connection.message
      : error instanceof Error
        ? error.message
        : 'Unknown connection error.'

  if (message.includes('Timed out waiting for vehicle heartbeat')) {
    return transportMode === 'web-serial'
      ? 'The serial port opened, but no ArduPilot heartbeat arrived — this is usually the SLCAN/secondary USB port (boards with CAN expose two). Use "Choose a different port" to grant the other one, then reconnect; also close any other serial app using it.'
      : 'The link opened, but no ArduPilot heartbeat arrived in time. Confirm the selected transport is pointed at a live flight controller and try again.'
  }

  if (transportMode === 'web-serial') {
    return `${message} If the flight controller is already plugged in, close any other app using the serial port and reconnect.`
  }

  return message
}

// A Cube/Pixhawk re-enumerates over USB CDC as its bootloader hands off
// to firmware, so the handle picked at connect time is dead by open/read
// ("The device has been lost"). These errors mean "this handle is stale"
// — re-acquiring the device's CURRENT handle via getPorts() (what a page
// refresh does on mount) is the right recovery. A heartbeat timeout is
// deliberately excluded: the port opened fine and the FC is just slow to
// boot (owned by the heartbeat-timeout path), so swapping handles there
// would thrash a healthy link.
export function isStaleSerialHandleError(connection: ConfiguratorSnapshot['connection'], error: unknown): boolean {
  const message = (
    connection.kind === 'error'
      ? connection.message
      : error instanceof Error
        ? error.message
        : ''
  ).toLowerCase()
  if (message.includes('timed out waiting for vehicle heartbeat')) {
    return false
  }
  return (
    message.includes('device has been lost') ||
    message.includes('failed to open') ||
    message.includes('already open') ||
    message.includes('the port is closed') ||
    message.includes('no longer open') ||
    message.includes('the device has been disconnected')
  )
}

export function describeRememberedSerialPort(portInfo: WebSerialPortInfo | undefined): string | undefined {
  if (!portInfo) {
    return undefined
  }

  const vendor = portInfo.usbVendorId?.toString(16).toUpperCase().padStart(4, '0')
  const product = portInfo.usbProductId?.toString(16).toUpperCase().padStart(4, '0')
  if (!vendor && !product) {
    return undefined
  }

  return [vendor ? `VID ${vendor}` : undefined, product ? `PID ${product}` : undefined].filter(Boolean).join(' / ')
}
