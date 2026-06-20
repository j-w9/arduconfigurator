import {
  createParameterSnapshot,
  createParameterSnapshotLibrary,
  type ParameterSnapshotCreateOptions,
  parseParameterSnapshotLibrary,
  serializeParameterSnapshotLibrary,
  sortParameterSnapshots,
  type ParameterBackupFile,
  type ParameterSnapshotRecord,
} from '@arduconfig/ardupilot-core'

export type SavedSnapshotSource = ParameterSnapshotRecord['source']
export type SavedParameterSnapshot = ParameterSnapshotRecord

export interface SnapshotStorageLoadResult {
  snapshots: SavedParameterSnapshot[]
  warning?: string
}

export interface SnapshotStoragePersistResult {
  ok: boolean
  warning?: string
}

interface LegacySavedParameterSnapshot {
  id: string
  label: string
  capturedAt: string
  source: 'captured' | 'imported'
  backup: ParameterBackupFile
}

interface LegacySavedSnapshotLibraryFile {
  schemaVersion: 1
  application: 'ArduConfigurator'
  snapshots: LegacySavedParameterSnapshot[]
}

const SNAPSHOT_LIBRARY_STORAGE_KEY = 'arduconfig:snapshot-library'
const SNAPSHOT_STORAGE_WARNING =
  'Browser snapshot storage is unavailable. Snapshot changes will stay in memory for this session only until browser storage works again.'

export function loadStoredSnapshots(): SnapshotStorageLoadResult {
  if (typeof window === 'undefined') {
    return { snapshots: [] }
  }

  let raw: string | null
  try {
    raw = window.localStorage.getItem(SNAPSHOT_LIBRARY_STORAGE_KEY)
  } catch {
    return {
      snapshots: [],
      warning: SNAPSHOT_STORAGE_WARNING
    }
  }

  if (!raw) {
    return { snapshots: [] }
  }

  try {
    return {
      snapshots: parseParameterSnapshotLibrary(raw).snapshots
    }
  } catch {
    return {
      snapshots: loadLegacyStoredSnapshots(raw)
    }
  }
}

export function persistSnapshots(snapshots: SavedParameterSnapshot[]): SnapshotStoragePersistResult {
  if (typeof window === 'undefined') {
    return { ok: true }
  }

  try {
    const library = createParameterSnapshotLibrary('Browser Local Snapshot Library', snapshots)
    window.localStorage.setItem(SNAPSHOT_LIBRARY_STORAGE_KEY, serializeParameterSnapshotLibrary(library))
    return { ok: true }
  } catch {
    return {
      ok: false,
      warning: SNAPSHOT_STORAGE_WARNING
    }
  }
}

export function createSavedSnapshot(
  backup: ParameterBackupFile,
  label: string | undefined,
  source: SavedSnapshotSource,
  options: Omit<ParameterSnapshotCreateOptions, 'source'> = {}
): SavedParameterSnapshot {
  return createParameterSnapshot(backup, label, {
    ...options,
    source
  })
}

function loadLegacyStoredSnapshots(raw: string): SavedParameterSnapshot[] {
  try {
    const parsed = JSON.parse(raw) as Partial<LegacySavedSnapshotLibraryFile>
    if (parsed.schemaVersion !== 1 || parsed.application !== 'ArduConfigurator' || !Array.isArray(parsed.snapshots)) {
      return []
    }

    return sortParameterSnapshots(
      parsed.snapshots
        .filter(isLegacySavedParameterSnapshot)
        .map((snapshot) => ({
          id: snapshot.id,
          label: snapshot.label,
          capturedAt: snapshot.capturedAt,
          source: snapshot.source,
          note: undefined,
          tags: [],
          protected: false,
          backup: snapshot.backup
        }))
    )
  } catch {
    return []
  }
}

function isLegacySavedParameterSnapshot(value: unknown): value is LegacySavedParameterSnapshot {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const candidate = value as Partial<LegacySavedParameterSnapshot>
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.label === 'string' &&
    typeof candidate.capturedAt === 'string' &&
    (candidate.source === 'captured' || candidate.source === 'imported') &&
    typeof candidate.backup === 'object' &&
    candidate.backup !== null &&
    (candidate.backup as Partial<ParameterBackupFile>).application === 'ArduConfigurator' &&
    Array.isArray((candidate.backup as Partial<ParameterBackupFile>).parameters)
  )
}
