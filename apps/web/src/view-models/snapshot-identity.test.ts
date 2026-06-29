import { describe, expect, it } from 'vitest'

import {
  describeSnapshotBoardMatch,
  describeSnapshotFirmwareMatch,
  describeSnapshotVehicleMatch,
  isMeaningfulHardwareUid
} from './snapshot-identity'

describe('isMeaningfulHardwareUid', () => {
  it('rejects empty / all-zero UIDs and accepts real ones', () => {
    expect(isMeaningfulHardwareUid(undefined)).toBe(false)
    expect(isMeaningfulHardwareUid('')).toBe(false)
    expect(isMeaningfulHardwareUid('0000000000000000')).toBe(false)
    expect(isMeaningfulHardwareUid('00:00:00:00')).toBe(false)
    expect(isMeaningfulHardwareUid('1a2b3c4d')).toBe(true)
  })
})

describe('describeSnapshotBoardMatch', () => {
  it('reports same board when meaningful UIDs match (ignoring separators/case)', () => {
    expect(describeSnapshotBoardMatch('1A2B-3C4D', '1a2b3c4d').status).toBe('same')
  })

  it('reports different board when meaningful UIDs differ', () => {
    const result = describeSnapshotBoardMatch('1a2b3c4d', 'deadbeef')
    expect(result.status).toBe('different')
    expect(result.tone).toBe('warning')
  })

  it('is unknown when either UID is missing or all-zero', () => {
    expect(describeSnapshotBoardMatch(undefined, '1a2b3c4d').status).toBe('unknown')
    expect(describeSnapshotBoardMatch('1a2b3c4d', '0000000000000000').status).toBe('unknown')
  })
})

describe('describeSnapshotVehicleMatch', () => {
  it('reports same vehicle for identical types', () => {
    expect(describeSnapshotVehicleMatch('ArduCopter', 'ArduCopter').status).toBe('same')
  })

  it('reports a directional cross-vehicle label for a mismatch', () => {
    const result = describeSnapshotVehicleMatch('ArduPlane', 'ArduCopter')
    expect(result.status).toBe('different')
    expect(result.label).toContain('ArduPlane')
    expect(result.label).toContain('ArduCopter')
  })

  it('is unknown when either vehicle is missing or Unknown', () => {
    expect(describeSnapshotVehicleMatch('Unknown', 'ArduCopter').status).toBe('unknown')
    expect(describeSnapshotVehicleMatch('ArduCopter', undefined).status).toBe('unknown')
  })
})

describe('describeSnapshotFirmwareMatch', () => {
  it('flags a major.minor series mismatch (the 4.6 → 4.7 param-rename case)', () => {
    const result = describeSnapshotFirmwareMatch('4.6.0 (official)', { major: 4, minor: 7, patch: 0 })
    expect(result.status).toBe('different')
    expect(result.tone).toBe('warning')
    expect(result.label).toContain('4.6.0')
    expect(result.label).toContain('4.7.0')
  })

  it('treats a patch-only difference within the same series as the same', () => {
    expect(describeSnapshotFirmwareMatch('4.7.0', { major: 4, minor: 7, patch: 3 }).status).toBe('same')
  })

  it('parses a decorated version string and matches an identical series', () => {
    expect(describeSnapshotFirmwareMatch('ArduCopter V4.7.0 (abc123)', { major: 4, minor: 7, patch: 0 }).status).toBe(
      'same'
    )
  })

  it('is unknown when either version is missing or unparseable', () => {
    expect(describeSnapshotFirmwareMatch(undefined, { major: 4, minor: 7, patch: 0 }).status).toBe('unknown')
    expect(describeSnapshotFirmwareMatch('4.7.0', undefined).status).toBe('unknown')
    expect(describeSnapshotFirmwareMatch('no-version-here', { major: 4, minor: 7, patch: 0 }).status).toBe('unknown')
  })
})
