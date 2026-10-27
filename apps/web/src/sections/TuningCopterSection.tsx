// TuningCopterSection — App.tsx's `activeViewId === 'tuning' && isCopterVehicle`
// block, the last big per-view extract. ~820 lines of taskBodySlot JSX
// covering rates / pid-gains / filters / profiles / review subsections.
// Behaviour-neutral verbatim move; the per-subsection JSX, draft slicing,
// and the master-slider preview math all stay byte-identical.

import type { ReactElement, ReactNode } from 'react'
import type { AirframeSummary, ConfiguratorSnapshot, ParameterBackupImportResult, ParameterDraftEntry, ParameterDraftGroup, ParameterState } from '@arduconfig/ardupilot-core'
import { StatusBadge, buttonStyle } from '@arduconfig/ui-kit'

import type { LibraryForms, TuningProfileSourceMode } from '../hooks/use-library-forms'
import type { LibraryStorageNotice } from '../hooks/use-libraries'
import type { ParameterNotice } from '../hooks/use-parameter-feedback'
import type { UseTuningWorkbenchResult } from '../hooks/use-tuning-workbench'
import { formatSnapshotTimestamp } from '../library-helpers'
import { formatParameterDelta, formatParameterValue } from '../parameter-format'
import type { SavedTuningProfile } from '../tuning-profile-library'
import { toneForScopedDraftReview } from '../tone-helpers'
import { InfoDot } from '../views/InfoDot'
import { TuningView, type TuningTaskCard, type TuningTaskId } from '../views/Tuning'


export interface TuningCopterSectionDerived {
  airframe: AirframeSummary
  activeTuningTaskId: TuningTaskId
  activeTuningTask: TuningTaskCard
  tuningTaskCards: readonly TuningTaskCard[]
  tuningFilterParameters: readonly ParameterState[]
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
  tuningFilterStagedDrafts: readonly ParameterDraftEntry[]
  tuningFilterInvalidDrafts: readonly ParameterDraftEntry[]
}

export interface TuningCopterSectionHandlers {
  handleStageSelectedTuningProfile: () => void
  handleCreateTuningProfile: () => void | Promise<void>
  handleDeleteSelectedTuningProfile: () => void | Promise<void>
  handleToggleSelectedTuningProfileProtection: () => void | Promise<void>
  setSelectedTuningProfileId: (id: string | undefined) => void
  formatCategoryLabel: (categoryId: string | undefined) => string
}

export interface TuningCopterSectionProps {
  snapshot: ConfiguratorSnapshot
  parameterNotice: ParameterNotice | undefined
  editedValues: Record<string, string>
  parameterDraftById: ReadonlyMap<string, ParameterDraftEntry>
  tuningWorkbench: UseTuningWorkbenchResult
  forms: LibraryForms
  derived: TuningCopterSectionDerived
  handlers: TuningCopterSectionHandlers
  /** The ArduCopter AUTOTUNE surface, rendered in the task body when the
   *  'autotune' tab is active (kept a slot so App owns its disjoint draft scope). */
  autotuneSlot?: ReactNode
  logTuningSlot?: ReactNode
  /** Starting-point tuning, rendered in the task body on the 'initial-tune' tab. */
  initialTuneSlot?: ReactNode
  /** Notch suggestions and warnings, rendered under the Filters grid. */
  filterNotchSlot?: ReactNode
  /** The FILTn bank, when the firmware has one. Expert-only: raw per-slot
   *  notch fields, rendered with the manual grid rather than before it. */
  /** Pilot ▸ Alt Hold: the altitude controller's gains and the hover-throttle check. */
  /** Pilot: the Angle / Acro / limits stick-feel cards, in place of the slider boxes. */
  pilotFeelSlot?: ReactNode
  /** PID Gains: the Roll | Pitch | Yaw grid, in place of the slider cards. */
  pidGainsSlot?: ReactNode
  /** Notches: Notch 1 | Notch 2 grid and the filter bank, in place of the cards. */
  notchesSlot?: ReactNode
  /** Filters: the manual sensor + Roll | Pitch | Yaw filter grids. */
  filterManualSlot?: ReactNode
  /** Expert mode breaks out the raw per-parameter filter grid. See the Filters
   *  task body for why it is not the default surface. */
  isExpertMode: boolean
}

export function TuningCopterSection(props: TuningCopterSectionProps): ReactElement {
  const {
    parameterNotice,
    autotuneSlot,
    logTuningSlot,
    initialTuneSlot,
    filterNotchSlot,
    isExpertMode,
    pilotFeelSlot,
    pidGainsSlot,
    notchesSlot,
    filterManualSlot,
    tuningWorkbench,
    forms,
    derived,
    handlers
  } = props

  const {
    setTuningTaskOverride
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
    tuningFilterParameters,
    tuningProfileSourceUsesStaged,
    canCreateTuningProfile,
    savedTuningProfiles,
    selectedTuningProfile,
    selectedTuningProfileDiffEntries,
    selectedTuningProfileDiffGroups,
    selectedTuningProfileChangedEntries,
    selectedTuningProfileInvalidEntries,
    tuningFilterStagedDrafts,
    tuningFilterInvalidDrafts,
    tuningProfileNotice,
    tuningProfileStorageNotice
  } = derived

  const {
    handleStageSelectedTuningProfile,
    handleCreateTuningProfile,
    handleDeleteSelectedTuningProfile,
    handleToggleSelectedTuningProfileProtection,
    setSelectedTuningProfileId,
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
                    {pilotFeelSlot}
                  </div>
                ) : null}

                {activeTuningTaskId === 'pid-gains' ? (
                  <div className="tuning-task-panel tuning-task-panel--stack">{pidGainsSlot}</div>
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
                            <span className="tuning-card-title">
                              <strong>Bandwidth and smoothing</strong>
                              <InfoDot label="About axis bandwidth and smoothing" testId="tuning-info-filters" wide wikiTopic="tuningFilters">
                                <span className="info-dot-line">Higher filter frequencies preserve response but pass more noise. Lower values smooth noise at the cost of latency.</span>
                                <span className="info-dot-line">Zero values are valid for some ArduPilot filter parameters and can intentionally disable a filter path.</span>
                                <span className="info-dot-line">Change filters carefully and listen for noise or oscillation before moving on to more aggressive gain changes.</span>
                              </InfoDot>
                            </span>
                          </div>
                          <StatusBadge tone={toneForScopedDraftReview(tuningFilterStagedDrafts.length, tuningFilterInvalidDrafts.length)}>
                            {tuningFilterParameters.length} filters
                          </StatusBadge>
                        </div>

                        {/* Derived first, raw second.
                          *
                          * These two surfaces edit overlapping parameters: the
                          * grid below offers INS_GYRO_FILTER and the rate-loop
                          * frequencies as individual fields, and the panel here
                          * derives those same frequencies from one gyro cutoff
                          * using ArduPilot's own ratios. The derived version is
                          * the better answer -- it keeps FLTD at gyro/2 and
                          * gyro/4 instead of leaving three fields to be kept
                          * consistent by hand -- but it was at the BOTTOM of the
                          * page, so the first thing anyone met was the harder
                          * way to do the same job.
                          *
                          * So it leads, and in basic mode it is the only filter
                          * surface. Expert mode adds the raw grid back as an
                          * override, which is what Expert is for everywhere else
                          * in this app.
                          *
                          * Note the grid is NOT fully redundant: INS_ACCEL_FILTER,
                          * ATC_RAT_{RLL,PIT}_FLTE, INS_HNTCH_HMNCS and
                          * INS_HNTCH_FM_RAT have no derived counterpart, so they
                          * are Expert-only now. They are left out of the derived
                          * panel deliberately rather than given invented ratios --
                          * filters-from-gyro.ts carries only rules ArduPilot
                          * documents, and a made-up one would be worse than a
                          * gate. */}
                        {filterNotchSlot}

                        {isExpertMode ? filterManualSlot : null}
                      </div>
                    </section>
                  </div>
                ) : null}

                {activeTuningTaskId === 'notches' ? (
                  <div className="tuning-task-panel tuning-task-panel--stack" data-testid="tuning-notches-panel">
                    {notchesSlot}
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

                    <section className="bf-gui-box pilot-feel-card" data-testid="tuning-profile-save">
                      <div className="bf-gui-box__titlebar">
                        <strong>Save current tune</strong>
                        <small className="pilot-feel-card__modes">
                          {savedTuningProfiles.length > 0 ? `${savedTuningProfiles.length} saved` : 'none saved yet'}
                        </small>
                      </div>
                      <div className="bf-gui-box__body">
                        <div className="tuning-profile-save">
                          <input
                            data-testid="tuning-profile-label-input"
                            type="text"
                            aria-label="Profile name"
                            value={tuningProfileLabelInput}
                            onChange={(event) => setTuningProfileLabelInput(event.target.value)}
                            placeholder="Name, e.g. 5-inch baseline"
                          />
                          <select
                            data-testid="tuning-profile-source-select"
                            aria-label="What to save"
                            value={tuningProfileSourceInput}
                            onChange={(event) => setTuningProfileSourceInput(event.target.value as TuningProfileSourceMode)}
                            title={
                              tuningProfileSourceUsesStaged
                                ? 'The live tune with your staged drafts on top.'
                                : 'The tune on the vehicle now.'
                            }
                          >
                            <option value="staged">Live + staged changes</option>
                            <option value="live">Live tune only</option>
                          </select>
                          <button
                            type="button"
                            data-testid="create-tuning-profile-button"
                            style={buttonStyle('primary')}
                            onClick={handleCreateTuningProfile}
                            disabled={!canCreateTuningProfile}
                          >
                            Save
                          </button>
                        </div>
                        <div className="tuning-profile-save tuning-profile-save--extra">
                          <input
                            data-testid="tuning-profile-note-input"
                            type="text"
                            aria-label="Note"
                            value={tuningProfileNoteInput}
                            onChange={(event) => setTuningProfileNoteInput(event.target.value)}
                            placeholder="Note (optional)"
                          />
                          <label className="pid-gains__link">
                            <input
                              type="checkbox"
                              checked={tuningProfileProtectedInput}
                              onChange={(event) => setTuningProfileProtectedInput(event.target.checked)}
                            />{' '}
                            Protect from deletion
                          </label>
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
                                    ? 'Built from a staged tune so it can be restaged later and written from the draft bar.'
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

                {activeTuningTaskId === 'autotune' ? (
                  <div className="tuning-task-panel tuning-task-panel--stack" data-testid="tuning-autotune-panel">
                    {autotuneSlot}
                  </div>
                ) : null}

                {activeTuningTaskId === 'log-tuning' ? (
                  <div className="tuning-task-panel tuning-task-panel--stack" data-testid="tuning-log-tuning-panel">
                    {logTuningSlot}
                  </div>
                ) : null}

                {activeTuningTaskId === 'initial-tune' ? (
                  <div className="tuning-task-panel tuning-task-panel--stack" data-testid="tuning-initial-tune-panel">
                    {initialTuneSlot}
                  </div>
                ) : null}
          </>
        }
      />

  )
}
