// ParametersSection — App.tsx's expert-only `activeViewId === 'parameters'`
// block (~360 lines): raw parameter table with search, per-row inline edit,
// staged / invalid / reboot-required draft groups, the import-backup file
// input + three export buttons, and the selected-parameter detail card.

import { useEffect, useMemo, useRef, useState } from 'react'
import type { Dispatch, ReactElement, RefObject, SetStateAction } from 'react'
import type { ConfiguratorSnapshot, ParameterDraftEntry, ParameterDraftGroup, ParameterDraftSummary, ParameterImportCategory, ParameterState } from '@arduconfig/ardupilot-core'
import type { NormalizedFirmwareMetadataBundle } from '@arduconfig/param-metadata'
import { Panel, StatusBadge, buttonStyle } from '@arduconfig/ui-kit'

import {
  describeBitmaskDraftValue,
  findParameterOption,
  formatParameterDelta,
  formatParameterDisplayValue,
  formatParameterRange,
  formatParameterStep,
  formatParameterValue,
  formatParameterDraftValue
} from '../parameter-format'
import { ScopedBitmaskPopover } from '../views/ScopedField'
import { parameterApplyBlockedReason } from '../apply-gate'
import { applyDraftSelectionClick, pruneDraftSelection } from '../view-models/draft-selection'
import { parameterSearchPredicate } from '../view-models/filtered-parameters'
import { toneForParameterDraftStatus } from '../tone-helpers'
import type { ParameterFollowUp, ParameterNotice } from '../hooks/use-parameter-feedback'

export interface ParametersSectionProps {
  snapshot: ConfiguratorSnapshot
  metadataCatalog: NormalizedFirmwareMetadataBundle
  canApplyDraftParameters: boolean
  canApplyAllDraftParameters: boolean
  busyAction: string | undefined
  /** Label for the Apply-All button while the batch write is in flight, e.g. "Writing… (12/200)". */
  applyAllBusyLabel: string
  editedValues: Record<string, string>
  parameterNotice: ParameterNotice | undefined
  parameterFollowUp: ParameterFollowUp | undefined
  formatCategoryLabel: (categoryId: string | undefined) => string
  parameterSearch: string
  setParameterSearch: Dispatch<SetStateAction<string>>
  selectedParameterId: string | undefined
  setSelectedParameterId: Dispatch<SetStateAction<string | undefined>>
  filteredParameters: readonly ParameterState[]
  parameterDraftSummary: ParameterDraftSummary
  parameterDraftById: ReadonlyMap<string, ParameterDraftEntry>
  stagedParameterGroups: readonly ParameterDraftGroup[]
  invalidParameterGroups: readonly ParameterDraftGroup[]
  rebootRequiredDrafts: readonly ParameterDraftEntry[]
  stagedParameterDrafts: readonly ParameterDraftEntry[]
  parameterBackupInputRef: RefObject<HTMLInputElement | null>
  setDraft: (paramId: string, value: string) => void
  onApplyAllParameterDrafts: () => void | Promise<void>
  onDiscardAllParameterDrafts: () => void
  onApplyParameterDraft: (draft: ParameterDraftEntry) => void | Promise<void>
  onDiscardParameterDraft: (paramId: string) => void
  onOpenParameterBackup: () => void
  /** Opt-in categories to strip from the next backup import (all false = none). */
  parameterImportExclusions: Record<ParameterImportCategory, boolean>
  onToggleParameterImportExclusion: (category: ParameterImportCategory) => void
  onExportParameterBackup: () => void
  onExportParameterBackupAsParm: () => void
  onExportParameterBackupAsParams: () => void
  onImportParameterBackup: (event: React.ChangeEvent<HTMLInputElement>) => void | Promise<void>
  /** Pull the parameter list fresh from the FC — bypasses the auto-refresh
   *  and gives the operator a manual re-sync button inline in the toolbar. */
  onRefreshParameters: () => void | Promise<void>
  /** True when a refresh / pull is in flight; used to disable the button. */
  refreshDisabled: boolean
  /** Set of paramIds that the operator has chosen to "Override and write
   *  anyway" — only applies to enum-mismatch invalidity, since metadata
   *  can lag firmware on legitimate new enum values. */
  parameterEnumOverrides: ReadonlySet<string>
  onToggleParameterEnumOverride: (paramId: string) => void
}

export function ParametersSection(props: ParametersSectionProps): ReactElement {
  const {
    snapshot,
    metadataCatalog,
    canApplyDraftParameters,
    canApplyAllDraftParameters,
    busyAction,
    applyAllBusyLabel,
    editedValues,
    parameterNotice,
    parameterFollowUp,
    formatCategoryLabel,
    parameterSearch,
    setParameterSearch,
    selectedParameterId,
    setSelectedParameterId,
    filteredParameters,
    parameterDraftSummary,
    parameterDraftById,
    stagedParameterGroups,
    invalidParameterGroups,
    rebootRequiredDrafts,
    stagedParameterDrafts,
    parameterBackupInputRef,
    setDraft,
    onApplyAllParameterDrafts: handleApplyAllParameterDrafts,
    onDiscardAllParameterDrafts: handleDiscardAllParameterDrafts,
    onApplyParameterDraft: handleApplyParameterDraft,
    onDiscardParameterDraft: handleDiscardParameterDraft,
    onOpenParameterBackup: handleOpenParameterBackup,
    parameterImportExclusions,
    onToggleParameterImportExclusion: handleToggleParameterImportExclusion,
    onExportParameterBackup: handleExportParameterBackup,
    onExportParameterBackupAsParm: handleExportParameterBackupAsParm,
    onExportParameterBackupAsParams: handleExportParameterBackupAsParams,
    onImportParameterBackup: handleImportParameterBackup,
    onRefreshParameters: handleRefreshParameters,
    refreshDisabled,
    parameterEnumOverrides,
    onToggleParameterEnumOverride: handleToggleParameterEnumOverride
  } = props

  // Bulk-drop selection over the staged review rows — dropping unwanted
  // rows one-by-one after loading a large backup doesn't scale. Pure view
  // state, so it lives here. Shift-click range semantics are in
  // view-models/draft-selection.ts (unit-tested); the anchor is the last
  // row whose checkbox was clicked.
  const [selectedDraftIds, setSelectedDraftIds] = useState<ReadonlySet<string>>(new Set())
  const selectionAnchorRef = useRef<string | null>(null)
  // The search box filters the staged review too: filtering only the
  // table while the review list (where you look mid-import) ignores it
  // makes wildcard search appear broken. Selection, Select all, and Drop
  // selected operate on visible rows only, so a filtered bulk drop can
  // never touch rows the search is hiding.
  const searchPredicate = useMemo(() => parameterSearchPredicate(parameterSearch), [parameterSearch])
  const visibleStagedGroups = useMemo(() => {
    if (!searchPredicate) {
      return stagedParameterGroups
    }
    return stagedParameterGroups
      .map((group) => ({ ...group, entries: group.entries.filter((draft) => searchPredicate(draft.id, draft.label)) }))
      .filter((group) => group.entries.length > 0)
  }, [stagedParameterGroups, searchPredicate])
  const hiddenStagedCount =
    stagedParameterGroups.reduce((sum, group) => sum + group.entries.length, 0) -
    visibleStagedGroups.reduce((sum, group) => sum + group.entries.length, 0)
  const stagedOrderedIds = useMemo(
    () => visibleStagedGroups.flatMap((group) => group.entries.map((entry) => entry.id)),
    [visibleStagedGroups]
  )
  useEffect(() => {
    // Rows leave the staged list via apply/drop/discard-all — selection
    // must not keep ghost ids (the "Drop selected (N)" count would lie).
    setSelectedDraftIds((current) => pruneDraftSelection(current, stagedOrderedIds))
  }, [stagedOrderedIds])
  const handleDraftSelectionClick = (draftId: string, shiftKey: boolean): void => {
    setSelectedDraftIds((current) =>
      applyDraftSelectionClick(current, stagedOrderedIds, draftId, {
        shiftKey,
        anchorId: selectionAnchorRef.current
      })
    )
    selectionAnchorRef.current = draftId
  }
  const handleDropSelectedDrafts = (): void => {
    selectedDraftIds.forEach((draftId) => handleDiscardParameterDraft(draftId))
    setSelectedDraftIds(new Set())
    selectionAnchorRef.current = null
  }

  // Draft-status lookup for the bitmask checkbox editor (ScopedBitmaskField
  // reads it for staged styling + the "was" line). Built once per draft set
  // rather than a fresh map per row.
  const draftStatusMap = useMemo<ReadonlyMap<string, { status: string }>>(
    () => new Map(Array.from(parameterDraftById, ([id, entry]) => [id, { status: entry.status }])),
    [parameterDraftById]
  )

  // The parameter inspector auto-selects the first param (FRAME_CLASS), which on
  // a phone renders a tall box wedged above the editable table. Start it
  // collapsed on phones (the operator taps "Show details" or any row to expand);
  // desktop is unaffected — it initialises expanded and the toggle is CSS-hidden.
  const [parameterDetailsCollapsed, setParameterDetailsCollapsed] = useState(
    () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 600px)').matches
  )

  // Selected-parameter derived state — small enough to recompute here rather
  // than thread through the props.
  const selectedParameter =
    filteredParameters.find((parameter) => parameter.id === selectedParameterId) ?? filteredParameters[0]
  const selectedParameterDefinition = selectedParameter
    ? metadataCatalog.parameters[selectedParameter.id] ?? selectedParameter.definition
    : undefined
  const selectedParameterDraft = selectedParameter ? parameterDraftById.get(selectedParameter.id) : undefined
  const selectedParameterOption = selectedParameterDraft?.nextValue !== undefined
    ? findParameterOption(selectedParameterDefinition, selectedParameterDraft.nextValue)
    : findParameterOption(selectedParameterDefinition, selectedParameter?.value)

  return (

      <Panel title="Parameter Editor" subtitle="Browse, stage, and write raw parameter values.">
        <div className="parameter-follow-up parameter-follow-up--warning parameter-editor__expert-note">
          <StatusBadge tone="warning">expert</StatusBadge>
          <p>Raw parameter editing is an Expert surface. Use Setup, Ports, Receiver, Outputs, and Power for routine workflow changes first.</p>
        </div>

        <div className="parameter-toolbar">
          <input
            data-testid="parameter-search-input"
            aria-label="Search parameters"
            value={parameterSearch}
            onChange={(event) => setParameterSearch(event.target.value)}
            placeholder="Search parameters (e.g. ARMING_*, *VOLT*)"
          />
          <button
            type="button"
            data-testid="parameter-refresh-button"
            style={buttonStyle()}
            onClick={() => void handleRefreshParameters()}
            disabled={refreshDisabled}
            title="Pull the parameter list fresh from the flight controller."
          >
            Refresh
          </button>
        </div>

        <div className="parameter-review">
          <input
            ref={parameterBackupInputRef}
            className="parameter-backup-input"
            aria-label="Import parameter backup file"
            type="file"
            accept="application/json,.json,.param,.parm,.params,text/plain"
            onChange={(event) => void handleImportParameterBackup(event)}
          />
          <div className="parameter-review__summary">
            <div className="parameter-review__stats">
              <StatusBadge tone={parameterDraftSummary.stagedCount > 0 ? 'warning' : 'neutral'}>
                {parameterDraftSummary.stagedCount} staged
              </StatusBadge>
              <StatusBadge tone={parameterDraftSummary.invalidCount > 0 ? 'danger' : 'neutral'}>
                {parameterDraftSummary.invalidCount} invalid
              </StatusBadge>
              <p className="parameter-review__hint">
                {parameterDraftSummary.totalEntries === 0
                  ? 'Edit values below to stage local drafts before writing anything to the controller.'
                  : parameterDraftSummary.invalidCount > 0
                    ? 'Fix or discard invalid drafts before applying the full staged set.'
                    : parameterDraftSummary.stagedCount > 0
                      ? 'Review the staged diff below, then apply individual rows or the whole set.'
                      : 'Current drafts match the live controller values and will not write anything.'}
              </p>
            </div>

            <div className="button-row">
              <button
                data-testid="export-parameter-backup"
                style={buttonStyle()}
                onClick={handleExportParameterBackup}
                disabled={busyAction !== undefined || snapshot.parameters.length === 0}
                title="ArduConfigurator JSON backup with full metadata; round-trips through Import Backup."
              >
                Export JSON
              </button>
              <button
                data-testid="export-parameter-backup-parm"
                style={buttonStyle()}
                onClick={handleExportParameterBackupAsParm}
                disabled={busyAction !== undefined || snapshot.parameters.length === 0}
                title="Mission Planner .parm — NAME,VALUE per line, header metadata in # comments."
              >
                Export .parm
              </button>
              <button
                data-testid="export-parameter-backup-params"
                style={buttonStyle()}
                onClick={handleExportParameterBackupAsParams}
                disabled={busyAction !== undefined || snapshot.parameters.length === 0}
                title="QGroundControl .params — tab-separated vid/cid/NAME/VALUE/type."
              >
                Export .params
              </button>
              <button
                data-testid="import-parameter-backup"
                style={buttonStyle()}
                onClick={handleOpenParameterBackup}
                disabled={busyAction !== undefined || snapshot.parameters.length === 0}
                title="Import any ArduConfigurator JSON, Mission Planner .parm, or QGroundControl .params file."
              >
                Import Backup
              </button>
              <fieldset className="parameter-import-exclusions" data-testid="parameter-import-exclusions">
                <legend>Skip on import</legend>
                {([
                  { key: 'calibration', label: 'Calibration', title: 'Skip compass/accel/gyro offsets, scales, and AHRS board-level trims — values you re-measure per airframe.' },
                  { key: 'stream-rates', label: 'Stream rates', title: 'Skip the SRn_* MAVLink telemetry stream-rate group.' },
                  { key: 'mission', label: 'Mission', title: 'Skip the MIS_* mission parameters.' }
                ] as const).map((option) => (
                  <label key={option.key} className="parameter-import-exclusions__item" title={option.title}>
                    <input
                      type="checkbox"
                      data-testid={`param-import-exclude-${option.key}`}
                      checked={parameterImportExclusions[option.key]}
                      onChange={() => handleToggleParameterImportExclusion(option.key)}
                    />
                    <span>{option.label}</span>
                  </label>
                ))}
              </fieldset>
              <button
                style={buttonStyle('primary')}
                onClick={() => void handleApplyAllParameterDrafts()}
                disabled={busyAction !== undefined || !canApplyAllDraftParameters}
              >
                {busyAction === 'param:apply-all' ? applyAllBusyLabel : `Apply All (${stagedParameterDrafts.length})`}
              </button>
              <button
                style={buttonStyle()}
                onClick={handleDiscardAllParameterDrafts}
                disabled={busyAction !== undefined || parameterDraftSummary.totalEntries === 0}
              >
                Discard All
              </button>
            </div>
          </div>

          {/* Proactively explain a disabled "Apply All": the most common cause on
              real hardware is an accelerometer/compass calibration left running,
              which blocks every write. Surface the reason BEFORE the operator
              clicks so it's obvious why nothing writes (and to cancel it). */}
          {stagedParameterDrafts.length > 0 && !canApplyAllDraftParameters && parameterApplyBlockedReason(snapshot) ? (
            <div className="parameter-review__notice" data-testid="parameter-apply-blocked" role="alert">
              <StatusBadge tone="warning">writes blocked</StatusBadge>
              <p>{parameterApplyBlockedReason(snapshot)}</p>
            </div>
          ) : null}

          {parameterNotice ? (
            <div className="parameter-review__notice" data-testid="parameter-notice">
              <StatusBadge tone={parameterNotice.tone}>{parameterNotice.tone}</StatusBadge>
              <p>{parameterNotice.text}</p>
            </div>
          ) : null}

          {rebootRequiredDrafts.length > 0 ? (
            <div className="parameter-follow-up parameter-follow-up--warning">
              <StatusBadge tone="warning">reboot</StatusBadge>
              <p>
                {rebootRequiredDrafts.length} staged change(s) are marked as reboot-required if applied. Plan to reboot and refresh the
                parameter snapshot before continuing setup.
              </p>
            </div>
          ) : null}

	          {parameterFollowUp ? (
	            <div className="parameter-follow-up">
	              <StatusBadge tone={parameterFollowUp.requiresReboot ? 'warning' : 'neutral'}>
	                {parameterFollowUp.requiresReboot ? 'reboot' : 'refresh'}
	              </StatusBadge>
	              <p>{parameterFollowUp.text}</p>
	              <small>Use the header session strip to complete the pending reboot or refresh.</small>
	            </div>
	          ) : null}

          {parameterDraftSummary.stagedCategories.length > 0 ? (
            <small className="parameter-review__hint">
              Categories in review: {parameterDraftSummary.stagedCategories.map((categoryId) => formatCategoryLabel(categoryId)).join(', ')}
            </small>
          ) : null}

          {stagedParameterGroups.length > 0 ? (
            <div className="parameter-diff-bulk" data-testid="parameter-diff-bulk">
              <label className="parameter-diff-bulk__all">
                <input
                  type="checkbox"
                  data-testid="parameter-diff-select-all"
                  checked={selectedDraftIds.size === stagedOrderedIds.length && stagedOrderedIds.length > 0}
                  onChange={(event) =>
                    setSelectedDraftIds(event.target.checked ? new Set(stagedOrderedIds) : new Set())
                  }
                  disabled={busyAction !== undefined}
                />
                <span>Select all</span>
              </label>
              <button
                type="button"
                data-testid="parameter-diff-drop-selected"
                style={buttonStyle()}
                onClick={handleDropSelectedDrafts}
                disabled={busyAction !== undefined || selectedDraftIds.size === 0}
                title="Drop every selected staged change. Shift-click checkboxes to select a range."
              >
                Drop selected ({selectedDraftIds.size})
              </button>
              {hiddenStagedCount > 0 ? (
                <small data-testid="parameter-diff-hidden-count">
                  {hiddenStagedCount} staged row{hiddenStagedCount === 1 ? '' : 's'} hidden by the search
                </small>
              ) : null}
            </div>
          ) : null}

          {parameterDraftSummary.invalidCount > 0 ? (
            <a
              href="#parameter-invalid-grid"
              data-testid="parameter-review-invalid-callout"
              role="alert"
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '2px',
                padding: '10px 14px',
                marginBottom: '12px',
                borderRadius: '8px',
                border: '1px solid var(--danger, #d9534f)',
                background: 'rgba(217, 83, 79, 0.12)',
                color: 'inherit',
                textDecoration: 'none'
              }}
            >
              <strong style={{ color: 'var(--danger, #ff6b6b)' }}>
                {parameterDraftSummary.invalidCount} invalid draft
                {parameterDraftSummary.invalidCount === 1 ? '' : 's'} blocking Apply All
              </strong>
              <span>Override, fix, or drop these first — jump to them ↓</span>
            </a>
          ) : null}

          {visibleStagedGroups.length > 0 ? (
            <div className="parameter-diff-grid" id="parameter-diff-grid" data-testid="parameter-diff-grid">
              {visibleStagedGroups.map((group) => (
                <section key={group.category} className="parameter-diff-group">
                  <header>
                    <strong>{formatCategoryLabel(group.category)}</strong>
                    <span>{group.entries.length} staged</span>
                  </header>

                  {group.entries.map((draft) => {
                    // Inline editor so a staged value can be nudged (e.g.
                    // FLTMODE_CH 8 → 6) without leaving the review list:
                    // select when the param has options (enum /
                    // channel-selector), number input otherwise. Uses the
                    // same setDraft contract as the source field, so
                    // editing here is identical to editing in the source
                    // tab.
                    const options = draft.definition?.options
                    // Bitmask options are BIT INDICES, not exclusive values
                    // — an exclusive <select> over them would write the
                    // index instead of the mask. Bitmask rows edit the raw
                    // value and show the decoded bits underneath instead.
                    const isBitmask = draft.definition?.bitmask === true
                    const inputId = `parameter-diff-edit-${draft.id}`
                    const currentRawValue = editedValues[draft.id] ?? String(draft.nextValue)
                    return (
                    <div key={draft.id} className="parameter-diff-item parameter-diff-item--selectable">
                      <input
                        type="checkbox"
                        className="parameter-diff-item__select"
                        data-testid={`parameter-diff-select-${draft.id}`}
                        checked={selectedDraftIds.has(draft.id)}
                        aria-label={`Select ${draft.id} for bulk drop`}
                        title="Select for bulk drop. Shift-click selects a range."
                        disabled={busyAction !== undefined}
                        onClick={(event) => handleDraftSelectionClick(draft.id, event.shiftKey)}
                        onChange={() => {}}
                      />
                      <span>
                        <strong>{draft.id}</strong>
                        <small>{draft.label}</small>
                      </span>
                      <span className="parameter-diff-values">
                        <em>Current:</em> {formatParameterDraftValue(draft.definition, draft.currentValue)}
                        {' → '}
                        <em>New:</em>{' '}
                        {options && options.length > 0 && !isBitmask ? (
                          <select
                            id={inputId}
                            data-testid={`parameter-diff-edit-${draft.id}`}
                            className="parameter-diff-edit"
                            value={currentRawValue}
                            onChange={(event) => setDraft(draft.id, event.target.value)}
                            disabled={busyAction !== undefined}
                            aria-label={`Edit staged value for ${draft.id}`}
                          >
                            {options.map((option) => (
                              <option key={option.value} value={String(option.value)}>
                                {option.label} ({option.value})
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            id={inputId}
                            data-testid={`parameter-diff-edit-${draft.id}`}
                            className="parameter-diff-edit"
                            type="number"
                            step="any"
                            value={currentRawValue}
                            onChange={(event) => setDraft(draft.id, event.target.value)}
                            disabled={busyAction !== undefined}
                            aria-label={`Edit staged value for ${draft.id}`}
                          />
                        )}
                        {isBitmask ? (
                          <small data-testid={`parameter-diff-bits-${draft.id}`}>
                            {describeBitmaskDraftValue(draft.definition, draft.currentValue) ?? '—'}
                            {' → '}
                            {describeBitmaskDraftValue(draft.definition, Number(currentRawValue)) ?? '—'}
                          </small>
                        ) : null}
                      </span>
                      <span className="parameter-diff-delta">{formatParameterDelta(draft.delta, draft.definition?.unit)}</span>
                      {/* Per-row Discard so the operator can deselect a
                       *  single staged change from the Apply All set
                       *  without leaving the Show Changes view. Apply All
                       *  consumes only what's still staged after the
                       *  discards. */}
                      <button
                        type="button"
                        data-testid={`parameter-diff-discard-${draft.id}`}
                        className="parameter-diff-item__discard"
                        style={buttonStyle()}
                        onClick={() => handleDiscardParameterDraft(draft.id)}
                        disabled={busyAction !== undefined}
                        title={`Drop the staged change to ${draft.id} (keeps the live FC value as-is).`}
                      >
                        Drop
                      </button>
                    </div>
                  )})}
                </section>
              ))}
            </div>
          ) : null}

          {invalidParameterGroups.length > 0 ? (
            <div className="parameter-diff-grid parameter-diff-grid--invalid" id="parameter-invalid-grid">
              {invalidParameterGroups.map((group) => (
                <section key={`invalid:${group.category}`} className="parameter-diff-group parameter-diff-group--invalid">
                  <header>
                    <strong>{formatCategoryLabel(group.category)}</strong>
                    <span>{group.entries.length} invalid</span>
                  </header>

                  {group.entries.map((draft) => {
                    // Override available for any METADATA-driven validation
                    // mismatch: enum-mismatch AND min/max range violation.
                    // Non-numeric input ("Value must be numeric.") stays
                    // hard-invalid — that's a syntax problem, not a metadata
                    // disagreement the user can vouch for.
                    const reason = draft.reason ?? ''
                    const isOverridableValidation =
                      reason === 'Value is outside the known enum values for this parameter.' ||
                      reason.startsWith('Value is below the documented minimum of') ||
                      reason.startsWith('Value is above the documented maximum of')
                    return (
                      <div key={draft.id} className="parameter-diff-item">
                        <span>
                          <strong>{draft.id}</strong>
                          <small>{draft.label}</small>
                        </span>
                        <span className="parameter-diff-values">{draft.rawValue || 'Empty draft'}</span>
                        <span className="parameter-diff-delta">{draft.reason ?? 'Invalid value'}</span>
                        <div className="parameter-diff-item__actions">
                          {isOverridableValidation ? (
                            <button
                              type="button"
                              data-testid={`parameter-diff-override-${draft.id}`}
                              style={buttonStyle()}
                              onClick={() => handleToggleParameterEnumOverride(draft.id)}
                              disabled={busyAction !== undefined}
                              title="Treat this value as valid and let it write through — useful when the firmware accepts a value the metadata's documented range or enum doesn't yet include."
                            >
                              Override and write anyway
                            </button>
                          ) : null}
                          {/* Every invalid row offers Drop — same contract
                              as staged rows — so the operator can dismiss a
                              bad draft without first having to fix it. */}
                          <button
                            type="button"
                            data-testid={`parameter-diff-discard-${draft.id}`}
                            style={buttonStyle()}
                            onClick={() => handleDiscardParameterDraft(draft.id)}
                            disabled={busyAction !== undefined}
                            title={`Drop the invalid draft to ${draft.id} (clears the local edit; keeps the live FC value as-is).`}
                          >
                            Drop
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </section>
              ))}
            </div>
          ) : null}

          {/* When an enum override is active, the draft moves from the
           *  invalid list into the staged list above; the staged row gets
           *  a small badge so the operator remembers that THIS one was
           *  pushed through against the metadata's enum list and a Cancel
           *  override button to undo. */}
          {parameterEnumOverrides.size > 0 ? (
            <small className="parameter-review__hint">
              Overridden enum-mismatch drafts (writes anyway):{' '}
              {[...parameterEnumOverrides].map((paramId, index) => (
                <span key={paramId}>
                  {index > 0 ? ', ' : ''}
                  <button
                    type="button"
                    data-testid={`parameter-diff-cancel-override-${paramId}`}
                    className="parameter-review__hint-button"
                    onClick={() => handleToggleParameterEnumOverride(paramId)}
                    disabled={busyAction !== undefined}
                    title={`Cancel the override on ${paramId} and re-flag it as invalid.`}
                  >
                    {paramId} (cancel)
                  </button>
                </span>
              ))}
            </small>
          ) : null}
        </div>

        {selectedParameter ? (
          <div className={`parameter-details${parameterDetailsCollapsed ? ' parameter-details--collapsed' : ''}`}>
            <div className="parameter-details__header">
              <div>
                <h3>{selectedParameterDefinition?.label ?? selectedParameter.id}</h3>
                <p>{selectedParameterDefinition?.description ?? 'Metadata coverage for this parameter is still limited.'}</p>
              </div>
              <StatusBadge tone={toneForParameterDraftStatus(selectedParameterDraft?.status ?? 'unchanged')}>
                {selectedParameterDraft?.status ?? 'unchanged'}
              </StatusBadge>
              <button
                type="button"
                className="parameter-details__toggle"
                data-testid="parameter-details-toggle"
                onClick={() => setParameterDetailsCollapsed((collapsed) => !collapsed)}
                aria-expanded={!parameterDetailsCollapsed}
              >
                {parameterDetailsCollapsed ? 'Show details' : 'Hide details'}
              </button>
            </div>

            {parameterDetailsCollapsed ? null : (
              <>
            <div className="parameter-details__grid">
              <div className="parameter-details__metric">
                <small>Current value</small>
                <strong>{formatParameterDisplayValue(selectedParameter, selectedParameter.value)}</strong>
              </div>
              <div className="parameter-details__metric">
                <small>Staged value</small>
                <strong>
                  {selectedParameterDraft?.nextValue !== undefined
                    ? formatParameterDisplayValue(selectedParameter, selectedParameterDraft.nextValue)
                    : 'No staged change'}
                </strong>
              </div>
              <div className="parameter-details__metric">
                <small>Category</small>
                <strong>{formatCategoryLabel(selectedParameterDefinition?.category)}</strong>
              </div>
              <div className="parameter-details__metric">
                <small>Range</small>
                <strong>{formatParameterRange(selectedParameterDefinition)}</strong>
              </div>
              <div className="parameter-details__metric">
                <small>Step</small>
                <strong>{formatParameterStep(selectedParameterDefinition)}</strong>
              </div>
              <div className="parameter-details__metric">
                <small>Reboot</small>
                <strong>{selectedParameterDefinition?.rebootRequired ? 'Required after change' : 'No reboot note available'}</strong>
              </div>
            </div>

            {selectedParameterOption ? (
              <p className="parameter-details__option">
                Active enum label: <strong>{selectedParameterOption.label}</strong>
                {selectedParameterOption.description ? `, ${selectedParameterOption.description}` : ''}
              </p>
            ) : null}

            {selectedParameterDefinition?.notes && selectedParameterDefinition.notes.length > 0 ? (
              <ul className="notes">
                {selectedParameterDefinition.notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            ) : null}

            {selectedParameterDefinition?.options && selectedParameterDefinition.options.length > 0 ? (
              <div className="parameter-option-list">
                {selectedParameterDefinition.options.slice(0, 12).map((option) => (
                  <span key={`${selectedParameter.id}:${option.value}`}>
                    {option.value}: {option.label}
                  </span>
                ))}
              </div>
            ) : null}
              </>
            )}
          </div>
        ) : null}

        <div className="parameter-table">
          <div className="parameter-row parameter-row--header">
            <span>Parameter</span>
            <span>Description</span>
            <span>Current</span>
            <span>Draft</span>
            <span>Actions</span>
          </div>
          {filteredParameters.map((parameter) => {
            const draft = parameterDraftById.get(parameter.id)
            // Prefer the upstream-enriched catalog definition so the raw
            // parameter table shows real descriptions/units/categories for the
            // whole tree, not just curated params.
            const definition = metadataCatalog.parameters[parameter.id] ?? parameter.definition
            const rowClassName =
              draft?.status === 'staged'
                ? 'parameter-row parameter-row--staged'
                : draft?.status === 'invalid'
                  ? 'parameter-row parameter-row--invalid'
                  : 'parameter-row'

            return (
              <div
                key={parameter.id}
                className={`${rowClassName}${selectedParameter?.id === parameter.id ? ' parameter-row--selected' : ''}`}
                onClick={() => setSelectedParameterId(parameter.id)}
              >
                <span>
                  <strong>{parameter.id}</strong>
                  <small>{formatCategoryLabel(definition?.category)}</small>
                </span>
                <span>
                  {definition?.description ?? 'Metadata to be expanded from upstream ArduPilot bundles.'}
                  {definition?.unit ? <small>Unit: {definition.unit}</small> : null}
                </span>
                <span className="parameter-row__value">
                  <strong>{formatParameterValue(parameter.value, definition?.unit)}</strong>
                  <small>
                    {draft?.status === 'staged'
                      ? `Delta ${formatParameterDelta(draft.delta, definition?.unit)}`
                      : 'Live controller value'}
                  </small>
                </span>
                <span className="parameter-row__value">
                  {definition?.bitmask === true && (definition.options?.length ?? 0) > 0 ? (
                    // Bitmask params edit as Mission-Planner-style per-bit
                    // checkboxes (each labelled with its bit meaning) instead
                    // of a raw number field. Compact collapsible popover so a
                    // long bit list doesn't blow out the row or overlap Apply.
                    <ScopedBitmaskPopover
                      parameter={{ ...parameter, definition }}
                      liveValue={parameter.value}
                      editedValues={editedValues}
                      draftStatusById={draftStatusMap}
                      onChange={setDraft}
                    />
                  ) : (
                    <input
                      type="number"
                      aria-label={`${parameter.id} value`}
                      value={editedValues[parameter.id] ?? String(parameter.value)}
                      onChange={(event) =>
                        setDraft(parameter.id, event.target.value)
                      }
                    />
                  )}
                  <small
                    className={`parameter-status-copy${
                      draft ? ` parameter-status-copy--${draft.status}` : ' parameter-status-copy--idle'
                    }`}
                  >
                    {draft?.status === 'staged'
                      ? `Staged ${formatParameterValue(draft.nextValue, parameter.definition?.unit)}`
                      : draft?.reason ?? 'Edit locally to stage a parameter change.'}
                  </small>
                </span>
                <span>
                  <div className="parameter-actions">
                    {draft?.status === 'staged' ? (
                      <>
                        <button
                          style={buttonStyle('primary')}
                          onClick={() => void handleApplyParameterDraft(draft)}
                          disabled={busyAction !== undefined || !canApplyDraftParameters}
                        >
                          {busyAction === `param:${parameter.id}` ? 'Writing…' : 'Apply'}
                        </button>
                        <button
                          style={buttonStyle()}
                          onClick={() => handleDiscardParameterDraft(parameter.id)}
                          disabled={busyAction !== undefined}
                        >
                          Discard
                        </button>
                      </>
                    ) : draft ? (
                      <>
                        <StatusBadge tone={toneForParameterDraftStatus(draft.status)}>{draft.status}</StatusBadge>
                        <button
                          style={buttonStyle()}
                          onClick={() => handleDiscardParameterDraft(parameter.id)}
                          disabled={busyAction !== undefined}
                        >
                          Clear
                        </button>
                      </>
                    ) : (
                      <span className="parameter-actions__idle">No local draft</span>
                    )}
                  </div>
                </span>
              </div>
            )
          })}
        </div>
        {filteredParameters.length === 0 ? <p className="parameter-empty-state">No parameters match the current filter.</p> : null}
      </Panel>

  )
}
