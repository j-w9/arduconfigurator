// The altitude controller's accel gains against ArduPilot's rule for this
// hover throttle (view-models/althold-gain-check.ts). Presentational: the
// parent computes the check and owns staging.

import type { ReactElement } from 'react'
import { StatusBadge, buttonStyle } from '@arduconfig/ui-kit'

import type { AltHoldGainCheck } from '../view-models/althold-gain-check'

export interface AltHoldGainCheckViewProps {
  check: AltHoldGainCheck
  pParamId: string
  iParamId: string
  hover: number
  /** The gains in use (live or drafted), as shown. */
  current: { p: number; i: number }
  canStage: boolean
  onStage: () => void
}

export function AltHoldGainCheckView({ check, pParamId, iParamId, hover, current, canStage, onStage }: AltHoldGainCheckViewProps): ReactElement {
  const alreadyThere = Math.abs(check.pRatio - 1) < 0.02 && Math.abs(check.iRatio - 1) < 0.02
  return (
    <div className="althold-gain-check" data-testid="althold-gain-check" data-tone={check.tone}>
      <div className="althold-gain-check__head">
        <StatusBadge tone={check.tone}>{check.tone === 'success' ? 'ok' : check.tone === 'warning' ? 'check' : 'too hot'}</StatusBadge>
        <span data-testid="althold-gain-verdict">{check.verdict}</span>
      </div>
      <p className="althold-gain-check__text" data-testid="althold-gain-suggested">
        Suggested for hover {hover.toFixed(3)}: <code>{pParamId}</code> {check.recommendedP}, <code>{iParamId}</code>{' '}
        {check.recommendedI}.{alreadyThere ? null : <> You have {current.p} and {current.i}.</>}
      </p>
      {check.notes.map((note) => (
        <p key={note} className="althold-gain-check__text" data-testid="althold-gain-note">
          {note}
        </p>
      ))}
      {alreadyThere ? null : (
        <button type="button" className="althold-gain-check__stage" style={buttonStyle()} disabled={!canStage} data-testid="althold-gain-stage" onClick={onStage}>
          Use suggested gains
        </button>
      )}
    </div>
  )
}
