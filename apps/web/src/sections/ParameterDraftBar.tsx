// The persistent staged-changes bar, extracted from App.tsx as part of its
// decomposition. A dumb presentational component (the established sections/
// pattern): it imports no runtime / transport / MAVLink modules — App owns the
// visibility gate (connected + has staged/invalid changes) and renders this
// inside it, passing the draft summary plus plain action callbacks. Editing
// any param tab stages a draft; this bar follows the operator across every tab
// while edits are pending and offers one place to review (Show changes ->
// Parameters), write the whole set (Write all), or discard.
//
// Behavior-neutral lift of the original inline JSX: same markup, same
// data-testids, same class names, same copy, same disabled conditions.

import type { ParameterDraftSummary } from '@arduconfig/ardupilot-core'
import { buttonStyle } from '@arduconfig/ui-kit'

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
  // Reboot mode: the write is done and nothing is staged, but the FC needs a
  // reboot to apply it. ArduPilot asks for a reboot constantly and new operators
  // don't expect it, so the reboot becomes the bar's single prominent action —
  // in the same always-on-screen spot the Write-all button just occupied.
  if (rebootPending && summary.stagedCount === 0 && summary.invalidCount === 0) {
    return (
      <div className="parameter-draft-bar parameter-draft-bar--reboot" data-testid="global-draft-bar">
        <div className="parameter-draft-bar__summary">
          <strong data-testid="global-reboot-required">Reboot required</strong>
          <small>Reboot the flight controller to apply the change(s) you just wrote.</small>
        </div>
        <div className="parameter-draft-bar__actions">
          <button
            type="button"
            data-testid="global-draft-reboot"
            style={buttonStyle('primary')}
            onClick={onRequestReboot}
            disabled={busyAction !== undefined}
          >
            {busyAction === 'reboot-autopilot' ? 'Rebooting…' : 'Request Reboot'}
          </button>
        </div>
      </div>
    )
  }
  return (
    <div className="parameter-draft-bar" data-testid="global-draft-bar">
      <div className="parameter-draft-bar__summary">
        <strong data-testid="global-draft-count">
          {summary.stagedCount} staged change{summary.stagedCount === 1 ? '' : 's'}
        </strong>
        {summary.invalidCount > 0 ? (
          <span className="parameter-draft-bar__invalid">{summary.invalidCount} invalid</span>
        ) : null}
        {summary.stagedCategories.length > 0 ? (
          <small>{summary.stagedCategories.join(', ')}</small>
        ) : null}
      </div>
      <div className="parameter-draft-bar__actions">
        <button
          type="button"
          data-testid="global-draft-show"
          style={buttonStyle()}
          onClick={onShowChanges}
        >
          Show changes
        </button>
        <button
          type="button"
          data-testid="global-draft-write"
          style={buttonStyle('primary')}
          onClick={onWriteAll}
          disabled={
            busyAction !== undefined ||
            !canApplyAllDraftParameters ||
            summary.stagedCount === 0 ||
            summary.invalidCount > 0
          }
        >
          {busyAction === 'param:apply-all' ? applyAllBusyLabel : 'Write all'}
        </button>
        <button
          type="button"
          data-testid="global-draft-discard"
          style={buttonStyle()}
          onClick={onDiscard}
          disabled={busyAction !== undefined}
        >
          Discard
        </button>
      </div>
    </div>
  )
}
