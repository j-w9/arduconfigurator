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

    rtlAltitudeMetres: undefined,
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
    expect(locked?.blockingReason).toBe('Finish Link before Mystery.')
  })

  it('derives the link criteria from connection / param-sync / follow-up state', () => {
    const [link] = buildSetupFlowSections(inputs([{ id: 'link', title: 'Link' }]))
    expect(link.criteria.map((criterion) => criterion.met)).toEqual([true, true])

    const [pending] = buildSetupFlowSections(
      inputs([{ id: 'link', title: 'Link' }], {
        snapshot: snapshot([{ id: 'link', title: 'Link' }], { parameterStats: { status: 'syncing', downloaded: 10, total: 100 } }),
        parameterFollowUp: { refreshRequired: true, requiresReboot: false, changedCount: 1, text: 'refresh' }
      })
    )
    // heartbeat ok, sync incomplete, and the follow-up gate rides on the
    // current step as its own criterion
    expect(pending.criteria.map((criterion) => criterion.met)).toEqual([true, false, false])
    expect(pending.criteria[2].label).toBe('Parameters re-synced after the last change')
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
      return sections[0].criteria.find((criterion) => criterion.label.includes('Stick directions'))?.met
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
    expect(airframe.criteria.find((criterion) => /Orientation check/.test(criterion.label))?.met).toBe(false)
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
    expect(locked?.blockingReason).toContain('Finish Link before Mystery.')
    expect(locked?.blockingReason).toContain('Reboot required')
  })
})

// 2026-10-24 wizard audit: the silent deadlocks and partial waivers the
// walk-through found. Each of these FAILED before its fix.
describe('wizard audit 2026-10 — link / airframe / outputs / calibration steps', () => {
  const record = (outcome: 'complete' | 'already-done') => ({
    setupConfirmations: { airframe: { signature: undefined, confirmedAtMs: 1, outcome } },
    setupConfirmationSignatures: {}
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
  const label = (action: { label?: string }) => action.label
  const isDisabled = (action: unknown) => (action as { disabled?: boolean }).disabled === true

  it('link: a reboot-required follow-up puts the reboot on the step, ahead of the re-sync', () => {
    const LINK = [{ id: 'link', title: 'Link' }]
    const [link] = buildSetupFlowSections(
      inputs(LINK, {
        snapshot: snapshot(LINK, { guidedActions: { 'request-parameters': { status: 'idle' }, 'reboot-autopilot': { status: 'idle' } } }),
        parameterFollowUp: { refreshRequired: true, requiresReboot: true, changedCount: 1, text: 'Reboot the flight controller.' }
      })
    )
    const guided = link.actions.filter((action) => action.kind === 'guided') as Array<{ actionId: string; tone?: string }>
    expect(guided.map((action) => action.actionId)).toEqual(['reboot-autopilot', 'request-parameters'])
    expect(guided[0].tone).toBe('primary')
  })

  it('airframe: a plain review confirmation does not take the orientation waiver away', () => {
    const AIRFRAME = [{ id: 'airframe', title: 'Airframe' }]
    const [airframe] = buildSetupFlowSections(
      inputs(AIRFRAME, {
        snapshot: snapshot(AIRFRAME, { liveVerification: { attitudeTelemetry: { verified: false } } }),
        airframe: airframeStub(),
        ...record('complete')
      })
    )
    expect(airframe.status).not.toBe('complete')
    const waiver = airframe.actions.find((action) => label(action) === 'Orientation Verified Elsewhere — Continue')
    expect(waiver?.kind).toBe('confirm-step')
    expect(isDisabled(waiver)).toBe(false)
  })

  it('outputs: never shows the retired motor-verification jump; ESC calibration moved to Motor Range', () => {
    const OUTPUTS = [{ id: 'outputs', title: 'Outputs' }]
    const [outputs] = buildSetupFlowSections(
      inputs(OUTPUTS, {
        escSetup: { calibrationPath: 'analog-calibration' } as unknown as SetupFlowSectionsInputs['escSetup'],
        airframe: airframeStub(),
        outputMapping: { motorOutputs: [1, 2, 3, 4], configuredAuxOutputs: [], notes: [] } as unknown as SetupFlowSectionsInputs['outputMapping']
      })
    )
    const labels = outputs.actions.map(label)
    expect(labels).toContain('Open Motors')
    expect(labels).not.toContain('Open Motor Verification')
    expect(labels).not.toContain('Open ESC Calibration')
  })

  it('outputs: Plane/Rover/Sub are sent to Servos, not to the Copter motor matrix', () => {
    const OUTPUTS = [{ id: 'outputs', title: 'Outputs' }]
    const [outputs] = buildSetupFlowSections(
      inputs(OUTPUTS, {
        isCopterVehicle: false,
        snapshot: snapshot(OUTPUTS, { vehicle: { vehicle: 'ArduPlane' } }),
        airframe: { frameClassLabel: 'Fixed-wing' } as unknown as SetupFlowSectionsInputs['airframe']
      })
    )
    const open = outputs.actions.find((action) => action.kind === 'scroll') as { label: string; panelId: string }
    expect(open.label).toBe('Open Servos')
    expect(open.panelId).toBe('setup-panel-servos')
  })

  const accelParams = (offsetZ: number) =>
    (
      [
        ['INS_ACC_ID', 1],
        ['INS_ACCOFFS_X', 0],
        ['INS_ACCOFFS_Y', 0],
        ['INS_ACCOFFS_Z', offsetZ],
        ['INS_ACCSCAL_X', 1],
        ['INS_ACCSCAL_Y', 1],
        ['INS_ACCSCAL_Z', 1],
        ['INS_ACC2_ID', 0],
        ['INS_ACC3_ID', 0]
      ] as Array<[string, number]>
    ).map(([id, value]) => ({ id, value }))

  it('accelerometer: the waiver is withheld while the vehicle itself reports zero offsets', () => {
    const ACCEL = [{ id: 'accelerometer', title: 'Accelerometer' }]
    const build = (offsetZ: number) =>
      buildSetupFlowSections(
        inputs(ACCEL, {
          snapshot: snapshot(ACCEL, {
            parameters: accelParams(offsetZ),
            guidedActions: { 'calibrate-accelerometer': { status: 'idle', summary: '', instructions: [], statusTexts: [] } }
          })
        })
      )[0]
    const notCalibrated = build(0).actions.find((action) => label(action) === 'Already Calibrated — Continue')
    expect(isDisabled(notCalibrated)).toBe(true)
    const calibrated = build(0.12).actions.find((action) => label(action) === 'Already Calibrated — Continue')
    expect(isDisabled(calibrated)).toBe(false)
  })

  it('level: stored AHRS_TRIM counts as the record after the reboot resets the action, and Clear is never greyed out', () => {
    const LEVEL = [{ id: 'level', title: 'Level', status: 'complete' }]
    const base = {
      snapshot: snapshot(LEVEL, {
        guidedActions: { 'calibrate-level': { status: 'idle', summary: '', instructions: [], statusTexts: [] } }
      })
    }
    const [level] = buildSetupFlowSections(inputs(LEVEL, base))
    expect(level.status).toBe('complete')
    const [confirmed] = buildSetupFlowSections(
      inputs(LEVEL, {
        ...base,
        setupConfirmations: { level: { signature: undefined, confirmedAtMs: 1, outcome: 'complete' } }
      })
    )
    const clear = confirmed.actions.find((action) => action.kind === 'clear-confirmation')
    expect(clear).toBeDefined()
    expect(isDisabled(clear)).toBe(false)
  })

  it('compass: no position criterion, and stored offsets count as the record', () => {
    const COMPASS = [{ id: 'compass', title: 'Compass', status: 'complete' }]
    const [compass] = buildSetupFlowSections(
      inputs(COMPASS, {
        compassSetupAvailability: { enabledCompassCount: 1, gpsConfigured: false, canSkipCalibration: false } as unknown as SetupFlowSectionsInputs['compassSetupAvailability'],
        snapshot: snapshot(COMPASS, {
          liveVerification: { globalPosition: { verified: false } },
          parameters: [{ id: 'COMPASS_USE', value: 1 }, { id: 'COMPASS_DEV_ID', value: 97539 }],
          guidedActions: { 'calibrate-compass': { status: 'idle', summary: '', instructions: [], statusTexts: [] } }
        })
      })
    )
    expect(compass.criteria.map((criterion) => criterion.label).join(' ')).not.toMatch(/position/i)
    expect(compass.status).toBe('complete')
  })
})

describe('wizard audit 2026-10 — sequence lock, radio, failsafe and power', () => {
  const label = (action: { label?: string }) => action.label
  const isDisabled = (action: unknown) => (action as { disabled?: boolean }).disabled === true
  const confirmed = (sectionId: string, outcome: 'complete' | 'already-done' | 'not-applicable') => ({
    setupConfirmations: { [sectionId]: { signature: undefined, confirmedAtMs: 1, outcome } },
    setupConfirmationSignatures: {}
  })
  const rcLive = { rcInput: { verified: true, channelCount: 8 } }
  const idleAction = { status: 'idle', summary: '', instructions: [], statusTexts: [] }

  it('lock pass: a satisfied step past the current one reads complete, and the flow stays on the current step', () => {
    // Compass already calibrated on the vehicle (COMPASS_OFS stored) while an
    // earlier step is still current: Compass is a fact, Alpha is the work.
    const SECTIONS = [
      { id: 'link', title: 'Link' },
      { id: 'alpha', title: 'Alpha' },
      { id: 'compass', title: 'Compass', status: 'complete' }
    ]
    const sections = buildSetupFlowSections(
      inputs(SECTIONS, {
        compassSetupAvailability: { enabledCompassCount: 1, gpsConfigured: false, canSkipCalibration: false } as unknown as SetupFlowSectionsInputs['compassSetupAvailability'],
        snapshot: snapshot(SECTIONS, {
          liveVerification: { globalPosition: { verified: false } },
          parameters: [{ id: 'COMPASS_USE', value: 1 }, { id: 'COMPASS_DEV_ID', value: 97539 }],
          guidedActions: { 'request-parameters': { status: 'idle' }, 'calibrate-compass': idleAction }
        })
      })
    )
    expect(bySequence(sections)).toEqual({ link: 'complete', alpha: 'current', compass: 'complete' })
    expect(sections[2].status).toBe('complete')
  })

  it('radio: Clear stays enabled after a waiver, and Confirm waits for staged receiver drafts to be written', () => {
    const RADIO = [{ id: 'radio', title: 'Radio' }]
    const waived = buildSetupFlowSections(
      inputs(RADIO, { snapshot: snapshot(RADIO, { liveVerification: rcLive }), ...confirmed('radio', 'already-done') })
    )[0]
    const clear = waived.actions.find((action) => action.kind === 'clear-confirmation')
    expect(label(clear as { label?: string })).toBe('Clear RC Waiver')
    expect(isDisabled(clear)).toBe(false)

    const done = {
      snapshot: snapshot(RADIO, { liveVerification: rcLive }),
      rcMappingSession: { status: 'ready', captures: {} } as unknown as SetupFlowSectionsInputs['rcMappingSession'],
      rcRangeExercise: { status: 'passed' } as unknown as SetupFlowSectionsInputs['rcRangeExercise'],
      rcCalibrationSession: { status: 'ready' } as unknown as SetupFlowSectionsInputs['rcCalibrationSession'],
      rcDirectionResults: { roll: 'correct', pitch: 'correct', throttle: 'correct', yaw: 'correct' } as SetupFlowSectionsInputs['rcDirectionResults']
    }
    const confirmable = buildSetupFlowSections(inputs(RADIO, done))[0].actions.find((action) => label(action) === 'Confirm RC Review')
    expect(isDisabled(confirmable)).toBe(false)
    const withDrafts = buildSetupFlowSections(inputs(RADIO, { ...done, receiverDraftsPending: true }))[0]
    expect(isDisabled(withDrafts.actions.find((action) => label(action) === 'Confirm RC Review'))).toBe(true)
    expect(withDrafts.detail).toMatch(/Apply the staged receiver values first/)
  })

  it('radio: a Rover asks for steering and throttle directions only', () => {
    const RADIO = [{ id: 'radio', title: 'Radio' }]
    const [radio] = buildSetupFlowSections(
      inputs(RADIO, {
        isCopterVehicle: false,
        snapshot: snapshot(RADIO, { vehicle: { vehicle: 'ArduRover' }, liveVerification: rcLive }),
        rcDirectionResults: { roll: 'correct', pitch: 'idle', throttle: 'correct', yaw: 'idle' } as SetupFlowSectionsInputs['rcDirectionResults']
      })
    )
    expect(radio.criteria.find((criterion) => /directions/i.test(criterion.label))?.met).toBe(true)
    expect(radio.criteria.map((criterion) => criterion.label).join(' ')).toMatch(/steering and throttle/)
  })

  const FAILSAFE = [{ id: 'failsafe', title: 'Failsafe' }]
  const failsafeFor = (vehicle: string, params: Record<string, number>, over: Partial<SetupFlowSectionsInputs> = {}) =>
    buildSetupFlowSections(
      inputs(FAILSAFE, {
        isCopterVehicle: vehicle === 'ArduCopter',
        snapshot: snapshot(FAILSAFE, {
          vehicle: { vehicle },
          liveVerification: { ...rcLive, batteryTelemetry: { verified: true } },
          parameters: Object.entries(params).map(([id, value]) => ({ id, value }))
        }),
        batteryFailsafe: 2,
        batteryMonitor: 4,
        throttleFailsafe: params.FS_THR_ENABLE ?? params.THR_FAILSAFE,
        ...over
      })
    )[0]

  it('failsafe: Plane needs THR_FAILSAFE = 1 (not "enabled, no action") and a long-failsafe action', () => {
    const noAction = failsafeFor('ArduPlane', { THR_FAILSAFE: 2, FS_SHORT_ACTN: 0, FS_LONG_ACTN: 0 }, confirmed('failsafe', 'complete'))
    expect(noAction.status).not.toBe('complete')
    expect(noAction.criteria.filter((criterion) => !criterion.met).map((criterion) => criterion.label)).toEqual([
      'Throttle failsafe on (THR_FAILSAFE = 1)',
      'Long failsafe has an action (FS_LONG_ACTN)'
    ])
    const good = failsafeFor('ArduPlane', { THR_FAILSAFE: 1, FS_SHORT_ACTN: 1, FS_LONG_ACTN: 1 }, confirmed('failsafe', 'complete'))
    expect(good.status).toBe('complete')
  })

  it('failsafe: Rover is judged on FS_ACTION, not just the throttle failsafe enable', () => {
    const nothing = failsafeFor('ArduRover', { FS_THR_ENABLE: 1, FS_ACTION: 0 }, confirmed('failsafe', 'complete'))
    expect(nothing.status).not.toBe('complete')
    expect(nothing.criteria.find((criterion) => /FS_ACTION/.test(criterion.label))?.met).toBe(false)
  })

  it('failsafe: a Sub reviews leak and surface-link failsafes, needs no throttle failsafe and no RC link', () => {
    const sub = failsafeFor(
      'ArduSub',
      { FS_THR_ENABLE: 0, FS_LEAK_ENABLE: 2, FS_GCS_ENABLE: 2 },
      {
        ...confirmed('failsafe', 'complete'),
        snapshot: snapshot(FAILSAFE, {
          vehicle: { vehicle: 'ArduSub' },
          liveVerification: { rcInput: { verified: false, channelCount: 0 }, batteryTelemetry: { verified: true } },
          parameters: [{ id: 'FS_THR_ENABLE', value: 0 }, { id: 'FS_LEAK_ENABLE', value: 2 }, { id: 'FS_GCS_ENABLE', value: 2 }]
        })
      }
    )
    expect(sub.status).toBe('complete')
    expect(sub.criteria.map((criterion) => criterion.label).join(' ')).not.toMatch(/Throttle|RC link/)
    const leakOff = failsafeFor('ArduSub', { FS_THR_ENABLE: 0, FS_LEAK_ENABLE: 0, FS_GCS_ENABLE: 2 }, confirmed('failsafe', 'complete'))
    expect(leakOff.status).not.toBe('complete')
  })

  it('failsafe: the Copter criteria are unchanged, and a radio waiver satisfies the RC-link criterion', () => {
    const copter = failsafeFor('ArduCopter', { FS_THR_ENABLE: 1 }, { rtlAltitudeMetres: 30 })
    expect(copter.criteria.map((criterion) => criterion.label)).toEqual([
      'Throttle failsafe is enabled',
      'Battery failsafe has an action, not just a warning',
      'Return altitude above tree height (20 m)',
      'RC link seen, or radio verified elsewhere',
      'Battery telemetry live',
      'Failsafe review confirmed'
    ])
    const noRc = buildSetupFlowSections(
      inputs(FAILSAFE, {
        snapshot: snapshot(FAILSAFE, {
          liveVerification: { rcInput: { verified: false, channelCount: 0 }, batteryTelemetry: { verified: true } },
          parameters: [{ id: 'FS_THR_ENABLE', value: 1 }]
        }),
        batteryFailsafe: 2,
        batteryMonitor: 4,
        throttleFailsafe: 1,
        rtlAltitudeMetres: 30,
        setupConfirmations: {
          radio: { signature: undefined, confirmedAtMs: 1, outcome: 'already-done' },
          failsafe: { signature: undefined, confirmedAtMs: 1, outcome: 'complete' }
        },
        setupConfirmationSignatures: {}
      })
    )[0]
    expect(noRc.status).toBe('complete')
  })

  it('failsafe: with no battery monitor the battery-action criterion is not asked, and the waivers share the confirm gate', () => {
    const noMonitor = failsafeFor('ArduCopter', { FS_THR_ENABLE: 1 }, { batteryMonitor: 0, batteryFailsafe: undefined, rtlAltitudeMetres: 30 })
    expect(noMonitor.criteria.find((criterion) => /battery monitor/i.test(criterion.label))?.met).toBe(true)
    expect(isDisabled(noMonitor.actions.find((action) => label(action) === 'Confirm Failsafe Review'))).toBe(false)
    const missing = failsafeFor('ArduCopter', {}, { throttleFailsafe: undefined, rtlAltitudeMetres: 30 })
    const noPack = buildSetupFlowSections(
      inputs(FAILSAFE, {
        snapshot: snapshot(FAILSAFE, { parameters: [], liveVerification: { ...rcLive, batteryTelemetry: { verified: false } } }),
        batteryFailsafe: 2,
        batteryMonitor: 4,
        throttleFailsafe: undefined,
        rtlAltitudeMetres: 30
      })
    )[0].actions.find((action) => label(action) === 'No Pack Connected — Review Later')
    expect(missing.status).not.toBe('complete')
    expect(isDisabled(noPack)).toBe(true)
  })

  const POWER = [{ id: 'power', title: 'Power' }]
  const powerWith = (over: Record<string, unknown>, extra: Partial<SetupFlowSectionsInputs> = {}) =>
    buildSetupFlowSections(
      inputs(POWER, {
        batteryMonitor: 4,
        snapshot: snapshot(POWER, {
          parameters: [],
          liveVerification: { batteryTelemetry: { verified: true, voltageV: 16.1, remainingPercent: 80 } },
          preArmStatus: { healthy: true, issues: [], liveCheck: { present: true, enabled: true, passing: true } },
          guidedActions: { 'request-parameters': { status: 'idle' }, 'reboot-autopilot': idleAction },
          ...over
        }),
        ...extra
      })
    )[0]

  it('power: no longer judges pre-arm (that is Ready to Fly), and completes on the monitor, telemetry and review', () => {
    const power = powerWith({ preArmStatus: { healthy: false, issues: ['x'], liveCheck: { present: true, enabled: true, passing: false } } }, confirmed('power', 'complete'))
    expect(power.criteria.map((criterion) => criterion.label).join(' ')).not.toMatch(/pre-arm/i)
    expect(power.status).toBe('complete')
  })

  it('power: a bench with no pack can defer the live readings and complete', () => {
    const noPack = powerWith({ liveVerification: { batteryTelemetry: { verified: false } }, preArmStatus: { healthy: false, issues: ['Battery 1 low voltage'], liveCheck: { present: true, enabled: true, passing: false } } })
    expect(isDisabled(noPack.actions.find((action) => label(action) === 'Confirm Power Review'))).toBe(true)
    const waiver = noPack.actions.find((action) => label(action) === 'No Pack Connected — Review Later')
    expect(waiver?.confirmationOutcome).toBe('not-applicable')
    expect(isDisabled(waiver)).toBe(false)
    const deferred = powerWith(
      { liveVerification: { batteryTelemetry: { verified: false } }, preArmStatus: { healthy: false, issues: [], liveCheck: { present: true, enabled: true, passing: false } } },
      confirmed('power', 'not-applicable')
    )
    expect(deferred.status).toBe('complete')
    expect(label(deferred.actions.find((action) => action.kind === 'clear-confirmation') as { label?: string })).toBe('Clear Power Deferral')
  })

  it('power: a build with no battery monitor is told so and can defer', () => {
    const none = powerWith({ liveVerification: { batteryTelemetry: { verified: false } } }, { batteryMonitor: 0 })
    const waiver = none.actions.find((action) => label(action) === 'No Battery Monitor — Continue')
    expect(waiver?.confirmationOutcome).toBe('not-applicable')
    const deferred = powerWith({ liveVerification: { batteryTelemetry: { verified: false } } }, { batteryMonitor: 0, ...confirmed('power', 'not-applicable') })
    expect(deferred.status).toBe('complete')
  })
})

describe('wizard audit 2026-10 — ports and generic steps', () => {
  const label = (action: { label?: string }) => action.label
  // Two ports carrying traffic; SERIAL4 is -1 (disabled) with a wire still on
  // it -- the leftover-ESC-telemetry case that is not a software fix.
  const uarts = (rx4: number) =>
    [
      'UARTV1',
      'SERIAL0 OTG1  TX =  106511 RX =    3410 TXBD= 18692 RXBD=   598 RXDRP=       0 FE=0 OE=0 NE=0 FlowCtrl=1',
      'SERIAL1 UART1 TX =    1322 RX =    5000 TXBD=   232 RXBD=   600 RXDRP=       0 FE=0 OE=0 NE=0 FlowCtrl=0',
      `SERIAL4 UART4 TX =       0 RX =    ${String(rx4).padStart(4)} TXBD=     0 RXBD=   100 RXDRP=       0 FE=0 OE=0 NE=0 FlowCtrl=0`
    ].join('\n')
  const PORTS = [{ id: 'ports', title: 'Ports' }]
  const portsWith = (over: Partial<SetupFlowSectionsInputs> = {}) =>
    buildSetupFlowSections(
      inputs(PORTS, {
        snapshot: snapshot(PORTS, {
          hardware: { uartsFile: { rawText: uarts(900), previousRawText: uarts(400) } },
          parameters: [
            { id: 'SERIAL1_PROTOCOL', value: 2 },
            { id: 'SERIAL4_PROTOCOL', value: -1 }
          ]
        }),
        ...over
      })
    )[0]

  it('ports: a detected mismatch can be signed off as reviewed wiring, and the sign-off is undoable', () => {
    const flagged = portsWith()
    if (flagged.status === 'complete') {
      // The evidence parser did not flag SERIAL4; the rest of this test would
      // be vacuous, so say so loudly.
      throw new Error(`expected a port mismatch, got criteria ${JSON.stringify(flagged.criteria)}`)
    }
    const waiver = flagged.actions.find((action) => label(action) === 'Wiring Reviewed — Continue')
    expect(waiver?.kind).toBe('confirm-step')
    expect(waiver?.confirmationOutcome).toBe('not-applicable')
    const reviewed = portsWith({
      setupConfirmations: { ports: { signature: undefined, confirmedAtMs: 1, outcome: 'not-applicable' } },
      setupConfirmationSignatures: {}
    })
    expect(reviewed.status).toBe('complete')
    expect(reviewed.actions.find((action) => action.kind === 'clear-confirmation')).toBeDefined()
  })

  it('generic steps: Sensors offers the declared calibrations and a jump to Calibration; Verify offers the reboot', () => {
    const SECTIONS = [
      { id: 'sensors', title: 'Sensors', actions: ['calibrate-accelerometer', 'calibrate-level', 'calibrate-compass'], definition: { requiredParameters: [] } },
      { id: 'verify', title: 'Verify', actions: ['reboot-autopilot'], definition: { requiredParameters: [] } }
    ]
    const sections = buildSetupFlowSections(
      inputs(SECTIONS as never, {
        isCopterVehicle: false,
        snapshot: snapshot(SECTIONS as never, {
          vehicle: { vehicle: 'ArduPlane' },
          parameters: [],
          guidedActions: {
            'request-parameters': { status: 'idle' },
            'calibrate-accelerometer': { status: 'idle' },
            'calibrate-level': { status: 'idle' },
            'calibrate-compass': { status: 'idle' },
            'reboot-autopilot': { status: 'idle' }
          }
        })
      })
    )
    const sensors = sections[0]
    expect(sensors.actions.filter((action) => action.kind === 'guided').map((action) => (action as { actionId: string }).actionId)).toEqual([
      'calibrate-accelerometer',
      'calibrate-level',
      'calibrate-compass'
    ])
    const open = sensors.actions.find((action) => action.kind === 'scroll') as { label: string; panelId: string }
    expect(open).toMatchObject({ label: 'Open Calibration', panelId: 'setup-panel-calibration' })
    expect(sections[1].actions.some((action) => action.kind === 'guided' && (action as { actionId: string }).actionId === 'reboot-autopilot')).toBe(true)
  })
})

describe('wizard audit 2026-10 — reboots ride on the current step; every step says what is next', () => {
  const idleAction = { status: 'idle', summary: '', instructions: [], statusTexts: [] }
  const SECTIONS = [
    { id: 'link', title: 'Vehicle Link' },
    { id: 'compass', title: 'Compass', status: 'complete' },
    { id: 'alpha', title: 'Alpha' },
    { id: 'beta', title: 'Beta' }
  ]
  const build = (over: Partial<SetupFlowSectionsInputs> = {}) =>
    buildSetupFlowSections(
      inputs(SECTIONS, {
        compassSetupAvailability: { enabledCompassCount: 1, gpsConfigured: false, canSkipCalibration: false } as unknown as SetupFlowSectionsInputs['compassSetupAvailability'],
        snapshot: snapshot(SECTIONS, {
          liveVerification: { globalPosition: { verified: false } },
          parameters: [{ id: 'COMPASS_USE', value: 1 }, { id: 'COMPASS_DEV_ID', value: 97539 }],
          guidedActions: { 'request-parameters': { status: 'idle' }, 'reboot-autopilot': idleAction, 'calibrate-compass': idleAction }
        }),
        ...over
      })
    )

  it('a reboot-required follow-up gates the current step, not step 1', () => {
    const sections = build({
      parameterFollowUp: { refreshRequired: true, requiresReboot: true, changedCount: 0, text: 'Compass calibration stored new offsets. Reboot the flight controller.' }
    })
    expect(bySequence(sections)).toEqual({ link: 'complete', compass: 'complete', alpha: 'current', beta: 'locked' })
    const alpha = sections[2]
    expect(alpha.criteria.at(-1)).toEqual({ label: 'Flight controller rebooted after the last change', met: false })
    expect(alpha.blockingReason).toMatch(/Reboot the flight controller/)
    expect(alpha.nextStep).toBe('Next: reboot the flight controller, then continue here.')
    const [first] = alpha.actions as Array<{ kind: string; actionId?: string; tone?: string }>
    expect(first).toMatchObject({ kind: 'guided', actionId: 'reboot-autopilot', tone: 'primary' })
    expect(sections[0].criteria).toHaveLength(2)
  })

  it('with every step satisfied, a pending follow-up holds the last step open', () => {
    const DONE = [{ id: 'link', title: 'Vehicle Link' }, { id: 'compass', title: 'Compass', status: 'complete' }]
    const sections = buildSetupFlowSections(
      inputs(DONE, {
        compassSetupAvailability: { enabledCompassCount: 1, gpsConfigured: false, canSkipCalibration: false } as unknown as SetupFlowSectionsInputs['compassSetupAvailability'],
        snapshot: snapshot(DONE, {
          liveVerification: { globalPosition: { verified: false } },
          parameters: [{ id: 'COMPASS_USE', value: 1 }, { id: 'COMPASS_DEV_ID', value: 97539 }],
          guidedActions: { 'request-parameters': { status: 'idle' }, 'reboot-autopilot': idleAction, 'calibrate-compass': idleAction }
        }),
        parameterFollowUp: { refreshRequired: true, requiresReboot: true, changedCount: 0, text: 'Reboot.' }
      })
    )
    expect(bySequence(sections)).toEqual({ link: 'complete', compass: 'current' })
    expect(sections[1].status).not.toBe('complete')
  })

  it('every step carries a next-step line; the last one is a handoff to the first flight', () => {
    const sections = build()
    expect(sections.every((section) => typeof section.nextStep === 'string' && section.nextStep.startsWith('Next:') || section.nextStep?.startsWith('Setup on the bench'))).toBe(true)
    expect(sections[0].nextStep).toBe('Next: set each serial port to what is wired to it.')
    expect(sections[2].nextStep).toBe('Next: Beta.')
    expect(sections[3].nextStep).toMatch(/props on, pack on, a first flight in Stabilize/)
  })

  it('radio offers exactly one jump to the Receiver page', () => {
    const RADIO = [{ id: 'radio', title: 'Radio' }]
    const [radio] = buildSetupFlowSections(inputs(RADIO, { snapshot: snapshot(RADIO, { liveVerification: { rcInput: { verified: true, channelCount: 8 } } }) }))
    const opens = radio.actions.filter((action) => action.kind === 'scroll' && /Receiver/.test((action as { label: string }).label))
    expect(opens).toHaveLength(1)
  })
})

describe('phase 2 slice 1 — Motor Range, Ready to Fly, modes content, pack cells, GPS-less failsafe', () => {
  const label = (action: { label?: string }) => action.label
  const isDisabled = (action: unknown) => (action as { disabled?: boolean }).disabled === true
  const confirmed = (sectionId: string, outcome: 'complete' | 'already-done' | 'not-applicable') => ({
    setupConfirmations: { [sectionId]: { signature: undefined, confirmedAtMs: 1, outcome } },
    setupConfirmationSignatures: {}
  })
  const params = (values: Record<string, number>) => Object.entries(values).map(([id, value]) => ({ id, value }))

  const RANGE = [{ id: 'motor-range', title: 'Motor Range' }]
  const motorRange = (spinArm: number, spinMin: number, over: Partial<SetupFlowSectionsInputs> = {}) =>
    buildSetupFlowSections(
      inputs(RANGE, {
        escSetup: { calibrationPath: 'digital-protocol' } as unknown as SetupFlowSectionsInputs['escSetup'],
        snapshot: snapshot(RANGE, { parameters: params({ MOT_SPIN_ARM: spinArm, MOT_SPIN_MIN: spinMin }) }),
        ...over
      })
    )[0]

  it('motor range: a sane measured range confirms; an inverted or too-high range cannot', () => {
    const good = motorRange(0.08, 0.12)
    expect(good.criteria.filter((criterion) => !criterion.met).map((criterion) => criterion.label)).toEqual([
      'Spin range confirmed'
    ])
    expect(isDisabled(good.actions.find((action) => label(action) === 'Confirm Spin Range Measured'))).toBe(false)
    const open = good.actions.find((action) => action.kind === 'scroll') as { label: string; targetElementId?: string }
    expect(open).toMatchObject({ label: 'Open Spin Wizard', targetElementId: 'outputs-spin-thresholds' })
    expect(motorRange(0.08, 0.12, confirmed('motor-range', 'complete')).status).toBe('complete')

    const inverted = motorRange(0.2, 0.12)
    expect(isDisabled(inverted.actions.find((action) => label(action) === 'Confirm Spin Range Measured'))).toBe(true)
    expect(isDisabled(inverted.actions.find((action) => label(action) === 'Measured Elsewhere — Continue'))).toBe(true)
    expect(motorRange(0.1, 0.3).criteria.find((criterion) => /at or below/.test(criterion.label))?.met).toBe(false)
  })

  it('motor range: analog ESCs get the endpoint-calibration criterion and jump here, not on Outputs', () => {
    const analog = motorRange(0.08, 0.12, { escSetup: { calibrationPath: 'analog-calibration' } as unknown as SetupFlowSectionsInputs['escSetup'] })
    expect(analog.criteria.some((criterion) => /ESC endpoints/.test(criterion.label))).toBe(true)
    expect(analog.actions.map(label)).toContain('Open ESC Calibration')
  })

  const READY = [{ id: 'readiness', title: 'Ready to Fly' }]
  const readyParams = (over: Record<string, number> = {}) =>
    params({ ARMING_CHECK: 1, LOG_BITMASK: 65531, LOG_BACKEND_TYPE: 1, ARMING_RUDDER: 2, RC5_OPTION: 0, ...over })
  const ready = (values: Record<string, number>, over: Partial<SetupFlowSectionsInputs> = {}, live: Record<string, unknown> = {}) =>
    buildSetupFlowSections(
      inputs(READY, {
        savedSnapshotCount: 1,
        snapshot: snapshot(READY, {
          parameters: readyParams(values),
          liveVerification: { batteryTelemetry: { verified: true, voltageV: 16.4 } },
          preArmStatus: { healthy: true, issues: [], liveCheck: { present: true, enabled: true, passing: true } },
          guidedActions: { 'request-parameters': { status: 'idle' } },
          ...live
        }),
        ...over
      })
    )[0]

  it('ready to fly: completes on checks, logging, an arm method, pre-arm with a pack, a snapshot and the review', () => {
    const done = ready({}, confirmed('readiness', 'complete'))
    expect(done.status).toBe('complete')
    expect(done.nextStep).toMatch(/props on, pack on/)
  })

  it('ready to fly: disabled arming checks have no waiver, on either parameter generation', () => {
    const legacyOff = ready({ ARMING_CHECK: 0 })
    expect(legacyOff.criteria[0].met).toBe(false)
    expect(legacyOff.detail).toMatch(/Turn every check back on/)
    expect(isDisabled(legacyOff.actions.find((action) => label(action) === 'Confirm Ready to Fly'))).toBe(true)
    expect(legacyOff.actions.some((action) => /Acknowledge/.test(label(action) ?? ''))).toBe(false)
    expect(ready({ ARMING_CHECK: 0, ARMING_SKIPCHK: 0 }).criteria[0].met).toBe(true)
    expect(ready({ ARMING_SKIPCHK: 8 }).criteria[0].met).toBe(false)
    expect(ready({ ARMING_CHECK: 1 }).actions.map(label)).toContain('Open Arming Checks')
  })

  it('ready to fly: logging, an arm switch, and a snapshot are each asked for by name', () => {
    const noLog = ready({ LOG_BITMASK: 0 })
    expect(noLog.criteria[1].met).toBe(false)
    expect(noLog.actions.map(label)).toContain('Open Logs')
    const noArm = ready({ ARMING_RUDDER: 0 })
    expect(noArm.criteria[2].met).toBe(false)
    expect(ready({ ARMING_RUDDER: 0, RC5_OPTION: 153 }).criteria[2].met).toBe(true)
    const noSnapshot = ready({}, { savedSnapshotCount: 0 })
    expect(noSnapshot.criteria.find((criterion) => /Snapshot/.test(criterion.label))?.met).toBe(false)
    expect(noSnapshot.actions.map(label)).toContain('Open Snapshots')
  })

  it('ready to fly: pre-arm blocked on the bench can be acknowledged, but only once everything else is in order', () => {
    const blocked = ready({}, {}, { preArmStatus: { healthy: false, issues: ['PreArm: GPS: No fix'], liveCheck: { present: true, enabled: true, passing: false } } })
    const ack = blocked.actions.find((action) => label(action) === 'Pre-arm Blocked on the Bench — Acknowledge')
    expect(ack?.confirmationOutcome).toBe('already-done')
    expect(isDisabled(ack)).toBe(false)
    const blockedNoLog = ready({ LOG_BITMASK: 0 }, {}, { preArmStatus: { healthy: false, issues: [], liveCheck: { present: true, enabled: true, passing: false } } })
    expect(isDisabled(blockedNoLog.actions.find((action) => label(action) === 'Pre-arm Blocked on the Bench — Acknowledge'))).toBe(true)
    const acknowledged = ready({}, confirmed('readiness', 'already-done'), { preArmStatus: { healthy: false, issues: [], liveCheck: { present: true, enabled: true, passing: false } } })
    expect(acknowledged.status).toBe('complete')
  })

  it('modes: a Copter needs Stabilize and AltHold on the switch, not just two positions', () => {
    const MODES = [{ id: 'modes', title: 'Flight Modes' }]
    const build = (values: number[]) =>
      buildSetupFlowSections(
        inputs(MODES, {
          modeSwitchEstimate: { channelNumber: 5 } as unknown as SetupFlowSectionsInputs['modeSwitchEstimate'],
          modeExerciseAssignments: values.map((value, index) => ({ slot: index + 1, value })) as unknown as SetupFlowSectionsInputs['modeExerciseAssignments'],
          modeSwitchExercise: { status: 'passed', targetSlots: [], visitedSlots: [], unexpectedSlots: [] } as unknown as SetupFlowSectionsInputs['modeSwitchExercise']
        })
      )[0]
    expect(build([0, 2, 16]).status).toBe('complete')
    const acroOnly = build([1, 16])
    expect(acroOnly.status).not.toBe('complete')
    expect(acroOnly.detail).toMatch(/Put Stabilize and AltHold on the switch/)
    expect(build([0, 16]).detail).toMatch(/Put AltHold on the switch/)
  })

  it('power: the live pack voltage gives the cell count, and every threshold has to fit it', () => {
    const POWER = [{ id: 'power', title: 'Battery' }]
    const build = (values: Record<string, number>) =>
      buildSetupFlowSections(
        inputs(POWER, {
          batteryMonitor: 4,
          snapshot: snapshot(POWER, {
            parameters: params(values),
            liveVerification: { batteryTelemetry: { verified: true, voltageV: 16.4, remainingPercent: 80 } },
            guidedActions: { 'request-parameters': { status: 'idle' }, 'reboot-autopilot': { status: 'idle', summary: '', instructions: [], statusTexts: [] } }
          })
        })
      )[0]
    const good = build({ BATT_ARM_VOLT: 13.8, BATT_LOW_VOLT: 14.4, BATT_CRT_VOLT: 13.8, MOT_BAT_VOLT_MAX: 16.8, MOT_BAT_VOLT_MIN: 13.2 })
    expect(good.criteria.find((criterion) => /4S pack/.test(criterion.label))?.met).toBe(true)
    const threeS = build({ BATT_LOW_VOLT: 10.8 })
    expect(threeS.criteria.find((criterion) => /4S pack/.test(criterion.label))?.met).toBe(false)
    expect(threeS.detail).toMatch(/BATT_LOW_VOLT 10.8 is 2.70 V per cell/)
  })

  it('failsafe: a Copter with no GPS is asked to land on signal loss, not to return', () => {
    const FAILSAFE = [{ id: 'failsafe', title: 'Failsafe' }]
    const build = (throttleFailsafe: number, gpsConfigured: boolean) =>
      buildSetupFlowSections(
        inputs(FAILSAFE, {
          compassSetupAvailability: { enabledCompassCount: 0, gpsConfigured, canSkipCalibration: true } as unknown as SetupFlowSectionsInputs['compassSetupAvailability'],
          snapshot: snapshot(FAILSAFE, {
            parameters: params({ FS_THR_ENABLE: throttleFailsafe }),
            liveVerification: { rcInput: { verified: true, channelCount: 8 }, batteryTelemetry: { verified: true } }
          }),
          batteryFailsafe: 2,
          batteryMonitor: 4,
          throttleFailsafe,
          rtlAltitudeMetres: 15
        })
      )[0]
    const noGpsRtl = build(1, false)
    expect(noGpsRtl.criteria.some((criterion) => /Return altitude/.test(criterion.label))).toBe(false)
    expect(noGpsRtl.criteria.find((criterion) => /Throttle failsafe lands/.test(criterion.label))?.met).toBe(false)
    expect(build(3, false).criteria.find((criterion) => /Throttle failsafe lands/.test(criterion.label))?.met).toBe(true)
    expect(build(1, true).criteria.some((criterion) => /Return altitude/.test(criterion.label))).toBe(true)
  })
})

describe('phase 2 — Maiden Hover reads the first flight from its log', () => {
  const label = (action: { label?: string }) => action.label
  const isDisabled = (action: unknown) => (action as { disabled?: boolean }).disabled === true
  const MAIDEN = [{ id: 'maiden', title: 'Maiden Hover' }]
  const clean = {
    hasFlight: true,
    firstArmedMode: 0,
    firstArmedModeName: 'Stabilize',
    armCycles: 2,
    rehearsedArmDisarm: true,
    airborne: { startS: 25, endS: 45 },
    airborneSeconds: 20,
    warningTexts: [],
    findings: [],
    verdict: 'clean' as const
  }
  const build = (maidenFlight?: SetupFlowSectionsInputs['maidenFlight'], over: Partial<SetupFlowSectionsInputs> = {}) =>
    buildSetupFlowSections(inputs(MAIDEN, { maidenFlight, ...over }))[0]

  it('waits for a log, and a clean one lets the operator confirm', () => {
    const waiting = build(undefined)
    expect(waiting.status).not.toBe('complete')
    expect(isDisabled(waiting.actions.find((action) => label(action) === 'Confirm First Flight'))).toBe(true)
    expect(waiting.actions.map(label)).toContain('Flown Elsewhere — Continue')
    const read = build(clean)
    expect(read.criteria.filter((criterion) => !criterion.met).map((criterion) => criterion.label)).toEqual([
      'First flight confirmed'
    ])
    expect(isDisabled(read.actions.find((action) => label(action) === 'Confirm First Flight'))).toBe(false)
    expect(read.nextStep).toMatch(/hover-throttle flight/)
  })

  it('names what the log found and withholds the confirm', () => {
    const shaky = build({
      ...clean,
      firstArmedMode: 2,
      firstArmedModeName: 'AltHold',
      rehearsedArmDisarm: false,
      limitCycle: { axis: 'roll', freqHz: 12 },
      findings: ['First armed in AltHold; the first flight belongs in Stabilize.', 'A 12 Hz oscillation on roll: halve ATC_RAT_RLL/PIT P, I and D and fly again before anything else.'],
      verdict: 'review'
    })
    expect(shaky.criteria.find((criterion) => criterion.label === 'Armed in Stabilize')?.met).toBe(false)
    expect(shaky.criteria.find((criterion) => /oscillation/.test(criterion.label))?.met).toBe(false)
    expect(shaky.detail).toMatch(/12 Hz oscillation/)
    expect(isDisabled(shaky.actions.find((action) => label(action) === 'Confirm First Flight'))).toBe(true)
  })

  it('the flown-elsewhere waiver completes the step and stays undoable', () => {
    const waived = build(undefined, {
      setupConfirmations: { maiden: { signature: undefined, confirmedAtMs: 1, outcome: 'already-done' } },
      setupConfirmationSignatures: {}
    })
    expect(waived.status).toBe('complete')
    expect(isDisabled(waived.actions.find((action) => action.kind === 'clear-confirmation'))).toBe(false)
  })
})

describe('phase 2 — Hover Throttle: learned, accepted, and the throttle controller follows it', () => {
  const label = (action: { label?: string }) => action.label
  const isDisabled = (action: unknown) => (action as { disabled?: boolean }).disabled === true
  const HOVER = [{ id: 'hover', title: 'Hover Throttle' }]
  const build = (values: Record<string, number>, over: Partial<SetupFlowSectionsInputs> = {}) =>
    buildSetupFlowSections(
      inputs(HOVER, {
        snapshot: snapshot(HOVER, { parameters: Object.entries(values).map(([id, value]) => ({ id, value })) }),
        ...over
      })
    )[0]

  it('the 0.35 default means nothing learned; a learned, accepted hover with matching gains confirms', () => {
    const fresh = build({ MOT_THST_HOVER: 0.35, MOT_HOVER_LEARN: 2, PSC_ACCZ_P: 0.5, PSC_ACCZ_I: 1 })
    expect(fresh.criteria.filter((criterion) => criterion.met)).toHaveLength(0)
    expect(fresh.detail).toMatch(/switch to AltHold/)
    expect(isDisabled(fresh.actions.find((action) => label(action) === 'Confirm Hover Throttle'))).toBe(true)

    const learnedNotAccepted = build({ MOT_THST_HOVER: 0.18, MOT_HOVER_LEARN: 2, PSC_ACCZ_P: 0.5, PSC_ACCZ_I: 1 })
    expect(learnedNotAccepted.criteria[0].met).toBe(true)
    expect(learnedNotAccepted.criteria[1].met).toBe(false)
    expect(learnedNotAccepted.detail).toMatch(/accept it below/)

    const done = build({ MOT_THST_HOVER: 0.18, MOT_HOVER_LEARN: 0, PSC_ACCZ_P: 0.18, PSC_ACCZ_I: 0.36 })
    expect(done.criteria.filter((criterion) => !criterion.met).map((criterion) => criterion.label)).toEqual([
      'Hover flight confirmed'
    ])
    expect(isDisabled(done.actions.find((action) => label(action) === 'Confirm Hover Throttle'))).toBe(false)
    expect(done.nextStep).toMatch(/harmonic notch/)
  })

  it('4.7 names are read at their own scale', () => {
    const modern = build({ MOT_THST_HOVER: 0.2, MOT_HOVER_LEARN: 0, PSC_D_ACC_P: 0.02, PSC_D_ACC_I: 0.04 })
    expect(modern.criteria[2].met).toBe(true)
    expect(modern.evidence.join(' ')).toMatch(/PSC_D_ACC_P 0.02/)
  })

  it('the set-elsewhere waiver completes the step', () => {
    const waived = build(
      { MOT_THST_HOVER: 0.35, MOT_HOVER_LEARN: 2 },
      { setupConfirmations: { hover: { signature: undefined, confirmedAtMs: 1, outcome: 'already-done' } }, setupConfirmationSignatures: {} }
    )
    expect(waived.status).toBe('complete')
  })
})

describe('phase 2 — Filters: the harmonic notch placed from the hover', () => {
  const label = (action: { label?: string }) => action.label
  const isDisabled = (action: unknown) => (action as { disabled?: boolean }).disabled === true
  const FILTERS = [{ id: 'filters', title: 'Filters' }]
  const escPlan = { escTelemetry: true, hoverFundamentalHz: 150, hoverThrottle: 0.2, hoverSeconds: 30, notes: [] }
  const build = (values: Record<string, number>, over: Partial<SetupFlowSectionsInputs> = {}) =>
    buildSetupFlowSections(
      inputs(FILTERS, {
        snapshot: snapshot(FILTERS, {
          parameters: Object.entries(values).map(([id, value]) => ({ id, value })),
          liveVerification: { escTelemetry: { everReported: false, escs: [] } }
        }),
        ...over
      })
    )[0]

  it('a notch at the demo defaults (off, REF 0) is not placed; one set as planned confirms', () => {
    const off = build({ INS_HNTCH_ENABLE: 0, INS_HNTCH_MODE: 1, INS_HNTCH_REF: 0, INS_HNTCH_FREQ: 80, INS_HNTCH_BW: 40, INS_GYRO_FILTER: 40, MOT_THST_HOVER: 0.2 }, { notchPlan: escPlan })
    expect(off.criteria[0].met).toBe(false)
    expect(isDisabled(off.actions.find((action) => label(action) === 'Confirm Notch Placed'))).toBe(true)
    expect(off.summary).toMatch(/150 Hz/)
    const placed = build({ INS_HNTCH_ENABLE: 1, INS_HNTCH_MODE: 3, INS_HNTCH_REF: 1, INS_HNTCH_FREQ: 120, INS_HNTCH_BW: 60, INS_HNTCH_HMNCS: 3, INS_GYRO_FILTER: 80, MOT_THST_HOVER: 0.2 }, { notchPlan: escPlan })
    expect(placed.criteria.filter((criterion) => !criterion.met).map((criterion) => criterion.label)).toEqual([
      'Notch placed, confirmed'
    ])
    expect(isDisabled(placed.actions.find((action) => label(action) === 'Confirm Notch Placed'))).toBe(false)
    expect(placed.nextStep).toMatch(/autotune/)
  })

  it('without a log the step asks for one and offers the Tuning page and a waiver', () => {
    const none = build({ INS_HNTCH_ENABLE: 0, INS_GYRO_FILTER: 40 })
    expect(none.detail).toMatch(/Read the hover-throttle flight/)
    expect(none.actions.map(label)).toContain('Open Tuning ▸ Notches')
    expect(none.actions.map(label)).toContain('Filters Set Elsewhere — Continue')
  })
})

describe('no step is a dead end — the override', () => {
  const label = (action: { label?: string }) => action.label
  const isDisabled = (action: unknown) => (action as { disabled?: boolean }).disabled === true
  const READY = [{ id: 'readiness', title: 'Ready to Fly' }]
  const readiness = (over: Partial<SetupFlowSectionsInputs> = {}) =>
    buildSetupFlowSections(
      inputs(READY, {
        savedSnapshotCount: 1,
        snapshot: snapshot(READY, {
          parameters: [{ id: 'ARMING_CHECK', value: 0 }, { id: 'LOG_BITMASK', value: 65531 }, { id: 'ARMING_RUDDER', value: 2 }],
          liveVerification: { batteryTelemetry: { verified: true, voltageV: 16.4 } },
          preArmStatus: { healthy: true, issues: [], liveCheck: { present: true, enabled: true, passing: true } },
          guidedActions: { 'request-parameters': { status: 'idle' } }
        }),
        ...over
      })
    )[0]

  it('a step with no enabled sign-off offers Override; one with a waiver does not', () => {
    const stuck = readiness()
    expect(isDisabled(stuck.actions.find((action) => label(action) === 'Confirm Ready to Fly'))).toBe(true)
    const override = stuck.actions.find((action) => label(action) === 'Override — Continue Anyway')
    expect(override?.confirmationOutcome).toBe('overridden')
    const AIRFRAME = [{ id: 'airframe', title: 'Airframe' }]
    const withWaiver = buildSetupFlowSections(
      inputs(AIRFRAME, {
        snapshot: snapshot(AIRFRAME, { liveVerification: { attitudeTelemetry: { verified: false } } }),
        airframe: { frameClassValue: 1, frameClassLabel: 'Quad', frameTypeValue: 1, frameTypeLabel: 'X', expectedMotorCount: 4, frameTypeIgnored: false } as unknown as SetupFlowSectionsInputs['airframe']
      })
    )[0]
    expect(withWaiver.actions.map(label)).not.toContain('Override — Continue Anyway')
  })

  it('an override completes the step loudly and is undoable', () => {
    const overridden = readiness({
      setupConfirmations: { readiness: { signature: undefined, confirmedAtMs: 1, outcome: 'overridden' } },
      setupConfirmationSignatures: {}
    })
    expect(overridden.status).toBe('complete')
    expect(overridden.confirmationOutcome).toBe('overridden')
    expect(overridden.summary).toMatch(/^Overridden by you/)
    expect(overridden.criteria.every((criterion) => criterion.met && /\(overridden\)$/.test(criterion.label))).toBe(true)
    expect(label(overridden.actions[0] as { label?: string })).toBe('Clear Override')
    expect(overridden.actions.some((action) => action.kind === 'confirm-step')).toBe(false)
  })
})

describe('phase 2 — Autotune: prerequisites, then the gains that moved', () => {
  const label = (action: { label?: string }) => action.label
  const isDisabled = (action: unknown) => (action as { disabled?: boolean }).disabled === true
  const TUNE = [{ id: 'autotune', title: 'Autotune' }]
  const base = { MOT_THST_HOVER: 0.18, INS_HNTCH_ENABLE: 1, FLTMODE1: 0, FLTMODE2: 2, AUTOTUNE_AGGR: 0.075, ATC_RAT_RLL_P: 0.135, ATC_RAT_PIT_P: 0.135, ATC_RAT_YAW_P: 0.18, ATC_ANG_RLL_P: 4.5, ATC_ANG_PIT_P: 4.5, ATC_ANG_YAW_P: 4.5 }
  const build = (values: Record<string, number>, over: Partial<SetupFlowSectionsInputs> = {}) =>
    buildSetupFlowSections(
      inputs(TUNE, { snapshot: snapshot(TUNE, { parameters: Object.entries(values).map(([id, value]) => ({ id, value })) }), ...over })
    )[0]

  it('names the missing prerequisite, in order', () => {
    expect(build({ ...base, MOT_THST_HOVER: 0.35 }).detail).toMatch(/Learn the hover throttle first/)
    expect(build({ ...base, INS_HNTCH_ENABLE: 0 }).detail).toMatch(/Place the harmonic notch first/)
    expect(build({ ...base, FLTMODE2: 5 }).detail).toMatch(/Put AltHold on the mode switch/)
    expect(build({ ...base, AUTOTUNE_AGGR: 0.2 }).detail).toMatch(/between 0.05 and 0.10/)
    expect(build(base).detail).toMatch(/stage the flight/)
  })

  it('an axis counts as tuned when its gains moved since the staged flight; all three unlock the confirm', () => {
    const flight = { axisMask: 7, gains: { ATC_RAT_RLL_P: 0.135, ATC_RAT_PIT_P: 0.135, ATC_RAT_YAW_P: 0.18, ATC_ANG_RLL_P: 4.5, ATC_ANG_PIT_P: 4.5, ATC_ANG_YAW_P: 4.5 } }
    const rollOnly = build({ ...base, ATC_RAT_RLL_P: 0.15 }, { autotuneFlight: flight })
    expect(rollOnly.criteria.find((criterion) => criterion.label === 'Roll tuned (gains moved)')?.met).toBe(true)
    expect(rollOnly.criteria.find((criterion) => criterion.label === 'Pitch tuned (gains moved)')?.met).toBe(false)
    expect(rollOnly.summary).toMatch(/Tuned: Roll; still to do: Pitch, Yaw/)
    expect(isDisabled(rollOnly.actions.find((action) => label(action) === 'Confirm Autotune'))).toBe(true)
    const all = build({ ...base, ATC_RAT_RLL_P: 0.15, ATC_RAT_PIT_P: 0.16, ATC_RAT_YAW_P: 0.2 }, { autotuneFlight: flight })
    expect(all.criteria.filter((criterion) => !criterion.met).map((criterion) => criterion.label)).toEqual(['Autotune confirmed'])
    expect(isDisabled(all.actions.find((action) => label(action) === 'Confirm Autotune'))).toBe(false)
  })

  it('tuned elsewhere completes the step', () => {
    const waived = build(base, { setupConfirmations: { autotune: { signature: undefined, confirmedAtMs: 1, outcome: 'already-done' } }, setupConfirmationSignatures: {} })
    expect(waived.status).toBe('complete')
  })
})

describe('Outputs leads with the ESC protocol; Initial Tune reads the vehicle', () => {
  const label = (action: { label?: string }) => action.label
  const isDisabled = (action: unknown) => (action as { disabled?: boolean }).disabled === true
  const airframeStub = () =>
    ({ frameClassValue: 1, frameClassLabel: 'Quad', frameTypeValue: 1, frameTypeLabel: 'X', expectedMotorCount: 4, frameTypeIgnored: false }) as unknown as SetupFlowSectionsInputs['airframe']

  it('outputs: the ESC protocol is the first check; PWM (0) needs the review to count', () => {
    const OUTPUTS = [{ id: 'outputs', title: 'Outputs' }]
    const build = (pwmTypeValue: number | undefined) =>
      buildSetupFlowSections(
        inputs(OUTPUTS, {
          escSetup: { calibrationPath: pwmTypeValue === 0 ? 'analog-calibration' : 'digital-protocol', pwmTypeValue } as unknown as SetupFlowSectionsInputs['escSetup'],
          airframe: airframeStub(),
          outputMapping: { motorOutputs: [1, 2, 3, 4], configuredAuxOutputs: [], notes: [] } as unknown as SetupFlowSectionsInputs['outputMapping']
        })
      )[0]
    expect(build(6).criteria[0]).toEqual({ label: 'ESC protocol set (MOT_PWM_TYPE)', met: true })
    expect(build(0).criteria[0].met).toBe(false)
    expect(build(undefined).criteria[0].met).toBe(false)
  })

  it('initial tune: the 20 Hz gyro default and a missing battery range are the two tells', () => {
    const TUNE = [{ id: 'initial-tune', title: 'Initial Tune' }]
    const build = (values: Record<string, number>, over: Partial<SetupFlowSectionsInputs> = {}) =>
      buildSetupFlowSections(inputs(TUNE, { snapshot: snapshot(TUNE, { parameters: Object.entries(values).map(([id, value]) => ({ id, value })) }), ...over }))[0]
    const stock = build({ INS_GYRO_FILTER: 20, MOT_THST_EXPO: 0.65 })
    expect(stock.criteria.filter((criterion) => criterion.met)).toHaveLength(0)
    expect(isDisabled(stock.actions.find((action) => label(action) === 'Confirm Initial Tune'))).toBe(true)
    expect(stock.actions.map(label)).toContain('Initial Tune Set Elsewhere — Continue')
    const set = build({ INS_GYRO_FILTER: 80, MOT_THST_EXPO: 0.55, MOT_BAT_VOLT_MAX: 16.8, MOT_BAT_VOLT_MIN: 13.2 })
    expect(set.criteria.filter((criterion) => !criterion.met).map((criterion) => criterion.label)).toEqual(['Initial tune confirmed'])
    expect(set.summary).toBe('Gyro filter 80 Hz, pack 13.2–16.8 V.')
    expect(set.nextStep).toMatch(/Stabilize and AltHold/)
  })
})
