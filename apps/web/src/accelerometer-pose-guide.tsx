import { useEffect, useRef } from 'react'

import {
  ACCELEROMETER_POSE_ALIGNED_DEG,
  normalizeSignedDegrees,
  poseErrorDegrees,
  type AccelerometerPoseId
} from '@arduconfig/ardupilot-core'

import { assetUrl } from './asset-url'

// Pose geometry (targets, gravity projection, poseErrorDegrees, the acceptance
// window) now lives in @arduconfig/ardupilot-core so the runtime's auto-confirm
// and this guide agree on what "aligned" means. A second copy here would let
// the picture say "aligned" while the capture disagreed — on a calibration
// that is a silently bad result rather than a visible bug.
export type { AccelerometerPoseId }
export { poseErrorDegrees }

type PoseValidationTone = 'waiting' | 'ready' | 'adjust' | 'mismatch'

interface AccelerometerPoseGuideProps {
  currentPose?: AccelerometerPoseId
  compact?: boolean
  testId?: string
  rollDeg?: number
  pitchDeg?: number
  attitudeVerified?: boolean
  /**
   * Called once the card has been green continuously for `holdMs`.
   *
   * The caller advances the calibration; this component only reports that the
   * operator has held the posture, which is the thing they can actually see.
   */
  onHeldAligned?: (pose: AccelerometerPoseId) => void
  /** How long the card must stay green. */
  holdMs?: number
}

const POSES: Array<{
  id: AccelerometerPoseId
  title: string
  instruction: string
  imageSrc: string
}> = [
  { id: 'level', title: 'Level', instruction: 'Set the vehicle level on a stable surface.', imageSrc: assetUrl('accel-poses/VehicleDown.png') },
  { id: 'left', title: 'Left Side', instruction: 'Rest the vehicle on its left side.', imageSrc: assetUrl('accel-poses/VehicleLeft.png') },
  { id: 'right', title: 'Right Side', instruction: 'Rest the vehicle on its right side.', imageSrc: assetUrl('accel-poses/VehicleRight.png') },
  { id: 'nose-down', title: 'Nose Down', instruction: 'Tilt the nose straight down.', imageSrc: assetUrl('accel-poses/VehicleNoseDown.png') },
  { id: 'nose-up', title: 'Nose Up', instruction: 'Tilt the nose straight up.', imageSrc: assetUrl('accel-poses/VehicleTailDown.png') },
  { id: 'back', title: 'Back', instruction: 'Flip the vehicle onto its back.', imageSrc: assetUrl('accel-poses/VehicleUpsideDown.png') }
]

function adjustmentHintForPose(poseId: AccelerometerPoseId): string {
  switch (poseId) {
    case 'level':
      return 'Bring the frame closer to level and keep it still.'
    case 'left':
      return 'Rotate farther onto the left side and keep pitch closer to level.'
    case 'right':
      return 'Rotate farther onto the right side and keep pitch closer to level.'
    case 'nose-down':
      return 'Tilt the nose farther down and keep roll closer to level.'
    case 'nose-up':
      return 'Tilt the nose farther up and keep roll closer to level.'
    case 'back':
      return 'Flip the frame farther onto its back and keep it still.'
    default:
      return 'Adjust the frame until it matches the requested posture.'
  }
}

export function validationStateForPose(
  currentPose: AccelerometerPoseId,
  rollDeg: number | undefined,
  pitchDeg: number | undefined,
  attitudeVerified: boolean | undefined
): {
  tone: PoseValidationTone
  label: string
  detail: string
} {
  if (!attitudeVerified || rollDeg === undefined || pitchDeg === undefined || Number.isNaN(rollDeg) || Number.isNaN(pitchDeg)) {
    return {
      tone: 'waiting',
      label: 'Waiting for attitude',
      detail: 'Live roll and pitch are not available yet, so posture alignment cannot be checked.'
    }
  }

  const normalizedRoll = normalizeSignedDegrees(rollDeg)
  const normalizedPitch = normalizeSignedDegrees(pitchDeg)
  const currentError = poseErrorDegrees(currentPose, normalizedRoll, normalizedPitch)
  const bestPose = POSES.reduce((best, pose) => {
    const error = poseErrorDegrees(pose.id, normalizedRoll, normalizedPitch)
    return error < best.error ? { pose, error } : best
  }, { pose: POSES[0], error: poseErrorDegrees(POSES[0].id, normalizedRoll, normalizedPitch) })

  // Acceptance window for "pose aligned" — shared with the runtime's
  // auto-confirm (ACCELEROMETER_POSE_ALIGNED_DEG).
  if (currentError <= ACCELEROMETER_POSE_ALIGNED_DEG) {
    return {
      tone: 'ready',
      label: 'Pose aligned',
      // Deliberately does NOT promise the app will record it. Auto-confirm is
      // reported not to fire on hardware even with this reading "aligned", and
      // until that is understood on a bench this copy must not tell an operator
      // to wait for something that may never happen. The accept button is
      // right there; describing it is honest either way.
      detail: 'This posture looks good. Hold the frame still, then accept it.'
    }
  }

  // Only call it the WRONG pose when a DIFFERENT pose is clearly closer — a wide
  // margin so a partially-tilted frame reads as "keep adjusting" rather than
  // bouncing to "wrong pose" (poses are 90° apart; the slop near a target and
  // around ±90° gimbal regions is generous).
  if (bestPose.pose.id !== currentPose && bestPose.error + 30 < currentError) {
    return {
      tone: 'mismatch',
      label: 'Wrong pose',
      detail: `This still looks closer to ${bestPose.pose.title.toLowerCase()}. ${adjustmentHintForPose(currentPose)}`
    }
  }

  return {
    tone: 'adjust',
    label: 'Adjust posture',
    detail: adjustmentHintForPose(currentPose)
  }
}

/** How long the card must read "aligned" before the step advances itself. */
const DEFAULT_POSE_HOLD_MS = 1500

export function AccelerometerPoseGuide({
  currentPose = 'level',
  compact = false,
  testId,
  rollDeg,
  pitchDeg,
  attitudeVerified,
  onHeldAligned,
  holdMs = DEFAULT_POSE_HOLD_MS
}: AccelerometerPoseGuideProps) {
  const current = POSES.find((pose) => pose.id === currentPose) ?? POSES[0]
  const validation = validationStateForPose(current.id, rollDeg, pitchDeg, attitudeVerified)

  /*
   * Auto-advance, driven by the SAME state that paints this card green.
   *
   * The runtime had its own auto-confirm keyed on
   * ACCELEROMETER_POSE_ORDER[stepIndex], while this card derives the pose by
   * reading the vehicle's prompt text. Two sources of truth for "which pose are
   * we on", so the card could sit green against one pose while the runtime
   * compared against another and never confirmed — which is exactly what was
   * reported: aligned on screen, never records.
   *
   * Keying the timer off `validation.tone` removes the divergence by
   * construction: it cannot run unless the operator is looking at green, and it
   * cannot keep running once they are not.
   */
  const aligned = validation.tone === 'ready'
  const heldSinceRef = useRef<number | undefined>(undefined)
  // Held in a ref so a re-render from unrelated telemetry cannot re-arm a timer
  // that has already fired for this pose.
  const firedForRef = useRef<string | undefined>(undefined)

  useEffect(() => {
    if (!onHeldAligned) return
    if (!aligned) {
      heldSinceRef.current = undefined
      return
    }
    if (firedForRef.current === current.id) return
    if (heldSinceRef.current === undefined) {
      heldSinceRef.current = Date.now()
    }
    const elapsed = Date.now() - heldSinceRef.current
    if (elapsed >= holdMs) {
      firedForRef.current = current.id
      heldSinceRef.current = undefined
      onHeldAligned(current.id)
      return
    }
    // Attitude arrives at 40 Hz, but do not depend on it: a link that goes
    // quiet mid-hold should still complete rather than stall forever.
    const timer = setTimeout(() => {
      heldSinceRef.current = heldSinceRef.current ?? Date.now()
    }, holdMs - elapsed)
    return () => clearTimeout(timer)
  }, [aligned, current.id, holdMs, onHeldAligned, rollDeg, pitchDeg])

  // A new pose re-arms it.
  useEffect(() => {
    firedForRef.current = undefined
    heldSinceRef.current = undefined
  }, [current.id])

  return (
    <div
      className={`accelerometer-pose-guide${compact ? ' accelerometer-pose-guide--compact' : ''} accelerometer-pose-guide--${validation.tone}`}
      data-testid={testId}
    >
      <div className={`accelerometer-pose-guide__hero accelerometer-pose-guide__hero--${validation.tone}`}>
        <div className="accelerometer-pose-guide__header">
          <strong>Current Posture</strong>
          <span>{current.title}</span>
        </div>
        <div className={`accelerometer-pose-guide__validation accelerometer-pose-guide__validation--${validation.tone}`}>
          <strong>{validation.label}</strong>
          <span>{validation.detail}</span>
        </div>
        <div className="accelerometer-pose-guide__hero-visual">
          <img src={current.imageSrc} alt={`${current.title} accelerometer calibration pose`} />
        </div>
        <p>{current.instruction}</p>
      </div>
    </div>
  )
}
