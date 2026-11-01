import { describe, expect, it } from 'vitest'

import { buildTuningTaskCards, type TuningTaskCardCounts } from './tuning-task-cards'

function counts(overrides: Partial<TuningTaskCardCounts> = {}): TuningTaskCardCounts {
  return {
    rateInvalidCount: 0,
    rateStagedCount: 0,
    rateControlCount: 5,
    pidInvalidCount: 0,
    pidStagedCount: 0,
    pidGainCount: 9,
    filterInvalidCount: 0,
    filterStagedCount: 0,
    filterCount: 4,
    notchCount: 16,
    notchStagedCount: 0,
    notchInvalidCount: 0,
    autotuneInvalidCount: 0,
    autotuneStagedCount: 0,
    profileInvalidCount: 0,
    profileChangedCount: 0,
    savedProfileCount: 2,
    sfdAvailable: false,
    ...overrides
  }
}

describe('buildTuningTaskCards', () => {
  it('emits the tuning cards in a stable order', () => {
    expect(buildTuningTaskCards(counts()).map((card) => card.id)).toEqual([
      'hover',
      'filters',
      'notches',
      'autotune',
      'pid-gains',
      'rates',
      'profiles',
      'log-tuning'
    ])
  })

  it('rates: invalid beats staged beats the control count, with matching tone', () => {
    const clean = buildTuningTaskCards(counts()).find((card) => card.id === 'rates')!
    expect(clean).toMatchObject({ value: '5 controls', tone: 'neutral' })

    const staged = buildTuningTaskCards(counts({ rateStagedCount: 2 })).find((card) => card.id === 'rates')!
    expect(staged).toMatchObject({ value: '2 staged', tone: 'warning' })

    const invalid = buildTuningTaskCards(counts({ rateInvalidCount: 1, rateStagedCount: 2 })).find((card) => card.id === 'rates')!
    expect(invalid).toMatchObject({ value: '1 invalid', tone: 'danger' })
  })

})

describe('Initial Tune', () => {
  it('is no longer a Tuning task: it moved to Setup, next to the airframe', () => {
    expect(buildTuningTaskCards(counts()).map((card) => card.id)).not.toContain('initial-tune')
  })
})

describe('the Tuning task strip', () => {
  const ids = () => buildTuningTaskCards(counts()).map((card) => card.id)

  it('offers every task to everyone (roles pick tabs, not features)', () => {
    expect(ids()).toEqual([
      'hover',
      'filters',
      'notches',
      'autotune',
      'pid-gains',
      'rates',
      'profiles',
      'log-tuning'
    ])
  })
})

describe('the SFD task', () => {
  const ids = (sfdAvailable: boolean) =>
    buildTuningTaskCards(counts({ sfdAvailable })).map((card) => card.id)
  it('is absent on stock firmware', () => {
    expect(ids(false)).not.toContain('sfd')
  })
  it('appears only when the SmallFastDrone fork is detected, after Pilot', () => {
    expect(ids(true)).toContain('sfd')
    expect(ids(true).indexOf('sfd')).toBe(ids(true).indexOf('rates') + 1)
  })
  it('runs in the order a tune is worked through', () => {
    expect(ids(false)).toEqual(['hover', 'filters', 'notches', 'autotune', 'pid-gains', 'rates', 'profiles', 'log-tuning'])
  })
})
