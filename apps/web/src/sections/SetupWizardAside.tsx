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
  guidedSetupSupportActions: SetupFlowActionDescriptor[]
  onAction: (action: SetupFlowActionDescriptor) => void
  onMove: (offset: -1 | 1) => void
}

export function SetupWizardAside({
  selectedSetupSection,
  previousSetupSection,
  nextSetupSection,
  continueButtonTargeted,
  guidedSetupPrimaryAction,
  guidedSetupContextAction,
  guidedSetupContextHint,
  guidedSetupSupportActions,
  onAction,
  onMove
}: SetupWizardAsideProps): ReactElement {
  const stepComplete = selectedSetupSection.status === 'complete'
  // Only worth saying when neither the primary button nor the Continue button
  // is the answer — otherwise it is a caption for a button that is right there.
  const showActionGuidance = !guidedSetupPrimaryAction && !continueButtonTargeted

  return (
    <aside className="setup-wizard__aside">
      <div className="setup-wizard__action-card">
        <strong>Next Action</strong>
        {showActionGuidance ? <p>Complete the current criteria or use the workspace navigation for more context.</p> : null}
        {guidedSetupPrimaryAction ? (
          <button
            id={SETUP_WIZARD_PRIMARY_ACTION_ID}
            className={`setup-wizard__primary-button${
              guidedSetupPrimaryAction.disabled ? '' : ' setup-wizard__primary-button--target'
            }`}
            data-testid="setup-wizard-primary-action"
            style={buttonStyle(guidedSetupPrimaryAction.disabled ? 'secondary' : 'hero')}
            onClick={() => onAction(guidedSetupPrimaryAction)}
            disabled={guidedSetupPrimaryAction.disabled}
          >
            <span aria-hidden="true">→</span>
            <span>{guidedSetupPrimaryAction.label}</span>
          </button>
        ) : null}
        {guidedSetupContextAction ? (
          <>
            {/* Always secondary. This is the "go look at another view" action;
             *  rendering it at its descriptor tone put a second primary-weight
             *  button directly under the hero, so the operator had to read both
             *  to find out which one advances the step. */}
            <button
              style={buttonStyle('secondary')}
              onClick={() => onAction(guidedSetupContextAction)}
              disabled={guidedSetupContextAction.disabled}
            >
              {guidedSetupContextAction.label}
            </button>
            {guidedSetupContextHint ? <p className="setup-wizard__context-hint">{guidedSetupContextHint}</p> : null}
          </>
        ) : null}
        {guidedSetupSupportActions.length > 0 ? (
          <div className="setup-wizard__support-actions">
            {guidedSetupSupportActions.map((action) => (
              <button
                key={`${selectedSetupSection.id}:${action.kind}:${action.label}`}
                style={buttonStyle(action.tone ?? 'secondary')}
                onClick={() => onAction(action)}
                disabled={action.disabled}
              >
                {action.label}
              </button>
            ))}
          </div>
        ) : null}

        <div className="setup-wizard__nav">
          <button style={buttonStyle()} onClick={() => onMove(-1)} disabled={!previousSetupSection}>
            Previous Step
          </button>
          <button
            id={SETUP_WIZARD_NEXT_STEP_ID}
            className={`setup-wizard__continue-button${continueButtonTargeted ? ' setup-wizard__continue-button--target guided-action-pulse' : ''}`}
            data-testid="setup-wizard-next-step"
            style={{
              ...buttonStyle(nextSetupSection && selectedSetupSection.status === 'complete' ? 'hero' : 'secondary'),
              width: '100%'
            }}
            onClick={() => onMove(1)}
            disabled={!nextSetupSection || selectedSetupSection.status !== 'complete'}
          >
            {continueButtonTargeted ? <span aria-hidden="true">→ </span> : null}
            {nextSetupSection ? `Continue to ${nextSetupSection.title}` : 'Setup Complete'}
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
            <strong>Completion Criteria</strong>
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

        {selectedSetupSection.evidence.length > 0 ? (
          <div className="setup-wizard__evidence">
            <strong>Live Evidence</strong>
            <div className="config-pills">
              {selectedSetupSection.evidence.map((item) => (
                <span key={item}>{item}</span>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </aside>
  )
}
