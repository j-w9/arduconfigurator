// Motor-test request-builder state. Three useState hooks that together
// form the per-spin request payload (output channel + throttle percent +
// duration in seconds):
//
//   motorTestOutput            channel number 1..N, or ALL_MOTOR_TEST_OUTPUT
//                              sentinel (0) for the run-all-motors path,
//                              or undefined when no selection is staged
//   motorTestThrottlePercent   0..100, default 7 (safe-bench starting throttle)
//   motorTestDurationSeconds   1..N, default 5
//
// Defaults: every motor in order, 5 s -- the non-expert ceiling. The first
// thing a bench test checks is "do they all spin, in the right order", and 3 s
// was too short to feel each motor's direction by hand.

import { useState, type Dispatch, type SetStateAction } from 'react'

import { ALL_MOTOR_TEST_OUTPUT } from '../motor-test-helpers'

export interface UseMotorTestConfigResult {
  motorTestOutput: number | undefined
  setMotorTestOutput: Dispatch<SetStateAction<number | undefined>>
  motorTestThrottlePercent: number
  setMotorTestThrottlePercent: Dispatch<SetStateAction<number>>
  motorTestDurationSeconds: number
  setMotorTestDurationSeconds: Dispatch<SetStateAction<number>>
}

export function useMotorTestConfig(): UseMotorTestConfigResult {
  const [motorTestOutput, setMotorTestOutput] = useState<number | undefined>(ALL_MOTOR_TEST_OUTPUT)
  const [motorTestThrottlePercent, setMotorTestThrottlePercent] = useState(7)
  const [motorTestDurationSeconds, setMotorTestDurationSeconds] = useState(5)

  return {
    motorTestOutput,
    setMotorTestOutput,
    motorTestThrottlePercent,
    setMotorTestThrottlePercent,
    motorTestDurationSeconds,
    setMotorTestDurationSeconds
  }
}
