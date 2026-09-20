import { describe, expect, it } from 'vitest'

import { createMockParamPckBytes } from '@arduconfig/protocol-mavlink'

import { isParamPck, parseParamPck } from './param-pck'

// The demo now serves a packed parameter table, because everything that depends
// on knowing a parameter's firmware default -- the "changed only" filter, the
// Default column, and the guided sequence's capture of settings already on the
// vehicle -- was otherwise only testable against hardware.
//
// The encoder and the parser are two halves of one format, so they are checked
// against each other rather than against a hand-written byte string that would
// just encode the same misreading twice.

describe('the demo parameter pack', () => {
  const parameters = {
    RC1_MIN: 1100,
    RC1_MAX: 1900,
    INS_TCAL1_ENABLE: 1,
    BRD_HEAT_TARG: 45,
    MOT_SPIN_MIN: 0.15,
    ATC_RAT_RLL_P: 0.135,
    A: 7,
    SIXTEEN_CHARS_LNG: 3
  }

  it('is recognisable as a parameter pack with defaults', () => {
    const bytes = createMockParamPckBytes(parameters)
    expect(isParamPck(bytes)).toBe(true)
    expect(parseParamPck(bytes).withDefaults).toBe(true)
  })

  it('round-trips every name and value through the real parser', () => {
    const result = parseParamPck(createMockParamPckBytes(parameters))
    const byName = new Map(result.entries.map((e) => [e.name, e]))
    // A 17-character name cannot be encoded and is left out rather than
    // truncated into a different parameter.
    for (const [name, value] of Object.entries(parameters)) {
      if (name.length > 16) continue
      expect(byName.get(name), name).toBeDefined()
      expect(byName.get(name)?.value, name).toBeCloseTo(value, 4)
    }
  })

  it('knows a default for every parameter, changed or not', () => {
    const result = parseParamPck(createMockParamPckBytes(parameters))
    for (const entry of result.entries) {
      expect(result.defaultsByParamId.has(entry.name), entry.name).toBe(true)
    }
  })

  it('marks some parameters as changed, and their default differs from their value', () => {
    // A pack where nothing is non-default would exercise none of the paths it
    // exists for; one where the default equals the value would let a broken
    // comparison pass.
    const result = parseParamPck(createMockParamPckBytes(parameters))
    expect(result.nonDefaultParamIds.size).toBeGreaterThan(0)
    for (const name of result.nonDefaultParamIds) {
      const entry = result.entries.find((e) => e.name === name)
      expect(entry?.defaultValue).not.toBe(entry?.value)
    }
  })

  it('is deterministic, so a test of the demo can assert on it', () => {
    const a = parseParamPck(createMockParamPckBytes(parameters))
    const b = parseParamPck(createMockParamPckBytes(parameters))
    expect([...a.nonDefaultParamIds].sort()).toEqual([...b.nonDefaultParamIds].sort())
  })

  it('survives an empty vehicle', () => {
    const result = parseParamPck(createMockParamPckBytes({}))
    expect(result.entries).toEqual([])
  })
})
