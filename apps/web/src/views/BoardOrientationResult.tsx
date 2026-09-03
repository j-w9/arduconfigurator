import type { ReactElement } from 'react'
import { StatusBadge, buttonStyle } from '@arduconfig/ui-kit'

import {
  findRotation,
  orientationRecommendation,
  type OrientationSample
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
 *
 * No measurement numbers. The gravity vectors, residual and runner-up are what
 * the detection reasons over, not something an operator can act on -- printing
 * them turned a verdict and a button into a page of telemetry. A pose that had
 * to be discarded is likewise the detection's problem, not theirs; it either
 * reached an answer or it did not.
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
      <p className="calibration-card__blocked" data-testid="board-orientation-problem">
        {recommendation.reason}
      </p>
    )
  }

  const { best } = recommendation

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
    </div>
  )
}
