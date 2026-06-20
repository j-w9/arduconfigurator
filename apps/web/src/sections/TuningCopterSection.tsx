// TuningCopterSection — App.tsx's `activeViewId === 'tuning' && isCopterVehicle`
// block, the last big per-view extract. ~820 lines of taskBodySlot JSX
// covering rates / pid-gains / filters / profiles / review subsections.
// Behaviour-neutral verbatim move; the per-subsection JSX, draft slicing,
// and the master-slider preview math all stay byte-identical.

import type { ReactElement } from 'react'
import type { AirframeSummary, ConfiguratorSnapshot, ParameterBackupImportResult, ParameterDraftEntry, ParameterDraftGroup, ParameterState } from '@arduconfig/ardupilot-core'
import { StatusBadge, buttonStyle } from '@arduconfig/ui-kit'

import type { LibraryForms, TuningProfileSourceMode } from '../hooks/use-library-forms'
import type { LibraryStorageNotice } from '../hooks/use-libraries'
import type { ParameterNotice } from '../hooks/use-parameter-feedback'
import type { UseTuningWorkbenchResult } from '../hooks/use-tuning-workbench'
import { formatSnapshotTimestamp } from '../library-helpers'
import { formatParameterDelta, formatParameterValue } from '../parameter-format'
import { readParameterValue } from '../selectors/parameter-read'
import { RateCurveGraph } from '../rate-curve-graph'
import type { SavedTuningProfile } from '../tuning-profile-library'
import { toneForParameterDraftStatus, toneForScopedDraftReview } from '../tone-helpers'
import { formatTuningDisplayValue } from '../tuning-control'
import { TUNING_ALL_PID_PARAM_IDS, TUNING_FILTER_PARAM_IDS } from '../tuning-params'
import { TuningView, type TuningTaskCard, type TuningTaskId } from '../views/Tuning'

interface TuningAxisGroup {
  id: string
  label: string
  paramIds: readonly string[]
  parameters: readonly ParameterState[]
}

export interface TuningCopterSectionDerived {
  airframe: AirframeSummary
  activeTuningTaskId: TuningTaskId
  activeTuningTask: TuningTaskCard
  tuningTaskCards: readonly TuningTaskCard[]
  flightFeelParameters: readonly ParameterState[]
  acroTuningParameters: readonly ParameterState[]
  tuningAccelerationParameters: readonly ParameterState[]
  tuningPidAxisGroups: readonly TuningAxisGroup[]
  tuningAdvancedPidParameters: readonly ParameterState[]
  tuningAdvancedPidAxisGroups: readonly TuningAxisGroup[]
  tuningFilterParameters: readonly ParameterState[]
  tuningFilterAxisGroups: readonly TuningAxisGroup[]
  tuningMasterPreviewEntries: readonly ParameterDraftEntry[]
  tuningMasterDefaultsActive: boolean
  tuningProfileSourceUsesStaged: boolean
  canCreateTuningProfile: boolean
  // Saved profile data + the selected-profile entity diff
  savedTuningProfiles: readonly SavedTuningProfile[]
  selectedTuningProfileId: string | undefined
  selectedTuningProfile: SavedTuningProfile | undefined
  selectedTuningProfileRestore: ParameterBackupImportResult | undefined
  selectedTuningProfileDiffEntries: readonly ParameterDraftEntry[]
  selectedTuningProfileDiffGroups: readonly ParameterDraftGroup[]
  selectedTuningProfileChangedEntries: readonly ParameterDraftEntry[]
  selectedTuningProfileInvalidEntries: readonly ParameterDraftEntry[]
  // Notices specific to the tuning library
  tuningProfileNotice: ParameterNotice | undefined
  tuningProfileStorageNotice: LibraryStorageNotice
  // Per-subsection draft slices
  tuningDraftEntries: readonly ParameterDraftEntry[]
  tuningStagedDrafts: readonly ParameterDraftEntry[]
  tuningInvalidDrafts: readonly ParameterDraftEntry[]
  tuningRateStagedDrafts: readonly ParameterDraftEntry[]
  tuningRateInvalidDrafts: readonly ParameterDraftEntry[]
  tuningPidStagedDrafts: readonly ParameterDraftEntry[]
  tuningPidInvalidDrafts: readonly ParameterDraftEntry[]
  tuningFilterStagedDrafts: readonly ParameterDraftEntry[]
  tuningFilterInvalidDrafts: readonly ParameterDraftEntry[]
}

export interface TuningCopterSectionHandlers {
  handleApplyScopedParameterDrafts: (
    drafts: readonly ParameterDraftEntry[],
    busyKey: string,
    scopeLabel: string
  ) => void | Promise<void>
  handleDiscardScopedParameterDrafts: (paramIds: readonly string[], scopeLabel: string) => void
  handleStageTuningMasterAdjustments: () => void
  handleResetTuningMasterSliders: () => void
  handleStageSelectedTuningProfile: () => void
  handleCreateTuningProfile: () => void | Promise<void>
  handleDeleteSelectedTuningProfile: () => void | Promise<void>
  handleToggleSelectedTuningProfileProtection: () => void | Promise<void>
  setSelectedTuningProfileId: (id: string | undefined) => void
  renderTuningControl: (parameter: ParameterState) => ReactElement
  formatCategoryLabel: (categoryId: string | undefined) => string
}

export interface TuningCopterSectionProps {
  snapshot: ConfiguratorSnapshot
  canApplyDraftParameters: boolean
  busyAction: string | undefined
  parameterNotice: ParameterNotice | undefined
  editedValues: Record<string, string>
  parameterDraftById: ReadonlyMap<string, ParameterDraftEntry>
  tuningWorkbench: UseTuningWorkbenchResult
  forms: LibraryForms
  derived: TuningCopterSectionDerived
  handlers: TuningCopterSectionHandlers
}

export function TuningCopterSection(props: TuningCopterSectionProps): ReactElement {
  const {
    snapshot,
    canApplyDraftParameters,
    busyAction,
    parameterNotice,
    editedValues,
    parameterDraftById,
    tuningWorkbench,
    forms,
    derived,
    handlers
  } = props

  const {
    setTuningTaskOverride,
    tuningRollPitchLinked,
    setTuningRollPitchLinked,
    showAdvancedTuningControls,
    setShowAdvancedTuningControls,
    tuningMasterPiGain,
    setTuningMasterPiGain,
    tuningMasterDGain,
    setTuningMasterDGain,
    tuningMasterFeedforwardGain,
    setTuningMasterFeedforwardGain,
    tuningMasterPitchRatio,
    setTuningMasterPitchRatio,
    tuningMasterFilterStrength,
    setTuningMasterFilterStrength
  } = tuningWorkbench

  const {
    tuningProfileLabelInput,
    setTuningProfileLabelInput,
    tuningProfileNoteInput,
    setTuningProfileNoteInput,
    tuningProfileProtectedInput,
    setTuningProfileProtectedInput,
    tuningProfileSourceInput,
    setTuningProfileSourceInput
  } = forms

  const {
    activeTuningTaskId,
    activeTuningTask,
    tuningTaskCards,
    flightFeelParameters,
    acroTuningParameters,
    tuningAccelerationParameters,
    tuningPidAxisGroups,
    tuningAdvancedPidParameters,
    tuningAdvancedPidAxisGroups,
    tuningFilterParameters,
    tuningFilterAxisGroups,
    tuningMasterPreviewEntries,
    tuningMasterDefaultsActive,
    tuningProfileSourceUsesStaged,
    canCreateTuningProfile,
    savedTuningProfiles,
    selectedTuningProfile,
    selectedTuningProfileDiffEntries,
    selectedTuningProfileDiffGroups,
    selectedTuningProfileChangedEntries,
    selectedTuningProfileInvalidEntries,
    tuningDraftEntries,
    tuningStagedDrafts,
    tuningInvalidDrafts,
    tuningRateStagedDrafts,
    tuningRateInvalidDrafts,
    tuningPidStagedDrafts,
    tuningPidInvalidDrafts,
    tuningFilterStagedDrafts,
    tuningFilterInvalidDrafts,
    tuningProfileNotice,
    tuningProfileStorageNotice
  } = derived

  const {
    handleApplyScopedParameterDrafts,
    handleDiscardScopedParameterDrafts,
    handleStageTuningMasterAdjustments,
    handleResetTuningMasterSliders,
    handleStageSelectedTuningProfile,
    handleCreateTuningProfile,
    handleDeleteSelectedTuningProfile,
    handleToggleSelectedTuningProfileProtection,
    setSelectedTuningProfileId,
    renderTuningControl,
    formatCategoryLabel
  } = handlers

  return (

      <TuningView
        taskCards={tuningTaskCards}
        activeTaskId={activeTuningTaskId}
        activeTask={activeTuningTask}
        onSelectTask={setTuningTaskOverride}
        noticeSlot={
          parameterNotice ? (
            <div className="parameter-review__notice">
              <StatusBadge tone={parameterNotice.tone}>{parameterNotice.tone}</StatusBadge>
              <p>{parameterNotice.text}</p>
            </div>
          ) : null
        }
        taskBodySlot={
          <>
                {activeTuningTaskId === 'rates' ? (
                  <div className="tuning-task-panel tuning-task-panel--stack">
                    <section className="bf-gui-box">
                      <div className="bf-gui-box__titlebar">
                        <strong>Flight Feel</strong>
                      </div>
                      <div className="bf-gui-box__body">
                        <div className="switch-exercise-card__header">
                          <div>
                            <strong>General response</strong>
                            <p>Smoothing, lean angle, and yaw authority for self-leveling and general handling.</p>
                          </div>
                          <StatusBadge tone={toneForScopedDraftReview(tuningRateStagedDrafts.length, tuningRateInvalidDrafts.length)}>
                            {flightFeelParameters.length} controls
                          </StatusBadge>
                        </div>

                        <div className="tuning-control-grid">
                          {flightFeelParameters.map((parameter) => renderTuningControl(parameter))}
                        </div>

                        <ul className="output-note-list">
                          <li>Lower smoothing makes the quad feel more immediate; higher smoothing makes it calmer and softer.</li>
                          <li>Lean-angle changes are shown in degrees here even though `ANGLE_MAX` is stored in centidegrees.</li>
                          <li>Increase yaw values slowly and validate feel with a short hover or line-of-sight test before pushing further.</li>
                        </ul>
                      </div>
                    </section>

                    <section className="bf-gui-box">
                      <div className="bf-gui-box__titlebar">
                        <strong>Acro Rates</strong>
                      </div>
                      <div className="bf-gui-box__body">
                        <div className="switch-exercise-card__header">
                          <div>
                            <strong>Rates, expo, and accel shaping</strong>
                            <p>Curated FPV-style rate shaping backed by real ArduPilot acro-rate and angular-acceleration parameters.</p>
                          </div>
                          <StatusBadge tone="neutral">{acroTuningParameters.length + tuningAccelerationParameters.length} controls</StatusBadge>
                        </div>

                        <div className="tuning-control-grid">
                          {acroTuningParameters.map((parameter) => renderTuningControl(parameter))}
                          {tuningAccelerationParameters.map((parameter) => renderTuningControl(parameter))}
                        </div>

                        <div className="tuning-curve-grid">
                          <RateCurveGraph
                            maxRate={Number(editedValues['ACRO_RP_RATE'] ?? readParameterValue(snapshot, 'ACRO_RP_RATE') ?? 360)}
                            expo={Number(editedValues['ACRO_RP_EXPO'] ?? readParameterValue(snapshot, 'ACRO_RP_EXPO') ?? 0)}
                            label="Roll / Pitch"
                            testId="tuning-rate-curve-roll"
                          />
                          <RateCurveGraph
                            maxRate={Number(editedValues['ACRO_Y_RATE'] ?? readParameterValue(snapshot, 'ACRO_Y_RATE') ?? 180)}
                            expo={Number(editedValues['ACRO_Y_EXPO'] ?? readParameterValue(snapshot, 'ACRO_Y_EXPO') ?? 0)}
                            label="Yaw"
                            color="#dab254"
                            testId="tuning-rate-curve-yaw"
                          />
                        </div>

                        <ul className="output-note-list">
                          <li>Rates set maximum rotation speed. Expo softens the center without reducing full-stick authority.</li>
                          <li>Acceleration limits control how aggressively the controller tries to reach the commanded rate.</li>
                          <li>Keep changes small and save a known-good snapshot before pushing responsiveness higher.</li>
                        </ul>
                      </div>
                    </section>
                  </div>
                ) : null}

                {activeTuningTaskId === 'pid-gains' ? (
                  <div className="tuning-task-panel tuning-task-panel--stack">
                    <section className="bf-gui-box">
                      <div className="bf-gui-box__titlebar">
                        <strong>PID Gains</strong>
                      </div>
                      <div className="bf-gui-box__body">
                        <div className="switch-exercise-card__header">
                          <div>
                            <strong>Axis controller gains</strong>
                            <p>P, I, D, feedforward, and deeper controller limits stay grouped by axis so roll, pitch, and yaw can be reviewed deliberately.</p>
                          </div>
                          <StatusBadge tone={toneForScopedDraftReview(tuningPidStagedDrafts.length, tuningPidInvalidDrafts.length)}>
                            {TUNING_ALL_PID_PARAM_IDS.length} gains
                          </StatusBadge>
                        </div>

                        <div className="tuning-inline-toggle tuning-inline-toggle--review">
                          <div>
                            <strong>Roll / pitch link</strong>
                            <p>
                              Keep roll and pitch coupled while roughing in a baseline tune, then unlink them only if the airframe needs a deliberate
                              asymmetry.
                            </p>
                          </div>
                          <div className="tuning-inline-toggle__actions">
                            <button
                              type="button"
                              data-testid="tuning-roll-pitch-link-button"
                              style={buttonStyle(tuningRollPitchLinked ? 'primary' : 'secondary')}
                              onClick={() => setTuningRollPitchLinked(true)}
                              disabled={tuningRollPitchLinked}
                            >
                              Linked
                            </button>
                            <button
                              type="button"
                              data-testid="tuning-roll-pitch-unlink-button"
                              style={buttonStyle(!tuningRollPitchLinked ? 'primary' : 'secondary')}
                              onClick={() => setTuningRollPitchLinked(false)}
                              disabled={!tuningRollPitchLinked}
                            >
                              Unlink
                            </button>
                          </div>
                        </div>

                        <article className="tuning-master-card">
                          <div className="tuning-master-card__header">
                            <div>
                              <strong>Grouped master sliders</strong>
                              <p>Make a coordinated first-pass change, preview exactly which tuned parameters move, then stage the whole set at once.</p>
                            </div>
                            <StatusBadge tone={tuningMasterDefaultsActive ? 'neutral' : 'warning'}>
                              {tuningMasterPreviewEntries.length > 0 ? `${tuningMasterPreviewEntries.length} preview` : 'neutral'}
                            </StatusBadge>
                          </div>

                          <div className="tuning-master-slider-grid">
                            {[
                              {
                                id: 'pi',
                                label: 'P + I scale',
                                detail: 'Scales roll, pitch, and yaw P/I gains together.',
                                value: tuningMasterPiGain,
                                min: 0.7,
                                max: 1.3,
                                step: 0.01,
                                setValue: setTuningMasterPiGain
                              },
                              {
                                id: 'd',
                                label: 'D scale',
                                detail: 'Raises or lowers derivative damping together across the tune.',
                                value: tuningMasterDGain,
                                min: 0.7,
                                max: 1.3,
                                step: 0.01,
                                setValue: setTuningMasterDGain
                              },
                              {
                                id: 'ff',
                                label: 'Feedforward scale',
                                detail: 'Adjusts stick immediacy without changing the rest of the controller stack.',
                                value: tuningMasterFeedforwardGain,
                                min: 0.7,
                                max: 1.3,
                                step: 0.01,
                                setValue: setTuningMasterFeedforwardGain
                              },
                              {
                                id: 'pitch-ratio',
                                label: 'Pitch ratio',
                                detail: 'Offsets pitch against roll when the airframe genuinely needs a pitch bias.',
                                value: tuningMasterPitchRatio,
                                min: 0.85,
                                max: 1.15,
                                step: 0.01,
                                setValue: setTuningMasterPitchRatio
                              },
                              {
                                id: 'filter',
                                label: 'Filter frequency scale',
                                detail: 'Moves the exposed filter frequencies together without hiding which real params will change.',
                                value: tuningMasterFilterStrength,
                                min: 0.8,
                                max: 1.2,
                                step: 0.01,
                                setValue: setTuningMasterFilterStrength
                              }
                            ].map((slider) => (
                              <label key={`tuning-master:${slider.id}`} className="tuning-master-slider">
                                <div className="tuning-master-slider__header">
                                  <span>
                                    <strong>{slider.label}</strong>
                                    <small>{slider.detail}</small>
                                  </span>
                                  <code>{slider.value.toFixed(2)}x</code>
                                </div>
                                <input
                                  data-testid={`tuning-master-${slider.id}-range`}
                                  type="range"
                                  min={slider.min}
                                  max={slider.max}
                                  step={slider.step}
                                  value={slider.value}
                                  onChange={(event) => slider.setValue(Number(event.target.value))}
                                />
                              </label>
                            ))}
                          </div>

                          {tuningMasterPreviewEntries.length > 0 ? (
                            <div className="config-pills">
                              {tuningMasterPreviewEntries.slice(0, 9).map((entry) => (
                                <span key={`tuning-master-preview:${entry.id}`}>
                                  {entry.label}: {formatParameterValue(entry.nextValue, entry.definition?.unit)}
                                </span>
                              ))}
                              {tuningMasterPreviewEntries.length > 9 ? (
                                <span>+{tuningMasterPreviewEntries.length - 9} more</span>
                              ) : null}
                            </div>
                          ) : (
                            <p className="telemetry-note">
                              Leave every slider at <code>1.00x</code> to keep the preview neutral. The grouped stage button only enables once something
                              moves.
                            </p>
                          )}

                          <div className="switch-exercise-controls">
                            <button
                              type="button"
                              style={buttonStyle()}
                              onClick={handleResetTuningMasterSliders}
                              disabled={tuningMasterDefaultsActive}
                            >
                              Reset Master Sliders
                            </button>
                            <button
                              type="button"
                              data-testid="tuning-stage-master-adjustments-button"
                              style={buttonStyle('primary')}
                              onClick={handleStageTuningMasterAdjustments}
                              disabled={tuningMasterDefaultsActive || tuningMasterPreviewEntries.length === 0}
                            >
                              Stage Grouped Tuning Changes
                            </button>
                          </div>
                        </article>

                        <div className="tuning-axis-grid">
                          {tuningPidAxisGroups.map((group) => (
                            <article key={`tuning-pid-axis:${group.id}`} className="tuning-axis-card">
                              <div className="tuning-axis-card__header">
                                <strong>{group.label}</strong>
                                <span>{group.parameters.length} controls</span>
                              </div>
                              <div className="tuning-control-grid tuning-control-grid--compact">
                                {group.parameters.map((parameter) => renderTuningControl(parameter))}
                              </div>
                            </article>
                          ))}
                        </div>

                        {tuningAdvancedPidParameters.length > 0 ? (
                          <div className="tuning-inline-toggle tuning-inline-toggle--review">
                            <div>
                              <strong>Advanced controller terms</strong>
                              <p>
                                D feedforward, integrator clamps, PD ceilings, and slew limits stay behind a foldout so the baseline PID pass stays clean.
                              </p>
                            </div>
                            <div className="tuning-inline-toggle__actions">
                              <button
                                type="button"
                                data-testid="tuning-toggle-advanced-button"
                                style={buttonStyle(showAdvancedTuningControls ? 'primary' : 'secondary')}
                                onClick={() => setShowAdvancedTuningControls((current) => !current)}
                              >
                                {showAdvancedTuningControls ? 'Hide Advanced Terms' : 'Show Advanced Terms'}
                              </button>
                            </div>
                          </div>
                        ) : null}

                        {showAdvancedTuningControls && tuningAdvancedPidParameters.length > 0 ? (
                          <div className="tuning-axis-grid">
                            {tuningAdvancedPidAxisGroups.map((group) => (
                              <article key={`tuning-advanced-axis:${group.id}`} className="tuning-axis-card">
                                <div className="tuning-axis-card__header">
                                  <strong>{group.label}</strong>
                                  <span>{group.parameters.length} advanced</span>
                                </div>
                                <div className="tuning-control-grid tuning-control-grid--compact">
                                  {group.parameters.map((parameter) => renderTuningControl(parameter))}
                                </div>
                              </article>
                            ))}
                          </div>
                        ) : null}

                        <ul className="output-note-list">
                          <li>Keep roll and pitch close unless the aircraft has a real asymmetry that justifies diverging them.</li>
                          <li>Feedforward increases stick-to-rate immediacy; use it deliberately rather than masking a weak base tune.</li>
                          <li>If you move P, I, or D significantly, re-check filters and do a short test flight before stacking more changes.</li>
                        </ul>
                      </div>
                    </section>
                  </div>
                ) : null}

                {activeTuningTaskId === 'filters' ? (
                  <div className="tuning-task-panel tuning-task-panel--stack">
                    <section className="bf-gui-box">
                      <div className="bf-gui-box__titlebar">
                        <strong>Filters</strong>
                      </div>
                      <div className="bf-gui-box__body">
                        <div className="switch-exercise-card__header">
                          <div>
                            <strong>Axis bandwidth and smoothing</strong>
                            <p>Target, error, and D-term filter frequencies are exposed as one grouped filter pass instead of a raw parameter list.</p>
                          </div>
                          <StatusBadge tone={toneForScopedDraftReview(tuningFilterStagedDrafts.length, tuningFilterInvalidDrafts.length)}>
                            {tuningFilterParameters.length} filters
                          </StatusBadge>
                        </div>

                        <div className="tuning-axis-grid">
                          {tuningFilterAxisGroups.map((group) => (
                            <article key={`tuning-filter-axis:${group.id}`} className="tuning-axis-card">
                              <div className="tuning-axis-card__header">
                                <strong>{group.label}</strong>
                                <span>{group.parameters.length} filters</span>
                              </div>
                              <div className="tuning-control-grid tuning-control-grid--compact">
                                {group.parameters.map((parameter) => renderTuningControl(parameter))}
                              </div>
                            </article>
                          ))}
                        </div>

                        <ul className="output-note-list">
                          <li>Higher filter frequencies preserve response but pass more noise. Lower values smooth noise at the cost of latency.</li>
                          <li>Zero values are valid for some ArduPilot filter parameters and can intentionally disable a filter path.</li>
                          <li>Change filters carefully and listen for noise or oscillation before moving on to more aggressive gain changes.</li>
                        </ul>
                      </div>
                    </section>
                  </div>
                ) : null}

                {activeTuningTaskId === 'profiles' ? (
                  <div className="tuning-task-panel tuning-task-panel--stack">
                    {tuningProfileNotice ? (
                      <div className="parameter-review__notice">
                        <StatusBadge tone={tuningProfileNotice.tone}>{tuningProfileNotice.tone}</StatusBadge>
                        <p>{tuningProfileNotice.text}</p>
                      </div>
                    ) : null}

                    {tuningProfileStorageNotice ? (
                      <div className="parameter-review__notice">
                        <StatusBadge tone={tuningProfileStorageNotice.tone}>{tuningProfileStorageNotice.tone}</StatusBadge>
                        <p>{tuningProfileStorageNotice.text}</p>
                      </div>
                    ) : null}

                    <section className="bf-gui-box">
                      <div className="bf-gui-box__titlebar">
                        <strong>Tuning Profiles</strong>
                      </div>
                      <div className="bf-gui-box__body">
                        <div className="switch-exercise-card__header">
                          <div>
                            <strong>Save known-good tunes</strong>
                            <p>Capture the live or staged tune into a reusable local profile, then restage it later through the same verified review path.</p>
                          </div>
                          <StatusBadge tone={savedTuningProfiles.length > 0 ? 'success' : 'neutral'}>
                            {savedTuningProfiles.length > 0 ? `${savedTuningProfiles.length} saved` : 'empty'}
                          </StatusBadge>
                        </div>

                        <div className="snapshots-form-grid">
                          <label className="snapshots-field">
                            <span>Profile Label</span>
                            <input
                              data-testid="tuning-profile-label-input"
                              type="text"
                              value={tuningProfileLabelInput}
                              onChange={(event) => setTuningProfileLabelInput(event.target.value)}
                              placeholder="5-inch baseline"
                            />
                            <small>Short, build-specific name for the saved tune.</small>
                          </label>

                          <label className="snapshots-field">
                            <span>Source</span>
                            <select
                              data-testid="tuning-profile-source-select"
                              value={tuningProfileSourceInput}
                              onChange={(event) => setTuningProfileSourceInput(event.target.value as TuningProfileSourceMode)}
                            >
                              <option value="staged">Current staged tune</option>
                              <option value="live">Current live controller tune</option>
                            </select>
                            <small>
                              {tuningProfileSourceUsesStaged
                                ? 'Captures the current staged tuning drafts on top of the live baseline.'
                                : 'Captures the controller’s currently synced live tuning values.'}
                            </small>
                          </label>

                          <label className="snapshots-field snapshots-field--wide">
                            <span>Note</span>
                            <textarea
                              data-testid="tuning-profile-note-input"
                              value={tuningProfileNoteInput}
                              onChange={(event) => setTuningProfileNoteInput(event.target.value)}
                              placeholder="Quiet freestyle tune for ducted builds, captured after the first clean hover pass."
                            />
                            <small>Keep notes concise so the saved profile remains easy to scan in the browser library.</small>
                          </label>

                          <label className="snapshots-setting-row snapshots-field--wide">
                            <input
                              type="checkbox"
                              checked={tuningProfileProtectedInput}
                              onChange={(event) => setTuningProfileProtectedInput(event.target.checked)}
                            />
                            <span>
                              <strong>Protect this profile from deletion</strong>
                              <small>Use protection for known-good baselines you do not want removed accidentally from the local browser library.</small>
                            </span>
                          </label>
                        </div>

                        <div className="switch-exercise-controls">
                          <button
                            type="button"
                            data-testid="create-tuning-profile-button"
                            style={buttonStyle('primary')}
                            onClick={handleCreateTuningProfile}
                            disabled={!canCreateTuningProfile}
                          >
                            Create Tuning Profile
                          </button>
                        </div>
                      </div>
                    </section>

                    <div className="tuning-profile-browser">
                      <div className="tuning-profile-browser__rail">
                        <div className="tuning-profile-browser__header">
                          <div>
                            <strong>Saved profiles</strong>
                            <p>Pick a known-good tune to diff or restage.</p>
                          </div>
                          <StatusBadge tone="neutral">{savedTuningProfiles.length}</StatusBadge>
                        </div>

                        {savedTuningProfiles.length > 0 ? (
                          <div className="snapshot-library-grid">
                            {savedTuningProfiles.map((savedProfile) => {
                              const isActive = savedProfile.id === selectedTuningProfile?.id
                              return (
                                <button
                                  key={savedProfile.id}
                                  type="button"
                                  data-testid={`tuning-profile-card-${savedProfile.id}`}
                                  className={`snapshot-card${isActive ? ' is-active' : ''}`}
                                  onClick={() => setSelectedTuningProfileId(savedProfile.id)}
                                >
                                  <div className="snapshot-card__header">
                                    <div>
                                      <strong>{savedProfile.label}</strong>
                                      <small>{formatSnapshotTimestamp(savedProfile.createdAt)}</small>
                                    </div>
                                    <StatusBadge tone={isActive ? 'warning' : 'neutral'}>
                                      {savedProfile.source === 'staged' ? 'staged' : 'live'}
                                    </StatusBadge>
                                  </div>
                                  <div className="config-pills">
                                    <span>{savedProfile.backup.parameterCount} params</span>
                                    {savedProfile.protected ? <span className="is-target">protected</span> : null}
                                  </div>
                                  {savedProfile.note ? <small className="snapshot-card__note">{savedProfile.note}</small> : null}
                                </button>
                              )
                            })}
                          </div>
                        ) : (
                          <div className="snapshots-empty-state tuning-profile-empty">
                            <h4>No tuning profiles yet</h4>
                            <p>Save the current live or staged tune here before experimenting with more aggressive rate, PID, or filter changes.</p>
                          </div>
                        )}
                      </div>

                      <div className="tuning-profile-browser__detail">
                        {selectedTuningProfile ? (
                          <div className="snapshot-selected">
                            <div className="telemetry-header">
                              <div>
                                <h3>{selectedTuningProfile.label}</h3>
                                <p>
                                  {selectedTuningProfile.source === 'staged'
                                    ? 'Built from a staged tune so it can be reapplied later through the normal tuning review flow.'
                                    : 'Built directly from the synced live controller tune.'}
                                </p>
                              </div>
                              <div className="preset-selected__badges">
                                <StatusBadge tone="neutral">{selectedTuningProfile.backup.parameterCount} params</StatusBadge>
                                <StatusBadge tone={selectedTuningProfile.protected ? 'success' : 'neutral'}>
                                  {selectedTuningProfile.protected ? 'protected' : 'editable'}
                                </StatusBadge>
                              </div>
                            </div>

                            <div className="telemetry-metric-grid">
                              <article className="telemetry-metric-card">
                                <span>Changed on live</span>
                                <strong>{selectedTuningProfileChangedEntries.length}</strong>
                              </article>
                              <article className="telemetry-metric-card">
                                <span>Already matched</span>
                                <strong>{selectedTuningProfileDiffEntries.length - selectedTuningProfileChangedEntries.length - selectedTuningProfileInvalidEntries.length}</strong>
                              </article>
                              <article className="telemetry-metric-card">
                                <span>Invalid on live</span>
                                <strong>{selectedTuningProfileInvalidEntries.length}</strong>
                              </article>
                              <article className="telemetry-metric-card">
                                <span>Source</span>
                                <strong>{selectedTuningProfile.source === 'staged' ? 'Staged' : 'Live'}</strong>
                              </article>
                            </div>

                            {selectedTuningProfile.note ? <p className="snapshot-selected__note">{selectedTuningProfile.note}</p> : null}

                            {selectedTuningProfileChangedEntries.length > 0 ? (
                              <div className="parameter-diff-grid">
                                {selectedTuningProfileDiffGroups.map((group) => (
                                  <section key={`tuning-profile-group:${group.category}`} className="parameter-diff-group">
                                    <header>
                                      <strong>{formatCategoryLabel(group.category)}</strong>
                                      <span>{group.entries.length} changed</span>
                                    </header>

                                    {group.entries.map((draft) => (
                                      <div key={`tuning-profile-diff:${draft.id}`} className="parameter-diff-item">
                                        <span>
                                          <strong>{draft.id}</strong>
                                          <small>{draft.label}</small>
                                        </span>
                                        <span className="parameter-diff-values">
                                          {formatParameterValue(draft.currentValue, draft.definition?.unit)} to{' '}
                                          {formatParameterValue(draft.nextValue, draft.definition?.unit)}
                                        </span>
                                        <span className="parameter-diff-delta">{formatParameterDelta(draft.delta, draft.definition?.unit)}</span>
                                      </div>
                                    ))}
                                  </section>
                                ))}
                              </div>
                            ) : (
                              <p className="success-copy">This tuning profile already matches the current live controller values.</p>
                            )}

                            {selectedTuningProfileInvalidEntries.length > 0 ? (
                              <div className="parameter-follow-up parameter-follow-up--warning">
                                <StatusBadge tone="warning">invalid</StatusBadge>
                                <p>
                                  {selectedTuningProfileInvalidEntries.length} saved tuning value(s) are no longer valid against the current live
                                  metadata bounds.
                                </p>
                              </div>
                            ) : null}

                            <div className="switch-exercise-controls">
                              <button
                                type="button"
                                data-testid="stage-selected-tuning-profile-button"
                                style={buttonStyle('primary')}
                                onClick={handleStageSelectedTuningProfile}
                                disabled={!selectedTuningProfile || selectedTuningProfileChangedEntries.length === 0 || selectedTuningProfileInvalidEntries.length > 0}
                              >
                                Stage Selected Profile
                              </button>
                              <button
                                type="button"
                                style={buttonStyle('secondary')}
                                onClick={handleToggleSelectedTuningProfileProtection}
                                disabled={!selectedTuningProfile}
                              >
                                {selectedTuningProfile.protected ? 'Unprotect Profile' : 'Protect Profile'}
                              </button>
                              <button
                                type="button"
                                style={buttonStyle()}
                                onClick={handleDeleteSelectedTuningProfile}
                                disabled={!selectedTuningProfile}
                              >
                                Delete Profile
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="snapshots-empty-state tuning-profile-empty">
                            <h4>No profile selected</h4>
                            <p>Create or choose a saved tuning profile to diff it against the current live controller tune.</p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ) : null}

                {activeTuningTaskId === 'review' ? (
                  <div className="tuning-task-panel tuning-task-panel--stack">
                    <div className="scoped-review-card">
                      <div className="switch-exercise-card__header">
                        <div>
                          <strong>Tuning changes in review</strong>
                          <p>All staged rates, gains, and filters stay grouped here before they are written to the controller.</p>
                        </div>
                        <StatusBadge tone={toneForScopedDraftReview(tuningStagedDrafts.length, tuningInvalidDrafts.length)}>
                          {tuningInvalidDrafts.length > 0
                            ? `${tuningInvalidDrafts.length} invalid`
                            : tuningStagedDrafts.length > 0
                              ? `${tuningStagedDrafts.length} staged`
                              : 'in sync'}
                        </StatusBadge>
                      </div>

                      {tuningDraftEntries.length > 0 ? (
                        <div className="scoped-draft-list">
                          {tuningDraftEntries.map((draft) => (
                            <article key={draft.id} className={`scoped-draft-item scoped-draft-item--${draft.status}`}>
                              <div className="scoped-draft-item__header">
                                <strong>{draft.label}</strong>
                                <StatusBadge tone={toneForParameterDraftStatus(draft.status)}>{draft.status}</StatusBadge>
                              </div>
                              <p>{draft.id}</p>
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
                          data-testid="apply-tuning-changes-button"
                          style={buttonStyle('primary')}
                          onClick={() => void handleApplyScopedParameterDrafts(tuningDraftEntries, 'tuning:apply', 'Tuning')}
                          disabled={
                            busyAction !== undefined ||
                            tuningStagedDrafts.length === 0 ||
                            tuningInvalidDrafts.length > 0 ||
                            !canApplyDraftParameters
                          }
                        >
                          {busyAction === 'tuning:apply' ? 'Applying…' : `Apply Tuning Changes (${tuningStagedDrafts.length})`}
                        </button>
                        <button
                          style={buttonStyle()}
                          onClick={() => handleDiscardScopedParameterDrafts(tuningDraftEntries.map((entry) => entry.id), 'tuning')}
                          disabled={busyAction !== undefined || tuningDraftEntries.length === 0}
                        >
                          Discard Tuning Changes
                        </button>
                      </div>
                    </div>
                  </div>
                ) : null}
          </>
        }
        overviewSlot={
          <div className="tuning-overview__sticky">
                  <div className="telemetry-header">
                    <div>
                      <h3>Tuning overview</h3>
                      <p>Keep the live mode, current curves, and staged change count visible while you work through rates, gains, and filters.</p>
                    </div>
                    <StatusBadge tone={toneForScopedDraftReview(tuningStagedDrafts.length, tuningInvalidDrafts.length)}>
                      {tuningInvalidDrafts.length > 0
                        ? `${tuningInvalidDrafts.length} invalid`
                        : tuningStagedDrafts.length > 0
                          ? `${tuningStagedDrafts.length} staged`
                          : 'in sync'}
                    </StatusBadge>
                  </div>

                  <div className="telemetry-metric-grid">
                    <article className="telemetry-metric-card">
                      <span>Live mode</span>
                      <strong>{snapshot.vehicle?.flightMode ?? 'Unknown'}</strong>
                    </article>
                    <article className="telemetry-metric-card">
                      <span>Staged changes</span>
                      <strong>{tuningStagedDrafts.length}</strong>
                    </article>
                    <article className="telemetry-metric-card">
                      <span>Saved profiles</span>
                      <strong>{savedTuningProfiles.length}</strong>
                    </article>
                  </div>

                  <div className="config-pills">
                    <span>{flightFeelParameters.length + tuningAccelerationParameters.length + acroTuningParameters.length} rate controls</span>
                    <span>{TUNING_ALL_PID_PARAM_IDS.length} PID terms</span>
                    <span>{TUNING_FILTER_PARAM_IDS.length} filters</span>
                    <span>{tuningAdvancedPidParameters.length} advanced exposed</span>
                    <span>{snapshot.liveVerification.rcInput.verified ? 'RC link verified' : 'RC telemetry pending'}</span>
                  </div>

                  <div className="scoped-review-card scoped-review-card--compact">
                    <div className="switch-exercise-card__header">
                      <div>
                        <strong>Rate preview</strong>
                        <p>Roll/pitch and yaw curves update immediately from the staged rate and expo values.</p>
                      </div>
                      <StatusBadge tone="neutral">live preview</StatusBadge>
                    </div>

                    <div className="tuning-curve-grid">
                      <RateCurveGraph
                        maxRate={Number(editedValues['ACRO_RP_RATE'] ?? readParameterValue(snapshot, 'ACRO_RP_RATE') ?? 360)}
                        expo={Number(editedValues['ACRO_RP_EXPO'] ?? readParameterValue(snapshot, 'ACRO_RP_EXPO') ?? 0)}
                        label="Roll / Pitch"
                      />
                      <RateCurveGraph
                        maxRate={Number(editedValues['ACRO_Y_RATE'] ?? readParameterValue(snapshot, 'ACRO_Y_RATE') ?? 180)}
                        expo={Number(editedValues['ACRO_Y_EXPO'] ?? readParameterValue(snapshot, 'ACRO_Y_EXPO') ?? 0)}
                        label="Yaw"
                        color="#dab254"
                      />
                    </div>
                  </div>

                  <div className="scoped-review-card scoped-review-card--compact">
                    <div className="switch-exercise-card__header">
                      <div>
                        <strong>Controller snapshot</strong>
                        <p>Current live gains and filter ceilings for each axis, based on the controller values or staged drafts above them.</p>
                      </div>
                      <StatusBadge tone="neutral">axis view</StatusBadge>
                    </div>

                    <div className="tuning-axis-snapshot-grid">
                      {tuningPidAxisGroups.map((group, index) => {
                        const filterGroup = tuningFilterAxisGroups[index]
                        const advancedGroup = tuningAdvancedPidAxisGroups[index]
                        return (
                          <article key={`tuning-axis-snapshot:${group.id}`} className="tuning-axis-snapshot">
                            <div className="tuning-axis-card__header">
                              <strong>{group.label}</strong>
                              <span>
                                {group.parameters.length + (filterGroup?.parameters.length ?? 0) + (advancedGroup?.parameters.length ?? 0)} values
                              </span>
                            </div>
                            <div className="config-pills">
                              {group.parameters.map((parameter) => (
                                <span key={`snapshot-pid:${group.id}:${parameter.id}`}>
                                  {(parameter.definition?.label
                                    ? parameter.definition.label
                                        .replace(`${group.label} `, '')
                                        .replace(' Gain', '')
                                        .replace('Feedforward', 'FF')
                                    : parameter.id)}
                                  :{' '}
                                  {formatTuningDisplayValue(parameter, parameterDraftById.get(parameter.id)?.nextValue ?? parameter.value)}
                                </span>
                              ))}
                            </div>
                            {filterGroup ? (
                              <div className="config-pills">
                                {filterGroup.parameters.map((parameter) => (
                                  <span key={`snapshot-filter:${group.id}:${parameter.id}`}>
                                    {(parameter.definition?.label ? parameter.definition.label.replace(`${group.label} `, '') : parameter.id)}:{' '}
                                    {formatTuningDisplayValue(parameter, parameterDraftById.get(parameter.id)?.nextValue ?? parameter.value)}
                                  </span>
                                ))}
                              </div>
                            ) : null}
                            {advancedGroup && advancedGroup.parameters.length > 0 ? (
                              <div className="config-pills">
                                {advancedGroup.parameters.map((parameter) => (
                                  <span key={`snapshot-advanced:${group.id}:${parameter.id}`}>
                                    {(parameter.definition?.label ? parameter.definition.label.replace(`${group.label} `, '') : parameter.id)}:{' '}
                                    {formatTuningDisplayValue(parameter, parameterDraftById.get(parameter.id)?.nextValue ?? parameter.value)}
                                  </span>
                                ))}
                              </div>
                            ) : null}
                          </article>
                        )
                      })}
                    </div>
                  </div>
                </div>
        }
      />

  )
}
