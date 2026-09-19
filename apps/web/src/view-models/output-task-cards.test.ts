import { describe, expect, it } from 'vitest'

import {
  buildOutputTaskCards,
  recommendOutputTaskId,
  type OutputTaskCard,
  type OutputTaskCardInputs,
  type RecommendedOutputTaskInputs
} from './output-task-cards'

// An all-clean baseline (nothing staged/invalid, exercises idle, ESC in sync).
// Each test overrides only the fields it exercises.
function baseInputs(overrides: Partial<OutputTaskCardInputs> = {}): OutputTaskCardInputs {
  return {
    outputAssignmentInvalidCount: 0,
    outputAssignmentStagedCount: 0,
    expectedMotorCount: 4,
    motorOutputCount: 4,
    configuredAuxOutputCount: 0,
    orientationExerciseStatus: 'idle',
    orientationExerciseSummary: 'orientation',
    motorMixerSummary: 'mixer',
    motorVerificationStatus: 'idle',
    motorDirectionSummary: 'direction',
    outputReviewInvalidCount: 0,
    outputReviewStagedCount: 0,
    escReviewConfirmed: false,
    escCalibrationPath: 'digital-protocol',
    escReviewSummary: 'esc',
    servoMappingRowCount: 8,
    outputPeripheralInvalidDraftCount: 0,
    outputPeripheralStagedDraftCount: 0,
    hasNotificationLedTypes: false,
    hasNotificationBuzzTypes: false,
    outputAdditionalGroupCount: 0,
    relayInstanceCount: 0,
    relayStagedCount: 0,
    relayInvalidCount: 0,
    totalOutputInvalidDrafts: 0,
    totalOutputStagedDrafts: 0,
    ...overrides
  }
}

const card = (cards: OutputTaskCard[], id: OutputTaskCard['id']): OutputTaskCard => {
  const found = cards.find((entry) => entry.id === id)
  if (!found) {
    throw new Error(`missing card ${id}`)
  }
  return found
}

describe('buildOutputTaskCards', () => {
  it('emits the task cards in a stable order', () => {
    expect(buildOutputTaskCards(baseInputs()).map((entry) => entry.id)).toEqual([
      'motor-setup',
      'direction-test',
      'esc-protocol',
      'servo-mapping',
      'peripherals',
      'relays',
      'review'
    ])
  })

  it('relays: instance count, staged, and invalid drive the value + tone', () => {
    expect(card(buildOutputTaskCards(baseInputs({ relayInstanceCount: 6 })), 'relays').value).toBe('6 relays')
    expect(card(buildOutputTaskCards(baseInputs({ relayInstanceCount: 1 })), 'relays').value).toBe('1 relay')
    const staged = card(buildOutputTaskCards(baseInputs({ relayInstanceCount: 6, relayStagedCount: 2 })), 'relays')
    expect(staged.value).toBe('2 staged')
    expect(staged.tone).toBe('warning')
    const invalid = card(buildOutputTaskCards(baseInputs({ relayStagedCount: 2, relayInvalidCount: 1 })), 'relays')
    expect(invalid.value).toBe('1 invalid')
    expect(invalid.tone).toBe('danger')
  })

  it('motor-setup: invalid drafts win over staged and dominate the tone', () => {
    const motor = card(buildOutputTaskCards(baseInputs({ outputAssignmentInvalidCount: 2, outputAssignmentStagedCount: 3 })), 'motor-setup')
    expect(motor.value).toBe('2 invalid')
    expect(motor.tone).toBe('danger')
  })

  it('motor-setup: a complete mapping with a passed orientation reads success', () => {
    const motor = card(buildOutputTaskCards(baseInputs({ orientationExerciseStatus: 'passed' })), 'motor-setup')
    expect(motor.value).toBe('4/4 mapped')
    expect(motor.tone).toBe('success')
  })

  it('motor-setup: a motor-count mismatch is a warning', () => {
    const motor = card(buildOutputTaskCards(baseInputs({ motorOutputCount: 3, expectedMotorCount: 4 })), 'motor-setup')
    expect(motor.value).toBe('3/4 mapped')
    expect(motor.tone).toBe('warning')
  })

  it('direction-test: reflects the motor-verification status', () => {
    expect(card(buildOutputTaskCards(baseInputs({ motorVerificationStatus: 'passed' })), 'direction-test').value).toBe('Passed')
    expect(card(buildOutputTaskCards(baseInputs({ motorVerificationStatus: 'failed' })), 'direction-test').value).toBe('Needs attention')
    expect(card(buildOutputTaskCards(baseInputs()), 'direction-test').value).toBe('Ready')
  })

  it('esc-protocol: reflects the calibration path (no Confirmed badge); manual-review warns', () => {
    // The "Confirmed" badge was removed from the ESC & Protocol tab — the card
    // now just reflects the calibration path.
    const digital = card(buildOutputTaskCards(baseInputs({ escCalibrationPath: 'digital-protocol' })), 'esc-protocol')
    expect(digital.value).toBe('Digital protocol review')
    expect(digital.tone).toBe('neutral')

    const manual = card(buildOutputTaskCards(baseInputs({ escCalibrationPath: 'manual-review' })), 'esc-protocol')
    expect(manual.value).toBe('Manual ESC review')
    expect(manual.tone).toBe('warning')
  })

  it('review: in sync by default, warns when drafts are staged, danger when invalid', () => {
    expect(card(buildOutputTaskCards(baseInputs()), 'review')).toMatchObject({ value: 'In sync', tone: 'success' })
    expect(card(buildOutputTaskCards(baseInputs({ totalOutputStagedDrafts: 5 })), 'review')).toMatchObject({ value: '5 staged', tone: 'warning' })
    expect(card(buildOutputTaskCards(baseInputs({ totalOutputInvalidDrafts: 1, totalOutputStagedDrafts: 5 })), 'review')).toMatchObject({
      value: '1 invalid',
      tone: 'danger'
    })
  })
})

// A "fully done" baseline that falls through the whole cascade to the final
// 'motor-setup'. Each test overrides the field that should short-circuit it.
function recommendBase(overrides: Partial<RecommendedOutputTaskInputs> = {}): RecommendedOutputTaskInputs {
  return {
    outputAssignmentInvalidCount: 0,
    orientationExerciseStatus: 'idle',
    motorVerificationStatus: 'passed',
    outputReviewInvalidCount: 0,
    outputPeripheralInvalidDraftCount: 0,
    motorOutputCount: 4,
    expectedMotorCount: 4,
    escReviewConfirmed: true,
    isCopterVehicle: true,
    ...overrides
  }
}

describe('recommendOutputTaskId', () => {
  it('routes in priority order: invalid assignment / orientation first', () => {
    expect(recommendOutputTaskId(recommendBase({ outputAssignmentInvalidCount: 1 }))).toBe('motor-setup')
    expect(recommendOutputTaskId(recommendBase({ orientationExerciseStatus: 'running' }))).toBe('motor-setup')
    expect(recommendOutputTaskId(recommendBase({ orientationExerciseStatus: 'failed' }))).toBe('motor-setup')
  })

  it('routes an in-progress/failed motor verification to direction-test', () => {
    expect(recommendOutputTaskId(recommendBase({ motorVerificationStatus: 'running' }))).toBe('direction-test')
    expect(recommendOutputTaskId(recommendBase({ motorVerificationStatus: 'failed' }))).toBe('direction-test')
  })

  it('routes invalid ESC drafts to esc-protocol and invalid peripherals to peripherals', () => {
    expect(recommendOutputTaskId(recommendBase({ outputReviewInvalidCount: 2 }))).toBe('esc-protocol')
    expect(recommendOutputTaskId(recommendBase({ outputPeripheralInvalidDraftCount: 1 }))).toBe('peripherals')
  })

  it('does NOT auto-route on merely-staged (non-invalid) drafts — stays on the completion cascade', () => {
    // A motor-count mismatch routes back to motor-setup before the ESC/verify checks.
    expect(recommendOutputTaskId(recommendBase({ motorOutputCount: 3 }))).toBe('motor-setup')
    expect(recommendOutputTaskId(recommendBase({ motorOutputCount: 0 }))).toBe('motor-setup')
  })

  it('falls through to esc-protocol when ESC is unconfirmed, then direction-test when unverified', () => {
    expect(recommendOutputTaskId(recommendBase({ escReviewConfirmed: false }))).toBe('esc-protocol')
    expect(recommendOutputTaskId(recommendBase({ motorVerificationStatus: 'idle' }))).toBe('direction-test')
  })

  it('returns motor-setup once everything is complete', () => {
    expect(recommendOutputTaskId(recommendBase())).toBe('motor-setup')
  })

  it('defaults a non-Copter vehicle to motor-setup (no copter ESC / direction-test routing)', () => {
    // A Plane has motors but no ESC-review / motor-direction steps; without this
    // it would fall through to esc-protocol and hide the output overview.
    const plane = { isCopterVehicle: false, expectedMotorCount: undefined, escReviewConfirmed: false }
    expect(recommendOutputTaskId(recommendBase({ ...plane, motorOutputCount: 4 }))).toBe('motor-setup')
    expect(recommendOutputTaskId(recommendBase({ ...plane, motorVerificationStatus: 'idle' }))).toBe('motor-setup')
    // Invalid drafts still pull a Plane to the relevant task.
    expect(recommendOutputTaskId(recommendBase({ ...plane, outputPeripheralInvalidDraftCount: 1 }))).toBe('peripherals')
  })
})
