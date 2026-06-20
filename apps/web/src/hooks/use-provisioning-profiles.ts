// Provisioning-profile library management, extracted from App.tsx as part of
// its decomposition. Owns the provisioning-profile CRUD + import/export I/O:
// import a provisioning library file, create a profile (from the selected
// snapshot or the live controller, optionally with the staged draft overlay),
// export the library / a selected profile, delete, and toggle deletion
// protection.
//
// Scope boundary (mirrors use-snapshot-library): this is the profile *storage*
// subsystem only. The two parameter-editor-integration handlers —
// handleStageSelectedProvisioningProfileDiff and handleApplySelectedProvisioningProfile
// — stay in App.tsx, because they reach into navigation (setActiveViewId /
// setSelectedParameterId), the shared draft-apply handler, the restore-
// acknowledgement state, and the derived restore-diff memos. The trivial
// handleOpenProvisioningImport (a one-line .click() on an App-owned ref) also
// stays.
//
// Behavior-neutral lift of the original App() functions — same logic, same
// notice copy, same analytics events, same non-memoized identities.

import type { ChangeEvent, Dispatch, SetStateAction } from 'react'

import {
  createParameterBackup,
  createParameterProvisioningLibrary,
  createParameterProvisioningProfile,
  parseParameterProvisioningLibrary,
  serializeParameterProvisioningLibrary,
  type ConfiguratorSnapshot,
  type ParameterBackupEntry
} from '@arduconfig/ardupilot-core'

import { trackAppEvent } from '../analytics'
import { downloadTextFile } from '../download-file'
import {
  buildProvisioningLibraryFilename,
  buildProvisioningProfileFilename,
  mergeSavedProvisioningProfiles,
  parseProvisioningChecklist,
  parseSnapshotTags,
  updateSavedProvisioningProfile
} from '../library-helpers'
import type { SavedProvisioningProfile } from '../provisioning-library'
import type { SavedParameterSnapshot } from '../snapshot-library'
import { DEFAULT_PROVISIONING_CHECKLIST_LINES, type ProvisioningProfileSourceMode } from './use-library-forms'
import type { ParameterNotice } from './use-parameter-feedback'

export interface UseProvisioningProfilesParams {
  snapshot: ConfiguratorSnapshot
  selectedSnapshot: SavedParameterSnapshot | undefined
  selectedProvisioningProfile: SavedProvisioningProfile | undefined
  savedProvisioningProfiles: SavedProvisioningProfile[]
  setSavedProvisioningProfiles: Dispatch<SetStateAction<SavedProvisioningProfile[]>>
  setSelectedProvisioningProfileId: Dispatch<SetStateAction<string | undefined>>
  stagedProvisioningOverlayParameters: ParameterBackupEntry[]
  includeDraftOverlayInProvisioningProfile: boolean
  setIncludeDraftOverlayInProvisioningProfile: Dispatch<SetStateAction<boolean>>
  provisioningProfileSourceInput: ProvisioningProfileSourceMode
  provisioningProfileLabelInput: string
  setProvisioningProfileLabelInput: Dispatch<SetStateAction<string>>
  provisioningProfileModelInput: string
  setProvisioningProfileModelInput: Dispatch<SetStateAction<string>>
  provisioningProfileFleetInput: string
  setProvisioningProfileFleetInput: Dispatch<SetStateAction<string>>
  provisioningProfileMissionInput: string
  setProvisioningProfileMissionInput: Dispatch<SetStateAction<string>>
  provisioningProfileNoteInput: string
  setProvisioningProfileNoteInput: Dispatch<SetStateAction<string>>
  provisioningProfileTagsInput: string
  setProvisioningProfileTagsInput: Dispatch<SetStateAction<string>>
  provisioningProfileChecklistInput: string
  setProvisioningProfileChecklistInput: Dispatch<SetStateAction<string>>
  provisioningProfileProtectedInput: boolean
  setProvisioningProfileProtectedInput: Dispatch<SetStateAction<boolean>>
  setProvisioningNotice: Dispatch<SetStateAction<ParameterNotice | undefined>>
}

export interface UseProvisioningProfilesResult {
  handleImportProvisioningLibrary: (event: ChangeEvent<HTMLInputElement>) => Promise<void>
  handleCreateProvisioningProfile: () => void
  handleExportProvisioningLibrary: () => void
  handleExportSelectedProvisioningProfile: () => void
  handleDeleteSelectedProvisioningProfile: () => void
  handleToggleSelectedProvisioningProfileProtection: () => void
}

export function useProvisioningProfiles({
  snapshot,
  selectedSnapshot,
  selectedProvisioningProfile,
  savedProvisioningProfiles,
  setSavedProvisioningProfiles,
  setSelectedProvisioningProfileId,
  stagedProvisioningOverlayParameters,
  includeDraftOverlayInProvisioningProfile,
  setIncludeDraftOverlayInProvisioningProfile,
  provisioningProfileSourceInput,
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
  setProvisioningNotice
}: UseProvisioningProfilesParams): UseProvisioningProfilesResult {
  async function handleImportProvisioningLibrary(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0]
    if (!file) {
      return
    }

    try {
      const library = parseParameterProvisioningLibrary(await file.text())
      setSavedProvisioningProfiles((current) => mergeSavedProvisioningProfiles(current, library.profiles))
      setProvisioningNotice({
        tone: 'success',
        text: `Imported provisioning library "${library.name}" with ${library.profiles.length} profile(s).`
      })
    } catch (error) {
      setProvisioningNotice({
        tone: 'danger',
        text: error instanceof Error ? error.message : 'Failed to import provisioning library.'
      })
    } finally {
      event.target.value = ''
    }
  }

  function handleCreateProvisioningProfile(): void {
    const sourceMode = provisioningProfileSourceInput
    const baseBackup =
      sourceMode === 'selected-snapshot'
        ? selectedSnapshot?.backup
        : snapshot.parameters.length > 0
          ? createParameterBackup(snapshot)
          : undefined

    if (!baseBackup) {
      setProvisioningNotice({
        tone: 'warning',
        text:
          sourceMode === 'selected-snapshot'
            ? 'Select or capture a snapshot before creating a provisioning profile from it.'
            : 'Pull parameters before creating a provisioning profile from the live controller.'
      })
      return
    }

    const overlayParameters = includeDraftOverlayInProvisioningProfile ? stagedProvisioningOverlayParameters : []
    const profile = createParameterProvisioningProfile(baseBackup, provisioningProfileLabelInput, {
      source: sourceMode === 'selected-snapshot' ? 'snapshot' : 'live',
      note: provisioningProfileNoteInput,
      tags: parseSnapshotTags(provisioningProfileTagsInput),
      protected: provisioningProfileProtectedInput,
      model: provisioningProfileModelInput,
      fleet: provisioningProfileFleetInput,
      mission: provisioningProfileMissionInput,
      sourceSnapshotId: sourceMode === 'selected-snapshot' ? selectedSnapshot?.id : undefined,
      sourceSnapshotLabel: sourceMode === 'selected-snapshot' ? selectedSnapshot?.label : undefined,
      overlayParameters,
      validationChecklist: parseProvisioningChecklist(provisioningProfileChecklistInput)
    })

    setSavedProvisioningProfiles((current) => [profile, ...current.filter((entry) => entry.id !== profile.id)])
    setSelectedProvisioningProfileId(profile.id)
    setProvisioningProfileLabelInput('')
    setProvisioningProfileModelInput('')
    setProvisioningProfileFleetInput('')
    setProvisioningProfileMissionInput('')
    setProvisioningProfileNoteInput('')
    setProvisioningProfileTagsInput('')
    setProvisioningProfileChecklistInput(DEFAULT_PROVISIONING_CHECKLIST_LINES.join('\n'))
    setProvisioningProfileProtectedInput(false)
    setIncludeDraftOverlayInProvisioningProfile(false)
    setProvisioningNotice({
      tone: 'success',
      text: `Saved provisioning profile "${profile.label}" with ${profile.baseBackup.parameterCount} base parameters and ${profile.overlayParameters.length} overlay parameter(s).`
    })
    trackAppEvent('Provisioning Profile Created', {
      source: sourceMode,
      baseParameterCount: profile.baseBackup.parameterCount,
      overlayParameterCount: profile.overlayParameters.length,
      checklistCount: profile.validationChecklist.length
    })
  }

  function handleExportProvisioningLibrary(): void {
    const library = createParameterProvisioningLibrary('Browser Local Provisioning Library', savedProvisioningProfiles)
    downloadTextFile(buildProvisioningLibraryFilename(), serializeParameterProvisioningLibrary(library))
    setProvisioningNotice({
      tone: 'success',
      text: `Exported provisioning library with ${library.profiles.length} profile(s).`
    })
  }

  function handleExportSelectedProvisioningProfile(): void {
    if (!selectedProvisioningProfile) {
      return
    }

    const library = createParameterProvisioningLibrary(selectedProvisioningProfile.label, [selectedProvisioningProfile])
    downloadTextFile(buildProvisioningProfileFilename(selectedProvisioningProfile), serializeParameterProvisioningLibrary(library))
    setProvisioningNotice({
      tone: 'success',
      text: `Exported provisioning profile "${selectedProvisioningProfile.label}".`
    })
  }

  function handleDeleteSelectedProvisioningProfile(): void {
    if (!selectedProvisioningProfile) {
      return
    }

    if (selectedProvisioningProfile.protected) {
      setProvisioningNotice({
        tone: 'warning',
        text: `Provisioning profile "${selectedProvisioningProfile.label}" is protected. Unprotect it before deleting it from the local library.`
      })
      return
    }

    setSavedProvisioningProfiles((current) => current.filter((entry) => entry.id !== selectedProvisioningProfile.id))
    setProvisioningNotice({
      tone: 'neutral',
      text: `Deleted provisioning profile "${selectedProvisioningProfile.label}" from the local browser library.`
    })
  }

  function handleToggleSelectedProvisioningProfileProtection(): void {
    if (!selectedProvisioningProfile) {
      return
    }

    const nextProtected = !selectedProvisioningProfile.protected
    setSavedProvisioningProfiles((current) =>
      updateSavedProvisioningProfile(current, selectedProvisioningProfile.id, (savedProfile) => ({
        ...savedProfile,
        protected: nextProtected
      }))
    )
    setProvisioningNotice({
      tone: 'success',
      text: nextProtected
        ? `Provisioning profile "${selectedProvisioningProfile.label}" is now protected against deletion.`
        : `Provisioning profile "${selectedProvisioningProfile.label}" is no longer protected.`
    })
  }

  return {
    handleImportProvisioningLibrary,
    handleCreateProvisioningProfile,
    handleExportProvisioningLibrary,
    handleExportSelectedProvisioningProfile,
    handleDeleteSelectedProvisioningProfile,
    handleToggleSelectedProvisioningProfileProtection
  }
}
