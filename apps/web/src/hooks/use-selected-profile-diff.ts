// Generic "selected profile → diff against snapshot" helper, factored
// out of App.tsx. The Snapshots/Provisioning/Tuning library tabs each
// repeated the SAME chain of useMemos: pick the selected entity from
// its saved-list (or fall back to entry 0), resolve it into a backup,
// resolve the backup into draft values against the live snapshot, then
// run that through `selectEntityDiff` to get the entries/groups/changed/
// invalid/signature bag.
//
// All three picker call sites (snapshot, provisioning, tuning) are
// byte-identical except for the backup-extraction step — snapshots
// expose `.backup` directly, tuning profiles too, while provisioning
// profiles need `deriveProvisioningProfileBackup` first. The hook takes
// a `resolveBackup` callback to handle that variation.

import { useMemo } from 'react'

import {
  type ParameterBackupFile,
  type ParameterBackupImportResult,
  type ParameterState,
  deriveDraftValuesFromParameterBackup
} from '@arduconfig/ardupilot-core'

import { type EntityDiff, selectEntityDiff } from '../selectors/entity-diff'

export interface UseSelectedProfileDiffResult<TProfile> {
  selectedProfile: TProfile | undefined
  selectedBackup: ParameterBackupFile | undefined
  restore: ParameterBackupImportResult | undefined
  diff: EntityDiff
}

/**
 * Picks the selected profile from a saved-list (id match, or entry 0 as
 * fallback), resolves it into a backup via the caller-supplied
 * extractor, derives draft values against the live snapshot, and runs
 * the diff. Output values are byte-identical to the App.tsx originals.
 *
 * `resolveBackup` must be a stable function reference (module-level or
 * useCallback) — it is a dependency of the backup memo, so a fresh
 * arrow on each render would defeat memoization.
 */
export function useSelectedProfileDiff<TProfile extends { id: string }>(input: {
  snapshotParameters: ParameterState[]
  savedProfiles: readonly TProfile[]
  selectedProfileId: string | undefined
  resolveBackup: (profile: TProfile) => ParameterBackupFile
}): UseSelectedProfileDiffResult<TProfile> {
  const { snapshotParameters, savedProfiles, selectedProfileId, resolveBackup } = input

  const selectedProfile = useMemo<TProfile | undefined>(
    () => savedProfiles.find((profile) => profile.id === selectedProfileId) ?? savedProfiles[0],
    [savedProfiles, selectedProfileId]
  )
  const selectedBackup = useMemo<ParameterBackupFile | undefined>(
    () => (selectedProfile ? resolveBackup(selectedProfile) : undefined),
    [resolveBackup, selectedProfile]
  )
  const restore = useMemo<ParameterBackupImportResult | undefined>(
    () => (selectedBackup ? deriveDraftValuesFromParameterBackup(snapshotParameters, selectedBackup) : undefined),
    [selectedBackup, snapshotParameters]
  )
  const diff = useMemo<EntityDiff>(
    () => selectEntityDiff(snapshotParameters, restore?.draftValues),
    [restore, snapshotParameters]
  )

  return { selectedProfile, selectedBackup, restore, diff }
}
