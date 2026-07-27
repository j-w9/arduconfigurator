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
    rcDirectionResults: { roll: 'idle', pitch: 'idle', throttle: 'idle', yaw: 'idle' },
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

describe('airframe frame-param sync guard', () => {
  const AIRFRAME = [{ id: 'airframe', title: 'Airframe' }]
  const airframeStub = (over: Record<string, unknown> = {}) =>
    ({
      frameClassValue: 1,
      frameClassLabel: 'Quad',
      frameTypeValue: 1,
      frameTypeLabel: 'X',
      expectedMotorCount: 4,
      frameTypeIgnored: false,
      ...over
    }) as unknown as SetupFlowSectionsInputs['airframe']

  const buildAirframe = (over: { airframe?: Record<string, unknown>; downloaded?: number; total?: number } = {}) => {
    const sections = buildSetupFlowSections(
      inputs(AIRFRAME, {
        snapshot: snapshot(AIRFRAME, {
          liveVerification: { attitudeTelemetry: { verified: true } },
          parameterStats: { status: 'complete', downloaded: over.downloaded ?? 1319, total: over.total ?? 1328 }
        }),
        airframe: airframeStub(over.airframe),
        orientationExercise: { status: 'passed' } as unknown as SetupFlowSectionsInputs['orientationExercise'],
        outputMapping: { motorOutputs: [1, 2, 3, 4], configuredAuxOutputs: [], notes: [] } as unknown as SetupFlowSectionsInputs['outputMapping']
      })
    )
    const airframe = sections.find((section) => section.id === 'airframe')
    if (!airframe) {
      throw new Error('missing airframe section')
    }
    return airframe
  }

  it('explains a dropped FRAME_TYPE and offers a re-sync instead of a silently dead confirm', () => {
    const airframe = buildAirframe({ airframe: { frameTypeValue: undefined } })
    expect(airframe.blockingReason).toMatch(/FRAME_TYPE/)
    expect(airframe.blockingReason).toMatch(/1319\/1328/)
    // The confirm is (correctly) disabled, but now there is a re-sync path.
    const confirm = airframe.actions.find((action) => 'label' in action && action.label === 'Confirm Airframe Review')
    expect(confirm && 'disabled' in confirm ? confirm.disabled : undefined).toBe(true)
    expect(airframe.actions.some((action) => 'actionId' in action && action.actionId === 'request-parameters')).toBe(true)
  })

  it('names FRAME_CLASS when that is the dropped param', () => {
    const airframe = buildAirframe({ airframe: { frameClassValue: undefined } })
    expect(airframe.blockingReason).toMatch(/FRAME_CLASS/)
  })

  it('adds no guard or re-sync action once both frame params are present', () => {
    const airframe = buildAirframe()
    expect(airframe.blockingReason).toBeUndefined()
    expect(airframe.actions.some((action) => 'actionId' in action && action.actionId === 'request-parameters')).toBe(false)
    const confirm = airframe.actions.find((action) => 'label' in action && action.label === 'Confirm Airframe Review')
    expect(confirm && 'disabled' in confirm ? confirm.disabled : undefined).toBe(false)
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

  it('gates the radio step on channel directions — unmet until every axis reads correct', () => {
    const directionMet = (rcDirectionResults: SetupFlowSectionsInputs['rcDirectionResults']) => {
      const sections = buildSetupFlowSections(
        inputs(RADIO, {
          rcDirectionResults,
          snapshot: snapshot(RADIO, { liveVerification: { rcInput: { verified: true, channelCount: 8 } } })
        })
      )
      return sections[0].criteria.find((criterion) => criterion.label.includes('directions verified'))?.met
    }
    // Any axis reading backwards blocks the gate.
    expect(directionMet({ roll: 'correct', pitch: 'reversed', throttle: 'correct', yaw: 'correct' })).toBe(false)
    // An unchecked (idle) axis also blocks — every axis must be verified.
    expect(directionMet({ roll: 'correct', pitch: 'idle', throttle: 'correct', yaw: 'correct' })).toBe(false)
    // All four correct → the gate is satisfied.
    expect(directionMet({ roll: 'correct', pitch: 'correct', throttle: 'correct', yaw: 'correct' })).toBe(true)
  })
})

// The physical exercises (orientation tilt, RC stick sweeps, mode-switch walk)
// cannot always be performed: a bench FC, an airframe too large to tilt, a
// replay/demo feed with a fixed attitude. Each of those steps gates the WHOLE
// wizard — an unmet criterion leaves every later step sequenceState 'locked'
// with its rail button disabled — so each carries an operator waiver recorded
// as an 'already-done' confirmation, mirroring the calibration steps.
describe('exercise waivers unblock the sequential flow', () => {
  const waived = (sectionId: string) => ({
    setupConfirmations: { [sectionId]: { signature: 'sig', confirmedAtMs: 1, outcome: 'already-done' as const } },
    setupConfirmationSignatures: { [sectionId]: 'sig' }
  })

  const airframeStub = () =>
    ({
      frameClassValue: 1,
      frameClassLabel: 'Quad',
      frameTypeValue: 1,
      frameTypeLabel: 'X',
      expectedMotorCount: 4,
      frameTypeIgnored: false
    }) as unknown as SetupFlowSectionsInputs['airframe']

  const AIRFRAME = [{ id: 'airframe', title: 'Airframe' }]
  const buildAirframe = (over: Partial<SetupFlowSectionsInputs> = {}) =>
    buildSetupFlowSections(
      inputs(AIRFRAME, {
        snapshot: snapshot(AIRFRAME, { liveVerification: { attitudeTelemetry: { verified: true } } }),
        airframe: airframeStub(),
        ...over
      })
    )[0]

  it('airframe: a level-only attitude feed leaves the step incomplete without a waiver', () => {
    const airframe = buildAirframe()
    expect(airframe.status).not.toBe('complete')
    expect(airframe.criteria.find((criterion) => /Orientation exercise/.test(criterion.label))?.met).toBe(false)
  })

  it('airframe: offers the orientation waiver while the exercise has not passed', () => {
    const waiver = buildAirframe().actions.find(
      (action) => 'label' in action && action.label === 'Orientation Verified Elsewhere — Continue'
    )
    expect(waiver?.confirmationOutcome).toBe('already-done')
  })

  it('airframe: the waiver completes the step so later steps can unlock', () => {
    const airframe = buildAirframe(waived('airframe'))
    expect(airframe.status).toBe('complete')
    expect(airframe.confirmationOutcome).toBe('already-done')
  })

  it('airframe: the waiver also covers the live-attitude criterion it depends on', () => {
    const airframe = buildSetupFlowSections(
      inputs(AIRFRAME, {
        snapshot: snapshot(AIRFRAME, { liveVerification: { attitudeTelemetry: { verified: false } } }),
        airframe: airframeStub(),
        ...waived('airframe')
      })
    )[0]
    expect(airframe.status).toBe('complete')
  })

  it('airframe: withholds the confirm while FRAME_CLASS is present-but-unset (0)', () => {
    // The completion criterion requires FRAME_CLASS != 0, so a confirm enabled
    // at 0 ticked nothing and explained nothing.
    const airframe = buildSetupFlowSections(
      inputs(AIRFRAME, {
        snapshot: snapshot(AIRFRAME, { liveVerification: { attitudeTelemetry: { verified: true } } }),
        airframe: { ...airframeStub(), frameClassValue: 0 } as unknown as SetupFlowSectionsInputs['airframe']
      })
    )[0]
    const confirm = airframe.actions.find((action) => 'label' in action && action.label === 'Confirm Airframe Review')
    expect(confirm && 'disabled' in confirm ? confirm.disabled : undefined).toBe(true)
    const waiver = airframe.actions.find(
      (action) => 'label' in action && action.label === 'Orientation Verified Elsewhere — Continue'
    )
    expect(waiver && 'disabled' in waiver ? waiver.disabled : undefined).toBe(true)
  })

  const RADIO = [{ id: 'radio', title: 'Radio' }]
  it('radio: the waiver satisfies mapping, range, endpoints and directions at once', () => {
    const radio = buildSetupFlowSections(
      inputs(RADIO, {
        snapshot: snapshot(RADIO, { liveVerification: { rcInput: { verified: true, channelCount: 8 } } }),
        ...waived('radio')
      })
    )[0]
    expect(radio.status).toBe('complete')
    expect(radio.criteria.every((criterion) => criterion.met)).toBe(true)
  })

  it('radio: offers the waiver only while the directions are unverified', () => {
    const label = 'Radio Verified Elsewhere — Continue'
    const unverified = buildSetupFlowSections(
      inputs(RADIO, { snapshot: snapshot(RADIO, { liveVerification: { rcInput: { verified: true, channelCount: 8 } } }) })
    )[0]
    expect(unverified.actions.some((action) => 'label' in action && action.label === label)).toBe(true)

    const verified = buildSetupFlowSections(
      inputs(RADIO, {
        rcDirectionResults: { roll: 'correct', pitch: 'correct', throttle: 'correct', yaw: 'correct' },
        snapshot: snapshot(RADIO, { liveVerification: { rcInput: { verified: true, channelCount: 8 } } })
      })
    )[0]
    expect(verified.actions.some((action) => 'label' in action && action.label === label)).toBe(false)
  })

  const MODES = [{ id: 'modes', title: 'Flight Modes' }]
  it('modes: gains a waiver where it previously had no operator escape at all', () => {
    const modes = buildSetupFlowSections(inputs(MODES))[0]
    expect(modes.status).not.toBe('complete')
    const waiver = modes.actions.find(
      (action) => 'label' in action && action.label === 'Flight Modes Verified Elsewhere — Continue'
    )
    expect(waiver?.confirmationOutcome).toBe('already-done')

    const escaped = buildSetupFlowSections(inputs(MODES, waived('modes')))[0]
    expect(escaped.status).toBe('complete')
  })
})

describe('locked-step blocking reason', () => {
  it('keeps naming the blocking step even when a follow-up is pending', () => {
    // A pending follow-up used to REPLACE the sequence reason outright, so a
    // locked step reported e.g. "Reboot required" and never said which step
    // was actually holding the flow.
    const sections = buildSetupFlowSections(
      inputs([{ id: 'link', title: 'Link' }, { id: 'mystery', title: 'Mystery' }], {
        snapshot: snapshot([{ id: 'link', title: 'Link' }, { id: 'mystery', title: 'Mystery' }], {
          connection: { kind: 'disconnected' }
        }),
        setupFlowFollowUp: { title: 'Reboot required', tone: 'warning', text: '', actions: [] }
      })
    )
    const locked = sections.find((section) => section.id === 'mystery')
    expect(locked?.blockingReason).toContain('Complete Link before moving on to Mystery.')
    expect(locked?.blockingReason).toContain('Reboot required')
  })
})
