import type { ParameterBackupFile } from '@arduconfig/ardupilot-core'

export interface SavedTuningProfile {
  id: string
  label: string
  createdAt: string
  note?: string
  tags: string[]
  protected: boolean
  source: 'live' | 'staged'
  backup: ParameterBackupFile
}

export interface TuningProfileStorageLoadResult {
  profiles: SavedTuningProfile[]
  warning?: string
}

export interface TuningProfileStoragePersistResult {
  ok: boolean
  warning?: string
}

const TUNING_PROFILE_STORAGE_KEY = 'arduconfig:tuning-profiles'
const TUNING_PROFILE_STORAGE_WARNING =
  'Browser tuning-profile storage is unavailable. Tuning profiles will stay in memory for this session only until browser storage works again.'

export function sortTuningProfiles(profiles: readonly SavedTuningProfile[]): SavedTuningProfile[] {
  return [...profiles].sort((left, right) => {
    const leftTime = Date.parse(left.createdAt)
    const rightTime = Date.parse(right.createdAt)
    if (!Number.isNaN(leftTime) && !Number.isNaN(rightTime) && leftTime !== rightTime) {
      return rightTime - leftTime
    }

    return left.label.localeCompare(right.label)
  })
}

export function loadStoredTuningProfiles(): TuningProfileStorageLoadResult {
  if (typeof window === 'undefined') {
    return { profiles: [] }
  }

  let raw: string | null
  try {
    raw = window.localStorage.getItem(TUNING_PROFILE_STORAGE_KEY)
  } catch {
    return {
      profiles: [],
      warning: TUNING_PROFILE_STORAGE_WARNING
    }
  }

  if (!raw) {
    return { profiles: [] }
  }

  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) {
      return { profiles: [] }
    }

    return {
      profiles: sortTuningProfiles(parsed.filter(isSavedTuningProfile))
    }
  } catch {
    return { profiles: [] }
  }
}

export function persistTuningProfiles(
  profiles: SavedTuningProfile[]
): TuningProfileStoragePersistResult {
  if (typeof window === 'undefined') {
    return { ok: true }
  }

  try {
    window.localStorage.setItem(TUNING_PROFILE_STORAGE_KEY, JSON.stringify(sortTuningProfiles(profiles), null, 2))
    return { ok: true }
  } catch {
    return {
      ok: false,
      warning: TUNING_PROFILE_STORAGE_WARNING
    }
  }
}

function isSavedTuningProfile(value: unknown): value is SavedTuningProfile {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const candidate = value as Partial<SavedTuningProfile>
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.label === 'string' &&
    typeof candidate.createdAt === 'string' &&
    (candidate.source === 'live' || candidate.source === 'staged') &&
    typeof candidate.protected === 'boolean' &&
    Array.isArray(candidate.tags) &&
    typeof candidate.backup === 'object' &&
    candidate.backup !== null &&
    (candidate.backup as Partial<ParameterBackupFile>).application === 'ArduConfigurator' &&
    Array.isArray((candidate.backup as Partial<ParameterBackupFile>).parameters)
  )
}
