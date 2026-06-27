import { assetUrl } from './asset-url'

export type AccelerometerPoseId = 'level' | 'left' | 'right' | 'nose-down' | 'nose-up' | 'back'

type PoseValidationTone = 'waiting' | 'ready' | 'adjust' | 'mismatch'

interface AccelerometerPoseGuideProps {
  currentPose?: AccelerometerPoseId
  compact?: boolean
  testId?: string
  rollDeg?: number
  pitchDeg?: number
  attitudeVerified?: boolean
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

const POSE_TARGETS: Record<AccelerometerPoseId, { rollDeg: number; pitchDeg: number }> = {
  level: { rollDeg: 0, pitchDeg: 0 },
  left: { rollDeg: -90, pitchDeg: 0 },
  right: { rollDeg: 90, pitchDeg: 0 },
  'nose-down': { rollDeg: 0, pitchDeg: -90 },
  'nose-up': { rollDeg: 0, pitchDeg: 90 },
  back: { rollDeg: 180, pitchDeg: 0 }
}

function normalizeSignedDegrees(value: number): number {
  let normalized = value % 360
  if (normalized > 180) {
    normalized -= 360
  } else if (normalized < -180) {
    normalized += 360
  }
  return normalized
}

function angleDistanceDegrees(current: number, target: number): number {
  return Math.abs(normalizeSignedDegrees(current - target))
}

function poseErrorDegrees(poseId: AccelerometerPoseId, rollDeg: number, pitchDeg: number): number {
  const target = POSE_TARGETS[poseId]
  return Math.hypot(angleDistanceDegrees(rollDeg, target.rollDeg), angleDistanceDegrees(pitchDeg, target.pitchDeg))
}

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

function validationStateForPose(
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

  if (currentError <= 25) {
    return {
      tone: 'ready',
      label: 'Pose aligned',
      detail: 'This posture looks good. Hold the frame still and confirm this step.'
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

export function AccelerometerPoseGuide({
  currentPose = 'level',
  compact = false,
  testId,
  rollDeg,
  pitchDeg,
  attitudeVerified
}: AccelerometerPoseGuideProps) {
  const current = POSES.find((pose) => pose.id === currentPose) ?? POSES[0]
  const validation = validationStateForPose(current.id, rollDeg, pitchDeg, attitudeVerified)

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
