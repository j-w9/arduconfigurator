// "This board runs Betaflight — get ArduPilot onto it."
//
// Its own tab on the Flash view, beside Firmware (.apj) and DFU (.hex): coming
// FROM Betaflight is its own route onto this screen. Identify the board, keep a
// record of what was on it, put it in DFU — then the sibling tabs do the flash. The operator supplies the firmware file, so nothing here chooses an
// image — there is no target lookup to get wrong.

import type { ReactElement } from 'react'
import { StatusBadge, buttonStyle } from '@arduconfig/ui-kit'

import { buildBetaflightPortSuggestions } from '../view-models/betaflight-port-suggestions'
import type { UseBetaflightMspResult } from '../hooks/use-betaflight-msp'

export interface BetaflightConnectProps {
  msp: UseBetaflightMspResult
  disabled?: boolean
}

export function BetaflightConnect({ msp, disabled = false }: BetaflightConnectProps): ReactElement {
  const { status, identity, ports, error, handedToDfu, dumpBusy } = msp
  const busy = status === 'connecting' || status === 'rebooting'
  // "BTFL" is Betaflight's own MSP_FC_VARIANT string. Anything else that speaks
  // MSP is still shown rather than rejected — INAV and Emuflight answer these
  // same commands, and the DFU reboot is a Betaflight-lineage feature they share.
  const variant = identity?.fcVariant
  const suggestions = buildBetaflightPortSuggestions(ports)

  return (
    <section className="bf-gui-box" data-testid="betaflight-connect">
      <div className="bf-gui-box__titlebar">
        <strong>Betaflight board</strong>
        <StatusBadge tone={status === 'connected' ? 'success' : status === 'error' ? 'danger' : 'neutral'}>
          {status === 'connected' ? (variant ?? 'connected') : status}
        </StatusBadge>
      </div>
      <div className="bf-gui-box__body">
        <p>
          Read what a Betaflight board is, keep a record of its settings, then put it into DFU. Once it
          reboots, flash ArduPilot from the <strong>Firmware (.apj)</strong> or <strong>DFU (.hex)</strong>
          tab. Separate from the vehicle link — connecting here does not disturb a connected ArduPilot
          vehicle.
        </p>

        {status === 'connected' && identity ? (
          <dl className="betaflight-identity" data-testid="betaflight-identity">
            <div>
              <dt>Firmware</dt>
              <dd>{[variant, identity.fcVersion].filter(Boolean).join(' ') || 'unknown'}</dd>
            </div>
            <div>
              <dt>Target</dt>
              <dd>{identity.targetName ?? '—'}</dd>
            </div>
            <div>
              <dt>Board</dt>
              <dd>{identity.boardName ?? identity.boardIdentifier ?? '—'}</dd>
            </div>
            <div>
              <dt>Manufacturer</dt>
              <dd>{identity.manufacturerId ?? '—'}</dd>
            </div>
            <div>
              <dt>MSP API</dt>
              <dd>{identity.apiVersion ?? '—'}</dd>
            </div>
            <div>
              <dt>UARTs</dt>
              <dd>{ports.length > 0 ? `${ports.length} reported` : 'not reported'}</dd>
            </div>
          </dl>
        ) : null}

        {/* The wiring does not change when the firmware does: whatever was
            soldered to each UART is still soldered there afterwards. Naming the
            ArduPilot equivalent saves re-deriving it by hand, which is the
            tedious part of the move.

            Not an automatic port mapping — a Betaflight serial identifier and
            an ArduPilot SERIALn index are different numbering over the same
            hardware, and which is which depends on the board. Guessing would
            put a GPS on the receiver's port. */}
        {status === 'connected' && suggestions.length > 0 ? (
          <div className="betaflight-suggestions" data-testid="betaflight-port-suggestions">
            <strong>What this board had wired up</strong>
            <ul>
              {suggestions.map((suggestion, index) => (
                <li key={`${suggestion.identifier}:${suggestion.betaflightFunction}:${index}`}>
                  <span className="betaflight-suggestions__from">
                    Betaflight serial {suggestion.identifier}: {suggestion.betaflightFunction}
                  </span>
                  <span className="betaflight-suggestions__to">
                    {suggestion.ardupilotProtocol !== undefined
                      ? `ArduPilot: ${suggestion.ardupilotLabel} (SERIALn_PROTOCOL ${suggestion.ardupilotProtocol})`
                      : `ArduPilot: ${suggestion.ardupilotLabel}`}
                  </span>
                  {suggestion.note ? <small>{suggestion.note}</small> : null}
                </li>
              ))}
            </ul>
            <small>
              Set these on the Ports tab once ArduPilot is flashed — the port numbers differ between the
              two firmwares, so match them by what is physically on each UART.
            </small>
          </div>
        ) : null}

        {handedToDfu ? (
          <p className="bf-note bf-note--warning" data-testid="betaflight-dfu-handoff">
            The board acknowledged the DFU request and is rebooting. It will come back as a DFU device —
            switch to the <strong>DFU (.hex)</strong> or <strong>Firmware (.apj)</strong> tab and pick your
            ArduPilot firmware file.
          </p>
        ) : null}

        {error ? (
          <p className="switch-exercise-warning" data-testid="betaflight-error">
            {error}
          </p>
        ) : null}

        <div className="button-row">
          {status === 'connected' ? (
            <>
              <button
                type="button"
                style={buttonStyle('primary')}
                data-testid="betaflight-reboot-dfu"
                disabled={disabled || busy}
                onClick={() => void msp.rebootToDfu()}
              >
                Reboot to DFU
              </button>
              <button
                type="button"
                style={buttonStyle()}
                data-testid="betaflight-download-dump"
                disabled={disabled || busy || dumpBusy}
                onClick={() => void msp.downloadDump()}
              >
                {dumpBusy ? 'Reading diff…' : 'Save Settings (diff .txt)'}
              </button>
              <button
                type="button"
                style={buttonStyle()}
                data-testid="betaflight-disconnect"
                disabled={disabled || busy}
                onClick={() => void msp.disconnect()}
              >
                Disconnect
              </button>
            </>
          ) : (
            <button
              type="button"
              style={buttonStyle('primary')}
              data-testid="betaflight-connect-button"
              disabled={disabled || busy}
              onClick={() => void msp.connect()}
            >
              {status === 'connecting' ? 'Connecting…' : 'Connect Betaflight Board'}
            </button>
          )}
        </div>

        <small>
          Save the settings before rebooting to DFU — once ArduPilot is flashed they are gone, and this
          file is the only record. It is the board&apos;s own <code>diff</code>, so it pastes straight back
          into Betaflight Configurator&apos;s CLI if you ever go back.
        </small>
      </div>
    </section>
  )
}
