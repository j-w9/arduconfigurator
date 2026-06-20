// Guided-setup overview derivation for the Setup view wizard.
//
// Part of the App.tsx view-model decomposition. Once buildSetupFlowSections
// produces the ordered section descriptors, App.tsx derived a cluster of
// ~115 lines of view-state from that list plus the operator's current
// selection: which section is recommended/selected, neighbour sections for
// the prev/next controls, completion progress, the not-applicable/already-
// done/deferred outcome tally, and the primary/context/support action split
// the guided footer renders. It is a pure derivation over the section list,
// the selected section id, the testing-shortcut flag, and the orientation /
// motor-verification statuses, so it is lifted verbatim into
// buildGuidedSetupOverview. App.tsx passes those inputs in and destructures
// the result. Behavior-preserving — the action descriptors stay plain data
// dispatched later by handleSetupFlowAction, so no handler closures move.

import type {
  MotorVerificationStatus,
  OrientationExerciseStatus,
  SetupFlowActionDescriptor,
  SetupFlowSectionDescriptor
} from '../app-types'

export interface GuidedSetupOverviewInputs {
  setupFlowSections: SetupFlowSectionDescriptor[]
  selectedSetupSectionId: string | undefined
  guidedSetupTestingShortcutActive: boolean
  orientationExerciseStatus: OrientationExerciseStatus
  motorVerificationStatus: MotorVerificationStatus
}

export interface GuidedSetupOutcomeCounts {
  notApplicable: number
  alreadyDone: number
  deferred: number
}

export interface GuidedSetupOverview {
  recommendedSetupSection: SetupFlowSectionDescriptor | undefined
  selectedSetupSectionCandidate: SetupFlowSectionDescriptor | undefined
  selectedSetupSection: SetupFlowSectionDescriptor | undefined
  selectedSetupSectionIndex: number
  previousSetupSection: SetupFlowSectionDescriptor | undefined
  nextSetupSection: SetupFlowSectionDescriptor | undefined
  completedSetupSectionCount: number
  setupFlowProgress: number
  guidedSetupComplete: boolean
  setupOutcomeCounts: GuidedSetupOutcomeCounts
  guidedSetupHasExceptions: boolean
  guidedSetupOutcomeSummary: string
  guidedSetupTaskAction: SetupFlowActionDescriptor | undefined
  guidedSetupTaskStillRequired: boolean
  continueButtonTargeted: boolean
  guidedSetupPrimaryAction: SetupFlowActionDescriptor | undefined
  guidedSetupContextAction: SetupFlowActionDescriptor | undefined
  guidedSetupSupportActions: SetupFlowActionDescriptor[]
  guidedSetupContextHint: string | undefined
}

export function buildGuidedSetupOverview(inputs: GuidedSetupOverviewInputs): GuidedSetupOverview {
  const {
    setupFlowSections,
    selectedSetupSectionId,
    guidedSetupTestingShortcutActive,
    orientationExerciseStatus,
    motorVerificationStatus
  } = inputs

  const recommendedSetupSection =
    setupFlowSections.find((section) => section.sequenceState === 'current') ??
    setupFlowSections.find((section) => section.status !== 'complete') ??
    setupFlowSections[0]
  const selectedSetupSectionCandidate = setupFlowSections.find((section) => section.id === selectedSetupSectionId)
  const selectedSetupSection =
    !selectedSetupSectionCandidate || (!guidedSetupTestingShortcutActive && selectedSetupSectionCandidate.sequenceState === 'locked')
      ? recommendedSetupSection
      : selectedSetupSectionCandidate
  const selectedSetupSectionIndex = selectedSetupSection
    ? setupFlowSections.findIndex((section) => section.id === selectedSetupSection.id)
    : -1
  const previousSetupSection =
    selectedSetupSectionIndex > 0 ? setupFlowSections[selectedSetupSectionIndex - 1] : undefined
  const nextSetupSection =
    selectedSetupSectionIndex >= 0 && selectedSetupSectionIndex < setupFlowSections.length - 1
      ? setupFlowSections[selectedSetupSectionIndex + 1]
      : undefined
  const completedSetupSectionCount = setupFlowSections.filter((section) => section.status === 'complete').length
  const setupFlowProgress = setupFlowSections.length === 0 ? 0 : (completedSetupSectionCount / setupFlowSections.length) * 100
  const guidedSetupComplete = setupFlowSections.length > 0 && completedSetupSectionCount === setupFlowSections.length
  const setupOutcomeCounts = setupFlowSections.reduce(
    (counts, section) => {
      switch (section.confirmationOutcome) {
        case 'not-applicable':
          counts.notApplicable += 1
          break
        case 'already-done':
          counts.alreadyDone += 1
          break
        case 'deferred':
          counts.deferred += 1
          break
        default:
          break
      }
      return counts
    },
    {
      notApplicable: 0,
      alreadyDone: 0,
      deferred: 0
    }
  )
  const guidedSetupHasExceptions =
    setupOutcomeCounts.notApplicable > 0 || setupOutcomeCounts.alreadyDone > 0 || setupOutcomeCounts.deferred > 0
  const guidedSetupOutcomeSummary = [
    setupOutcomeCounts.notApplicable > 0 ? `${setupOutcomeCounts.notApplicable} not applicable` : undefined,
    setupOutcomeCounts.alreadyDone > 0 ? `${setupOutcomeCounts.alreadyDone} already done` : undefined,
    setupOutcomeCounts.deferred > 0 ? `${setupOutcomeCounts.deferred} deferred` : undefined
  ]
    .filter((item): item is string => item !== undefined)
    .join(' • ')
  const guidedSetupTaskAction =
    selectedSetupSection?.actions.find((action) =>
      ['orientation-exercise', 'motor-verification-start', 'motor-test-current', 'motor-verification-confirm', 'motor-verification-reset'].includes(action.kind)
    )
  const guidedSetupTaskStillRequired = (() => {
    if (!guidedSetupTaskAction) {
      return false
    }

    switch (guidedSetupTaskAction.kind) {
      case 'orientation-exercise':
        return orientationExerciseStatus !== 'passed'
      case 'motor-verification-start':
      case 'motor-test-current':
      case 'motor-verification-confirm':
      case 'motor-verification-reset':
        return motorVerificationStatus !== 'passed'
      default:
        return false
    }
  })()
  const continueButtonTargeted =
    selectedSetupSection?.status === 'complete' &&
    nextSetupSection !== undefined
  const guidedSetupPrimaryAction =
    continueButtonTargeted
      ? undefined
      : guidedSetupTaskStillRequired
        ? guidedSetupTaskAction
        : selectedSetupSection?.actions.find(
            (action) =>
              action !== guidedSetupTaskAction &&
              action.tone === 'primary' &&
              action.kind !== 'scroll' &&
              action.kind !== 'clear-confirmation'
          ) ??
          selectedSetupSection?.actions.find(
            (action) =>
              action !== guidedSetupTaskAction && action.kind === 'confirm-step' && action.disabled !== true
          ) ??
          selectedSetupSection?.actions.find(
            (action) =>
              action !== guidedSetupTaskAction && action.kind !== 'scroll' && action.kind !== 'clear-confirmation'
          ) ??
          selectedSetupSection?.actions[0]
  const guidedSetupContextAction =
    selectedSetupSection?.actions.find((action) => action.kind === 'scroll' && action.panelId !== 'setup-panel-guided')
  const guidedSetupSupportActions =
    selectedSetupSection?.actions.filter(
      (action) =>
        action !== guidedSetupTaskAction &&
        action !== guidedSetupPrimaryAction &&
        action !== guidedSetupContextAction &&
        !(action.kind === 'scroll' && action.panelId === 'setup-panel-guided')
    ) ?? []
  const guidedSetupContextHint =
    selectedSetupSection?.id === 'airframe'
      ? 'Opening the board-orientation page does not complete this step. The orientation check must pass and the airframe review must still be confirmed here.'
      : selectedSetupSection?.id === 'outputs'
        ? 'Opening the motor-verification bench does not complete this step. Motor order verification plus the output and ESC reviews still need to be completed.'
        : undefined

  return {
    recommendedSetupSection,
    selectedSetupSectionCandidate,
    selectedSetupSection,
    selectedSetupSectionIndex,
    previousSetupSection,
    nextSetupSection,
    completedSetupSectionCount,
    setupFlowProgress,
    guidedSetupComplete,
    setupOutcomeCounts,
    guidedSetupHasExceptions,
    guidedSetupOutcomeSummary,
    guidedSetupTaskAction,
    guidedSetupTaskStillRequired,
    continueButtonTargeted,
    guidedSetupPrimaryAction,
    guidedSetupContextAction,
    guidedSetupSupportActions,
    guidedSetupContextHint
  }
}
