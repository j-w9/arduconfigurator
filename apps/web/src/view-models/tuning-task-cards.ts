// Tuning task-card summaries for the Tuning view.
//
// Part of the App.tsx view-model decomposition: the per-task summary cards
// (Rates, PID Gains, Filters, Profiles, Review) were built inline in a large
// useMemo. The card text/tone logic is a pure derivation over a handful of
// draft/profile counts, so it is lifted out verbatim. App.tsx now passes the
// counts into `buildTuningTaskCards` and keeps the same memo dependencies.
// Behavior-preserving — no caller-visible change.

import type { TuningTaskCard } from '../views/Tuning'

export interface TuningTaskCardCounts {
  rateInvalidCount: number
  rateStagedCount: number
  rateControlCount: number
  pidInvalidCount: number
  pidStagedCount: number
  pidGainCount: number
  filterInvalidCount: number
  filterStagedCount: number
  filterCount: number
  profileInvalidCount: number
  profileChangedCount: number
  savedProfileCount: number
  reviewInvalidCount: number
  reviewStagedCount: number
}

export function buildTuningTaskCards(counts: TuningTaskCardCounts): TuningTaskCard[] {
  const {
    rateInvalidCount,
    rateStagedCount,
    rateControlCount,
    pidInvalidCount,
    pidStagedCount,
    pidGainCount,
    filterInvalidCount,
    filterStagedCount,
    filterCount,
    profileInvalidCount,
    profileChangedCount,
    savedProfileCount,
    reviewInvalidCount,
    reviewStagedCount
  } = counts

  return [
    {
      id: 'rates',
      label: 'Rates',
      value:
        rateInvalidCount > 0
          ? `${rateInvalidCount} invalid`
          : rateStagedCount > 0
            ? `${rateStagedCount} staged`
            : `${rateControlCount} controls`,
      detail:
        'Flight feel, acceleration shaping, and acro rates stay grouped here so stick response can be tuned quickly without diving into raw parameters.',
      tone: rateInvalidCount > 0 ? 'danger' : rateStagedCount > 0 ? 'warning' : 'neutral'
    },
    {
      id: 'pid-gains',
      label: 'PID Gains',
      value:
        pidInvalidCount > 0
          ? `${pidInvalidCount} invalid`
          : pidStagedCount > 0
            ? `${pidStagedCount} staged`
            : `${pidGainCount} gains`,
      detail:
        'Roll, pitch, and yaw rate gains are exposed as curated ArduPilot P, I, D, and feedforward controls rather than raw controller tables.',
      tone: pidInvalidCount > 0 ? 'danger' : pidStagedCount > 0 ? 'warning' : 'neutral'
    },
    {
      id: 'filters',
      label: 'Filters',
      value:
        filterInvalidCount > 0
          ? `${filterInvalidCount} invalid`
          : filterStagedCount > 0
            ? `${filterStagedCount} staged`
            : `${filterCount} filters`,
      detail:
        'Target, error, and D-term filters stay together so noise-handling changes can be reviewed as one deliberate pass.',
      tone: filterInvalidCount > 0 ? 'danger' : filterStagedCount > 0 ? 'warning' : 'neutral'
    },
    {
      id: 'profiles',
      label: 'Profiles',
      value:
        profileInvalidCount > 0
          ? `${profileInvalidCount} invalid`
          : profileChangedCount > 0
            ? `${profileChangedCount} diff`
            : savedProfileCount > 0
              ? `${savedProfileCount} saved`
              : 'None saved',
      detail:
        savedProfileCount > 0
          ? 'Save known-good tunes locally, restage them later, and keep a small reusable tuning library for similar builds.'
          : 'Capture the live or staged tune into a reusable local profile before making larger experiments.',
      tone:
        profileInvalidCount > 0
          ? 'danger'
          : profileChangedCount > 0
            ? 'warning'
            : savedProfileCount > 0
              ? 'success'
              : 'neutral'
    },
    {
      id: 'review',
      label: 'Review',
      value:
        reviewInvalidCount > 0
          ? `${reviewInvalidCount} invalid`
          : reviewStagedCount > 0
            ? `${reviewStagedCount} staged`
            : 'In sync',
      detail:
        reviewStagedCount > 0
          ? 'Tuning changes are staged locally. Review the grouped diff before writing them to the controller.'
          : reviewInvalidCount > 0
            ? 'Some tuning changes need attention before they can be applied safely.'
            : 'Tuning values are currently in sync with the live controller snapshot.',
      tone: reviewInvalidCount > 0 ? 'danger' : reviewStagedCount > 0 ? 'warning' : 'success'
    }
  ]
}
