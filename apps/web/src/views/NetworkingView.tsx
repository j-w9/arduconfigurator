import type { ReactNode } from 'react'

import { Panel, buttonStyle } from '@arduconfig/ui-kit'

export type NetworkingTab = 'fc' | 'dronenet'

export interface NetworkingViewProps {
  /** Whether the FC reported any NET_ parameters (the nav gates on this too). */
  hasParameters: boolean
  /** The scoped-parameter settings card (IP config + endpoints), built by App. */
  settingsSlot: ReactNode
  /** DroneNet peripherals — a NET_-filtered DroneCAN node editor, built by App. */
  dronecanSlot: ReactNode
  activeTab: NetworkingTab
  onTabChange: (tab: NetworkingTab) => void
  /** Discovered DroneCAN node count (drives the DroneNet tab badge + status). */
  dronenetNodeCount: number
  /** The CAN bus is being forwarded (we're scanning it for peripherals). */
  scanning: boolean
}

function tabStyle(active: boolean) {
  return active ? buttonStyle('primary') : buttonStyle()
}

/**
 * Expert-only Networking surface, split into two tabs:
 *   - IP setup — native NET_* editing for this flight controller.
 *   - DroneNet — configure a DroneCAN peripheral's network settings over CAN.
 * Presentational only; App builds each tab's slot and owns the auto-connect
 * (entering the DroneNet tab starts CAN forwarding to discover peripherals).
 */
export function NetworkingView({
  hasParameters,
  settingsSlot,
  dronecanSlot,
  activeTab,
  onTabChange,
  dronenetNodeCount,
  scanning
}: NetworkingViewProps) {
  return (
    <div data-testid="networking-view">
      <div className="networking-tabs" role="tablist" style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'fc'}
          style={tabStyle(activeTab === 'fc')}
          onClick={() => onTabChange('fc')}
          data-testid="networking-tab-fc"
        >
          IP setup
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'dronenet'}
          style={tabStyle(activeTab === 'dronenet')}
          onClick={() => onTabChange('dronenet')}
          data-testid="networking-tab-dronenet"
        >
          DroneNet{dronenetNodeCount > 0 ? ` (${dronenetNodeCount})` : ''}
        </button>
      </div>

      {activeTab === 'fc' ? (
        <Panel
          title="Flight-controller networking"
          subtitle="ArduPilot NET_ parameters — Ethernet/PPP addressing and MAVLink/telemetry over UDP/TCP network endpoints. Most fields take effect after a reboot."
        >
          <div data-testid="networking-fc-tab">
            <ul className="bf-note">
              <li>
                No native Ethernet? Networking runs over PPP — set a serial port's protocol to PPP on the link that
                carries it, then enable networking.
              </li>
            </ul>
            {hasParameters ? (
              settingsSlot
            ) : (
              <p className="bf-note" data-testid="networking-empty">
                No NET_ parameters reported by the autopilot yet. Connect, pull parameters, and the networking
                settings will populate.
              </p>
            )}
          </div>
        </Panel>
      ) : (
        <div data-testid="networking-dronenet-tab">
          <p className="bf-note" data-testid="networking-dronenet-status">
            {scanning
              ? dronenetNodeCount > 0
                ? `Connected over CAN — ${dronenetNodeCount} node${dronenetNodeCount === 1 ? '' : 's'} found. Expand a node below to read and edit its network settings.`
                : 'Connected over CAN — scanning for DroneNet peripherals…'
              : 'Connecting over the CAN bus to look for DroneNet peripherals…'}
          </p>
          {dronecanSlot}
        </div>
      )}
    </div>
  )
}
