// Guided-setup wizard header — the step eyebrow/title/summary, the
// sequence/criteria/outcome status badges, the progress bar, the clickable
// step rail, and the optional follow-up banner.
//
// Extracted verbatim from the wizardSlot JSX in App.tsx as part of the setup
// view decomposition. Purely presentational: section state comes from the
// guided-setup-overview view-model; selecting a step is passed in as
// onSelectStep (which both sets the selected section and forces wizard mode).
// Behavior-preserving.

import type { ReactElement } from 'react'

import { StatusBadge } from '@arduconfig/ui-kit'

import { formatSetupOutcome } from '../setup-format-helpers'
import { toneForSetup, toneForSetupSequence } from '../tone-helpers'
import type { SetupFlowFollowUpDescriptor, SetupFlowSectionDescriptor } from '../app-types'

export interface SetupWizardHeaderProps {
  selectedSetupSection: SetupFlowSectionDescriptor
  selectedSetupSectionIndex: number
  setupFlowSections: SetupFlowSectionDescriptor[]
  setupFlowProgress: number
  setupFlowFollowUp: SetupFlowFollowUpDescriptor | undefined
  guidedSetupTestingShortcutActive: boolean
  onSelectStep: (sectionId: string) => void
  /** Forget every confirmation and exercise and start the flow again. */
  onResetProgress: () => void
}

export function SetupWizardHeader({
  selectedSetupSection,
  selectedSetupSectionIndex,
  setupFlowSections,
  setupFlowProgress,
  setupFlowFollowUp,
  guidedSetupTestingShortcutActive,
  onSelectStep,
  onResetProgress
}: SetupWizardHeaderProps): ReactElement {
  return (
    <>
      <div className="setup-wizard__header">
        <div>
          <p className="eyebrow">Step {selectedSetupSectionIndex + 1} of {setupFlowSections.length}</p>
          <h3>{selectedSetupSection.title}</h3>
          <p>{selectedSetupSection.summary}</p>
        </div>
        <div className="setup-wizard__header-status">
          <StatusBadge tone={toneForSetupSequence(selectedSetupSection.sequenceState)}>{selectedSetupSection.sequenceState}</StatusBadge>
          <StatusBadge tone={toneForSetup(selectedSetupSection.status)}>
            {selectedSetupSection.criteriaMetCount}/{selectedSetupSection.criteria.length} criteria
          </StatusBadge>
          {guidedSetupTestingShortcutActive ? <StatusBadge tone="warning">Testing shortcut</StatusBadge> : null}
          {selectedSetupSection.confirmationOutcome && selectedSetupSection.confirmationOutcome !== 'complete' ? (
            <StatusBadge tone="warning">{formatSetupOutcome(selectedSetupSection.confirmationOutcome)}</StatusBadge>
          ) : null}
          {/* Progress is durable and keyed to the board, so a half-finished
              flow follows an operator across reloads and reconnects with no
              way out. The confirm is explicit that this forgets confirmations
              rather than un-writing anything already applied. */}
          <button
            type="button"
            className="setup-wizard__reset"
            data-testid="setup-wizard-reset"
            title="Forget every confirmed step and start guided setup from the beginning"
            onClick={() => {
              if (
                typeof window !== 'undefined' &&
                !window.confirm(
                  'Start guided setup over?\n\n' +
                    'Every step becomes unconfirmed and the exercises are cleared. Parameters already written ' +
                    'to the vehicle are NOT changed.'
                )
              ) {
                return
              }
              onResetProgress()
            }}
          >
            Reset progress
          </button>
        </div>
      </div>

      {selectedSetupSection.status === 'complete' ? (
        <div className="setup-wizard__complete-banner" data-testid="setup-wizard-complete-banner" role="status">
          <span className="setup-wizard__complete-check" aria-hidden="true">✓</span>
          <strong>{selectedSetupSection.title} complete</strong>
          <span className="setup-wizard__complete-count">
            {selectedSetupSection.criteriaMetCount}/{selectedSetupSection.criteria.length} checks
          </span>
        </div>
      ) : null}

      <div className="switch-exercise-progress" aria-hidden="true">
        <div className="switch-exercise-progress__fill" style={{ width: `${setupFlowProgress}%` }} />
      </div>

      <div className="setup-wizard__steps">
        {setupFlowSections.map((section, index) => (
          <button
            key={section.id}
            type="button"
            className={`setup-wizard-step${section.id === selectedSetupSection.id ? ' is-active' : ''}${section.status === 'complete' ? ' is-complete' : ''}${section.sequenceState === 'current' ? ' is-current' : ''}${section.sequenceState === 'locked' ? ' is-locked' : ''}`}
            onClick={() => onSelectStep(section.id)}
            disabled={!guidedSetupTestingShortcutActive && section.sequenceState === 'locked'}
          >
            <small>Step {index + 1}</small>
            <span>{section.title}</span>
            {section.sequenceState === 'current' ? <em className="setup-wizard-step__cue">Do this now →</em> : null}
          </button>
        ))}
      </div>

      {setupFlowFollowUp ? (
        <div className={`setup-flow__banner setup-flow__banner--${setupFlowFollowUp.tone}`}>
          <div>
            <strong>{setupFlowFollowUp.title}</strong>
            <p>{setupFlowFollowUp.text}</p>
          </div>
        </div>
      ) : null}
    </>
  )
}
