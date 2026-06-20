// "Enter DFU / bootloader mode" card from the Status & Info overview — a
// two-step armed confirm that reboots the FC into its USB DFU bootloader.
//
// Extracted verbatim from the overviewSlot JSX in App.tsx as part of the
// setup view decomposition. Purely presentational: the armed state and the
// connect/armed gating are passed in; the reboot intent is onConfirm.
// Behavior-preserving.

import type { ReactElement } from 'react'

import { buttonStyle } from '@arduconfig/ui-kit'

export interface StatusDfuCardProps {
  connected: boolean
  vehicleArmed: boolean
  armed: boolean
  onArm: () => void
  onConfirm: () => void
  onCancel: () => void
}

export function StatusDfuCard({ connected, vehicleArmed, armed, onArm, onConfirm, onCancel }: StatusDfuCardProps): ReactElement {
  return (
    <div className="setup-bench__dfu" data-testid="status-dfu">
      <div className="setup-bench__dfu-copy">
        <strong>Enter DFU / bootloader mode</strong>
        <p>
          Reboots the flight controller into its USB DFU bootloader for firmware flashing. The board
          drops its MAVLink link and re-enumerates — only do this when you intend to flash.
          Calibration now lives in the Calibration tab.
        </p>
      </div>
      {!armed ? (
        <button
          type="button"
          style={buttonStyle('secondary')}
          data-testid="status-dfu-button"
          onClick={onArm}
          disabled={!connected || vehicleArmed}
          title={
            !connected
              ? 'Connect to a vehicle first.'
              : vehicleArmed
                ? 'Disarm the vehicle before entering DFU.'
                : undefined
          }
        >
          Enter DFU mode
        </button>
      ) : (
        <div className="setup-bench__dfu-confirm">
          <button
            type="button"
            style={buttonStyle('secondary')}
            className="setup-bench__dfu-danger"
            data-testid="status-dfu-confirm"
            onClick={onConfirm}
          >
            Confirm: reboot to DFU
          </button>
          <button type="button" style={buttonStyle()} onClick={onCancel}>
            Cancel
          </button>
        </div>
      )}
    </div>
  )
}
