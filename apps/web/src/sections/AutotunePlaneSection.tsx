// AutotunePlaneSection — a curated ArduPlane AUTOTUNE surface rendered in the
// Tuning view for ArduPlane, as a sibling after TuningPlaneSection /
// PlaneSoaringAdsbSection. It surfaces the real, documented fixed-wing AUTOTUNE
// config params (AUTOTUNE_LEVEL / AUTOTUNE_OPTIONS) plus the QuadPlane VTOL
// AUTOTUNE config params (Q_AUTOTUNE_AXES / AGGR / MIN_D / GMBK), the latter
// gated on Q_ENABLE so a pure fixed-wing build never sees the VTOL group. All
// edits flow through the shared ScopedField controls and the same staged-draft
// machinery the other tabs use; it adds NO new write or draft semantics. The
// section also carries the in-flight AUTOTUNE procedure guidance as bf-notes.

import type { ReactElement } from 'react'
import type { ConfiguratorSnapshot, ParameterDraftEntry, ParameterState } from '@arduconfig/ardupilot-core'
import { StatusBadge, buttonStyle } from '@arduconfig/ui-kit'

import { AUTOTUNE_PLANE_PARAM_IDS, AUTOTUNE_QUADPLANE_PARAM_IDS } from '../autotune-params'
import { formatParameterValue } from '../parameter-format'
import { readRoundedParameter, selectParameterById } from '../selectors/parameter-read'
import { toneForParameterDraftStatus, toneForScopedDraftReview } from '../tone-helpers'
import { ScopedBitmaskField, ScopedField } from '../views/ScopedField'

export interface AutotunePlaneSectionProps {
  snapshot: ConfiguratorSnapshot
  canApplyDraftParameters: boolean
  busyAction: string | undefined
  editedValues: Record<string, string>
  parameterDraftById: ReadonlyMap<string, ParameterDraftEntry>
  planeAutotuneDraftEntries: readonly ParameterDraftEntry[]
  planeAutotuneStagedDrafts: readonly ParameterDraftEntry[]
  planeAutotuneInvalidDrafts: readonly ParameterDraftEntry[]
  setDraft: (paramId: string, value: string) => void
  handleApplyScopedParameterDrafts: (
    drafts: readonly ParameterDraftEntry[],
    busyKey: string,
    scopeLabel: string
  ) => void | Promise<void>
  handleDiscardScopedParameterDrafts: (paramIds: readonly string[], scopeLabel: string) => void
}

export function AutotunePlaneSection(props: AutotunePlaneSectionProps): ReactElement {
  const {
    snapshot,
    canApplyDraftParameters,
    busyAction,
    editedValues,
    parameterDraftById,
    planeAutotuneDraftEntries,
    planeAutotuneStagedDrafts,
    planeAutotuneInvalidDrafts,
    setDraft,
    handleApplyScopedParameterDrafts,
    handleDiscardScopedParameterDrafts
  } = props

  const resolve = (paramIds: readonly string[]): ParameterState[] =>
    paramIds
      .map((id) => selectParameterById(snapshot, id))
      .filter((parameter): parameter is ParameterState => parameter !== undefined)

  const fixedWingParameters = resolve(AUTOTUNE_PLANE_PARAM_IDS)

  // QuadPlane VTOL AUTOTUNE only matters on a QuadPlane. Gate on the live (or
  // staged) Q_ENABLE value — same gating TuningPlaneSection uses for its VTOL
  // groups — so a pure fixed-wing build never sees the VTOL autotune group.
  const qEnableValue =
    Number(editedValues['Q_ENABLE'] ?? readRoundedParameter(snapshot, 'Q_ENABLE') ?? 0)
  const isQuadPlane = qEnableValue === 1
  const quadplaneParameters = isQuadPlane ? resolve(AUTOTUNE_QUADPLANE_PARAM_IDS) : []

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
    planeAutotuneStagedDrafts.length,
    planeAutotuneInvalidDrafts.length
  )
  const reviewLabel =
    planeAutotuneInvalidDrafts.length > 0
      ? `${planeAutotuneInvalidDrafts.length} invalid`
      : planeAutotuneStagedDrafts.length > 0
        ? `${planeAutotuneStagedDrafts.length} staged`
        : 'in sync'

  return (
    <section className="bf-gui-box" data-testid="autotune-plane-section">
      <div className="bf-gui-box__titlebar">
        <strong>ArduPlane AutoTune</strong>
        <StatusBadge tone={reviewTone}>{reviewLabel}</StatusBadge>
      </div>
      <div className="bf-gui-box__body">
        <p className="bf-note">
          Curated AUTOTUNE configuration. Each control is the real ArduPilot parameter from the loaded catalog —
          edits stage here and apply through the same verified review path as the other tabs, so nothing is written
          until you apply. These set up AutoTune; the tuning itself happens in the air.
        </p>

        {fixedWingParameters.length > 0 ? (
          <article className="tuning-axis-card" data-testid="autotune-plane-fixedwing-group">
            <div className="tuning-axis-card__header">
              <strong>Fixed-wing AutoTune</strong>
              <span>{fixedWingParameters.length} controls</span>
            </div>
            <p className="bf-note">
              AUTOTUNE_LEVEL sets aggressiveness — 1 is the softest tune, 10 the most aggressive, and 6 is
              recommended for most planes; 0 keeps the current RMAX / TCONST and tunes only the PID values.
              AUTOTUNE_OPTIONS can hold the filter (FLTD / FLTT) update bits steady, useful on QuadPlanes with
              higher INS_GYRO_FILTER values.
            </p>
            <div className="tuning-control-grid tuning-control-grid--compact">
              {fixedWingParameters.map(renderField)}
            </div>
          </article>
        ) : (
          <p className="bf-note">The connected controller is not reporting the fixed-wing AUTOTUNE parameters.</p>
        )}

        <article className="tuning-axis-card" data-testid="autotune-plane-fixedwing-procedure">
          <div className="tuning-axis-card__header">
            <strong>How to run fixed-wing AutoTune (in flight)</strong>
          </div>
          <p className="bf-note">
            1. Save a known-good tuning snapshot first and set AUTOTUNE_LEVEL (6 is a safe starting point).
            <br />
            2. Set a flight-mode slot to the AUTOTUNE mode, OR assign an RCx_OPTION aux switch to AUTOTUNE.
            <br />
            3. Fly the aircraft and make a series of sustained roll and pitch inputs — the autopilot learns the
            roll / pitch gains while you fly.
            <br />
            4. The tuned gains are written when you leave AUTOTUNE mode; switch back to a normal mode once the
            response feels solid.
          </p>
        </article>

        {isQuadPlane ? (
          <article className="tuning-axis-card" data-testid="autotune-plane-vtol-group">
            <div className="tuning-axis-card__header">
              <strong>QuadPlane VTOL AutoTune (QAUTOTUNE)</strong>
              <span>{quadplaneParameters.length > 0 ? `${quadplaneParameters.length} controls` : 'Q_ENABLE = 1'}</span>
            </div>
            <p className="bf-note">
              The QuadPlane VTOL AutoTune (QAUTOTUNE) refines the Q_A_RAT_* hover gains. Q_AUTOTUNE_AXES picks the
              VTOL axes (Roll / Pitch / Yaw / YawD); AGGR is the bounce-back aggressiveness, MIN_D the lowest D gain
              it may set, and GMBK the post-tune gain-margin backoff. Only shown because this airframe has QuadPlane
              enabled.
            </p>
            {quadplaneParameters.length > 0 ? (
              <div className="tuning-control-grid tuning-control-grid--compact">
                {quadplaneParameters.map(renderField)}
              </div>
            ) : (
              <p className="bf-note">The connected controller is not reporting the Q_AUTOTUNE_ parameters.</p>
            )}
            <p className="bf-note">
              To run QAUTOTUNE: assign an RC aux switch to the QAutoTune function, fly in QHOVER or QLOITER and
              engage it; keep the switch HIGH and land + disarm to SAVE, or switch out before disarming to discard.
            </p>
          </article>
        ) : null}

        <div className="scoped-review-card scoped-review-card--compact" data-testid="autotune-plane-review">
          <div className="switch-exercise-card__header">
            <div>
              <strong>AutoTune changes in review</strong>
              <p>Staged AutoTune configuration changes are collected here before they are written to the controller.</p>
            </div>
            <StatusBadge tone={reviewTone}>{reviewLabel}</StatusBadge>
          </div>

          {planeAutotuneDraftEntries.length > 0 ? (
            <div className="scoped-draft-list">
              {planeAutotuneDraftEntries.map((draft) => (
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
              data-testid="apply-plane-autotune-changes-button"
              style={buttonStyle('primary')}
              onClick={() =>
                void handleApplyScopedParameterDrafts(
                  planeAutotuneDraftEntries,
                  'plane-autotune:apply',
                  'Plane AutoTune'
                )
              }
              disabled={
                busyAction !== undefined ||
                planeAutotuneStagedDrafts.length === 0 ||
                planeAutotuneInvalidDrafts.length > 0 ||
                !canApplyDraftParameters
              }
            >
              {busyAction === 'plane-autotune:apply'
                ? 'Applying…'
                : `Apply AutoTune Changes (${planeAutotuneStagedDrafts.length})`}
            </button>
            <button
              type="button"
              style={buttonStyle()}
              onClick={() =>
                handleDiscardScopedParameterDrafts(
                  planeAutotuneDraftEntries.map((entry) => entry.id),
                  'Plane AutoTune'
                )
              }
              disabled={busyAction !== undefined || planeAutotuneDraftEntries.length === 0}
            >
              Discard AutoTune Changes
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}
