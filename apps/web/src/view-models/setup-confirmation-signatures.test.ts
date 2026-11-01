import { describe, expect, it } from 'vitest'

import {
  buildSetupConfirmationSignatures,
  type SetupConfirmationSignatureInputs
} from './setup-confirmation-signatures'

// Fresh minimal inputs each call so per-test mutations never leak. The builder
// reads only the specific fields asserted below, so the rest is cast away.
function baseInputs(): SetupConfirmationSignatureInputs {
  const guided = (status: string) => ({ status, completedAtMs: 0 })
  return {
    airframe: { frameClassValue: 1, frameTypeValue: 0, frameTypeIgnored: false, expectedMotorCount: 4 } as unknown as SetupConfirmationSignatureInputs['airframe'],
    outputMapping: { motorOutputs: [], configuredAuxOutputs: [], notes: [] } as unknown as SetupConfirmationSignatureInputs['outputMapping'],
    escSetup: { calibrationPath: 'digital-protocol', pwmTypeValue: 6, notes: [], relevantParameters: [] } as unknown as SetupConfirmationSignatureInputs['escSetup'],
    compassSetupAvailability: { gpsConfigured: true, enabledCompassCount: 1, canSkipCalibration: false } as unknown as SetupConfirmationSignatureInputs['compassSetupAvailability'],
    currentRcAxisChannelMap: {} as unknown as SetupConfirmationSignatureInputs['currentRcAxisChannelMap'],
    rcAxisObservations: [] as unknown as SetupConfirmationSignatureInputs['rcAxisObservations'],
    rcMappingSession: { status: 'idle', captures: {} } as unknown as SetupConfirmationSignatureInputs['rcMappingSession'],
    snapshot: {
      parameters: [],
      guidedActions: {
        'calibrate-accelerometer': guided('idle'),
        'calibrate-level': guided('idle'),
        'calibrate-compass': guided('idle')
      },
      liveVerification: { rcInput: { verified: false }, batteryTelemetry: { verified: false } },
      preArmStatus: { issues: [] }
    } as unknown as SetupConfirmationSignatureInputs['snapshot'],
    batteryCapacity: 5000,
    batteryFailsafe: 2,
    batteryMonitor: 4,
    throttleFailsafe: 1
  }
}

const sig = (mutate: (inputs: SetupConfirmationSignatureInputs) => void = () => {}) => {
  const inputs = baseInputs()
  mutate(inputs)
  return buildSetupConfirmationSignatures(inputs)
}

describe('buildSetupConfirmationSignatures', () => {
  it('is deterministic for identical inputs', () => {
    expect(sig()).toEqual(sig())
  })

  it('produces a signature for every guided-setup section', () => {
    expect(Object.keys(sig()).sort()).toEqual(
      // 'modes' was missing here, which meant getSetupConfirmationRecord always
      // found an undefined signature for the Modes step and silently discarded
      // any confirmation stored against it.
      ['accelerometer', 'airframe', 'autotune', 'compass', 'esc-range', 'failsafe', 'filters', 'hover', 'initial-tune', 'level', 'maiden', 'modes', 'motor-range', 'outputs', 'ports', 'power', 'radio', 'readiness'].sort()
    )
  })

  it('every signature value is valid JSON', () => {
    for (const value of Object.values(sig())) {
      expect(() => JSON.parse(value)).not.toThrow()
    }
  })

  // Each section's signature must change iff its own inputs change — that is
  // what makes a stored confirmation invalidate at the right time.
  function expectOnlyChanges(
    section: string,
    mutate: (inputs: SetupConfirmationSignatureInputs) => void
  ): void {
    const before = sig()
    const after = sig(mutate)
    expect(after[section]).not.toBe(before[section])
    for (const [key, value] of Object.entries(before)) {
      if (key !== section) {
        expect(after[key]).toBe(value)
      }
    }
  }

  it('airframe geometry only re-signs the airframe section', () => {
    expectOnlyChanges('airframe', (inputs) => {
      ;(inputs.airframe as { frameClassValue: number }).frameClassValue = 2
    })
  })

  it('the ESC calibration path re-signs esc-range and motor-range, nothing else', () => {
    // Motor Range carries the ESC-endpoint criterion (analog ESCs only), so
    // the calibration path is part of what its sign-off reviewed.
    const before = sig()
    const after = sig((inputs) => {
      ;(inputs.escSetup as { calibrationPath: string }).calibrationPath = 'manual-review'
    })
    expect(after['esc-range']).not.toBe(before['esc-range'])
    expect(after['motor-range']).not.toBe(before['motor-range'])
    for (const [key, value] of Object.entries(before)) {
      if (key !== 'esc-range' && key !== 'motor-range') {
        expect(after[key]).toBe(value)
      }
    }
  })

  it('guided-action state does not re-sign the calibration sections (reboot resets it to idle)', () => {
    // Regression: signatures used to embed guidedActions status +
    // completedAtMs, so the reboot-driven reset to idle invalidated the
    // operator's calibration confirmations and regressed the wizard to
    // step one after every planned reboot.
    const before = sig()
    const after = sig((inputs) => {
      for (const actionId of ['calibrate-accelerometer', 'calibrate-level', 'calibrate-compass'] as const) {
        ;(inputs.snapshot.guidedActions[actionId] as { status: string; completedAtMs: number }).status = 'succeeded'
        ;(inputs.snapshot.guidedActions[actionId] as { status: string; completedAtMs: number }).completedAtMs = 12345
      }
    })
    expect(after).toEqual(before)
  })

  it('the stored calibration result on the FC re-signs exactly its own section', () => {
    expectOnlyChanges('accelerometer', (inputs) => {
      ;(inputs.snapshot as unknown as { parameters: { id: string; value: number }[] }).parameters = [
        { id: 'INS_ACCOFFS_X', value: 0.21 }
      ]
    })
    expectOnlyChanges('level', (inputs) => {
      ;(inputs.snapshot as unknown as { parameters: { id: string; value: number }[] }).parameters = [
        { id: 'AHRS_TRIM_X', value: 0.09 }
      ]
    })
    expectOnlyChanges('compass', (inputs) => {
      ;(inputs.snapshot as unknown as { parameters: { id: string; value: number }[] }).parameters = [
        { id: 'COMPASS_OFS_Y', value: 40.75 }
      ]
    })
    expectOnlyChanges('compass', (inputs) => {
      ;(inputs.snapshot as unknown as { parameters: { id: string; value: number }[] }).parameters = [
        { id: 'COMPASS_DEV_ID', value: 131874 }
      ]
    })
  })

  it('battery capacity only re-signs power; throttle failsafe only re-signs failsafe', () => {
    expectOnlyChanges('power', (inputs) => {
      inputs.batteryCapacity = 8000
    })
    expectOnlyChanges('failsafe', (inputs) => {
      inputs.throttleFailsafe = 0
    })
  })

  it('live telemetry flags and pre-arm churn do not re-sign anything (reboot stability)', () => {
    // Regression: failsafe/power signatures embedded liveVerification flags
    // and pre-arm issue text. Every reboot re-runs pre-arm checks and
    // restarts telemetry verification, so the operator's sign-offs were
    // invalidated by transient state they never reviewed. Signatures pin
    // configuration; the section criteria still re-check live state.
    const before = sig()
    const after = sig((inputs) => {
      ;(inputs.snapshot as unknown as {
        liveVerification: { rcInput: { verified: boolean }; batteryTelemetry: { verified: boolean } }
        preArmStatus: { issues: { text: string }[] }
      }).liveVerification = { rcInput: { verified: true }, batteryTelemetry: { verified: true } }
      ;(inputs.snapshot as unknown as { preArmStatus: { issues: { text: string }[] } }).preArmStatus = {
        issues: [{ text: 'PreArm: AHRS not healthy' }]
      }
    })
    expect(after).toEqual(before)
  })
})

describe('per-vehicle signature keys (wizard audit 2026-10)', () => {
  const build = (vehicle: string, params: Record<string, number>) =>
    buildSetupConfirmationSignatures({
      airframe: { frameClassValue: 1, frameTypeValue: 1, frameTypeIgnored: false, expectedMotorCount: 4 } as never,
      outputMapping: { motorOutputs: [], configuredAuxOutputs: [], notes: [] } as never,
      escSetup: { calibrationPath: 'digital-protocol', pwmTypeValue: 6, notes: [], relevantParameters: [] } as never,
      compassSetupAvailability: { gpsConfigured: true, enabledCompassCount: 1, canSkipCalibration: false } as never,
      currentRcAxisChannelMap: {} as never,
      rcAxisObservations: [],
      rcMappingSession: { status: 'idle', captures: {} } as never,
      snapshot: {
        vehicle: { vehicle },
        parameters: Object.entries(params).map(([id, value]) => ({ id, value }))
      } as never,
      batteryCapacity: 1300,
      batteryFailsafe: 2,
      batteryMonitor: 4,
      throttleFailsafe: 1
    })

  it('Copter signatures carry no vehicle keys (stored Copter sign-offs stay valid)', () => {
    // Vehicle params present on the Copter too (a Copter demo built on a shared
    // base reports some of them): none may leak into the Copter JSON.
    const copter = build('ArduCopter', { FS_THR_VALUE: 975, THR_FAILSAFE: 1, FS_ACTION: 2, FS_LEAK_ENABLE: 1, Q_ENABLE: 1 })
    expect(Object.keys(JSON.parse(copter.failsafe))).toEqual(['throttleFailsafe', 'batteryFailsafe', 'throttleFailsafeValue'])
    expect(Object.keys(JSON.parse(copter.airframe))).toEqual(['frameClassValue', 'frameTypeValue', 'frameTypeIgnored'])
  })

  it('Plane pins THR_FAILSAFE / FS_*_ACTN and the Q_* frame values; Rover FS_ACTION; Sub leak, pressure, GCS and pilot input', () => {
    const plane = build('ArduPlane', { THR_FAILSAFE: 1, FS_LONG_ACTN: 1, Q_ENABLE: 1 })
    expect(JSON.parse(plane.failsafe)).toMatchObject({ planeThrottleFailsafe: 1, longAction: 1 })
    expect(JSON.parse(plane.airframe)).toMatchObject({ qEnable: 1 })
    expect(build('ArduPlane', { THR_FAILSAFE: 1, FS_LONG_ACTN: 2, Q_ENABLE: 1 }).failsafe).not.toBe(plane.failsafe)
    expect(JSON.parse(build('ArduRover', { FS_ACTION: 2 }).failsafe)).toMatchObject({ action: 2 })
    expect(JSON.parse(build('ArduSub', { FS_LEAK_ENABLE: 2, FS_GCS_ENABLE: 1 }).failsafe)).toMatchObject({ leak: 2, gcs: 1 })
  })
})
