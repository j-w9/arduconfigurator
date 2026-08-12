import { describe, expect, it } from 'vitest'
import type { ConfiguratorSnapshot } from '@arduconfig/ardupilot-core'

import {
  artifactUploadNameFromFileName,
  buildArtifactUploadTarget,
  resolveArtifactUploadFileName
} from './artifact-upload-target'

const TODAY = '2026-08-10'

function snapshot(board: Record<string, unknown> = {}, vehicle = 'ArduCopter'): ConfiguratorSnapshot {
  return { hardware: { board }, vehicle: { vehicle } } as unknown as ConfiguratorSnapshot
}

describe('buildArtifactUploadTarget', () => {
  it('files under the board’s own name, so config lands beside that aircraft’s flights', () => {
    const target = buildArtifactUploadTarget(
      snapshot({ reportedBoardName: 'BROTHERHOBBYH743', boardType: 5810 }),
      'parameters',
      'json',
      TODAY
    )
    expect(target.folder).toBe('brotherhobbyh743/2026-08')
    expect(target.fileName).toBe('brotherhobbyh743_2026-08-10_params.json')
  })

  it('groups by month, so a busy aircraft’s folder stays readable', () => {
    expect(buildArtifactUploadTarget(snapshot({ reportedBoardName: 'ARK_FPV' }), 'presets', 'json', TODAY).folder).toBe(
      'ark-fpv/2026-08'
    )
  })

  it('falls back to the board id when the banner name was never seen', () => {
    // The banner only prints at boot; a mid-session connect may never see it.
    const target = buildArtifactUploadTarget(snapshot({ boardType: 5810 }), 'snapshots', 'json', TODAY)
    expect(target.folder).toBe('board-5810/2026-08')
    expect(target.fileName).toBe('board-5810_2026-08-10_snapshots.json')
  })

  it('falls back to the vehicle type when there is no board identity at all', () => {
    expect(buildArtifactUploadTarget(snapshot({}), 'parameters', 'json', TODAY).folder).toBe('arducopter/2026-08')
  })

  it('never produces an empty folder segment', () => {
    // An empty aircraft key would put every operator’s files in one root pile.
    const target = buildArtifactUploadTarget(
      { hardware: { board: {} } } as unknown as ConfiguratorSnapshot,
      'parameters',
      'json',
      TODAY
    )
    expect(target.folder).toBe('unknown-aircraft/2026-08')
    expect(target.folder.split('/').every((part) => part.length > 0)).toBe(true)
  })

  it('treats board id 0 as no identity — SITL and stripped builds report it', () => {
    expect(buildArtifactUploadTarget(snapshot({ boardType: 0 }), 'parameters', 'json', TODAY).folder).toBe(
      'arducopter/2026-08'
    )
  })

  it('names each kind distinctly, so a directory listing reads without opening files', () => {
    const board = { reportedBoardName: 'ARK_FPV' }
    const names = (['parameters', 'presets', 'snapshots'] as const).map(
      (kind) => buildArtifactUploadTarget(snapshot(board), kind, 'json', TODAY).fileName
    )
    expect(new Set(names).size).toBe(3)
    expect(names).toEqual([
      'ark-fpv_2026-08-10_params.json',
      'ark-fpv_2026-08-10_presets.json',
      'ark-fpv_2026-08-10_snapshots.json'
    ])
  })

  it('names one item out of a library after that item', () => {
    const target = buildArtifactUploadTarget(
      snapshot({ reportedBoardName: 'ARK_FPV' }),
      'snapshots',
      'json',
      TODAY,
      'Before Autotune'
    )
    expect(target.fileName).toBe('ark-fpv_2026-08-10_snapshot-before-autotune.json')
    expect(target.folder).toBe('ark-fpv/2026-08')
  })

  it('still produces a usable item name when the label is all punctuation', () => {
    expect(
      buildArtifactUploadTarget(snapshot({ reportedBoardName: 'ARK_FPV' }), 'snapshots', 'json', TODAY, '???').fileName
    ).toBe('ark-fpv_2026-08-10_snapshot-unnamed.json')
  })
})

describe('artifactUploadNameFromFileName', () => {
  it('offers the name without its extension for editing', () => {
    expect(artifactUploadNameFromFileName('ark-fpv_2026-08-10_params.json')).toBe('ark-fpv_2026-08-10_params')
  })

  it('leaves an extensionless name alone', () => {
    expect(artifactUploadNameFromFileName('backup')).toBe('backup')
  })

  it('does not treat a leading dot as an extension', () => {
    expect(artifactUploadNameFromFileName('.hidden')).toBe('.hidden')
  })
})

describe('resolveArtifactUploadFileName', () => {
  const DEFAULT = 'ark-fpv_2026-08-10_params.json'

  it('round-trips the untouched default, so the one-click path is unchanged', () => {
    expect(resolveArtifactUploadFileName(DEFAULT, artifactUploadNameFromFileName(DEFAULT))).toBe(DEFAULT)
  })

  it('falls back to the derived default when the field is cleared', () => {
    expect(resolveArtifactUploadFileName(DEFAULT, '')).toBe(DEFAULT)
    expect(resolveArtifactUploadFileName(DEFAULT, '   ')).toBe(DEFAULT)
    expect(resolveArtifactUploadFileName(DEFAULT, '///')).toBe(DEFAULT)
  })

  it('keeps the extension the server classifies on', () => {
    expect(resolveArtifactUploadFileName(DEFAULT, 'After Autotune')).toBe('after-autotune.json')
  })

  it('does not double an extension the operator typed back', () => {
    expect(resolveArtifactUploadFileName(DEFAULT, 'after-autotune.json')).toBe('after-autotune.json')
    expect(resolveArtifactUploadFileName(DEFAULT, 'After Autotune.JSON')).toBe('after-autotune.json')
  })

  it('normalises the way the derived names are spelled', () => {
    expect(resolveArtifactUploadFileName(DEFAULT, '  Hex A — tune #3  ')).toBe('hex-a-tune-3.json')
    expect(resolveArtifactUploadFileName(DEFAULT, 'my_backup')).toBe('my_backup.json')
  })

  it('cannot escape its folder', () => {
    // A typed name is a name, never a path — separators and traversal collapse.
    expect(resolveArtifactUploadFileName(DEFAULT, '../../etc/passwd')).toBe('etc-passwd.json')
    expect(resolveArtifactUploadFileName(DEFAULT, 'a/b')).toBe('a-b.json')
    expect(resolveArtifactUploadFileName(DEFAULT, '..')).toBe(DEFAULT)
  })

  it('caps a pasted essay, without leaving a trailing separator', () => {
    const resolved = resolveArtifactUploadFileName(DEFAULT, `${'a'.repeat(120)} tail`)
    expect(resolved).toBe(`${'a'.repeat(100)}.json`)
  })

  it('handles a default that has no extension', () => {
    expect(resolveArtifactUploadFileName('backup', 'Something Else')).toBe('something-else')
  })
})
