import { describe, expect, it } from 'vitest'

import { buildGuidedSetupOverview, type GuidedSetupOverviewInputs } from './guided-setup-overview'
import type { SetupFlowActionDescriptor, SetupFlowSectionDescriptor } from '../app-types'

function section(overrides: Partial<SetupFlowSectionDescriptor> = {}): SetupFlowSectionDescriptor {
  return {
    id: 'airframe',
    title: 'Airframe',
    status: 'attention',
    sequenceState: 'current',
    summary: '',
    detail: '',
    evidence: [],
    criteria: [],
    criteriaMetCount: 0,
    panelId: 'setup-panel-guided',
    panelLabel: 'Guided',
    actions: [],
    ...overrides
  }
}

function action(overrides: Partial<SetupFlowActionDescriptor> = {}): SetupFlowActionDescriptor {
  return {
    kind: 'confirm-step',
    label: 'Confirm',
    ...overrides
  }
}

function baseInputs(overrides: Partial<GuidedSetupOverviewInputs> = {}): GuidedSetupOverviewInputs {
  return {
    setupFlowSections: [],
    selectedSetupSectionId: undefined,
    guidedSetupTestingShortcutActive: false,
    orientationExerciseStatus: 'idle',
    motorVerificationStatus: 'idle',
    ...overrides
  }
}

describe('buildGuidedSetupOverview', () => {
  it('recommends the current section, else the first incomplete, else the first', () => {
    const a = section({ id: 'a', status: 'complete', sequenceState: 'complete' })
    const b = section({ id: 'b', status: 'attention', sequenceState: 'locked' })
    const c = section({ id: 'c', status: 'attention', sequenceState: 'current' })
    expect(buildGuidedSetupOverview(baseInputs({ setupFlowSections: [a, b, c] })).recommendedSetupSection?.id).toBe('c')

    // No 'current' section -> first not-complete.
    const noCurrent = [a, b]
    expect(buildGuidedSetupOverview(baseInputs({ setupFlowSections: noCurrent })).recommendedSetupSection?.id).toBe('b')

    // All complete -> first section.
    const allComplete = [a, section({ id: 'd', status: 'complete', sequenceState: 'complete' })]
    expect(buildGuidedSetupOverview(baseInputs({ setupFlowSections: allComplete })).recommendedSetupSection?.id).toBe('a')
  })

  it('falls back to the recommended section when the selected candidate is locked and no testing shortcut', () => {
    const current = section({ id: 'current', sequenceState: 'current' })
    const locked = section({ id: 'locked', sequenceState: 'locked' })
    const sections = [current, locked]

    const guarded = buildGuidedSetupOverview(baseInputs({ setupFlowSections: sections, selectedSetupSectionId: 'locked' }))
    expect(guarded.selectedSetupSectionCandidate?.id).toBe('locked')
    expect(guarded.selectedSetupSection?.id).toBe('current')

    // The testing shortcut unlocks selection of a locked section.
    const shortcut = buildGuidedSetupOverview(
      baseInputs({ setupFlowSections: sections, selectedSetupSectionId: 'locked', guidedSetupTestingShortcutActive: true })
    )
    expect(shortcut.selectedSetupSection?.id).toBe('locked')
  })

  it('derives index, neighbours, completion count, progress, and the complete flag', () => {
    const sections = [
      section({ id: 's0', status: 'complete', sequenceState: 'complete' }),
      section({ id: 's1', status: 'complete', sequenceState: 'complete' }),
      section({ id: 's2', status: 'attention', sequenceState: 'current' }),
      section({ id: 's3', status: 'attention', sequenceState: 'locked' })
    ]
    const result = buildGuidedSetupOverview(baseInputs({ setupFlowSections: sections, selectedSetupSectionId: 's2' }))
    expect(result.selectedSetupSectionIndex).toBe(2)
    expect(result.previousSetupSection?.id).toBe('s1')
    expect(result.nextSetupSection?.id).toBe('s3')
    expect(result.completedSetupSectionCount).toBe(2)
    expect(result.setupFlowProgress).toBe(50)
    expect(result.guidedSetupComplete).toBe(false)

    const empty = buildGuidedSetupOverview(baseInputs())
    expect(empty.setupFlowProgress).toBe(0)
    expect(empty.guidedSetupComplete).toBe(false)
    expect(empty.selectedSetupSectionIndex).toBe(-1)

    const done = buildGuidedSetupOverview(
      baseInputs({ setupFlowSections: [section({ status: 'complete', sequenceState: 'complete' })] })
    )
    expect(done.guidedSetupComplete).toBe(true)
    expect(done.setupFlowProgress).toBe(100)
  })

  it('there is no next section past the last and no previous before the first', () => {
    const sections = [section({ id: 'a', sequenceState: 'current' }), section({ id: 'b', sequenceState: 'locked' })]
    const first = buildGuidedSetupOverview(baseInputs({ setupFlowSections: sections, selectedSetupSectionId: 'a' }))
    expect(first.previousSetupSection).toBeUndefined()
    const last = buildGuidedSetupOverview(
      baseInputs({ setupFlowSections: sections, selectedSetupSectionId: 'b', guidedSetupTestingShortcutActive: true })
    )
    expect(last.nextSetupSection).toBeUndefined()
  })

  it('tallies outcome counts, the exception flag, and the human summary', () => {
    const sections = [
      section({ id: 'a', confirmationOutcome: 'not-applicable' }),
      section({ id: 'b', confirmationOutcome: 'already-done' }),
      section({ id: 'c', confirmationOutcome: 'deferred' }),
      section({ id: 'd', confirmationOutcome: 'complete' })
    ]
    const result = buildGuidedSetupOverview(baseInputs({ setupFlowSections: sections }))
    expect(result.setupOutcomeCounts).toEqual({ notApplicable: 1, alreadyDone: 1, deferred: 1 })
    expect(result.guidedSetupHasExceptions).toBe(true)
    expect(result.guidedSetupOutcomeSummary).toBe('1 not applicable • 1 already done • 1 deferred')

    const clean = buildGuidedSetupOverview(baseInputs({ setupFlowSections: [section({ confirmationOutcome: 'complete' })] }))
    expect(clean.guidedSetupHasExceptions).toBe(false)
    expect(clean.guidedSetupOutcomeSummary).toBe('')
  })

  it('detects the guided task action and whether it is still required by exercise status', () => {
    const orientationSection = section({
      id: 'airframe',
      sequenceState: 'current',
      actions: [action({ kind: 'orientation-exercise', label: 'Run orientation', tone: 'primary' })]
    })
    const sections = [orientationSection]

    const idle = buildGuidedSetupOverview(baseInputs({ setupFlowSections: sections, selectedSetupSectionId: 'airframe' }))
    expect(idle.guidedSetupTaskAction?.kind).toBe('orientation-exercise')
    expect(idle.guidedSetupTaskStillRequired).toBe(true)

    const passed = buildGuidedSetupOverview(
      baseInputs({ setupFlowSections: sections, selectedSetupSectionId: 'airframe', orientationExerciseStatus: 'passed' })
    )
    expect(passed.guidedSetupTaskStillRequired).toBe(false)

    const motorSection = section({
      id: 'outputs',
      sequenceState: 'current',
      actions: [action({ kind: 'motor-verification-start', label: 'Verify motors', tone: 'primary' })]
    })
    const motorPassed = buildGuidedSetupOverview(
      baseInputs({ setupFlowSections: [motorSection], selectedSetupSectionId: 'outputs', motorVerificationStatus: 'passed' })
    )
    expect(motorPassed.guidedSetupTaskStillRequired).toBe(false)
    const motorIdle = buildGuidedSetupOverview(baseInputs({ setupFlowSections: [motorSection], selectedSetupSectionId: 'outputs' }))
    expect(motorIdle.guidedSetupTaskStillRequired).toBe(true)
  })

  it('targets the continue button only when the section is complete and a next section exists', () => {
    const sections = [
      section({ id: 'a', status: 'complete', sequenceState: 'complete' }),
      section({ id: 'b', status: 'attention', sequenceState: 'current' })
    ]
    const onComplete = buildGuidedSetupOverview(
      baseInputs({ setupFlowSections: sections, selectedSetupSectionId: 'a', guidedSetupTestingShortcutActive: true })
    )
    expect(onComplete.continueButtonTargeted).toBe(true)
    // continue targeted -> no primary action surfaced
    expect(onComplete.guidedSetupPrimaryAction).toBeUndefined()

    const onLast = buildGuidedSetupOverview(
      baseInputs({
        setupFlowSections: [section({ id: 'only', status: 'complete', sequenceState: 'complete' })],
        selectedSetupSectionId: 'only',
        guidedSetupTestingShortcutActive: true
      })
    )
    expect(onLast.continueButtonTargeted).toBe(false)
  })

  it('splits actions into the required task, primary, context, and support buckets', () => {
    const task = action({ kind: 'orientation-exercise', label: 'Run orientation', tone: 'primary' })
    const primary = action({ kind: 'guided', label: 'Open guided', tone: 'primary' })
    const context = action({ kind: 'scroll', label: 'Open page', panelId: 'setup-panel-board' })
    const guidedScroll = action({ kind: 'scroll', label: 'Scroll guided', panelId: 'setup-panel-guided' })
    const support = action({ kind: 'confirm-step', label: 'Confirm step', tone: 'secondary' })
    const sections = [
      section({ id: 'airframe', sequenceState: 'current', actions: [task, primary, context, guidedScroll, support] })
    ]

    // Orientation idle -> task is still required and becomes the primary action.
    const result = buildGuidedSetupOverview(baseInputs({ setupFlowSections: sections, selectedSetupSectionId: 'airframe' }))
    expect(result.guidedSetupTaskAction).toBe(task)
    expect(result.guidedSetupPrimaryAction).toBe(task)
    expect(result.guidedSetupContextAction).toBe(context)
    // support = everything that is not the task, primary, context, or the guided-panel scroll
    expect(result.guidedSetupSupportActions).toEqual([primary, support])
  })

  it('surfaces the airframe and outputs context hints, undefined elsewhere', () => {
    const airframe = buildGuidedSetupOverview(
      baseInputs({ setupFlowSections: [section({ id: 'airframe', sequenceState: 'current' })], selectedSetupSectionId: 'airframe' })
    )
    expect(airframe.guidedSetupContextHint).toContain('board-orientation page')

    const outputs = buildGuidedSetupOverview(
      baseInputs({ setupFlowSections: [section({ id: 'outputs', sequenceState: 'current' })], selectedSetupSectionId: 'outputs' })
    )
    expect(outputs.guidedSetupContextHint).toContain('motor-verification bench')

    const other = buildGuidedSetupOverview(
      baseInputs({ setupFlowSections: [section({ id: 'battery', sequenceState: 'current' })], selectedSetupSectionId: 'battery' })
    )
    expect(other.guidedSetupContextHint).toBeUndefined()
  })
})
