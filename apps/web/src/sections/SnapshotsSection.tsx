// SnapshotsSection — App.tsx's `activeViewId === 'snapshots'` block, lifted
// into its own component. This is the biggest single per-view extract:
// the snapshot library + selected snapshot detail + provisioning library
// + provisioning preview all live inside SnapshotsView via slot props.
// App.tsx hands in the data (the two library hooks, form-input state,
// safety-ack state), derived diff entries, refs, and all 21 handlers.
//
// No behaviour change — every JSX attribute and inline closure is verbatim
// from the original block.

import type { ChangeEvent, ReactElement, RefObject } from 'react'
import type {
  ConfiguratorSnapshot,
  ParameterDraftEntry,
  ParameterDraftGroup
} from '@arduconfig/ardupilot-core'
import {
  deriveDraftValuesFromParameterBackup,
  deriveProvisioningProfileBackup,
  type ParameterBackupEntry,
  type ParameterBackupImportResult
} from '@arduconfig/ardupilot-core'
import { StatusBadge, buttonStyle } from '@arduconfig/ui-kit'

import type { ArduconfigDesktopBridge } from '../desktop-bridge'
import type { Libraries } from '../hooks/use-libraries'
import type { LibraryForms, ProvisioningProfileSourceMode } from '../hooks/use-library-forms'
import type { UseSafetyAcksResult } from '../hooks/use-safety-acks'
import type { ParameterFollowUp, ParameterNotice } from '../hooks/use-parameter-feedback'
import { formatSnapshotTimestamp } from '../library-helpers'
import { describeBitmaskDraftValue, formatParameterDelta, formatParameterValue } from '../parameter-format'
import type { SavedParameterSnapshot } from '../snapshot-library'
import type { SavedProvisioningProfile } from '../provisioning-library'
import { SnapshotsView } from '../views/Snapshots'

/**
 * AUTOPILOT_VERSION.uid often arrives as all-zero from FCs whose
 * STM32 chip doesn't expose its unique id (or hasn't been read by
 * the firmware yet). Don't surface a meaningless "UID 00000000..."
 * pill in that case.
 */
function isMeaningfulHardwareUid(uid: string | undefined): boolean {
  if (!uid) return false
  return /[1-9a-f]/i.test(uid)
}

/**
 * The full STM32 UID is a 24-hex (96-bit) string — too wide for a
 * header pill. Show the first 4 and last 4 hex chars with an
 * ellipsis between, mirroring the SSH-fingerprint truncation idiom.
 * The full value is still in the `title` tooltip the caller sets.
 */
function formatHardwareUidShort(uid: string): string {
  const stripped = uid.replace(/[^0-9a-fA-F]/g, '')
  if (stripped.length <= 10) return stripped.toUpperCase()
  return `${stripped.slice(0, 4)}…${stripped.slice(-4)}`.toUpperCase()
}

function formatUsbId(vendorId: number, productId: number): string {
  const v = vendorId.toString(16).padStart(4, '0').toUpperCase()
  const p = productId.toString(16).padStart(4, '0').toUpperCase()
  return `${v}:${p}`
}

export interface SnapshotsSectionDerived {
  selectedSnapshot: SavedParameterSnapshot | undefined
  selectedSnapshotRestore: ParameterBackupImportResult | undefined
  selectedSnapshotDiffEntries: readonly ParameterDraftEntry[]
  selectedSnapshotDiffGroups: readonly ParameterDraftGroup[]
  selectedSnapshotChangedEntries: readonly ParameterDraftEntry[]
  selectedSnapshotInvalidEntries: readonly ParameterDraftEntry[]
  selectedSnapshotRebootSensitiveCount: number
  stagedProvisioningOverlayParameters: readonly ParameterBackupEntry[]
  selectedProvisioningProfile: SavedProvisioningProfile | undefined
  selectedProvisioningProfileRestore: ParameterBackupImportResult | undefined
  selectedProvisioningProfileDiffEntries: readonly ParameterDraftEntry[]
  selectedProvisioningProfileDiffGroups: readonly ParameterDraftGroup[]
  selectedProvisioningProfileChangedEntries: readonly ParameterDraftEntry[]
  selectedProvisioningProfileInvalidEntries: readonly ParameterDraftEntry[]
}

export interface SnapshotsSectionRefs {
  snapshotImportInputRef: RefObject<HTMLInputElement | null>
  provisioningImportInputRef: RefObject<HTMLInputElement | null>
}

export interface SnapshotsSectionHandlers {
  handleApplySelectedProvisioningProfile: () => void | Promise<void>
  handleApplySelectedSnapshotRestore: () => void | Promise<void>
  /** Apply ONE row of the snapshot restore diff (field request: apply
   *  individual parameters like the Parameters tab). Same overwrite ack
   *  gates it as the full restore. */
  handleApplySnapshotEntry: (entry: ParameterDraftEntry) => void | Promise<void>
  handleCaptureLiveSnapshot: () => void | Promise<void>
  handleCreateProvisioningProfile: () => void | Promise<void>
  handleDeleteSelectedProvisioningProfile: () => void | Promise<void>
  handleDeleteSelectedSnapshot: () => void | Promise<void>
  handleExportProvisioningLibrary: () => void | Promise<void>
  handleExportSelectedProvisioningProfile: () => void | Promise<void>
  handleExportSelectedSnapshot: () => void | Promise<void>
  handleExportSelectedSnapshotToDesktop: () => void | Promise<void>
  handleExportSnapshotLibrary: () => void | Promise<void>
  handleImportProvisioningLibrary: (event: ChangeEvent<HTMLInputElement>) => void | Promise<void>
  handleImportSnapshotFile: (event: ChangeEvent<HTMLInputElement>) => void | Promise<void>
  handleOpenDesktopSnapshotFile: () => void | Promise<void>
  handleOpenProvisioningImport: () => void
  handleOpenSnapshotImport: () => void
  handleSaveDesktopSnapshotLibrary: () => void | Promise<void>
  handleStageSelectedProvisioningProfileDiff: () => void
  handleStageSelectedSnapshotDiff: () => void
  handleToggleSelectedProvisioningProfileProtection: () => void | Promise<void>
  handleToggleSelectedSnapshotProtection: () => void | Promise<void>
}

export interface SnapshotsSectionProps {
  snapshot: ConfiguratorSnapshot
  desktopBridge: ArduconfigDesktopBridge | undefined
  desktopSnapshotLibraryPath: string | undefined
  desktopSnapshotLibraryName: string | undefined
  busyAction: string | undefined
  canApplyDraftParameters: boolean
  parameterFollowUp: ParameterFollowUp | undefined
  isExpertMode: boolean
  snapshotNotice: ParameterNotice | undefined
  provisioningNotice: ParameterNotice | undefined
  formatCategoryLabel: (categoryId: string | undefined) => string
  libraries: Libraries
  forms: LibraryForms
  safetyAcks: UseSafetyAcksResult
  refs: SnapshotsSectionRefs
  derived: SnapshotsSectionDerived
  handlers: SnapshotsSectionHandlers
  // Snapshot-vs-snapshot compare picker. undefined / 'live' means
  // baseline is the live FC snapshot (the default "Restore Preview"
  // behaviour); a savedSnapshot.id swaps the baseline to that saved
  // snapshot's parameter values. Owned by App.tsx so the derived
  // diff above is consistent with the picker's value.
  snapshotCompareBaselineId: string | undefined
  onSnapshotCompareBaselineIdChange: (next: string | undefined) => void
}

export function SnapshotsSection(props: SnapshotsSectionProps): ReactElement {
  const {
    snapshot,
    desktopBridge,
    desktopSnapshotLibraryPath,
    desktopSnapshotLibraryName,
    busyAction,
    canApplyDraftParameters,
    parameterFollowUp,
    isExpertMode,
    snapshotNotice,
    provisioningNotice,
    formatCategoryLabel,
    libraries,
    forms,
    safetyAcks,
    refs,
    derived,
    handlers,
    snapshotCompareBaselineId,
    onSnapshotCompareBaselineIdChange
  } = props

  const {
    savedSnapshots,
    setSelectedSnapshotId,
    snapshotStorageNotice,
    savedProvisioningProfiles,
    setSelectedProvisioningProfileId,
    provisioningStorageNotice
  } = libraries

  const {
    snapshotLabelInput,
    setSnapshotLabelInput,
    snapshotNoteInput,
    setSnapshotNoteInput,
    snapshotTagsInput,
    setSnapshotTagsInput,
    snapshotProtectedInput,
    setSnapshotProtectedInput,
    provisioningProfileLabelInput,
    setProvisioningProfileLabelInput,
    provisioningProfileModelInput,
    setProvisioningProfileModelInput,
    provisioningProfileFleetInput,
    setProvisioningProfileFleetInput,
    provisioningProfileMissionInput,
    setProvisioningProfileMissionInput,
    provisioningProfileNoteInput,
    setProvisioningProfileNoteInput,
    provisioningProfileTagsInput,
    setProvisioningProfileTagsInput,
    provisioningProfileChecklistInput,
    setProvisioningProfileChecklistInput,
    provisioningProfileProtectedInput,
    setProvisioningProfileProtectedInput,
    provisioningProfileSourceInput,
    setProvisioningProfileSourceInput,
    includeDraftOverlayInProvisioningProfile,
    setIncludeDraftOverlayInProvisioningProfile
  } = forms

  const {
    snapshotRestoreAcknowledged,
    setSnapshotRestoreAcknowledged,
    provisioningRestoreAcknowledged,
    setProvisioningRestoreAcknowledged
  } = safetyAcks

  const { snapshotImportInputRef, provisioningImportInputRef } = refs

  const {
    selectedSnapshot,
    selectedSnapshotRestore,
    selectedSnapshotDiffGroups,
    selectedSnapshotChangedEntries,
    selectedSnapshotInvalidEntries,
    stagedProvisioningOverlayParameters,
    selectedProvisioningProfile,
    selectedProvisioningProfileRestore,
    selectedProvisioningProfileDiffGroups,
    selectedProvisioningProfileChangedEntries,
    selectedProvisioningProfileInvalidEntries
  } = derived

  const {
    handleApplySelectedProvisioningProfile,
    handleApplySelectedSnapshotRestore,
    handleApplySnapshotEntry,
    handleCaptureLiveSnapshot,
    handleCreateProvisioningProfile,
    handleDeleteSelectedProvisioningProfile,
    handleDeleteSelectedSnapshot,
    handleExportProvisioningLibrary,
    handleExportSelectedProvisioningProfile,
    handleExportSelectedSnapshot,
    handleExportSelectedSnapshotToDesktop,
    handleExportSnapshotLibrary,
    handleImportProvisioningLibrary,
    handleImportSnapshotFile,
    handleOpenDesktopSnapshotFile,
    handleOpenProvisioningImport,
    handleOpenSnapshotImport,
    handleSaveDesktopSnapshotLibrary,
    handleStageSelectedProvisioningProfileDiff,
    handleStageSelectedSnapshotDiff,
    handleToggleSelectedProvisioningProfileProtection,
    handleToggleSelectedSnapshotProtection
  } = handlers

  return (

      <SnapshotsView
        snapshotsCount={savedSnapshots.length}
        profilesCount={savedProvisioningProfiles.length}
        activeDiffCount={selectedSnapshotChangedEntries.length + selectedProvisioningProfileChangedEntries.length}
        hiddenInputsSlot={
          <>
            <input
              ref={snapshotImportInputRef}
              className="parameter-backup-input"
              type="file"
              aria-label="Import snapshot library file"
              accept="application/json,.json"
              onChange={(event) => void handleImportSnapshotFile(event)}
            />
            <input
              ref={provisioningImportInputRef}
              className="parameter-backup-input"
              type="file"
              aria-label="Import provisioning library file"
              accept="application/json,.json"
              onChange={(event) => void handleImportProvisioningLibrary(event)}
            />
          </>
        }
        libraryFormSlot={
          <>
            <div className="snapshots-section-header">
              <div>
                <h3>Capture and restore trusted baselines</h3>
                <p>Keep known-good controller states close at hand and restore them through the verified write path.</p>
              </div>
              <div className="snapshots-section-meta">
                <span className="snapshots-counter-chip">
                  {selectedSnapshotInvalidEntries.length > 0
                    ? `${selectedSnapshotInvalidEntries.length} invalid`
                    : selectedSnapshotChangedEntries.length > 0
                      ? `${selectedSnapshotChangedEntries.length} diff`
                      : `${savedSnapshots.length} saved`}
                </span>
              </div>
            </div>

            <div className="snapshot-capture-row snapshots-form-grid">
              <div className="snapshots-form-group-heading">
                <span>Baseline Metadata</span>
                <p>Name the baseline and add only the context you will actually use later.</p>
              </div>

              <label className="scoped-editor-field snapshots-field">
                <span>Snapshot label</span>
                <input
                  data-testid="snapshot-label-input"
                  type="text"
                  value={snapshotLabelInput}
                  onChange={(event) => setSnapshotLabelInput(event.target.value)}
                  placeholder="Garage tune v1 baseline"
                />
                <small>Leave blank to generate a timestamped vehicle label.</small>
              </label>

              <label className="scoped-editor-field snapshots-field">
                <span>Tags</span>
                <input
                  data-testid="snapshot-tags-input"
                  type="text"
                  value={snapshotTagsInput}
                  onChange={(event) => setSnapshotTagsInput(event.target.value)}
                  placeholder="moz7, baseline, tune"
                />
                <small>Comma-separated metadata for later filtering.</small>
              </label>

              <label className="scoped-editor-field snapshots-field snapshots-field--wide">
                <span>Note</span>
                <textarea
                  data-testid="snapshot-note-input"
                  value={snapshotNoteInput}
                  onChange={(event) => setSnapshotNoteInput(event.target.value)}
                  placeholder="Context for when and why this baseline was captured."
                  rows={4}
                />
                <small>Notes travel with exported libraries.</small>
              </label>

              <div className="snapshot-capture-actions snapshots-capture-actions">
                <div className="snapshots-form-group-heading">
                  <span>Capture Controls</span>
                  <p>One primary action, plus quieter library import and export utilities.</p>
                </div>

                <label className="snapshot-protected-toggle snapshots-setting-row">
                  <input
                    data-testid="snapshot-protected-toggle"
                    type="checkbox"
                    checked={snapshotProtectedInput}
                    onChange={(event) => setSnapshotProtectedInput(event.target.checked)}
                  />
                  <span>
                    <strong>Protect this baseline</strong>
                    <small>Prevents accidental removal of a known-good restore point.</small>
                  </span>
                </label>

                <div className="snapshots-action-row">
                  <button
                    data-testid="capture-live-snapshot-button"
                    className="snapshots-button snapshots-button--primary"
                    onClick={handleCaptureLiveSnapshot}
                    disabled={busyAction !== undefined || snapshot.parameters.length === 0}
                  >
                    Capture Live Snapshot
                  </button>
                  <button
                    data-testid="import-snapshot-file-button"
                    className="snapshots-button snapshots-button--secondary"
                    onClick={handleOpenSnapshotImport}
                    disabled={busyAction !== undefined}
                  >
                    Import Library
                  </button>
                  <button
                    data-testid="export-snapshot-library-button"
                    className="snapshots-button snapshots-button--secondary"
                    onClick={handleExportSnapshotLibrary}
                    disabled={busyAction !== undefined || savedSnapshots.length === 0}
                  >
                    Export Library
                  </button>
                </div>
              </div>
            </div>

            <p className="telemetry-note snapshots-inline-note">
              Snapshot libraries stay local by default, but exported libraries remain portable across later sessions and desktop tooling.
            </p>

            {desktopBridge ? (
              <div className="desktop-snapshot-workspace">
                <div className="snapshots-subsection-header">
                  <div>
                    <h3>Desktop snapshot files</h3>
                    <p>Open or save a named library file through the desktop shell without leaving this workflow.</p>
                  </div>
                  <span className={`snapshots-counter-chip${desktopSnapshotLibraryPath ? ' is-success' : ''}`}>
                    {desktopSnapshotLibraryPath ? 'linked library' : 'local only'}
                  </span>
                </div>

                {desktopSnapshotLibraryPath ? (
                  <div className="config-pills">
                    <span>{desktopSnapshotLibraryName ?? 'Desktop snapshot library'}</span>
                    <span>{desktopSnapshotLibraryPath}</span>
                  </div>
                ) : (
                  <p className="telemetry-note">
                    No desktop library file is linked yet. Open one from disk to keep this browser library tied to a named desktop file.
                  </p>
                )}

                <div className="snapshots-action-row">
                  <button
                    data-testid="desktop-open-snapshot-file-button"
                    className="snapshots-button snapshots-button--secondary"
                    onClick={() => void handleOpenDesktopSnapshotFile()}
                    disabled={busyAction !== undefined}
                  >
                    Open from Desktop…
                  </button>
                  <button
                    data-testid="desktop-save-snapshot-library-button"
                    className="snapshots-button snapshots-button--secondary"
                    onClick={() => void handleSaveDesktopSnapshotLibrary()}
                    disabled={busyAction !== undefined || savedSnapshots.length === 0}
                  >
                    {desktopSnapshotLibraryPath ? 'Save Library' : 'Save Library to Desktop…'}
                  </button>
                  <button
                    data-testid="desktop-export-selected-snapshot-button"
                    className="snapshots-button snapshots-button--ghost"
                    onClick={() => void handleExportSelectedSnapshotToDesktop()}
                    disabled={busyAction !== undefined || !selectedSnapshot}
                  >
                    Export Selected to Desktop…
                  </button>
                </div>
              </div>
            ) : null}

            <div className="snapshots-feedback-stack">
            {snapshotStorageNotice ? (
              <div className="parameter-review__notice snapshots-notice">
                <StatusBadge tone={snapshotStorageNotice.tone}>{snapshotStorageNotice.tone}</StatusBadge>
                <p>{snapshotStorageNotice.text}</p>
              </div>
            ) : null}

            {snapshotNotice ? (
              <div className="parameter-review__notice snapshots-notice">
                <StatusBadge tone={snapshotNotice.tone}>{snapshotNotice.tone}</StatusBadge>
                <p>{snapshotNotice.text}</p>
              </div>
            ) : null}

            {parameterFollowUp ? (
              <div className="parameter-follow-up snapshots-follow-up">
                <StatusBadge tone={parameterFollowUp.requiresReboot ? 'warning' : 'neutral'}>
                  {parameterFollowUp.requiresReboot ? 'reboot' : 'refresh'}
                </StatusBadge>
                <p>{parameterFollowUp.text}</p>
                <small>Use the header session strip to complete the pending reboot or refresh.</small>
              </div>
            ) : null}
            </div>

            <div className="telemetry-metric-grid snapshots-metrics-grid">
              <article className="telemetry-metric-card snapshots-metric-card">
                <span>Saved snapshots</span>
                <strong>{savedSnapshots.length}</strong>
              </article>
              <article className="telemetry-metric-card snapshots-metric-card">
                <span>Snapshot params</span>
                <strong>{selectedSnapshot?.backup.parameterCount ?? 0}</strong>
              </article>
              <article className="telemetry-metric-card snapshots-metric-card">
                <span>Changed vs live</span>
                <strong>{selectedSnapshotRestore?.changedCount ?? 0}</strong>
              </article>
              <article className="telemetry-metric-card snapshots-metric-card">
                <span>Reboot-sensitive</span>
                <strong>{selectedSnapshotChangedEntries.filter((entry) => entry.definition?.rebootRequired).length}</strong>
              </article>
            </div>
          </>
        }
        selectedSnapshotSlot={
          <>
            <div className="snapshots-browser-rail">
            <div className="snapshots-browser-rail__header">
              <div>
                <h4>Saved snapshots</h4>
              </div>
              <span className="snapshots-counter-chip">{savedSnapshots.length}</span>
            </div>
            {savedSnapshots.length > 0 ? (
              <div className="snapshot-library-grid snapshots-library-grid--rail">
                {savedSnapshots.map((savedSnapshot) => {
                  const isActive = savedSnapshot.id === selectedSnapshot?.id
                  const restorePreview =
                    (savedSnapshot.id === selectedSnapshot?.id ? selectedSnapshotRestore : deriveDraftValuesFromParameterBackup(snapshot.parameters, savedSnapshot.backup)) ?? {
                      draftValues: {},
                      matchedCount: 0,
                      changedCount: 0,
                      unchangedCount: 0,
                      unknownParameterIds: []
                    }

                  return (
                    <button
                      key={savedSnapshot.id}
                      type="button"
                      data-testid={`snapshot-card-${savedSnapshot.id}`}
                      className={`snapshot-card${isActive ? ' is-active' : ''}`}
                      onClick={() => setSelectedSnapshotId(savedSnapshot.id)}
                    >
                      <div className="snapshot-card__header">
                        <div>
                          <strong>{savedSnapshot.label}</strong>
                          <small>{formatSnapshotTimestamp(savedSnapshot.capturedAt)}</small>
                        </div>
                        <span className="snapshots-counter-chip">
                          {restorePreview.changedCount > 0 ? `${restorePreview.changedCount} diff` : 'matched'}
                        </span>
                      </div>

                      <div className="config-pills">
                        <span>{savedSnapshot.source === 'captured' ? 'captured here' : 'imported'}</span>
                        <span>{savedSnapshot.backup.parameterCount} params</span>
                        <span>{savedSnapshot.backup.vehicle?.vehicle ?? savedSnapshot.backup.firmware}</span>
                        {/* Fleet-management: surface the STM32 UID on the
                            list card too so the operator can sort/scan
                            snapshots by physical board without opening
                            each. Truncated for the list density; full
                            UID is in the detail view + the title tooltip. */}
                        {savedSnapshot.backup.hardware?.uid && isMeaningfulHardwareUid(savedSnapshot.backup.hardware.uid) ? (
                          <span
                            title={`STM32 UID: ${savedSnapshot.backup.hardware.uid}`}
                            data-testid={`snapshot-card-uid-${savedSnapshot.id}`}
                          >
                            UID {formatHardwareUidShort(savedSnapshot.backup.hardware.uid)}
                          </span>
                        ) : null}
                        {savedSnapshot.protected ? <span className="is-target">protected</span> : null}
                        {savedSnapshot.tags.slice(0, 3).map((tag) => (
                          <span key={`${savedSnapshot.id}:${tag}`}>#{tag}</span>
                        ))}
                      </div>

                      <p>
                        {savedSnapshot.backup.vehicle
                          ? `${savedSnapshot.backup.vehicle.flightMode} at export from sys ${savedSnapshot.backup.vehicle.systemId} / comp ${savedSnapshot.backup.vehicle.componentId}.`
                          : 'Vehicle identity was not embedded in this imported backup file.'}
                      </p>
                      {savedSnapshot.note ? <small className="snapshot-card__note">{savedSnapshot.note}</small> : null}
                    </button>
                  )
                })}
              </div>
            ) : (
              <div className="snapshots-empty-state">
                <h4>No saved snapshots yet</h4>
                <p>Capture the current controller or import an existing library to create your first restore baseline.</p>
              </div>
            )}
            </div>

            {selectedSnapshot ? (
              <div className="snapshot-selected snapshots-detail-panel">
                <div className="telemetry-header">
                  <div>
                    <h3>{selectedSnapshot.label}</h3>
                    <p>
                      {selectedSnapshot.source === 'captured'
                        ? 'Captured from the current browser session.'
                        : 'Imported into the local browser snapshot library.'}
                    </p>
                  </div>
                  <StatusBadge tone={selectedSnapshotChangedEntries.length > 0 ? 'warning' : 'success'}>
                    {selectedSnapshotChangedEntries.length > 0 ? 'restore available' : 'already matched'}
                  </StatusBadge>
                </div>

                <div className="telemetry-metric-grid snapshots-metrics-grid">
                  <article className="telemetry-metric-card snapshots-metric-card">
                    <span>Captured</span>
                    <strong>{formatSnapshotTimestamp(selectedSnapshot.capturedAt)}</strong>
                  </article>
                  <article className="telemetry-metric-card snapshots-metric-card">
                    <span>Matched live</span>
                    <strong>{selectedSnapshotRestore?.unchangedCount ?? 0}</strong>
                  </article>
                  <article className="telemetry-metric-card snapshots-metric-card">
                    <span>Unknown on live</span>
                    <strong>{selectedSnapshotRestore?.unknownParameterIds.length ?? 0}</strong>
                  </article>
                  <article className="telemetry-metric-card snapshots-metric-card">
                    <span>Restore writes</span>
                    <strong>{selectedSnapshotChangedEntries.length}</strong>
                  </article>
                </div>

                <div className="config-pills">
                  <span>{selectedSnapshot.backup.vehicle?.vehicle ?? selectedSnapshot.backup.firmware}</span>
                  <span>{selectedSnapshot.backup.vehicle?.firmware ?? 'Unknown firmware'}</span>
                  <span>{selectedSnapshot.backup.vehicle?.flightMode ?? 'Mode unknown at export'}</span>
                  <span>{selectedSnapshot.backup.parameterCount} parameters</span>
                  {/* Hardware identity pills (fleet-management visibility):
                      AUTOPILOT_VERSION.uid (STM32 UID), board type, and
                      USB VID/PID. The data was already captured into the
                      backup at snapshot time — these just surface it. */}
                  {selectedSnapshot.backup.hardware?.uid && isMeaningfulHardwareUid(selectedSnapshot.backup.hardware.uid) ? (
                    <span
                      data-testid="snapshot-hardware-uid"
                      title={`STM32 UID — uniquely identifies the physical flight controller this snapshot came from.`}
                    >
                      UID {formatHardwareUidShort(selectedSnapshot.backup.hardware.uid)}
                    </span>
                  ) : null}
                  {selectedSnapshot.backup.hardware?.boardType !== undefined ? (
                    <span data-testid="snapshot-hardware-board-type" title="Bootloader board id (AUTOPILOT_VERSION.board_version → board_type).">
                      Board {selectedSnapshot.backup.hardware.boardType}
                    </span>
                  ) : null}
                  {selectedSnapshot.backup.hardware?.vendorId !== undefined && selectedSnapshot.backup.hardware.productId !== undefined ? (
                    <span data-testid="snapshot-hardware-usb-id" title="USB VID:PID of the flight controller at snapshot time.">
                      USB {formatUsbId(selectedSnapshot.backup.hardware.vendorId, selectedSnapshot.backup.hardware.productId)}
                    </span>
                  ) : null}
                  {selectedSnapshot.protected ? <span className="is-target">protected baseline</span> : null}
                  {selectedSnapshot.tags.map((tag) => (
                    <span key={`${selectedSnapshot.id}:detail:${tag}`}>#{tag}</span>
                  ))}
                </div>

                {selectedSnapshot.note ? <p className="snapshot-selected__note">{selectedSnapshot.note}</p> : null}

                {selectedSnapshotRestore && selectedSnapshotRestore.unknownParameterIds.length > 0 ? (
                  <div className="parameter-follow-up parameter-follow-up--warning">
                    <StatusBadge tone="warning">partial</StatusBadge>
                    <p>
                      {selectedSnapshotRestore.unknownParameterIds.length} snapshot parameter(s) do not exist in the current live metadata set and will
                      be ignored during restore.
                    </p>
                  </div>
                ) : null}

                <div className="snapshots-detail-section-heading">
                  <div>
                    <h4>{snapshotCompareBaselineId ? 'Changed between snapshots' : 'Restore preview — changed parameters'}</h4>
                  </div>
                  <span className="snapshots-counter-chip">
                    {selectedSnapshotChangedEntries.length}
                    {snapshotCompareBaselineId ? ' diff' : ' writes'}
                  </span>
                </div>

                {/* Compare baseline picker. Default is the live FC; the
                    operator can swap to any OTHER saved snapshot to get
                    a snapshot-vs-snapshot diff. Hidden when only the
                    selected snapshot exists (no other baseline to pick). */}
                {savedSnapshots.length > 1 ? (
                  <div className="snapshots-compare-picker" data-testid="snapshot-compare-picker">
                    <label>
                      <span>Compare to baseline:</span>
                      <select
                        data-testid="snapshot-compare-baseline-select"
                        value={snapshotCompareBaselineId ?? '__live__'}
                        onChange={(event) => {
                          const next = event.target.value
                          onSnapshotCompareBaselineIdChange(next === '__live__' ? undefined : next)
                        }}
                      >
                        <option value="__live__">Live flight controller (default)</option>
                        {savedSnapshots
                          .filter((entry) => entry.id !== selectedSnapshot.id)
                          .map((entry) => (
                            <option key={entry.id} value={entry.id}>
                              {entry.label}
                              {entry.backup.hardware?.uid && isMeaningfulHardwareUid(entry.backup.hardware.uid)
                                ? `  ·  UID ${formatHardwareUidShort(entry.backup.hardware.uid)}`
                                : ''}
                            </option>
                          ))}
                      </select>
                    </label>
                    {snapshotCompareBaselineId ? (
                      <small className="snapshots-compare-picker__note">
                        Diff is &ldquo;baseline snapshot value &rarr; selected snapshot value.&rdquo; Restore writes the SELECTED snapshot to the live FC regardless of this baseline.
                      </small>
                    ) : null}
                  </div>
                ) : null}

                {selectedSnapshotChangedEntries.length > 0 ? (
                  <div className="parameter-diff-grid">
                    {selectedSnapshotDiffGroups.map((group) => (
                      <section key={group.category} className="parameter-diff-group">
                        <header>
                          <strong>{formatCategoryLabel(group.category)}</strong>
                          <span>{group.entries.length} changed</span>
                        </header>

                        {group.entries.map((draft) => (
                          <div key={draft.id} className="parameter-diff-item">
                            <span>
                              <strong>{draft.id}</strong>
                              <small>{draft.label}</small>
                            </span>
                            <span className="parameter-diff-values">
                              {formatParameterValue(draft.currentValue, draft.definition?.unit)} to{' '}
                              {formatParameterValue(draft.nextValue, draft.definition?.unit)}
                              {draft.definition?.bitmask === true ? (
                                <small data-testid={`snapshot-diff-bits-${draft.id}`}>
                                  {describeBitmaskDraftValue(draft.definition, draft.currentValue) ?? '—'}
                                  {' → '}
                                  {describeBitmaskDraftValue(draft.definition, draft.nextValue) ?? '—'}
                                </small>
                              ) : null}
                            </span>
                            <span className="parameter-diff-delta">{formatParameterDelta(draft.delta, draft.definition?.unit)}</span>
                            {/* Per-row apply (field request: like the
                             *  Parameters tab). Same overwrite ack gates it
                             *  as the full restore. */}
                            <button
                              type="button"
                              style={buttonStyle()}
                              data-testid={`snapshot-diff-apply-${draft.id}`}
                              onClick={() => void handleApplySnapshotEntry(draft)}
                              disabled={busyAction !== undefined || !snapshotRestoreAcknowledged}
                              title={
                                snapshotRestoreAcknowledged
                                  ? `Write only ${draft.id} from this snapshot to the controller.`
                                  : 'Acknowledge the overwrite warning below first.'
                              }
                            >
                              Apply
                            </button>
                          </div>
                        ))}
                      </section>
                    ))}
                  </div>
                ) : (
                  <p className="telemetry-note">
                    This snapshot already matches the currently synced controller values. Capture another live snapshot or choose another library entry to
                    compare.
                  </p>
                )}

                {selectedSnapshotInvalidEntries.length > 0 ? (
                  <>
                    <div className="snapshots-detail-section-heading snapshots-detail-section-heading--compact">
                      <div>
                        <h4>Review invalid restore entries</h4>
                      </div>
                      <span className="snapshots-counter-chip is-danger">{selectedSnapshotInvalidEntries.length} blocked</span>
                    </div>
                  <div className="parameter-diff-grid parameter-diff-grid--invalid">
                    <section className="parameter-diff-group parameter-diff-group--invalid">
                      <header>
                        <strong>Invalid restore values</strong>
                        <span>{selectedSnapshotInvalidEntries.length} blocked</span>
                      </header>

                      {selectedSnapshotInvalidEntries.map((draft) => (
                        <div key={draft.id} className="parameter-diff-item">
                          <span>
                            <strong>{draft.id}</strong>
                            <small>{draft.label}</small>
                          </span>
                          <span className="parameter-diff-values">{draft.rawValue || 'Empty draft'}</span>
                          <span className="parameter-diff-delta">{draft.reason ?? 'Invalid value'}</span>
                        </div>
                      ))}
                    </section>
                  </div>
                  </>
                ) : null}

                <div className="snapshots-detail-section-heading snapshots-detail-section-heading--compact">
                  <div>
                    <h4>Apply restore</h4>
                  </div>
                </div>

                <div className="parameter-follow-up parameter-follow-up--warning">
                  <StatusBadge tone="warning">overwrite</StatusBadge>
                  <p>
                    Snapshot restore writes only the diff against the current live controller, verifies readback, and rolls back earlier writes if a later
                    write fails. It still overwrites the current live values for every changed parameter listed above.
                  </p>
                </div>

                <label className="snapshot-restore-ack">
                  <input
                    data-testid="snapshot-restore-ack"
                    type="checkbox"
                    checked={snapshotRestoreAcknowledged}
                    onChange={(event) => setSnapshotRestoreAcknowledged(event.target.checked)}
                    disabled={busyAction !== undefined || selectedSnapshotChangedEntries.length === 0}
                  />
                  <span>I understand that applying this restore will overwrite the current live values shown in the diff above.</span>
                </label>

                <div className="snapshots-action-row snapshots-action-row--detail">
                  <button
                    data-testid="apply-snapshot-restore-button"
                    className="snapshots-button snapshots-button--primary"
                    onClick={() => void handleApplySelectedSnapshotRestore()}
                    disabled={
                      busyAction !== undefined ||
                      selectedSnapshotChangedEntries.length === 0 ||
                      selectedSnapshotInvalidEntries.length > 0 ||
                      !snapshotRestoreAcknowledged ||
                      !canApplyDraftParameters
                    }
                  >
                    {busyAction === 'snapshots:apply' ? 'Applying…' : `Apply Snapshot Restore (${selectedSnapshotChangedEntries.length})`}
                  </button>
                  {isExpertMode ? (
                    <button
                      className="snapshots-button snapshots-button--secondary"
                      onClick={handleStageSelectedSnapshotDiff}
                      disabled={busyAction !== undefined || selectedSnapshotChangedEntries.length === 0}
                    >
                      Send Diff to Parameters
                    </button>
                  ) : null}
                  <button className="snapshots-button snapshots-button--secondary" onClick={handleExportSelectedSnapshot} disabled={busyAction !== undefined}>
                    Export Selected
                  </button>
                  <button
                    data-testid="toggle-selected-snapshot-protection-button"
                    className="snapshots-button snapshots-button--ghost"
                    onClick={handleToggleSelectedSnapshotProtection}
                    disabled={busyAction !== undefined}
                  >
                    {selectedSnapshot.protected ? 'Unprotect Selected' : 'Protect Selected'}
                  </button>
                  <button
                    data-testid="delete-selected-snapshot-button"
                    className="snapshots-button snapshots-button--ghost"
                    onClick={handleDeleteSelectedSnapshot}
                    disabled={busyAction !== undefined || selectedSnapshot.protected}
                  >
                    Delete Selected
                  </button>
                </div>
              </div>
            ) : (
              <div className="snapshots-empty-state snapshots-empty-state--detail">
                <h4>Choose a snapshot to inspect its restore diff</h4>
                <p>The active baseline becomes the app-wide restore reference and keeps drift visible across the rest of the product.</p>
              </div>
            )}
          </>
        }
        provisioningFormSlot={
          <>
            <div className="snapshots-section-header">
              <div>
                <h3>Reusable profiles for production-line setup</h3>
                <p>Create reusable model, fleet, and mission profiles from trusted baselines, then apply them through the same verified restore path.</p>
              </div>
              <div className="snapshots-section-meta">
              <span
                className={`snapshots-counter-chip${
                  selectedProvisioningProfileInvalidEntries.length > 0 ? ' is-danger' : selectedProvisioningProfileChangedEntries.length > 0 ? ' is-warning' : ''
                }`}
              >
                {selectedProvisioningProfileInvalidEntries.length > 0
                  ? `${selectedProvisioningProfileInvalidEntries.length} invalid`
                  : selectedProvisioningProfileChangedEntries.length > 0
                    ? `${selectedProvisioningProfileChangedEntries.length} diff`
                    : `${savedProvisioningProfiles.length} profiles`}
              </span>
              </div>
            </div>

            <p className="telemetry-note snapshots-inline-note">
              This first provisioning pass is profile-driven: build reusable batches now, then apply and validate one connected vehicle at a time
              through the existing runtime.
            </p>

            <div className="snapshot-capture-row snapshots-form-grid snapshots-form-grid--provisioning">
              <div className="snapshots-form-group-heading">
                <span>Profile Identity</span>
                <p>Describe the unit, fleet, and mission variant this profile is intended for.</p>
              </div>

              <label className="scoped-editor-field snapshots-field">
                <span>Profile label</span>
                <input
                  data-testid="provisioning-profile-label-input"
                  type="text"
                  value={provisioningProfileLabelInput}
                  onChange={(event) => setProvisioningProfileLabelInput(event.target.value)}
                  placeholder="Pavo20 cinematic baseline"
                />
                <small>Use a durable operator-facing name.</small>
              </label>

              <label className="scoped-editor-field snapshots-field">
                <span>Source</span>
                <select
                  data-testid="provisioning-profile-source-select"
                  value={provisioningProfileSourceInput}
                  onChange={(event) => setProvisioningProfileSourceInput(event.target.value as ProvisioningProfileSourceMode)}
                >
                  <option value="selected-snapshot">Selected snapshot baseline</option>
                  <option value="live-controller">Current live controller</option>
                </select>
                <small>Choose whether the baseline comes from a saved snapshot or the live FC.</small>
              </label>

              <label className="scoped-editor-field snapshots-field">
                <span>Drone model</span>
                <input
                  type="text"
                  value={provisioningProfileModelInput}
                  onChange={(event) => setProvisioningProfileModelInput(event.target.value)}
                  placeholder="BETAFPV Pavo20"
                />
                <small>Model metadata makes filtering and assignment clearer later.</small>
              </label>

              <label className="scoped-editor-field snapshots-field">
                <span>Fleet / customer</span>
                <input
                  type="text"
                  value={provisioningProfileFleetInput}
                  onChange={(event) => setProvisioningProfileFleetInput(event.target.value)}
                  placeholder="Garage fleet"
                />
                <small>Use this to group quads by build, owner, or workshop.</small>
              </label>

              <label className="scoped-editor-field snapshots-field">
                <span>Mission profile</span>
                <input
                  type="text"
                  value={provisioningProfileMissionInput}
                  onChange={(event) => setProvisioningProfileMissionInput(event.target.value)}
                  placeholder="Acro freestyle"
                />
                <small>Optional mission-specific label for payload, OSD, failsafe, or rate variants.</small>
              </label>

              <label className="scoped-editor-field snapshots-field">
                <span>Tags</span>
                <input
                  type="text"
                  value={provisioningProfileTagsInput}
                  onChange={(event) => setProvisioningProfileTagsInput(event.target.value)}
                  placeholder="batch, taf, elrs"
                />
                <small>Optional comma-separated tags for search and export context.</small>
              </label>

              <div className="snapshots-form-group-heading">
                <span>Source</span>
                <p>Choose the baseline, then decide whether staged draft values should ride on top as an overlay.</p>
              </div>

              <div className="snapshot-capture-actions provisioning-capture-actions">
                <label className="snapshot-protected-toggle snapshots-setting-row">
                  <input
                    type="checkbox"
                    checked={provisioningProfileProtectedInput}
                    onChange={(event) => setProvisioningProfileProtectedInput(event.target.checked)}
                  />
                  <span>
                    <strong>Protect this profile</strong>
                    <small>Prevents accidental removal of a trusted production template.</small>
                  </span>
                </label>

                <label className="snapshot-protected-toggle snapshots-setting-row">
                  <input
                    data-testid="provisioning-profile-include-drafts-toggle"
                    type="checkbox"
                    checked={includeDraftOverlayInProvisioningProfile}
                    onChange={(event) => setIncludeDraftOverlayInProvisioningProfile(event.target.checked)}
                    disabled={stagedProvisioningOverlayParameters.length === 0}
                  />
                  <span>
                    <strong>Include staged parameter drafts as an overlay</strong>
                    <small>{stagedProvisioningOverlayParameters.length} staged parameter(s) available right now.</small>
                  </span>
                </label>
              </div>

              <div className="snapshots-form-group-heading">
                <span>Validation</span>
                <p>Store the operational checklist each unit should pass before it leaves the bench.</p>
              </div>

              <label className="scoped-editor-field snapshots-field snapshots-field--wide">
                <span>Checklist</span>
                <textarea
                  data-testid="provisioning-profile-checklist-input"
                  value={provisioningProfileChecklistInput}
                  onChange={(event) => setProvisioningProfileChecklistInput(event.target.value)}
                  rows={6}
                  placeholder="One validation item per line."
                />
                <small>Store the bench checklist every unit should pass after provisioning.</small>
              </label>

              <div className="snapshots-form-group-heading">
                <span>Notes & Actions</span>
                <p>Keep the supporting context brief, then create or exchange the profile library.</p>
              </div>

              <label className="scoped-editor-field snapshots-field snapshots-field--wide">
                <span>Note</span>
                <textarea
                  value={provisioningProfileNoteInput}
                  onChange={(event) => setProvisioningProfileNoteInput(event.target.value)}
                  rows={4}
                  placeholder="Optional context for operators, manufacturing, or sustainment."
                />
                <small>Use this for build notes, payload assumptions, or deployment caveats.</small>
              </label>

              <div className="snapshot-capture-actions provisioning-capture-actions">
                <div className="snapshots-action-row">
                  <button
                    data-testid="capture-provisioning-profile-button"
                    className="snapshots-button snapshots-button--primary"
                    onClick={handleCreateProvisioningProfile}
                    disabled={
                      busyAction !== undefined ||
                      (provisioningProfileSourceInput === 'selected-snapshot' ? !selectedSnapshot : snapshot.parameters.length === 0)
                    }
                  >
                    Create Provisioning Profile
                  </button>
                  <button
                    className="snapshots-button snapshots-button--secondary"
                    onClick={handleOpenProvisioningImport}
                    disabled={busyAction !== undefined}
                  >
                    Import Provisioning Library
                  </button>
                  <button
                    data-testid="export-provisioning-library-button"
                    className="snapshots-button snapshots-button--secondary"
                    onClick={handleExportProvisioningLibrary}
                    disabled={busyAction !== undefined || savedProvisioningProfiles.length === 0}
                  >
                    Export Provisioning Library
                  </button>
                </div>
              </div>
            </div>

            <div className="snapshots-feedback-stack">
            {provisioningStorageNotice ? (
              <div className="parameter-review__notice snapshots-notice">
                <StatusBadge tone={provisioningStorageNotice.tone}>{provisioningStorageNotice.tone}</StatusBadge>
                <p>{provisioningStorageNotice.text}</p>
              </div>
            ) : null}

            {provisioningNotice ? (
              <div className="parameter-review__notice snapshots-notice">
                <StatusBadge tone={provisioningNotice.tone}>{provisioningNotice.tone}</StatusBadge>
                <p>{provisioningNotice.text}</p>
              </div>
            ) : null}
            </div>

            <div className="telemetry-metric-grid snapshots-metrics-grid">
              <article className="telemetry-metric-card snapshots-metric-card">
                <span>Saved profiles</span>
                <strong>{savedProvisioningProfiles.length}</strong>
              </article>
              <article className="telemetry-metric-card snapshots-metric-card">
                <span>Base params</span>
                <strong>{selectedProvisioningProfile?.baseBackup.parameterCount ?? 0}</strong>
              </article>
              <article className="telemetry-metric-card snapshots-metric-card">
                <span>Overlay params</span>
                <strong>{selectedProvisioningProfile?.overlayParameters.length ?? 0}</strong>
              </article>
              <article className="telemetry-metric-card snapshots-metric-card">
                <span>Checklist items</span>
                <strong>{selectedProvisioningProfile?.validationChecklist.length ?? 0}</strong>
              </article>
            </div>
          </>
        }
        provisioningPreviewSlot={
          <>
            <div className="snapshots-browser-rail">
            <div className="snapshots-browser-rail__header">
              <div>
                <h4>Saved profiles</h4>
              </div>
              <span className="snapshots-counter-chip">{savedProvisioningProfiles.length}</span>
            </div>
            {savedProvisioningProfiles.length > 0 ? (
              <div className="snapshot-library-grid snapshots-library-grid--rail">
                {savedProvisioningProfiles.map((savedProfile) => {
                  const isActive = savedProfile.id === selectedProvisioningProfile?.id
                  const restorePreview =
                    (savedProfile.id === selectedProvisioningProfile?.id
                      ? selectedProvisioningProfileRestore
                      : deriveDraftValuesFromParameterBackup(snapshot.parameters, deriveProvisioningProfileBackup(savedProfile))) ?? {
                      draftValues: {},
                      matchedCount: 0,
                      changedCount: 0,
                      unchangedCount: 0,
                      unknownParameterIds: []
                    }

                  return (
                    <button
                      key={savedProfile.id}
                      type="button"
                      data-testid={`provisioning-profile-card-${savedProfile.id}`}
                      className={`snapshot-card${isActive ? ' is-active' : ''}`}
                      onClick={() => setSelectedProvisioningProfileId(savedProfile.id)}
                    >
                      <div className="snapshot-card__header">
                        <div>
                          <strong>{savedProfile.label}</strong>
                          <small>{formatSnapshotTimestamp(savedProfile.createdAt)}</small>
                        </div>
                        <span className="snapshots-counter-chip">
                          {restorePreview.changedCount > 0 ? `${restorePreview.changedCount} diff` : 'matched'}
                        </span>
                      </div>

                      <div className="config-pills">
                        <span>{savedProfile.model ?? 'Model not set'}</span>
                        {savedProfile.fleet ? <span>{savedProfile.fleet}</span> : null}
                        {savedProfile.mission ? <span>{savedProfile.mission}</span> : null}
                        <span>{savedProfile.overlayParameters.length} overlay</span>
                        {savedProfile.protected ? <span className="is-target">protected</span> : null}
                      </div>

                      <p>
                        {savedProfile.sourceSnapshotLabel
                          ? `Built from snapshot "${savedProfile.sourceSnapshotLabel}" and ${savedProfile.overlayParameters.length} overlay parameter(s).`
                          : `Built from a live controller baseline and ${savedProfile.overlayParameters.length} overlay parameter(s).`}
                      </p>
                      {savedProfile.note ? <small className="snapshot-card__note">{savedProfile.note}</small> : null}
                    </button>
                  )
                })}
              </div>
            ) : (
              <div className="snapshots-empty-state">
                <h4>Create the first provisioning profile</h4>
                <p>Use a selected snapshot or the live controller as a base, then attach model metadata and a validation checklist.</p>
              </div>
            )}
            </div>

            {selectedProvisioningProfile ? (
              <div className="snapshot-selected snapshots-detail-panel">
                <div className="telemetry-header">
                  <div>
                    <h3>{selectedProvisioningProfile.label}</h3>
                    <p>
                      {selectedProvisioningProfile.sourceSnapshotLabel
                        ? `Provisioning profile built from snapshot "${selectedProvisioningProfile.sourceSnapshotLabel}".`
                        : 'Provisioning profile built from a live controller baseline.'}
                    </p>
                  </div>
                  <StatusBadge tone={selectedProvisioningProfileChangedEntries.length > 0 ? 'warning' : 'success'}>
                    {selectedProvisioningProfileChangedEntries.length > 0 ? 'profile diff ready' : 'already matched'}
                  </StatusBadge>
                </div>

                <div className="telemetry-metric-grid snapshots-metrics-grid">
                  <article className="telemetry-metric-card snapshots-metric-card">
                    <span>Created</span>
                    <strong>{formatSnapshotTimestamp(selectedProvisioningProfile.createdAt)}</strong>
                  </article>
                  <article className="telemetry-metric-card snapshots-metric-card">
                    <span>Matched live</span>
                    <strong>{selectedProvisioningProfileRestore?.unchangedCount ?? 0}</strong>
                  </article>
                  <article className="telemetry-metric-card snapshots-metric-card">
                    <span>Unknown on live</span>
                    <strong>{selectedProvisioningProfileRestore?.unknownParameterIds.length ?? 0}</strong>
                  </article>
                  <article className="telemetry-metric-card snapshots-metric-card">
                    <span>Provisioning writes</span>
                    <strong>{selectedProvisioningProfileChangedEntries.length}</strong>
                  </article>
                </div>

                <div className="config-pills">
                  <span>{selectedProvisioningProfile.model ?? 'Model not set'}</span>
                  {selectedProvisioningProfile.fleet ? <span>{selectedProvisioningProfile.fleet}</span> : null}
                  {selectedProvisioningProfile.mission ? <span>{selectedProvisioningProfile.mission}</span> : null}
                  <span>{selectedProvisioningProfile.baseBackup.parameterCount} base params</span>
                  <span>{selectedProvisioningProfile.overlayParameters.length} overlay params</span>
                  {selectedProvisioningProfile.sourceSnapshotLabel ? <span>{selectedProvisioningProfile.sourceSnapshotLabel}</span> : null}
                  {selectedProvisioningProfile.protected ? <span className="is-target">protected profile</span> : null}
                  {selectedProvisioningProfile.tags.map((tag) => (
                    <span key={`${selectedProvisioningProfile.id}:detail:${tag}`}>#{tag}</span>
                  ))}
                </div>

                {selectedProvisioningProfile.note ? <p className="snapshot-selected__note">{selectedProvisioningProfile.note}</p> : null}

                <div className="snapshots-detail-section-heading snapshots-detail-section-heading--compact">
                  <div>
                    <h4>Bench checklist</h4>
                  </div>
                  <span className="snapshots-counter-chip">{selectedProvisioningProfile.validationChecklist.length} items</span>
                </div>

                <div className="provisioning-checklist">
                  {selectedProvisioningProfile.validationChecklist.length > 0 ? (
                    <ul className="output-note-list">
                      {selectedProvisioningProfile.validationChecklist.map((item) => (
                        <li key={item.id}>
                          {item.label}
                          {item.instruction ? <small>{item.instruction}</small> : null}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="telemetry-note">No validation checklist is attached to this profile yet.</p>
                  )}
                </div>

                {selectedProvisioningProfileRestore && selectedProvisioningProfileRestore.unknownParameterIds.length > 0 ? (
                  <div className="parameter-follow-up parameter-follow-up--warning">
                    <StatusBadge tone="warning">partial</StatusBadge>
                    <p>
                      {selectedProvisioningProfileRestore.unknownParameterIds.length} profile parameter(s) do not exist in the current live metadata
                      set and will be ignored during apply.
                    </p>
                  </div>
                ) : null}

                <div className="snapshots-detail-section-heading">
                  <div>
                    <h4>Changed parameters</h4>
                  </div>
                  <span className="snapshots-counter-chip">{selectedProvisioningProfileChangedEntries.length} writes</span>
                </div>

                {selectedProvisioningProfileChangedEntries.length > 0 ? (
                  <div className="parameter-diff-grid">
                    {selectedProvisioningProfileDiffGroups.map((group) => (
                      <section key={group.category} className="parameter-diff-group">
                        <header>
                          <strong>{formatCategoryLabel(group.category)}</strong>
                          <span>{group.entries.length} changed</span>
                        </header>

                        {group.entries.map((draft) => (
                          <div key={draft.id} className="parameter-diff-item">
                            <span>
                              <strong>{draft.id}</strong>
                              <small>{draft.label}</small>
                            </span>
                            <span className="parameter-diff-values">
                              {formatParameterValue(draft.currentValue, draft.definition?.unit)} to{' '}
                              {formatParameterValue(draft.nextValue, draft.definition?.unit)}
                              {draft.definition?.bitmask === true ? (
                                <small data-testid={`profile-diff-bits-${draft.id}`}>
                                  {describeBitmaskDraftValue(draft.definition, draft.currentValue) ?? '—'}
                                  {' → '}
                                  {describeBitmaskDraftValue(draft.definition, draft.nextValue) ?? '—'}
                                </small>
                              ) : null}
                            </span>
                            <span className="parameter-diff-delta">{formatParameterDelta(draft.delta, draft.definition?.unit)}</span>
                          </div>
                        ))}
                      </section>
                    ))}
                  </div>
                ) : (
                  <p className="telemetry-note">
                    This provisioning profile already matches the currently synced controller values. Choose another profile or adjust the baseline and
                    overlay inputs to create a new batch variant.
                  </p>
                )}

                {selectedProvisioningProfileInvalidEntries.length > 0 ? (
                  <>
                  <div className="snapshots-detail-section-heading snapshots-detail-section-heading--compact">
                    <div>
                      <h4>Review invalid provisioning entries</h4>
                    </div>
                    <span className="snapshots-counter-chip is-danger">{selectedProvisioningProfileInvalidEntries.length} blocked</span>
                  </div>
                  <div className="parameter-diff-grid parameter-diff-grid--invalid">
                    <section className="parameter-diff-group parameter-diff-group--invalid">
                      <header>
                        <strong>Invalid provisioning values</strong>
                        <span>{selectedProvisioningProfileInvalidEntries.length} blocked</span>
                      </header>

                      {selectedProvisioningProfileInvalidEntries.map((draft) => (
                        <div key={draft.id} className="parameter-diff-item">
                          <span>
                            <strong>{draft.id}</strong>
                            <small>{draft.label}</small>
                          </span>
                          <span className="parameter-diff-values">{draft.rawValue || 'Empty draft'}</span>
                          <span className="parameter-diff-delta">{draft.reason ?? 'Invalid value'}</span>
                        </div>
                      ))}
                    </section>
                  </div>
                  </>
                ) : null}

                <div className="snapshots-detail-section-heading snapshots-detail-section-heading--compact">
                  <div>
                    <h4>Apply profile</h4>
                  </div>
                </div>

                <div className="parameter-follow-up parameter-follow-up--warning">
                  <StatusBadge tone="warning">production</StatusBadge>
                  <p>
                    Applying a provisioning profile writes only the diff against the current live controller, verifies readback, and keeps the same
                    rollback behavior as snapshot restore. It still overwrites every changed value listed above.
                  </p>
                </div>

                <label className="snapshot-restore-ack">
                  <input
                    data-testid="provisioning-profile-restore-ack"
                    type="checkbox"
                    checked={provisioningRestoreAcknowledged}
                    onChange={(event) => setProvisioningRestoreAcknowledged(event.target.checked)}
                    disabled={busyAction !== undefined || selectedProvisioningProfileChangedEntries.length === 0}
                  />
                  <span>I understand that applying this provisioning profile will overwrite the current live values shown in the diff above.</span>
                </label>

                <div className="snapshots-action-row snapshots-action-row--detail">
                  <button
                    data-testid="apply-provisioning-profile-button"
                    className="snapshots-button snapshots-button--primary"
                    onClick={() => void handleApplySelectedProvisioningProfile()}
                    disabled={
                      busyAction !== undefined ||
                      selectedProvisioningProfileChangedEntries.length === 0 ||
                      selectedProvisioningProfileInvalidEntries.length > 0 ||
                      !provisioningRestoreAcknowledged ||
                      !canApplyDraftParameters
                    }
                  >
                    {busyAction === 'provisioning:apply'
                      ? 'Applying…'
                      : `Apply Provisioning Profile (${selectedProvisioningProfileChangedEntries.length})`}
                  </button>
                  {isExpertMode ? (
                    <button
                      className="snapshots-button snapshots-button--secondary"
                      onClick={handleStageSelectedProvisioningProfileDiff}
                      disabled={busyAction !== undefined || selectedProvisioningProfileChangedEntries.length === 0}
                    >
                      Send Diff to Parameters
                    </button>
                  ) : null}
                  <button
                    className="snapshots-button snapshots-button--secondary"
                    onClick={handleExportSelectedProvisioningProfile}
                    disabled={busyAction !== undefined}
                  >
                    Export Selected Profile
                  </button>
                  <button
                    className="snapshots-button snapshots-button--ghost"
                    onClick={handleToggleSelectedProvisioningProfileProtection}
                    disabled={busyAction !== undefined}
                  >
                    {selectedProvisioningProfile.protected ? 'Unprotect Selected' : 'Protect Selected'}
                  </button>
                  <button
                    className="snapshots-button snapshots-button--ghost"
                    onClick={handleDeleteSelectedProvisioningProfile}
                    disabled={busyAction !== undefined || selectedProvisioningProfile.protected}
                  >
                    Delete Selected
                  </button>
                </div>
              </div>
            ) : (
              <div className="snapshots-empty-state snapshots-empty-state--detail">
                <h4>Choose a provisioning profile to inspect its diff</h4>
                <p>The selected profile shows the exact writes, checklist, and metadata that would be applied to the connected vehicle.</p>
              </div>
            )}
          </>
        }
      />

  )
}
