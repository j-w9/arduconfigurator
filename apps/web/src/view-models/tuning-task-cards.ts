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
  /** Parameters on the Notches task, which split off Filters. */
  notchCount: number
  notchStagedCount: number
  notchInvalidCount: number
  autotuneInvalidCount: number
  autotuneStagedCount: number
  profileInvalidCount: number
  profileChangedCount: number
  savedProfileCount: number
  reviewInvalidCount: number
  reviewStagedCount: number
  initialTuneStagedCount: number
  /**
   * Expert mode shows every task. Basic mode shows the ones that make up a
   * working tune and hides the three that are tools for someone who already
   * has one — see ADVANCED_TUNING_TASK_IDS.
   */
  isExpertMode: boolean
}

/**
 * Tasks only Expert mode offers.
 *
 * The Tuning tab carried eight tasks in a strip that wrapped onto two rows,
 * which is a lot of front door for one job. These three are not part of
 * getting an airframe flying:
 *
 *  - pid-gains: 27 raw P/I/D/FF controls. Autotune is how a basic-mode
 *    operator gets gains, and it is right there in the same strip.
 *  - profiles: a local library of saved tunes — useful once you HAVE tunes
 *    worth keeping, meaningless before that.
 *  - log-tuning: post-flight log analysis, and still beta.
 *  - notches: the raw notch fields were already Expert-only inside Filters
 *    (basic mode saw only the derived cutoff panel), so splitting them onto
 *    their own task must not hand basic mode a page it never had.
 *
 * What remains is a complete path: Pilot (stick feel), Filters (noise),
 * Autotune (gains), Review (apply), Initial Tune (a starting point for a new
 * airframe). The relative order of those five is unchanged — in particular
 * Initial Tune stays last, for the reason given on its own card below.
 */
export const ADVANCED_TUNING_TASK_IDS = ['pid-gains', 'notches', 'profiles', 'log-tuning'] as const

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
    notchCount,
    notchStagedCount,
    notchInvalidCount,
    autotuneInvalidCount,
    autotuneStagedCount,
    profileInvalidCount,
    profileChangedCount,
    savedProfileCount,
    reviewInvalidCount,
    reviewStagedCount,
    initialTuneStagedCount,
    isExpertMode
  } = counts

  const cards: TuningTaskCard[] = [
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
        'Gyro and rate-loop smoothing: how much noise the controller sees, against the latency a lower cutoff costs. The harmonic notches are their own task.',
      tone: filterInvalidCount > 0 ? 'danger' : filterStagedCount > 0 ? 'warning' : 'neutral'
    },
    {
      // Split off Filters. A low-pass cutoff is a feel-versus-noise judgement;
      // a notch removes one MEASURED frequency and is placed from a log FFT,
      // which is the Log Tuning task in this same strip. Sharing one page put
      // thirty-odd fields in front of an operator doing either job.
      id: 'notches',
      label: 'Notches',
      value:
        notchInvalidCount > 0
          ? `${notchInvalidCount} invalid`
          : notchStagedCount > 0
            ? `${notchStagedCount} staged`
            : `${notchCount} filters`,
      detail:
        'The two harmonic notches and the filter bank — where they sit, what tracks them, and which harmonics they cover. Placed from a flight log rather than by ear.',
      tone: notchInvalidCount > 0 ? 'danger' : notchStagedCount > 0 ? 'warning' : 'neutral'
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

  return isExpertMode
    ? cards
    : cards.filter((card) => !ADVANCED_TUNING_TASK_IDS.some((id) => id === card.id))
}
