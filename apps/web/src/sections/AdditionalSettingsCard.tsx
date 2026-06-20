// Additional-settings review card — the compact "metadata-backed knobs that
// extend this view" panel used by the guided Setup flow (advanced setup
// settings) and the Power view (additional battery settings).
//
// Extracted from a renderAdditionalSettingsCard closure in App.tsx as part of
// the App.tsx decomposition. Purely presentational: it renders the grouped
// metadata fields (via the injected renderField callback, which stays in
// App.tsx because it depends on the live draft state), a staged/invalid
// status badge, and Apply / Discard controls. The apply/discard intent is
// passed in pre-bound as onApply / onDiscard so the card carries no
// app-internal draft wiring. Behavior-preserving.

import type { ReactElement, ReactNode } from 'react'

import { StatusBadge, buttonStyle } from '@arduconfig/ui-kit'
import type { ParameterDraftEntry, ParameterState } from '@arduconfig/ardupilot-core'

import { toneForScopedDraftReview } from '../tone-helpers'
import type { AdditionalSettingsGroup } from '../view-models/peripherals'

export interface AdditionalSettingsCardProps {
  title: string
  description: string
  groups: AdditionalSettingsGroup[]
  draftEntries: ParameterDraftEntry[]
  stagedDrafts: ParameterDraftEntry[]
  invalidDrafts: ParameterDraftEntry[]
  applyActionId: string
  applyLabel: string
  busyAction: string | undefined
  canApply: boolean
  onApply: () => void
  onDiscard: () => void
  renderField: (parameter: ParameterState) => ReactNode
}

export function AdditionalSettingsCard({
  title,
  description,
  groups,
  draftEntries,
  stagedDrafts,
  invalidDrafts,
  applyActionId,
  applyLabel,
  busyAction,
  canApply,
  onApply,
  onDiscard,
  renderField
}: AdditionalSettingsCardProps): ReactElement | null {
  if (groups.length === 0) {
    return null
  }

  return (
    <div className="scoped-review-card scoped-review-card--compact">
      <div className="switch-exercise-card__header">
        <div>
          <strong>{title}</strong>
          <p>{description}</p>
        </div>
        <StatusBadge tone={toneForScopedDraftReview(stagedDrafts.length, invalidDrafts.length)}>
          {invalidDrafts.length > 0 ? `${invalidDrafts.length} invalid` : stagedDrafts.length > 0 ? `${stagedDrafts.length} staged` : 'in sync'}
        </StatusBadge>
      </div>

      {groups.map((group) => (
        <div key={group.categoryId} className="metadata-settings-section">
          <div className="metadata-settings-section__header">
            <strong>{group.categoryLabel}</strong>
            <p>{group.categoryDescription}</p>
          </div>
          <div className="scoped-editor-grid">{group.parameters.map((parameter) => renderField(parameter))}</div>
        </div>
      ))}

      <div className="switch-exercise-controls">
        <button
          style={buttonStyle('primary')}
          onClick={onApply}
          disabled={busyAction !== undefined || stagedDrafts.length === 0 || invalidDrafts.length > 0 || !canApply}
        >
          {busyAction === applyActionId ? 'Applying…' : `${applyLabel} (${stagedDrafts.length})`}
        </button>
        <button
          style={buttonStyle()}
          onClick={onDiscard}
          disabled={busyAction !== undefined || draftEntries.length === 0}
        >
          Discard Additional Changes
        </button>
      </div>
    </div>
  )
}
