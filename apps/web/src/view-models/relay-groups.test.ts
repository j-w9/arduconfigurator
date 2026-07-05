import { describe, expect, it } from 'vitest'

import type { ParameterState } from '@arduconfig/ardupilot-core'

import {
  buildRelayGroups,
  planRelayRcChannelChange,
  relayRcChannelBinding,
  RELAY_AUX_FUNCS
} from './relay-groups'

function param(id: string, value = 0): ParameterState {
  return { id, value, index: 0, count: 0 }
}

describe('buildRelayGroups', () => {
  it('groups RELAYx_* params by instance in instance order', () => {
    const groups = buildRelayGroups([
      param('RELAY2_FUNCTION'),
      param('RELAY1_FUNCTION'),
      param('RELAY1_PIN'),
      param('RELAY2_PIN')
    ])
    expect(groups.map((group) => group.instance)).toEqual([1, 2])
    expect(groups[0].label).toBe('Relay 1')
  })

  it('orders fields FUNCTION, PIN, DEFAULT, INVERTED regardless of input order', () => {
    const groups = buildRelayGroups([
      param('RELAY1_INVERTED'),
      param('RELAY1_DEFAULT'),
      param('RELAY1_PIN'),
      param('RELAY1_FUNCTION')
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].parameters.map((p) => p.id)).toEqual([
      'RELAY1_FUNCTION',
      'RELAY1_PIN',
      'RELAY1_DEFAULT',
      'RELAY1_INVERTED'
    ])
  })

  it('only includes reported fields and ignores non-relay params', () => {
    const groups = buildRelayGroups([param('RELAY1_FUNCTION'), param('SERVO1_FUNCTION'), param('MOT_PWM_TYPE')])
    expect(groups).toHaveLength(1)
    expect(groups[0].parameters.map((p) => p.id)).toEqual(['RELAY1_FUNCTION'])
  })

  it('returns no groups when no relay params are present', () => {
    expect(buildRelayGroups([param('SERVO1_FUNCTION')])).toEqual([])
  })

  it('tags each group with its RC aux-function value', () => {
    const groups = buildRelayGroups([param('RELAY1_FUNCTION'), param('RELAY2_FUNCTION')])
    expect(groups[0].auxFunc).toBe(28) // Relay 1 → RCn_OPTION 28
    expect(groups[1].auxFunc).toBe(34) // Relay 2 → RCn_OPTION 34
  })
})

describe('relayRcChannelBinding', () => {
  it('finds the channel whose RCn_OPTION matches the aux function', () => {
    const map = new Map([
      [5, 0],
      [10, 28], // RC10_OPTION = 28 → Relay 1
      [11, 34] // RC11_OPTION = 34 → Relay 2
    ])
    expect(relayRcChannelBinding(RELAY_AUX_FUNCS[1], map)).toBe(10)
    expect(relayRcChannelBinding(RELAY_AUX_FUNCS[2], map)).toBe(11)
  })

  it('returns undefined when nothing is bound, or the aux function is undefined', () => {
    expect(relayRcChannelBinding(28, new Map([[1, 0]]))).toBeUndefined()
    expect(relayRcChannelBinding(undefined, new Map([[10, 28]]))).toBeUndefined()
  })

  it('picks the lowest channel when several are bound', () => {
    expect(relayRcChannelBinding(28, new Map([[12, 28], [7, 28]]))).toBe(7)
  })
})

describe('planRelayRcChannelChange', () => {
  it('sets the new channel and clears the previously-bound one', () => {
    expect(planRelayRcChannelChange(28, 11, 10)).toEqual([
      { id: 'RC11_OPTION', value: '28' },
      { id: 'RC10_OPTION', value: '0' }
    ])
  })

  it('only sets the new channel when there was no prior binding', () => {
    expect(planRelayRcChannelChange(34, 6, undefined)).toEqual([{ id: 'RC6_OPTION', value: '34' }])
  })

  it('unbinds (clears only) when the new channel is None (0)', () => {
    expect(planRelayRcChannelChange(28, 0, 10)).toEqual([{ id: 'RC10_OPTION', value: '0' }])
  })

  it('is a no-op set when the channel is unchanged', () => {
    expect(planRelayRcChannelChange(28, 10, 10)).toEqual([{ id: 'RC10_OPTION', value: '28' }])
  })
})
