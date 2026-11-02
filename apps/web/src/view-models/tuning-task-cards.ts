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
  /** The firmware reports a SmallFastDrone fork feature: show the SFD task. */
  sfdAvailable: boolean
}

/**
 * The Tuning tasks, in the order a tune is worked through: the hover throttle
 * first (the first flight everything else depends on), then noise (Filters,
 * Notches), the gains (Autotune, then PID Gains by hand), and stick feel
 * (Pilot) last. SFD collects SmallFastDrone fork features when the firmware
 * has them; Profiles and Log Tuning are tools for a tune you already have.
 */
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
    sfdAvailable
  } = counts

  const cards: TuningTaskCard[] = [
    {
      // Hover throttle: the first flight a tune depends on. Learned in the air,
      // or measured from a log when the firmware's learner will not run.
      id: 'hover',
      label: 'Hover',
      value: 'flights',
      detail:
        'What throttle this aircraft needs to hold altitude: learned in the air, or measured from a log you have already flown.',
      tone: 'neutral'
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
    // Shown only when the firmware reports a SmallFastDrone fork feature.
    ...(sfdAvailable
      ? [
          {
            id: 'sfd' as const,
            label: 'SFD',
            value: 'fork',
            detail:
              'SmallFastDrone firmware features in one place, current and future: the accelerometer Z-bias, baro thrust (VALT), and the failsafe options the fork extends.',
            tone: 'neutral' as const
          }
        ]
      : []),
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
      id: 'log-tuning',
      label: 'Log Tuning',
      value: 'beta',
      detail:
        'Upload a flight log (.bin) and let the analyzer work through what needs doing — gyro-FFT vibration/oscillation, motor-RPM harmonic-notch placement, and rate-loop limit cycles — then stage the recommended parameter changes for review.',
      tone: 'warning'
    }
  ]

  // Every task for everyone. The strip used to hide PID Gains, Notches,
  // Profiles and Log tuning outside Expert mode; roles pick tabs, not
  // features (operator call 2026-10-21).
  return cards
}
