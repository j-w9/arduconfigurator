// Pure view-model helpers for the read-only MAVLink inspector. The hook
// (use-mavlink-inspector) owns accumulation; these functions shape its stats
// for display — summary, filter, sort, field rendering, copy-to-clipboard JSON,
// and the per-row rate sparkline geometry. Unit-tested off the runtime.

import type { MavlinkMessageStat } from '../hooks/use-mavlink-inspector'

export type MavlinkSortKey = 'name' | 'rate' | 'recent' | 'bandwidth'

export interface MavlinkInspectorSummary {
  /** Distinct (source, type) rows seen this session. */
  typeCount: number
  /** Distinct message sources (systemId:componentId) seen this session. */
  sourceCount: number
  /** Combined messages/sec across every row, over the trailing window. */
  totalRateHz: number
  /** Combined on-the-wire bytes/sec across every row, over the window. */
  totalBytesPerSec: number
  /** Combined lifetime message count across every row. */
  totalCount: number
}

export function summarizeMavlinkStats(stats: readonly MavlinkMessageStat[]): MavlinkInspectorSummary {
  let totalRateHz = 0
  let totalBytesPerSec = 0
  let totalCount = 0
  const sources = new Set<string>()
  for (const stat of stats) {
    totalRateHz += stat.rateHz
    totalBytesPerSec += stat.bytesPerSec
    totalCount += stat.count
    sources.add(`${stat.systemId}:${stat.componentId}`)
  }
  return {
    typeCount: stats.length,
    sourceCount: sources.size,
    totalRateHz,
    totalBytesPerSec,
    totalCount
  }
}

/** Filter by message type (case-insensitive substring on the type name). */
export function filterMavlinkStats(
  stats: readonly MavlinkMessageStat[],
  filter: string
): MavlinkMessageStat[] {
  const needle = filter.trim().toLowerCase()
  if (!needle) {
    return [...stats]
  }
  return stats.filter((stat) => stat.type.toLowerCase().includes(needle))
}

/** Narrow to a single source `${systemId}:${componentId}`; `''` keeps all. */
export function filterMavlinkStatsBySource(
  stats: readonly MavlinkMessageStat[],
  sourceId: string
): MavlinkMessageStat[] {
  if (!sourceId) {
    return [...stats]
  }
  return stats.filter((stat) => `${stat.systemId}:${stat.componentId}` === sourceId)
}

/**
 * Friendly role name for a MAVLink component id, drawn from the common.xml
 * MAV_COMPONENT enum (ranges collapsed to a role). Best-effort and cosmetic —
 * unrecognised ids fall back to `comp N`.
 */
export function mavlinkComponentLabel(componentId: number): string {
  if (componentId === 0) return 'broadcast'
  if (componentId === 1) return 'autopilot'
  if (componentId === 68) return 'telem radio'
  if (componentId >= 25 && componentId <= 99) return 'user'
  if (componentId >= 100 && componentId <= 119) return 'camera'
  if (componentId >= 140 && componentId <= 153) return 'servo'
  if (componentId === 154 || (componentId >= 171 && componentId <= 175)) return 'gimbal'
  if (componentId === 156) return 'ADS-B'
  if (componentId === 158) return 'peripheral'
  if (componentId === 159) return 'FLARM'
  if (componentId === 160) return 'OSD'
  if (componentId === 190) return 'GCS'
  if (componentId >= 191 && componentId <= 194) return 'companion'
  if (componentId === 195) return 'path planner'
  if (componentId === 196) return 'avoidance'
  if (componentId === 197) return 'odometry'
  if (componentId >= 200 && componentId <= 202) return 'IMU'
  if (componentId >= 220 && componentId <= 221) return 'GPS'
  if (componentId >= 240 && componentId <= 242) return 'bridge'
  if (componentId >= 250 && componentId <= 253) return 'system control'
  return `comp ${componentId}`
}

/** Source identity + display label, e.g. "1:1 · autopilot". */
export interface MavlinkSource {
  /** `${systemId}:${componentId}` — stable selector value. */
  id: string
  systemId: number
  componentId: number
  /** "1:1 · autopilot" style label. */
  label: string
}

export function describeMavlinkSource(systemId: number, componentId: number): MavlinkSource {
  return {
    id: `${systemId}:${componentId}`,
    systemId,
    componentId,
    label: `${systemId}:${componentId} · ${mavlinkComponentLabel(componentId)}`
  }
}

/** Distinct sources present in the stats, sorted by systemId then componentId. */
export function listMavlinkSources(stats: readonly MavlinkMessageStat[]): MavlinkSource[] {
  const seen = new Map<string, MavlinkSource>()
  for (const stat of stats) {
    const source = describeMavlinkSource(stat.systemId, stat.componentId)
    if (!seen.has(source.id)) {
      seen.set(source.id, source)
    }
  }
  return [...seen.values()].sort(
    (left, right) => left.systemId - right.systemId || left.componentId - right.componentId
  )
}

export interface MavlinkSourceGroup extends MavlinkSource {
  stats: MavlinkMessageStat[]
  /** Combined msg/s across the group's rows. */
  rateHz: number
  /** Combined bytes/s across the group's rows. */
  bytesPerSec: number
}

/**
 * Bucket stats under their source, preserving the order of the (already
 * sorted/filtered) input within each group. Groups are ordered by systemId
 * then componentId so the autopilot leads and peripherals follow.
 */
export function groupMavlinkStatsBySource(stats: readonly MavlinkMessageStat[]): MavlinkSourceGroup[] {
  const groups = new Map<string, MavlinkSourceGroup>()
  for (const stat of stats) {
    const source = describeMavlinkSource(stat.systemId, stat.componentId)
    let group = groups.get(source.id)
    if (!group) {
      group = { ...source, stats: [], rateHz: 0, bytesPerSec: 0 }
      groups.set(source.id, group)
    }
    group.stats.push(stat)
    group.rateHz += stat.rateHz
    group.bytesPerSec += stat.bytesPerSec
  }
  return [...groups.values()].sort(
    (left, right) => left.systemId - right.systemId || left.componentId - right.componentId
  )
}

/** Human bandwidth label: "812 B/s", "1.4 kB/s", "2.1 MB/s". */
export function formatBytesPerSec(bytesPerSec: number): string {
  if (!Number.isFinite(bytesPerSec) || bytesPerSec <= 0) {
    return '0 B/s'
  }
  if (bytesPerSec < 1024) {
    return `${Math.round(bytesPerSec)} B/s`
  }
  if (bytesPerSec < 1024 * 1024) {
    return `${(bytesPerSec / 1024).toFixed(1)} kB/s`
  }
  return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`
}

export function sortMavlinkStats(
  stats: readonly MavlinkMessageStat[],
  key: MavlinkSortKey
): MavlinkMessageStat[] {
  const sorted = [...stats]
  switch (key) {
    case 'rate':
      sorted.sort((left, right) => right.rateHz - left.rateHz || left.type.localeCompare(right.type))
      break
    case 'bandwidth':
      sorted.sort((left, right) => right.bytesPerSec - left.bytesPerSec || left.type.localeCompare(right.type))
      break
    case 'recent':
      sorted.sort((left, right) => right.lastSeenMs - left.lastSeenMs || left.type.localeCompare(right.type))
      break
    case 'name':
    default:
      sorted.sort((left, right) => left.type.localeCompare(right.type))
      break
  }
  return sorted
}

export interface MavlinkFieldRow {
  key: string
  /** Display string (rounded floats, flattened arrays, JSON objects). */
  value: string
  /** Coarse value kind for the table's type column. */
  type: MavlinkFieldType
  /** True when the raw value is a single number worth plotting over time. */
  plottable: boolean
}

export type MavlinkFieldType =
  | 'int'
  | 'float'
  | 'uint64'
  | 'bool'
  | 'string'
  | 'array'
  | 'object'
  | 'empty'

/** Coarse value kind for the field table's type column. */
export function formatMavlinkFieldType(value: unknown): MavlinkFieldType {
  if (value === null || value === undefined) return 'empty'
  if (typeof value === 'bigint') return 'uint64'
  if (typeof value === 'number') return Number.isInteger(value) ? 'int' : 'float'
  if (typeof value === 'boolean') return 'bool'
  if (Array.isArray(value)) return 'array'
  if (typeof value === 'object') return 'object'
  return 'string'
}

/** True when a field carries a single finite number worth plotting. */
export function isPlottableFieldValue(value: unknown): boolean {
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value === 'bigint') return true
  if (typeof value === 'boolean') return true
  return false
}

/** Coerce a plottable field value to a number (bool→0/1, bigint→Number),
 *  or undefined when it isn't plottable. */
export function toPlottableNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value === 'bigint') return Number(value)
  if (typeof value === 'boolean') return value ? 1 : 0
  return undefined
}

/** Render a single decoded field value: round floats, stringify bigints,
 *  flatten small arrays, and JSON the rest. Falls back to raw for anything
 *  exotic so nothing is ever hidden. */
export function formatMavlinkFieldValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '—'
  }
  if (typeof value === 'bigint') {
    return value.toString()
  }
  if (typeof value === 'number') {
    if (Number.isInteger(value)) {
      return String(value)
    }
    return value.toFixed(4).replace(/\.?0+$/, '')
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false'
  }
  if (Array.isArray(value)) {
    return `[${value.map(formatMavlinkFieldValue).join(', ')}]`
  }
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value, (_key, inner) => (typeof inner === 'bigint' ? inner.toString() : inner))
    } catch {
      return String(value)
    }
  }
  return String(value)
}

/** Build label/value rows for a decoded message, dropping the synthetic
 *  `type` discriminator (it's already the row header). */
export function buildMavlinkFieldRows(message: Record<string, unknown>): MavlinkFieldRow[] {
  const { type: _type, ...rest } = message
  return Object.entries(rest).map(([key, value]) => ({
    key,
    value: formatMavlinkFieldValue(value),
    type: formatMavlinkFieldType(value),
    plottable: isPlottableFieldValue(value)
  }))
}

/** Pretty-printed JSON of the last decoded fields for copy-to-clipboard. */
export function messageToJson(message: Record<string, unknown>): string {
  const { type: _type, ...rest } = message
  try {
    return JSON.stringify(rest, (_key, value) => (typeof value === 'bigint' ? value.toString() : value), 2)
  } catch {
    return String(rest)
  }
}

/**
 * SVG polyline `points` for a per-type rate sparkline, normalized to the
 * peak in the window so a flat stream sits at the bottom and a burst peaks
 * at the top. Returns '' for fewer than two samples (nothing to draw).
 */
export function buildSparklinePoints(
  history: readonly number[],
  width = 64,
  height = 16
): string {
  if (history.length < 2) {
    return ''
  }
  const peak = Math.max(...history, 0.0001)
  const step = width / (history.length - 1)
  return history
    .map((value, index) => {
      const x = index * step
      const y = height - (value / peak) * height
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
}

// ---------------------------------------------------------------------------
// Phase 2 — interactive message requests (SET_MESSAGE_INTERVAL / REQUEST_MESSAGE)
// ---------------------------------------------------------------------------

export interface MavlinkRequestableMessage {
  id: number
  name: string
}

/**
 * Curated list of commonly-requested ArduPilot telemetry messages for the
 * inspector's request control. Ids are MAVLink common-dialect message ids;
 * kept here (not imported from protocol-mavlink) so the view stays dumb. An
 * operator can also type any numeric id in the control.
 */
export const REQUESTABLE_MESSAGES: readonly MavlinkRequestableMessage[] = [
  { id: 0, name: 'HEARTBEAT' },
  { id: 1, name: 'SYS_STATUS' },
  { id: 24, name: 'GPS_RAW_INT' },
  { id: 27, name: 'RAW_IMU' },
  { id: 29, name: 'SCALED_PRESSURE' },
  { id: 30, name: 'ATTITUDE' },
  { id: 31, name: 'ATTITUDE_QUATERNION' },
  { id: 33, name: 'GLOBAL_POSITION_INT' },
  { id: 36, name: 'SERVO_OUTPUT_RAW' },
  { id: 62, name: 'NAV_CONTROLLER_OUTPUT' },
  { id: 65, name: 'RC_CHANNELS' },
  { id: 74, name: 'VFR_HUD' },
  { id: 116, name: 'SCALED_IMU2' },
  { id: 147, name: 'BATTERY_STATUS' },
  { id: 148, name: 'AUTOPILOT_VERSION' },
  { id: 193, name: 'EKF_STATUS_REPORT' },
  { id: 241, name: 'VIBRATION' }
] as const

export type MavlinkRequestKind = 'once' | 'stream' | 'disable'

/**
 * Convert a requested rate (Hz) to the SET_MESSAGE_INTERVAL interval parameter
 * in microseconds, matching MAVLink semantics: a positive rate becomes the
 * per-message period, 0 requests the firmware default rate, and any
 * non-positive rate disables the stream (-1). The single source of truth for
 * the µs the autopilot receives.
 */
export function intervalUsForRate(rateHz: number): number {
  if (rateHz > 0) {
    return Math.round(1_000_000 / rateHz)
  }
  return rateHz === 0 ? 0 : -1
}

/** Human label for a finished message request, for the result line. */
export function describeMessageRequestOutcome(
  kind: MavlinkRequestKind,
  messageName: string,
  outcome: { ok: boolean; resultLabel: string }
): string {
  const verb = kind === 'once' ? 'Requested' : kind === 'disable' ? 'Disabled' : 'Streaming'
  if (outcome.ok) {
    return `${verb} ${messageName} — accepted (${outcome.resultLabel}).`
  }
  return `${messageName} request rejected (${outcome.resultLabel}).`
}

/** Resolve a message-id to its known name, or "msg <id>" for unknown ids. */
export function messageNameForId(messageId: number): string {
  return REQUESTABLE_MESSAGES.find((entry) => entry.id === messageId)?.name ?? `msg ${messageId}`
}

/** MAVLink HEARTBEAT — the link-liveness signal the app keys vehicle detection on. */
export const HEARTBEAT_MESSAGE_ID = 0

/**
 * Message ids the app actively streams for its live UI (mirrors the runtime's
 * LIVE_TELEMETRY_REQUESTS). Disabling one silently blanks part of the flight
 * deck / calibration UI until the operator reconnects or re-requests it. Kept
 * here (not imported from the runtime) so the view stays dumb.
 */
export const CRITICAL_STREAM_IDS: ReadonlySet<number> = new Set<number>([
  1, // SYS_STATUS
  30, // ATTITUDE
  31, // ATTITUDE_QUATERNION
  33, // GLOBAL_POSITION_INT
  65, // RC_CHANNELS
  191, // MAG_CAL_PROGRESS
  192, // MAG_CAL_REPORT
  310 // UAVCAN_NODE_STATUS
])

export interface DisableGuard {
  level: 'blocked' | 'warn'
  message: string
}

/**
 * Guard an operator "Disable" (SET_MESSAGE_INTERVAL → -1) against footguns.
 * HEARTBEAT is blocked outright — killing it stops vehicle detection and the
 * live link, and the FC may need a power-cycle to recover. The live-telemetry
 * streams warn (arm-to-confirm) before they blank the flight deck. Returns null
 * when disabling the id is harmless. Only relevant for the `disable` kind;
 * requesting/streaming any id stays unguarded.
 */
export function disableGuardForMessage(messageId: number): DisableGuard | null {
  if (messageId === HEARTBEAT_MESSAGE_ID) {
    return {
      level: 'blocked',
      message: 'Disabling HEARTBEAT stops vehicle detection and the live link — blocked. Power-cycle the FC to restore it if already disabled.'
    }
  }
  if (CRITICAL_STREAM_IDS.has(messageId)) {
    return {
      level: 'warn',
      message: `${messageNameForId(messageId)} feeds the live display — disabling it blanks that view until you reconnect or re-request it.`
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Phase 3 — live field plotting (ring-buffered samples + inline SVG geometry)
// ---------------------------------------------------------------------------

export interface PlotSample {
  /** Sample timestamp in ms (Date.now() at arrival). */
  t: number
  value: number
}

/**
 * Append a sample to a field's ring buffer and trim it to the trailing window:
 * drop anything older than `sample.t - windowMs`, then cap to the most recent
 * `maxSamples`. Pure — the new sample's timestamp is the reference "now", so
 * the result is deterministic and unit-testable off any clock. Returns a new
 * array; the input is not mutated.
 */
export function appendPlotSample(
  samples: readonly PlotSample[],
  sample: PlotSample,
  windowMs: number,
  maxSamples: number
): PlotSample[] {
  const cutoff = sample.t - windowMs
  const next = samples.filter((entry) => entry.t >= cutoff)
  next.push(sample)
  if (next.length > maxSamples) {
    next.splice(0, next.length - maxSamples)
  }
  return next
}

export interface PlotGeometry {
  /** SVG polyline points across the sample's own time span, y autoscaled. */
  points: string
  min: number
  max: number
  /** Most recent sample value (the live read-out). */
  current: number
  sampleCount: number
}

/**
 * Inline-SVG geometry for a field plot: x spans the samples' own [first,last]
 * timestamps, y autoscales to [min,max] (a flat series centres vertically).
 * Returns empty points for an empty buffer. Pure / unit-tested.
 */
export function buildPlotGeometry(
  samples: readonly PlotSample[],
  width = 240,
  height = 60
): PlotGeometry {
  if (samples.length === 0) {
    return { points: '', min: 0, max: 0, current: 0, sampleCount: 0 }
  }
  let min = samples[0].value
  let max = samples[0].value
  for (const sample of samples) {
    if (sample.value < min) min = sample.value
    if (sample.value > max) max = sample.value
  }
  const current = samples[samples.length - 1].value
  if (samples.length === 1) {
    const y = height / 2
    return { points: `0.0,${y.toFixed(1)}`, min, max, current, sampleCount: 1 }
  }
  const tFirst = samples[0].t
  const tSpan = samples[samples.length - 1].t - tFirst || 1
  const ySpan = max - min || 1
  const points = samples
    .map((sample) => {
      const x = ((sample.t - tFirst) / tSpan) * width
      const y = height - ((sample.value - min) / ySpan) * height
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
  return { points, min, max, current, sampleCount: samples.length }
}

/** Compact numeric label for plot axes / read-outs. */
export function formatPlotValue(value: number): string {
  if (!Number.isFinite(value)) return '—'
  if (Number.isInteger(value)) return String(value)
  const abs = Math.abs(value)
  if (abs !== 0 && (abs < 0.001 || abs >= 1e6)) {
    return value.toExponential(2)
  }
  return value.toFixed(3).replace(/\.?0+$/, '')
}

// ---------------------------------------------------------------------------
// Phase 4 — link health (per-source packet loss + stale / slowed flagging)
// ---------------------------------------------------------------------------

/**
 * Reorder-tolerant per-source packet-loss accounting off the MAVLink v2
 * sequence byte (8-bit, wraps at 256). A skipped sequence is only counted as
 * dropped once it has fallen `SEQ_REORDER_WINDOW` frames behind without ever
 * arriving — frames that show up late / out of order within the window are
 * recovered, not counted as loss. This avoids the false-loss a naive
 * "forward distance" counter reports when frames are delivered out of order
 * (e.g. a transport interleaving a solicited burst with a live stream — the
 * in-browser demo mock does exactly this). On a real, in-order single-source
 * stream it reports genuine gaps. Pure / unit-tested.
 */
export const SEQ_REORDER_WINDOW = 64

export interface SourceSeqAccounting {
  /** Next sequence we expect (undefined until the first frame). */
  expected: number | undefined
  received: number
  dropped: number
  /** Skipped seqs awaiting a possible late (reordered) arrival. */
  pending: Set<number>
}

export function createSeqAccounting(): SourceSeqAccounting {
  return { expected: undefined, received: 0, dropped: 0, pending: new Set() }
}

/** Account one frame's sequence byte. Mutates + returns `state`. */
export function accountSequence(state: SourceSeqAccounting, seq: number): SourceSeqAccounting {
  state.received += 1
  if (state.expected === undefined) {
    state.expected = (seq + 1) & 0xff
    return state
  }
  const gap = (seq - state.expected) & 0xff
  if (gap === 0) {
    // exactly the next frame — in order
    state.expected = (seq + 1) & 0xff
  } else if (gap <= 0x7f) {
    // forward jump: the skipped seqs may yet arrive out of order — hold them
    for (let i = 0; i < gap; i++) {
      state.pending.add((state.expected + i) & 0xff)
    }
    state.expected = (seq + 1) & 0xff
  } else {
    // seq is behind `expected` (wrap-back) — a late/reordered frame or a
    // duplicate. Recover it from pending if we were waiting on it; otherwise
    // it's an old/duplicate frame. Either way it is not a loss, and it does
    // not advance `expected`.
    state.pending.delete(seq)
  }
  // Finalise any pending seq that has now fallen outside the reorder window.
  for (const p of state.pending) {
    if (((state.expected - p) & 0xff) > SEQ_REORDER_WINDOW) {
      state.dropped += 1
      state.pending.delete(p)
    }
  }
  return state
}

/** Loss as a percentage of expected frames (received + dropped). 0 when idle. */
export function lossPercent(received: number, dropped: number): number {
  const total = received + dropped
  return total > 0 ? (dropped / total) * 100 : 0
}

/** Compact loss label: "0%", "<1%", "3.4%", "12%". */
export function formatLossPercent(lossPct: number): string {
  if (!Number.isFinite(lossPct) || lossPct <= 0) {
    return '0%'
  }
  if (lossPct < 1) {
    return '<1%'
  }
  return `${lossPct.toFixed(lossPct < 10 ? 1 : 0)}%`
}

/** A row is stale once its stream has gone quiet for this long. */
export const STALE_AFTER_MS = 3000
/** A row's rate must fall below this fraction of its recent peak to read "slow". */
const RATE_DROP_FACTOR = 0.5
/** …and the recent peak must have been at least this lively (Hz) to bother. */
const RATE_DROP_MIN_PEAK_HZ = 2

/** True when a row's stream has stopped (no message within the stale window). */
export function isRowStale(lastSeenMs: number, now: number, staleAfterMs = STALE_AFTER_MS): boolean {
  return now - lastSeenMs >= staleAfterMs
}

/**
 * True when a still-live row's rate has fallen sharply off its recent peak —
 * a stream that was healthy and is now limping (but not yet fully stale).
 * Cheap: reads the per-row rate history already tracked for the sparkline.
 */
export function isRateDropSharp(
  rateHistory: readonly number[],
  currentRateHz: number,
  factor = RATE_DROP_FACTOR,
  minPeakHz = RATE_DROP_MIN_PEAK_HZ
): boolean {
  if (rateHistory.length < 2) {
    return false
  }
  const peak = Math.max(...rateHistory)
  if (peak < minPeakHz) {
    return false
  }
  return currentRateHz < peak * factor
}

export type MavlinkRowHealth = 'ok' | 'slow' | 'stale'

/**
 * Classify a row's stream health: fully stopped → 'stale', sharply slowed but
 * still alive → 'slow', otherwise 'ok'. Pure / unit-tested.
 */
export function classifyRowHealth(
  lastSeenMs: number,
  now: number,
  rateHistory: readonly number[],
  currentRateHz: number,
  staleAfterMs = STALE_AFTER_MS
): MavlinkRowHealth {
  if (isRowStale(lastSeenMs, now, staleAfterMs)) {
    return 'stale'
  }
  if (isRateDropSharp(rateHistory, currentRateHz)) {
    return 'slow'
  }
  return 'ok'
}

/** Per-source link health, accumulated in the hook and rendered per group. */
export interface MavlinkSourceHealth {
  /** `${systemId}:${componentId}` — matches a source group's id. */
  id: string
  systemId: number
  componentId: number
  /** Frames received from this source this session (across all types). */
  received: number
  /** Frames inferred dropped from sequence gaps this session. */
  dropped: number
  /** dropped / (received + dropped) × 100. */
  lossPct: number
  /** Most recent sequence byte seen, or undefined before the first frame. */
  lastSeqSeen: number | undefined
}

/**
 * One-line health summary for a source group: loss percentage plus, when any
 * of the source's rows have gone quiet, a stale count — e.g. "0% loss",
 * "12% loss · 2 stale". Pure / unit-tested.
 */
export function describeSourceHealth(lossPct: number, staleCount: number): string {
  const parts = [`${formatLossPercent(lossPct)} loss`]
  if (staleCount > 0) {
    parts.push(`${staleCount} stale`)
  }
  return parts.join(' · ')
}

// ---------------------------------------------------------------------------
// Phase 5 — record / export (download-only): stats snapshot JSON, a bounded
// stream-recording ring buffer + its JSON, and per-plot CSV. All serialization
// is pure / unit-tested; the side-effecting downloads live in the hook.
// ---------------------------------------------------------------------------

/** JSON.stringify replacer that survives decoded MAVLink field values:
 *  bigints become strings and typed arrays (e.g. LOG_DATA.data) become plain
 *  number arrays, so nothing throws and nothing serializes as `{"0":…}`. */
export function jsonSafeReplacer(_key: string, value: unknown): unknown {
  if (typeof value === 'bigint') {
    return value.toString()
  }
  if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
    return Array.from(value as unknown as ArrayLike<number>)
  }
  return value
}

/** Strip the synthetic `type` discriminator from a decoded message's fields. */
function fieldsWithoutType(message: Record<string, unknown>): Record<string, unknown> {
  const { type: _type, ...rest } = message
  return rest
}

export interface StatsSnapshotType {
  type: string
  count: number
  rateHz: number
  bytesPerSec: number
  totalBytes: number
  lastSeenMs: number
  lastFields: Record<string, unknown>
}

export interface StatsSnapshotSource {
  id: string
  systemId: number
  componentId: number
  received: number
  dropped: number
  lossPct: number
  rateHz: number
  bytesPerSec: number
  types: StatsSnapshotType[]
}

export interface StatsSnapshot {
  tool: 'arduconfigurator-mavlink-inspector'
  kind: 'stats-snapshot'
  version: 1
  capturedAt: string
  summary: MavlinkInspectorSummary
  sources: StatsSnapshotSource[]
}

/**
 * Build a JSON-serializable snapshot of the whole inspector state: every
 * source → its types (rate / count / bytes / last decoded fields) plus the
 * source's packet-loss accounting. Pure / unit-tested.
 */
export function buildStatsSnapshot(
  stats: readonly MavlinkMessageStat[],
  sourceHealth: readonly MavlinkSourceHealth[],
  capturedAtMs: number
): StatsSnapshot {
  const healthById = new Map(sourceHealth.map((entry) => [entry.id, entry]))
  const sources = groupMavlinkStatsBySource(sortMavlinkStats(stats, 'name')).map((group) => {
    const health = healthById.get(group.id)
    return {
      id: group.id,
      systemId: group.systemId,
      componentId: group.componentId,
      received: health?.received ?? 0,
      dropped: health?.dropped ?? 0,
      lossPct: health?.lossPct ?? 0,
      rateHz: group.rateHz,
      bytesPerSec: group.bytesPerSec,
      types: group.stats.map((stat) => ({
        type: stat.type,
        count: stat.count,
        rateHz: stat.rateHz,
        bytesPerSec: stat.bytesPerSec,
        totalBytes: stat.totalBytes,
        lastSeenMs: stat.lastSeenMs,
        lastFields: fieldsWithoutType(stat.lastMessage)
      }))
    }
  })
  return {
    tool: 'arduconfigurator-mavlink-inspector',
    kind: 'stats-snapshot',
    version: 1,
    capturedAt: new Date(capturedAtMs).toISOString(),
    summary: summarizeMavlinkStats(stats),
    sources
  }
}

/** Pretty-printed JSON for the stats-snapshot download. */
export function serializeStatsSnapshot(
  stats: readonly MavlinkMessageStat[],
  sourceHealth: readonly MavlinkSourceHealth[],
  capturedAtMs: number
): string {
  return JSON.stringify(buildStatsSnapshot(stats, sourceHealth, capturedAtMs), jsonSafeReplacer, 2)
}

/** Cap on the stream-recording ring buffer (most recent N messages). */
export const RECORDING_MAX_MESSAGES = 5000

/** One captured message in a stream recording. */
export interface RecordedMavlinkMessage {
  /** Capture timestamp in ms (Date.now() at arrival). */
  t: number
  systemId: number
  componentId: number
  sequence: number
  type: string
  fields: Record<string, unknown>
}

/**
 * Push a message onto a bounded recording buffer, dropping the oldest beyond
 * `maxMessages` so the capture never grows unbounded. Mutates and returns the
 * buffer — this rides the hot message path, so it avoids per-message copies
 * (unlike the immutable plot buffer). Unit-tested for the cap + drop-oldest.
 */
export function pushRecordedMessage(
  buffer: RecordedMavlinkMessage[],
  record: RecordedMavlinkMessage,
  maxMessages: number
): RecordedMavlinkMessage[] {
  buffer.push(record)
  if (buffer.length > maxMessages) {
    buffer.splice(0, buffer.length - maxMessages)
  }
  return buffer
}

export interface RecordingExport {
  tool: 'arduconfigurator-mavlink-inspector'
  kind: 'stream-recording'
  version: 1
  capturedAt: string
  /** Messages retained in the buffer (after the ring-buffer cap). */
  messageCount: number
  /** True when the cap dropped older messages (the capture is a trailing window). */
  capped: boolean
  /** The per-message cap that bounded the buffer. */
  maxMessages: number
  messages: RecordedMavlinkMessage[]
}

/** Pretty-printed JSON for the stream-recording download. */
export function serializeRecording(
  messages: readonly RecordedMavlinkMessage[],
  capturedAtMs: number,
  maxMessages: number,
  capped: boolean
): string {
  const payload: RecordingExport = {
    tool: 'arduconfigurator-mavlink-inspector',
    kind: 'stream-recording',
    version: 1,
    capturedAt: new Date(capturedAtMs).toISOString(),
    messageCount: messages.length,
    capped,
    maxMessages,
    messages: [...messages]
  }
  return JSON.stringify(payload, jsonSafeReplacer, 2)
}

/**
 * CSV ("timestamp,value") for a plot's sample buffer. `timestamp` is the raw
 * sample time in ms (the same clock the buffer was filled on); a header row
 * always leads so the file is self-describing even when empty. Pure.
 */
export function serializePlotCsv(samples: readonly PlotSample[]): string {
  const lines = ['timestamp,value']
  for (const sample of samples) {
    lines.push(`${sample.t},${sample.value}`)
  }
  return lines.join('\n')
}

/** Filesystem-safe, timestamped filename for an inspector export. */
export function inspectorExportFilename(label: string, extension: string, capturedAtMs: number): string {
  const stamp = new Date(capturedAtMs).toISOString().replace(/[:.]/g, '-')
  const safeLabel = label.replace(/[^a-zA-Z0-9_.-]+/g, '-')
  return `mavlink-${safeLabel}-${stamp}.${extension}`
}
