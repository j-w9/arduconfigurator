// Guided-setup wizard header — the step eyebrow/title/summary, the
// sequence/criteria/outcome status badges, the progress bar, the clickable
// step rail, and the optional follow-up banner.
//
// Extracted verbatim from the wizardSlot JSX in App.tsx as part of the setup
// view decomposition. Purely presentational: section state comes from the
// guided-setup-overview view-model; selecting a step is passed in as
// onSelectStep (which both sets the selected section and forces wizard mode).
// Behavior-preserving.

import { useEffect, useRef, type ReactElement } from 'react'

import { StatusBadge } from '@arduconfig/ui-kit'

import { formatSetupOutcome } from '../setup-format-helpers'
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
  const activeStepRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    activeStepRef.current?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' })
  }, [selectedSetupSection.id])

  return (
    <>
      <div className="setup-wizard__header">
        <div className="setup-wizard__header-main">
          <div className="setup-wizard__header-title">
            <p className="eyebrow">Step {selectedSetupSectionIndex + 1} of {setupFlowSections.length}</p>
            <h3>{selectedSetupSection.title}</h3>
          </div>
          <p>{selectedSetupSection.summary}</p>
        </div>
        <div className="setup-wizard__header-status">
          {/* A locked step opens read-only: a look ahead, with its actions off. */}
          {selectedSetupSection.sequenceState === 'locked' ? (
            <span className="setup-wizard__preview-chip" data-testid="setup-wizard-preview" role="status">
              Preview
            </span>
          ) : null}
          {/* A complete step says so in a small chip, not a banner of its own. */}
          {selectedSetupSection.status === 'complete' ? (
            <span className="setup-wizard__complete-chip" data-testid="setup-wizard-complete-banner" role="status">
              ✓ complete
            </span>
          ) : null}
          {/* The sequence state used to render here as a raw enum badge
           *  ("current", "complete", "locked"). The rail chip already carries it
           *  as styling and a "Do this now" cue, and the complete banner below
           *  says "complete" in words. */}
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
            title="Start guided setup over"
            onClick={() => {
              if (
                typeof window !== 'undefined' &&
                !window.confirm(
                  'Start guided setup over?\n\n' +
                    'Every step is unconfirmed again. Nothing already written to the vehicle changes.'
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


      <div className="switch-exercise-progress" aria-hidden="true">
        <div className="switch-exercise-progress__fill" style={{ width: `${setupFlowProgress}%` }} />
      </div>

      <div className="setup-wizard__steps">
        {setupFlowSections.map((section, index) => (
          <button
            key={section.id}
            /* The rail is a single horizontal scroller ~3 viewports wide on a
               phone, and it never scrolled itself: past step 4 the chip marking
               where the operator IS sat off-screen with no cue it existed. */
            ref={section.id === selectedSetupSection.id ? activeStepRef : undefined}
            type="button"
            /* The wizard's primary navigation, so it gets a stable hook like
               every other interactive surface here. Without it an e2e has to
               target the CSS class, which couples the test to styling and
               cannot name WHICH step it means. The state also travels as data
               attributes: a test asserting the flow gates correctly needs to
               read complete/current/locked, and scraping the class string for
               that is exactly the brittleness the testid convention exists to
               avoid. */
            data-testid={`setup-step-${section.id}`}
            data-step-state={section.sequenceState}
            data-step-status={section.status}
            className={`setup-wizard-step${section.id === selectedSetupSection.id ? ' is-active' : ''}${section.status === 'complete' ? ' is-complete' : ''}${section.sequenceState === 'current' ? ' is-current' : ''}${section.sequenceState === 'locked' ? ' is-locked' : ''}`}
            onClick={() => onSelectStep(section.id)}
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
