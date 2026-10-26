import { describe, expect, it } from 'vitest'

import { altHoldGainCheck } from './althold-gain-check'

describe('altHoldGainCheck', () => {
  it('4.7: P = 0.1 x hover, I = 0.2 x hover', () => {
    const check = altHoldGainCheck({ hover: 0.25, hoverLearn: 2, accP: 0.025, accI: 0.05, scheme: '4.7' })
    expect(check?.recommendedP).toBe(0.025)
    expect(check?.recommendedI).toBe(0.05)
    expect(check?.tone).toBe('success')
    expect(check?.notes).toEqual([])
  })

  it('4.6: the old names are ten times the scale', () => {
    const check = altHoldGainCheck({ hover: 0.35, hoverLearn: 2, accP: 0.35, accI: 0.7, scheme: '4.6' })
    expect(check?.recommendedP).toBe(0.35)
    expect(check?.tone).toBe('success')
  })

  it('the field case: hover 0.20, P 0.10, I 0.20 is far too hot, with learning off', () => {
    const check = altHoldGainCheck({ hover: 0.2, hoverLearn: 0, accP: 0.1, accI: 0.2, scheme: '4.7' })
    expect(check?.pRatio).toBeCloseTo(5)
    expect(check?.iRatio).toBeCloseTo(5)
    expect(check?.tone).toBe('danger')
    expect(check?.notes.join(' ')).toContain('Hover learning is off')
  })

  it('flags a hover value at the 0.125 floor', () => {
    const check = altHoldGainCheck({ hover: 0.125, hoverLearn: 2, accP: 0.015, accI: 0.03, scheme: '4.7' })
    expect(check?.tone).toBe('success')
    expect(check?.notes.join(' ')).toContain('minimum')
  })

  it('flags I out of proportion to P', () => {
    const check = altHoldGainCheck({ hover: 0.2, hoverLearn: 2, accP: 0.02, accI: 0.4, scheme: '4.7' })
    expect(check?.notes.join(' ')).toContain('I is usually 2 × P')
  })

  it('nothing to say without the params', () => {
    expect(altHoldGainCheck({ hover: undefined, hoverLearn: 2, accP: 0.05, accI: 0.1, scheme: '4.7' })).toBeUndefined()
  })
})
