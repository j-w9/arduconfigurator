// TuningRoverSection — the curated ArduRover Tuning surface that replaces the
// "edit from Parameters" placeholder for ArduRover (Sub still falls back to the
// note). This is an ADDITIVE editor: it surfaces real, documented,
// catalog-backed ground-vehicle tuning parameters through the app's existing
// ScopedNumberField controls and the shared staged-draft machinery
// (setDraft -> parameterDraftById -> handleApplyScopedParameterDrafts). It does
// NOT introduce any new write or draft semantics — the scoped apply/discard is
// the same path the Receiver / Config / Power tabs (and TuningPlaneSection) use.
//
// Groups (each only renders params the connected FC actually streams):
//   - Steering rate controller (ATC_STR_RAT_*)
//   - Speed / throttle controller (ATC_SPEED_* + CRUISE_*)
//   - Navigation (WP_SPEED / WP_RADIUS)
//   - Cornering / acceleration limits (ATC_TURN_MAX_G / TURN_RADIUS / ATC_*CEL_MAX)
//
// The legacy pre-4.3 ids the catalog still carries (NAVL1_*, TURN_MAX_G,
// WP_OVERSHOOT) are deliberately not surfaced — the catalog flags them retired
// in favor of the modern AR_AttitudeControl / s-curve params exposed here.

import type { ReactElement } from 'react'
import type { ConfiguratorSnapshot, ParameterDraftEntry, ParameterState } from '@arduconfig/ardupilot-core'
import { StatusBadge, buttonStyle } from '@arduconfig/ui-kit'

import { formatParameterValue } from '../parameter-format'
import {
  TUNING_ROVER_NAV_PARAM_IDS,
  TUNING_ROVER_SAIL_HEEL_PID_PARAM_IDS,
  TUNING_ROVER_SAIL_PARAM_IDS,
  TUNING_ROVER_SPEED_PARAM_IDS,
  TUNING_ROVER_STEERING_PARAM_IDS,
  TUNING_ROVER_TURN_PARAM_IDS,
  TUNING_ROVER_WINDVANE_PARAM_IDS
} from '../tuning-params'
import { readRoundedParameter, selectParameterById } from '../selectors/parameter-read'
import { toneForParameterDraftStatus, toneForScopedDraftReview } from '../tone-helpers'
import { ScopedField } from '../views/ScopedField'

export interface TuningRoverSectionProps {
  snapshot: ConfiguratorSnapshot
  canApplyDraftParameters: boolean
  busyAction: string | undefined
  editedValues: Record<string, string>
  parameterDraftById: ReadonlyMap<string, ParameterDraftEntry>
  roverTuningDraftEntries: readonly ParameterDraftEntry[]
  roverTuningStagedDrafts: readonly ParameterDraftEntry[]
  roverTuningInvalidDrafts: readonly ParameterDraftEntry[]
  setDraft: (paramId: string, value: string) => void
  handleApplyScopedParameterDrafts: (
    drafts: readonly ParameterDraftEntry[],
    busyKey: string,
    scopeLabel: string
  ) => void | Promise<void>
  handleDiscardScopedParameterDrafts: (paramIds: readonly string[], scopeLabel: string) => void
}

export function TuningRoverSection(props: TuningRoverSectionProps): ReactElement {
  const {
    snapshot,
    canApplyDraftParameters,
    busyAction,
    editedValues,
    parameterDraftById,
    roverTuningDraftEntries,
    roverTuningStagedDrafts,
    roverTuningInvalidDrafts,
    setDraft,
    handleApplyScopedParameterDrafts,
    handleDiscardScopedParameterDrafts
  } = props

  // Resolve a paramId to the live ParameterState, dropping any the controller
  // does not report — mirrors how the Plane / Copter tuning views silently omit
  // params a given firmware build doesn't stream.
  const resolve = (paramIds: readonly string[]): ParameterState[] =>
    paramIds
      .map((id) => selectParameterById(snapshot, id))
      .filter((parameter): parameter is ParameterState => parameter !== undefined)

  const steeringParameters = resolve(TUNING_ROVER_STEERING_PARAM_IDS)
  const speedParameters = resolve(TUNING_ROVER_SPEED_PARAM_IDS)
  const navParameters = resolve(TUNING_ROVER_NAV_PARAM_IDS)
  const turnParameters = resolve(TUNING_ROVER_TURN_PARAM_IDS)
  const sailParameters = resolve(TUNING_ROVER_SAIL_PARAM_IDS)
  const windVaneParameters = resolve(TUNING_ROVER_WINDVANE_PARAM_IDS)

  // Sailing-only PID surface — gated on SAIL_ENABLE the same way QuadPlane
  // VTOL is gated on Q_ENABLE in TuningPlaneSection. Reads the staged
  // value first so flipping SAIL_ENABLE in the sailing card surfaces the
  // heel-PID card immediately without needing to apply.
  const sailEnableValue =
    Number(editedValues['SAIL_ENABLE'] ?? readRoundedParameter(snapshot, 'SAIL_ENABLE') ?? 0)
  const isSailEnabled = sailEnableValue === 1
  const sailHeelPidParameters = isSailEnabled ? resolve(TUNING_ROVER_SAIL_HEEL_PID_PARAM_IDS) : []

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

  const reviewTone = toneForScopedDraftReview(roverTuningStagedDrafts.length, roverTuningInvalidDrafts.length)
  const reviewLabel =
    roverTuningInvalidDrafts.length > 0
      ? `${roverTuningInvalidDrafts.length} invalid`
      : roverTuningStagedDrafts.length > 0
        ? `${roverTuningStagedDrafts.length} staged`
        : 'in sync'

  return (
    <section className="bf-gui-box" data-testid="tuning-rover-section">
      <div className="bf-gui-box__titlebar">
        <strong>ArduRover Tuning</strong>
        <StatusBadge tone={reviewTone}>{reviewLabel}</StatusBadge>
      </div>
      <div className="bf-gui-box__body">
        <p className="bf-note">
          Curated ground-vehicle tuning grouped by concern. Each control is the real ArduPilot parameter from the
          loaded catalog — edits stage here and apply through the same verified review path as the other tabs, so
          nothing is written until you apply.
        </p>

        {steeringParameters.length > 0 ? (
          <article className="tuning-axis-card" data-testid="tuning-rover-steering-group">
            <div className="tuning-axis-card__header">
              <strong>Steering rate controller</strong>
              <span>{steeringParameters.length} controls</span>
            </div>
            <p className="bf-note">
              The steering-rate PID converts demanded turn rate into a steering output. Feedforward (FF) does most of
              the work on a well-trimmed rover; P/I/D correct the residual error. This is what AUTOTUNE adjusts.
            </p>
            <div className="tuning-control-grid tuning-control-grid--compact">
              {steeringParameters.map(renderField)}
            </div>
          </article>
        ) : null}

        {speedParameters.length > 0 ? (
          <article className="tuning-axis-card" data-testid="tuning-rover-speed-group">
            <div className="tuning-axis-card__header">
              <strong>Speed / throttle controller</strong>
              <span>{speedParameters.length} controls</span>
            </div>
            <p className="bf-note">
              The throttle-speed PID holds target ground speed. Set CRUISE_SPEED / CRUISE_THROTTLE to a real
              flat-ground operating point first — the controller uses that pair as its feedforward reference.
            </p>
            <div className="tuning-control-grid tuning-control-grid--compact">
              {speedParameters.map(renderField)}
            </div>
          </article>
        ) : null}

        {navParameters.length > 0 ? (
          <article className="tuning-axis-card" data-testid="tuning-rover-nav-group">
            <div className="tuning-axis-card__header">
              <strong>Navigation</strong>
              <span>{navParameters.length} controls</span>
            </div>
            <p className="bf-note">
              Auto-mode path following. WP_SPEED sets the target speed between waypoints (0 = use CRUISE_SPEED);
              WP_RADIUS is how close counts as reached.
            </p>
            <div className="tuning-control-grid tuning-control-grid--compact">
              {navParameters.map(renderField)}
            </div>
          </article>
        ) : null}

        {turnParameters.length > 0 ? (
          <article className="tuning-axis-card" data-testid="tuning-rover-turn-group">
            <div className="tuning-axis-card__header">
              <strong>Cornering &amp; acceleration limits</strong>
              <span>{turnParameters.length} controls</span>
            </div>
            <p className="bf-note">
              Kinematic limits the navigation controller respects. ATC_TURN_MAX_G caps cornering lateral acceleration;
              TURN_RADIUS sets the low-speed minimum turn; the accel/decel maxima bound how hard the rover changes
              speed (0 = no limit).
            </p>
            <div className="tuning-control-grid tuning-control-grid--compact">
              {turnParameters.map(renderField)}
            </div>
          </article>
        ) : null}

        {sailParameters.length > 0 ? (
          <article className="tuning-axis-card" data-testid="tuning-rover-sail-group">
            <div className="tuning-axis-card__header">
              <strong>Sailing trim &amp; limits</strong>
              <span>{sailParameters.length} controls</span>
            </div>
            <p className="bf-note">
              Sailboat trim and operational envelope. SAIL_ENABLE is the master toggle (reboot required to take
              effect). Sheet-out / sheet-in angles bound how far the boom can swing; HEEL_MAX is the auto-heel
              ceiling that engages the heel-PID below. NO_GO_ANGLE keeps the boat off the close-haul stall;
              WNDSPD_MIN drops the sail and motors instead when the wind dies; XTRACK_MAX triggers an auto-tack.
            </p>
            <div className="tuning-control-grid tuning-control-grid--compact">
              {sailParameters.map(renderField)}
            </div>
          </article>
        ) : null}

        {isSailEnabled && sailHeelPidParameters.length > 0 ? (
          <article className="tuning-axis-card" data-testid="tuning-rover-sail-heel-pid-group">
            <div className="tuning-axis-card__header">
              <strong>Sail-heel controller (PID)</strong>
              <span>SAIL_ENABLE = 1 · {sailHeelPidParameters.length} controls</span>
            </div>
            <p className="bf-note">
              Closed-loop heel control that eases the mainsheet to hold the boat below SAIL_HEEL_MAX. P/I/D/FF
              shape the response; FLTT / FLTE / FLTD are target/error/derivative filter frequencies; SMAX caps
              the combined P+D slew rate. The base AC_PID library does NOT document ranges for the gain terms,
              so the editor leaves them open — start small and bisect against a heel step input.
            </p>
            <div className="tuning-control-grid tuning-control-grid--compact">
              {sailHeelPidParameters.map(renderField)}
            </div>
          </article>
        ) : null}

        {windVaneParameters.length > 0 ? (
          <article className="tuning-axis-card" data-testid="tuning-rover-windvane-group">
            <div className="tuning-axis-card__header">
              <strong>Wind vane</strong>
              <span>{windVaneParameters.length} controls</span>
            </div>
            <p className="bf-note">
              Apparent-wind sensor selection, calibration and filtering. WNDVN_CAL triggers a calibration sweep
              (1 = direction, 2 = speed); the *_FILT params are low-pass cross-over frequencies (-1 disables);
              SPEED_MIN gates direction estimates that would otherwise be noisy at low wind. Pin / voltage
              wiring lives in the Parameters view — this card focuses on tuning.
            </p>
            <div className="tuning-control-grid tuning-control-grid--compact">
              {windVaneParameters.map(renderField)}
            </div>
          </article>
        ) : null}

        <div className="scoped-review-card scoped-review-card--compact" data-testid="tuning-rover-review">
          <div className="switch-exercise-card__header">
            <div>
              <strong>Tuning changes in review</strong>
              <p>Staged ground-vehicle tuning changes are collected here before they are written to the controller.</p>
            </div>
            <StatusBadge tone={reviewTone}>{reviewLabel}</StatusBadge>
          </div>

          {roverTuningDraftEntries.length > 0 ? (
            <div className="scoped-draft-list">
              {roverTuningDraftEntries.map((draft) => (
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
              data-testid="apply-rover-tuning-changes-button"
              style={buttonStyle('primary')}
              onClick={() => void handleApplyScopedParameterDrafts(roverTuningDraftEntries, 'rover-tuning:apply', 'Rover tuning')}
              disabled={
                busyAction !== undefined ||
                roverTuningStagedDrafts.length === 0 ||
                roverTuningInvalidDrafts.length > 0 ||
                !canApplyDraftParameters
              }
            >
              {busyAction === 'rover-tuning:apply'
                ? 'Applying…'
                : `Apply Tuning Changes (${roverTuningStagedDrafts.length})`}
            </button>
            <button
              type="button"
              style={buttonStyle()}
              onClick={() => handleDiscardScopedParameterDrafts(roverTuningDraftEntries.map((entry) => entry.id), 'rover tuning')}
              disabled={busyAction !== undefined || roverTuningDraftEntries.length === 0}
            >
              Discard Tuning Changes
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}
