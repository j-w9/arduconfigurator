// StatusTone mappers, extracted from App.tsx as part of its decomposition. Pure
// functions mapping connection / setup / exercise / draft / preset states to the
// shared StatusTone used by every badge. Leaf consumer (imports the StatusTone
// type and the app state types; nothing imports it back).

import type { ConfiguratorSnapshot, ParameterDraftStatus } from '@arduconfig/ardupilot-core'

import type { StatusTone } from './status-tone'
import type { ModeSwitchExerciseStatus, SetupFlowSequenceState } from './app-types'

export function toneForConnection(kind: ConfiguratorSnapshot['connection']['kind']): StatusTone {
  switch (kind) {
    case 'connected':
      return 'success'
    case 'connecting':
      return 'warning'
    case 'error':
      return 'danger'
    default:
      return 'neutral'
  }
}

export function toneForSetup(kind: 'attention' | 'in-progress' | 'complete'): 'warning' | 'neutral' | 'success' {
  switch (kind) {
    case 'complete':
      return 'success'
    case 'in-progress':
      return 'neutral'
    default:
      return 'warning'
  }
}

export function toneForSetupSequence(state: SetupFlowSequenceState): StatusTone {
  switch (state) {
    case 'complete':
      return 'success'
    case 'current':
      return 'warning'
    default:
      return 'neutral'
  }
}

export function toneForModeSwitchExercise(status: ModeSwitchExerciseStatus): StatusTone {
  switch (status) {
    case 'passed':
      return 'success'
    case 'failed':
      return 'danger'
    case 'running':
      return 'warning'
    default:
      return 'neutral'
  }
}

export function toneForMotorTestStatus(status: ConfiguratorSnapshot['motorTest']['status']): StatusTone {
  switch (status) {
    case 'succeeded':
      return 'success'
    case 'failed':
      return 'danger'
    case 'requested':
    case 'running':
      return 'warning'
    default:
      return 'neutral'
  }
}

export function toneForParameterDraftStatus(status: ParameterDraftStatus): StatusTone {
  switch (status) {
    case 'staged':
      return 'warning'
    case 'invalid':
      return 'danger'
    default:
      return 'neutral'
  }
}

export function toneForScopedDraftReview(stagedCount: number, invalidCount: number): StatusTone {
  if (invalidCount > 0) {
    return 'danger'
  }
  if (stagedCount > 0) {
    return 'warning'
  }
  return 'success'
}

export function toneForPresetApplicability(status: 'ready' | 'caution' | 'blocked'): StatusTone {
  switch (status) {
    case 'blocked':
      return 'danger'
    case 'caution':
      return 'warning'
    default:
      return 'success'
  }
}
