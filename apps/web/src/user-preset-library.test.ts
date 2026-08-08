import { describe, expect, it } from 'vitest'

import {
  buildUserPresetExportFilename,
  mergeImportedUserPresets,
  parseUserPresetImport,
  serializeUserPresetExport,
  USER_PRESET_ID_PREFIX,
  type UserPresetRecord
} from './user-preset-library'

function preset(overrides: Partial<UserPresetRecord> = {}): UserPresetRecord {
  return {
    id: 'user:six-s-osd-abc123',
    label: '6S OSD',
    description: 'OSD layout for a 6S build',
    createdAt: '2026-08-01T10:00:00.000Z',
    sourceFirmware: 'ArduCopter',
    tags: ['osd'],
    values: [
      { paramId: 'OSD1_BATVOLT_EN', value: 1 },
      { paramId: 'OSD1_BATVOLT_X', value: 24 }
    ],
    dependencies: [],
    ...overrides
  }
}

describe('preset sharing', () => {
  it('round-trips an export back through the importer', () => {
    // The exported file is the storage envelope; if these two ever diverge,
    // a preset someone was sent stops loading.
    const original = preset()
    const result = parseUserPresetImport(serializeUserPresetExport([original], 'My presets'))
    expect(result.presets).toEqual([original])
    expect(result.skipped).toEqual([])
  })

  it('names the file after a single preset so the recipient knows what it is', () => {
    expect(buildUserPresetExportFilename(preset())).toMatch(/^arduconfigurator-preset-6s-osd-\d{4}-\d{2}-\d{2}\.json$/)
    expect(buildUserPresetExportFilename()).toMatch(/^arduconfigurator-presets-\d{4}-\d{2}-\d{2}\.json$/)
  })

  it('tells the operator which ArduConfigurator file they actually picked', () => {
    // The three library files look alike at a glance. "Invalid file" would
    // leave them guessing which of them they grabbed.
    const snapshotLibrary = JSON.stringify({
      schemaVersion: 1,
      application: 'ArduConfigurator',
      kind: 'parameter-snapshot-library',
      snapshots: []
    })
    expect(() => parseUserPresetImport(snapshotLibrary)).toThrow(/snapshot library/i)
  })

  it('rejects a future schema instead of half-reading it', () => {
    const future = JSON.stringify({
      schemaVersion: 2,
      application: 'ArduConfigurator',
      kind: 'parameter-user-preset-library',
      presets: []
    })
    expect(() => parseUserPresetImport(future)).toThrow(/schema 2/)
  })

  it('rejects non-JSON with an explanation rather than a parse error', () => {
    expect(() => parseUserPresetImport('not json at all')).toThrow(/not valid JSON/i)
  })

  it('skips a malformed preset but keeps the good ones', () => {
    const mixed = JSON.stringify({
      schemaVersion: 1,
      application: 'ArduConfigurator',
      kind: 'parameter-user-preset-library',
      presets: [
        preset(),
        // A NaN value would otherwise become a wall of individually-rejected
        // invalid draft rows with no explanation.
        { ...preset({ id: 'user:broken', label: 'Broken' }), values: [{ paramId: 'X', value: 'nope' }] }
      ]
    })
    const result = parseUserPresetImport(mixed)
    expect(result.presets).toHaveLength(1)
    expect(result.skipped).toEqual([{ label: 'Broken', reason: expect.stringContaining('non-numeric') }])
  })

  it('throws when every preset in the file is malformed', () => {
    const allBad = JSON.stringify({
      schemaVersion: 1,
      application: 'ArduConfigurator',
      kind: 'parameter-user-preset-library',
      presets: [{ label: 'Broken' }]
    })
    expect(() => parseUserPresetImport(allBad)).toThrow(/malformed/i)
  })

  it('forces an imported id into the user namespace', () => {
    // A record whose id lacks the prefix would land in the same list as the
    // curated presets and could shadow one that ships in the bundle.
    const sneaky = JSON.stringify({
      schemaVersion: 1,
      application: 'ArduConfigurator',
      kind: 'parameter-user-preset-library',
      presets: [preset({ id: 'starter-quad-x' })]
    })
    const [imported] = parseUserPresetImport(sneaky).presets
    expect(imported.id.startsWith(USER_PRESET_ID_PREFIX)).toBe(true)
    expect(imported.id).not.toBe('starter-quad-x')
  })
})

describe('mergeImportedUserPresets', () => {
  it('adds presets the operator does not have', () => {
    const result = mergeImportedUserPresets([], [preset()])
    expect(result).toMatchObject({ added: 1, unchanged: 0, renamed: 0 })
    expect(result.presets).toHaveLength(1)
  })

  it('is a no-op when the same file is imported twice', () => {
    const existing = [preset()]
    const result = mergeImportedUserPresets(existing, [preset()])
    expect(result).toMatchObject({ added: 0, unchanged: 1, renamed: 0 })
    expect(result.presets).toHaveLength(1)
  })

  it('ignores createdAt when deciding whether a preset is the same one', () => {
    // Two exports of one preset differ in nothing an operator cares about;
    // treating that as a change would duplicate on every re-import.
    const result = mergeImportedUserPresets(
      [preset()],
      [preset({ createdAt: '2026-08-05T09:00:00.000Z', sourceFirmware: 'ArduPlane' })]
    )
    expect(result).toMatchObject({ unchanged: 1, renamed: 0 })
  })

  it('never overwrites a different preset that happens to share an id', () => {
    // The important one. Duplicating is one delete to undo; silently replacing
    // the operator's own preset with a stranger's is not recoverable.
    const mine = preset({ label: 'My 6S OSD', values: [{ paramId: 'OSD1_BATVOLT_X', value: 10 }] })
    const theirs = preset({ label: 'Their 6S OSD', values: [{ paramId: 'OSD1_BATVOLT_X', value: 44 }] })
    const result = mergeImportedUserPresets([mine], [theirs])

    expect(result).toMatchObject({ added: 0, unchanged: 0, renamed: 1 })
    expect(result.presets).toHaveLength(2)
    const kept = result.presets.find((entry) => entry.id === mine.id)
    expect(kept?.label).toBe('My 6S OSD')
    expect(kept?.values[0].value).toBe(10)
  })
})
