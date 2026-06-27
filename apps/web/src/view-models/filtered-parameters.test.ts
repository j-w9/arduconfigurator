import type { ConfiguratorSnapshot, ParameterState } from '@arduconfig/ardupilot-core'
import { describe, expect, it } from 'vitest'

import { buildFilteredParameters, parameterSearchPredicate, type FilteredParametersInputs } from './filtered-parameters'

// Minimal ParameterState — buildFilteredParameters only reads id, aliasedFrom,
// and definition?.label, so the rest is intentionally omitted and cast.
function param(id: string, extra: Partial<ParameterState> = {}): ParameterState {
  return { id, value: 0, ...extra } as unknown as ParameterState
}

function inputs(
  parameters: ParameterState[],
  parameterSearch: string,
  labelsById: Record<string, string> = {}
): FilteredParametersInputs {
  const catalogParameters = Object.fromEntries(
    Object.entries(labelsById).map(([id, label]) => [id, { label }])
  )
  return {
    snapshot: { parameters } as unknown as ConfiguratorSnapshot,
    parameterSearch,
    // Only `.parameters[id]?.label` is read off the catalog.
    metadataCatalog: { parameters: catalogParameters } as unknown as FilteredParametersInputs['metadataCatalog']
  }
}

const ids = (parameters: ParameterState[]): string[] => parameters.map((parameter) => parameter.id)

describe('buildFilteredParameters', () => {
  it('hides alias-mirror rows (aliasedFrom defined) even with no query', () => {
    const result = buildFilteredParameters(
      inputs(
        [param('MAV_SYSID'), param('SYSID_THISMAV', { aliasedFrom: 'MAV_SYSID' } as Partial<ParameterState>)],
        ''
      )
    )
    expect(ids(result)).toEqual(['MAV_SYSID'])
  })

  it('returns all real parameters (order preserved) for an empty/whitespace query', () => {
    const params = [param('ARMING_CHECK'), param('BATT_MONITOR'), param('GPS_TYPE')]
    expect(ids(buildFilteredParameters(inputs(params, '   ')))).toEqual(['ARMING_CHECK', 'BATT_MONITOR', 'GPS_TYPE'])
  })

  it('treats a query containing * as a case-insensitive substring glob', () => {
    const params = [param('ARMING_CHECK'), param('ARMING_RUDDER'), param('BATT_ARMVOLT')]
    // `ARMING_*` matches the two ARMING_ ids but not the one that merely contains "ARM".
    expect(ids(buildFilteredParameters(inputs(params, 'arming_*')))).toEqual(['ARMING_CHECK', 'ARMING_RUDDER'])
  })

  it('matches wildcards as substring so RLL*, *RLL, *RLL* all find a mid-name token', () => {
    const params = [param('ATC_RAT_RLL_P'), param('ATC_RAT_PIT_P'), param('BATT_MONITOR')]
    // The token RLL is in the MIDDLE of the id — anchored globs returned nothing
    // here and read as "wildcards are broken".
    for (const query of ['RLL*', '*RLL', '*RLL*', 'ATC*RLL*']) {
      expect(ids(buildFilteredParameters(inputs(params, query)))).toEqual(['ATC_RAT_RLL_P'])
    }
  })

  it('supports ? as a single-character glob and matches on the catalog label', () => {
    const params = [param('SERIAL1_PROTOCOL'), param('SERIAL2_PROTOCOL')]
    expect(ids(buildFilteredParameters(inputs(params, 'SERIAL?_PROTOCOL')))).toEqual([
      'SERIAL1_PROTOCOL',
      'SERIAL2_PROTOCOL'
    ])
    // A glob can also hit the metadata label, not just the id.
    const labelled = [param('XYZ_1', {}), param('XYZ_2', {})]
    const result = buildFilteredParameters(inputs(labelled, '*Throttle*', { XYZ_1: 'Throttle minimum' }))
    expect(ids(result)).toEqual(['XYZ_1'])
  })

  it('fuzzy-matches on id + label and drops non-matches', () => {
    const params = [param('BATT_MONITOR'), param('GPS_TYPE'), param('ARMING_CHECK')]
    const result = buildFilteredParameters(inputs(params, 'batt'))
    expect(result.length).toBeGreaterThanOrEqual(1)
    expect(ids(result)).toContain('BATT_MONITOR')
    expect(ids(result)).not.toContain('GPS_TYPE')
  })
})

describe('parameterSearchPredicate', () => {
  it('returns null for an empty/whitespace query (no filter)', () => {
    expect(parameterSearchPredicate('')).toBeNull()
    expect(parameterSearchPredicate('   ')).toBeNull()
  })

  it('glob mode matches id or label, substring and case-insensitive', () => {
    const match = parameterSearchPredicate('arming_*')!
    expect(match('ARMING_CHECK', undefined)).toBe(true)
    expect(match('BATT_ARMVOLT', undefined)).toBe(false)
    // Mid-name token via wildcard (the previously-broken case).
    expect(parameterSearchPredicate('*RLL*')!('ATC_RAT_RLL_P', undefined)).toBe(true)
    const byLabel = parameterSearchPredicate('*Throttle*')!
    expect(byLabel('XYZ_1', 'Throttle minimum')).toBe(true)
    expect(byLabel('XYZ_2', undefined)).toBe(false)
  })

  it('fuzzy mode accepts substring-ish matches and rejects non-matches', () => {
    const match = parameterSearchPredicate('batt')!
    expect(match('BATT_MONITOR', undefined)).toBe(true)
    expect(match('GPS_TYPE', undefined)).toBe(false)
  })
})
