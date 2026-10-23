import { describe, expect, it } from 'vitest'

import { buildFeatureSearchIndex, searchFeatures, type FeatureSearchIndexInputs } from './feature-search'

function inputs(overrides: Partial<FeatureSearchIndexInputs> = {}): FeatureSearchIndexInputs {
  return {
    views: [
      { id: 'setup', label: 'Status & Info' },
      { id: 'config', label: 'Config' },
      { id: 'peripherals', label: 'Peripherals' },
      { id: 'motors', label: 'Motors', description: 'Motor order, direction and ESC protocol.' },
      { id: 'servos', label: 'Servos' },
      { id: 'failsafe', label: 'Failsafe' },
      { id: 'osd', label: 'OSD & VTX' },
      { id: 'parameters', label: 'Parameters' },
      { id: 'servos', label: 'Servos' }
    ],
    sections: [
      {
        id: 'frame',
        title: 'Frame',
        description: 'Airframe geometry.',
        category: 'airframe',
        fields: [{ paramId: 'FRAME_CLASS', label: 'Frame class' }, { paramId: 'FRAME_TYPE', label: 'Frame type' }],
        viewId: 'config'
      },
      { id: 'gps', title: 'GPS', category: 'gps', fields: [{ paramId: 'GPS_TYPE', label: 'GPS type' }], viewId: 'peripherals' }
    ],
    categoryLabels: { airframe: 'Airframe & Powertrain', gps: 'GPS' },
    parameters: [
      { id: 'FRAME_CLASS', label: 'Frame class', category: 'airframe' },
      { id: 'GPS_TYPE', label: 'GPS type', category: 'peripherals' },
      { id: 'FS_THR_ENABLE', label: 'Throttle failsafe', category: 'failsafe' },
      { id: 'VTX_POWER', label: 'VTX power', category: 'vtx' },
      { id: 'BATT_MONITOR', label: 'Battery monitor', category: 'power' },
      { id: 'SCR_ENABLE', label: 'Scripting', category: 'scripting' }
    ],
    parameterCategoryViews: { airframe: 'config', peripherals: 'peripherals', failsafe: 'failsafe', vtx: 'vtx', power: 'power', scripting: 'lua' },
    ...overrides
  }
}

describe('buildFeatureSearchIndex', () => {
  it('sends a parameter to the section that renders it, else to its category tab', () => {
    const index = buildFeatureSearchIndex(inputs())
    const frameClass = index.find((entry) => entry.key === 'param:FRAME_CLASS')
    expect(frameClass).toMatchObject({ viewId: 'config', configCategory: 'airframe', sectionId: 'frame' })
    expect(frameClass?.detail).toBe('Frame class · Config › Airframe & Powertrain › Frame')
    expect(index.find((entry) => entry.key === 'param:GPS_TYPE')).toMatchObject({ viewId: 'peripherals', configCategory: 'gps', sectionId: 'gps' })
    expect(index.find((entry) => entry.key === 'param:FS_THR_ENABLE')).toMatchObject({ viewId: 'failsafe', detail: 'Throttle failsafe · Failsafe' })
  })

  it('maps the tabs the catalog still names onto where they live now', () => {
    const index = buildFeatureSearchIndex(inputs())
    expect(index.find((entry) => entry.key === 'param:VTX_POWER')).toMatchObject({ viewId: 'osd' })
    expect(index.find((entry) => entry.key === 'param:BATT_MONITOR')).toMatchObject({ viewId: 'config', configCategory: 'power' })
  })

  it('falls back to Parameters for a category whose tab the app does not have', () => {
    expect(buildFeatureSearchIndex(inputs()).find((entry) => entry.key === 'param:SCR_ENABLE')).toMatchObject({ viewId: 'parameters' })
  })
})

describe('searchFeatures', () => {
  const index = buildFeatureSearchIndex(inputs())

  it('returns nothing for an empty query', () => {
    expect(searchFeatures(index, '  ', { isExpertMode: false })).toEqual([])
  })

  it('ranks the exact label first, then prefixes, tabs before sections before parameters', () => {
    const labels = searchFeatures(index, 'frame', { isExpertMode: false }).map((result) => `${result.kind}:${result.label}`)
    expect(labels[0]).toBe('section:Frame')
    expect(labels).toContain('parameter:FRAME_CLASS')
  })

  it('matches a parameter id typed with underscores or spaces, and every word must match', () => {
    expect(searchFeatures(index, 'fs_thr', { isExpertMode: false })[0]?.label).toBe('FS_THR_ENABLE')
    expect(searchFeatures(index, 'throttle failsafe', { isExpertMode: false })[0]?.label).toBe('FS_THR_ENABLE')
    expect(searchFeatures(index, 'throttle gps', { isExpertMode: false })).toEqual([])
  })

  it('offers no Expert-only tab outside Expert mode', () => {
    expect(searchFeatures(index, 'parameters', { isExpertMode: false })).toEqual([])
    expect(searchFeatures(index, 'SCR_ENABLE', { isExpertMode: false })).toEqual([])
    expect(searchFeatures(index, 'parameters', { isExpertMode: true })[0]).toMatchObject({ kind: 'tab', viewId: 'parameters' })
    expect(searchFeatures(index, 'servos', { isExpertMode: false })[0]).toMatchObject({ kind: 'tab', viewId: 'servos' })
  })

  it('caps the list', () => {
    expect(searchFeatures(index, 'e', { isExpertMode: true, limit: 3 })).toHaveLength(3)
  })
})
