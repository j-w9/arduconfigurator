import type { ParameterBackupEntry, ParameterBackupFile } from './parameter-backups.js'

export type ParameterProvisioningProfileSource = 'live' | 'snapshot' | 'imported' | 'library'

export interface ProvisioningChecklistItem {
  id: string
  label: string
  instruction?: string
}

export interface ParameterProvisioningProfileRecord {
  id: string
  label: string
  createdAt: string
  source: ParameterProvisioningProfileSource
  note?: string
  tags: string[]
  protected: boolean
  model?: string
  fleet?: string
  mission?: string
  sourceSnapshotId?: string
  sourceSnapshotLabel?: string
  baseBackup: ParameterBackupFile
  overlayParameters: ParameterBackupEntry[]
  validationChecklist: ProvisioningChecklistItem[]
}

export interface ParameterProvisioningLibraryFile {
  schemaVersion: 1
  application: 'ArduConfigurator'
  kind: 'parameter-provisioning-library'
  name: string
  updatedAt: string
  profiles: ParameterProvisioningProfileRecord[]
}

export interface ParameterProvisioningProfileCreateOptions {
  source?: ParameterProvisioningProfileSource
  note?: string
  tags?: readonly string[]
  protected?: boolean
  model?: string
  fleet?: string
  mission?: string
  sourceSnapshotId?: string
  sourceSnapshotLabel?: string
  overlayParameters?: readonly ParameterBackupEntry[]
  validationChecklist?: readonly (ProvisioningChecklistItem | string)[]
}

export function createParameterProvisioningProfile(
  baseBackup: ParameterBackupFile,
  label: string | undefined,
  options: ParameterProvisioningProfileCreateOptions = {}
): ParameterProvisioningProfileRecord {
  return {
    id: createProvisioningProfileId(),
    label: normalizeProvisioningProfileLabel(label, baseBackup),
    createdAt: new Date().toISOString(),
    source: options.source ?? 'snapshot',
    note: normalizeOptionalText(options.note),
    tags: normalizeTags(options.tags),
    protected: options.protected ?? false,
    model: normalizeOptionalText(options.model),
    fleet: normalizeOptionalText(options.fleet),
    mission: normalizeOptionalText(options.mission),
    sourceSnapshotId: normalizeOptionalText(options.sourceSnapshotId),
    sourceSnapshotLabel: normalizeOptionalText(options.sourceSnapshotLabel),
    baseBackup: normalizeBackup(baseBackup),
    overlayParameters: normalizeOverlayParameters(options.overlayParameters),
    validationChecklist: normalizeChecklist(options.validationChecklist)
  }
}

export function createParameterProvisioningLibrary(
  name: string,
  profiles: readonly ParameterProvisioningProfileRecord[] = []
): ParameterProvisioningLibraryFile {
  return {
    schemaVersion: 1,
    application: 'ArduConfigurator',
    kind: 'parameter-provisioning-library',
    name: name.trim() || 'ArduConfigurator Provisioning Library',
    updatedAt: new Date().toISOString(),
    profiles: sortParameterProvisioningProfiles(profiles)
  }
}

export function sortParameterProvisioningProfiles(
  profiles: readonly ParameterProvisioningProfileRecord[]
): ParameterProvisioningProfileRecord[] {
  return [...profiles].sort((left, right) => {
    const createdAtComparison = right.createdAt.localeCompare(left.createdAt)
    if (createdAtComparison !== 0) {
      return createdAtComparison
    }

    const labelComparison = left.label.localeCompare(right.label)
    if (labelComparison !== 0) {
      return labelComparison
    }

    return left.id.localeCompare(right.id)
  })
}

export function selectParameterProvisioningProfileFromLibrary(
  library: ParameterProvisioningLibraryFile,
  selector: { id?: string; label?: string } = {}
): ParameterProvisioningProfileRecord | undefined {
  if (selector.id) {
    return library.profiles.find((profile) => profile.id === selector.id)
  }

  if (selector.label) {
    const normalizedLabel = selector.label.trim().toLowerCase()
    return library.profiles.find((profile) => profile.label.trim().toLowerCase() === normalizedLabel)
  }

  return library.profiles[0]
}

export function serializeParameterProvisioningLibrary(library: ParameterProvisioningLibraryFile): string {
  return JSON.stringify(
    {
      ...library,
      profiles: sortParameterProvisioningProfiles(library.profiles)
    },
    null,
    2
  )
}

export function parseParameterProvisioningLibrary(input: string): ParameterProvisioningLibraryFile {
  let parsed: unknown
  try {
    parsed = JSON.parse(input)
  } catch (error) {
    throw new Error(
      `Provisioning library is not valid JSON: ${error instanceof Error ? error.message : 'Unknown parse error.'}`
    )
  }

  if (!isParameterProvisioningLibraryFile(parsed)) {
    throw new Error('Provisioning library does not match the expected ArduConfigurator provisioning-library schema.')
  }

  return {
    ...parsed,
    name: parsed.name.trim() || 'ArduConfigurator Provisioning Library',
    profiles: sortParameterProvisioningProfiles(parsed.profiles.map((profile) => normalizeProvisioningProfileRecord(profile)))
  }
}

export function deriveProvisioningProfileBackup(
  profile: ParameterProvisioningProfileRecord
): ParameterBackupFile {
  const mergedById = new Map(profile.baseBackup.parameters.map((parameter) => [parameter.id, { ...parameter }]))

  profile.overlayParameters.forEach((parameter) => {
    mergedById.set(parameter.id, { ...parameter })
  })

  const parameters = [...mergedById.values()].sort((left, right) => left.id.localeCompare(right.id))
  return {
    ...profile.baseBackup,
    exportedAt: profile.createdAt,
    parameterCount: parameters.length,
    parameters
  }
}

function createProvisioningProfileId(): string {
  if (typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID()
  }

  return `profile-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`
}

function normalizeProvisioningProfileLabel(label: string | undefined, baseBackup: ParameterBackupFile): string {
  const trimmed = label?.trim()
  if (trimmed) {
    return trimmed
  }

  const vehicle = baseBackup.vehicle?.vehicle ?? baseBackup.firmware
  const dateLabel = baseBackup.exportedAt.replace('T', ' ').replace(/\..+$/, ' UTC')
  return `${vehicle} provisioning ${dateLabel}`
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

function normalizeOverlayParameters(parameters: readonly ParameterBackupEntry[] | undefined): ParameterBackupEntry[] {
  if (!parameters || parameters.length === 0) {
    return []
  }

  const uniqueById = new Map<string, ParameterBackupEntry>()
  parameters.forEach((parameter) => {
    if (!parameter?.id || !Number.isFinite(parameter.value)) {
      return
    }

    uniqueById.set(parameter.id, {
      id: parameter.id,
      value: parameter.value,
      category: normalizeOptionalText(parameter.category),
      label: normalizeOptionalText(parameter.label),
      unit: normalizeOptionalText(parameter.unit)
    })
  })

  return [...uniqueById.values()].sort((left, right) => left.id.localeCompare(right.id))
}

function normalizeChecklist(
  checklist: readonly (ProvisioningChecklistItem | string)[] | undefined
): ProvisioningChecklistItem[] {
  if (!checklist || checklist.length === 0) {
    return []
  }

  return checklist
    .map((item, index) => {
      if (typeof item === 'string') {
        const label = item.trim()
        if (!label) {
          return undefined
        }

        return {
          id: `check-${index + 1}`,
          label
        }
      }

      const label = item.label?.trim()
      if (!label) {
        return undefined
      }

      return {
        id: item.id?.trim() || `check-${index + 1}`,
        label,
        instruction: normalizeOptionalText(item.instruction)
      }
    })
    .filter((item): item is ProvisioningChecklistItem => item !== undefined)
}

function normalizeBackup(backup: ParameterBackupFile): ParameterBackupFile {
  return {
    ...backup,
    parameters: [...backup.parameters].sort((left, right) => left.id.localeCompare(right.id))
  }
}

function normalizeProvisioningProfileRecord(
  profile: ParameterProvisioningProfileRecord
): ParameterProvisioningProfileRecord {
  return {
    ...profile,
    label: profile.label.trim() || normalizeProvisioningProfileLabel(undefined, profile.baseBackup),
    note: normalizeOptionalText(profile.note),
    tags: normalizeTags(profile.tags),
    protected: profile.protected ?? false,
    model: normalizeOptionalText(profile.model),
    fleet: normalizeOptionalText(profile.fleet),
    mission: normalizeOptionalText(profile.mission),
    sourceSnapshotId: normalizeOptionalText(profile.sourceSnapshotId),
    sourceSnapshotLabel: normalizeOptionalText(profile.sourceSnapshotLabel),
    baseBackup: normalizeBackup(profile.baseBackup),
    overlayParameters: normalizeOverlayParameters(profile.overlayParameters),
    validationChecklist: normalizeChecklist(profile.validationChecklist)
  }
}

function isParameterBackupEntry(value: unknown): value is ParameterBackupEntry {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Partial<ParameterBackupEntry>).id === 'string' &&
    typeof (value as Partial<ParameterBackupEntry>).value === 'number'
  )
}

function isProvisioningChecklistItem(value: unknown): value is ProvisioningChecklistItem {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Partial<ProvisioningChecklistItem>).id === 'string' &&
    typeof (value as Partial<ProvisioningChecklistItem>).label === 'string' &&
    ((value as Partial<ProvisioningChecklistItem>).instruction === undefined ||
      typeof (value as Partial<ProvisioningChecklistItem>).instruction === 'string')
  )
}

function isParameterProvisioningProfileRecord(value: unknown): value is ParameterProvisioningProfileRecord {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const candidate = value as Partial<ParameterProvisioningProfileRecord>
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.label === 'string' &&
    typeof candidate.createdAt === 'string' &&
    (candidate.source === 'live' ||
      candidate.source === 'snapshot' ||
      candidate.source === 'imported' ||
      candidate.source === 'library') &&
    candidate.baseBackup !== undefined &&
    typeof candidate.baseBackup === 'object' &&
    candidate.baseBackup !== null &&
    (candidate.baseBackup as Partial<ParameterBackupFile>).application === 'ArduConfigurator' &&
    Array.isArray((candidate.baseBackup as Partial<ParameterBackupFile>).parameters) &&
    Array.isArray(candidate.overlayParameters) &&
    candidate.overlayParameters.every((parameter) => isParameterBackupEntry(parameter)) &&
    Array.isArray(candidate.validationChecklist) &&
    candidate.validationChecklist.every((item) => isProvisioningChecklistItem(item))
  )
}

function isParameterProvisioningLibraryFile(value: unknown): value is ParameterProvisioningLibraryFile {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const candidate = value as Partial<ParameterProvisioningLibraryFile>
  return (
    candidate.schemaVersion === 1 &&
    candidate.application === 'ArduConfigurator' &&
    candidate.kind === 'parameter-provisioning-library' &&
    typeof candidate.name === 'string' &&
    typeof candidate.updatedAt === 'string' &&
    Array.isArray(candidate.profiles) &&
    candidate.profiles.every((profile) => isParameterProvisioningProfileRecord(profile))
  )
}
