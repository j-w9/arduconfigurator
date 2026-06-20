// TuningSubSection — the curated ArduSub Tuning surface. This is the last of the
// three non-Copter curated surfaces (Plane / Rover / Sub), so after it lands the
// generic "edit from Parameters" fallback note for non-Copter vehicles is
// removed. This is an ADDITIVE editor: it surfaces real, documented,
// catalog-backed underwater-vehicle tuning parameters through the app's existing
// ScopedNumberField controls and the shared staged-draft machinery
// (setDraft -> parameterDraftById -> handleApplyScopedParameterDrafts). It does
// NOT introduce any new write or draft semantics — the scoped apply/discard is
// the same path the Receiver / Config / Power tabs (and the Plane / Rover tuning
// sections) use.
//
// ArduSub is an attitude + depth-hold vehicle, so the groups are:
//   - Attitude rate controllers (ATC_RAT_RLL/PIT/YAW_*) — per-axis P/I/D/FF/IMAX
//   - Attitude angle P (ATC_ANG_RLL/PIT/YAW_P)
//   - Depth / vertical control (PSC vertical position / velocity / accel)
//
// There is no fixed-wing/steering analog and the catalog carries no horizontal
// position PSC params, so neither is surfaced.

import type { ReactElement } from 'react'
import type { ConfiguratorSnapshot, ParameterDraftEntry, ParameterState } from '@arduconfig/ardupilot-core'
import { StatusBadge, buttonStyle } from '@arduconfig/ui-kit'

import { formatParameterValue } from '../parameter-format'
import {
  TUNING_SUB_ANGLE_PARAM_IDS,
  TUNING_SUB_DEPTH_PARAM_IDS,
  TUNING_SUB_JOYSTICK_PARAM_IDS,
  TUNING_SUB_PILOT_PARAM_IDS,
  TUNING_SUB_RATE_GROUPS
} from '../tuning-params'
import { selectParameterById } from '../selectors/parameter-read'
import { toneForParameterDraftStatus, toneForScopedDraftReview } from '../tone-helpers'
import { ScopedField } from '../views/ScopedField'

export interface TuningSubSectionProps {
  snapshot: ConfiguratorSnapshot
  canApplyDraftParameters: boolean
  busyAction: string | undefined
  editedValues: Record<string, string>
  parameterDraftById: ReadonlyMap<string, ParameterDraftEntry>
  subTuningDraftEntries: readonly ParameterDraftEntry[]
  subTuningStagedDrafts: readonly ParameterDraftEntry[]
  subTuningInvalidDrafts: readonly ParameterDraftEntry[]
  setDraft: (paramId: string, value: string) => void
  handleApplyScopedParameterDrafts: (
    drafts: readonly ParameterDraftEntry[],
    busyKey: string,
    scopeLabel: string
  ) => void | Promise<void>
  handleDiscardScopedParameterDrafts: (paramIds: readonly string[], scopeLabel: string) => void
}

export function TuningSubSection(props: TuningSubSectionProps): ReactElement {
  const {
    snapshot,
    canApplyDraftParameters,
    busyAction,
    editedValues,
    parameterDraftById,
    subTuningDraftEntries,
    subTuningStagedDrafts,
    subTuningInvalidDrafts,
    setDraft,
    handleApplyScopedParameterDrafts,
    handleDiscardScopedParameterDrafts
  } = props

  // Resolve a paramId to the live ParameterState, dropping any the controller
  // does not report — mirrors how the Plane / Rover / Copter tuning views
  // silently omit params a given firmware build doesn't stream.
  const resolve = (paramIds: readonly string[]): ParameterState[] =>
    paramIds
      .map((id) => selectParameterById(snapshot, id))
      .filter((parameter): parameter is ParameterState => parameter !== undefined)

  const resolveGroups = (
    groups: readonly { id: string; label: string; paramIds: readonly string[] }[]
  ): Array<{ id: string; label: string; parameters: ParameterState[] }> =>
    groups
      .map((group) => ({ id: group.id, label: group.label, parameters: resolve(group.paramIds) }))
      .filter((group) => group.parameters.length > 0)

  const rateGroups = resolveGroups(TUNING_SUB_RATE_GROUPS)
  const angleParameters = resolve(TUNING_SUB_ANGLE_PARAM_IDS)
  const depthParameters = resolve(TUNING_SUB_DEPTH_PARAM_IDS)
  const pilotParameters = resolve(TUNING_SUB_PILOT_PARAM_IDS)
  const joystickParameters = resolve(TUNING_SUB_JOYSTICK_PARAM_IDS)

  const renderField = (parameter: ParameterState): ReactElement => (
    <ScopedField
      key={parameter.id}
      parameter={parameter}
      liveValue={parameter.value}
      editedValues={editedValues}
      onChange={(paramId, value) => setDraft(paramId, value)}
      draftStatusById={parameterDraftById}
    />
  )

  const reviewTone = toneForScopedDraftReview(subTuningStagedDrafts.length, subTuningInvalidDrafts.length)
  const reviewLabel =
    subTuningInvalidDrafts.length > 0
      ? `${subTuningInvalidDrafts.length} invalid`
      : subTuningStagedDrafts.length > 0
        ? `${subTuningStagedDrafts.length} staged`
        : 'in sync'

  return (
    <section className="bf-gui-box" data-testid="tuning-sub-section">
      <div className="bf-gui-box__titlebar">
        <strong>ArduSub Tuning</strong>
        <StatusBadge tone={reviewTone}>{reviewLabel}</StatusBadge>
      </div>
      <div className="bf-gui-box__body">
        <p className="bf-note">
          Curated underwater-vehicle tuning grouped by concern. Each control is the real ArduPilot parameter from the
          loaded catalog — edits stage here and apply through the same verified review path as the other tabs, so
          nothing is written until you apply.
        </p>

        <article className="tuning-axis-card" data-testid="tuning-sub-rate-group">
          <div className="tuning-axis-card__header">
            <strong>Attitude rate controllers</strong>
            <span>{rateGroups.reduce((total, group) => total + group.parameters.length, 0)} controls</span>
          </div>
          <p className="bf-note">
            The per-axis rate PIDs convert demanded angular rate into thruster output. Feedforward (FF) drives the
            output directly from demanded rate; P/I/D correct the residual error. This is what the Sub AUTOTUNE
            adjusts. Yaw has no D term on ArduSub.
          </p>
          {rateGroups.length > 0 ? (
            <div className="tuning-axis-grid">
              {rateGroups.map((group) => (
                <article key={`sub-rate:${group.id}`} className="tuning-axis-card" data-testid={`tuning-sub-rate-${group.id}`}>
                  <div className="tuning-axis-card__header">
                    <strong>{group.label}</strong>
                    <span>{group.parameters.length} controls</span>
                  </div>
                  <div className="tuning-control-grid tuning-control-grid--compact">
                    {group.parameters.map(renderField)}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p className="bf-note">The connected controller is not reporting the rate-controller parameters.</p>
          )}
        </article>

        {angleParameters.length > 0 ? (
          <article className="tuning-axis-card" data-testid="tuning-sub-angle-group">
            <div className="tuning-axis-card__header">
              <strong>Attitude angle P</strong>
              <span>{angleParameters.length} controls</span>
            </div>
            <p className="bf-note">
              The angle-to-rate P gains set how aggressively the controller demands rate to correct an attitude error.
              Raise for crisper attitude hold; lower if the sub oscillates around level.
            </p>
            <div className="tuning-control-grid tuning-control-grid--compact">
              {angleParameters.map(renderField)}
            </div>
          </article>
        ) : null}

        {depthParameters.length > 0 ? (
          <article className="tuning-axis-card" data-testid="tuning-sub-depth-group">
            <div className="tuning-axis-card__header">
              <strong>Depth / vertical control</strong>
              <span>{depthParameters.length} controls</span>
            </div>
            <p className="bf-note">
              The vertical position / velocity / acceleration cascade that holds depth in the depth-hold and auto
              modes. Modern firmware reports these as PSC_D_* and older firmware as PSC_*Z — only the names the
              connected controller actually streams are shown.
            </p>
            <div className="tuning-control-grid tuning-control-grid--compact">
              {depthParameters.map(renderField)}
            </div>
          </article>
        ) : null}

        {pilotParameters.length > 0 ? (
          <article className="tuning-axis-card" data-testid="tuning-sub-pilot-group">
            <div className="tuning-axis-card__header">
              <strong>Pilot envelope</strong>
              <span>{pilotParameters.length} controls</span>
            </div>
            <p className="bf-note">
              How fast and how hard pilot stick input is allowed to push the Sub. Vertical / horizontal speed caps
              and the vertical-acceleration limit shape the demand the rate controllers actually see. SURFACE_DEPTH
              + SURFACE_MAX_THR scale throttle near the surface so a breach doesn't whip the operator — set the
              former to a realistic pressure reading at the surface for the depth sensor you have.
            </p>
            <div className="tuning-control-grid tuning-control-grid--compact">
              {pilotParameters.map(renderField)}
            </div>
          </article>
        ) : null}

        {joystickParameters.length > 0 ? (
          <article className="tuning-axis-card" data-testid="tuning-sub-joystick-group">
            <div className="tuning-axis-card__header">
              <strong>Joystick gain ladder</strong>
              <span>{joystickParameters.length} controls</span>
            </div>
            <p className="bf-note">
              Surface-side gain steps the pilot ramps through with the gain-up / gain-down buttons. JS_GAIN_MIN /
              MAX bound the ladder; JS_GAIN_STEPS sets how many positions sit between them (1 = always
              JS_GAIN_DEFAULT). JS_THR_GAIN is an extra scalar on the throttle channel; JS_LIGHTS_STEPS sets the
              light-brightness rungs. Button bindings (BTNn_FUNCTION) live in the Receiver / Joystick view —
              this card is just the gain numbers.
            </p>
            <div className="tuning-control-grid tuning-control-grid--compact">
              {joystickParameters.map(renderField)}
            </div>
          </article>
        ) : null}

        <div className="scoped-review-card scoped-review-card--compact" data-testid="tuning-sub-review">
          <div className="switch-exercise-card__header">
            <div>
              <strong>Tuning changes in review</strong>
              <p>Staged underwater-vehicle tuning changes are collected here before they are written to the controller.</p>
            </div>
            <StatusBadge tone={reviewTone}>{reviewLabel}</StatusBadge>
          </div>

          {subTuningDraftEntries.length > 0 ? (
            <div className="scoped-draft-list">
              {subTuningDraftEntries.map((draft) => (
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
            <p className="success-copy">No tuning changes are staged right now.</p>
          )}

          <div className="switch-exercise-controls">
            <button
              type="button"
              data-testid="apply-sub-tuning-changes-button"
              style={buttonStyle('primary')}
              onClick={() => void handleApplyScopedParameterDrafts(subTuningDraftEntries, 'sub-tuning:apply', 'Sub tuning')}
              disabled={
                busyAction !== undefined ||
                subTuningStagedDrafts.length === 0 ||
                subTuningInvalidDrafts.length > 0 ||
                !canApplyDraftParameters
              }
            >
              {busyAction === 'sub-tuning:apply'
                ? 'Applying…'
                : `Apply Tuning Changes (${subTuningStagedDrafts.length})`}
            </button>
            <button
              type="button"
              style={buttonStyle()}
              onClick={() => handleDiscardScopedParameterDrafts(subTuningDraftEntries.map((entry) => entry.id), 'sub tuning')}
              disabled={busyAction !== undefined || subTuningDraftEntries.length === 0}
            >
              Discard Tuning Changes
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}
