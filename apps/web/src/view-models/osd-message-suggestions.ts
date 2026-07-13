// Suggestions for the OSD shorthand editor's "from" field. The firmware matches
// `from` as a case-insensitive SUBSTRING of a MESSAGE, so the most useful values
// are short fragments/prefixes (≤15 chars) that abbreviate a whole class of
// messages. We offer these as datalist hints while keeping the field free-text.

/** Common ArduPilot MESSAGE-panel strings / prefixes worth abbreviating. Short
 *  enough (≤15 chars) to drop straight into a `from` field. */
export const COMMON_OSD_MESSAGE_SUGGESTIONS: readonly string[] = [
  'PreArm:',
  'Arm:',
  'Arming motors',
  'Disarm',
  'GPS',
  'GPS Glitch',
  'Compass',
  'Throttle',
  'Battery',
  'Low Battery',
  'EKF',
  'Baro',
  'Gyro',
  'Accel',
  'Radio Failsafe',
  'Fence',
  'Mode',
  'Calibrat',
  'RC'
]

/**
 * Datalist suggestions for a shorthand `from` field: the curated common
 * fragments first (directly usable), then messages the FC has actually sent
 * this session (so the operator can abbreviate something they just saw).
 * Deduped case-insensitively; blanks dropped.
 */
export function buildOsdMessageSuggestions(
  liveMessages: readonly string[],
  curated: readonly string[] = COMMON_OSD_MESSAGE_SUGGESTIONS
): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const candidate of [...curated, ...liveMessages]) {
    const trimmed = candidate.trim()
    if (!trimmed) {
      continue
    }
    const key = trimmed.toLowerCase()
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    out.push(trimmed)
  }
  return out
}
