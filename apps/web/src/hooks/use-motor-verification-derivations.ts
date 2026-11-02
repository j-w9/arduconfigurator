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
      return 'Every motor spun and you confirmed its order and direction.'
    }
    if (motorVerification.status === 'failed') {
      return motorVerification.failureReason ?? 'Motor verification failed.'
    }
    if (motorVerification.status === 'running') {
      return motorVerification.currentOutputChannel === undefined
        ? 'Pick the next output.'
        : `Spin OUT${motorVerification.currentOutputChannel}${motorVerification.currentMotorNumber !== undefined ? ` / M${motorVerification.currentMotorNumber}` : ''}, then confirm the correct motor and direction.`
    }
    return 'Spin each motor on its own to check order and direction. Props off.'
  })()

  return { motorVerificationSummary }
}
