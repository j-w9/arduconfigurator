import { describe, expect, it } from 'vitest'

import type { NormalizedFirmwareMetadataBundle } from '@arduconfig/param-metadata'

import { buildParameterReference, PARAMETER_REFERENCE_LIMIT } from './parameter-reference'

// Only `.firmware` and `.parameters` are read.
function catalog(
  parameters: Record<string, Record<string, unknown>>
): NormalizedFirmwareMetadataBundle {
  return { firmware: 'ArduCopter', parameters } as unknown as NormalizedFirmwareMetadataBundle
}

const SAMPLE = catalog({
  BATT_MONITOR: {
    id: 'BATT_MONITOR',
    label: 'Battery monitor',
    description: 'How the pack is measured.',
    options: [
      { value: 0, label: 'Disabled' },
      { value: 4, label: 'Analog Voltage and Current' }
    ]
  },
  BATT2_MONITOR: { id: 'BATT2_MONITOR', label: 'Second battery monitor' },
  INS_GYRO_FILTER: { id: 'INS_GYRO_FILTER', label: 'Gyro filter', unit: 'Hz', minimum: 0, maximum: 256 },
  FS_THR_ENABLE: { id: 'FS_THR_ENABLE', label: 'Throttle failsafe' },
  FS_EKF_THRESH: { id: 'FS_EKF_THRESH', label: 'EKF failsafe threshold' }
})

describe('buildParameterReference', () => {
  it('lists the whole bundle when nothing is typed', () => {
    const result = buildParameterReference({ catalog: SAMPLE, search: '' })
    expect(result.matchCount).toBe(5)
    expect(result.totalCount).toBe(5)
    // Alphabetical, so a reader can find their way without a search.
    expect(result.rows.map((row) => row.id)).toEqual([
      'BATT2_MONITOR',
      'BATT_MONITOR',
      'FS_EKF_THRESH',
      'FS_THR_ENABLE',
      'INS_GYRO_FILTER'
    ])
  })

  it('uses the search box semantics, wildcards and all', () => {
    expect(buildParameterReference({ catalog: SAMPLE, search: 'BATT*MONITOR' }).rows.map((row) => row.id)).toEqual([
      'BATT2_MONITOR',
      'BATT_MONITOR'
    ])
    // Fuzzy: FS_THR also drags in FS_EKF_THRESH, exactly as it does connected.
    expect(buildParameterReference({ catalog: SAMPLE, search: 'FS_THR' }).matchCount).toBe(2)
    expect(buildParameterReference({ catalog: SAMPLE, search: 'FS_THR', exactSearch: true }).matchCount).toBe(1)
  })

  it('carries the reference material a reader actually wants', () => {
    const [row] = buildParameterReference({ catalog: SAMPLE, search: 'BATT_MONITOR', exactSearch: true }).rows
    expect(row?.label).toBe('Battery monitor')
    expect(row?.description).toBe('How the pack is measured.')
    expect(row?.options).toEqual(['0 — Disabled', '4 — Analog Voltage and Current'])

    const [gyro] = buildParameterReference({ catalog: SAMPLE, search: 'INS_GYRO_FILTER', exactSearch: true }).rows
    expect(gyro?.unit).toBe('Hz')
    expect(gyro?.range).toBe('0 – 256')
  })

  it('caps the list but reports what it left out', () => {
    const many = catalog(
      Object.fromEntries(
        Array.from({ length: PARAMETER_REFERENCE_LIMIT + 25 }, (_, index) => [
          `PARAM_${String(index).padStart(3, '0')}`,
          { id: `PARAM_${String(index).padStart(3, '0')}` }
        ])
      )
    )
    const result = buildParameterReference({ catalog: many, search: '' })
    // A truncated list that looks complete is worse than a short one that says
    // it is short, so the count is the honest total, not the rendered length.
    expect(result.rows).toHaveLength(PARAMETER_REFERENCE_LIMIT)
    expect(result.matchCount).toBe(PARAMETER_REFERENCE_LIMIT + 25)
  })

  it('says nothing matched rather than pretending the bundle is empty', () => {
    const result = buildParameterReference({ catalog: SAMPLE, search: 'ZZZ_NOT_A_PARAM', exactSearch: true })
    expect(result.rows).toEqual([])
    expect(result.matchCount).toBe(0)
    expect(result.totalCount).toBe(5)
  })
})
