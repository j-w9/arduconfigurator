// App-internal view/state types, extracted from App.tsx as part of its
// decomposition. These describe the setup-flow, RC/orientation/motor exercise
// state machines, and per-view descriptors the App component and its helpers
// share. Pure type declarations — no runtime code.

import type { ConfiguratorSnapshot, RcAxisId } from '@arduconfig/ardupilot-core'
import type { AppViewId } from '@arduconfig/param-metadata'

import type { StatusTone } from './status-tone'
import type { GuidedActionId } from './guided-action-labels'

// Mirror the canonical runtime union so this never drifts as new vehicle
// classes (Rover, Sub, …) are added to VehicleIdentity.
export type DetectedVehicle = NonNullable<ConfiguratorSnapshot['vehicle']>['vehicle']

export type SetupMode = 'overview' | 'wizard'
export type ModeSwitchExerciseStatus = 'idle' | 'running' | 'passed' | 'failed'
// servo-mapping is the position-control workflow that owns the Servos
// nav tab. It surfaces all SERVOn_FUNCTION channels the autopilot
// exposes (1-16 on a Pixhawk-class FC) with editable function
// dropdowns. motor-setup / direction-test / esc-protocol / peripherals
// / review are the legacy Motors-side cards.
export type OutputTaskId =
  | 'motor-setup'
  | 'direction-test'
  | 'esc-protocol'
  | 'servo-mapping'
  | 'peripherals'
  | 'relays'
  | 'review'

export interface AppViewDescriptor {
  id: AppViewId
  label: string
  description: string
  badge: string
  tone: StatusTone
}

export interface ModeSwitchActivity {
  previousSlot?: number
  currentSlot: number
  previousPwm?: number
  currentPwm: number
  changedAtMs: number
}

export interface ModeSwitchExerciseState {
  status: ModeSwitchExerciseStatus
  targetSlots: number[]
  visitedSlots: number[]
  currentTargetSlot?: number
  unexpectedSlots: number[]
  startedAtMs?: number
  completedAtMs?: number
  failureReason?: string
}

export type OrientationExerciseStatus = 'idle' | 'running' | 'passed' | 'failed'
export type OrientationExerciseStepId = 'level' | 'pitch-forward' | 'roll-right'
export type RcMappingStatus = 'idle' | 'running' | 'ready' | 'failed'
export type RcCalibrationStatus = 'idle' | 'capturing' | 'ready' | 'failed'
export type MotorVerificationStatus = 'idle' | 'running' | 'passed' | 'failed'

export interface OrientationExerciseState {
  status: OrientationExerciseStatus
  targetSteps: OrientationExerciseStepId[]
  completedSteps: OrientationExerciseStepId[]
  currentTargetStep?: OrientationExerciseStepId
  startedAtMs?: number
  completedAtMs?: number
  failureReason?: string
}

export interface RcCalibrationAxisCapture {
  axisId: RcAxisId
  label: string
  channelNumber: number
  observedMin?: number
  observedMax?: number
  trimPwm?: number
  lowObserved: boolean
  highObserved: boolean
  centeredObserved: boolean
}

/**
 * A non-axis RC switch channel (CH5/CH6) captured alongside the four control
 * axes during endpoint calibration. Switches have no centering/trim — the
 * operator just flicks them through their travel so RCn_MIN/MAX get real
 * endpoints. OPTIONAL: switches never gate calibration completion (a 4-channel
 * radio has no CH5/CH6); they're only staged when actually exercised.
 */
export interface RcSwitchCapture {
  channelNumber: number
  label: string
  observedMin?: number
  observedMax?: number
  lowObserved: boolean
  highObserved: boolean
}

export interface RcCalibrationSessionState {
  status: RcCalibrationStatus
  captures: Record<RcAxisId, RcCalibrationAxisCapture>
  /** CH5/CH6 switch endpoints, keyed by channel number. Optional add-on to the
   *  axis captures; see RcSwitchCapture. */
  switchCaptures: Record<number, RcSwitchCapture>
  startedAtMs?: number
  completedAtMs?: number
  failureReason?: string
}

export interface RcMappingAxisCapture {
  axisId: RcAxisId
  label: string
  detectedChannelNumber?: number
  deltaUs?: number
}

export interface RcMappingSessionState {
  status: RcMappingStatus
  baselineChannels: number[]
  captures: Record<RcAxisId, RcMappingAxisCapture>
  currentTargetAxis?: RcAxisId
  startedAtMs?: number
  completedAtMs?: number
  failureReason?: string
}

export interface RcMappingAutoCaptureState {
  axisId?: RcAxisId
  channelNumber?: number
  accumulatedMs: number
}

export interface MotorVerificationState {
  status: MotorVerificationStatus
  targetOutputs: number[]
  verifiedOutputs: number[]
  currentOutputChannel?: number
  currentMotorNumber?: number
  startedAtMs?: number
  completedAtMs?: number
  failureReason?: string
}


export interface SetupFlowCriterion {
  label: string
  met: boolean
}

export type SetupFlowSequenceState = 'locked' | 'current' | 'complete'

export interface SetupConfirmationRecord {
  signature: string
  confirmedAtMs: number
  outcome: SetupSectionOutcome
}

export type SetupSectionOutcome = 'complete' | 'not-applicable' | 'already-done' | 'deferred'

export interface SetupFlowActionDescriptor {
  kind:
    | 'guided'
    | 'cancel-guided'
    | 'scroll'
    | 'orientation-exercise'
    | 'motor-verification-start'
    | 'motor-test-current'
    | 'motor-verification-confirm'
    | 'motor-verification-reset'
    | 'mode-switch-exercise'
    | 'rc-range-exercise'
    | 'rc-mapping-exercise'
    | 'confirm-step'
    | 'clear-confirmation'
  label: string
  tone?: 'primary' | 'secondary'
  disabled?: boolean
  confirmationOutcome?: SetupSectionOutcome
  actionId?: GuidedActionId
  panelId?: string
  targetElementId?: string
  sectionId?: string
}

export interface SetupFlowSectionDescriptor {
  id: string
  title: string
  status: 'attention' | 'in-progress' | 'complete'
  sequenceState: SetupFlowSequenceState
  summary: string
  detail: string
  evidence: string[]
  criteria: SetupFlowCriterion[]
  criteriaMetCount: number
  panelId: string
  panelLabel: string
  actions: SetupFlowActionDescriptor[]
  confirmationOutcome?: SetupSectionOutcome
  blockingReason?: string
}

export interface SetupFlowFollowUpDescriptor {
  title: string
  tone: StatusTone
  text: string
  actions: SetupFlowActionDescriptor[]
}
