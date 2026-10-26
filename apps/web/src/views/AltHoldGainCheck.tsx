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
  canStage: boolean
  onStage: () => void
}

export function AltHoldGainCheckView({ check, pParamId, iParamId, hover, canStage, onStage }: AltHoldGainCheckViewProps): ReactElement {
  const alreadyThere = Math.abs(check.pRatio - 1) < 0.02 && Math.abs(check.iRatio - 1) < 0.02
  return (
    <div className="althold-gain-check" data-testid="althold-gain-check" data-tone={check.tone}>
      <div className="althold-gain-check__head">
        <StatusBadge tone={check.tone}>{check.tone === 'success' ? 'ok' : check.tone === 'warning' ? 'check' : 'too hot'}</StatusBadge>
        <span data-testid="althold-gain-verdict">{check.verdict}</span>
      </div>
      <p className="althold-gain-check__text">
        ArduPilot&apos;s rule for hover throttle {hover.toFixed(3)}: <code>{pParamId}</code> {check.recommendedP},{' '}
        <code>{iParamId}</code> {check.recommendedI}. The same gain does more on a quad that hovers at low throttle,
        so the gains follow the hover value.
      </p>
      {check.notes.map((note) => (
        <p key={note} className="althold-gain-check__text" data-testid="althold-gain-note">
          {note}
        </p>
      ))}
      {alreadyThere ? null : (
        <button type="button" className="althold-gain-check__stage" style={buttonStyle()} disabled={!canStage} data-testid="althold-gain-stage" onClick={onStage}>
          Stage {pParamId} {check.recommendedP} and {iParamId} {check.recommendedI}
        </button>
      )}
    </div>
  )
}
