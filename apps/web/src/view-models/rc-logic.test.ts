import { describe, expect, it } from 'vitest'

import type { ParameterState } from '@arduconfig/ardupilot-core'

import {
  rcLogicAddDrafts,
  rcLogicRemovePlan,
  rcLogicUpdateDrafts,
  readRcLogicModel
} from './rc-logic'

function params(values: Record<string, number>): ParameterState[] {
  return Object.entries(values).map(([id, value]) => ({ id, value }) as ParameterState)
}

describe('readRcLogicModel', () => {
  it('maps a live range term to a channel assignment and finds the next free slot', () => {
    const model = readRcLogicModel(
      params({ RCL_ENABLE: 1, RCL1_FUNC: 153, RCL1_OPT: 0, RCL1_SRC: 5, RCL1_MIN: 1600, RCL1_MAX: 2100 }),
      {}
    )
    expect(model.enabled).toBe(true)
    expect(model.assignments).toHaveLength(1)
    expect(model.assignments[0]).toMatchObject({
      id: 'rcl-1',
      channel: 5,
      functionId: 153,
      lowPwm: 1600,
      highPwm: 2100,
      inverted: false
    })
    expect(model.freeTermIndex).toBe(2)
    expect(model.hiddenTermCount).toBe(0)
  })

  it('reads the negate bit as inverted', () => {
    const model = readRcLogicModel(params({ RCL2_FUNC: 18, RCL2_OPT: 0b1000, RCL2_SRC: 6 }), {})
    expect(model.assignments[0]).toMatchObject({ id: 'rcl-2', inverted: true, functionId: 18 })
  })

  it('reads the output position from OPT bits 4-5 (VTX power selector)', () => {
    const pos = (opt: number) =>
      readRcLogicModel(params({ RCL1_FUNC: 94, RCL1_OPT: opt, RCL1_SRC: 6 }), {}).assignments[0].outputPosition
    expect(pos(0)).toBe('high') // neither bit
    expect(pos(1 << 4)).toBe('middle') // bit 4
    expect(pos(2 << 4)).toBe('low') // bit 5
  })

  it('keeps non-range terms (link/condition) out of the editor but counts them as used', () => {
    const model = readRcLogicModel(params({ RCL3_FUNC: 16, RCL3_OPT: 1 /* link */ }), {})
    expect(model.assignments).toHaveLength(0)
    expect(model.hiddenTermCount).toBe(1)
    expect(model.freeTermIndex).toBe(1) // term 3 used, 1/2 still free
  })

  it('surfaces a pending (draft-only) row even before a function is picked', () => {
    const model = readRcLogicModel(params({}), { RCL4_SRC: '7' })
    const pending = model.assignments.find((assignment) => assignment.id === 'rcl-4')
    expect(pending).toMatchObject({ channel: 7, functionId: 0 })
    expect(model.freeTermIndex).toBe(1)
  })
})

describe('rcLogic draft mappers', () => {
  it('allocates the free slot on add, or returns null when full', () => {
    const model = readRcLogicModel(params({ RCL1_FUNC: 153, RCL2_FUNC: 18 }), {})
    expect(rcLogicAddDrafts(model, 8)).toEqual({
      RCL3_FUNC: '0',
      RCL3_OPT: '0',
      RCL3_SRC: '8',
      RCL3_MIN: '1700',
      RCL3_MAX: '2100'
    })
    const full = readRcLogicModel(
      params(Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`RCL${i + 1}_FUNC`, 153]))),
      {}
    )
    expect(full.freeTermIndex).toBeNull()
    expect(rcLogicAddDrafts(full, 8)).toBeNull()
  })

  it('folds inverted into OPT bit 3 while preserving other option bits', () => {
    // OPT already has combine=AND (bit2); toggling inverted must keep it.
    const drafts = rcLogicUpdateDrafts(params({ RCL1_OPT: 0b0100 }), {}, 1, { functionId: 22, inverted: true })
    expect(drafts.RCL1_FUNC).toBe('22')
    expect(Number(drafts.RCL1_OPT)).toBe(0b1100) // AND + negate
  })

  it('folds the output position into OPT bits 4-5, preserving and clearing correctly', () => {
    // Set LOW while negate (bit3) is already set — negate must survive.
    expect(Number(rcLogicUpdateDrafts(params({ RCL1_OPT: 0b1000 }), {}, 1, { outputPosition: 'low' }).RCL1_OPT)).toBe(
      0b1000 | (2 << 4)
    )
    // Clearing back to HIGH wipes bits 4-5 but keeps the AND bit.
    expect(
      Number(rcLogicUpdateDrafts(params({ RCL1_OPT: (2 << 4) | 0b0100 }), {}, 1, { outputPosition: 'high' }).RCL1_OPT)
    ).toBe(0b0100)
  })

  it('folds inverted and output position together in a single OPT write', () => {
    const drafts = rcLogicUpdateDrafts(params({ RCL1_OPT: 0b0100 /* AND */ }), {}, 1, {
      inverted: true,
      outputPosition: 'middle'
    })
    expect(Number(drafts.RCL1_OPT)).toBe(0b0100 | 0b1000 | (1 << 4)) // AND + negate + MIDDLE
  })

  it('remove clears the term drafts and disables a live term', () => {
    const live = rcLogicRemovePlan(params({ RCL1_FUNC: 153 }), 1)
    expect(live.clear).toContain('RCL1_FUNC')
    expect(live.disable).toEqual({ RCL1_FUNC: '0' })

    const pending = rcLogicRemovePlan(params({}), 4)
    expect(pending.disable).toEqual({}) // nothing live to disable
  })
})
