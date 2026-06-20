import { describe, expect, it } from 'vitest'

import {
  toneForConnection,
  toneForModeSwitchExercise,
  toneForMotorTestStatus,
  toneForParameterDraftStatus,
  toneForPresetApplicability,
  toneForScopedDraftReview,
  toneForSetup,
  toneForSetupSequence
} from './tone-helpers'

describe('tone maps', () => {
  it('toneForConnection', () => {
    expect(toneForConnection('connected')).toBe('success')
    expect(toneForConnection('connecting')).toBe('warning')
    expect(toneForConnection('error')).toBe('danger')
    expect(toneForConnection('disconnected')).toBe('neutral')
  })

  it('toneForSetup + toneForSetupSequence', () => {
    expect(toneForSetup('complete')).toBe('success')
    expect(toneForSetup('in-progress')).toBe('neutral')
    expect(toneForSetup('attention')).toBe('warning')
    expect(toneForSetupSequence('complete')).toBe('success')
    expect(toneForSetupSequence('current')).toBe('warning')
    expect(toneForSetupSequence('locked')).toBe('neutral')
  })

  it('toneForModeSwitchExercise + toneForMotorTestStatus', () => {
    expect(toneForModeSwitchExercise('passed')).toBe('success')
    expect(toneForModeSwitchExercise('failed')).toBe('danger')
    expect(toneForModeSwitchExercise('running')).toBe('warning')
    expect(toneForModeSwitchExercise('idle')).toBe('neutral')
    expect(toneForMotorTestStatus('succeeded')).toBe('success')
    expect(toneForMotorTestStatus('requested')).toBe('warning')
    expect(toneForMotorTestStatus('failed')).toBe('danger')
    expect(toneForMotorTestStatus('idle')).toBe('neutral')
  })

  it('toneForParameterDraftStatus + toneForPresetApplicability', () => {
    expect(toneForParameterDraftStatus('staged')).toBe('warning')
    expect(toneForParameterDraftStatus('invalid')).toBe('danger')
    expect(toneForParameterDraftStatus('unchanged')).toBe('neutral')
    expect(toneForPresetApplicability('blocked')).toBe('danger')
    expect(toneForPresetApplicability('caution')).toBe('warning')
    expect(toneForPresetApplicability('ready')).toBe('success')
  })

  it('toneForScopedDraftReview: invalid > staged > clean', () => {
    expect(toneForScopedDraftReview(3, 1)).toBe('danger')
    expect(toneForScopedDraftReview(3, 0)).toBe('warning')
    expect(toneForScopedDraftReview(0, 0)).toBe('success')
  })
})
