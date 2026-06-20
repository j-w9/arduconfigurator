// Library / snapshot / provisioning / file helpers, extracted from App.tsx as
// part of its decomposition. Pure helpers for filenames, timestamp/byte/tag
// formatting + parsing, and immutable merge/update of the saved snapshot &
// provisioning-profile libraries. No React, no app state.

import { sortParameterProvisioningProfiles, sortParameterSnapshots } from '@arduconfig/ardupilot-core'
import type { ConfiguratorSnapshot, ParameterBackupEntry, ParameterDraftEntry } from '@arduconfig/ardupilot-core'
import type { NormalizedPresetDefinition } from '@arduconfig/param-metadata'

import { TUNING_ROLL_PITCH_LINK_MAP } from './tuning-params'
import type { SavedParameterSnapshot } from './snapshot-library'
import type { SavedProvisioningProfile } from './provisioning-library'

export function createTuningProfileId(): string {
  return `tuning-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function sortTuningBackupEntries(entries: readonly ParameterBackupEntry[]): ParameterBackupEntry[] {
  return [...entries].sort((left, right) => left.id.localeCompare(right.id))
}

export function linkedTuningCounterpartId(paramId: string): string | undefined {
  const directMatch = TUNING_ROLL_PITCH_LINK_MAP[paramId as keyof typeof TUNING_ROLL_PITCH_LINK_MAP]
  if (directMatch) {
    return directMatch
  }

  const reverseMatch = Object.entries(TUNING_ROLL_PITCH_LINK_MAP).find(([, value]) => value === paramId)
  return reverseMatch?.[0]
}

export function buildParameterBackupFilename(
  snapshot: ConfiguratorSnapshot,
  format: 'json' | 'parm' | 'params' = 'json'
): string {
  const vehicleLabel = snapshot.vehicle?.vehicle?.toLowerCase() ?? 'vehicle'
  const dateLabel = new Date().toISOString().replace(/[:]/g, '-').replace(/\..+$/, '')
  return `arduconfig-${vehicleLabel}-params-${dateLabel}.${format}`
}

export function buildSnapshotFilename(savedSnapshot: SavedParameterSnapshot): string {
  const label = savedSnapshot.label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  const dateLabel = savedSnapshot.capturedAt.replace(/[:]/g, '-').replace(/\..+$/, '')
  return `arduconfig-${label || 'snapshot'}-${dateLabel}.json`
}

export function formatSnapshotTimestamp(timestamp: string): string {
  const date = new Date(timestamp)
  return Number.isNaN(date.getTime()) ? timestamp : date.toLocaleString()
}

export function buildSnapshotLibraryFilename(): string {
  const dateLabel = new Date().toISOString().replace(/[:]/g, '-').replace(/\..+$/, '')
  return `arduconfig-snapshot-library-${dateLabel}.json`
}

export function buildProvisioningLibraryFilename(): string {
  const dateLabel = new Date().toISOString().replace(/[:]/g, '-').replace(/\..+$/, '')
  return `arduconfig-provisioning-library-${dateLabel}.json`
}

export function buildProvisioningProfileFilename(profile: SavedProvisioningProfile): string {
  const label = profile.label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  const dateLabel = profile.createdAt.replace(/[:]/g, '-').replace(/\..+$/, '')
  return `arduconfig-${label || 'provisioning-profile'}-${dateLabel}.json`
}

export function buildPresetAutoBackupLabel(snapshot: ConfiguratorSnapshot, preset: NormalizedPresetDefinition): string {
  const vehicleLabel = snapshot.vehicle?.vehicle ?? 'Vehicle'
  return `${vehicleLabel} pre-preset ${preset.label}`
}

export function buildPresetAutoBackupNote(preset: NormalizedPresetDefinition): string {
  return `Automatically captured before applying preset "${preset.label}".`
}

export function parseSnapshotTags(rawValue: string): string[] {
  return rawValue
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0)
}

export function parseProvisioningChecklist(rawValue: string): string[] {
  return rawValue
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

export function deriveProvisioningOverlayParametersFromDrafts(
  draftEntries: readonly ParameterDraftEntry[]
): ParameterBackupEntry[] {
  return draftEntries
    .filter((entry): entry is ParameterDraftEntry & { nextValue: number } => entry.status === 'staged' && entry.nextValue !== undefined)
    .map((entry) => ({
      id: entry.id,
      value: entry.nextValue,
      category: entry.definition?.category,
      label: entry.definition?.label,
      unit: entry.definition?.unit
    }))
    .sort((left, right) => left.id.localeCompare(right.id))
}

export function mergeSavedSnapshots(
  existingSnapshots: readonly SavedParameterSnapshot[],
  incomingSnapshots: readonly SavedParameterSnapshot[]
): SavedParameterSnapshot[] {
  const mergedById = new Map(existingSnapshots.map((savedSnapshot) => [savedSnapshot.id, savedSnapshot]))
  incomingSnapshots.forEach((savedSnapshot) => {
    mergedById.set(savedSnapshot.id, savedSnapshot)
  })
  return sortParameterSnapshots([...mergedById.values()])
}

export function updateSavedSnapshot(
  snapshots: readonly SavedParameterSnapshot[],
  snapshotId: string,
  transform: (snapshot: SavedParameterSnapshot) => SavedParameterSnapshot
): SavedParameterSnapshot[] {
  return sortParameterSnapshots(
    snapshots.map((savedSnapshot) => (savedSnapshot.id === snapshotId ? transform(savedSnapshot) : savedSnapshot))
  )
}

export function mergeSavedProvisioningProfiles(
  existingProfiles: readonly SavedProvisioningProfile[],
  incomingProfiles: readonly SavedProvisioningProfile[]
): SavedProvisioningProfile[] {
  const mergedById = new Map(existingProfiles.map((profile) => [profile.id, profile]))
  incomingProfiles.forEach((profile) => {
    mergedById.set(profile.id, profile)
  })
  return sortParameterProvisioningProfiles([...mergedById.values()])
}

export function updateSavedProvisioningProfile(
  profiles: readonly SavedProvisioningProfile[],
  profileId: string,
  transform: (profile: SavedProvisioningProfile) => SavedProvisioningProfile
): SavedProvisioningProfile[] {
  return sortParameterProvisioningProfiles(
    profiles.map((profile) => (profile.id === profileId ? transform(profile) : profile))
  )
}

export function formatByteCount(bytes: number | undefined): string {
  if (bytes === undefined || !Number.isFinite(bytes)) {
    return 'Unknown size'
  }
  if (bytes < 1024) {
    return `${bytes} B`
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1).replace(/\.0$/, '')} KB`
  }
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, '')} MB`
}
