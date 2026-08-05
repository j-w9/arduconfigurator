// "Reset to Defaults" — erase every parameter back to firmware defaults.
//
// The underlying action already existed in the Presets view; this makes it
// reachable from Parameters and Snapshots, which is where operators actually
// are when they decide they want a clean slate.
//
// Two-click arm/confirm, deliberately. In Presets this sits in a
// destructive-actions context you arrive at on purpose; near the top of
// Parameters it is adjacent to controls used constantly, and a misclick costs a
// full retune. The same shape the Flash tab uses for DFU and bootloader writes.
//
// Presentational only: the caller owns the erase itself, so the gating,
// verified-write and reboot behaviour stay in one place rather than being
// reimplemented per surface.

import { useState, type ReactElement } from 'react'

import { buttonStyle } from '@arduconfig/ui-kit'

export interface ResetToDefaultsButtonProps {
  /** Erase all parameters and reboot. Undefined when there is no live link. */
  onReset: (() => void | Promise<void>) | undefined
  /** Why the reset cannot run (disconnected / armed), shown as the title. */
  disabledReason: string | undefined
  /** True while the erase is in flight. */
  isResetting: boolean
  /** True while any other action holds the runtime. */
  isBusy: boolean
  /** Surface name, so the confirm copy can say where snapshots live. */
  suggestSnapshot?: boolean
}

export function ResetToDefaultsButton({
  onReset,
  disabledReason,
  isResetting,
  isBusy,
  suggestSnapshot = false
}: ResetToDefaultsButtonProps): ReactElement | null {
  const [armed, setArmed] = useState(false)

  if (!onReset) {
    return null
  }

  if (!armed) {
    return (
      <button
        type="button"
        style={buttonStyle()}
        className="reset-defaults-button"
        data-testid="reset-to-defaults"
        disabled={isResetting || isBusy || Boolean(disabledReason)}
        title={disabledReason}
        onClick={() => setArmed(true)}
      >
        Reset to Defaults
      </button>
    )
  }

  return (
    <span className="reset-defaults-confirm" data-testid="reset-to-defaults-confirm-row">
      <span className="reset-defaults-confirm__warning" data-testid="reset-to-defaults-warning">
        Erase every parameter back to firmware defaults and reboot? Your tuning, calibrations and
        port setup are all lost.
        {suggestSnapshot ? ' Capture a snapshot first if you want a way back.' : ''}
      </span>
      <button
        type="button"
        style={buttonStyle()}
        className="reset-defaults-button reset-defaults-button--danger"
        data-testid="reset-to-defaults-confirm"
        disabled={isResetting}
        onClick={() => {
          setArmed(false)
          void onReset()
        }}
      >
        {isResetting ? 'Erasing…' : 'Confirm: erase all settings'}
      </button>
      <button
        type="button"
        style={buttonStyle()}
        data-testid="reset-to-defaults-cancel"
        disabled={isResetting}
        onClick={() => setArmed(false)}
      >
        Cancel
      </button>
    </span>
  )
}
