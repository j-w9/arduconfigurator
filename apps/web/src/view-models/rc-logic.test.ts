import { describe, expect, it } from 'vitest'

import type { ParameterState } from '@arduconfig/ardupilot-core'

import {
  rcLogicAddDrafts,
  rcLogicAddLogicTermDrafts,
  rcLogicRemovePlan,
  rcLogicUpdateDrafts,
  rcLogicUpdateLogicTermDrafts,
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
    expect(model.logicTerms).toHaveLength(0)
  })

  it('reads the negate bit as inverted', () => {
    const model = readRcLogicModel(params({ RCL2_FUNC: 18, RCL2_OPT: 0b1000, RCL2_SRC: 6 }), {})
    expect(model.assignments[0]).toMatchObject({ id: 'rcl-2', inverted: true, functionId: 18 })
  })

  it('reads level mode (OPT bit 4) + zero-based level index (bits 5-7) for VTX power', () => {
    const read = (opt: number) => {
      const a = readRcLogicModel(params({ RCL1_FUNC: 94, RCL1_OPT: opt, RCL1_SRC: 6 }), {}).assignments[0]
      return { levelMode: a.levelMode, outputLevel: a.outputLevel }
    }
    expect(read(0)).toEqual({ levelMode: false, outputLevel: 0 }) // no level mode
    expect(read(0x10)).toEqual({ levelMode: true, outputLevel: 0 }) // mode bit, index 0
    expect(read(0x10 | (1 << 5))).toEqual({ levelMode: true, outputLevel: 1 })
    expect(read(0x10 | (3 << 5))).toEqual({ levelMode: true, outputLevel: 3 })
  })

  it('surfaces a link term in logicTerms (not the channel assignments)', () => {
    const model = readRcLogicModel(params({ RCL3_FUNC: 16, RCL3_OPT: 1 /* link */, RCL3_SRC: 11 }), {})
    expect(model.assignments).toHaveLength(0)
    expect(model.logicTerms).toHaveLength(1)
    expect(model.logicTerms[0]).toMatchObject({ id: 'rcl-3', sourceType: 'link', functionId: 16, sourceValue: 11 })
    expect(model.freeTermIndex).toBe(1) // term 3 used, 1/2 still free
  })

  it('surfaces a condition term with its condition id', () => {
    const model = readRcLogicModel(params({ RCL2_FUNC: 94, RCL2_OPT: 2 /* condition */, RCL2_SRC: 0 /* RC failsafe */ }), {})
    expect(model.logicTerms[0]).toMatchObject({ id: 'rcl-2', sourceType: 'condition', functionId: 94, sourceValue: 0 })
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

  it('rounds fractional MIN/MAX to integers (Int16 params must match the FC readback)', () => {
    // A band drag can produce a fractional PWM; staging it verbatim would never
    // confirm against the Int16 the FC stores, timing out the verified write.
    const drafts = rcLogicUpdateDrafts(params({}), {}, 1, {
      lowPwm: 1289.9074734910278,
      highPwm: 1689.9074734910278
    })
    expect(drafts.RCL1_MIN).toBe('1290')
    expect(drafts.RCL1_MAX).toBe('1690')
  })

  it('folds inverted into OPT bit 3 while preserving other option bits', () => {
    // OPT already has combine=AND (bit2); toggling inverted must keep it.
    const drafts = rcLogicUpdateDrafts(params({ RCL1_OPT: 0b0100 }), {}, 1, { functionId: 22, inverted: true })
    expect(drafts.RCL1_FUNC).toBe('22')
    expect(Number(drafts.RCL1_OPT)).toBe(0b1100) // AND + negate
  })

  it('folds level mode + index into OPT bit 4 and bits 5-7, preserving other bits', () => {
    // Select level index 2 while negate (bit 3) is set — negate must survive.
    expect(
      Number(rcLogicUpdateDrafts(params({ RCL1_OPT: 0b1000 }), {}, 1, { levelMode: true, outputLevel: 2 }).RCL1_OPT)
    ).toBe(0b1000 | 0x10 | (2 << 5))
    // Clearing level mode wipes bit 4 + bits 5-7 but keeps the AND bit.
    expect(
      Number(rcLogicUpdateDrafts(params({ RCL1_OPT: 0x10 | (2 << 5) | 0b0100 }), {}, 1, { levelMode: false }).RCL1_OPT)
    ).toBe(0b0100)
  })

  it('folds inverted and level selection together in a single OPT write', () => {
    const drafts = rcLogicUpdateDrafts(params({ RCL1_OPT: 0b0100 /* AND */ }), {}, 1, {
      inverted: true,
      levelMode: true,
      outputLevel: 1
    })
    expect(Number(drafts.RCL1_OPT)).toBe(0b0100 | 0b1000 | 0x10 | (1 << 5)) // AND + negate + level mode + idx 1
  })

  it('clears the level field when the row switches to a non-level-select function', () => {
    // Row currently VTX Power (94) with level index 2 + AND bit; switch to AUTO
    // Mode (16, on/off) — the level field must clear so AUTO Mode doesn't inherit
    // selector mode, but the AND bit survives.
    const drafts = rcLogicUpdateDrafts(params({ RCL1_FUNC: 94, RCL1_OPT: 0x10 | (2 << 5) | 0b0100 }), {}, 1, {
      functionId: 16
    })
    expect(drafts.RCL1_FUNC).toBe('16')
    expect(Number(drafts.RCL1_OPT)).toBe(0b0100) // level field wiped, AND kept
  })

  it('keeps the level field when switching between level-select functions', () => {
    // Staying on VTX Power (94) — no OPT rewrite needed just from re-selecting it.
    const drafts = rcLogicUpdateDrafts(params({ RCL1_FUNC: 94, RCL1_OPT: 0x10 | (2 << 5) }), {}, 1, { functionId: 94 })
    expect(drafts.RCL1_FUNC).toBe('94')
    expect(drafts.RCL1_OPT).toBeUndefined() // no level change → no redundant OPT draft
  })

  it('adds a condition logic term on the free slot (RC failsafe, no function)', () => {
    const model = readRcLogicModel(params({ RCL1_FUNC: 153 }), {})
    expect(rcLogicAddLogicTermDrafts(model)).toEqual({
      RCL2_FUNC: '0',
      RCL2_OPT: '2', // condition source type
      RCL2_SRC: '0' // condition 0 = RC failsafe
    })
    const full = readRcLogicModel(
      params(Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`RCL${i + 1}_FUNC`, 153]))),
      {}
    )
    expect(rcLogicAddLogicTermDrafts(full)).toBeNull()
  })

  it('logic-term update writes source type / value / function and folds OPT', () => {
    // Condition term; set the target function to VTX Power and pick a condition.
    const drafts = rcLogicUpdateLogicTermDrafts(params({ RCL1_OPT: 2 /* condition */ }), {}, 1, {
      functionId: 94,
      sourceValue: 1 // battery failsafe
    })
    expect(drafts.RCL1_FUNC).toBe('94')
    expect(drafts.RCL1_SRC).toBe('1')

    // Flip condition -> link: OPT source-type bits change AND SRC resets (the
    // value spaces differ — condition id vs watched function).
    const flipped = rcLogicUpdateLogicTermDrafts(params({ RCL1_OPT: 2, RCL1_SRC: 3 }), {}, 1, { sourceType: 'link' })
    expect(Number(flipped.RCL1_OPT) & 0x3).toBe(1) // link
    expect(flipped.RCL1_SRC).toBe('0')
  })

  it('remove clears the term drafts and disables a live term', () => {
    const live = rcLogicRemovePlan(params({ RCL1_FUNC: 153 }), 1)
    expect(live.clear).toContain('RCL1_FUNC')
    expect(live.disable).toEqual({ RCL1_FUNC: '0' })

    const pending = rcLogicRemovePlan(params({}), 4)
    expect(pending.disable).toEqual({}) // nothing live to disable
  })
})
