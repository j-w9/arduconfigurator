import {
  createParameterProvisioningLibrary,
  parseParameterProvisioningLibrary,
  sortParameterProvisioningProfiles,
  type ParameterProvisioningProfileRecord,
} from '@arduconfig/ardupilot-core'

export type SavedProvisioningProfile = ParameterProvisioningProfileRecord

export interface ProvisioningStorageLoadResult {
  profiles: SavedProvisioningProfile[]
  warning?: string
}

export interface ProvisioningStoragePersistResult {
  ok: boolean
  warning?: string
}

const PROVISIONING_LIBRARY_STORAGE_KEY = 'arduconfig:provisioning-library'
const PROVISIONING_STORAGE_WARNING =
  'Browser provisioning-profile storage is unavailable. Provisioning profile changes will stay in memory for this session only until browser storage works again.'

export function loadStoredProvisioningProfiles(): ProvisioningStorageLoadResult {
  if (typeof window === 'undefined') {
    return { profiles: [] }
  }

  let raw: string | null
  try {
    raw = window.localStorage.getItem(PROVISIONING_LIBRARY_STORAGE_KEY)
  } catch {
    return {
      profiles: [],
      warning: PROVISIONING_STORAGE_WARNING
    }
  }

  if (!raw) {
    return { profiles: [] }
  }

  try {
    return {
      profiles: parseParameterProvisioningLibrary(raw).profiles
    }
  } catch {
    return { profiles: [] }
  }
}

export function persistProvisioningProfiles(
  profiles: SavedProvisioningProfile[]
): ProvisioningStoragePersistResult {
  if (typeof window === 'undefined') {
    return { ok: true }
  }

  try {
    const library = createParameterProvisioningLibrary('Browser Local Provisioning Library', profiles)
    window.localStorage.setItem(
      PROVISIONING_LIBRARY_STORAGE_KEY,
      JSON.stringify(
        {
          ...library,
          profiles: sortParameterProvisioningProfiles(library.profiles)
        },
        null,
        2
      )
    )
    return { ok: true }
  } catch {
    return {
      ok: false,
      warning: PROVISIONING_STORAGE_WARNING
    }
  }
}
