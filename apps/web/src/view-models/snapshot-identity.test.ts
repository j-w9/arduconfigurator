import { describe, expect, it } from 'vitest'

import {
  describeSnapshotBoardMatch,
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
