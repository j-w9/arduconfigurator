// TuningPlaneSection — the curated ArduPlane Tuning surface that replaces the
// "edit from Parameters" placeholder for ArduPlane (Rover/Sub still fall back
// to the note). This is an ADDITIVE editor: it surfaces real, documented,
// catalog-backed fixed-wing tuning parameters through the app's existing
// ScopedNumberField controls and the shared staged-draft machinery
// (setDraft -> parameterDraftById -> handleApplyScopedParameterDrafts). It does
// NOT introduce any new write or draft semantics — the scoped apply/discard is
// the same path the Receiver / Config / Power tabs use.
//
// Groups (each only renders params the connected FC actually streams):
//   - Roll / Pitch rate controllers (RLL_RATE_* / PTCH_RATE_*)
//   - Fixed-wing attitude limits (RLL2SRV_* / PTCH2SRV_*)
//   - TECS speed/height (TECS_*)
//   - L1 navigation (NAVL1_*)
//   - QuadPlane VTOL attitude + position (Q_A_* / Q_P_*) — gated on Q_ENABLE.

import type { ReactElement } from 'react'
import type { ConfiguratorSnapshot, ParameterDraftEntry, ParameterState } from '@arduconfig/ardupilot-core'
import { StatusBadge, buttonStyle } from '@arduconfig/ui-kit'

import { formatParameterValue } from '../parameter-format'
import {
  TUNING_PLANE_ATTITUDE_PARAM_IDS,
  TUNING_PLANE_NAV_PARAM_IDS,
  TUNING_PLANE_RATE_GROUPS,
  TUNING_PLANE_TECS_LANDING_PARAM_IDS,
  TUNING_PLANE_TECS_PARAM_IDS,
  TUNING_PLANE_TECS_TAKEOFF_PARAM_IDS,
  TUNING_PLANE_VTOL_ANGLE_PARAM_IDS,
  TUNING_PLANE_VTOL_POSITION_PARAM_IDS,
  TUNING_PLANE_VTOL_RATE_GROUPS,
  TUNING_PLANE_TRANSITION_PARAM_IDS,
  TUNING_PLANE_TAILSITTER_PARAM_IDS
} from '../tuning-params'
import { readRoundedParameter, selectParameterById } from '../selectors/parameter-read'
import { toneForParameterDraftStatus, toneForScopedDraftReview } from '../tone-helpers'
import { ScopedField } from '../views/ScopedField'

export interface TuningPlaneSectionProps {
  snapshot: ConfiguratorSnapshot
  canApplyDraftParameters: boolean
  busyAction: string | undefined
  editedValues: Record<string, string>
  parameterDraftById: ReadonlyMap<string, ParameterDraftEntry>
  planeTuningDraftEntries: readonly ParameterDraftEntry[]
  planeTuningStagedDrafts: readonly ParameterDraftEntry[]
  planeTuningInvalidDrafts: readonly ParameterDraftEntry[]
  setDraft: (paramId: string, value: string) => void
  handleApplyScopedParameterDrafts: (
    drafts: readonly ParameterDraftEntry[],
    busyKey: string,
    scopeLabel: string
  ) => void | Promise<void>
  handleDiscardScopedParameterDrafts: (paramIds: readonly string[], scopeLabel: string) => void
}

export function TuningPlaneSection(props: TuningPlaneSectionProps): ReactElement {
  const {
    snapshot,
    canApplyDraftParameters,
    busyAction,
    editedValues,
    parameterDraftById,
    planeTuningDraftEntries,
    planeTuningStagedDrafts,
    planeTuningInvalidDrafts,
    setDraft,
    handleApplyScopedParameterDrafts,
    handleDiscardScopedParameterDrafts
  } = props

  // Resolve a paramId to the live ParameterState, dropping any the controller
  // does not report — mirrors how the Copter tuning view silently omits params
  // a given firmware build doesn't stream.
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

  const rateGroups = resolveGroups(TUNING_PLANE_RATE_GROUPS)
  const attitudeParameters = resolve(TUNING_PLANE_ATTITUDE_PARAM_IDS)
  const tecsParameters = resolve(TUNING_PLANE_TECS_PARAM_IDS)
  const tecsLandingParameters = resolve(TUNING_PLANE_TECS_LANDING_PARAM_IDS)
  const tecsTakeoffParameters = resolve(TUNING_PLANE_TECS_TAKEOFF_PARAM_IDS)
  const navParameters = resolve(TUNING_PLANE_NAV_PARAM_IDS)

  // QuadPlane VTOL groups only matter when the airframe is a QuadPlane. Gate on
  // the live (or staged) Q_ENABLE value so a pure fixed-wing build never sees
  // the VTOL editor, even if the firmware reports the Q_* params at defaults.
  const qEnableValue =
    Number(editedValues['Q_ENABLE'] ?? readRoundedParameter(snapshot, 'Q_ENABLE') ?? 0)
  const isQuadPlane = qEnableValue === 1
  const vtolRateGroups = isQuadPlane ? resolveGroups(TUNING_PLANE_VTOL_RATE_GROUPS) : []
  const vtolAngleParameters = isQuadPlane ? resolve(TUNING_PLANE_VTOL_ANGLE_PARAM_IDS) : []
  const vtolPositionParameters = isQuadPlane ? resolve(TUNING_PLANE_VTOL_POSITION_PARAM_IDS) : []

  // Transition applies to every QuadPlane; the tiltrotor mechanism is a further
  // subtype, so its geometry/rate controls self-gate on Q_TILT_ENABLE (which a
  // pure-multirotor-lift QuadPlane leaves at 0).
  const transitionParameters = isQuadPlane ? resolve(TUNING_PLANE_TRANSITION_PARAM_IDS) : []
  const tiltEnableValue = Number(editedValues['Q_TILT_ENABLE'] ?? readRoundedParameter(snapshot, 'Q_TILT_ENABLE') ?? 0)
  const isTiltrotor = isQuadPlane && tiltEnableValue === 1
  const tiltrotorCoreParameters = isQuadPlane ? resolve(['Q_TILT_ENABLE', 'Q_TILT_MASK', 'Q_TILT_TYPE']) : []
  const tiltrotorDetailParameters = isTiltrotor
    ? resolve([
        'Q_TILT_MAX',
        'Q_TILT_RATE_UP',
        'Q_TILT_RATE_DN',
        'Q_TILT_YAW_ANGLE',
        'Q_TILT_FIX_ANGLE',
        'Q_TILT_FIX_GAIN',
        'Q_TILT_WING_FLAP'
      ])
    : []

  // Tailsitter is a frame choice (Q_FRAME_CLASS=10) or an explicit enable, not a
  // simple toggle like tiltrotor — so the whole group gates on detection.
  const tailsitFrameClass = Number(editedValues['Q_FRAME_CLASS'] ?? readRoundedParameter(snapshot, 'Q_FRAME_CLASS') ?? 0)
  const tailsitEnableValue = Number(editedValues['Q_TAILSIT_ENABLE'] ?? readRoundedParameter(snapshot, 'Q_TAILSIT_ENABLE') ?? 0)
  const isTailsitter = isQuadPlane && (tailsitFrameClass === 10 || tailsitEnableValue >= 1)
  const tailsitterParameters = isTailsitter ? resolve(TUNING_PLANE_TAILSITTER_PARAM_IDS) : []

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

  const reviewTone = toneForScopedDraftReview(planeTuningStagedDrafts.length, planeTuningInvalidDrafts.length)
  const reviewLabel =
    planeTuningInvalidDrafts.length > 0
      ? `${planeTuningInvalidDrafts.length} invalid`
      : planeTuningStagedDrafts.length > 0
        ? `${planeTuningStagedDrafts.length} staged`
        : 'in sync'

  return (
    <section className="bf-gui-box" data-testid="tuning-plane-section">
      <div className="bf-gui-box__titlebar">
        <strong>ArduPlane Tuning</strong>
        <StatusBadge tone={reviewTone}>{reviewLabel}</StatusBadge>
      </div>
      <div className="bf-gui-box__body">
        <p className="bf-note">
          Curated fixed-wing tuning grouped by concern. Each control is the real ArduPilot parameter from the
          loaded catalog — edits stage here and apply through the same verified review path as the other tabs, so
          nothing is written until you apply.
        </p>

        <article className="tuning-axis-card" data-testid="tuning-plane-rate-group">
          <div className="tuning-axis-card__header">
            <strong>Roll / Pitch rate controllers</strong>
            <span>{rateGroups.reduce((total, group) => total + group.parameters.length, 0)} controls</span>
          </div>
          <p className="bf-note">
            The modern per-axis rate PIDs. Feedforward (FF) drives the surfaces directly from demanded rate;
            P/I/D correct the residual error. This is what AUTOTUNE adjusts.
          </p>
          {rateGroups.length > 0 ? (
            <div className="tuning-axis-grid">
              {rateGroups.map((group) => (
                <article key={`plane-rate:${group.id}`} className="tuning-axis-card" data-testid={`tuning-plane-rate-${group.id}`}>
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

        {attitudeParameters.length > 0 ? (
          <article className="tuning-axis-card" data-testid="tuning-plane-attitude-group">
            <div className="tuning-axis-card__header">
              <strong>Attitude controller limits</strong>
              <span>{attitudeParameters.length} controls</span>
            </div>
            <p className="bf-note">
              Roll/pitch time constants and limits that shape how quickly the attitude controller demands rate.
            </p>
            <div className="tuning-control-grid tuning-control-grid--compact">
              {attitudeParameters.map(renderField)}
            </div>
          </article>
        ) : null}

        {tecsParameters.length > 0 ? (
          <article className="tuning-axis-card" data-testid="tuning-plane-tecs-group">
            <div className="tuning-axis-card__header">
              <strong>TECS cruise (speed / height)</strong>
              <span>{tecsParameters.length} controls</span>
            </div>
            <p className="bf-note">
              The Total Energy Control System trades throttle and pitch to hold airspeed and altitude in the
              auto-throttle modes. Set climb/sink rates to what the airframe can actually sustain; the bank-angle
              throttle compensation and filter cross-over frequencies fix the "TECS feels mushy / spikes in
              turns" symptoms once the basics are right.
            </p>
            <div className="tuning-control-grid tuning-control-grid--compact">
              {tecsParameters.map(renderField)}
            </div>
          </article>
        ) : null}

        {tecsLandingParameters.length > 0 ? (
          <article className="tuning-axis-card" data-testid="tuning-plane-tecs-landing-group">
            <div className="tuning-axis-card__header">
              <strong>TECS landing</strong>
              <span>{tecsLandingParameters.length} controls</span>
            </div>
            <p className="bf-note">
              These gains only take effect during the auto-landing state machine — cruise TECS is untouched.
              Defaults of -1 / 0 mean "inherit the cruise value." Always dry-run a LAND mission at altitude
              before trusting changes near the ground.
            </p>
            <div className="tuning-control-grid tuning-control-grid--compact">
              {tecsLandingParameters.map(renderField)}
            </div>
          </article>
        ) : null}

        {tecsTakeoffParameters.length > 0 ? (
          <article className="tuning-axis-card" data-testid="tuning-plane-tecs-takeoff-group">
            <div className="tuning-axis-card__header">
              <strong>TECS takeoff</strong>
              <span>{tecsTakeoffParameters.length} controls</span>
            </div>
            <p className="bf-note">
              Decoupled integrator for the auto-takeoff climb so the initial climb can be tuned without
              disturbing cruise integrator wind-up.
            </p>
            <div className="tuning-control-grid tuning-control-grid--compact">
              {tecsTakeoffParameters.map(renderField)}
            </div>
          </article>
        ) : null}

        {navParameters.length > 0 ? (
          <article className="tuning-axis-card" data-testid="tuning-plane-nav-group">
            <div className="tuning-axis-card__header">
              <strong>L1 navigation</strong>
              <span>{navParameters.length} controls</span>
            </div>
            <p className="bf-note">
              The L1 controller tracks waypoint and loiter paths. Raise the period if the aircraft weaves or
              overshoots tracks; nudge damping up for path-tracking overshoot. The crosstrack integrator
              corrects long-term cross-track error and the loiter bank-angle cap bounds airframe loading in a
              continuous loiter at altitude.
            </p>
            <div className="tuning-control-grid tuning-control-grid--compact">
              {navParameters.map(renderField)}
            </div>
          </article>
        ) : null}

        {isQuadPlane ? (
          <article className="tuning-axis-card" data-testid="tuning-plane-vtol-group">
            <div className="tuning-axis-card__header">
              <strong>QuadPlane VTOL controllers</strong>
              <span>Q_ENABLE = 1</span>
            </div>
            <p className="bf-note">
              Multirotor-side attitude and position gains used during VTOL flight (hover, transitions, Q-modes).
              Only shown because this airframe has QuadPlane enabled.
            </p>

            {vtolRateGroups.length > 0 ? (
              <div className="tuning-axis-grid" data-testid="tuning-plane-vtol-rate">
                {vtolRateGroups.map((group) => (
                  <article key={`plane-vtol-rate:${group.id}`} className="tuning-axis-card">
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
            ) : null}

            {vtolAngleParameters.length > 0 ? (
              <article className="tuning-axis-card" data-testid="tuning-plane-vtol-angle">
                <div className="tuning-axis-card__header">
                  <strong>VTOL angle P</strong>
                  <span>{vtolAngleParameters.length} controls</span>
                </div>
                <div className="tuning-control-grid tuning-control-grid--compact">
                  {vtolAngleParameters.map(renderField)}
                </div>
              </article>
            ) : null}

            {vtolPositionParameters.length > 0 ? (
              <article className="tuning-axis-card" data-testid="tuning-plane-vtol-position">
                <div className="tuning-axis-card__header">
                  <strong>VTOL position control</strong>
                  <span>{vtolPositionParameters.length} controls</span>
                </div>
                <div className="tuning-control-grid tuning-control-grid--compact">
                  {vtolPositionParameters.map(renderField)}
                </div>
              </article>
            ) : null}
          </article>
        ) : null}

        {isQuadPlane ? (
          <article className="tuning-axis-card" data-testid="tuning-plane-transition-group">
            <div className="tuning-axis-card__header">
              <strong>VTOL transition</strong>
              <span>{transitionParameters.length} controls</span>
            </div>
            <p className="bf-note">
              Forward/back transition timing, deceleration, failure handling, and how RTL behaves on a QuadPlane.
              Only shown because this airframe has QuadPlane enabled.
            </p>
            {transitionParameters.length > 0 ? (
              <div className="tuning-control-grid tuning-control-grid--compact">
                {transitionParameters.map(renderField)}
              </div>
            ) : (
              <p className="bf-note">The connected controller is not reporting the transition parameters.</p>
            )}
          </article>
        ) : null}

        {isQuadPlane ? (
          <article className="tuning-axis-card" data-testid="tuning-plane-tiltrotor-group">
            <div className="tuning-axis-card__header">
              <strong>Tiltrotor</strong>
              <span>{isTiltrotor ? 'enabled' : 'Q_TILT_ENABLE = 0'}</span>
            </div>
            <p className="bf-note">
              Turn a QuadPlane into a tiltrotor: enable it and set which motors tilt. The tilt geometry, type,
              and rate controls appear once Q_TILT_ENABLE is on.
            </p>
            {tiltrotorCoreParameters.length > 0 ? (
              <div className="tuning-control-grid tuning-control-grid--compact" data-testid="tuning-plane-tiltrotor-core">
                {tiltrotorCoreParameters.map(renderField)}
              </div>
            ) : null}
            {isTiltrotor && tiltrotorDetailParameters.length > 0 ? (
              <article className="tuning-axis-card" data-testid="tuning-plane-tiltrotor-detail">
                <div className="tuning-axis-card__header">
                  <strong>Tilt geometry &amp; rates</strong>
                  <span>{tiltrotorDetailParameters.length} controls</span>
                </div>
                <div className="tuning-control-grid tuning-control-grid--compact">
                  {tiltrotorDetailParameters.map(renderField)}
                </div>
              </article>
            ) : null}
          </article>
        ) : null}

        {isTailsitter ? (
          <article className="tuning-axis-card" data-testid="tuning-plane-tailsitter-group">
            <div className="tuning-axis-card__header">
              <strong>Tailsitter</strong>
              <span>{tailsitterParameters.length} controls</span>
            </div>
            <p className="bf-note">
              Tailsitter geometry and tuning — VTOL/fixed-wing transition angles &amp; rates, vectored-thrust
              gains, and gain scaling. Shown because this airframe is a tailsitter (Q_FRAME_CLASS = Tailsitter,
              or Q_TAILSIT_ENABLE is on).
            </p>
            {tailsitterParameters.length > 0 ? (
              <div className="tuning-control-grid tuning-control-grid--compact" data-testid="tuning-plane-tailsitter-controls">
                {tailsitterParameters.map(renderField)}
              </div>
            ) : (
              <p className="bf-note">The connected controller is not reporting the tailsitter parameters.</p>
            )}
          </article>
        ) : null}

        <div className="scoped-review-card scoped-review-card--compact" data-testid="tuning-plane-review">
          <div className="switch-exercise-card__header">
            <div>
              <strong>Tuning changes in review</strong>
              <p>Staged fixed-wing tuning changes are collected here before they are written to the controller.</p>
            </div>
            <StatusBadge tone={reviewTone}>{reviewLabel}</StatusBadge>
          </div>

          {planeTuningDraftEntries.length > 0 ? (
            <div className="scoped-draft-list">
              {planeTuningDraftEntries.map((draft) => (
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
              data-testid="apply-plane-tuning-changes-button"
              style={buttonStyle('primary')}
              onClick={() => void handleApplyScopedParameterDrafts(planeTuningDraftEntries, 'plane-tuning:apply', 'Plane tuning')}
              disabled={
                busyAction !== undefined ||
                planeTuningStagedDrafts.length === 0 ||
                planeTuningInvalidDrafts.length > 0 ||
                !canApplyDraftParameters
              }
            >
              {busyAction === 'plane-tuning:apply'
                ? 'Applying…'
                : `Apply Tuning Changes (${planeTuningStagedDrafts.length})`}
            </button>
            <button
              type="button"
              style={buttonStyle()}
              onClick={() => handleDiscardScopedParameterDrafts(planeTuningDraftEntries.map((entry) => entry.id), 'plane tuning')}
              disabled={busyAction !== undefined || planeTuningDraftEntries.length === 0}
            >
              Discard Tuning Changes
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}
