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
  autotuneInvalidCount: number
  autotuneStagedCount: number
  profileInvalidCount: number
  profileChangedCount: number
  savedProfileCount: number
  reviewInvalidCount: number
  reviewStagedCount: number
  initialTuneStagedCount: number
  filtersFromGyroStagedCount: number
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
    autotuneInvalidCount,
    autotuneStagedCount,
    profileInvalidCount,
    profileChangedCount,
    savedProfileCount,
    reviewInvalidCount,
    reviewStagedCount,
    initialTuneStagedCount,
    filtersFromGyroStagedCount
  } = counts

  return [
    {
      id: 'rates',
      label: 'Pilot',
      value:
        rateInvalidCount > 0
          ? `${rateInvalidCount} invalid`
          : rateStagedCount > 0
            ? `${rateStagedCount} staged`
            : `${rateControlCount} controls`,
      detail:
        'Everything that shapes manual flight feel — angle, acro rates, alt-hold climb speeds, and loiter — grouped here (not the PID gains) so stick response can be tuned without diving into raw parameters.',
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
      id: 'autotune',
      label: 'Autotune',
      value:
        autotuneInvalidCount > 0
          ? `${autotuneInvalidCount} invalid`
          : autotuneStagedCount > 0
            ? `${autotuneStagedCount} staged`
            : 'Setup',
      detail:
        'Configure ArduPilot AUTOTUNE (axes, aggressiveness, min-D, gain-margin) here, then run it in the air — the automated tuning itself happens in flight.',
      tone: autotuneInvalidCount > 0 ? 'danger' : autotuneStagedCount > 0 ? 'warning' : 'neutral'
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
    },
    {
      // Sits beside Filters, which edits the same nine parameters by hand.
      // This one derives them, so the two are the same surface at different
      // altitudes rather than duplicates.
      id: 'filters-from-gyro',
      label: 'Filter Editor',
      value: filtersFromGyroStagedCount > 0 ? `${filtersFromGyroStagedCount} staged` : 'derive',
      detail:
        'Every filter parameter in one place — gyro, rate loop and harmonic notch. Values are set by hand; the only suggestions offered are the two ArduPilot documents.',
      tone: filtersFromGyroStagedCount > 0 ? 'warning' : 'neutral'
    },
    {
      // First in intent, last in the list on purpose: it is where a NEW
      // airframe starts, but a vehicle only passes through it once, and
      // putting a batch-write of a dozen parameters at the front of the
      // Tuning tab invites pressing it on an aircraft that is already tuned.
      id: 'initial-tune',
      label: 'Initial Tune',
      value: initialTuneStagedCount > 0 ? `${initialTuneStagedCount} staged` : 'starting point',
      detail:
        'Work out a sane starting point from the airframe — prop size, battery cells and chemistry — and stage the filter, acceleration, thrust-curve and battery-voltage parameters that follow from it. Uses the same formulas as Mission Planner’s Initial Parameters screen. Sets no PID gains.',
      tone: initialTuneStagedCount > 0 ? 'warning' : 'neutral'
    },
    {
      id: 'log-tuning',
      label: 'Log Tuning',
      value: 'beta',
      detail:
        'Upload a flight log (.bin) and let the analyzer work through what needs doing — gyro-FFT vibration/oscillation, motor-RPM harmonic-notch placement, and rate-loop limit cycles — then stage the recommended parameter changes for review.',
      tone: 'warning'
    }
  ]
}
