// Motor-verification summary — one IIFE summary string derived from the
// in-progress verification state.

import type { MotorVerificationState } from '../app-types'

export interface UseMotorVerificationDerivationsResult {
  motorVerificationSummary: string
}

/**
 * Derives the motorVerification summary string. The only input is the
 * in-progress verification state.
 */
export function useMotorVerificationDerivations(input: {
  motorVerification: MotorVerificationState
}): UseMotorVerificationDerivationsResult {
  const { motorVerification } = input

  const motorVerificationSummary = (() => {
    if (motorVerification.status === 'passed') {
      return 'Every mapped motor output was stepped through and operator-confirmed.'
    }
    if (motorVerification.status === 'failed') {
      return motorVerification.failureReason ?? 'Motor verification failed.'
    }
    if (motorVerification.status === 'running') {
      return motorVerification.currentOutputChannel === undefined
        ? 'Motor verification is awaiting the next output.'
        : `Spin OUT${motorVerification.currentOutputChannel}${motorVerification.currentMotorNumber !== undefined ? ` / M${motorVerification.currentMotorNumber}` : ''}, then confirm the correct motor and direction.`
    }
    return 'Use guarded single-output motor tests to verify motor order and direction before the first props-on flight.'
  })()

  return { motorVerificationSummary }
}
