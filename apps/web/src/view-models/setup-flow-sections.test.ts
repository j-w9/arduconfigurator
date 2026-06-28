import type { ConfiguratorSnapshot } from '@arduconfig/ardupilot-core'
import { describe, expect, it } from 'vitest'

import { buildSetupFlowSections, type SetupFlowSectionsInputs } from './setup-flow-sections'

type SectionMeta = { id: string; title: string; description?: string; notes?: string[] }

function snapshot(sections: SectionMeta[], over: Record<string, unknown> = {}): ConfiguratorSnapshot {
  return {
    setupSections: sections.map((section) => ({ description: '', notes: [], ...section })),
    connection: { kind: 'connected' },
    vehicle: { vehicle: 'ArduCopter' },
    parameterStats: { status: 'complete', downloaded: 100, total: 100 },
    guidedActions: { 'request-parameters': { status: 'idle' } },
    motorTest: { status: 'idle' },
    ...over
  } as unknown as ConfiguratorSnapshot
}

// Full input baseline. Only `snapshot` + the follow-up/confirmation fields are
// exercised here — the per-section switch cases for esc/compass/rc/etc. don't
// run when the section list is just `link` + an unknown id (which lands in the
// default branch with no criteria), so the rest is stubbed to satisfy the type.
function inputs(sections: SectionMeta[], over: Partial<SetupFlowSectionsInputs> = {}): SetupFlowSectionsInputs {
  const idle = { status: 'idle' }
  const stub = <T>() => ({}) as unknown as T
  return {
    snapshot: snapshot(sections),
    airframe: stub(),
    outputMapping: { motorOutputs: [], configuredAuxOutputs: [], notes: [] } as unknown as SetupFlowSectionsInputs['outputMapping'],
    configuredOutputs: [] as unknown as SetupFlowSectionsInputs['configuredOutputs'],
    escSetup: stub(),
    compassSetupAvailability: stub(),
    isCopterVehicle: true,
    modeSwitchExercise: idle as unknown as SetupFlowSectionsInputs['modeSwitchExercise'],
    modeSwitchEstimate: stub(),
    modeExerciseAssignments: [],
    motorVerification: idle as unknown as SetupFlowSectionsInputs['motorVerification'],
    orientationExercise: idle as unknown as SetupFlowSectionsInputs['orientationExercise'],
    rcCalibrationSession: idle as unknown as SetupFlowSectionsInputs['rcCalibrationSession'],
    rcMappingSession: { status: 'idle', captures: {} } as unknown as SetupFlowSectionsInputs['rcMappingSession'],
    rcRangeExercise: idle as unknown as SetupFlowSectionsInputs['rcRangeExercise'],
    parameterFollowUp: undefined,
    setupFlowFollowUp: undefined,
    setupConfirmations: {},
    setupConfirmationSignatures: {},
    batteryFailsafe: 0,
    batteryMonitor: 0,
    boardOrientation: 0,
    busyAction: undefined,
    throttleFailsafe: 0,
    canRunGuidedMotorTest: false,
    canRunModeSwitchExercise: false,
    canRunMotorVerification: false,
    canRunOrientationExercise: false,
    canRunRcMappingExercise: false,
    canRunRcRangeExercise: false,
    currentMotorTestSucceeded: false,
    currentMotorVerificationLabel: undefined,
    modeSwitchExerciseSummary: '',
    rcCalibrationSummary: '',
    rcMappingSummary: '',
    rcRangeExerciseSummary: '',
    ...over
  }
}

const bySequence = (sections: ReturnType<typeof buildSetupFlowSections>) =>
  Object.fromEntries(sections.map((section) => [section.id, section.sequenceState]))

describe('buildSetupFlowSections', () => {
  it('emits one descriptor per setup section, preserving id', () => {
    const sections = buildSetupFlowSections(inputs([{ id: 'link', title: 'Link' }, { id: 'alpha', title: 'Alpha' }, { id: 'beta', title: 'Beta' }]))
    expect(sections.map((section) => section.id)).toEqual(['link', 'alpha', 'beta'])
  })

  it('marks a fully-satisfied link section complete and the next incomplete one current', () => {
    const sections = buildSetupFlowSections(inputs([{ id: 'link', title: 'Link' }, { id: 'mystery', title: 'Mystery' }]))
    expect(bySequence(sections)).toEqual({ link: 'complete', mystery: 'current' })
  })

  it('locks sections after the first incomplete one, naming the blocker', () => {
    // Link is incomplete (disconnected) so it becomes current; the next is locked.
    const sections = buildSetupFlowSections(
      inputs([{ id: 'link', title: 'Link' }, { id: 'mystery', title: 'Mystery' }], {
        snapshot: snapshot([{ id: 'link', title: 'Link' }, { id: 'mystery', title: 'Mystery' }], { connection: { kind: 'disconnected' } })
      })
    )
    expect(bySequence(sections)).toEqual({ link: 'current', mystery: 'locked' })
    const locked = sections.find((section) => section.id === 'mystery')
    expect(locked?.blockingReason).toBe('Complete Link before moving on to Mystery.')
  })

  it('derives the link criteria from connection / param-sync / follow-up state', () => {
    const [link] = buildSetupFlowSections(inputs([{ id: 'link', title: 'Link' }]))
    expect(link.criteria.map((criterion) => criterion.met)).toEqual([true, true, true])

    const [pending] = buildSetupFlowSections(
      inputs([{ id: 'link', title: 'Link' }], {
        snapshot: snapshot([{ id: 'link', title: 'Link' }], { parameterStats: { status: 'syncing', downloaded: 10, total: 100 } }),
        parameterFollowUp: { refreshRequired: true, requiresReboot: false, changedCount: 1, text: 'refresh' }
      })
    )
    // heartbeat ok, sync incomplete, follow-up pending
    expect(pending.criteria.map((criterion) => criterion.met)).toEqual([true, false, false])
  })
})

describe('outputs section (Motors-tab redesign alignment)', () => {
  const buildOutputs = (over: Partial<SetupFlowSectionsInputs> = {}) => {
    const sections = buildSetupFlowSections(
      inputs([{ id: 'link', title: 'Link' }, { id: 'outputs', title: 'Outputs' }], { isCopterVehicle: true, ...over })
    )
    const outputs = sections.find((section) => section.id === 'outputs')
    if (!outputs) {
      throw new Error('missing outputs section')
    }
    return outputs
  }

  it('drops the retired guided-verification + ESC-range gates from the criteria', () => {
    const labels = buildOutputs().criteria.map((criterion) => criterion.label)
    expect(labels.some((label) => /direction verification/i.test(label))).toBe(false)
    expect(labels.some((label) => /range review|ESC calibration/i.test(label))).toBe(false)
  })

  it('offers the output-review confirm + an Open Motors jump, not the removed guided actions', () => {
    const actions = buildOutputs().actions
    const kinds = actions.map((action) => action.kind)
    expect(kinds).not.toContain('motor-verification-start')
    expect(kinds).not.toContain('motor-test-current')
    expect(kinds).not.toContain('motor-verification-confirm')
    expect(actions.some((action) => 'sectionId' in action && action.sectionId === 'esc-range')).toBe(false)
    expect(actions.some((action) => 'sectionId' in action && action.sectionId === 'outputs')).toBe(true)
    expect(actions.some((action) => 'label' in action && action.label === 'Open Motors')).toBe(true)
  })
})

describe('radio section RCIN preflight', () => {
  const RADIO = [{ id: 'radio', title: 'Radio' }]

  function radioInputs(over: {
    rcVerified: boolean
    parameters?: { id: string; value: number }[]
  }) {
    return inputs(RADIO, {
      snapshot: snapshot(RADIO, {
        parameters: over.parameters ?? [],
        liveVerification: { rcInput: { verified: over.rcVerified, channelCount: over.rcVerified ? 8 : 0 } }
      })
    })
  }

  const portsAction = (sections: ReturnType<typeof buildSetupFlowSections>) =>
    sections[0].actions.find((action) => action.panelId === 'setup-panel-ports')

  it('points at Ports when RC telemetry is missing and no UART is set to RCIN', () => {
    const sections = buildSetupFlowSections(radioInputs({ rcVerified: false }))
    const action = portsAction(sections)
    expect(action?.label).toBe('Open Ports — Assign RCIN')
    expect(sections[0].detail).toContain('SERIALn_PROTOCOL = 23')
    expect(sections[0].evidence[0]).toContain('No serial port set to RC input')
  })

  it('does not point at Ports when a UART is already assigned to RCIN', () => {
    const sections = buildSetupFlowSections(
      radioInputs({ rcVerified: false, parameters: [{ id: 'SERIAL1_PROTOCOL', value: 23 }] })
    )
    expect(portsAction(sections)).toBeUndefined()
  })

  it('does not point at Ports once live RC telemetry is present', () => {
    const sections = buildSetupFlowSections(radioInputs({ rcVerified: true }))
    expect(portsAction(sections)).toBeUndefined()
  })
})
