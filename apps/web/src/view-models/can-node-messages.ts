// Node messages on the CAN tab: what DroneCAN nodes say about themselves
// (uavcan.protocol.debug.LogMessage) -- the bus's Recent Notices. Same shape
// as the main page's: repeats folded with a count, the serious ones first;
// with DroneCAN's four levels (DEBUG / INFO / WARNING / ERROR) and the node
// that sent each. Pure.

export type CanLogLevel = 'debug' | 'info' | 'warning' | 'error'

export interface CanNodeLogEntry {
  atMs: number
  nodeId: number
  level: CanLogLevel
  /** The node's own source tag (often empty). */
  source: string
  text: string
}

/** LogLevel.value (uavcan.protocol.debug.LogLevel: DEBUG 0, INFO 1, WARNING 2, ERROR 3). */
export function canLogLevel(value: number): CanLogLevel {
  return value >= 3 ? 'error' : value === 2 ? 'warning' : value === 1 ? 'info' : 'debug'
}

const bytesToText = (bytes: unknown): string =>
  Array.isArray(bytes) ? String.fromCharCode(...bytes.filter((byte): byte is number => typeof byte === 'number')).trim() : ''

/** A LogMessage's decoded value as an entry, or undefined if it is not one. */
export function canLogEntryFromValue(
  value: { [field: string]: unknown } | undefined,
  nodeId: number,
  atMs: number
): CanNodeLogEntry | undefined {
  if (!value) return undefined
  const level = (value.level as { value?: unknown } | undefined)?.value
  const text = bytesToText(value.text)
  if (text === '') return undefined
  return { atMs, nodeId, level: canLogLevel(typeof level === 'number' ? level : 0), source: bytesToText(value.source), text }
}

export interface CoalescedCanLog {
  nodeId: number
  level: CanLogLevel
  source: string
  text: string
  count: number
  lastAtMs: number
}

export interface CanNodeMessagesModel {
  /** Warnings and errors, most severe then most recent first. */
  attention: CoalescedCanLog[]
  /** Info and debug. */
  info: CoalescedCanLog[]
  total: number
}

const RANK: Record<CanLogLevel, number> = { error: 0, warning: 1, info: 2, debug: 3 }

export function buildCanNodeMessages(
  entries: readonly CanNodeLogEntry[],
  options: { nodeId?: number; filter?: string; showDebug?: boolean } = {}
): CanNodeMessagesModel {
  const filter = options.filter?.trim().toLowerCase() ?? ''
  const byKey = new Map<string, CoalescedCanLog>()
  let total = 0
  for (const entry of entries) {
    if (options.nodeId !== undefined && entry.nodeId !== options.nodeId) continue
    if (entry.level === 'debug' && !options.showDebug) continue
    if (filter && !`${entry.text} ${entry.source}`.toLowerCase().includes(filter)) continue
    total += 1
    const key = `${entry.nodeId}|${entry.level}|${entry.text}`
    const existing = byKey.get(key)
    if (existing) {
      existing.count += 1
      existing.lastAtMs = Math.max(existing.lastAtMs, entry.atMs)
    } else {
      byKey.set(key, { nodeId: entry.nodeId, level: entry.level, source: entry.source, text: entry.text, count: 1, lastAtMs: entry.atMs })
    }
  }
  const sorted = [...byKey.values()].sort((a, b) => RANK[a.level] - RANK[b.level] || b.lastAtMs - a.lastAtMs)
  return {
    attention: sorted.filter((entry) => entry.level === 'error' || entry.level === 'warning'),
    info: sorted.filter((entry) => entry.level === 'info' || entry.level === 'debug'),
    total
  }
}

/**
 * AP_Periph's answer to FLASH_BOOTLOADER = 1 (Tools/AP_Periph/can.cpp): it
 * logs one of these once the copy is done. Undefined for any other line.
 */
export function bootloaderFlashOutcome(text: string): { ok: boolean; message: string } | undefined {
  const line = text.trim()
  if (/^Flash bootloader OK/i.test(line)) return { ok: true, message: 'Bootloader flashed.' }
  if (/^Bootloader unchanged/i.test(line)) return { ok: true, message: 'Bootloader unchanged: it is already up to date.' }
  if (/^Bootloader not signed/i.test(line)) return { ok: false, message: 'Refused: the embedded bootloader is not signed.' }
  if (/^Flash bootloader FAILED/i.test(line)) return { ok: false, message: 'Bootloader flash FAILED. Do not power the node off; try again.' }
  return undefined
}

/**
 * The same node lines as relayed by the autopilot: with CAN_LOGLEVEL on, the
 * FC re-sends each LogMessage it hears as a STATUSTEXT "CAN[<node>] <text>"
 * (AP_DroneCAN::handle_debug). A second route for a line whose frames did
 * not make it through forwarding -- the bootloader result among them.
 */
export function canLogEntriesFromStatusTexts(
  statusTexts: readonly { severity: 'info' | 'warning' | 'error'; text: string; receivedAtMs?: number }[]
): CanNodeLogEntry[] {
  const entries: CanNodeLogEntry[] = []
  for (const status of statusTexts) {
    const match = /^CAN\[(\d+)\]\s+(.+)$/s.exec(status.text.trim())
    if (!match || status.receivedAtMs === undefined) continue
    entries.push({ atMs: status.receivedAtMs, nodeId: Number(match[1]), level: status.severity, source: '', text: match[2].trim() })
  }
  return entries
}

/**
 * The bus's own lines plus the FC-relayed ones, oldest first; a relayed line
 * the bus also delivered (same node and text, within a few seconds) once.
 */
export function mergeCanNodeLogs(
  fromBus: readonly CanNodeLogEntry[],
  relayed: readonly CanNodeLogEntry[],
  sinceMs = 0
): readonly CanNodeLogEntry[] {
  const extra = relayed.filter(
    (entry) =>
      entry.atMs >= sinceMs &&
      !fromBus.some((own) => own.nodeId === entry.nodeId && own.text === entry.text && Math.abs(own.atMs - entry.atMs) < 5000)
  )
  if (extra.length === 0) return fromBus
  return [...fromBus, ...extra].sort((a, b) => a.atMs - b.atMs)
}
