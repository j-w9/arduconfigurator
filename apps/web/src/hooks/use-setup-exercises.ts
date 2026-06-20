// Setup-tab guided-exercise state machines that aren't RC-side (those
// live in use-rc-exercises) and aren't motor-side (use-motor-management).
// Three useState hooks the Setup view drives end-to-end:
//
//   orientationExercise   six-pose orientation check (board mounting axes)
//   modeSwitchActivity    recent flight-mode-switch transitions observed
//                         on the wire (undefined until the first move)
//   modeSwitchExercise    operator-driven exercise that confirms each mode
//                         slot maps to the configured FLTMODEn parameter
//
// Behavior-neutral lift — identical setters, identical idle factories
// from setup-exercise-helpers, identical `undefined` default for the
// observation-driven modeSwitchActivity.

import { useState, type Dispatch, type SetStateAction } from 'react'

import type {
  ModeSwitchActivity,
  ModeSwitchExerciseState,
  OrientationExerciseState
} from '../app-types'
import { createIdleOrientationExerciseState } from '../setup-exercise-helpers'
import { createIdleModeSwitchExerciseState } from '@arduconfig/ardupilot-core'

export interface UseSetupExercisesResult {
  orientationExercise: OrientationExerciseState
  setOrientationExercise: Dispatch<SetStateAction<OrientationExerciseState>>
  modeSwitchActivity: ModeSwitchActivity | undefined
  setModeSwitchActivity: Dispatch<SetStateAction<ModeSwitchActivity | undefined>>
  modeSwitchExercise: ModeSwitchExerciseState
  setModeSwitchExercise: Dispatch<SetStateAction<ModeSwitchExerciseState>>
}

export function useSetupExercises(): UseSetupExercisesResult {
  const [orientationExercise, setOrientationExercise] = useState<OrientationExerciseState>(createIdleOrientationExerciseState)
  const [modeSwitchActivity, setModeSwitchActivity] = useState<ModeSwitchActivity | undefined>()
  const [modeSwitchExercise, setModeSwitchExercise] = useState<ModeSwitchExerciseState>(createIdleModeSwitchExerciseState)

  return {
    orientationExercise,
    setOrientationExercise,
    modeSwitchActivity,
    setModeSwitchActivity,
    modeSwitchExercise,
    setModeSwitchExercise
  }
}
