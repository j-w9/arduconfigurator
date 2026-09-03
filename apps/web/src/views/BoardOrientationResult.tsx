import type { ReactElement } from 'react'
import { StatusBadge, buttonStyle } from '@arduconfig/ui-kit'

import {
  findRotation,
  orientationRecommendation,
  type OrientationSample,
  type Vector3
} from '../view-models/board-orientation-detect'

export interface BoardOrientationResultProps {
  /** Poses captured during the accelerometer calibration. */
  samples: readonly OrientationSample[]
  /** Live AHRS_ORIENTATION, or undefined while parameters are still syncing. */
  currentOrientation: number | undefined
  /** Stage the proposed value as a draft. This never writes. */
  onStage: (value: number) => void
  disabled?: boolean
}

function formatVector(v: Vector3): string {
  return `x ${v[0].toFixed(2)}  y ${v[1].toFixed(2)}  z ${v[2].toFixed(2)}`
}

/**
 * What the accelerometer calibration's own poses say about how the board is
 * mounted.
 *
 * Deliberately not a configuration surface of its own. The calibration already
 * has the operator hold six known attitudes, so the measurement is a by-product
 * of a job they were doing anyway -- a separate card asking them to hold level
 * and nose-down again was asking twice for the same thing.
 *
 * It renders nothing until the calibration has produced two usable poses, and
 * nothing when the answer matches what is already set. The only case worth an
 * operator's attention is a mounting that disagrees with AHRS_ORIENTATION.
 */
export function BoardOrientationResult({
  samples,
  currentOrientation,
  onStage,
  disabled = false
}: BoardOrientationResultProps): ReactElement | null {
  const recommendation = orientationRecommendation(samples, currentOrientation)
  const current = findRotation(currentOrientation ?? -1)

  if (recommendation.kind === 'silent') {
    return null
  }

  if (recommendation.kind === 'unusable') {
    return (
      <div data-testid="board-orientation-problem">
        <p className="calibration-card__blocked">{recommendation.reason}</p>
        {/* What it actually measured. Without this the message is a dead end:
            nobody can tell a crooked pose from a mislabelled one. */}
        {recommendation.samples.map((sample) => (
          <p className="bf-note" key={sample.pose} data-testid={`board-orientation-sample-${sample.pose}`}>
            {sample.pose}: <code>{formatVector(sample.accel)}</code>
          </p>
        ))}
      </div>
    )
  }

  const { best, closeCall } = recommendation

  return (
    <div className="scoped-review-card scoped-review-card--compact" data-testid="board-orientation-result">
      <div className="switch-exercise-card__header">
        <div>
          <strong>Board orientation looks wrong</strong>
          <p>
            Those poses measure as{' '}
            <strong>{best.rotation.name.replace('ROTATION_', '')}</strong> (
            {best.residualDeg.toFixed(1)}° off), but AHRS_ORIENTATION is{' '}
            {current ? current.name.replace('ROTATION_', '') : currentOrientation}.
          </p>
        </div>
        <StatusBadge tone="warning">differs</StatusBadge>
      </div>

      {samples.map((sample) => (
        <p className="bf-note" key={sample.pose} data-testid={`board-orientation-sample-${sample.pose}`}>
          {sample.pose}: <code>{formatVector(sample.accel)}</code>
          {recommendation.detection.ignoredPoses?.includes(sample.pose) ? ' — ignored' : null}
        </p>
      ))}

      {/* Naming what was thrown out matters: the answer stands on the rest, but
          an operator should know a posture they held did not count. */}
      {recommendation.detection.ignoredPoses?.length ? (
        <p className="bf-note" data-testid="board-orientation-ignored">
          Ignored {recommendation.detection.ignoredPoses.join(', ')} — recorded while the vehicle was
          somewhere other than that step asked for, usually a step confirmed before the frame was moved.
          The rest agree with each other.
        </p>
      ) : null}

      {/* A near-tie is worth saying out loud: the fixed rotations are 45° apart
          in yaw, so a close runner-up means a pose was probably held crooked
          rather than that the answer is finely balanced. */}
      {closeCall ? (
        <p className="bf-note" data-testid="board-orientation-close-call">
          Next closest is {closeCall.rotation.name.replace('ROTATION_', '')} at{' '}
          {closeCall.residualDeg.toFixed(1)}°. Re-run the calibration holding the poses squarer
          if that looks more like your mounting.
        </p>
      ) : null}

      <p className="bf-note">
        Staging this replaces AHRS_ORIENTATION {currentOrientation}. It takes effect on the next boot,
        the vehicle needs re-levelling afterwards, and it rotates the compass as well as the IMU — so
        apply it only if the measurement matches how the board really sits.
      </p>
      <div className="button-row">
        <button
          type="button"
          style={buttonStyle('primary')}
          data-testid="board-orientation-stage"
          disabled={disabled}
          onClick={() => onStage(best.rotation.value)}
        >
          Stage AHRS_ORIENTATION = {best.rotation.value}
        </button>
      </div>
    </div>
  )
}
