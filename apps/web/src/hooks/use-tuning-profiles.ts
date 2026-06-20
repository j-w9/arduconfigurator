// Tuning-profile library management, extracted from App.tsx as part of its
// decomposition. Owns the tuning-profile CRUD: create a profile (from the live
// tune or the staged draft set), delete, and toggle deletion protection.
// Tuning profiles have no separate import/export-library surface (unlike
// snapshots / provisioning profiles), so this is the whole storage subsystem.
//
// Scope boundary (mirrors use-snapshot-library / use-provisioning-profiles):
// the parameter-editor-integration handler, handleStageSelectedTuningProfile,
// stays in App.tsx — it merges the profile's diff into the shared draft set
// (mergeDrafts) and reads the derived restore-diff memos, so it belongs with
// the Tuning/Expert editor flow, not profile storage.
//
// Behavior-neutral lift of the original App() functions — same logic, same
// notice copy, same non-memoized identities.

import type { Dispatch, SetStateAction } from 'react'

import type { ParameterBackupFile } from '@arduconfig/ardupilot-core'

import { createTuningProfileId } from '../library-helpers'
import { sortTuningProfiles, type SavedTuningProfile } from '../tuning-profile-library'
import type { TuningProfileSourceMode } from './use-library-forms'
import type { ParameterNotice } from './use-parameter-feedback'

export interface UseTuningProfilesParams {
  canCreateTuningProfile: boolean
  tuningProfileSourceUsesStaged: boolean
  tuningProfileSourceBackup: ParameterBackupFile
  selectedTuningProfile: SavedTuningProfile | undefined
  savedTuningProfiles: SavedTuningProfile[]
  setSavedTuningProfiles: Dispatch<SetStateAction<SavedTuningProfile[]>>
  setSelectedTuningProfileId: Dispatch<SetStateAction<string | undefined>>
  tuningProfileLabelInput: string
  setTuningProfileLabelInput: Dispatch<SetStateAction<string>>
  tuningProfileNoteInput: string
  setTuningProfileNoteInput: Dispatch<SetStateAction<string>>
  tuningProfileProtectedInput: boolean
  setTuningProfileProtectedInput: Dispatch<SetStateAction<boolean>>
  tuningProfileSourceInput: TuningProfileSourceMode
  setTuningProfileSourceInput: Dispatch<SetStateAction<TuningProfileSourceMode>>
  setTuningProfileNotice: Dispatch<SetStateAction<ParameterNotice | undefined>>
}

export interface UseTuningProfilesResult {
  handleCreateTuningProfile: () => void
  handleDeleteSelectedTuningProfile: () => void
  handleToggleSelectedTuningProfileProtection: () => void
}

export function useTuningProfiles({
  canCreateTuningProfile,
  tuningProfileSourceUsesStaged,
  tuningProfileSourceBackup,
  selectedTuningProfile,
  savedTuningProfiles,
  setSavedTuningProfiles,
  setSelectedTuningProfileId,
  tuningProfileLabelInput,
  setTuningProfileLabelInput,
  tuningProfileNoteInput,
  setTuningProfileNoteInput,
  tuningProfileProtectedInput,
  setTuningProfileProtectedInput,
  tuningProfileSourceInput,
  setTuningProfileSourceInput,
  setTuningProfileNotice
}: UseTuningProfilesParams): UseTuningProfilesResult {
  function handleCreateTuningProfile(): void {
    if (!canCreateTuningProfile) {
      setTuningProfileNotice({
        tone: 'warning',
        text:
          tuningProfileSourceUsesStaged
            ? 'Stage at least one tuning change before saving a staged tuning profile.'
            : 'No tuning parameters are currently available to capture into a tuning profile.'
      })
      return
    }

    const profile: SavedTuningProfile = {
      id: createTuningProfileId(),
      label: tuningProfileLabelInput.trim() || `Tuning profile ${savedTuningProfiles.length + 1}`,
      createdAt: new Date().toISOString(),
      note: tuningProfileNoteInput.trim() || undefined,
      tags: [],
      protected: tuningProfileProtectedInput,
      source: tuningProfileSourceInput,
      backup: tuningProfileSourceBackup
    }

    setSavedTuningProfiles((current) => sortTuningProfiles([profile, ...current.filter((entry) => entry.id !== profile.id)]))
    setSelectedTuningProfileId(profile.id)
    setTuningProfileLabelInput('')
    setTuningProfileNoteInput('')
    setTuningProfileProtectedInput(false)
    setTuningProfileSourceInput('staged')
    setTuningProfileNotice({
      tone: 'success',
      text: `Saved tuning profile "${profile.label}" with ${profile.backup.parameterCount} tuning parameter(s).`
    })
  }

  function handleDeleteSelectedTuningProfile(): void {
    if (!selectedTuningProfile) {
      return
    }

    if (selectedTuningProfile.protected) {
      setTuningProfileNotice({
        tone: 'warning',
        text: `Tuning profile "${selectedTuningProfile.label}" is protected. Unprotect it before deleting it from the local library.`
      })
      return
    }

    setSavedTuningProfiles((current) => current.filter((entry) => entry.id !== selectedTuningProfile.id))
    setTuningProfileNotice({
      tone: 'neutral',
      text: `Deleted tuning profile "${selectedTuningProfile.label}" from the local browser library.`
    })
  }

  function handleToggleSelectedTuningProfileProtection(): void {
    if (!selectedTuningProfile) {
      return
    }

    const nextProtected = !selectedTuningProfile.protected
    setSavedTuningProfiles((current) =>
      sortTuningProfiles(
        current.map((entry) =>
          entry.id === selectedTuningProfile.id
            ? {
                ...entry,
                protected: nextProtected
              }
            : entry
        )
      )
    )
    setTuningProfileNotice({
      tone: 'success',
      text: nextProtected
        ? `Tuning profile "${selectedTuningProfile.label}" is now protected against deletion.`
        : `Tuning profile "${selectedTuningProfile.label}" is no longer protected.`
    })
  }

  return {
    handleCreateTuningProfile,
    handleDeleteSelectedTuningProfile,
    handleToggleSelectedTuningProfileProtection
  }
}
