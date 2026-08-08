import type { PreArmStatusState } from '@arduconfig/ardupilot-core'

/**
 * Pre-arm box view model.
 *
 * Why this exists at all: the Pre-arm box used to be a pure render of the
 * latched `PreArm:` STATUSTEXT list, and an operator reported it staying red for
 * over a minute after the condition had cleared. That is not a UI bug so much as
 * a category error — those texts are a record of what the vehicle last
 * *reported*, and ArduPilot re-reports a failing check at most every
 * PREARM_DISPLAY_PERIOD (30 s, libraries/AP_Arming/AP_Arming.cpp) and says
 * nothing whatsoever when the check starts passing. There is no "cleared"
 * message to wait for, so a latch can never be current.
 *
 * The truthful signal is SYS_STATUS's MAV_SYS_STATUS_PREARM_CHECK health bit,
 * refreshed by the 1 Hz AP_Arming::update() run and streamed to us at 2 Hz. The
 * runtime folds it into `preArmStatus.liveCheck`; this builder decides how to
 * present the two sources together, and in particular never lets a latched text
 * masquerade as a live reading.
 */

/** How the verdict on screen was arrived at. Drives the wording, not the tone. */
export type PreArmStatusSource =
  /** SYS_STATUS pre-arm bit, fresh. The verdict is current to within ~0.5 s. */
  | 'live'
  /**
   * No usable live bit (firmware doesn't report it, ARMING_CHECK=0, or
   * SYS_STATUS has gone quiet) — all we have is the latched report history.
   */
  | 'reported'

export interface PreArmIssueRowViewModel {
  text: string
  /** e.g. "reported 42s ago" — always rendered, so a latch can't read as live. */
  ageLabel: string
}

export interface PreArmStatusViewModel {
  healthy: boolean
  source: PreArmStatusSource
  tone: 'success' | 'warning'
  /** Short badge text for the box titlebar. */
  badgeLabel: string
  /** One-line explanation under the badge. Always present. */
  summary: string
  issues: PreArmIssueRowViewModel[]
}

export interface PreArmStatusViewModelInputs {
  preArmStatus: PreArmStatusState
  /** Injected so the age labels are testable against a synthetic timeline. */
  nowMs: number
}

/**
 * Human age for a report timestamp. Deliberately coarse — the point is to stop
 * the reader trusting an old line, not to be a stopwatch.
 */
function formatAge(ageMs: number): string {
  const seconds = Math.max(0, Math.round(ageMs / 1000))
  if (seconds < 60) {
    return `${seconds}s ago`
  }
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) {
    return `${minutes}m ago`
  }
  return `${Math.floor(minutes / 60)}h ago`
}

export function buildPreArmStatusViewModel({
  preArmStatus,
  nowMs
}: PreArmStatusViewModelInputs): PreArmStatusViewModel {
  const { liveCheck } = preArmStatus
  // `present` without `enabled` means ArduPilot compiled arming in but
  // ARMING_CHECK is 0, so the health bit is hardcoded-meaningless rather than
  // informative — treat it exactly like no signal at all.
  const liveVerdictUsable = liveCheck !== undefined && liveCheck.present && liveCheck.enabled
  const source: PreArmStatusSource = liveVerdictUsable ? 'live' : 'reported'
  const healthy = preArmStatus.healthy

  const issues = preArmStatus.issues.map((issue) => ({
    text: issue.text,
    ageLabel: `reported ${formatAge(nowMs - issue.lastSeenAtMs)}`
  }))

  return {
    healthy,
    source,
    tone: healthy ? 'success' : 'warning',
    // "Blocked" covers the live-failing-but-unexplained case, where the old
    // "0 issues" would have read as a pass.
    badgeLabel: healthy ? 'Clear' : issues.length === 0 ? 'Blocked' : `${issues.length} issue${issues.length === 1 ? '' : 's'}`,
    summary: buildSummary({ healthy, source, issueCount: issues.length }),
    issues
  }
}

function buildSummary({
  healthy,
  source,
  issueCount
}: {
  healthy: boolean
  source: PreArmStatusSource
  issueCount: number
}): string {
  if (source === 'live') {
    if (healthy) {
      // Said explicitly because "no issues listed" and "the vehicle says it is
      // happy" are very different claims and only the second is worth acting on.
      return 'Vehicle reports pre-arm checks passing.'
    }
    if (issueCount === 0) {
      // The failing case with no text yet. Honest about the wait rather than
      // implying we are hiding something: ArduPilot batches the reasons.
      return 'Vehicle reports pre-arm checks failing. Waiting for it to name the reason (it re-sends at most every 30s).'
    }
    return 'Vehicle reports pre-arm checks failing. Last reported reasons:'
  }
  if (issueCount === 0) {
    // No live bit and nothing latched. We genuinely do not know, and saying
    // "Clear" unqualified would be the same overclaim we just fixed.
    return 'No pre-arm failures reported. Live pre-arm status is not being published by this vehicle.'
  }
  return 'Last reported pre-arm failures. The vehicle is not publishing live pre-arm status, so these may already be resolved.'
}
