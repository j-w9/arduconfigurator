import {
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction
} from 'react'

import {
  loadStoredProvisioningProfiles,
  persistProvisioningProfiles,
  type ProvisioningStorageLoadResult,
  type SavedProvisioningProfile
} from '../provisioning-library'
import {
  loadStoredSnapshots,
  persistSnapshots,
  type SavedParameterSnapshot,
  type SnapshotStorageLoadResult
} from '../snapshot-library'
import {
  loadStoredTuningProfiles,
  persistTuningProfiles,
  type SavedTuningProfile,
  type TuningProfileStorageLoadResult
} from '../tuning-profile-library'

/**
 * A storage-warning banner. Structurally compatible with App's
 * `ParameterNotice` (its `tone` is always the 'warning' member of
 * `StatusTone`), so callers can render it through the same notice slot
 * without a shared-type dependency.
 */
export type LibraryStorageNotice = { tone: 'warning'; text: string } | undefined

function warningNotice(warning: string | undefined): LibraryStorageNotice {
  return warning ? { tone: 'warning', text: warning } : undefined
}

export interface Libraries {
  savedSnapshots: SavedParameterSnapshot[]
  setSavedSnapshots: Dispatch<SetStateAction<SavedParameterSnapshot[]>>
  selectedSnapshotId: string | undefined
  setSelectedSnapshotId: Dispatch<SetStateAction<string | undefined>>
  snapshotStorageNotice: LibraryStorageNotice

  savedProvisioningProfiles: SavedProvisioningProfile[]
  setSavedProvisioningProfiles: Dispatch<SetStateAction<SavedProvisioningProfile[]>>
  selectedProvisioningProfileId: string | undefined
  setSelectedProvisioningProfileId: Dispatch<SetStateAction<string | undefined>>
  provisioningStorageNotice: LibraryStorageNotice

  savedTuningProfiles: SavedTuningProfile[]
  setSavedTuningProfiles: Dispatch<SetStateAction<SavedTuningProfile[]>>
  selectedTuningProfileId: string | undefined
  setSelectedTuningProfileId: Dispatch<SetStateAction<string | undefined>>
  tuningProfileStorageNotice: LibraryStorageNotice
}

/**
 * Owns the three browser-persisted libraries (snapshots, provisioning
 * profiles, tuning profiles): their saved lists, current selection ids,
 * the one-time load from localStorage, and the write-back effects.
 *
 * Extracted verbatim from App.tsx. The storage notices are fully internal
 * — they were only ever seeded from the initial load `.warning` and
 * refreshed by the persist effects, with no dismiss handler — so they are
 * returned read-only for the banners. Every saved/selected setter is
 * exposed because the snapshot / provisioning / tuning handlers in App
 * mutate the lists; those handlers stay in App and are unchanged.
 */
export function useLibraries(): Libraries {
  const initialSnapshotStorage = useMemo<SnapshotStorageLoadResult>(() => loadStoredSnapshots(), [])
  const initialProvisioningStorage = useMemo<ProvisioningStorageLoadResult>(
    () => loadStoredProvisioningProfiles(),
    []
  )
  const initialTuningProfileStorage = useMemo<TuningProfileStorageLoadResult>(
    () => loadStoredTuningProfiles(),
    []
  )

  const [savedSnapshots, setSavedSnapshots] = useState<SavedParameterSnapshot[]>(
    initialSnapshotStorage.snapshots
  )
  const [selectedSnapshotId, setSelectedSnapshotId] = useState<string>()
  const [snapshotStorageNotice, setSnapshotStorageNotice] = useState<LibraryStorageNotice>(() =>
    warningNotice(initialSnapshotStorage.warning)
  )

  const [savedProvisioningProfiles, setSavedProvisioningProfiles] = useState<SavedProvisioningProfile[]>(
    initialProvisioningStorage.profiles
  )
  const [selectedProvisioningProfileId, setSelectedProvisioningProfileId] = useState<string>()
  const [provisioningStorageNotice, setProvisioningStorageNotice] = useState<LibraryStorageNotice>(() =>
    warningNotice(initialProvisioningStorage.warning)
  )

  const [savedTuningProfiles, setSavedTuningProfiles] = useState<SavedTuningProfile[]>(
    initialTuningProfileStorage.profiles
  )
  const [selectedTuningProfileId, setSelectedTuningProfileId] = useState<string>()
  const [tuningProfileStorageNotice, setTuningProfileStorageNotice] = useState<LibraryStorageNotice>(() =>
    warningNotice(initialTuningProfileStorage.warning)
  )

  useEffect(() => {
    const persistence = persistSnapshots(savedSnapshots)
    setSnapshotStorageNotice(warningNotice(persistence.warning))
  }, [savedSnapshots])

  useEffect(() => {
    const persistence = persistProvisioningProfiles(savedProvisioningProfiles)
    setProvisioningStorageNotice(warningNotice(persistence.warning))
  }, [savedProvisioningProfiles])

  useEffect(() => {
    const persistence = persistTuningProfiles(savedTuningProfiles)
    setTuningProfileStorageNotice(warningNotice(persistence.warning))
  }, [savedTuningProfiles])

  return {
    savedSnapshots,
    setSavedSnapshots,
    selectedSnapshotId,
    setSelectedSnapshotId,
    snapshotStorageNotice,
    savedProvisioningProfiles,
    setSavedProvisioningProfiles,
    selectedProvisioningProfileId,
    setSelectedProvisioningProfileId,
    provisioningStorageNotice,
    savedTuningProfiles,
    setSavedTuningProfiles,
    selectedTuningProfileId,
    setSelectedTuningProfileId,
    tuningProfileStorageNotice
  }
}
