import type { ReactElement } from 'react'

import { buttonStyle } from '@arduconfig/ui-kit'

// The "you picked a DroneCAN peripheral but the bus is still off" prompt.
//
// Lifted verbatim out of CanBus.tsx (it lived inline there since the helper
// shipped) so a SECOND surface can raise the same offer without a second
// implementation drifting away from the first: the Servos ▸ Peripherals
// optical-flow section shows it when FLOW_TYPE = 6 (DroneCAN) and CAN bus 1 is
// disabled. That is the exact trap a real operator hit — a CAN flow sensor
// configured, wired, and silent — and it is far more useful next to the type
// dropdown that caused it than three tabs away.
//
// Dumb presentational component: the reasons and the handler are computed in
// App.tsx from deriveCanEnablement. `testId` is a prop rather than a constant
// because two instances can be mounted in the same app and each needs its own
// stable hook; the CAN tab keeps the original id so existing e2e is untouched.

export interface CanEnablePromptProps {
  /** Human-readable reasons, e.g. "Optical flow is set to DroneCAN". */
  triggerLabels: string[]
  onEnable: () => void
  /** Disables the button while the write + reboot is in flight. */
  busy?: boolean
  testId?: string
  buttonTestId?: string
}

export function CanEnablePrompt({
  triggerLabels,
  onEnable,
  busy,
  // Defaults reproduce the CAN tab's original hooks exactly, so its e2e block
  // keeps passing unchanged after the extraction.
  testId = 'can-enable-prompt',
  buttonTestId = 'can-enable-button'
}: CanEnablePromptProps): ReactElement {
  return (
    <div className="can-bus-enable-prompt" role="status" data-testid={testId}>
      <div className="can-bus-enable-prompt__body">
        <strong>Enable the CAN bus for DroneCAN?</strong>
        <p>
          {triggerLabels.join(', ')}, but CAN bus 1 isn’t enabled — nodes won’t be found until it is.
          This sets <code>CAN_P1_DRIVER=1</code> and <code>CAN_D1_PROTOCOL=1</code> (DroneCAN) and needs a reboot.
        </p>
      </div>
      <button
        type="button"
        style={buttonStyle('primary')}
        data-testid={buttonTestId}
        onClick={onEnable}
        disabled={busy}
      >
        {busy ? 'Enabling…' : 'Enable CAN bus & reboot'}
      </button>
    </div>
  )
}
