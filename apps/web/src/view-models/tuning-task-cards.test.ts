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
    autotuneInvalidCount: 0,
    autotuneStagedCount: 0,
    profileInvalidCount: 0,
    profileChangedCount: 0,
    savedProfileCount: 2,
    initialTuneStagedCount: 0,
    reviewInvalidCount: 0,
    reviewStagedCount: 0,
    ...overrides
  }
}

describe('buildTuningTaskCards', () => {
  it('emits the tuning cards in a stable order', () => {
    expect(buildTuningTaskCards(counts()).map((card) => card.id)).toEqual([
      'rates',
      'pid-gains',
      'filters',
      'autotune',
      'profiles',
      'review',
      'initial-tune',
      'log-tuning'
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

describe('the Initial Tune card', () => {
  it('sits last, because a vehicle passes through it once', () => {
    // Deliberate ordering: it is where a NEW airframe starts, but putting a
    // batch write of a dozen parameters at the front of the Tuning tab invites
    // pressing it on an aircraft that is already tuned.
    const ids = buildTuningTaskCards(counts()).map((card) => card.id)
    expect(ids).toContain('initial-tune')
    // After Review, not before Rates: the ordering is the guard rail.
    expect(ids.indexOf('initial-tune')).toBeGreaterThan(ids.indexOf('review'))
  })

  it('reads as a starting point until something is staged', () => {
    expect(buildTuningTaskCards(counts()).find((card) => card.id === 'initial-tune')).toMatchObject({
      value: 'starting point',
      tone: 'neutral'
    })
    expect(
      buildTuningTaskCards(counts({ initialTuneStagedCount: 7 })).find((card) => card.id === 'initial-tune')
    ).toMatchObject({ value: '7 staged', tone: 'warning' })
  })

  it('says out loud that it sets no PID gains', () => {
    // The single most important thing about this card: someone scanning the
    // Tuning tab must not read "Initial Tune" as "tune it for me".
    const card = buildTuningTaskCards(counts()).find((c) => c.id === 'initial-tune')!
    expect(card.detail).toMatch(/no PID gains/i)
  })
})
