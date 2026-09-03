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

  const detail = recommendation.detection

  return (
    <div
      className="scoped-review-card scoped-review-card--compact board-orientation-result"
      data-testid="board-orientation-result"
    >
      <div className="switch-exercise-card__header">
        <div>
          <strong>Board orientation looks wrong</strong>
          <p>
            Measures as <strong>{best.rotation.name.replace('ROTATION_', '')}</strong>, but
            AHRS_ORIENTATION is {current ? current.name.replace('ROTATION_', '') : currentOrientation}.
          </p>
        </div>
        <StatusBadge tone="warning">differs</StatusBadge>
      </div>

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
      <p className="bf-note">Applies on the next boot; re-level after. Rotates the compass too.</p>

      {/* Everything needed to argue with the result, collapsed. The operator
          needs a verdict and a button; whoever is diagnosing a surprising
          answer needs the vectors, and neither should crowd out the other. */}
      <details className="motor-pole-reference" data-testid="board-orientation-detail">
        <summary>How this was measured</summary>
        <p className="bf-note">
          Agrees with the poses to {best.residualDeg.toFixed(1)}°
          {closeCall
            ? `; next closest ${closeCall.rotation.name.replace('ROTATION_', '')} at ${closeCall.residualDeg.toFixed(1)}°`
            : ''}
          .
        </p>
        {samples.map((sample) => (
          <p className="bf-note" key={sample.pose} data-testid={`board-orientation-sample-${sample.pose}`}>
            {sample.pose}: <code>{formatVector(sample.accel)}</code>
            {detail.ignoredPoses?.includes(sample.pose) ? ' — ignored, recorded in the wrong position' : null}
          </p>
        ))}
      </details>
    </div>
  )
}
