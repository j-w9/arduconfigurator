// Motor management state, extracted from App.tsx as another decomposition
// slice. Six useState hooks the Outputs / Motors views share for motor
// verification, reordering, and the Betaflight-style guided identify flow:
//
//   motorVerification           state machine for the direction-check
//                               sequencer (one motor at a time)
//   motorReorderDialogOpen      "Motor Output Reordering" lightbox open flag
//   motorReorderSelections      motor-number -> output-channel-number map the
//                               dialog stages as draft SERVOn_FUNCTION writes
//   guidedReorderActive         guided identify in progress (button -> done)
//   guidedReorderStep           index into the output sequence being spun
//   guidedReorderMapping        output-channel-number -> clicked-motor-number
//                               accumulator that inverts into selections at
//                               the end of identify
//
// Behavior-neutral lift — identical setters, same defaults. The Outputs
// dialog destructures these directly off the hook return.

import { useState, type Dispatch, type SetStateAction } from 'react'

import type { MotorVerificationState } from '../app-types'
import { createIdleMotorVerificationState } from '../setup-exercise-helpers'

export interface UseMotorManagementResult {
  motorVerification: MotorVerificationState
  setMotorVerification: Dispatch<SetStateAction<MotorVerificationState>>
  motorReorderDialogOpen: boolean
  setMotorReorderDialogOpen: Dispatch<SetStateAction<boolean>>
  motorReorderSelections: Record<string, string>
  setMotorReorderSelections: Dispatch<SetStateAction<Record<string, string>>>
  guidedReorderActive: boolean
  setGuidedReorderActive: Dispatch<SetStateAction<boolean>>
  guidedReorderStep: number
  setGuidedReorderStep: Dispatch<SetStateAction<number>>
  guidedReorderMapping: Record<string, number>
  setGuidedReorderMapping: Dispatch<SetStateAction<Record<string, number>>>
  /** Operator-paced identify: true between picking a position and the
   *  operator clicking Spin for the next output (no auto-spin — field
   *  feedback: the old auto-advance raced the FC's motor-test window). */
  guidedReorderAwaitingSpin: boolean
  setGuidedReorderAwaitingSpin: Dispatch<SetStateAction<boolean>>
  /** True once a guided identify sequence has finished this dialog
   *  session — gates the Stage button's primary emphasis and the
   *  "no changes needed" note. */
  guidedReorderCompleted: boolean
  setGuidedReorderCompleted: Dispatch<SetStateAction<boolean>>
}

export function useMotorManagement(): UseMotorManagementResult {
  const [motorVerification, setMotorVerification] = useState<MotorVerificationState>(createIdleMotorVerificationState)
  const [motorReorderDialogOpen, setMotorReorderDialogOpen] = useState(false)
  const [motorReorderSelections, setMotorReorderSelections] = useState<Record<string, string>>({})
  const [guidedReorderActive, setGuidedReorderActive] = useState(false)
  const [guidedReorderStep, setGuidedReorderStep] = useState(0)
  const [guidedReorderMapping, setGuidedReorderMapping] = useState<Record<string, number>>({})
  const [guidedReorderAwaitingSpin, setGuidedReorderAwaitingSpin] = useState(false)
  const [guidedReorderCompleted, setGuidedReorderCompleted] = useState(false)

  return {
    motorVerification,
    setMotorVerification,
    motorReorderDialogOpen,
    setMotorReorderDialogOpen,
    motorReorderSelections,
    setMotorReorderSelections,
    guidedReorderActive,
    setGuidedReorderActive,
    guidedReorderStep,
    setGuidedReorderStep,
    guidedReorderMapping,
    setGuidedReorderMapping,
    guidedReorderAwaitingSpin,
    setGuidedReorderAwaitingSpin,
    guidedReorderCompleted,
    setGuidedReorderCompleted
  }
}
