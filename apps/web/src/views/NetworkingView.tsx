import type { ReactNode } from 'react'


export type NetworkingTab = 'fc' | 'dronenet'

export interface NetworkingViewProps {
  /** Whether the FC reported any NET_ parameters (the nav gates on this too). */
  hasParameters: boolean
  /** The scoped-parameter settings card (IP config + endpoints), built by App. */
  settingsSlot: ReactNode
  /** DroneNet peripherals — a NET_-filtered DroneCAN node editor, built by App. */
  dronecanSlot: ReactNode
  /** Friendly passthrough-bridge editors for DroneNet nodes (built by App). */
  passthroughSlot: ReactNode
  activeTab: NetworkingTab
  onTabChange: (tab: NetworkingTab) => void
  /** Discovered DroneCAN node count (drives the DroneNet tab badge + status). */
  dronenetNodeCount: number
  /** The CAN bus is being forwarded (we're scanning it for peripherals). */
  scanning: boolean
}

/** Shared tab treatment — Networking previously rendered its tabs as ordinary
 *  buttons, which made them read as actions rather than as navigation. */
function tabClassName(active: boolean): string {
  return `tab-strip__tab${active ? ' is-active' : ''}`
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
  passthroughSlot,
  activeTab,
  onTabChange,
  dronenetNodeCount,
  scanning
}: NetworkingViewProps) {
  return (
    <div data-testid="networking-view">
      <div className="tab-strip networking-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'fc'}
          className={tabClassName(activeTab === 'fc')}
          onClick={() => onTabChange('fc')}
          data-testid="networking-tab-fc"
        >
          IP setup
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'dronenet'}
          className={tabClassName(activeTab === 'dronenet')}
          onClick={() => onTabChange('dronenet')}
          data-testid="networking-tab-dronenet"
        >
          DroneNet{dronenetNodeCount > 0 ? ` (${dronenetNodeCount})` : ''}
        </button>
      </div>

      {activeTab === 'fc' ? (
        // No wrapping Panel here — settingsSlot is itself a titled card ("Network
        // settings" with IP configuration / Network endpoints subsections), so a
        // Panel around it would just nest two identical-looking boxes.
        <div data-testid="networking-fc-tab">
          <ul className="bf-note">
            <li>
              No native Ethernet? Networking runs over PPP — set a serial port's protocol to PPP on the link that
              carries it, then enable networking.
            </li>
            <li>
              Network endpoints: an <strong>IP is only needed for client types</strong> (the destination to connect
              to). Leave <code>0.0.0.0</code> for server types — the server binds all interfaces and any client can
              connect.
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
        </div>
      ) : (
        <div data-testid="networking-dronenet-tab">
          <p className="bf-note" data-testid="networking-dronenet-status">
            {scanning
              ? dronenetNodeCount > 0
                ? `Connected over CAN — ${dronenetNodeCount} node${dronenetNodeCount === 1 ? '' : 's'} found. Expand a node below to read and edit its network settings.`
                : 'Connected over CAN — scanning for DroneNet peripherals…'
              : 'Connecting over the CAN bus to look for DroneNet peripherals…'}
          </p>
          {passthroughSlot}
          {dronecanSlot}
        </div>
      )}
    </div>
  )
}
