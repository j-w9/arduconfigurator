// Browser-local storage for operator-authored parameter-group presets.
//
// Why a fifth storage key rather than a fifth CONCEPT: this is deliberately not
// a new save/restore mechanism. A user preset is a `PresetDefinition` — the
// same sparse `{paramId, value}[]` shape the curated metadata presets already
// use — plus provenance and the dependency answers. `toPresetDefinition()`
// below hands it straight to `deriveDraftValuesFromParameterPreset` /
// `evaluateParameterPresetApplicability` / the Presets tab's existing apply
// path, so nothing about diffing, reviewing, auto-backup, or writing is new
// code. The other three libraries (snapshots, provisioning profiles, tuning
// profiles) all store a whole-vehicle `ParameterBackupFile`, which is the wrong
// shape entirely for "one tab's worth of params".
//
// Envelope + key convention matches snapshot-library.ts / provisioning-library.ts:
// a versioned, `kind`-discriminated wrapper, and a silent fall back to an empty
// library on anything stale or corrupt (a broken blob must never take out the
// Presets tab).

import type { ParameterPresetValue, PresetDefinition, PresetGroupDefinition } from '@arduconfig/param-metadata'

import type { PresetDependencyRecord } from './view-models/preset-dependencies'

export interface UserPresetRecord {
  /** Always `user:`-prefixed — see USER_PRESET_ID_PREFIX. */
  id: string
  label: string
  description: string
  createdAt: string
  /** Firmware the preset was captured from, e.g. `ArduCopter`. */
  sourceFirmware?: string
  /** Free-text note the operator typed at create time. */
  note?: string
  tags: string[]
  values: ParameterPresetValue[]
  /** The operator's answers to the dependency questions. */
  dependencies: PresetDependencyRecord[]
}

/** What the create dialog hands back — the host adds id/timestamp/provenance. */
export interface UserPresetDraft {
  label: string
  description: string
  values: ParameterPresetValue[]
  dependencies: PresetDependencyRecord[]
}

export interface UserPresetLibraryFile {
  schemaVersion: 1
  application: 'ArduConfigurator'
  kind: 'parameter-user-preset-library'
  name: string
  updatedAt: string
  presets: UserPresetRecord[]
}

export interface UserPresetStorageLoadResult {
  presets: UserPresetRecord[]
  warning?: string
}

export interface UserPresetStoragePersistResult {
  ok: boolean
  warning?: string
}

const USER_PRESET_STORAGE_KEY = 'arduconfig:user-presets'
const USER_PRESET_STORAGE_WARNING =
  'Browser preset storage is unavailable. Presets you create will stay in memory for this session only until browser storage works again.'

/**
 * Namespace for user preset ids. Curated preset ids are plain slugs
 * (`starter-quad-x`), so the prefix guarantees a saved preset can never shadow
 * or be shadowed by one that ships in the metadata bundle — the two live in the
 * same `presetDefinitions` list once merged, and a collision would silently
 * swap one for the other.
 */
export const USER_PRESET_ID_PREFIX = 'user:'

/** The synthetic preset group user presets are filed under in the Presets tab. */
export const USER_PRESET_GROUP: PresetGroupDefinition = {
  id: 'user-presets',
  label: 'Your presets',
  description:
    'Parameter groups you saved from the Parameter Editor. Each records what it depends on, and warns before applying to an aircraft that differs.',
  // Sorted after every curated group: the curated ones are the safe, vetted
  // starting points and should stay at the top of the tab.
  order: 900
}

export function isUserPresetId(presetId: string): boolean {
  return presetId.startsWith(USER_PRESET_ID_PREFIX)
}

export function createUserPresetId(label: string): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  // The random suffix, not the slug, is what makes the id unique — two presets
  // called "6S OSD" must not overwrite each other.
  return `${USER_PRESET_ID_PREFIX}${slug || 'preset'}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/** Newest first, then by label — same ordering rule as the other libraries. */
export function sortUserPresets(presets: readonly UserPresetRecord[]): UserPresetRecord[] {
  return [...presets].sort((left, right) => {
    const leftTime = Date.parse(left.createdAt)
    const rightTime = Date.parse(right.createdAt)
    if (!Number.isNaN(leftTime) && !Number.isNaN(rightTime) && leftTime !== rightTime) {
      return rightTime - leftTime
    }
    return left.label.localeCompare(right.label)
  })
}

/**
 * Present a saved record as a `PresetDefinition` so every existing preset
 * code path — diff, applicability, card rendering, apply — consumes it without
 * knowing it came from localStorage.
 *
 * The dependency answers surface as `cautions`, which the Presets tab already
 * renders in its "Cautions" list; the sharper, comparison-based warnings are
 * added at apply time by `evaluatePresetDependencies` in use-preset-catalog.
 */
export function toPresetDefinition(record: UserPresetRecord, index: number): PresetDefinition {
  return {
    id: record.id,
    label: record.label,
    description: record.description,
    groupId: USER_PRESET_GROUP.id,
    order: index,
    values: record.values,
    note: record.note,
    tags: record.tags,
    // Deliberately no `compatibility` block: that field can BLOCK an apply, and
    // it is meant to carry a human author's assertion. Everything this module
    // knows came from pattern-matching parameter names, which earns a warning,
    // not a veto.
    cautions: []
  }
}

export function loadStoredUserPresets(): UserPresetStorageLoadResult {
  if (typeof window === 'undefined') {
    return { presets: [] }
  }

  let raw: string | null
  try {
    raw = window.localStorage.getItem(USER_PRESET_STORAGE_KEY)
  } catch {
    return { presets: [], warning: USER_PRESET_STORAGE_WARNING }
  }

  if (!raw) {
    return { presets: [] }
  }

  try {
    const parsed = JSON.parse(raw) as Partial<UserPresetLibraryFile>
    if (
      parsed.schemaVersion !== 1 ||
      parsed.application !== 'ArduConfigurator' ||
      parsed.kind !== 'parameter-user-preset-library' ||
      !Array.isArray(parsed.presets)
    ) {
      return { presets: [] }
    }
    return { presets: sortUserPresets(parsed.presets.filter(isUserPresetRecord)) }
  } catch {
    return { presets: [] }
  }
}

export function persistUserPresets(presets: readonly UserPresetRecord[]): UserPresetStoragePersistResult {
  if (typeof window === 'undefined') {
    return { ok: true }
  }

  const library: UserPresetLibraryFile = {
    schemaVersion: 1,
    application: 'ArduConfigurator',
    kind: 'parameter-user-preset-library',
    name: 'Browser Local Preset Library',
    updatedAt: new Date().toISOString(),
    presets: sortUserPresets(presets)
  }

  try {
    window.localStorage.setItem(USER_PRESET_STORAGE_KEY, JSON.stringify(library, null, 2))
    return { ok: true }
  } catch {
    return { ok: false, warning: USER_PRESET_STORAGE_WARNING }
  }
}

function isUserPresetRecord(value: unknown): value is UserPresetRecord {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const candidate = value as Partial<UserPresetRecord>
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.label === 'string' &&
    typeof candidate.createdAt === 'string' &&
    Array.isArray(candidate.tags) &&
    Array.isArray(candidate.dependencies) &&
    Array.isArray(candidate.values) &&
    // A preset with a malformed value list would produce NaN drafts that the
    // draft validator rejects one by one, which reads as a mysterious wall of
    // invalid rows. Reject the record instead.
    candidate.values.every(
      (entry) =>
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as ParameterPresetValue).paramId === 'string' &&
        Number.isFinite((entry as ParameterPresetValue).value)
    )
  )
}
