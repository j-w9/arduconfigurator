// Suggestions for the OSD shorthand editor's "from" field. The editor's combobox
// searches full firmware messages (OsdCatalogEntry.label) and, on select, inserts
// the ≤15-char substring key (OsdCatalogEntry.from) that the firmware matches
// case-insensitively against a MESSAGE. The field stays free-text.

import { OSD_MESSAGE_CATALOG, type OsdCatalogEntry } from './osd-message-catalog.generated'

export type { OsdCatalogEntry }

/**
 * ≤15-char substring key from a message, mirroring the generator's fromKey (minus
 * the C-string unescaping — live/typed messages are already decoded). Cuts at the
 * first real `%` format arg (%% literal), tidies, then truncates on a word/`:`/`(`
 * boundary so keys stay ≤15 (FROM_LEN=16 incl. NUL).
 */
export function toFromKey(message: string): string {
  let s = message
  let cut = -1
  for (let i = 0; i < s.length; i += 1) {
    if (s[i] === '%') {
      if (s[i + 1] === '%') {
        i += 1
        continue
      }
      cut = i
      break
    }
  }
  if (cut >= 0) s = s.slice(0, cut)
  s = s.replace(/%%/g, '%').replace(/\s+/g, ' ').trim().replace(/[\s,:\-(]+$/, '')
  if (s.length <= 15) return s
  let k = s.slice(0, 15)
  let back = -1
  for (let i = k.length - 1; i >= 4; i -= 1) {
    if (k[i] === ' ' || k[i] === ':' || k[i] === '(') {
      back = i
      break
    }
  }
  if (back >= 4) k = k.slice(0, back)
  return k.trim().replace(/[\s,:\-(]+$/, '')
}

/** A few everyday fragments surfaced FIRST, as label===from entries. */
const FAVORITES: readonly OsdCatalogEntry[] = [
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
].map((text) => ({ label: text, from: text }))

/**
 * The combobox's entry list: favorites first, then the source-derived catalog,
 * then messages the FC has actually sent this session. Deduped by `from` (one
 * entry per shorthand key, keeping the first — favorite/alphabetically-first
 * label), blanks dropped.
 */
export function buildOsdMessageSuggestions(liveMessages: readonly string[]): OsdCatalogEntry[] {
  const live = liveMessages.map((text) => ({ label: text.trim(), from: toFromKey(text) }))
  const seen = new Set<string>()
  const out: OsdCatalogEntry[] = []
  for (const entry of [...FAVORITES, ...OSD_MESSAGE_CATALOG, ...live]) {
    if (!entry.from || !entry.label) {
      continue
    }
    const key = entry.from.toLowerCase()
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    out.push(entry)
  }
  return out
}
