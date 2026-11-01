// Hover Throttle step body, second half: stage the vertical acceleration
// controller from the learned hover throttle (initial-tuning-flight.rst,
// "Test AltHold"). Drafts only; the operator writes them from the draft bar.

import type { ReactElement } from 'react'
import type { ConfiguratorSnapshot } from '@arduconfig/ardupilot-core'
import { StatusBadge, buttonStyle } from '@arduconfig/ui-kit'

import { readParameterValue } from '../selectors/parameter-read'
import { deriveThrottleControllerGains } from '../view-models/throttle-controller-from-hover'

export interface ThrottleControllerCardProps {
  snapshot: ConfiguratorSnapshot
  hoverThrottle: number | undefined
  canApplyDraftParameters: boolean
  busyAction: string | undefined
  editedValues: Record<string, string>
  setDraft: (paramId: string, value: string) => void
}

export function ThrottleControllerCard({
  snapshot,
  hoverThrottle,
  canApplyDraftParameters,
  busyAction,
  editedValues,
  setDraft
}: ThrottleControllerCardProps): ReactElement | null {
  const gains = hoverThrottle === undefined ? undefined : deriveThrottleControllerGains(hoverThrottle, (id) => readParameterValue(snapshot, id))
  if (!gains) {
    return null
  }
  const staged = editedValues[gains.pParamId] !== undefined || editedValues[gains.iParamId] !== undefined
  return (
    <article className="calibration-card" data-testid="throttle-controller-card">
      <div className="calibration-card__header">
        <strong>Throttle controller from the hover</strong>
        <StatusBadge tone={gains.matches ? 'success' : staged ? 'warning' : 'neutral'}>
          {gains.matches ? 'follows hover' : staged ? 'staged' : 'to set'}
        </StatusBadge>
      </div>
      <p>
        For a hover of {hoverThrottle?.toFixed(3)}: <code>{gains.pParamId}</code> {gains.targetP},{' '}
        <code>{gains.iParamId}</code> {gains.targetI}.
      </p>
      <div className="config-pills">
        <span data-tone={gains.matches ? 'success' : 'neutral'}>
          {gains.pParamId}: {gains.currentP ?? '—'}
        </span>
        <span data-tone={gains.matches ? 'success' : 'neutral'}>
          {gains.iParamId}: {gains.currentI ?? '—'}
        </span>
      </div>
      {!gains.matches ? (
        <button
          type="button"
          style={buttonStyle('primary')}
          data-testid="throttle-controller-stage"
          disabled={!canApplyDraftParameters || busyAction !== undefined || staged}
          onClick={() => {
            setDraft(gains.pParamId, String(gains.targetP))
            setDraft(gains.iParamId, String(gains.targetI))
          }}
        >
          {staged ? 'Staged — apply to write it' : 'Stage these gains'}
        </button>
      ) : null}
    </article>
  )
}
