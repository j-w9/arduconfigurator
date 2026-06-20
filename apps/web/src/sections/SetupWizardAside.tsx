// Guided-setup wizard aside — the "Next Action" card (primary / context /
// support action buttons) and the Previous / Continue step navigation.
//
// Extracted verbatim from the wizardSlot JSX in App.tsx as part of the setup
// view decomposition. Purely presentational: the action descriptors and
// neighbour-section state come from the guided-setup-overview view-model, and
// the dispatch/navigation intent is passed in as onAction / onMove. App.tsx
// keeps the FC-facing handlers. Behavior-preserving.

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
  return (
    <aside className="setup-wizard__aside">
      <div className="setup-wizard__action-card">
        <strong>Next Action</strong>
        <p>
          {continueButtonTargeted && nextSetupSection
            ? `Continue to ${nextSetupSection.title}`
            : guidedSetupPrimaryAction
            ? guidedSetupPrimaryAction.label
            : 'Complete the current criteria or use the workspace navigation for more context.'}
        </p>
        {guidedSetupPrimaryAction ? (
          <>
            <div className="setup-wizard__action-pointer" aria-hidden="true">
              <span>→</span>
              <strong>Do this now</strong>
            </div>
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
          </>
        ) : null}
        {guidedSetupContextAction ? (
          <>
            <button
              style={buttonStyle(guidedSetupContextAction.tone ?? 'primary')}
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
      </div>

      <div className="setup-wizard__nav">
        <button style={buttonStyle()} onClick={() => onMove(-1)} disabled={!previousSetupSection}>
          Previous Step
        </button>
        <div className="setup-wizard__continue-slot">
          {continueButtonTargeted && nextSetupSection ? (
            <div className="setup-wizard__action-pointer" aria-hidden="true">
              <span>→</span>
              <strong>Do this now</strong>
            </div>
          ) : null}
          <button
            id={SETUP_WIZARD_NEXT_STEP_ID}
            className={`setup-wizard__continue-button${continueButtonTargeted ? ' setup-wizard__continue-button--target' : ''}`}
            data-testid="setup-wizard-next-step"
            style={{
              ...buttonStyle(nextSetupSection && selectedSetupSection.status === 'complete' ? 'hero' : 'secondary'),
              width: '100%'
            }}
            onClick={() => onMove(1)}
            disabled={!nextSetupSection || selectedSetupSection.status !== 'complete'}
          >
            {nextSetupSection ? `Continue to ${nextSetupSection.title}` : 'Setup Complete'}
          </button>
        </div>
      </div>
    </aside>
  )
}
