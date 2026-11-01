// Autotune step body, second half: the one parameter the wiki suggests after
// a good tune, ATC_THR_MIX_MAX 0.9 (default 0.5), so AltHold favours attitude
// over throttle when wind catches the props after fast flight. Optional, so
// it is a card, not a criterion.

import type { ReactElement } from 'react'
import type { ConfiguratorSnapshot } from '@arduconfig/ardupilot-core'
import { StatusBadge, buttonStyle } from '@arduconfig/ui-kit'

import { readParameterValue } from '../selectors/parameter-read'

export const THR_MIX_MAX_AFTER_TUNE = 0.9

export interface AutotuneFinishCardProps {
  snapshot: ConfiguratorSnapshot
  canApplyDraftParameters: boolean
  busyAction: string | undefined
  editedValues: Record<string, string>
  setDraft: (paramId: string, value: string) => void
}

export function AutotuneFinishCard({ snapshot, canApplyDraftParameters, busyAction, editedValues, setDraft }: AutotuneFinishCardProps): ReactElement | null {
  const current = readParameterValue(snapshot, 'ATC_THR_MIX_MAX')
  if (current === undefined) return null
  const raised = current >= THR_MIX_MAX_AFTER_TUNE - 1e-6
  const staged = editedValues.ATC_THR_MIX_MAX !== undefined
  return (
    <article className="calibration-card" data-testid="autotune-finish-card">
      <div className="calibration-card__header">
        <strong>After the tune</strong>
        <StatusBadge tone={raised ? 'success' : staged ? 'warning' : 'neutral'}>{raised ? 'set' : staged ? 'staged' : 'optional'}</StatusBadge>
      </div>
      <p>
        With a good tune, ATC_THR_MIX_MAX can go from {current} to {THR_MIX_MAX_AFTER_TUNE}: AltHold then holds attitude over throttle when wind
        catches the props after fast flight.
      </p>
      {!raised ? (
        <button
          type="button"
          style={buttonStyle('secondary')}
          data-testid="autotune-finish-stage"
          disabled={!canApplyDraftParameters || busyAction !== undefined || staged}
          onClick={() => setDraft('ATC_THR_MIX_MAX', String(THR_MIX_MAX_AFTER_TUNE))}
        >
          {staged ? 'Staged — apply to write it' : `Stage ATC_THR_MIX_MAX ${THR_MIX_MAX_AFTER_TUNE}`}
        </button>
      ) : null}
    </article>
  )
}
