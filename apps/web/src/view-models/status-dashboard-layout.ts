// Status & Info dashboard layout — the pure, unit-testable half of the
// drag-and-resize arrangement.
//
// ── THE PLACEMENT MODEL, AND WHY IT IS THIS ONE ───────────────────────────
//
// v1 shipped a deliberately constrained ZONE model: four named zones, a card
// at an index in one of them, width owned by the zone. The operator's verdict
// was that it was too tight — "drag and drop how I please". So the guardrails
// come off, but not by switching to absolute pixel positioning, which is the
// one thing this page cannot have: a Status card's height is its CONTENT's
// height (pre-arm grows with the issue count, System Info grows with a
// firmware git hash), and pinning a pixel height either clips that or hangs
// dead space off the bottom.
//
// So: a real CSS grid, 12 columns, AUTO rows.
//
//   REGION  — 'main' (under the craft model) or 'side' (the page sidebar).
//             Two regions rather than one grid because the sidebar is a
//             sibling of the viewer in the page shell and runs alongside the
//             craft preview; flattening them would move the sidebar below it.
//   BAND    — a horizontal shelf inside a region. Bands stack top to bottom.
//   COLUMN  — a vertical stack of cards inside a band, `span` grid columns
//             wide. THIS is the horizontal resize v1 was missing.
//   CARD    — belongs to a column, at an index, with an optional height cap.
//
// A column is a stack, not a grid cell, which is the detail that keeps the
// page packing tightly: two cards in one column sit directly on top of each
// other no matter how tall the column NEXT to them is. A flat card-per-cell
// grid cannot do that — grid rows share a height, so a tall Recent Notices
// would shove Statistics down below its bottom edge and leave a hole. That is
// also precisely why the default arrangement here still renders pixel-identical
// to the page that shipped (see `defaultStatusDashboardLayout`).
//
// Freedom the operator now has that v1 denied:
//   * any number of columns, in any band, in either region;
//   * per-column width (span), dragged or nudged, snapped to a 12th;
//   * new columns and new bands created by dropping a card in a gutter;
//   * gaps: spans need not add up to 12, and a band may hold one narrow
//     column with the rest of the row empty. Nothing forbids a mess — `tidy`
//     exists to climb back out of one without a full Reset.
//
// ── LIBRARY vs HAND-ROLLED, re-evaluated ──────────────────────────────────
//
// react-grid-layout was reconsidered from scratch for this change, not
// inherited from v1's verdict. Its MIT licence is GPL-3.0 compatible, so
// licensing is not the objection. The objection is its core data model: RGL
// positions every item absolutely at `h * rowHeight` pixels. Its `autoSize`
// prop sizes the CONTAINER to its items; it does not give an item a
// content-driven height, and the usual workaround (a ResizeObserver writing a
// measured `h` back into the layout) fights the operator's own resize and
// re-runs the collision solver every time a pre-arm issue appears or a
// STATUSTEXT lands — on a page whose whole job is live telemetry. It would
// also have to own the craft preview and the sidebar to lay them out at all.
// A CSS grid with auto rows gets content-driven heights for free, from the
// layout engine, with no dependency and no solver. Hand-rolled again — but
// this time the reasoning is "auto rows beat a pixel solver", not "freedom is
// dangerous".

/** The two independently-laid-out areas of the Status page. */
export type StatusDashboardRegionId = 'main' | 'side'

export const STATUS_DASHBOARD_REGION_IDS: readonly StatusDashboardRegionId[] = ['main', 'side']

export const STATUS_DASHBOARD_REGION_LABELS: Record<StatusDashboardRegionId, string> = {
  main: 'Main area',
  side: 'Sidebar'
}

/** Grid columns per region. 12 divides by 2, 3, 4 and 6 — every useful split. */
export const STATUS_DASHBOARD_GRID_COLUMNS = 12

/** One vertical resize step, in pixels. Card height caps snap to a multiple. */
export const STATUS_DASHBOARD_ROW_PX = 24

/** Smallest and largest user-set height, in rows. Outside this range: clamped. */
export const STATUS_DASHBOARD_MIN_ROWS = 5
export const STATUS_DASHBOARD_MAX_ROWS = 60

/**
 * Bump when the SHAPE of a stored layout changes, or when the default
 * arrangement changes enough that a stale saved layout would look broken.
 * A stored layout with a different version is discarded, silently, in favour
 * of the current default — never rendered.
 *
 * v1 → v2: zones became regions/bands/columns, and cards gained a width via
 * their column's span. A v1 layout has no columns at all, so it cannot be
 * migrated into something meaningful; it is dropped and the operator gets the
 * (unchanged) default back.
 */
export const STATUS_DASHBOARD_LAYOUT_VERSION = 2

export const STATUS_DASHBOARD_STORAGE_KEY = `arduconfig.status-dashboard.v${STATUS_DASHBOARD_LAYOUT_VERSION}`

/**
 * How a column arranges the cards inside it.
 *
 *  - `stack`: top to bottom. The ordinary column.
 *  - `shelf`: side by side, wrapping — an auto-fit row. The sensor row ships
 *    like this so GPS / rangefinder / optical flow answer their one shared
 *    question side by side, and so a sensor card that appears mid-session
 *    lands BESIDE its neighbours rather than under them.
 */
export type StatusDashboardColumnFlow = 'stack' | 'shelf'

export interface StatusDashboardColumn {
  id: string
  region: StatusDashboardRegionId
  /** Which horizontal shelf of the region. Bands render in ascending order. */
  band: number
  /** Width in grid columns, 1..12. */
  span: number
  flow: StatusDashboardColumnFlow
}

/** Where one card sits, and how tall the operator has made it. */
export interface StatusDashboardPlacement {
  id: string
  /** The id of the column this card lives in. */
  column: string
  /** User-set height cap in rows. Undefined means "as tall as its content". */
  heightRows?: number
}

export interface StatusDashboardLayout {
  version: number
  columns: StatusDashboardColumn[]
  cards: StatusDashboardPlacement[]
}

/** A card that exists on the page right now. `label` names it for assistive tech. */
export interface StatusDashboardCardSpec {
  id: string
  label: string
  /** The column this card belongs to in the shipped default arrangement. */
  column: string
}

export function isStatusDashboardRegionId(value: unknown): value is StatusDashboardRegionId {
  return typeof value === 'string' && (STATUS_DASHBOARD_REGION_IDS as readonly string[]).includes(value)
}

export function clampHeightRows(rows: number): number {
  if (!Number.isFinite(rows)) {
    return STATUS_DASHBOARD_MIN_ROWS
  }
  return Math.min(STATUS_DASHBOARD_MAX_ROWS, Math.max(STATUS_DASHBOARD_MIN_ROWS, Math.round(rows)))
}

export function clampSpan(span: number): number {
  if (!Number.isFinite(span)) {
    return STATUS_DASHBOARD_GRID_COLUMNS
  }
  return Math.min(STATUS_DASHBOARD_GRID_COLUMNS, Math.max(1, Math.round(span)))
}

/**
 * The columns of the shipped page, and the ONLY description of them.
 *
 * These four reproduce the page exactly as it renders without this feature:
 *
 *  - `sensors`  full-width shelf under the craft model (GPS + whichever
 *               advanced sensor cards exist), which is the same auto-fit row
 *               `.setup-status-sensors` always was;
 *  - `midcol` / `noticecol`  the two half-width status columns below it —
 *               span 6 of 12 with a 14px gutter is arithmetically the same
 *               width as the `auto-fit minmax(220px, 1fr)` pair they replace;
 *  - `sidebar`  the full width of the page sidebar.
 */
export const DEFAULT_STATUS_DASHBOARD_COLUMNS: readonly StatusDashboardColumn[] = [
  { id: 'sensors', region: 'main', band: 0, span: 12, flow: 'shelf' },
  { id: 'midcol', region: 'main', band: 1, span: 6, flow: 'stack' },
  { id: 'noticecol', region: 'main', band: 1, span: 6, flow: 'stack' },
  { id: 'sidebar', region: 'side', band: 0, span: 12, flow: 'stack' }
]

/** The layout that describes the page exactly as it ships, before any dragging. */
export function defaultStatusDashboardLayout(
  specs: readonly StatusDashboardCardSpec[]
): StatusDashboardLayout {
  return {
    version: STATUS_DASHBOARD_LAYOUT_VERSION,
    columns: DEFAULT_STATUS_DASHBOARD_COLUMNS.map((column) => ({ ...column })),
    cards: specs.map((spec) => ({ id: spec.id, column: spec.column }))
  }
}

function isColumnFlow(value: unknown): value is StatusDashboardColumnFlow {
  return value === 'stack' || value === 'shelf'
}

/**
 * Parse a stored layout defensively. Anything we cannot fully trust — bad JSON,
 * a different version, a non-array `columns`/`cards`, an entry without a string
 * id — returns undefined so the caller falls back to the default. A corrupt
 * value in localStorage must never be able to white-screen the Status page.
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
  const candidate = parsed as { version?: unknown; columns?: unknown; cards?: unknown }
  if (candidate.version !== STATUS_DASHBOARD_LAYOUT_VERSION) {
    return undefined
  }
  if (!Array.isArray(candidate.columns) || !Array.isArray(candidate.cards)) {
    return undefined
  }

  const columns: StatusDashboardColumn[] = []
  const seenColumns = new Set<string>()
  for (const entry of candidate.columns) {
    if (!entry || typeof entry !== 'object') {
      continue
    }
    const record = entry as { id?: unknown; region?: unknown; band?: unknown; span?: unknown; flow?: unknown }
    if (typeof record.id !== 'string' || record.id.length === 0 || seenColumns.has(record.id)) {
      continue
    }
    seenColumns.add(record.id)
    columns.push({
      id: record.id,
      region: isStatusDashboardRegionId(record.region) ? record.region : 'main',
      band: typeof record.band === 'number' && Number.isFinite(record.band) ? Math.max(0, Math.round(record.band)) : 0,
      span: clampSpan(typeof record.span === 'number' ? record.span : STATUS_DASHBOARD_GRID_COLUMNS),
      flow: isColumnFlow(record.flow) ? record.flow : 'stack'
    })
  }
  // No columns at all means nothing can be rendered — treat as untrusted.
  if (columns.length === 0) {
    return undefined
  }

  const cards: StatusDashboardPlacement[] = []
  const seenCards = new Set<string>()
  for (const entry of candidate.cards) {
    if (!entry || typeof entry !== 'object') {
      continue
    }
    const record = entry as { id?: unknown; column?: unknown; heightRows?: unknown }
    if (typeof record.id !== 'string' || record.id.length === 0 || seenCards.has(record.id)) {
      continue
    }
    seenCards.add(record.id)
    const placement: StatusDashboardPlacement = {
      id: record.id,
      // An unknown column is not fatal: reconcile puts the card somewhere real.
      column: typeof record.column === 'string' && seenColumns.has(record.column) ? record.column : columns[0]!.id
    }
    if (typeof record.heightRows === 'number' && Number.isFinite(record.heightRows)) {
      placement.heightRows = clampHeightRows(record.heightRows)
    }
    cards.push(placement)
  }

  return { version: STATUS_DASHBOARD_LAYOUT_VERSION, columns, cards }
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
 *  - a present card with NO placement is inserted next to the nearest earlier
 *    default-neighbour that the operator still has on screen — so a
 *    rangefinder card that appears mid-session lands beside GPS wherever the
 *    operator has since dragged GPS to, not orphaned at the bottom of the page;
 *  - a card whose DEFAULT column the operator has deleted falls back to that
 *    column being recreated only if nothing better exists; otherwise it joins
 *    the neighbour's column.
 *
 * Empty columns are kept, not pruned: an operator who deliberately made room
 * for a card that is only sometimes present should still have that room when
 * it disappears and comes back. `tidy` is where emptiness gets cleaned up, on
 * request.
 *
 * The result always contains exactly the present cards, exactly once, each in
 * a column that exists.
 */
export function reconcileStatusDashboardLayout(
  layout: StatusDashboardLayout | undefined,
  specs: readonly StatusDashboardCardSpec[]
): StatusDashboardLayout {
  if (!layout) {
    return defaultStatusDashboardLayout(specs)
  }
  const specById = new Map(specs.map((spec) => [spec.id, spec]))
  const columns = layout.columns.map((column) => ({ ...column }))
  const columnIds = new Set(columns.map((column) => column.id))
  const cards = layout.cards
    .filter((placement) => specById.has(placement.id))
    .map((placement) =>
      columnIds.has(placement.column) ? placement : { ...placement, column: columns[0]!.id }
    )
  const placed = new Map(cards.map((placement) => [placement.id, placement]))

  for (const [index, spec] of specs.entries()) {
    if (placed.has(spec.id)) {
      continue
    }
    // Land directly after the nearest earlier card in DEFAULT order that
    // survived — that is what keeps a re-appearing sensor card beside its
    // neighbours instead of at the end of the page.
    let insertAt = cards.length
    let column = columnIds.has(spec.column) ? spec.column : undefined
    for (let back = index - 1; back >= 0; back -= 1) {
      const anchor = specs[back]
      if (!anchor) {
        continue
      }
      const anchorIndex = cards.findIndex((placement) => placement.id === anchor.id)
      if (anchorIndex >= 0) {
        insertAt = anchorIndex + 1
        // Only follow the neighbour into ITS column when this card's own
        // default column is gone; otherwise the default column wins.
        column = column ?? cards[anchorIndex]!.column
        if (anchor.column === spec.column) {
          column = cards[anchorIndex]!.column
        }
        break
      }
    }
    const placement: StatusDashboardPlacement = { id: spec.id, column: column ?? columns[0]!.id }
    cards.splice(insertAt, 0, placement)
    placed.set(spec.id, placement)
  }

  return { version: STATUS_DASHBOARD_LAYOUT_VERSION, columns, cards }
}

/** The ids in one column, in render order. */
export function columnCardIds(layout: StatusDashboardLayout, columnId: string): string[] {
  return layout.cards.filter((placement) => placement.column === columnId).map((placement) => placement.id)
}

export function findPlacement(
  layout: StatusDashboardLayout,
  id: string
): StatusDashboardPlacement | undefined {
  return layout.cards.find((placement) => placement.id === id)
}

export function findColumn(layout: StatusDashboardLayout, columnId: string): StatusDashboardColumn | undefined {
  return layout.columns.find((column) => column.id === columnId)
}

/** One band: the columns on one horizontal shelf, left to right. */
export interface StatusDashboardBand {
  band: number
  columns: StatusDashboardColumn[]
}

/**
 * The bands of a region, in render order, each with its columns left to right
 * and their explicit grid start lines resolved.
 *
 * Start lines are explicit rather than auto-placed so that a band whose spans
 * do not add up to 12 leaves its free space at the RIGHT, deterministically,
 * instead of the grid quietly repacking the row.
 */
export function regionBands(
  layout: StatusDashboardLayout,
  region: StatusDashboardRegionId
): StatusDashboardBand[] {
  const byBand = new Map<number, StatusDashboardColumn[]>()
  for (const column of layout.columns) {
    if (column.region !== region) {
      continue
    }
    const list = byBand.get(column.band)
    if (list) {
      list.push(column)
    } else {
      byBand.set(column.band, [column])
    }
  }
  return [...byBand.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([band, columns]) => ({ band, columns }))
}

/** The 1-based grid column this column starts at, given its band neighbours. */
export function columnStartLine(band: StatusDashboardBand, columnId: string): number {
  let start = 1
  for (const column of band.columns) {
    if (column.id === columnId) {
      return Math.min(start, STATUS_DASHBOARD_GRID_COLUMNS)
    }
    start += column.span
  }
  return Math.min(start, STATUS_DASHBOARD_GRID_COLUMNS)
}

/** Spare grid columns at the right-hand end of a band. Never negative. */
export function bandFreeSpan(band: StatusDashboardBand): number {
  const used = band.columns.reduce((total, column) => total + column.span, 0)
  return Math.max(0, STATUS_DASHBOARD_GRID_COLUMNS - used)
}

/**
 * Move `id` into `columnId` at `index` (index counted within that column, after
 * the card has been removed). Returns the same object when nothing would
 * change, so callers can skip a re-render and a localStorage write.
 */
export function moveStatusDashboardCard(
  layout: StatusDashboardLayout,
  id: string,
  columnId: string,
  index: number
): StatusDashboardLayout {
  const moving = findPlacement(layout, id)
  if (!moving || !findColumn(layout, columnId)) {
    return layout
  }
  const rest = layout.cards.filter((placement) => placement.id !== id)
  const inColumn = rest.filter((placement) => placement.column === columnId)
  const clampedIndex = Math.min(Math.max(index, 0), inColumn.length)

  if (moving.column === columnId) {
    const currentIndex = columnCardIds(layout, columnId).indexOf(id)
    if (currentIndex === clampedIndex) {
      return layout
    }
  }

  const next: StatusDashboardPlacement[] = []
  let seen = 0
  let inserted = false
  const relocated: StatusDashboardPlacement = { ...moving, column: columnId }

  for (const placement of rest) {
    if (placement.column === columnId) {
      if (seen === clampedIndex && !inserted) {
        next.push(relocated)
        inserted = true
      }
      seen += 1
    }
    next.push(placement)
  }
  if (!inserted) {
    next.push(relocated)
  }
  return { version: layout.version, columns: layout.columns, cards: next }
}

let columnIdCounter = 0

function mintColumnId(layout: StatusDashboardLayout): string {
  let candidate: string
  do {
    columnIdCounter += 1
    candidate = `col-${columnIdCounter}`
  } while (layout.columns.some((column) => column.id === candidate))
  return candidate
}

/**
 * Split a new column into `band` at position `at` (counted in that band's
 * column list) and move `id` into it.
 *
 * The new column takes its width from the band's free space where there is
 * any, and otherwise halves its right-hand neighbour — the neighbour is the
 * column the operator just dropped a card next to, so it is the one they are
 * looking at and the one whose change they will understand.
 */
export function splitStatusDashboardColumn(
  layout: StatusDashboardLayout,
  id: string,
  region: StatusDashboardRegionId,
  band: number,
  at: number
): StatusDashboardLayout {
  if (!findPlacement(layout, id)) {
    return layout
  }
  const bands = regionBands(layout, region)
  const target = bands.find((entry) => entry.band === band)
  const siblings = target?.columns ?? []
  const clampedAt = Math.min(Math.max(at, 0), siblings.length)
  const free = target ? bandFreeSpan(target) : STATUS_DASHBOARD_GRID_COLUMNS

  let span = free
  const columns = layout.columns.map((column) => ({ ...column }))
  if (span < 2) {
    // No room: take half of the widest sibling that can afford to give.
    const donor = [...siblings].sort((a, b) => b.span - a.span)[0]
    if (!donor || donor.span < 2) {
      return layout
    }
    const donated = Math.floor(donor.span / 2)
    span = donated
    const donorEntry = columns.find((column) => column.id === donor.id)
    if (donorEntry) {
      donorEntry.span = donor.span - donated
    }
  }

  const newColumn: StatusDashboardColumn = {
    id: mintColumnId(layout),
    region,
    band,
    span: clampSpan(span),
    flow: 'stack'
  }

  // Splice into the layout's column array so the band's left-to-right order
  // matches where the operator dropped.
  const anchor = siblings[clampedAt]
  const insertIndex = anchor
    ? columns.findIndex((column) => column.id === anchor.id)
    : columns.length
  columns.splice(insertIndex < 0 ? columns.length : insertIndex, 0, newColumn)

  const next: StatusDashboardLayout = { version: layout.version, columns, cards: layout.cards }
  return moveStatusDashboardCard(next, id, newColumn.id, 0)
}

/**
 * Open a brand new band at `band` in `region`, pushing every band at or below
 * it down one, and move `id` into a full-width column on it.
 */
export function insertStatusDashboardBand(
  layout: StatusDashboardLayout,
  id: string,
  region: StatusDashboardRegionId,
  band: number
): StatusDashboardLayout {
  if (!findPlacement(layout, id)) {
    return layout
  }
  const columns = layout.columns.map((column) =>
    column.region === region && column.band >= band ? { ...column, band: column.band + 1 } : { ...column }
  )
  const newColumn: StatusDashboardColumn = {
    id: mintColumnId(layout),
    region,
    band,
    span: STATUS_DASHBOARD_GRID_COLUMNS,
    flow: 'stack'
  }
  columns.push(newColumn)
  const next: StatusDashboardLayout = { version: layout.version, columns, cards: layout.cards }
  return moveStatusDashboardCard(next, id, newColumn.id, 0)
}

/**
 * Set a column's width. Growing steals from the band's free space first and
 * then from the next column along; shrinking simply hands the space back and
 * is allowed to leave a gap — that is the point of "place them how I please".
 */
export function resizeStatusDashboardColumn(
  layout: StatusDashboardLayout,
  columnId: string,
  span: number
): StatusDashboardLayout {
  const column = findColumn(layout, columnId)
  if (!column) {
    return layout
  }
  const band = regionBands(layout, column.region).find((entry) => entry.band === column.band)
  if (!band) {
    return layout
  }
  const others = band.columns.filter((entry) => entry.id !== columnId)
  const otherTotal = others.reduce((total, entry) => total + entry.span, 0)
  // Never let a band overflow 12 — a wrapped band is a broken-looking page,
  // and it is the one arrangement the operator cannot see themselves making.
  const maxSpan = Math.max(1, STATUS_DASHBOARD_GRID_COLUMNS - otherTotal)
  const wanted = Math.min(clampSpan(span), STATUS_DASHBOARD_GRID_COLUMNS)

  if (wanted <= maxSpan) {
    if (wanted === column.span) {
      return layout
    }
    return {
      version: layout.version,
      columns: layout.columns.map((entry) => (entry.id === columnId ? { ...entry, span: wanted } : entry)),
      cards: layout.cards
    }
  }

  // Growing past the free space: take the difference off the next column along
  // (wrapping to the previous one for the last column in the band).
  const position = band.columns.findIndex((entry) => entry.id === columnId)
  const neighbour = band.columns[position + 1] ?? band.columns[position - 1]
  if (!neighbour) {
    return layout
  }
  const take = Math.min(wanted - maxSpan, neighbour.span - 1)
  if (take <= 0) {
    return layout
  }
  const finalSpan = maxSpan + take
  if (finalSpan === column.span) {
    return layout
  }
  return {
    version: layout.version,
    columns: layout.columns.map((entry) => {
      if (entry.id === columnId) {
        return { ...entry, span: finalSpan }
      }
      if (entry.id === neighbour.id) {
        return { ...entry, span: entry.span - take }
      }
      return entry
    }),
    cards: layout.cards
  }
}

/** Flip a column between stacking its cards and shelving them side by side. */
export function toggleStatusDashboardColumnFlow(
  layout: StatusDashboardLayout,
  columnId: string
): StatusDashboardLayout {
  const column = findColumn(layout, columnId)
  if (!column) {
    return layout
  }
  return {
    version: layout.version,
    columns: layout.columns.map((entry) =>
      entry.id === columnId ? { ...entry, flow: entry.flow === 'stack' ? 'shelf' : 'stack' } : entry
    ),
    cards: layout.cards
  }
}

/** Every column of a region in visual order: band by band, left to right. */
export function orderedColumns(layout: StatusDashboardLayout): StatusDashboardColumn[] {
  return STATUS_DASHBOARD_REGION_IDS.flatMap((region) =>
    regionBands(layout, region).flatMap((band) => band.columns)
  )
}

/** Step a card one slot earlier/later inside its own column. The keyboard path. */
export function nudgeStatusDashboardCard(
  layout: StatusDashboardLayout,
  id: string,
  delta: -1 | 1
): StatusDashboardLayout {
  const placement = findPlacement(layout, id)
  if (!placement) {
    return layout
  }
  const index = columnCardIds(layout, placement.column).indexOf(id)
  return moveStatusDashboardCard(layout, id, placement.column, index + delta)
}

/**
 * Move a card to the neighbouring column in visual order, keeping roughly its
 * vertical slot. Walks across bands and into the sidebar, so the keyboard can
 * reach every column the pointer can.
 */
export function shiftStatusDashboardCardColumn(
  layout: StatusDashboardLayout,
  id: string,
  delta: -1 | 1
): StatusDashboardLayout {
  const placement = findPlacement(layout, id)
  if (!placement) {
    return layout
  }
  const order = orderedColumns(layout)
  const position = order.findIndex((column) => column.id === placement.column)
  const target = order[position + delta]
  if (!target) {
    return layout
  }
  const index = columnCardIds(layout, placement.column).indexOf(id)
  return moveStatusDashboardCard(layout, id, target.id, index)
}

/** Widen/narrow the column a card lives in. The keyboard path for width. */
export function nudgeStatusDashboardCardWidth(
  layout: StatusDashboardLayout,
  id: string,
  delta: -1 | 1
): StatusDashboardLayout {
  const placement = findPlacement(layout, id)
  if (!placement) {
    return layout
  }
  const column = findColumn(layout, placement.column)
  if (!column) {
    return layout
  }
  return resizeStatusDashboardColumn(layout, column.id, column.span + delta)
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
    columns: layout.columns,
    cards: layout.cards.map((entry) =>
      entry.id === id
        ? next === undefined
          ? { id: entry.id, column: entry.column }
          : { ...entry, heightRows: next }
        : entry
    )
  }
}

/**
 * Tidy up: the way out of a mess that is not a full Reset.
 *
 * Drops empty columns, closes the gaps that leaves in the band numbering, and
 * spreads each band's columns evenly across the full 12 so no band is left
 * with a ragged right edge. Card ORDER and which-card-is-with-which is
 * untouched — the operator keeps the arrangement they built, it just stops
 * looking accidental.
 */
export function tidyStatusDashboardLayout(layout: StatusDashboardLayout): StatusDashboardLayout {
  const occupied = new Set(layout.cards.map((placement) => placement.column))
  const kept = layout.columns.filter((column) => occupied.has(column.id))
  if (kept.length === 0) {
    return layout
  }

  const columns: StatusDashboardColumn[] = []
  for (const region of STATUS_DASHBOARD_REGION_IDS) {
    const bands = regionBands({ ...layout, columns: kept }, region)
    for (const [bandIndex, band] of bands.entries()) {
      const count = band.columns.length
      const base = Math.floor(STATUS_DASHBOARD_GRID_COLUMNS / count)
      // The remainder goes to the leftmost columns, so a 5-column band reads
      // 3/3/2/2/2 rather than trailing a 2 the operator did not ask for.
      const remainder = STATUS_DASHBOARD_GRID_COLUMNS - base * count
      for (const [index, column] of band.columns.entries()) {
        columns.push({ ...column, band: bandIndex, span: clampSpan(base + (index < remainder ? 1 : 0)) })
      }
    }
  }

  const same =
    columns.length === layout.columns.length &&
    columns.every((column) => {
      const before = layout.columns.find((entry) => entry.id === column.id)
      return before && before.band === column.band && before.span === column.span
    })
  if (same) {
    return layout
  }
  return { version: layout.version, columns, cards: layout.cards }
}

/** True when the layout is the shipped default — used to hide "Reset layout". */
export function isDefaultStatusDashboardLayout(
  layout: StatusDashboardLayout,
  specs: readonly StatusDashboardCardSpec[]
): boolean {
  if (layout.columns.length !== DEFAULT_STATUS_DASHBOARD_COLUMNS.length) {
    return false
  }
  const columnsMatch = layout.columns.every((column, index) => {
    const expected = DEFAULT_STATUS_DASHBOARD_COLUMNS[index]
    return (
      expected !== undefined &&
      expected.id === column.id &&
      expected.region === column.region &&
      expected.band === column.band &&
      expected.span === column.span &&
      expected.flow === column.flow
    )
  })
  if (!columnsMatch || layout.cards.length !== specs.length) {
    return false
  }
  return layout.cards.every((placement, index) => {
    const spec = specs[index]
    return (
      spec !== undefined &&
      spec.id === placement.id &&
      spec.column === placement.column &&
      placement.heightRows === undefined
    )
  })
}

// ── Drop-target hit testing ───────────────────────────────────────────────
//
// Hit testing is a PURE function over a geometry SNAPSHOT taken once, at
// pointer-down. That is the whole clunkiness fix in one sentence: v1 called
// `document.elementFromPoint` plus `getBoundingClientRect` on every pointermove
// and inserted a real element to show the drop position, so the page reflowed
// under the cursor and the geometry it had just measured went stale. Here the
// drag never changes layout, so a single snapshot stays true for the whole
// gesture — and the hit test becomes arithmetic, testable off the DOM.

export interface StatusDashboardRect {
  left: number
  top: number
  right: number
  bottom: number
}

export interface StatusDashboardColumnGeometry {
  id: string
  region: StatusDashboardRegionId
  band: number
  rect: StatusDashboardRect
  /** Rects of the cards in this column, in render order, with their ids. */
  cards: { id: string; rect: StatusDashboardRect }[]
}

export interface StatusDashboardGeometry {
  regions: { region: StatusDashboardRegionId; rect: StatusDashboardRect }[]
  columns: StatusDashboardColumnGeometry[]
}

export type StatusDashboardDropTarget =
  | { kind: 'column'; columnId: string; index: number }
  | { kind: 'new-column'; region: StatusDashboardRegionId; band: number; at: number }
  | { kind: 'new-band'; region: StatusDashboardRegionId; band: number }

/**
 * How far OUTSIDE a column edge still counts as "make a new column here", in
 * px — the gutter between two columns is 14px, so this widens it to a target
 * you can actually hit.
 */
export const STATUS_DASHBOARD_GUTTER_PX = 16
/**
 * How far INSIDE a column edge counts as the gutter. Deliberately tiny: an
 * earlier version used the full gutter width on both sides, which turned the
 * last 16px of every card into a new-column zone and made dropping onto the
 * right-hand card of a shelf nearly impossible.
 */
export const STATUS_DASHBOARD_GUTTER_INSET_PX = 6
/** How close to a band edge counts as "make a new band here", in px. */
export const STATUS_DASHBOARD_BAND_EDGE_PX = 16

function contains(rect: StatusDashboardRect, x: number, y: number): boolean {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
}

function distanceTo(rect: StatusDashboardRect, x: number, y: number): number {
  const dx = Math.max(rect.left - x, 0, x - rect.right)
  const dy = Math.max(rect.top - y, 0, y - rect.bottom)
  return Math.hypot(dx, dy)
}

/**
 * Where a card dropped at (x, y) would land.
 *
 * Deliberately never returns undefined for a pointer that is anywhere near the
 * dashboard: a drag that ends slightly outside a column should still do the
 * obvious thing rather than silently snap back, which is a large part of what
 * made v1 feel unresponsive. Only a pointer with no region at all — a drag off
 * the top of the page — yields undefined, and the caller treats that as cancel.
 */
export function resolveStatusDashboardDrop(
  geometry: StatusDashboardGeometry,
  x: number,
  y: number,
  draggedId: string
): StatusDashboardDropTarget | undefined {
  if (geometry.regions.length === 0) {
    return undefined
  }
  const region =
    geometry.regions.find((entry) => contains(entry.rect, x, y)) ??
    [...geometry.regions].sort((a, b) => distanceTo(a.rect, x, y) - distanceTo(b.rect, x, y))[0]
  if (!region) {
    return undefined
  }

  const columns = geometry.columns.filter((column) => column.region === region.region)
  if (columns.length === 0) {
    return { kind: 'new-band', region: region.region, band: 0 }
  }

  // Group into bands, top to bottom.
  const bandNumbers = [...new Set(columns.map((column) => column.band))].sort((a, b) => a - b)
  const bands = bandNumbers.map((band) => {
    const inBand = columns
      .filter((column) => column.band === band)
      .sort((a, b) => a.rect.left - b.rect.left)
    return {
      band,
      columns: inBand,
      top: Math.min(...inBand.map((column) => column.rect.top)),
      bottom: Math.max(...inBand.map((column) => column.rect.bottom))
    }
  })

  // Above the first band, below the last, or in the gap between two: a new
  // full-width band. The threshold is small so the common case — dropping into
  // a column — stays easy to hit.
  const first = bands[0]!
  const last = bands[bands.length - 1]!
  if (y < first.top - STATUS_DASHBOARD_BAND_EDGE_PX) {
    return { kind: 'new-band', region: region.region, band: first.band }
  }
  if (y > last.bottom + STATUS_DASHBOARD_BAND_EDGE_PX) {
    return { kind: 'new-band', region: region.region, band: last.band + 1 }
  }
  for (let index = 0; index < bands.length - 1; index += 1) {
    const above = bands[index]!
    const below = bands[index + 1]!
    if (y > above.bottom + STATUS_DASHBOARD_BAND_EDGE_PX && y < below.top - STATUS_DASHBOARD_BAND_EDGE_PX) {
      return { kind: 'new-band', region: region.region, band: below.band }
    }
  }

  // Pick the band the pointer is in, or the nearest one vertically.
  const band =
    bands.find((entry) => y >= entry.top - STATUS_DASHBOARD_BAND_EDGE_PX && y <= entry.bottom + STATUS_DASHBOARD_BAND_EDGE_PX) ??
    [...bands].sort(
      (a, b) =>
        Math.min(Math.abs(y - a.top), Math.abs(y - a.bottom)) -
        Math.min(Math.abs(y - b.top), Math.abs(y - b.bottom))
    )[0]!

  // Gutters: in the space between two columns — or just off either end of the
  // band — means "open a new column here".
  for (const [index, column] of band.columns.entries()) {
    if (
      x >= column.rect.left - STATUS_DASHBOARD_GUTTER_PX &&
      x <= column.rect.left + STATUS_DASHBOARD_GUTTER_INSET_PX
    ) {
      return { kind: 'new-column', region: region.region, band: band.band, at: index }
    }
  }
  const rightmost = band.columns[band.columns.length - 1]!
  if (x >= rightmost.rect.right - STATUS_DASHBOARD_GUTTER_INSET_PX) {
    return { kind: 'new-column', region: region.region, band: band.band, at: band.columns.length }
  }

  const column =
    band.columns.find((entry) => x >= entry.rect.left && x <= entry.rect.right) ??
    [...band.columns].sort(
      (a, b) =>
        Math.min(Math.abs(x - a.rect.left), Math.abs(x - a.rect.right)) -
        Math.min(Math.abs(x - b.rect.left), Math.abs(x - b.rect.right))
    )[0]!

  // Index within the column: how many of the OTHER cards have their midpoint
  // above the pointer. A shelf column compares horizontally instead, because
  // its cards sit side by side.
  const others = column.cards.filter((card) => card.id !== draggedId)
  let index = 0
  for (const card of others) {
    const shelf = others.length > 1 && others.some((other) => other !== card && Math.abs(other.rect.top - card.rect.top) < 8)
    const midpoint = shelf
      ? (card.rect.left + card.rect.right) / 2
      : (card.rect.top + card.rect.bottom) / 2
    if ((shelf ? x : y) > midpoint) {
      index += 1
    }
  }
  return { kind: 'column', columnId: column.id, index }
}

/** Apply a resolved drop target to a layout. */
export function applyStatusDashboardDrop(
  layout: StatusDashboardLayout,
  id: string,
  target: StatusDashboardDropTarget
): StatusDashboardLayout {
  if (target.kind === 'column') {
    return moveStatusDashboardCard(layout, id, target.columnId, target.index)
  }
  if (target.kind === 'new-column') {
    return splitStatusDashboardColumn(layout, id, target.region, target.band, target.at)
  }
  return insertStatusDashboardBand(layout, id, target.region, target.band)
}
