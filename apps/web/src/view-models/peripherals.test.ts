import type { ConfiguratorSnapshot, ParameterState } from '@arduconfig/ardupilot-core'
import type { AppViewId } from '@arduconfig/param-metadata'
import { describe, expect, it } from 'vitest'

import {
  buildAdditionalSettingsGroups,
  buildCanNodePeripheralViewModels,
  buildGpsPeripheralViewModels
} from './peripherals'

const param = (id: string, value = 0): ParameterState => ({ id, value }) as unknown as ParameterState

const snapshotWith = (extra: Record<string, unknown>): ConfiguratorSnapshot =>
  ({ parameters: [], canNodes: [], ...extra }) as unknown as ConfiguratorSnapshot

describe('buildGpsPeripheralViewModels', () => {
  it('includes only the GPS slots whose parameter exists on the FC', () => {
    const both = buildGpsPeripheralViewModels(snapshotWith({ parameters: [param('GPS_TYPE', 5), param('GPS_TYPE2', 9)] }))
    expect(both.map((gps) => gps.label)).toEqual(['Primary GPS', 'Secondary GPS'])
    expect(both[0].value).toBe(5)

    const primaryOnly = buildGpsPeripheralViewModels(snapshotWith({ parameters: [param('GPS_TYPE', 5)] }))
    expect(primaryOnly.map((gps) => gps.label)).toEqual(['Primary GPS'])

    expect(buildGpsPeripheralViewModels(snapshotWith({ parameters: [] }))).toEqual([])
  })
})

describe('buildCanNodePeripheralViewModels', () => {
  const node = (overrides: Record<string, unknown> = {}) => ({
    componentId: 12,
    name: '',
    health: 'ok',
    mode: 'operational',
    uptimeSec: 30,
    lastSeenSource: 'uavcan',
    lastSeenAtMs: 1000,
    ...overrides
  })

  it('falls back to "Node <id>" and composes a "health · mode" status line', () => {
    const [vm] = buildCanNodePeripheralViewModels(snapshotWith({ canNodes: [node({ name: '', health: 'warning', mode: 'maintenance' })] }))
    expect(vm.label).toBe('Node 12')
    expect(vm.statusLine).toBe('Warning · Maintenance')
    expect(vm.tone).toBe('warning')
  })

  it('uses the node name when present and maps critical health to danger', () => {
    const [vm] = buildCanNodePeripheralViewModels(snapshotWith({ canNodes: [node({ name: 'Power Brick', health: 'critical' })] }))
    expect(vm.label).toBe('Power Brick')
    expect(vm.nodeName).toBe('Power Brick')
    expect(vm.tone).toBe('danger')
    expect(vm.statusLine).toBe('Critical · Operational')
  })
})

describe('buildAdditionalSettingsGroups', () => {
  const metadataCatalog = {
    categories: [
      { id: 'gps-extra', viewId: 'ports', label: 'GPS extras', description: 'd1' },
      { id: 'other-view', viewId: 'power', label: 'Power extras', description: 'd2' }
    ],
    parametersByCategory: {
      'gps-extra': [{ id: 'GPS_RATE_MS' }, { id: 'GPS_GNSS_MODE' }, { id: 'GPS_MISSING' }],
      'other-view': [{ id: 'BATT_AMP_PERVLT' }]
    }
  } as unknown as Parameters<typeof buildAdditionalSettingsGroups>[1]

  const snapshot = snapshotWith({ parameters: [param('GPS_RATE_MS'), param('GPS_GNSS_MODE'), param('BATT_AMP_PERVLT')] })

  it('keeps only this view\'s categories, drops missing/excluded params and empty groups', () => {
    const groups = buildAdditionalSettingsGroups(snapshot, metadataCatalog, 'ports' as AppViewId, new Set(['GPS_GNSS_MODE']))
    // Only the 'ports' category survives; GPS_MISSING (absent) and GPS_GNSS_MODE (excluded) are dropped.
    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({ categoryId: 'gps-extra', categoryLabel: 'GPS extras' })
    expect(groups[0].parameters.map((parameter) => parameter.id)).toEqual(['GPS_RATE_MS'])
  })

  it('drops a category entirely when none of its params are present', () => {
    const groups = buildAdditionalSettingsGroups(snapshotWith({ parameters: [] }), metadataCatalog, 'ports' as AppViewId, new Set())
    expect(groups).toEqual([])
  })
})

describe('category exclusion', () => {
  // The Servos tab surfaces metadata categories routed to the Motors view. Two
  // of those are owned by other tabs, and showing them twice gave an operator
  // two places to change the same thing with no sign which was authoritative.
  const catalog = {
    categories: [
      { id: 'airframe', label: 'Airframe', description: '', viewId: 'motors', order: 1 },
      { id: 'outputs', label: 'Outputs', description: '', viewId: 'motors', order: 2 },
      { id: 'aux', label: 'Aux servos', description: '', viewId: 'motors', order: 3 }
    ],
    parametersByCategory: {
      airframe: [{ id: 'FRAME_CLASS' }, { id: 'FRAME_TYPE' }],
      outputs: [{ id: 'SERVO_DSHOT_RATE' }, { id: 'SERVO_BLH_BDMASK' }],
      aux: [{ id: 'SERVO9_FUNCTION' }]
    }
  } as unknown as Parameters<typeof buildAdditionalSettingsGroups>[1]

  const snapshot = {
    parameters: [
      { id: 'FRAME_CLASS', value: 1 },
      { id: 'FRAME_TYPE', value: 12 },
      { id: 'SERVO_DSHOT_RATE', value: 0 },
      { id: 'SERVO_BLH_BDMASK', value: 0 },
      { id: 'SERVO9_FUNCTION', value: 0 }
    ]
  } as unknown as Parameters<typeof buildAdditionalSettingsGroups>[0]

  it('drops whole categories another tab owns', () => {
    const groups = buildAdditionalSettingsGroups(
      snapshot,
      catalog,
      'motors',
      new Set(),
      new Set(['airframe', 'outputs'])
    )
    expect(groups.map((group) => group.categoryId)).toEqual(['aux'])
  })

  it('keeps everything when nothing is excluded — the exclusion must be opt-in', () => {
    // Guards the default: an accidental always-on exclusion would silently
    // empty this surface everywhere else it is used.
    const groups = buildAdditionalSettingsGroups(snapshot, catalog, 'motors', new Set())
    expect(groups.map((group) => group.categoryId)).toEqual(['airframe', 'outputs', 'aux'])
  })
})
