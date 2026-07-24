// Text for the "link lost — showing the last data received" banner.
//
// Pure builder (the established view-models pattern) so the wording and the
// edge cases — unknown vehicle, a table that had finished downloading, a bogus
// timestamp — are unit-testable without rendering anything.

import type { StaleLinkState } from '@arduconfig/ardupilot-core'

export interface StaleLinkNotice {
  headline: string
  /** Vehicle + parameter counts + when the link dropped. */
  detail: string
  /** Why it matters and what reconnecting does. */
  hint: string
  /** True when the download never finished, so reconnecting resumes it. */
  resumable: boolean
}

function formatClock(sinceMs: number): string {
  if (!Number.isFinite(sinceMs)) {
    return 'link lost'
  }
  try {
    return `lost at ${new Date(sinceMs).toLocaleTimeString()}`
  } catch {
    return 'link lost'
  }
}

export function buildStaleLinkNotice(stale: StaleLinkState): StaleLinkNotice {
  const vehicle = stale.vehicle?.vehicle
  const vehiclePrefix = vehicle && vehicle !== 'Unknown' ? `${vehicle} · ` : ''
  const resumable = stale.total > 0 && stale.downloaded < stale.total
  // A count of 0 total means the FC never reported one — claiming "0/0
  // parameters" would read as a failure that did not happen.
  const counts =
    stale.total > 0
      ? `${stale.downloaded}/${stale.total} parameters received${resumable ? ' (incomplete)' : ''}`
      : `${stale.downloaded} parameter${stale.downloaded === 1 ? '' : 's'} received`

  return {
    headline: 'Link lost — showing the last data received',
    detail: `${vehiclePrefix}${counts} · ${formatClock(stale.sinceMs)}`,
    hint: resumable
      ? 'These values are not live and nothing can be written until the vehicle reconnects. Reconnecting resumes the download where it stopped.'
      : 'These values are not live and nothing can be written until the vehicle reconnects.',
    resumable
  }
}
