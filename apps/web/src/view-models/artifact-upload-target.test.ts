import { describe, expect, it } from 'vitest'
import type { ConfiguratorSnapshot } from '@arduconfig/ardupilot-core'

import { buildArtifactUploadTarget } from './artifact-upload-target'

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
})
