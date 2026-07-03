import type { ReactNode } from 'react'

import { Panel } from '@arduconfig/ui-kit'

export interface NetworkingViewProps {
  /** Whether the FC reported any NET_ parameters (the nav gates on this too). */
  hasParameters: boolean
  /** The scoped-parameter settings card (IP config + endpoints), built by App. */
  settingsSlot: ReactNode
  /** DroneNet peripherals — a NET_-filtered DroneCAN node editor, built by App,
   *  so the user configures peripheral network settings without the CAN tab. */
  dronecanSlot: ReactNode
}

/**
 * Expert-only Networking surface: ArduPilot NET_* IP/PPP setup + network serial
 * endpoints. Presentational only — App computes the scoped-field card (via the
 * shared additional-settings scope) and passes it in as `settingsSlot`. Reachable
 * only when the FC reports networking support (NET_ENABLE present).
 */
export function NetworkingView({ hasParameters, settingsSlot, dronecanSlot }: NetworkingViewProps) {
  return (
    <div data-testid="networking-view">
      <Panel
        title="Networking"
        subtitle="IP networking for this flight controller — Ethernet or PPP addressing and MAVLink/telemetry served over UDP/TCP network endpoints. Most fields take effect after a reboot."
      >
        <ul className="bf-note">
          <li>
            No native Ethernet? Networking runs over PPP — set a serial port's protocol to PPP on the link that
            carries it, then enable networking.
          </li>
          <li>
            DroneNet peripherals (e.g. an AP_Periph Ethernet switch) are configured below over DroneCAN — no need to
            leave this tab. They use these same NET_ parameters.
          </li>
        </ul>
        {hasParameters ? (
          settingsSlot
        ) : (
          <p className="bf-note" data-testid="networking-empty">
            No NET_ parameters reported by the autopilot yet. Connect, pull parameters, and the networking settings
            will populate.
          </p>
        )}
      </Panel>
      {dronecanSlot}
    </div>
  )
}
