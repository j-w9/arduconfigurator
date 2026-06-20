// RC mapping / calibration / range exercise state machines, extracted
// from App.tsx as another decomposition slice. Four useState hooks the
// Receiver / Setup-RC views consume end-to-end:
//
//   rcRangeExercise          — hold-each-stick-extreme exercise
//   rcMappingSession         — auto-detect which channel each axis lives on
//   rcMappingAutoCaptureState — hold-to-lock progress for the mapping flow
//   rcCalibrationSession     — full per-axis min/max/trim capture
//
// Behavior-neutral lift — identical setters, identical initial states from
// the existing createIdle* factories in setup-exercise-helpers.

import { useState, type Dispatch, type SetStateAction } from 'react'

import type {
  RcCalibrationSessionState,
  RcMappingAutoCaptureState,
  RcMappingSessionState
} from '../app-types'
import {
  createIdleRcCalibrationSessionState,
  createIdleRcMappingSessionState
} from '../setup-exercise-helpers'
import {
  type RcRangeExerciseState,
  createIdleRcRangeExerciseState
} from '@arduconfig/ardupilot-core'

export interface UseRcExercisesResult {
  rcRangeExercise: RcRangeExerciseState
  setRcRangeExercise: Dispatch<SetStateAction<RcRangeExerciseState>>
  rcMappingSession: RcMappingSessionState
  setRcMappingSession: Dispatch<SetStateAction<RcMappingSessionState>>
  rcMappingAutoCaptureState: RcMappingAutoCaptureState
  setRcMappingAutoCaptureState: Dispatch<SetStateAction<RcMappingAutoCaptureState>>
  rcCalibrationSession: RcCalibrationSessionState
  setRcCalibrationSession: Dispatch<SetStateAction<RcCalibrationSessionState>>
}

export function useRcExercises(): UseRcExercisesResult {
  const [rcRangeExercise, setRcRangeExercise] = useState<RcRangeExerciseState>(createIdleRcRangeExerciseState)
  const [rcMappingSession, setRcMappingSession] = useState<RcMappingSessionState>(createIdleRcMappingSessionState)
  const [rcMappingAutoCaptureState, setRcMappingAutoCaptureState] = useState<RcMappingAutoCaptureState>({ accumulatedMs: 0 })
  const [rcCalibrationSession, setRcCalibrationSession] = useState<RcCalibrationSessionState>(createIdleRcCalibrationSessionState)

  return {
    rcRangeExercise,
    setRcRangeExercise,
    rcMappingSession,
    setRcMappingSession,
    rcMappingAutoCaptureState,
    setRcMappingAutoCaptureState,
    rcCalibrationSession,
    setRcCalibrationSession
  }
}
