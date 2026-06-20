// PlaneSoaringAdsbSection — the curated ArduPlane Soaring (SOAR_*) and ADS-B /
// avoidance (ADSB_* / AVD_*) configuration surface. Mirrors TuningPlaneSection:
// an ADDITIVE editor that surfaces real, documented, catalog-backed params
// through the shared ScopedField controls and the staged-draft machinery
// (setDraft -> parameterDraftById -> handleApplyScopedParameterDrafts). It adds
// NO new write or draft semantics — the scoped apply/discard is the same path
// the Receiver / Config / Power / Tuning surfaces use.
//
// Two top-level groups, each gated on its hardware enable so a plane that is
// not soaring / has no transponder never sees the editor:
//   - Soaring — gated visible on SOAR_ENABLE = 1 (the @PARAM_FLAG_ENABLE).
//   - ADS-B & Avoidance — gated on ADSB_TYPE != 0 (0 = ADS-B disabled).
// The enable toggles themselves always render so the operator can turn the
// feature on; the rest of each group appears once enabled.

import type { ReactElement } from 'react'
import type { ConfiguratorSnapshot, ParameterDraftEntry, ParameterState } from '@arduconfig/ardupilot-core'
import { StatusBadge, buttonStyle } from '@arduconfig/ui-kit'

import { formatParameterValue } from '../parameter-format'
import {
  PLANE_ADSB_DEVICE_PARAM_IDS,
  PLANE_ADSB_IDENTITY_PARAM_IDS,
  PLANE_ADSB_LIST_PARAM_IDS,
  PLANE_ADSB_TYPE_PARAM_ID,
  PLANE_AVOIDANCE_PARAM_IDS,
  PLANE_SOARING_ALTITUDE_PARAM_IDS,
  PLANE_SOARING_BEHAVIOUR_PARAM_IDS,
  PLANE_SOARING_ENABLE_PARAM_ID,
  PLANE_SOARING_ESTIMATOR_PARAM_IDS,
  PLANE_SOARING_POLAR_PARAM_IDS,
  PLANE_SOARING_TRIGGER_PARAM_IDS
} from '../plane-soaring-adsb-params'
import { readRoundedParameter, selectParameterById } from '../selectors/parameter-read'
import { toneForParameterDraftStatus, toneForScopedDraftReview } from '../tone-helpers'
import { ScopedBitmaskField, ScopedField, ScopedSelectField } from '../views/ScopedField'

export interface PlaneSoaringAdsbSectionProps {
  snapshot: ConfiguratorSnapshot
  canApplyDraftParameters: boolean
  busyAction: string | undefined
  editedValues: Record<string, string>
  parameterDraftById: ReadonlyMap<string, ParameterDraftEntry>
  planeSoaringAdsbDraftEntries: readonly ParameterDraftEntry[]
  planeSoaringAdsbStagedDrafts: readonly ParameterDraftEntry[]
  planeSoaringAdsbInvalidDrafts: readonly ParameterDraftEntry[]
  setDraft: (paramId: string, value: string) => void
  handleApplyScopedParameterDrafts: (
    drafts: readonly ParameterDraftEntry[],
    busyKey: string,
    scopeLabel: string
  ) => void | Promise<void>
  handleDiscardScopedParameterDrafts: (paramIds: readonly string[], scopeLabel: string) => void
}

export function PlaneSoaringAdsbSection(props: PlaneSoaringAdsbSectionProps): ReactElement {
  const {
    snapshot,
    canApplyDraftParameters,
    busyAction,
    editedValues,
    parameterDraftById,
    planeSoaringAdsbDraftEntries,
    planeSoaringAdsbStagedDrafts,
    planeSoaringAdsbInvalidDrafts,
    setDraft,
    handleApplyScopedParameterDrafts,
    handleDiscardScopedParameterDrafts
  } = props

  // Resolve paramIds to live ParameterState, dropping any the controller does
  // not stream — same omit-if-missing behaviour as TuningPlaneSection.
  const resolve = (paramIds: readonly string[]): ParameterState[] =>
    paramIds
      .map((id) => selectParameterById(snapshot, id))
      .filter((parameter): parameter is ParameterState => parameter !== undefined)

  const soarEnableParameter = selectParameterById(snapshot, PLANE_SOARING_ENABLE_PARAM_ID)
  const adsbTypeParameter = selectParameterById(snapshot, PLANE_ADSB_TYPE_PARAM_ID)

  // Gate group bodies on the live (or staged) enable value so the editor only
  // expands once the feature is on. SOAR_ENABLE is 0/1; ADSB_TYPE is 0 = off.
  const soarEnableValue = Number(
    editedValues[PLANE_SOARING_ENABLE_PARAM_ID] ?? readRoundedParameter(snapshot, PLANE_SOARING_ENABLE_PARAM_ID) ?? 0
  )
  const soaringActive = soarEnableValue === 1
  const adsbTypeValue = Number(
    editedValues[PLANE_ADSB_TYPE_PARAM_ID] ?? readRoundedParameter(snapshot, PLANE_ADSB_TYPE_PARAM_ID) ?? 0
  )
  const adsbActive = adsbTypeValue !== 0

  const soaringTrigger = soaringActive ? resolve(PLANE_SOARING_TRIGGER_PARAM_IDS) : []
  const soaringEstimator = soaringActive ? resolve(PLANE_SOARING_ESTIMATOR_PARAM_IDS) : []
  const soaringAltitude = soaringActive ? resolve(PLANE_SOARING_ALTITUDE_PARAM_IDS) : []
  const soaringPolar = soaringActive ? resolve(PLANE_SOARING_POLAR_PARAM_IDS) : []
  const soaringBehaviour = soaringActive ? resolve(PLANE_SOARING_BEHAVIOUR_PARAM_IDS) : []

  const adsbDevice = adsbActive ? resolve(PLANE_ADSB_DEVICE_PARAM_IDS) : []
  const adsbList = adsbActive ? resolve(PLANE_ADSB_LIST_PARAM_IDS) : []
  const adsbIdentity = adsbActive ? resolve(PLANE_ADSB_IDENTITY_PARAM_IDS) : []
  const avoidance = adsbActive ? resolve(PLANE_AVOIDANCE_PARAM_IDS) : []

  // Pick the right control per parameter: bitmask -> checkbox grid, enumerated
  // options -> dropdown, otherwise a numeric input. Same dispatch the generic
  // metadata editor uses.
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
    if ((parameter.definition?.options?.length ?? 0) > 0) {
      return <ScopedSelectField {...common} />
    }
    return <ScopedField {...common} />
  }

  const renderGroup = (
    testid: string,
    label: string,
    parameters: ParameterState[]
  ): ReactElement | null =>
    parameters.length > 0 ? (
      <article className="tuning-axis-card" data-testid={testid}>
        <div className="tuning-axis-card__header">
          <strong>{label}</strong>
          <span>{parameters.length} controls</span>
        </div>
        <div className="tuning-control-grid tuning-control-grid--compact">{parameters.map(renderField)}</div>
      </article>
    ) : null

  const reviewTone = toneForScopedDraftReview(
    planeSoaringAdsbStagedDrafts.length,
    planeSoaringAdsbInvalidDrafts.length
  )
  const reviewLabel =
    planeSoaringAdsbInvalidDrafts.length > 0
      ? `${planeSoaringAdsbInvalidDrafts.length} invalid`
      : planeSoaringAdsbStagedDrafts.length > 0
        ? `${planeSoaringAdsbStagedDrafts.length} staged`
        : 'in sync'

  return (
    <section className="bf-gui-box" data-testid="plane-soaring-adsb-section">
      <div className="bf-gui-box__titlebar">
        <strong>ArduPlane Soaring & ADS-B</strong>
        <StatusBadge tone={reviewTone}>{reviewLabel}</StatusBadge>
      </div>
      <div className="bf-gui-box__body">
        <p className="bf-note">
          Curated fixed-wing soaring and ADS-B surfaces. Each control is the real ArduPilot parameter from the loaded
          catalog — edits stage here and apply through the same verified review path as the other tabs, so nothing is
          written until you apply.
        </p>

        <article className="tuning-axis-card" data-testid="plane-soaring-group">
          <div className="tuning-axis-card__header">
            <strong>Soaring</strong>
            <span>{soaringActive ? `SOAR_ENABLE = ${soarEnableValue}` : 'disabled'}</span>
          </div>
          <p className="bf-note">
            Autonomous thermalling. With soaring enabled the aircraft estimates thermals and switches between climbing
            and cruising in FBWB / CRUISE / AUTO / LOITER. Set the glide polar and altitude band for your airframe
            before the first autonomous soar.
          </p>
          {soarEnableParameter ? (
            <div className="tuning-control-grid tuning-control-grid--compact" data-testid="plane-soaring-enable">
              {renderField(soarEnableParameter)}
            </div>
          ) : (
            <p className="bf-note">The connected controller is not reporting SOAR_ENABLE (no soaring support).</p>
          )}
          {soaringActive ? (
            <>
              {renderGroup('plane-soaring-trigger', 'Trigger & timing', soaringTrigger)}
              {renderGroup('plane-soaring-estimator', 'Thermal estimator (EKF)', soaringEstimator)}
              {renderGroup('plane-soaring-altitude', 'Altitude band', soaringAltitude)}
              {renderGroup('plane-soaring-polar', 'Glide polar', soaringPolar)}
              {renderGroup('plane-soaring-behaviour', 'Thermalling & cruise behaviour', soaringBehaviour)}
            </>
          ) : null}
        </article>

        <article className="tuning-axis-card" data-testid="plane-adsb-group">
          <div className="tuning-axis-card__header">
            <strong>ADS-B & Avoidance</strong>
            <span>{adsbActive ? `ADSB_TYPE = ${adsbTypeValue}` : 'disabled'}</span>
          </div>
          <p className="bf-note">
            ADS-B transponder / receiver hardware plus the ADS-B traffic-avoidance behaviour. ADSB_TYPE = 0 disables
            ADS-B entirely. The identity and dimension fields are broadcast on ADS-B-out and must match the aircraft
            registration when transmitting.
          </p>
          {adsbTypeParameter ? (
            <div className="tuning-control-grid tuning-control-grid--compact" data-testid="plane-adsb-type">
              {renderField(adsbTypeParameter)}
            </div>
          ) : (
            <p className="bf-note">The connected controller is not reporting ADSB_TYPE (no ADS-B support).</p>
          )}
          {adsbActive ? (
            <>
              {renderGroup('plane-adsb-device', 'Transceiver & RF', adsbDevice)}
              {renderGroup('plane-adsb-list', 'Traffic list filters', adsbList)}
              {renderGroup('plane-adsb-identity', 'Identity & dimensions', adsbIdentity)}
              {renderGroup('plane-avoidance', 'Traffic avoidance (AVD_)', avoidance)}
            </>
          ) : null}
        </article>

        <div className="scoped-review-card scoped-review-card--compact" data-testid="plane-soaring-adsb-review">
          <div className="switch-exercise-card__header">
            <div>
              <strong>Soaring / ADS-B changes in review</strong>
              <p>Staged soaring and ADS-B changes are collected here before they are written to the controller.</p>
            </div>
            <StatusBadge tone={reviewTone}>{reviewLabel}</StatusBadge>
          </div>

          {planeSoaringAdsbDraftEntries.length > 0 ? (
            <div className="scoped-draft-list">
              {planeSoaringAdsbDraftEntries.map((draft) => (
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
            <p className="success-copy">No soaring or ADS-B changes are staged right now.</p>
          )}

          <div className="switch-exercise-controls">
            <button
              type="button"
              data-testid="apply-plane-soaring-adsb-changes-button"
              style={buttonStyle('primary')}
              onClick={() =>
                void handleApplyScopedParameterDrafts(
                  planeSoaringAdsbDraftEntries,
                  'plane-soaring-adsb:apply',
                  'Plane soaring / ADS-B'
                )
              }
              disabled={
                busyAction !== undefined ||
                planeSoaringAdsbStagedDrafts.length === 0 ||
                planeSoaringAdsbInvalidDrafts.length > 0 ||
                !canApplyDraftParameters
              }
            >
              {busyAction === 'plane-soaring-adsb:apply'
                ? 'Applying…'
                : `Apply Soaring / ADS-B Changes (${planeSoaringAdsbStagedDrafts.length})`}
            </button>
            <button
              type="button"
              style={buttonStyle()}
              onClick={() =>
                handleDiscardScopedParameterDrafts(
                  planeSoaringAdsbDraftEntries.map((entry) => entry.id),
                  'plane soaring / ADS-B'
                )
              }
              disabled={busyAction !== undefined || planeSoaringAdsbDraftEntries.length === 0}
            >
              Discard Soaring / ADS-B Changes
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}
