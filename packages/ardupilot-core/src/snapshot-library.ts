import { createParameterBackup, parseParameterBackup, type ParameterBackupFile } from './parameter-backups.js'
import type { ConfiguratorSnapshot } from './types.js'

export type ParameterSnapshotSource = 'captured' | 'imported' | 'library'

export interface ParameterSnapshotRecord {
  id: string
  label: string
  capturedAt: string
  source: ParameterSnapshotSource
  note?: string
  tags: string[]
  protected: boolean
  backup: ParameterBackupFile
}

export interface ParameterSnapshotLibraryFile {
  schemaVersion: 1
  application: 'ArduConfigurator'
  kind: 'parameter-snapshot-library'
  name: string
  updatedAt: string
  snapshots: ParameterSnapshotRecord[]
}

export interface ParameterSnapshotCreateOptions {
  source?: ParameterSnapshotSource
  note?: string
  tags?: readonly string[]
  protected?: boolean
}

export interface ParameterSnapshotSelector {
  id?: string
  label?: string
}

export type ParsedParameterSnapshotInput =
  | {
      kind: 'backup'
      backup: ParameterBackupFile
    }
  | {
      kind: 'library'
      library: ParameterSnapshotLibraryFile
    }

export function createParameterSnapshot(
  backup: ParameterBackupFile,
  label: string | undefined,
  options: ParameterSnapshotCreateOptions = {}
): ParameterSnapshotRecord {
  return {
    id: createSnapshotId(),
    label: normalizeSnapshotLabel(label, backup),
    capturedAt: backup.exportedAt,
    source: options.source ?? 'captured',
    note: normalizeOptionalText(options.note),
    tags: normalizeTags(options.tags),
    protected: options.protected ?? false,
    backup
  }
}

export function createParameterSnapshotFromLiveSnapshot(
  snapshot: ConfiguratorSnapshot,
  label: string | undefined,
  options: ParameterSnapshotCreateOptions = {}
): ParameterSnapshotRecord {
  return createParameterSnapshot(createParameterBackup(snapshot), label, options)
}

export function createParameterSnapshotLibrary(
  name: string,
  snapshots: readonly ParameterSnapshotRecord[] = []
): ParameterSnapshotLibraryFile {
  return {
    schemaVersion: 1,
    application: 'ArduConfigurator',
    kind: 'parameter-snapshot-library',
    name: name.trim() || 'ArduConfigurator Snapshot Library',
    updatedAt: new Date().toISOString(),
    snapshots: sortParameterSnapshots(snapshots)
  }
}

export function sortParameterSnapshots(snapshots: readonly ParameterSnapshotRecord[]): ParameterSnapshotRecord[] {
  return [...snapshots].sort((left, right) => {
    const capturedAtComparison = right.capturedAt.localeCompare(left.capturedAt)
    if (capturedAtComparison !== 0) {
      return capturedAtComparison
    }

    const labelComparison = left.label.localeCompare(right.label)
    if (labelComparison !== 0) {
      return labelComparison
    }

    return left.id.localeCompare(right.id)
  })
}

export function upsertParameterSnapshotInLibrary(
  library: ParameterSnapshotLibraryFile,
  snapshot: ParameterSnapshotRecord
): ParameterSnapshotLibraryFile {
  return {
    ...library,
    updatedAt: new Date().toISOString(),
    snapshots: sortParameterSnapshots([...library.snapshots.filter((entry) => entry.id !== snapshot.id), snapshot])
  }
}

export function selectParameterSnapshotFromLibrary(
  library: ParameterSnapshotLibraryFile,
  selector: ParameterSnapshotSelector = {}
): ParameterSnapshotRecord | undefined {
  if (selector.id) {
    return library.snapshots.find((snapshot) => snapshot.id === selector.id)
  }

  if (selector.label) {
    const normalizedLabel = selector.label.trim().toLowerCase()
    return library.snapshots.find((snapshot) => snapshot.label.trim().toLowerCase() === normalizedLabel)
  }

  return library.snapshots[0]
}

export function serializeParameterSnapshotLibrary(library: ParameterSnapshotLibraryFile): string {
  return JSON.stringify(
    {
      ...library,
      snapshots: sortParameterSnapshots(library.snapshots)
    },
    null,
    2
  )
}

export function parseParameterSnapshotLibrary(input: string): ParameterSnapshotLibraryFile {
  let parsed: unknown
  try {
    parsed = JSON.parse(input)
  } catch (error) {
    throw new Error(`Snapshot library is not valid JSON: ${error instanceof Error ? error.message : 'Unknown parse error.'}`)
  }

  if (!isParameterSnapshotLibraryFile(parsed)) {
    throw new Error('Snapshot library does not match the expected ArduConfigurator snapshot-library schema.')
  }

  return {
    ...parsed,
    name: parsed.name.trim() || 'ArduConfigurator Snapshot Library',
    snapshots: sortParameterSnapshots(parsed.snapshots.map((snapshot) => normalizeSnapshotRecord(snapshot)))
  }
}

export function parseParameterSnapshotInput(input: string): ParsedParameterSnapshotInput {
  try {
    return {
      kind: 'library',
      library: parseParameterSnapshotLibrary(input)
    }
  } catch (libraryError) {
    try {
      return {
        kind: 'backup',
        backup: parseParameterBackup(input)
      }
    } catch (backupError) {
      const libraryMessage = libraryError instanceof Error ? libraryError.message : 'Unknown library parse error.'
      const backupMessage = backupError instanceof Error ? backupError.message : 'Unknown backup parse error.'
      throw new Error(`Input is neither a snapshot library nor a parameter backup. Library error: ${libraryMessage} Backup error: ${backupMessage}`)
    }
  }
}

export function resolveParameterSnapshotInput(
  parsedInput: ParsedParameterSnapshotInput,
  selector: ParameterSnapshotSelector = {}
): ParameterSnapshotRecord {
  if (parsedInput.kind === 'backup') {
    if (selector.id || selector.label) {
      throw new Error('Snapshot selection by id or label only applies to snapshot-library files, not a single backup file.')
    }

    return createParameterSnapshot(parsedInput.backup, undefined, {
      source: 'imported'
    })
  }

  const selectedSnapshot = selectParameterSnapshotFromLibrary(parsedInput.library, selector)
  if (!selectedSnapshot) {
    const selectorDescription = selector.id
      ? `id "${selector.id}"`
      : selector.label
        ? `label "${selector.label}"`
        : 'the latest snapshot'
    throw new Error(`Could not find ${selectorDescription} in snapshot library "${parsedInput.library.name}".`)
  }

  return {
    ...selectedSnapshot,
    source: 'library'
  }
}

function createSnapshotId(): string {
  if (typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID()
  }

  return `snapshot-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`
}

function normalizeSnapshotLabel(label: string | undefined, backup: ParameterBackupFile): string {
  const trimmed = label?.trim()
  if (trimmed) {
    return trimmed
  }

  const vehicle = backup.vehicle?.vehicle ?? backup.firmware
  const dateLabel = backup.exportedAt.replace('T', ' ').replace(/\..+$/, ' UTC')
  return `${vehicle} snapshot ${dateLabel}`
}

function normalizeOptionalText(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function normalizeTags(tags: readonly string[] | undefined): string[] {
  if (!tags || tags.length === 0) {
    return []
  }

  const uniqueTags = new Set<string>()
  tags.forEach((tag) => {
    const trimmed = tag.trim()
    if (trimmed) {
      uniqueTags.add(trimmed)
    }
  })

  return [...uniqueTags]
}

function normalizeSnapshotRecord(snapshot: ParameterSnapshotRecord): ParameterSnapshotRecord {
  return {
    ...snapshot,
    label: snapshot.label.trim() || normalizeSnapshotLabel(undefined, snapshot.backup),
    note: normalizeOptionalText(snapshot.note),
    tags: normalizeTags(snapshot.tags),
    protected: snapshot.protected ?? false
  }
}

function isParameterSnapshotRecord(value: unknown): value is ParameterSnapshotRecord {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const candidate = value as Partial<ParameterSnapshotRecord>
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.label === 'string' &&
    typeof candidate.capturedAt === 'string' &&
    (candidate.source === 'captured' || candidate.source === 'imported' || candidate.source === 'library') &&
    Array.isArray(candidate.tags) &&
    candidate.tags.every((tag) => typeof tag === 'string') &&
    typeof candidate.protected === 'boolean' &&
    typeof candidate.backup === 'object' &&
    candidate.backup !== null &&
    (candidate.backup as Partial<ParameterBackupFile>).application === 'ArduConfigurator' &&
    Array.isArray((candidate.backup as Partial<ParameterBackupFile>).parameters) &&
    (candidate.note === undefined || typeof candidate.note === 'string')
  )
}

function isParameterSnapshotLibraryFile(value: unknown): value is ParameterSnapshotLibraryFile {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const candidate = value as Partial<ParameterSnapshotLibraryFile>
  return (
    candidate.schemaVersion === 1 &&
    candidate.application === 'ArduConfigurator' &&
    candidate.kind === 'parameter-snapshot-library' &&
    typeof candidate.name === 'string' &&
    typeof candidate.updatedAt === 'string' &&
    Array.isArray(candidate.snapshots) &&
    candidate.snapshots.every((snapshot) => isParameterSnapshotRecord(snapshot))
  )
}
