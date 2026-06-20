// AutotuneCopterSection — a curated ArduCopter AUTOTUNE surface rendered as a
// SIBLING alongside TuningCopterSection (not inside it) so the large, complex
// Copter tuning workbench is left untouched. It surfaces the four real,
// documented AC_AutoTune_Multi config params (AUTOTUNE_AXES / AGGR / MIN_D /
// GMBK) through the shared ScopedField controls and the same staged-draft
// machinery the other tabs use (setDraft -> parameterDraftById ->
// handleApplyScopedParameterDrafts). It adds NO new write or draft semantics;
// the scoped apply/discard is its own disjoint paramId scope, so applying here
// never touches the ATC_* tuning batch. The section also carries the in-flight
// AUTOTUNE procedure guidance as a bf-note.

import type { ReactElement } from 'react'
import type { ConfiguratorSnapshot, ParameterDraftEntry, ParameterState } from '@arduconfig/ardupilot-core'
import { StatusBadge, buttonStyle } from '@arduconfig/ui-kit'

import { AUTOTUNE_COPTER_PARAM_IDS } from '../autotune-params'
import { formatParameterValue } from '../parameter-format'
import { selectParameterById } from '../selectors/parameter-read'
import { toneForParameterDraftStatus, toneForScopedDraftReview } from '../tone-helpers'
import { ScopedBitmaskField, ScopedField } from '../views/ScopedField'

export interface AutotuneCopterSectionProps {
  snapshot: ConfiguratorSnapshot
  canApplyDraftParameters: boolean
  busyAction: string | undefined
  editedValues: Record<string, string>
  parameterDraftById: ReadonlyMap<string, ParameterDraftEntry>
  copterAutotuneDraftEntries: readonly ParameterDraftEntry[]
  copterAutotuneStagedDrafts: readonly ParameterDraftEntry[]
  copterAutotuneInvalidDrafts: readonly ParameterDraftEntry[]
  setDraft: (paramId: string, value: string) => void
  handleApplyScopedParameterDrafts: (
    drafts: readonly ParameterDraftEntry[],
    busyKey: string,
    scopeLabel: string
  ) => void | Promise<void>
  handleDiscardScopedParameterDrafts: (paramIds: readonly string[], scopeLabel: string) => void
}

export function AutotuneCopterSection(props: AutotuneCopterSectionProps): ReactElement | null {
  const {
    snapshot,
    canApplyDraftParameters,
    busyAction,
    editedValues,
    parameterDraftById,
    copterAutotuneDraftEntries,
    copterAutotuneStagedDrafts,
    copterAutotuneInvalidDrafts,
    setDraft,
    handleApplyScopedParameterDrafts,
    handleDiscardScopedParameterDrafts
  } = props

  // Resolve paramIds to live ParameterState, dropping any the controller does
  // not stream — same omit-if-missing behaviour as the tuning sections.
  const parameters: ParameterState[] = AUTOTUNE_COPTER_PARAM_IDS.map((id) =>
    selectParameterById(snapshot, id)
  ).filter((parameter): parameter is ParameterState => parameter !== undefined)

  // If the connected FC does not stream any AUTOTUNE_* params (no AutoTune
  // support in the build), render nothing rather than an empty card.
  if (parameters.length === 0) {
    return null
  }

  const renderField = (parameter: ParameterState): ReactElement => {
    const common = {
      key: parameter.id,
      parameter,
      liveValue: parameter.value,
      editedValues,
      onChange: (paramId: string, value: string) => setDraft(paramId, value),
      draftStatusById: parameterDraftById
    }
    if (parameter.definition?.bitmask === true) {
      return <ScopedBitmaskField {...common} />
    }
    return <ScopedField {...common} />
  }

  const reviewTone = toneForScopedDraftReview(
    copterAutotuneStagedDrafts.length,
    copterAutotuneInvalidDrafts.length
  )
  const reviewLabel =
    copterAutotuneInvalidDrafts.length > 0
      ? `${copterAutotuneInvalidDrafts.length} invalid`
      : copterAutotuneStagedDrafts.length > 0
        ? `${copterAutotuneStagedDrafts.length} staged`
        : 'in sync'

  return (
    <section className="bf-gui-box" data-testid="autotune-copter-section">
      <div className="bf-gui-box__titlebar">
        <strong>ArduCopter AutoTune</strong>
        <StatusBadge tone={reviewTone}>{reviewLabel}</StatusBadge>
      </div>
      <div className="bf-gui-box__body">
        <p className="bf-note">
          Curated AUTOTUNE configuration. Each control is the real ArduPilot parameter from the loaded catalog —
          edits stage here and apply through the same verified review path as the other tabs, so nothing is written
          until you apply. These set up AutoTune; the tuning itself happens in the air.
        </p>

        <article className="tuning-axis-card" data-testid="autotune-copter-config-group">
          <div className="tuning-axis-card__header">
            <strong>AutoTune configuration</strong>
            <span>{parameters.length} controls</span>
          </div>
          <p className="bf-note">
            AUTOTUNE_AXES picks which axes are tuned (Roll / Pitch / Yaw / YawD). AUTOTUNE_AGGR is the bounce-back
            aggressiveness used to size the D term, AUTOTUNE_MIN_D the lowest D gain AutoTune may set, and
            AUTOTUNE_GMBK the gain-margin backoff applied after tuning for extra stability margin.
          </p>
          <div className="tuning-control-grid tuning-control-grid--compact">{parameters.map(renderField)}</div>
        </article>

        <article className="tuning-axis-card" data-testid="autotune-copter-procedure">
          <div className="tuning-axis-card__header">
            <strong>How to run AutoTune (in flight)</strong>
          </div>
          <p className="bf-note">
            1. Save a known-good tuning snapshot first and pick open, calm airspace.
            <br />
            2. Assign an RC aux switch to the AutoTune function (RC&nbsp;OPTIONS&nbsp;=&nbsp;17).
            <br />
            3. Take off and stabilise in AltHold (not Stabilize — AltHold gives AutoTune the steady hover it needs),
            then engage AutoTune — the copter twitches each selected axis for a few minutes per axis.
            <br />
            4. To SAVE the tuned gains: keep the AutoTune switch HIGH and land + disarm.
            <br />
            5. To DISCARD: switch AutoTune off (low) before disarming, and the original gains are kept.
          </p>
        </article>

        <div className="scoped-review-card scoped-review-card--compact" data-testid="autotune-copter-review">
          <div className="switch-exercise-card__header">
            <div>
              <strong>AutoTune changes in review</strong>
              <p>Staged AutoTune configuration changes are collected here before they are written to the controller.</p>
            </div>
            <StatusBadge tone={reviewTone}>{reviewLabel}</StatusBadge>
          </div>

          {copterAutotuneDraftEntries.length > 0 ? (
            <div className="scoped-draft-list">
              {copterAutotuneDraftEntries.map((draft) => (
                <article key={draft.id} className={`scoped-draft-item scoped-draft-item--${draft.status}`}>
                  <div className="scoped-draft-item__header">
                    <strong>{draft.id}</strong>
                    <StatusBadge tone={toneForParameterDraftStatus(draft.status)}>{draft.status}</StatusBadge>
                  </div>
                  <p>{draft.label}</p>
                  <small>
                    {draft.status === 'staged'
                      ? `${formatParameterValue(draft.currentValue, draft.definition?.unit)} to ${formatParameterValue(
                          draft.nextValue,
                          draft.definition?.unit
                        )}`
                      : draft.reason ?? 'Draft matches the live controller value.'}
                  </small>
                </article>
              ))}
            </div>
          ) : (
            <p className="success-copy">No AutoTune changes are staged right now.</p>
          )}

          <div className="switch-exercise-controls">
            <button
              type="button"
              data-testid="apply-copter-autotune-changes-button"
              style={buttonStyle('primary')}
              onClick={() =>
                void handleApplyScopedParameterDrafts(
                  copterAutotuneDraftEntries,
                  'copter-autotune:apply',
                  'Copter AutoTune'
                )
              }
              disabled={
                busyAction !== undefined ||
                copterAutotuneStagedDrafts.length === 0 ||
                copterAutotuneInvalidDrafts.length > 0 ||
                !canApplyDraftParameters
              }
            >
              {busyAction === 'copter-autotune:apply'
                ? 'Applying…'
                : `Apply AutoTune Changes (${copterAutotuneStagedDrafts.length})`}
            </button>
            <button
              type="button"
              style={buttonStyle()}
              onClick={() =>
                handleDiscardScopedParameterDrafts(
                  copterAutotuneDraftEntries.map((entry) => entry.id),
                  'Copter AutoTune'
                )
              }
              disabled={busyAction !== undefined || copterAutotuneDraftEntries.length === 0}
            >
              Discard AutoTune Changes
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}
