import type { CanBusState, DronecanParamValueState } from '@arduconfig/ardupilot-core'
import { describe, expect, it } from 'vitest'

import {
  buildCanBusNodeRows,
  buildCanBusStagedChanges,
  compareParamEntries,
  formatParamValue,
  healthLabel,
  modeLabel,
  parseParamInput,
  toneForHealth
} from './can-bus'

describe('can-bus label/tone maps', () => {
  it('toneForHealth folds error+critical to danger and unknown to neutral', () => {
    expect(toneForHealth('ok')).toBe('success')
    expect(toneForHealth('warning')).toBe('warning')
    expect(toneForHealth('error')).toBe('danger')
    expect(toneForHealth('critical')).toBe('danger')
    expect(toneForHealth('unknown')).toBe('neutral')
  })

  it('modeLabel + healthLabel map every enum to a human label', () => {
    expect(modeLabel('operational')).toBe('Operational')
    expect(modeLabel('software_update')).toBe('Updating firmware')
    expect(modeLabel('offline')).toBe('Offline')
    expect(modeLabel('unknown')).toBe('Unknown')
    expect(healthLabel('ok')).toBe('OK')
    expect(healthLabel('critical')).toBe('Critical')
    expect(healthLabel('unknown')).toBe('Unknown')
  })
})

describe('formatParamValue', () => {
  const value = (v: Partial<DronecanParamValueState>): DronecanParamValueState => v as DronecanParamValueState

  it('renders each variant and an em-dash for missing/empty', () => {
    expect(formatParamValue(undefined)).toBe('—')
    expect(formatParamValue(value({ tag: 'empty' }))).toBe('—')
    expect(formatParamValue(value({ tag: 'int64', int64: '42' }))).toBe('42')
    expect(formatParamValue(value({ tag: 'real32', real32: 1.5 }))).toBe('1.5')
    expect(formatParamValue(value({ tag: 'bool', bool: true }))).toBe('true')
    expect(formatParamValue(value({ tag: 'bool', bool: false }))).toBe('false')
    expect(formatParamValue(value({ tag: 'string', string: 'hi' }))).toBe('hi')
  })
})

describe('parseParamInput', () => {
  const ref = (tag: DronecanParamValueState['tag']): DronecanParamValueState =>
    ({ tag, int64: '0', real32: 0, bool: false, string: '' }) as DronecanParamValueState

  it('int64: accepts integer text, rejects non-integers', () => {
    expect(parseParamInput('  -17 ', ref('int64'))).toEqual({ tag: 'int64', int64: '-17' })
    expect(parseParamInput('1.5', ref('int64'))).toBeUndefined()
    expect(parseParamInput('abc', ref('int64'))).toBeUndefined()
  })

  it('real32: accepts finite floats, rejects garbage', () => {
    expect(parseParamInput('1.25', ref('real32'))).toEqual({ tag: 'real32', real32: 1.25 })
    expect(parseParamInput('nope', ref('real32'))).toBeUndefined()
  })

  it('bool: maps a range of truthy/falsey words, rejects others', () => {
    for (const yes of ['1', 'true', 'YES', 'y', 'on']) {
      expect(parseParamInput(yes, ref('bool'))).toEqual({ tag: 'bool', bool: true })
    }
    for (const no of ['0', 'false', 'NO', 'n', 'off']) {
      expect(parseParamInput(no, ref('bool'))).toEqual({ tag: 'bool', bool: false })
    }
    expect(parseParamInput('maybe', ref('bool'))).toBeUndefined()
  })

  it('string passes through; empty cannot be edited', () => {
    expect(parseParamInput('anything', ref('string'))).toEqual({ tag: 'string', string: 'anything' })
    expect(parseParamInput('x', ref('empty'))).toBeUndefined()
  })
})

describe('buildCanBusNodeRows', () => {
  const node = (overrides: Record<string, unknown> = {}) => ({
    nodeId: 7,
    name: '',
    health: 'ok',
    mode: 'operational',
    uptimeSec: 10,
    paramFetch: { status: 'idle' },
    parameters: [],
    ...overrides
  })

  const rows = (nodes: ReturnType<typeof node>[]) => buildCanBusNodeRows({ nodes } as unknown as CanBusState)

  it('falls back to "Node N" when the node has no name, and tags the tone from health', () => {
    const [row] = rows([node({ name: '', health: 'critical' })])
    expect(row.label).toBe('Node 7')
    expect(row.tone).toBe('danger')
  })

  it('formats hw/sw version and an 8-digit hex git hash from the VCS commit', () => {
    const [row] = rows([
      node({ name: 'ESC', hwUniqueId: 'abcdef0123456789ff', hwVersion: { major: 1, minor: 2 }, swVersion: { major: 3, minor: 4, vcsCommit: 0x0badf00d } })
    ])
    expect(row.label).toBe('ESC')
    expect(row.detail).toBe('UID abcdef0123456789…')
    expect(row.hwVersion).toBe('1.2')
    expect(row.swVersion).toBe('3.4')
    expect(row.gitHash).toBe('0badf00d')
  })
})

describe('compareParamEntries', () => {
  it('orders by node enumeration index', () => {
    const entries = [{ index: 3 }, { index: 1 }, { index: 2 }] as Parameters<typeof compareParamEntries>[0][]
    expect([...entries].sort(compareParamEntries).map((entry) => entry.index)).toEqual([1, 2, 3])
  })
})

describe('buildCanBusStagedChanges', () => {
  const int = (v: string): DronecanParamValueState => ({ tag: 'int64', int64: v }) as DronecanParamValueState
  const node = {
    nodeId: 125,
    parameters: [
      { name: 'B_PARAM', value: int('5'), defaultValue: undefined, minValue: undefined, maxValue: undefined },
      { name: 'A_PARAM', value: int('1'), defaultValue: undefined, minValue: undefined, maxValue: undefined }
    ]
  } as unknown as Parameters<typeof buildCanBusStagedChanges>[0]

  it('lists only real changes, sorted, with current → next labels', () => {
    const changes = buildCanBusStagedChanges(node, {
      '125:A_PARAM': '7',
      '125:B_PARAM': '5' // typed back to the live value -> not a change
    })
    expect(changes).toHaveLength(1)
    expect(changes[0]).toMatchObject({ name: 'A_PARAM', currentLabel: '1', nextLabel: '7' })
    expect(changes[0].parsed).toEqual({ tag: 'int64', int64: '7' })
  })

  it('keeps an unparsable draft visible as invalid (parsed undefined)', () => {
    const changes = buildCanBusStagedChanges(node, { '125:A_PARAM': 'abc' })
    expect(changes).toHaveLength(1)
    expect(changes[0].parsed).toBeUndefined()
    expect(changes[0].nextLabel).toBe('abc')
  })

  it('ignores drafts for other nodes and empty draft maps', () => {
    expect(buildCanBusStagedChanges(node, {})).toHaveLength(0)
    expect(buildCanBusStagedChanges(node, { '99:A_PARAM': '7' })).toHaveLength(0)
  })
})
