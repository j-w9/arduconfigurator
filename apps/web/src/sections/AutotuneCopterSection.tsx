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

import type { ReactElement, ReactNode } from 'react'
import type { ConfiguratorSnapshot, ParameterDraftEntry, ParameterState } from '@arduconfig/ardupilot-core'
import { StatusBadge, buttonStyle } from '@arduconfig/ui-kit'

import { AUTOTUNE_COPTER_PARAM_IDS } from '../autotune-params'
import { formatParameterValue } from '../parameter-format'
import { selectParameterById } from '../selectors/parameter-read'
import { toneForParameterDraftStatus, toneForScopedDraftReview } from '../tone-helpers'
import { InfoDot } from '../views/InfoDot'
import { ParamInfoBubble } from '../views/ParamInfoBubble'
import { ScopedBitmaskField, ScopedField } from '../views/ScopedField'

// Wrap a scoped Autotune field with the same per-field "i" info bubble used on
// the Config / Networking tabs and the curated tuning controls — hover/focus
// reveals the ArduPilot parameter description right next to the control, so the
// always-on explanatory paragraph can be retired without losing the guidance.
//
// Now the SHARED ParamInfoBubble rather than a local copy of its markup. Two
// things were wrong with the copy: it rendered only when the metadata carried a
// description, so an Autotune knob whose description we don't ship showed a
// friendly label with no route to its raw name at all; and it had no link to the
// parameter reference. Both exist for every parameter, so the bubble is
// unconditional and the description is the optional part.
function withAutotuneFieldInfo(parameter: ParameterState, node: ReactNode): ReactNode {
  return (
    <div key={parameter.id} className="config-section__field-row">
      {node}
      <ParamInfoBubble
        paramId={parameter.id}
        label={parameter.definition?.label ?? parameter.id}
        description={parameter.definition?.description}
        testId={`autotune-field-info-${parameter.id}`}
      />
    </div>
  )
}

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

  const renderField = (parameter: ParameterState): ReactNode => {
    const common = {
      key: parameter.id,
      parameter,
      liveValue: parameter.value,
      editedValues,
      onChange: (paramId: string, value: string) => setDraft(paramId, value),
      draftStatusById: parameterDraftById
    }
    const field =
      parameter.definition?.bitmask === true ? <ScopedBitmaskField {...common} /> : <ScopedField {...common} />
    return withAutotuneFieldInfo(parameter, field)
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
        <span className="tuning-card-title">
          <strong>ArduCopter AutoTune</strong>
          <InfoDot label="About the AutoTune surface" testId="autotune-copter-info" wide wikiTopic="tuningAutotune">
            <span className="info-dot-line">Each control is the real ArduPilot parameter from the loaded catalog.</span>
            <span className="info-dot-line">Edits stage here and apply through the same verified review path as the other tabs — nothing is written until you apply.</span>
            <span className="info-dot-line">These set up AutoTune; the tuning itself happens in the air.</span>
          </InfoDot>
        </span>
        <StatusBadge tone={reviewTone}>{reviewLabel}</StatusBadge>
      </div>
      <div className="bf-gui-box__body">
        <article className="tuning-axis-card" data-testid="autotune-copter-config-group">
          <div className="tuning-axis-card__header">
            <span className="tuning-card-title">
              <strong>AutoTune configuration</strong>
              <InfoDot label="About the AutoTune configuration parameters" testId="autotune-config-info" wide wikiTopic="tuningAutotune">
                <span className="info-dot-line">AUTOTUNE_AXES picks which axes are tuned (Roll / Pitch / Yaw / YawD).</span>
                <span className="info-dot-line">AUTOTUNE_AGGR is the bounce-back aggressiveness used to size the D term.</span>
                <span className="info-dot-line">AUTOTUNE_MIN_D is the lowest D gain AutoTune may set.</span>
                <span className="info-dot-line">AUTOTUNE_GMBK is the gain-margin backoff applied after tuning for extra stability margin.</span>
              </InfoDot>
            </span>
            <span>{parameters.length} controls</span>
          </div>
          <div className="tuning-control-grid tuning-control-grid--compact">{parameters.map(renderField)}</div>
        </article>

        <article className="tuning-axis-card" data-testid="autotune-copter-procedure">
          <div className="tuning-axis-card__header">
            <strong>How to run AutoTune (in flight)</strong>
          </div>
          <p className="bf-note bf-note--warning" data-testid="autotune-copter-safety">
            Save a known-good tuning snapshot first, and fly in open, calm airspace — AutoTune twitches the aircraft
            hard on each axis.
          </p>
          <details className="tuning-details" data-testid="autotune-copter-procedure-details">
            <summary>Show the AutoTune procedure</summary>
            <p className="bf-note">
              1. Assign an RC aux switch to the AutoTune function (RC&nbsp;OPTIONS&nbsp;=&nbsp;17).
              <br />
              2. Take off and stabilise in AltHold (not Stabilize — AltHold gives AutoTune the steady hover it needs),
              then engage AutoTune — the copter twitches each selected axis for a few minutes per axis.
              <br />
              3. To SAVE the tuned gains: keep the AutoTune switch HIGH and land + disarm.
              <br />
              4. To DISCARD: switch AutoTune off (low) before disarming, and the original gains are kept.
            </p>
          </details>
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
