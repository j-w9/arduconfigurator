import { describe, expect, it } from 'vitest'

import { propsOutChoice, propsOutFrameType } from './frame-props-out'

describe('propsOutChoice', () => {
  it('is offered on a quad X, unchecked', () => {
    expect(propsOutChoice(1, 1)).toEqual({ offered: true, checked: false })
  })

  it('is offered and checked on Betaflight X Reversed', () => {
    expect(propsOutChoice(1, 18)).toEqual({ offered: true, checked: true })
  })

  it('is not offered for other quad types or other classes', () => {
    expect(propsOutChoice(1, 3).offered).toBe(false) // H
    expect(propsOutChoice(1, 12).offered).toBe(false) // Betaflight X
    expect(propsOutChoice(2, 1).offered).toBe(false) // hexa X
    expect(propsOutChoice(undefined, 1).offered).toBe(false)
  })
})

describe('propsOutFrameType', () => {
  it('stages Betaflight X Reversed for props out and X for props in', () => {
    expect(propsOutFrameType(true)).toBe(18)
    expect(propsOutFrameType(false)).toBe(1)
  })
})
