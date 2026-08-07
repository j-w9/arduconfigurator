// Status & Info dashboard layout — the pure, unit-testable half of the
// drag-and-resize arrangement.
//
// WHY a layout MODEL rather than a grid library: the Status page is a nested
// arrangement of narrow columns whose cards keep their NATURAL height (see the
// `align-items: start` note on `.setup-bench__status-trio`). Absolute-positioned
// grid libraries need an explicit pixel height for every card, which turns a
// card whose content grew — one more pre-arm issue, a firmware git hash row —
// into a clipped or half-empty box. So the model here is deliberately smaller
// than a 2-D grid: a card lives in one of a few named ZONES, at an index within
// that zone, with an optional height cap. Cards can never overlap, never leave
// a hole, and never need a collision pass; the worst a user can do is stack
// everything into one zone, which still renders as a normal column.
//
// Width is a property of the zone, not the card: the sidebar zone is narrow,
// the status columns are a share of the main column each. Moving a card is
// therefore also how you resize it horizontally, and no arrangement can produce
// a card wider than the page or narrower than its content.
//
// The zone list mirrors the page as it ships: a full-width SENSOR ROW under the
// craft model (GPS + rangefinder + optical flow, grouped there so the three
// answers to "is the thing I bolted on reporting?" sit side by side), then the
// two status columns below it, then the sidebar of reference and action cards.
// `sensors` is a grid ROW rather than a column, which the model does not care
// about — a zone is an ordered list of cards, and CSS decides whether that list
// flows down or across.

/** The drop zones on the Status & Info page. Widths come from CSS, not layout. */
export type StatusDashboardZoneId = 'sensors' | 'midcol' | 'noticecol' | 'sidebar'

export const STATUS_DASHBOARD_ZONE_IDS: readonly StatusDashboardZoneId[] = [
  'sensors',
  'midcol',
  'noticecol',
  'sidebar'
]

export const STATUS_DASHBOARD_ZONE_LABELS: Record<StatusDashboardZoneId, string> = {
  sensors: 'Sensor row',
  midcol: 'Column 1',
  noticecol: 'Column 2',
  sidebar: 'Sidebar'
}

/** One vertical resize step, in pixels. Heights snap to a multiple of this. */
export const STATUS_DASHBOARD_ROW_PX = 24

/** Smallest and largest user-set height, in rows. Outside this range: clamped. */
export const STATUS_DASHBOARD_MIN_ROWS = 5
export const STATUS_DASHBOARD_MAX_ROWS = 60

/**
 * Bump when the SHAPE of a stored layout changes, or when the default
 * arrangement changes enough that a stale saved layout would look broken.
 * A stored layout with a different version is discarded, silently, in favour
 * of the current default — never rendered.
 */
export const STATUS_DASHBOARD_LAYOUT_VERSION = 1

export const STATUS_DASHBOARD_STORAGE_KEY = `arduconfig.status-dashboard.v${STATUS_DASHBOARD_LAYOUT_VERSION}`

/** Where one card sits, and how tall the operator has made it. */
export interface StatusDashboardPlacement {
  id: string
  zone: StatusDashboardZoneId
  /** User-set height cap in rows. Undefined means "as tall as its content". */
  heightRows?: number
}

export interface StatusDashboardLayout {
  version: number
  cards: StatusDashboardPlacement[]
}

/** A card that exists on the page right now. `label` names it for assistive tech. */
export interface StatusDashboardCardSpec {
  id: string
  label: string
  zone: StatusDashboardZoneId
}

export function isStatusDashboardZoneId(value: unknown): value is StatusDashboardZoneId {
  return typeof value === 'string' && (STATUS_DASHBOARD_ZONE_IDS as readonly string[]).includes(value)
}

export function clampHeightRows(rows: number): number {
  if (!Number.isFinite(rows)) {
    return STATUS_DASHBOARD_MIN_ROWS
  }
  return Math.min(STATUS_DASHBOARD_MAX_ROWS, Math.max(STATUS_DASHBOARD_MIN_ROWS, Math.round(rows)))
}

/** The layout that describes the page exactly as it ships, before any dragging. */
export function defaultStatusDashboardLayout(specs: readonly StatusDashboardCardSpec[]): StatusDashboardLayout {
  return {
    version: STATUS_DASHBOARD_LAYOUT_VERSION,
    cards: specs.map((spec) => ({ id: spec.id, zone: spec.zone }))
  }
}

/**
 * Parse a stored layout defensively. Anything we cannot fully trust — bad JSON,
 * a different version, a non-array `cards`, an entry without a string id —
 * returns undefined so the caller falls back to the default. A corrupt value in
 * localStorage must never be able to white-screen the Status page.
 */
export function parseStoredStatusDashboardLayout(raw: string | null): StatusDashboardLayout | undefined {
  if (!raw) {
    return undefined
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return undefined
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return undefined
  }
  const candidate = parsed as { version?: unknown; cards?: unknown }
  if (candidate.version !== STATUS_DASHBOARD_LAYOUT_VERSION) {
    return undefined
  }
  if (!Array.isArray(candidate.cards)) {
    return undefined
  }
  const cards: StatusDashboardPlacement[] = []
  const seen = new Set<string>()
  for (const entry of candidate.cards) {
    if (!entry || typeof entry !== 'object') {
      continue
    }
    const record = entry as { id?: unknown; zone?: unknown; heightRows?: unknown }
    if (typeof record.id !== 'string' || record.id.length === 0 || seen.has(record.id)) {
      continue
    }
    seen.add(record.id)
    const placement: StatusDashboardPlacement = {
      id: record.id,
      // An unknown zone (a zone we removed in a later release) is not fatal:
      // the reconcile pass below puts the card back where it belongs.
      zone: isStatusDashboardZoneId(record.zone) ? record.zone : 'sensors'
    }
    if (typeof record.heightRows === 'number' && Number.isFinite(record.heightRows)) {
      placement.heightRows = clampHeightRows(record.heightRows)
    }
    cards.push(placement)
  }
  return { version: STATUS_DASHBOARD_LAYOUT_VERSION, cards }
}

/**
 * Reconcile a (possibly stale) layout against the cards that actually exist
 * right now.
 *
 * This is the conditional-card contract. The rangefinder and optical-flow cards
 * only exist when the sensor is configured, so a saved layout routinely names
 * cards that are gone, and routinely lacks cards that just appeared:
 *
 *  - a placement for a card that is NOT present is dropped;
 *  - a present card with NO placement is inserted at its DEFAULT position,
 *    immediately after the nearest earlier default-neighbour that the operator
 *    still has on screen — so a rangefinder card that appears mid-session lands
 *    beside GPS in the sensor row where it belongs, not orphaned at the bottom
 *    of a zone.
 *
 * The result always contains exactly the present cards, exactly once.
 */
export function reconcileStatusDashboardLayout(
  layout: StatusDashboardLayout | undefined,
  specs: readonly StatusDashboardCardSpec[]
): StatusDashboardLayout {
  if (!layout) {
    return defaultStatusDashboardLayout(specs)
  }
  const specById = new Map(specs.map((spec) => [spec.id, spec]))
  const cards = layout.cards.filter((placement) => specById.has(placement.id))
  const placed = new Set(cards.map((placement) => placement.id))

  for (const [index, spec] of specs.entries()) {
    if (placed.has(spec.id)) {
      continue
    }
    // Find the nearest earlier card in DEFAULT order that survived, and land
    // directly after it. Falls back to the end of the list.
    let insertAt = cards.length
    for (let back = index - 1; back >= 0; back -= 1) {
      const anchor = specs[back]
      if (!anchor) {
        continue
      }
      const anchorIndex = cards.findIndex((placement) => placement.id === anchor.id)
      if (anchorIndex >= 0) {
        insertAt = anchorIndex + 1
        break
      }
    }
    cards.splice(insertAt, 0, { id: spec.id, zone: spec.zone })
    placed.add(spec.id)
  }

  return { version: STATUS_DASHBOARD_LAYOUT_VERSION, cards }
}

/** The ids in one zone, in render order. */
export function zoneCardIds(layout: StatusDashboardLayout, zone: StatusDashboardZoneId): string[] {
  return layout.cards.filter((placement) => placement.zone === zone).map((placement) => placement.id)
}

export function findPlacement(
  layout: StatusDashboardLayout,
  id: string
): StatusDashboardPlacement | undefined {
  return layout.cards.find((placement) => placement.id === id)
}

/**
 * Move `id` into `zone` at `index` (index counted within that zone, after the
 * card has been removed). Returns the same object when nothing would change, so
 * callers can skip a re-render and a localStorage write.
 */
export function moveStatusDashboardCard(
  layout: StatusDashboardLayout,
  id: string,
  zone: StatusDashboardZoneId,
  index: number
): StatusDashboardLayout {
  const moving = findPlacement(layout, id)
  if (!moving) {
    return layout
  }
  const rest = layout.cards.filter((placement) => placement.id !== id)
  const zoneIds = rest.filter((placement) => placement.zone === zone)
  const clampedIndex = Math.min(Math.max(index, 0), zoneIds.length)

  if (moving.zone === zone) {
    const currentIndex = zoneCardIds(layout, zone).indexOf(id)
    if (currentIndex === clampedIndex) {
      return layout
    }
  }

  const next: StatusDashboardPlacement[] = []
  let zoneSeen = 0
  let inserted = false
  const relocated: StatusDashboardPlacement = { ...moving, zone }

  for (const placement of rest) {
    if (placement.zone === zone) {
      if (zoneSeen === clampedIndex && !inserted) {
        next.push(relocated)
        inserted = true
      }
      zoneSeen += 1
    }
    next.push(placement)
  }
  if (!inserted) {
    next.push(relocated)
  }
  return { version: layout.version, cards: next }
}

/** Step a card one slot earlier/later inside its own zone. The keyboard path. */
export function nudgeStatusDashboardCard(
  layout: StatusDashboardLayout,
  id: string,
  delta: -1 | 1
): StatusDashboardLayout {
  const placement = findPlacement(layout, id)
  if (!placement) {
    return layout
  }
  const index = zoneCardIds(layout, placement.zone).indexOf(id)
  return moveStatusDashboardCard(layout, id, placement.zone, index + delta)
}

/** Move a card to the neighbouring zone, keeping roughly its vertical slot. */
export function shiftStatusDashboardCardZone(
  layout: StatusDashboardLayout,
  id: string,
  delta: -1 | 1
): StatusDashboardLayout {
  const placement = findPlacement(layout, id)
  if (!placement) {
    return layout
  }
  const zoneIndex = STATUS_DASHBOARD_ZONE_IDS.indexOf(placement.zone)
  const targetZone = STATUS_DASHBOARD_ZONE_IDS[zoneIndex + delta]
  if (!targetZone) {
    return layout
  }
  const index = zoneCardIds(layout, placement.zone).indexOf(id)
  return moveStatusDashboardCard(layout, id, targetZone, index)
}

/** Set (or, with undefined, clear) a card's height cap. Always snapped+clamped. */
export function resizeStatusDashboardCard(
  layout: StatusDashboardLayout,
  id: string,
  heightRows: number | undefined
): StatusDashboardLayout {
  const placement = findPlacement(layout, id)
  if (!placement) {
    return layout
  }
  const next = heightRows === undefined ? undefined : clampHeightRows(heightRows)
  if (placement.heightRows === next) {
    return layout
  }
  return {
    version: layout.version,
    cards: layout.cards.map((entry) =>
      entry.id === id ? (next === undefined ? { id: entry.id, zone: entry.zone } : { ...entry, heightRows: next }) : entry
    )
  }
}

/** True when the layout is the shipped default — used to hide "Reset layout". */
export function isDefaultStatusDashboardLayout(
  layout: StatusDashboardLayout,
  specs: readonly StatusDashboardCardSpec[]
): boolean {
  if (layout.cards.length !== specs.length) {
    return false
  }
  return layout.cards.every((placement, index) => {
    const spec = specs[index]
    return (
      spec !== undefined &&
      spec.id === placement.id &&
      spec.zone === placement.zone &&
      placement.heightRows === undefined
    )
  })
}
