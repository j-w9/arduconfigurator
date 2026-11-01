import { describe, expect, it } from 'vitest'

import { deriveThrottleControllerGains } from './throttle-controller-from-hover'

const reader = (values: Record<string, number>) => (id: string) => values[id]

describe('deriveThrottleControllerGains', () => {
  it('4.7 names: P = 0.1 x hover, I = 0.2 x hover', () => {
    const gains = deriveThrottleControllerGains(0.2, reader({ PSC_D_ACC_P: 0.05, PSC_D_ACC_I: 0.1 }))
    expect(gains).toMatchObject({ pParamId: 'PSC_D_ACC_P', iParamId: 'PSC_D_ACC_I', targetP: 0.02, targetI: 0.04, matches: false })
    expect(deriveThrottleControllerGains(0.2, reader({ PSC_D_ACC_P: 0.02, PSC_D_ACC_I: 0.045 }))?.matches).toBe(true)
  })

  it('4.6 names: P = hover, I = 2 x hover (ten times the 4.7 scale)', () => {
    const gains = deriveThrottleControllerGains(0.18, reader({ PSC_ACCZ_P: 0.5, PSC_ACCZ_I: 1 }))
    expect(gains).toMatchObject({ pParamId: 'PSC_ACCZ_P', targetP: 0.18, targetI: 0.36, matches: false })
  })

  it('gives up without a hover throttle or without either parameter pair', () => {
    expect(deriveThrottleControllerGains(0, reader({ PSC_ACCZ_P: 0.5 }))).toBeUndefined()
    expect(deriveThrottleControllerGains(0.2, reader({}))).toBeUndefined()
  })
})
