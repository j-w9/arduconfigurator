// "This board runs Betaflight — get ArduPilot onto it."
//
// Lives on the Flash tab because that is the job: identify the board, keep a
// record of what was on it, then put it in DFU so the flasher below can take
// over. The operator supplies the firmware file, so nothing here chooses an
// image — there is no target lookup to get wrong.

import type { ReactElement } from 'react'
import { StatusBadge, buttonStyle } from '@arduconfig/ui-kit'

import type { UseBetaflightMspResult } from '../hooks/use-betaflight-msp'

export interface BetaflightConnectProps {
  msp: UseBetaflightMspResult
  disabled?: boolean
}

export function BetaflightConnect({ msp, disabled = false }: BetaflightConnectProps): ReactElement {
  const { status, identity, ports, error, handedToDfu } = msp
  const busy = status === 'connecting' || status === 'rebooting'
  // "BTFL" is Betaflight's own MSP_FC_VARIANT string. Anything else that speaks
  // MSP is still shown rather than rejected — INAV and Emuflight answer these
  // same commands, and the DFU reboot is a Betaflight-lineage feature they share.
  const variant = identity?.fcVariant

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
          Read what a Betaflight board is, keep a record of its settings, then put it into DFU so the
          firmware flasher below can write ArduPilot to it. Separate from the vehicle link — connecting
          here does not disturb a connected ArduPilot vehicle.
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

        {handedToDfu ? (
          <p className="bf-note bf-note--warning" data-testid="betaflight-dfu-handoff">
            The board acknowledged the DFU request and is rebooting. It will disappear from this list and
            come back as a DFU device — pick your ArduPilot firmware file in the flasher below and flash it.
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
                disabled={disabled || busy}
                onClick={msp.downloadDump}
              >
                Save Settings Dump
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
          Save the dump before rebooting to DFU — once ArduPilot is flashed the Betaflight settings are
          gone, and this is the only record of them.
        </small>
      </div>
    </section>
  )
}
