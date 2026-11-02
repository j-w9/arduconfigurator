// Guided-setup wizard aside — the step's action card (primary / context /
// support buttons plus the Previous / Continue navigation) and, below it, the
// "where you stand" card: the completion-criteria checklist and the live
// evidence pills.
//
// Extracted verbatim from the wizardSlot JSX in App.tsx as part of the setup
// view decomposition. Purely presentational: the action descriptors and
// neighbour-section state come from the guided-setup-overview view-model, and
// the dispatch/navigation intent is passed in as onAction / onMove. App.tsx
// keeps the FC-facing handlers.
//
// Two deliberate simplifications, from operator feedback that this panel is
// "pretty busy on the right side for each step":
//
//  1. The action card and the prev/next card were two separate bordered cards
//     stacked on top of each other, and the action card led with a paragraph
//     that restated the primary button's own label ("Continue to Outputs" above
//     a button reading "Continue to Outputs"). One card now, and that paragraph
//     only renders when there is NO action to point at — i.e. only when it says
//     something the buttons do not.
//  2. The "→ Do this now" pointer block above the targeted button is gone. The
//     hero button styling, the `--target` class and the arrow glyph inside the
//     button already carry that signal three times over.
//
// What did NOT change: every action descriptor the view-model produces is still
// rendered (primary + context + support). Those descriptors include the step
// waivers ("Orientation Verified Elsewhere — Continue", "Already Calibrated —
// Continue") that are the only escape hatch on steps whose exercise cannot run
// on a given build — dropping or folding any of them away would dead-end the
// flow, which is exactly the class of bug this surface has shipped before.

import type { ReactElement } from 'react'

import { buttonStyle } from '@arduconfig/ui-kit'

import { SETUP_WIZARD_NEXT_STEP_ID, SETUP_WIZARD_PRIMARY_ACTION_ID } from '../setup-flow-helpers'
import type { SetupFlowActionDescriptor, SetupFlowSectionDescriptor } from '../app-types'

export interface SetupWizardAsideProps {
  selectedSetupSection: SetupFlowSectionDescriptor
  previousSetupSection: SetupFlowSectionDescriptor | undefined
  nextSetupSection: SetupFlowSectionDescriptor | undefined
  continueButtonTargeted: boolean
  guidedSetupPrimaryAction: SetupFlowActionDescriptor | undefined
  guidedSetupContextAction: SetupFlowActionDescriptor | undefined
  guidedSetupContextHint: string | undefined
  /** The localhost-only ?guidedSetupStep= shortcut: a locked step is fully live under it. */
  guidedSetupTestingShortcutActive?: boolean
  guidedSetupSupportActions: SetupFlowActionDescriptor[]
  /** Every step complete. With the last step selected this swaps the action
   *  chain for the completion card. */
  guidedSetupComplete: boolean
  /** "2 already done • 1 deferred", or empty when every step was verified
   *  outright. Shown on the completion card. */
  guidedSetupOutcomeSummary: string
  onAction: (action: SetupFlowActionDescriptor) => void
  onMove: (offset: -1 | 1) => void
  /** Leave the wizard for Status & Info (the completion card's second button). */
  onClose: () => void
  /** Open the Calibration tab -- where the bench hands over to the first
   *  flight (hover throttle, tuning). The completion card's hero. */
  onOpenCalibration: () => void
}

/** How many support actions show before the rest fold behind "More…". */
const VISIBLE_SUPPORT_ACTIONS = 2

/**
 * Actions that must never fold: the undo of a recorded sign-off (a folded
 * undo is a trap), a reboot (the thing the step is waiting on), and a cancel
 * (the way out of something running).
 */
function isPinnedSupportAction(action: SetupFlowActionDescriptor): boolean {
  return (
    action.kind === 'clear-confirmation' ||
    action.kind === 'cancel-guided' ||
    (action.kind === 'guided' && action.actionId === 'reboot-autopilot')
  )
}

/** Evidence pills past this many fold; the aside has to fit one screen. */

export function SetupWizardAside({
  selectedSetupSection,
  previousSetupSection,
  nextSetupSection,
  continueButtonTargeted,
  guidedSetupPrimaryAction,
  guidedSetupContextAction,
  guidedSetupContextHint,
  guidedSetupTestingShortcutActive = false,
  guidedSetupSupportActions,
  guidedSetupComplete,
  guidedSetupOutcomeSummary,
  onAction,
  onMove,
  onClose,
  onOpenCalibration
}: SetupWizardAsideProps): ReactElement {
  const stepComplete = selectedSetupSection.status === 'complete'
  // Looking ahead: a locked step is shown with every action off. The brief
  // (its blocking reason) says which step to finish first.
  const preview = selectedSetupSection.sequenceState === 'locked' && !guidedSetupTestingShortcutActive
  // In a preview the way to the page stays open; what changes state is off.
  const previewBlocks = (action: SetupFlowActionDescriptor): boolean => preview && action.kind !== 'scroll'
  // The end of the flow: the last step, and nothing left anywhere. The action
  // chain has nothing useful to offer here (after the sign-off the step's only
  // action is its Clear), so the card says the setup is done and offers the
  // way out instead.
  const setupFinished = guidedSetupComplete && nextSetupSection === undefined && stepComplete
  // Only worth saying when neither the primary button nor the Continue button
  // is the answer — otherwise it is a caption for a button that is right there.
  const showActionGuidance = !guidedSetupPrimaryAction && !continueButtonTargeted && !setupFinished
  // One hero, at most two support actions in view, the rest behind "More…" --
  // the aside has to fit one desktop screen without scrolling (Radio has five
  // support actions). Pinned actions always show, even past the cap.
  const pinnedSupportActions = guidedSetupSupportActions.filter(isPinnedSupportAction)
  const unpinnedSupportActions = guidedSetupSupportActions.filter((action) => !isPinnedSupportAction(action))
  const unpinnedVisibleCount = Math.max(0, VISIBLE_SUPPORT_ACTIONS - pinnedSupportActions.length)
  const visibleSupportActions = [...pinnedSupportActions, ...unpinnedSupportActions.slice(0, unpinnedVisibleCount)]
  const foldedSupportActions = unpinnedSupportActions.slice(unpinnedVisibleCount)
  // The step builder may say what comes after this step in one line. The
  // field is optional on the descriptor; read it without depending on it so
  // the builder can grow it independently.
  const nextStep = (selectedSetupSection as { nextStep?: string }).nextStep

  const renderSupportAction = (action: SetupFlowActionDescriptor) => (
    <button
      key={`${selectedSetupSection.id}:${action.kind}:${action.label}`}
      style={buttonStyle('secondary')}
      onClick={() => onAction(action)}
      disabled={previewBlocks(action) || action.disabled}
    >
      {action.label}
    </button>
  )

  // The brief heads the rail: what to do, the first thing still needed, and
  // any reason the step is held. The work itself sits in the main pane.
  const nextUnmetCriterion = selectedSetupSection.criteria.find((criterion) => !criterion.met)

  return (
    <aside className="setup-wizard__aside">
      <div className="setup-wizard__brief">
        <p className="setup-wizard__instruction">{selectedSetupSection.detail}</p>
        {nextUnmetCriterion ? (
          <p className="setup-wizard__next-criterion" data-testid="setup-wizard-next-criterion">
            <strong>Still needed:</strong> {nextUnmetCriterion.label}
          </p>
        ) : null}
        {selectedSetupSection.blockingReason ? (
          <p className="setup-flow__blocking-copy">{selectedSetupSection.blockingReason}</p>
        ) : null}
      </div>
      <div
        className={`setup-wizard__action-card${setupFinished ? ' setup-wizard__action-card--finished' : ''}`}
        data-testid={setupFinished ? 'setup-wizard-finished' : undefined}
      >
        {setupFinished ? <strong>Setup complete</strong> : null}
        {setupFinished ? (
          <p>
            Setup on the bench is done
            {guidedSetupOutcomeSummary ? `: ${guidedSetupOutcomeSummary}` : ''}. Next: props on, pack on, first
            flight.
          </p>
        ) : null}
        {showActionGuidance ? <p>No button to press here. The checks below say what this step still needs.</p> : null}
        {setupFinished ? (
          <>
            <button
              id={SETUP_WIZARD_PRIMARY_ACTION_ID}
              className="setup-wizard__primary-button setup-wizard__primary-button--target"
              data-testid="setup-wizard-finish-calibration"
              style={buttonStyle('hero')}
              onClick={onOpenCalibration}
            >
              <span aria-hidden="true">→</span>
              <span>Open Calibration ▸ Flight</span>
            </button>
            <button style={buttonStyle('secondary')} data-testid="setup-wizard-finish" onClick={onClose}>
              Back to Status &amp; Info
            </button>
          </>
        ) : guidedSetupPrimaryAction ? (
          <button
            id={SETUP_WIZARD_PRIMARY_ACTION_ID}
            className={`setup-wizard__primary-button${
              guidedSetupPrimaryAction.disabled ? '' : ' setup-wizard__primary-button--target'
            }`}
            data-testid="setup-wizard-primary-action"
            style={buttonStyle(previewBlocks(guidedSetupPrimaryAction) || guidedSetupPrimaryAction.disabled ? 'secondary' : 'hero')}
            onClick={() => onAction(guidedSetupPrimaryAction)}
            disabled={previewBlocks(guidedSetupPrimaryAction) || guidedSetupPrimaryAction.disabled}
          >
            <span aria-hidden="true">→</span>
            <span>{guidedSetupPrimaryAction.label}</span>
          </button>
        ) : null}
        {nextStep && !setupFinished ? (
          <p className="setup-wizard__next" data-testid="setup-wizard-next">
            {nextStep}
          </p>
        ) : null}
        {guidedSetupContextAction && !setupFinished ? (
          <>
            {/* Always secondary. This is the "go look at another view" action;
             *  rendering it at its descriptor tone put a second primary-weight
             *  button directly under the hero, so the operator had to read both
             *  to find out which one advances the step. */}
            <button
              style={buttonStyle('secondary')}
              onClick={() => onAction(guidedSetupContextAction)}
              disabled={previewBlocks(guidedSetupContextAction) || guidedSetupContextAction.disabled}
            >
              {guidedSetupContextAction.label}
            </button>
            {guidedSetupContextHint ? <p className="setup-wizard__context-hint">{guidedSetupContextHint}</p> : null}
          </>
        ) : null}
        {visibleSupportActions.length > 0 ? (
          <div className="setup-wizard__support-actions">
            {/* Secondary, whatever the descriptor says. These are the waivers,
             *  the undo and the re-sync -- the long tail under the hero. One of
             *  them at its own 'primary' tone (Link's Re-sync) made a green
             *  button among grey ones with no reason it should stand out. */}
            {visibleSupportActions.map(renderSupportAction)}
          </div>
        ) : null}
        {foldedSupportActions.length > 0 ? (
          <details className="setup-wizard__more" data-testid="setup-wizard-more">
            <summary>More…</summary>
            <div className="setup-wizard__support-actions">{foldedSupportActions.map(renderSupportAction)}</div>
          </details>
        ) : null}

        <div className="setup-wizard__nav">
          <button style={buttonStyle()} onClick={() => onMove(-1)} disabled={!previousSetupSection}>
            Previous Step
          </button>
          {/* On the last step there is nowhere to continue to. Before the
           *  sign-off the button says what finishes the flow; after it the
           *  completion card above has taken over. */}
          <button
            id={SETUP_WIZARD_NEXT_STEP_ID}
            className={`setup-wizard__continue-button${continueButtonTargeted ? ' setup-wizard__continue-button--target guided-action-pulse' : ''}`}
            data-testid="setup-wizard-next-step"
            style={{
              ...buttonStyle(nextSetupSection && stepComplete ? 'hero' : 'secondary'),
              width: '100%'
            }}
            onClick={() => onMove(1)}
            disabled={!nextSetupSection || !stepComplete}
          >
            {continueButtonTargeted ? <span aria-hidden="true">→ </span> : null}
            {nextSetupSection ? `Continue to ${nextSetupSection.title}` : stepComplete ? 'Finish earlier steps' : 'Confirm to finish'}
          </button>
        </div>
      </div>

      {/* The panel's real job: why the step is or is not satisfied. Kept in the
       *  right column so the left column is only the task, and kept OPEN while
       *  the step is incomplete — a stuck step whose blocking criterion is
       *  folded away is undiagnosable. */}
      <div className="setup-wizard__status-card">
        <details className="setup-flow__criteria" data-testid="setup-wizard-criteria" open={!stepComplete}>
          <summary>
            <strong>Checks</strong>
            <span className="setup-flow__criteria-count">
              {selectedSetupSection.criteriaMetCount}/{selectedSetupSection.criteria.length} done
            </span>
          </summary>
          <ul>
            {selectedSetupSection.criteria.map((criterion) => (
              <li key={criterion.label} className={criterion.met ? 'is-met' : undefined}>
                {/* The met/unmet word was an 88px column of "Complete"/"Pending"
                 *  repeated down the list. A glyph carries the same signal in a
                 *  fraction of the height; the word stays for screen readers. */}
                <span aria-hidden="true" className="setup-flow__criteria-mark">
                  {criterion.met ? '✓' : '○'}
                </span>
                <span className="visually-hidden">{criterion.met ? 'Complete' : 'Pending'}</span>
                <span>{criterion.label}</span>
              </li>
            ))}
          </ul>
        </details>
      </div>
    </aside>
  )
}
