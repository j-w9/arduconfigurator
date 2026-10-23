// The persistent staged-changes bar. Editing any param tab stages a draft; this
// bar follows the operator across every tab while edits are pending and offers
// one place to review (Show changes -> Parameters), write the whole set (Write
// all), or discard. App owns the visibility gate (connected + has staged/invalid
// changes, or a reboot pending) and renders this inside it.
//
// The bar itself is ui-kit's `DraftBar`; this adapts ArduPilot's draft summary
// and the app's busy-action names to it. Same markup, data-testids, class
// names, copy and disabled conditions as when the bar was drawn here.

import type { ParameterDraftSummary } from '@arduconfig/ardupilot-core'
import { DraftBar } from '@arduconfig/ui-kit'

export interface ParameterDraftBarProps {
  summary: ParameterDraftSummary
  busyAction: string | undefined
  canApplyAllDraftParameters: boolean
  applyAllBusyLabel: string
  /** True when a completed write left the FC needing a reboot and nothing is
   *  staged — the bar becomes a prominent reboot prompt in place of the write
   *  controls, so the operator never has to scroll to find the reboot button. */
  rebootPending: boolean
  onShowChanges: () => void
  onWriteAll: () => void
  onDiscard: () => void
  onRequestReboot: () => void
}

export function ParameterDraftBar({
  summary,
  busyAction,
  canApplyAllDraftParameters,
  applyAllBusyLabel,
  rebootPending,
  onShowChanges,
  onWriteAll,
  onDiscard,
  onRequestReboot
}: ParameterDraftBarProps) {
  return (
    <DraftBar
      stagedCount={summary.stagedCount}
      invalidCount={summary.invalidCount}
      detail={summary.stagedCategories.length > 0 ? summary.stagedCategories.join(', ') : undefined}
      busy={busyAction !== undefined}
      canWrite={canApplyAllDraftParameters}
      writeLabel={busyAction === 'param:apply-all' ? applyAllBusyLabel : 'Write all'}
      onShowChanges={onShowChanges}
      onWrite={onWriteAll}
      onDiscard={onDiscard}
      // ArduPilot asks for a reboot constantly and new operators don't expect
      // it, so once a write needs one it becomes the bar's single action.
      reboot={{
        pending: rebootPending,
        message: 'Reboot the flight controller to apply the change(s) you just wrote.',
        buttonLabel: busyAction === 'reboot-autopilot' ? 'Rebooting…' : 'Request Reboot',
        onRequest: onRequestReboot
      }}
      testIdPrefix="global-"
    />
  )
}
