import { useState, type ChangeEvent } from 'react'

import { assetUrl } from './asset-url'
import { FirmwareFlasher } from './firmware/FirmwareFlasher'

export type LandingTransportMode =
  | 'demo'
  | 'demo-plane'
  | 'demo-rover'
  | 'demo-sub'
  | 'web-serial'
  | 'websocket'
  | 'udp'
  | 'tcp'

export interface DisconnectedLandingProps {
  transportMode: LandingTransportMode
  onTransportModeChange: (mode: LandingTransportMode) => void
  webSerialSupported: boolean
  websocketUrl: string
  onWebsocketUrlChange: (url: string) => void
  websocketUrlPlaceholder: string
  /** True only in the desktop app or an Isolated Web App, where raw UDP/TCP work. */
  udpSupported: boolean
  tcpSupported: boolean
  udpTarget: string
  onUdpTargetChange: (target: string) => void
  udpTargetPlaceholder: string
  tcpTarget: string
  onTcpTargetChange: (target: string) => void
  tcpTargetPlaceholder: string
  connectLabel: string
  onConnect: () => void
  connectDisabled: boolean
}

interface BoardCard {
  id: string
  name: string
  image: string
}

const BOARDS: readonly BoardCard[] = [
  { id: 'pixhawk6x', name: 'Pixhawk 6X', image: assetUrl('boards/pixhawk6x/pixhawk6x-uart-map.svg') },
  { id: 'arkv6x', name: 'ARK V6X', image: assetUrl('boards/arkv6x/arkv6x-uart-map.svg') },
  { id: 'matekh743', name: 'Matek H743', image: assetUrl('boards/matekh743/matekh743-layout.svg') },
  { id: 'cuav-7-nano', name: 'CUAV 7 Nano', image: assetUrl('boards/cuav-7-nano/cuav-7-nano-uart-map.svg') },
  { id: 'ark-fpv', name: 'ARK FPV', image: assetUrl('boards/ark-fpv/ark-fpv-port-map.svg') }
]

interface CapabilityCard {
  title: string
  body: string
}

const CAPABILITIES: readonly CapabilityCard[] = [
  {
    title: 'Setup',
    body: 'Guided orientation, accelerometer and compass calibration, parameter sync, and first-flight checks.'
  },
  {
    title: 'Tune',
    body: 'Curated rates, gains, filters, and tuning profiles without hunting through the raw parameter tree.'
  },
  {
    title: 'Snapshot',
    body: 'Capture known-good baselines, build provisioning profiles, and roll back safely after risky changes.'
  },
  {
    title: 'Configure',
    body: 'Ports, receiver, outputs, power, OSD, and VTX from a single configuration-first surface.'
  }
]

export function DisconnectedLanding(props: DisconnectedLandingProps) {
  const {
    transportMode,
    onTransportModeChange,
    webSerialSupported,
    websocketUrl,
    onWebsocketUrlChange,
    websocketUrlPlaceholder,
    udpSupported,
    tcpSupported,
    udpTarget,
    onUdpTargetChange,
    udpTargetPlaceholder,
    tcpTarget,
    onTcpTargetChange,
    tcpTargetPlaceholder,
    connectLabel,
    onConnect,
    connectDisabled
  } = props

  const [firmwareOpen, setFirmwareOpen] = useState(false)

  const handleTransportChange = (event: ChangeEvent<HTMLSelectElement>) => {
    onTransportModeChange(event.target.value as LandingTransportMode)
  }

  return (
    <section className="landing" data-testid="disconnected-landing">
      <div className="landing__hero">
        <h1 className="landing__title">Configure your ArduPilot flight controller.</h1>
      </div>

      <div className="landing__connect" role="group" aria-label="Connect to a flight controller">
        <div className="landing__connect-copy">
          <h2>Connect a flight controller</h2>
          <p>Pick a transport, then connect. Demo mode uses a deterministic mock vehicle for exploring the UI.</p>
        </div>

        <div className="landing__connect-form">
          <label className="landing__field">
            <span>Transport</span>
            <select
              data-testid="landing-transport-select"
              value={transportMode}
              onChange={handleTransportChange}
              disabled={connectDisabled}
            >
              <option value="demo">Demo (Copter)</option>
              <option value="demo-plane">Demo (Plane)</option>
              <option value="demo-rover">Demo (Rover)</option>
              <option value="demo-sub">Demo (Sub)</option>
              <option value="web-serial" disabled={!webSerialSupported}>
                Serial{webSerialSupported ? '' : ' (n/a)'}
              </option>
              <option value="websocket">WebSocket</option>
              {udpSupported ? <option value="udp">UDP (direct)</option> : null}
              {tcpSupported ? <option value="tcp">TCP (direct)</option> : null}
            </select>
          </label>

          {transportMode === 'websocket' ? (
            <label className="landing__field landing__field--wide">
              <span>WebSocket URL</span>
              <input
                data-testid="landing-websocket-url-input"
                type="text"
                value={websocketUrl}
                onChange={(event) => onWebsocketUrlChange(event.target.value)}
                placeholder={websocketUrlPlaceholder}
                spellCheck={false}
                disabled={connectDisabled}
              />
              <small className="landing__hint" data-testid="landing-websocket-hint">
                A WebSocket isn't a UDP connection — a browser tab can't open a raw UDP, TCP, or serial link.
                For a UDP or TCP link (ELRS, SITL), use the downloadable app.
              </small>
            </label>
          ) : null}

          {transportMode === 'udp' ? (
            <label className="landing__field landing__field--wide">
              <span>UDP address</span>
              <input
                data-testid="landing-udp-input"
                type="text"
                value={udpTarget}
                onChange={(event) => onUdpTargetChange(event.target.value)}
                placeholder={udpTargetPlaceholder}
                spellCheck={false}
                disabled={connectDisabled}
              />
              <small className="landing__hint" data-testid="landing-udp-hint">
                Raw UDP, no bridge needed. <code>:14550</code> listens for a MAVLink feed (ELRS, or a Mission
                Planner-style UDP stream); <code>host:14550</code> connects to a fixed sender.
              </small>
            </label>
          ) : null}

          {transportMode === 'tcp' ? (
            <label className="landing__field landing__field--wide">
              <span>TCP address</span>
              <input
                data-testid="landing-tcp-input"
                type="text"
                value={tcpTarget}
                onChange={(event) => onTcpTargetChange(event.target.value)}
                placeholder={tcpTargetPlaceholder}
                spellCheck={false}
                disabled={connectDisabled}
              />
              <small className="landing__hint" data-testid="landing-tcp-hint">
                Raw TCP, no bridge needed. <code>host:5760</code> connects to a MAVLink TCP endpoint (e.g. SITL).
              </small>
            </label>
          ) : null}

          <button
            type="button"
            data-testid="landing-connect-button"
            className="landing__connect-button"
            onClick={onConnect}
            disabled={connectDisabled}
          >
            {connectLabel}
          </button>

          <button
            type="button"
            data-testid="landing-flash-firmware-button"
            className="landing__secondary-button"
            onClick={() => setFirmwareOpen((open) => !open)}
          >
            {firmwareOpen ? 'Hide firmware flasher' : 'Flash firmware'}
          </button>
        </div>
      </div>

      {firmwareOpen ? (
        <div className="landing__section">
          <FirmwareFlasher onClose={() => setFirmwareOpen(false)} />
        </div>
      ) : null}

      <div className="landing__section">
        <header className="landing__section-header">
          <h2>What you can do</h2>
          <p>Configuration-first surfaces, with snapshots and presets to make changes recoverable.</p>
        </header>
        <ul className="landing__capability-grid" role="list">
          {CAPABILITIES.map((capability) => (
            <li key={capability.title} className="landing__capability">
              <strong>{capability.title}</strong>
              <span>{capability.body}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="landing__section">
        <header className="landing__section-header">
          <h2>Supported boards</h2>
          <p>Tested against these flight controllers. Other ArduPilot targets generally work via the same transports.</p>
        </header>
        <ul className="landing__board-grid" role="list">
          {BOARDS.map((board) => (
            <li key={board.id} className="landing__board">
              <div className="landing__board-image">
                <img src={board.image} alt="" loading="lazy" />
              </div>
              <span className="landing__board-name">{board.name}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
