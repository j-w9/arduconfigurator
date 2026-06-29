import { describe, expect, it } from 'vitest'

import type { ParameterState } from '@arduconfig/ardupilot-core'

import { buildRelayGroups } from './relay-groups'

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
})
