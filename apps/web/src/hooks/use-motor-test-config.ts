// Motor-test request-builder state. Three useState hooks that together
// form the per-spin request payload (output channel + throttle percent +
// duration in seconds):
//
//   motorTestOutput            channel number 1..N, or ALL_MOTOR_TEST_OUTPUT
//                              sentinel (0) for the run-all-motors path,
//                              or undefined when no selection is staged
//   motorTestThrottlePercent   0..100, default 7 (safe-bench starting throttle)
//   motorTestDurationSeconds   1..N, default 1

import { useState, type Dispatch, type SetStateAction } from 'react'

export interface UseMotorTestConfigResult {
  motorTestOutput: number | undefined
  setMotorTestOutput: Dispatch<SetStateAction<number | undefined>>
  motorTestThrottlePercent: number
  setMotorTestThrottlePercent: Dispatch<SetStateAction<number>>
  motorTestDurationSeconds: number
  setMotorTestDurationSeconds: Dispatch<SetStateAction<number>>
}

export function useMotorTestConfig(): UseMotorTestConfigResult {
  const [motorTestOutput, setMotorTestOutput] = useState<number | undefined>()
  const [motorTestThrottlePercent, setMotorTestThrottlePercent] = useState(7)
  const [motorTestDurationSeconds, setMotorTestDurationSeconds] = useState(1)

  return {
    motorTestOutput,
    setMotorTestOutput,
    motorTestThrottlePercent,
    setMotorTestThrottlePercent,
    motorTestDurationSeconds,
    setMotorTestDurationSeconds
  }
}
