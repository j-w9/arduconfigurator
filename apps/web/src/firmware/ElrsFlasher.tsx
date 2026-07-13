import { useMemo, useState } from 'react'
import type { ReactElement } from 'react'

import type { ConfiguratorSnapshot } from '@arduconfig/ardupilot-core'
import { Panel, StatusBadge } from '@arduconfig/ui-kit'

import {
  detectElrsSerialPorts,
  ELRS_DEFAULT_FLASH_BAUD,
  ELRS_FLASH_BAUD_RATES
} from '../view-models/elrs-flash'

export interface ElrsFlasherNotice {
  tone: 'neutral' | 'success' | 'warning' | 'danger'
  text: string
}

export interface ElrsFlasherProps {
  snapshot: ConfiguratorSnapshot
  isConnected: boolean
  /** True while an arm/flash step is in flight (disables the controls). */
  busy: boolean
  /** Set once the passthru bridge has been armed and the port reopened. */
  bridgeArmed: boolean
  notice: ElrsFlasherNotice | undefined
  /**
   * Arm ArduPilot's SERIAL_PASS bridge on the chosen destination port, then
   * (in the app) release MAVLink and reopen the port at the flashing baud.
   */
  onArmPassthrough: (input: { destinationPort: number; timeoutSeconds: number; baudRate: number }) => void | Promise<void>
  /** Tear the bridge back down (close the raw port; the FC auto-restores MAVLink). */
  onCancel: () => void | Promise<void>
}

const DEFAULT_TIMEOUT_SECONDS = 30

export function ElrsFlasher(props: ElrsFlasherProps): ReactElement {
  const { snapshot, isConnected, busy, bridgeArmed, notice, onArmPassthrough, onCancel } = props

  const candidates = useMemo(() => detectElrsSerialPorts(snapshot), [snapshot])
  const [destinationPort, setDestinationPort] = useState<number | undefined>(undefined)
  const [baudRate, setBaudRate] = useState<number>(ELRS_DEFAULT_FLASH_BAUD)
  const [timeoutSeconds, setTimeoutSeconds] = useState<number>(DEFAULT_TIMEOUT_SECONDS)

  // Default the selection to the first detected ELRS port once we have one.
  const effectivePort = destinationPort ?? candidates[0]?.portNumber

  return (
    <Panel title="ELRS Flash">
      <div className="elrs-flasher" data-testid="elrs-flasher">
        <div className="telemetry-header">
          <div>
            <h3>Flash an ExpressLRS receiver</h3>
            <p>
              Flashes an ESP-based ELRS receiver through the flight controller&apos;s transparent serial bridge — no
              Betaflight CLI or external ELRS Configurator. The FC becomes a dumb USB↔UART pipe while flashing, then
              auto-restores MAVLink.
            </p>
          </div>
          <StatusBadge tone={bridgeArmed ? 'warning' : isConnected ? 'success' : 'neutral'}>
            {bridgeArmed ? 'bridge open' : isConnected ? 'connected' : 'no link'}
          </StatusBadge>
        </div>

        {notice ? (
          <div className={`parameter-review__notice`} data-testid="elrs-flasher-notice">
            <StatusBadge tone={notice.tone}>{notice.tone}</StatusBadge>
            <p>{notice.text}</p>
          </div>
        ) : null}

        {!isConnected ? (
          <p className="switch-exercise-warning" data-testid="elrs-flasher-disconnected">
            Connect to the flight controller over MAVLink first — the bridge is armed over the live link.
          </p>
        ) : candidates.length === 0 ? (
          <p className="switch-exercise-warning" data-testid="elrs-flasher-no-port">
            No serial port is set to RC Input (RCIN, protocol 23) or CRSF (protocol 29). Set the UART wired to your ELRS
            receiver to one of those in the Ports tab, then come back.
          </p>
        ) : (
          <div className="elrs-flasher__form" data-testid="elrs-flasher-form">
            <label className="scoped-editor-field">
              <span>Receiver serial port</span>
              <select
                data-testid="elrs-flasher-port"
                value={effectivePort ?? ''}
                disabled={busy || bridgeArmed}
                onChange={(event) => setDestinationPort(Number(event.target.value))}
              >
                {candidates.map((candidate) => (
                  <option key={candidate.portNumber} value={candidate.portNumber}>
                    Serial{candidate.portNumber} · {candidate.protocolLabel}
                  </option>
                ))}
              </select>
            </label>

            <label className="scoped-editor-field">
              <span>Flashing baud</span>
              <select
                data-testid="elrs-flasher-baud"
                value={baudRate}
                disabled={busy || bridgeArmed}
                onChange={(event) => setBaudRate(Number(event.target.value))}
              >
                {ELRS_FLASH_BAUD_RATES.map((rate) => (
                  <option key={rate} value={rate}>
                    {rate.toLocaleString()} baud
                  </option>
                ))}
              </select>
            </label>

            <label className="scoped-editor-field">
              <span>Bridge timeout (s)</span>
              <input
                data-testid="elrs-flasher-timeout"
                type="number"
                min={5}
                max={120}
                value={timeoutSeconds}
                disabled={busy || bridgeArmed}
                onChange={(event) => setTimeoutSeconds(Number(event.target.value))}
              />
            </label>
          </div>
        )}

        <div className="parameter-follow-up parameter-follow-up--warning">
          <StatusBadge tone="warning">bench only</StatusBadge>
          <p>
            Arming the bridge writes SERIAL_PASS2 and drops the MAVLink connection. The receiver is flashed over the raw
            serial link; if flashing is interrupted the RX may need a re-flash. Do this on the bench with the craft
            disarmed and props off.
          </p>
        </div>

        <div className="snapshots-action-row snapshots-action-row--detail">
          <button
            data-testid="elrs-flasher-arm"
            className="snapshots-button snapshots-button--primary"
            disabled={busy || bridgeArmed || !isConnected || effectivePort === undefined}
            onClick={() =>
              effectivePort !== undefined
                ? void onArmPassthrough({ destinationPort: effectivePort, timeoutSeconds, baudRate })
                : undefined
            }
          >
            {busy ? 'Arming…' : 'Arm passthrough bridge'}
          </button>
          {bridgeArmed ? (
            <button
              data-testid="elrs-flasher-cancel"
              className="snapshots-button snapshots-button--secondary"
              disabled={busy}
              onClick={() => void onCancel()}
            >
              Close bridge
            </button>
          ) : null}
        </div>

        {bridgeArmed ? (
          <p className="telemetry-note" data-testid="elrs-flasher-armed-note">
            Bridge is open at {baudRate.toLocaleString()} baud. Receiver flashing (esptool sync + firmware write) lands in
            the next update — for now, close the bridge to restore MAVLink.
          </p>
        ) : null}
      </div>
    </Panel>
  )
}
