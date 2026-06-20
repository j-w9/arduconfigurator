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
    profileInvalidCount: 0,
    profileChangedCount: 0,
    savedProfileCount: 2,
    reviewInvalidCount: 0,
    reviewStagedCount: 0,
    ...overrides
  }
}

describe('buildTuningTaskCards', () => {
  it('emits the five tuning cards in a stable order', () => {
    expect(buildTuningTaskCards(counts()).map((card) => card.id)).toEqual([
      'rates',
      'pid-gains',
      'filters',
      'profiles',
      'review'
    ])
  })

  it('rates: invalid beats staged beats the control count, with matching tone', () => {
    const [clean] = buildTuningTaskCards(counts())
    expect(clean).toMatchObject({ value: '5 controls', tone: 'neutral' })

    const [staged] = buildTuningTaskCards(counts({ rateStagedCount: 2 }))
    expect(staged).toMatchObject({ value: '2 staged', tone: 'warning' })

    const [invalid] = buildTuningTaskCards(counts({ rateInvalidCount: 1, rateStagedCount: 2 }))
    expect(invalid).toMatchObject({ value: '1 invalid', tone: 'danger' })
  })

  it('review: in sync by default, warns on staged, danger on invalid', () => {
    const review = (c: TuningTaskCardCounts) => buildTuningTaskCards(c).find((card) => card.label === 'Review')
    expect(review(counts())).toMatchObject({ value: 'In sync', tone: 'success' })
    expect(review(counts({ reviewStagedCount: 3 }))).toMatchObject({ value: '3 staged', tone: 'warning' })
    expect(review(counts({ reviewInvalidCount: 1, reviewStagedCount: 3 }))).toMatchObject({ value: '1 invalid', tone: 'danger' })
  })
})
