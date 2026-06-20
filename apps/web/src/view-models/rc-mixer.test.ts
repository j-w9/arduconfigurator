import { describe, expect, it } from 'vitest'

import {
  buildRcMixerFunctionLookup,
  createAssignment,
  groupAssignmentsByChannel,
  RC_MIXER_FUNCTION_CATALOG,
  type RcMixerAssignment,
  type RcMixerFunctionDefinition
} from './rc-mixer'

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

  it('ignores assignments outside the 1..maxChannel window', () => {
    const groups = groupAssignmentsByChannel([assign(9)], 4)
    expect(groups).toHaveLength(4)
    expect(groups.every((group) => group.assignments.length === 0)).toBe(true)
  })
})
