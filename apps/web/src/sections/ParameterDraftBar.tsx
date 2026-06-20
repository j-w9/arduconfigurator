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
  onShowChanges: () => void
  onWriteAll: () => void
  onDiscard: () => void
}

export function ParameterDraftBar({
  summary,
  busyAction,
  canApplyAllDraftParameters,
  applyAllBusyLabel,
  onShowChanges,
  onWriteAll,
  onDiscard
}: ParameterDraftBarProps) {
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
