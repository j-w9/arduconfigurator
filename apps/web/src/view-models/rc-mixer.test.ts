import { describe, expect, it } from 'vitest'

import { RC_LOGIC_AUX_FUNCTION_OPTIONS } from '@arduconfig/param-metadata'

import {
  buildRcMixerFunctionLookup,
  createAssignment,
  filterRcMixerFunctionCatalogForVehicle,
  groupAssignmentsByChannel,
  orderRcMixerFunctionCatalog,
  RC_MIXER_FUNCTION_CATALOG,
  RC_MIXER_PRIORITY_FUNCTIONS,
  type RcMixerAssignment,
  type RcMixerFunctionDefinition
} from './rc-mixer'

describe('orderRcMixerFunctionCatalog', () => {
  const catalog: RcMixerFunctionDefinition[] = [
    { id: 20, label: 'Zebra', description: '' },
    { id: 4, label: 'RTL', description: '' },
    { id: 21, label: 'Apple', description: '' },
    { id: 94, label: 'VTX Power', description: '' },
    { id: 22, label: 'Mango', description: '' },
    { id: 0, label: 'Do Nothing', description: '' }
  ]

  it('puts priority functions first (in priority order), then the rest alphabetically', () => {
    const ordered = orderRcMixerFunctionCatalog(catalog).map((entry) => entry.label)
    // Priority ids present here: 0, 94, 4 → in RC_MIXER_PRIORITY_FUNCTIONS order (0, then 4, then 94).
    expect(ordered.slice(0, 3)).toEqual(['Do Nothing', 'RTL', 'VTX Power'])
    // Remainder alphabetical by label.
    expect(ordered.slice(3)).toEqual(['Apple', 'Mango', 'Zebra'])
  })

  it('does not mutate the input and keeps every entry', () => {
    const input = [...catalog]
    const ordered = orderRcMixerFunctionCatalog(catalog)
    expect(catalog).toEqual(input)
    expect(ordered).toHaveLength(catalog.length)
  })

  it('every priority id references a real RCL aux function (guards against typos)', () => {
    const ids = new Set(RC_LOGIC_AUX_FUNCTION_OPTIONS.map((option) => option.value))
    for (const id of RC_MIXER_PRIORITY_FUNCTIONS) {
      expect(ids.has(id)).toBe(true)
    }
  })
})

describe('createAssignment', () => {
  it('seeds the documented PWM defaults and a unique id per call', () => {
    const a = createAssignment(3, 12)
    expect(a).toMatchObject({ channel: 3, functionId: 12, lowPwm: 1700, highPwm: 2100, inverted: false })
    expect(createAssignment(3, 12).id).not.toBe(a.id)
  })
})

describe('buildRcMixerFunctionLookup', () => {
  it('indexes a catalog by function id', () => {
    const catalog = [{ id: 5 }, { id: 9 }] as unknown as RcMixerFunctionDefinition[]
    const lookup = buildRcMixerFunctionLookup(catalog)
    expect(lookup.byId.get(5)).toBe(catalog[0])
    expect(lookup.byId.get(123)).toBeUndefined()
  })

  it('defaults to the built-in catalog and indexes every entry', () => {
    const lookup = buildRcMixerFunctionLookup()
    expect(lookup.byId.size).toBe(RC_MIXER_FUNCTION_CATALOG.length)
    for (const definition of RC_MIXER_FUNCTION_CATALOG) {
      expect(lookup.byId.get(definition.id)).toBe(definition)
    }
  })
})

describe('groupAssignmentsByChannel', () => {
  const assign = (channel: number): RcMixerAssignment => createAssignment(channel, 1)

  it('surfaces every channel 1..maxChannel in order, even empty ones', () => {
    const groups = groupAssignmentsByChannel([], 4)
    expect(groups.map((group) => group.channel)).toEqual([1, 2, 3, 4])
    expect(groups.every((group) => group.assignments.length === 0)).toBe(true)
  })

  it('buckets each assignment under its channel', () => {
    const a = assign(2)
    const b = assign(2)
    const c = assign(4)
    const groups = groupAssignmentsByChannel([a, b, c], 4)
    expect(groups.find((group) => group.channel === 2)?.assignments).toEqual([a, b])
    expect(groups.find((group) => group.channel === 4)?.assignments).toEqual([c])
    expect(groups.find((group) => group.channel === 1)?.assignments).toEqual([])
  })

  it('surfaces an assignment above the 1..maxChannel window so a firmware term stays manageable', () => {
    const nine = assign(9)
    const groups = groupAssignmentsByChannel([nine], 4)
    expect(groups.map((group) => group.channel)).toEqual([1, 2, 3, 4, 9])
    expect(groups.find((group) => group.channel === 9)?.assignments).toEqual([nine])
  })

  it('omits EMPTY excluded channels but keeps an excluded channel that carries a live term', () => {
    // Nothing assigned on the excluded stick axes → they stay hidden.
    const empty = groupAssignmentsByChannel([], 6, new Set([1, 2, 3, 4]))
    expect(empty.map((group) => group.channel)).toEqual([5, 6])
    // A firmware-set RCL term whose SRC points at excluded channel 2 must still
    // appear (on its own row) so it can be seen and removed.
    const two = assign(2)
    const withTerm = groupAssignmentsByChannel([two], 6, new Set([1, 2, 3, 4]))
    expect(withTerm.map((group) => group.channel)).toEqual([2, 5, 6])
    expect(withTerm.find((group) => group.channel === 2)?.assignments).toEqual([two])
  })
})

describe('filterRcMixerFunctionCatalogForVehicle', () => {
  const catalog: RcMixerFunctionDefinition[] = [
    { id: 0, label: 'Do nothing', description: 'generic' },
    { id: 16, label: 'AutoTune', description: 'copter+plane', vehicles: ['ArduCopter', 'ArduPlane'] },
    { id: 66, label: 'Reverse throttle', description: 'rover only', vehicles: ['ArduRover'] }
  ]

  it('shows the full catalog when the vehicle kind is unknown or not yet connected', () => {
    expect(filterRcMixerFunctionCatalogForVehicle(catalog, undefined)).toEqual(catalog)
    expect(filterRcMixerFunctionCatalogForVehicle(catalog, 'Unknown')).toEqual(catalog)
  })

  it('drops entries scoped to vehicles other than the connected one', () => {
    const rover = filterRcMixerFunctionCatalogForVehicle(catalog, 'ArduRover')
    expect(rover.map((entry) => entry.id)).toEqual([0, 66])

    const sub = filterRcMixerFunctionCatalogForVehicle(catalog, 'ArduSub')
    expect(sub.map((entry) => entry.id)).toEqual([0])
  })

  it('keeps vehicle-untagged (generic) entries for every vehicle', () => {
    const copter = filterRcMixerFunctionCatalogForVehicle(catalog, 'ArduCopter')
    expect(copter.map((entry) => entry.id)).toEqual([0, 16])
  })

  it('the real catalog has at least one vehicle-restricted and one generic entry', () => {
    expect(RC_MIXER_FUNCTION_CATALOG.some((entry) => entry.vehicles)).toBe(true)
    expect(RC_MIXER_FUNCTION_CATALOG.some((entry) => !entry.vehicles)).toBe(true)
  })
})
