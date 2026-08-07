import { describe, expect, it } from 'vitest'

import {
  DEFAULT_STATUS_DASHBOARD_COLUMNS,
  STATUS_DASHBOARD_GRID_COLUMNS,
  STATUS_DASHBOARD_LAYOUT_VERSION,
  STATUS_DASHBOARD_MAX_ROWS,
  STATUS_DASHBOARD_MIN_ROWS,
  applyStatusDashboardDrop,
  bandFreeSpan,
  columnCardIds,
  columnStartLine,
  defaultStatusDashboardLayout,
  insertStatusDashboardBand,
  isDefaultStatusDashboardLayout,
  moveStatusDashboardCard,
  nudgeStatusDashboardCard,
  nudgeStatusDashboardCardWidth,
  parseStoredStatusDashboardLayout,
  reconcileStatusDashboardLayout,
  regionBands,
  resizeStatusDashboardCard,
  resizeStatusDashboardColumn,
  resolveStatusDashboardDrop,
  shiftStatusDashboardCardColumn,
  splitStatusDashboardColumn,
  tidyStatusDashboardLayout,
  toggleStatusDashboardColumnFlow,
  type StatusDashboardCardSpec,
  type StatusDashboardGeometry
} from './status-dashboard-layout'

/**
 * The default card set with both conditional sensor cards present. This mirrors
 * `statusDashboardSpecs` in App.tsx, which is the page exactly as it ships:
 * GPS + the two advanced sensors in one shelf, Pre-arm/Statistics and Recent
 * Notices in the two status columns below it, and System Info leading the
 * sidebar above Instruments and Guided setup.
 */
const specsWithSensors: StatusDashboardCardSpec[] = [
  { id: 'gps', label: 'GPS', column: 'sensors' },
  { id: 'rangefinder', label: 'Rangefinder', column: 'sensors' },
  { id: 'optical-flow', label: 'Optical Flow', column: 'sensors' },
  { id: 'prearm', label: 'Pre-arm', column: 'midcol' },
  { id: 'statistics', label: 'Statistics', column: 'midcol' },
  { id: 'notices', label: 'Recent Notices', column: 'noticecol' },
  { id: 'system-info', label: 'System Info', column: 'sidebar' },
  { id: 'instruments', label: 'Instruments', column: 'sidebar' },
  { id: 'guided-setup', label: 'Guided setup', column: 'sidebar' }
]

/** The same page with the sensors unconfigured — those two cards do not exist. */
const specsWithoutSensors = specsWithSensors.filter(
  (spec) => spec.id !== 'rangefinder' && spec.id !== 'optical-flow'
)

describe('defaultStatusDashboardLayout', () => {
  it('describes the shipped arrangement, one placement per card', () => {
    const layout = defaultStatusDashboardLayout(specsWithSensors)
    expect(layout.version).toBe(STATUS_DASHBOARD_LAYOUT_VERSION)
    expect(columnCardIds(layout, 'sensors')).toEqual(['gps', 'rangefinder', 'optical-flow'])
    expect(columnCardIds(layout, 'midcol')).toEqual(['prearm', 'statistics'])
    expect(columnCardIds(layout, 'noticecol')).toEqual(['notices'])
    expect(columnCardIds(layout, 'sidebar')).toEqual(['system-info', 'instruments', 'guided-setup'])
    expect(layout.cards.every((placement) => placement.heightRows === undefined)).toBe(true)
  })

  it('lays the default columns out exactly as the pre-dashboard page did', () => {
    // This is the arithmetic behind "the default renders identically to main".
    // The sensor shelf is the full width; the two status columns are half each,
    // which with a uniform gutter is the same width as the `auto-fit` pair they
    // replaced; the sidebar fills its own region.
    const layout = defaultStatusDashboardLayout(specsWithSensors)
    const main = regionBands(layout, 'main')
    expect(main.map((band) => band.columns.map((column) => column.id))).toEqual([
      ['sensors'],
      ['midcol', 'noticecol']
    ])
    expect(main[0]!.columns[0]!.span).toBe(STATUS_DASHBOARD_GRID_COLUMNS)
    expect(main[1]!.columns.map((column) => column.span)).toEqual([6, 6])
    // Explicit start lines, so a band that does not add up to 12 leaves its
    // free space at the right instead of the grid repacking the row.
    expect(columnStartLine(main[1]!, 'midcol')).toBe(1)
    expect(columnStartLine(main[1]!, 'noticecol')).toBe(7)
    expect(bandFreeSpan(main[1]!)).toBe(0)

    const side = regionBands(layout, 'side')
    expect(side.map((band) => band.columns.map((column) => column.id))).toEqual([['sidebar']])

    // The sensor shelf flows across, not down — that is why a sensor card that
    // appears mid-session lands BESIDE its neighbours.
    expect(main[0]!.columns[0]!.flow).toBe('shelf')
    expect(main[1]!.columns.every((column) => column.flow === 'stack')).toBe(true)
  })
})

describe('parseStoredStatusDashboardLayout', () => {
  it('rejects anything it cannot fully trust', () => {
    expect(parseStoredStatusDashboardLayout(null)).toBeUndefined()
    expect(parseStoredStatusDashboardLayout('')).toBeUndefined()
    expect(parseStoredStatusDashboardLayout('{"version":2,"columns":[{"id":"a"')).toBeUndefined()
    expect(parseStoredStatusDashboardLayout('[]')).toBeUndefined()
    expect(parseStoredStatusDashboardLayout('{"version":2}')).toBeUndefined()
    // A layout with no columns at all cannot render anything.
    expect(parseStoredStatusDashboardLayout('{"version":2,"columns":[],"cards":[]}')).toBeUndefined()
  })

  it('discards a layout saved by the zone model, rather than half-reading it', () => {
    // v1 stored `{version:1, cards:[{id, zone}]}`. There are no columns in it
    // to migrate, so those operators get the (unchanged) default back.
    const v1 = JSON.stringify({ version: 1, cards: [{ id: 'gps', zone: 'sidebar' }] })
    expect(parseStoredStatusDashboardLayout(v1)).toBeUndefined()
  })

  it('keeps the good entries and clamps the suspicious ones', () => {
    const parsed = parseStoredStatusDashboardLayout(
      JSON.stringify({
        version: STATUS_DASHBOARD_LAYOUT_VERSION,
        columns: [
          { id: 'a', region: 'main', band: 0, span: 99, flow: 'shelf' },
          { id: 'b', region: 'nowhere', band: -4, span: 0, flow: 'sideways' },
          { id: 'a', region: 'main', band: 0, span: 4 },
          { notAnId: true }
        ],
        cards: [
          { id: 'gps', column: 'a', heightRows: 9000 },
          { id: 'prearm', column: 'ghost-column' },
          { id: 'gps', column: 'b' },
          { column: 'a' }
        ]
      })
    )
    expect(parsed?.columns.map((column) => column.id)).toEqual(['a', 'b'])
    expect(parsed?.columns[0]).toMatchObject({ span: STATUS_DASHBOARD_GRID_COLUMNS, flow: 'shelf' })
    // Bad region/band/span/flow are repaired rather than thrown away.
    expect(parsed?.columns[1]).toMatchObject({ region: 'main', band: 0, span: 1, flow: 'stack' })
    expect(parsed?.cards.map((card) => card.id)).toEqual(['gps', 'prearm'])
    expect(parsed?.cards[0]?.heightRows).toBe(STATUS_DASHBOARD_MAX_ROWS)
    // A card naming a column that does not exist is re-homed, not dropped.
    expect(parsed?.cards[1]?.column).toBe('a')
  })
})

describe('reconcileStatusDashboardLayout', () => {
  it('falls back to the default when there is nothing stored', () => {
    const layout = reconcileStatusDashboardLayout(undefined, specsWithSensors)
    expect(isDefaultStatusDashboardLayout(layout, specsWithSensors)).toBe(true)
  })

  it('drops placements for cards that are not on the page', () => {
    const saved = defaultStatusDashboardLayout(specsWithSensors)
    const layout = reconcileStatusDashboardLayout(saved, specsWithoutSensors)
    expect(columnCardIds(layout, 'sensors')).toEqual(['gps'])
    expect(layout.cards).toHaveLength(specsWithoutSensors.length)
  })

  it('lands a sensor card that reappears beside the neighbour it belongs to', () => {
    // The conditional-card contract, and the case that actually bites: an
    // operator drags GPS somewhere, then plugs a rangefinder in.
    const moved = moveStatusDashboardCard(
      defaultStatusDashboardLayout(specsWithoutSensors),
      'gps',
      'midcol',
      0
    )
    const layout = reconcileStatusDashboardLayout(moved, specsWithSensors)
    expect(layout.cards).toHaveLength(specsWithSensors.length)
    // Rangefinder and optical flow follow GPS into midcol, directly after it,
    // rather than being orphaned at the end of the page.
    expect(columnCardIds(layout, 'midcol')).toEqual([
      'gps',
      'rangefinder',
      'optical-flow',
      'prearm',
      'statistics'
    ])
  })

  it('keeps a column the operator emptied, so a returning card has its room', () => {
    const emptied = moveStatusDashboardCard(
      defaultStatusDashboardLayout(specsWithSensors),
      'notices',
      'midcol',
      0
    )
    const layout = reconcileStatusDashboardLayout(emptied, specsWithSensors)
    expect(layout.columns.map((column) => column.id)).toContain('noticecol')
    expect(columnCardIds(layout, 'noticecol')).toEqual([])
  })

  it('re-homes a card whose column the operator deleted', () => {
    const saved = defaultStatusDashboardLayout(specsWithSensors)
    const withoutSidebar = {
      ...saved,
      columns: saved.columns.filter((column) => column.id !== 'sidebar')
    }
    const layout = reconcileStatusDashboardLayout(withoutSidebar, specsWithSensors)
    expect(layout.cards).toHaveLength(specsWithSensors.length)
    const columnIds = new Set(layout.columns.map((column) => column.id))
    expect(layout.cards.every((placement) => columnIds.has(placement.column))).toBe(true)
  })

  it('never loses or duplicates a card, whatever it is handed', () => {
    const nonsense = {
      version: STATUS_DASHBOARD_LAYOUT_VERSION,
      columns: [{ id: 'only', region: 'main' as const, band: 0, span: 12, flow: 'stack' as const }],
      cards: [{ id: 'ghost', column: 'only' }]
    }
    const layout = reconcileStatusDashboardLayout(nonsense, specsWithSensors)
    const ids = layout.cards.map((placement) => placement.id).sort()
    expect(ids).toEqual(specsWithSensors.map((spec) => spec.id).sort())
  })
})

describe('moveStatusDashboardCard', () => {
  it('moves a card into another column at the requested index', () => {
    const layout = moveStatusDashboardCard(
      defaultStatusDashboardLayout(specsWithSensors),
      'system-info',
      'midcol',
      1
    )
    expect(columnCardIds(layout, 'midcol')).toEqual(['prearm', 'system-info', 'statistics'])
    expect(columnCardIds(layout, 'sidebar')).toEqual(['instruments', 'guided-setup'])
  })

  it('clamps an out-of-range index instead of dropping the card', () => {
    const layout = moveStatusDashboardCard(
      defaultStatusDashboardLayout(specsWithSensors),
      'gps',
      'sidebar',
      99
    )
    expect(columnCardIds(layout, 'sidebar')).toEqual([
      'system-info',
      'instruments',
      'guided-setup',
      'gps'
    ])
  })

  it('returns the SAME object for a no-op, so nothing re-renders or is persisted', () => {
    const before = defaultStatusDashboardLayout(specsWithSensors)
    expect(moveStatusDashboardCard(before, 'prearm', 'midcol', 0)).toBe(before)
    expect(moveStatusDashboardCard(before, 'not-a-card', 'midcol', 0)).toBe(before)
    expect(moveStatusDashboardCard(before, 'prearm', 'not-a-column', 0)).toBe(before)
  })
})

describe('columns: the freedom the zone model did not have', () => {
  it('opens a new column in a band, taking the free space when there is any', () => {
    const start = resizeStatusDashboardColumn(defaultStatusDashboardLayout(specsWithSensors), 'midcol', 4)
    const band = regionBands(start, 'main').find((entry) => entry.band === 1)!
    expect(bandFreeSpan(band)).toBe(2)

    const layout = splitStatusDashboardColumn(start, 'system-info', 'main', 1, 2)
    const after = regionBands(layout, 'main').find((entry) => entry.band === 1)!
    expect(after.columns).toHaveLength(3)
    const created = after.columns[2]!
    expect(created.span).toBe(2)
    expect(columnCardIds(layout, created.id)).toEqual(['system-info'])
    // The columns that were already there are untouched.
    expect(after.columns[0]!.span).toBe(4)
    expect(after.columns[1]!.span).toBe(6)
  })

  it('halves the widest neighbour when a band is already full', () => {
    const layout = splitStatusDashboardColumn(
      defaultStatusDashboardLayout(specsWithSensors),
      'system-info',
      'main',
      1,
      0
    )
    const band = regionBands(layout, 'main').find((entry) => entry.band === 1)!
    expect(band.columns.map((column) => column.span)).toEqual([3, 3, 6])
    expect(band.columns.reduce((total, column) => total + column.span, 0)).toBe(
      STATUS_DASHBOARD_GRID_COLUMNS
    )
  })

  it('opens a new band and pushes the bands below it down', () => {
    const layout = insertStatusDashboardBand(
      defaultStatusDashboardLayout(specsWithSensors),
      'notices',
      'main',
      1
    )
    const bands = regionBands(layout, 'main')
    expect(bands.map((band) => band.band)).toEqual([0, 1, 2])
    expect(bands[0]!.columns.map((column) => column.id)).toEqual(['sensors'])
    expect(columnCardIds(layout, bands[1]!.columns[0]!.id)).toEqual(['notices'])
    expect(bands[1]!.columns[0]!.span).toBe(STATUS_DASHBOARD_GRID_COLUMNS)
    expect(bands[2]!.columns.map((column) => column.id)).toEqual(['midcol', 'noticecol'])
  })

  it('resizes a column, taking from the next one along once the band is full', () => {
    const layout = resizeStatusDashboardColumn(
      defaultStatusDashboardLayout(specsWithSensors),
      'midcol',
      9
    )
    const band = regionBands(layout, 'main').find((entry) => entry.band === 1)!
    expect(band.columns.map((column) => [column.id, column.span])).toEqual([
      ['midcol', 9],
      ['noticecol', 3]
    ])
    // A band can never overflow 12: that is the one arrangement the operator
    // cannot see themselves making, and it wraps into a broken-looking page.
    expect(band.columns.reduce((total, column) => total + column.span, 0)).toBeLessThanOrEqual(
      STATUS_DASHBOARD_GRID_COLUMNS
    )
  })

  it('never squeezes a neighbour out of existence', () => {
    const layout = resizeStatusDashboardColumn(
      defaultStatusDashboardLayout(specsWithSensors),
      'midcol',
      STATUS_DASHBOARD_GRID_COLUMNS
    )
    const band = regionBands(layout, 'main').find((entry) => entry.band === 1)!
    expect(band.columns.map((column) => column.span)).toEqual([11, 1])
  })

  it('lets a shrink leave a gap — a mess the operator made is allowed', () => {
    const layout = resizeStatusDashboardColumn(
      defaultStatusDashboardLayout(specsWithSensors),
      'noticecol',
      2
    )
    const band = regionBands(layout, 'main').find((entry) => entry.band === 1)!
    expect(bandFreeSpan(band)).toBe(4)
    expect(columnStartLine(band, 'noticecol')).toBe(7)
  })

  it('flips a column between stacking and shelving', () => {
    const layout = toggleStatusDashboardColumnFlow(
      defaultStatusDashboardLayout(specsWithSensors),
      'midcol'
    )
    expect(layout.columns.find((column) => column.id === 'midcol')?.flow).toBe('shelf')
  })
})

describe('applyStatusDashboardDrop', () => {
  it('routes each kind of drop target to the right transform', () => {
    const start = defaultStatusDashboardLayout(specsWithSensors)

    const moved = applyStatusDashboardDrop(start, 'gps', {
      kind: 'column',
      columnId: 'midcol',
      index: 0
    })
    expect(columnCardIds(moved, 'midcol')).toEqual(['gps', 'prearm', 'statistics'])

    const split = applyStatusDashboardDrop(start, 'gps', {
      kind: 'new-column',
      region: 'main',
      band: 1,
      at: 0
    })
    expect(regionBands(split, 'main').find((band) => band.band === 1)!.columns).toHaveLength(3)

    const banded = applyStatusDashboardDrop(start, 'gps', { kind: 'new-band', region: 'main', band: 0 })
    expect(regionBands(banded, 'main')).toHaveLength(3)
  })
})

describe('keyboard transforms', () => {
  it('nudges a card inside its column', () => {
    const layout = nudgeStatusDashboardCard(defaultStatusDashboardLayout(specsWithSensors), 'statistics', -1)
    expect(columnCardIds(layout, 'midcol')).toEqual(['statistics', 'prearm'])
  })

  it('walks a card across every column in visual order, bands and sidebar included', () => {
    const start = defaultStatusDashboardLayout(specsWithSensors)
    // Visual order is sensors, midcol, noticecol, then the sidebar — so one
    // step right out of noticecol reaches the sidebar, which the zone model
    // could also do, and one step right out of sensors reaches midcol, which
    // means the keyboard can cross a BAND boundary.
    const intoMid = shiftStatusDashboardCardColumn(start, 'gps', 1)
    expect(columnCardIds(intoMid, 'midcol')).toEqual(['gps', 'prearm', 'statistics'])

    const intoSidebar = shiftStatusDashboardCardColumn(start, 'notices', 1)
    expect(columnCardIds(intoSidebar, 'sidebar')).toEqual([
      'notices',
      'system-info',
      'instruments',
      'guided-setup'
    ])
  })

  it('refuses to walk a card off either end', () => {
    const start = defaultStatusDashboardLayout(specsWithSensors)
    expect(shiftStatusDashboardCardColumn(start, 'gps', -1)).toBe(start)
    expect(shiftStatusDashboardCardColumn(start, 'guided-setup', 1)).toBe(start)
  })

  it('changes the width of the column a card sits in', () => {
    const layout = nudgeStatusDashboardCardWidth(
      defaultStatusDashboardLayout(specsWithSensors),
      'prearm',
      1
    )
    expect(layout.columns.find((column) => column.id === 'midcol')?.span).toBe(7)
    expect(layout.columns.find((column) => column.id === 'noticecol')?.span).toBe(5)
  })
})

describe('resizeStatusDashboardCard', () => {
  it('snaps and clamps a height cap, and clears it with undefined', () => {
    const start = defaultStatusDashboardLayout(specsWithSensors)
    expect(resizeStatusDashboardCard(start, 'notices', 1).cards.find((card) => card.id === 'notices')?.heightRows).toBe(
      STATUS_DASHBOARD_MIN_ROWS
    )
    expect(
      resizeStatusDashboardCard(start, 'notices', 5000).cards.find((card) => card.id === 'notices')?.heightRows
    ).toBe(STATUS_DASHBOARD_MAX_ROWS)
    expect(
      resizeStatusDashboardCard(start, 'notices', Number.NaN).cards.find((card) => card.id === 'notices')?.heightRows
    ).toBe(STATUS_DASHBOARD_MIN_ROWS)

    const capped = resizeStatusDashboardCard(start, 'notices', 12)
    const cleared = resizeStatusDashboardCard(capped, 'notices', undefined)
    expect(cleared.cards.find((card) => card.id === 'notices')?.heightRows).toBeUndefined()
    expect(resizeStatusDashboardCard(start, 'notices', undefined)).toBe(start)
  })
})

describe('tidyStatusDashboardLayout', () => {
  it('drops emptied columns, closes the band gaps, and evens up the widths', () => {
    // Build a genuine mess: notices dragged out of its column into a new band,
    // leaving noticecol empty and band 1 half used.
    const messy = insertStatusDashboardBand(
      defaultStatusDashboardLayout(specsWithSensors),
      'notices',
      'main',
      2
    )
    expect(regionBands(messy, 'main')).toHaveLength(3)
    expect(columnCardIds(messy, 'noticecol')).toEqual([])

    const tidy = tidyStatusDashboardLayout(messy)
    const bands = regionBands(tidy, 'main')
    // The empty column is gone, the bands are renumbered contiguously, and
    // every band fills the full width.
    expect(tidy.columns.some((column) => column.id === 'noticecol')).toBe(false)
    expect(bands.map((band) => band.band)).toEqual([0, 1, 2])
    for (const band of bands) {
      expect(bandFreeSpan(band)).toBe(0)
    }
    // The arrangement the operator built is kept — only the geometry changed.
    expect(columnCardIds(tidy, 'midcol')).toEqual(['prearm', 'statistics'])
    expect(columnCardIds(tidy, 'sensors')).toEqual(['gps', 'rangefinder', 'optical-flow'])
  })

  it('gives the remainder to the leftmost columns of a band', () => {
    const start = defaultStatusDashboardLayout(specsWithSensors)
    const three = splitStatusDashboardColumn(start, 'system-info', 'main', 1, 2)
    const tidy = tidyStatusDashboardLayout(three)
    const band = regionBands(tidy, 'main').find((entry) => entry.band === 1)!
    expect(band.columns.map((column) => column.span)).toEqual([4, 4, 4])
  })

  it('is a no-op on a layout that is already tidy', () => {
    const start = defaultStatusDashboardLayout(specsWithSensors)
    expect(tidyStatusDashboardLayout(start)).toBe(start)
  })
})

describe('isDefaultStatusDashboardLayout', () => {
  it('is true only for the untouched default', () => {
    const start = defaultStatusDashboardLayout(specsWithSensors)
    expect(isDefaultStatusDashboardLayout(start, specsWithSensors)).toBe(true)
    expect(start.columns).toHaveLength(DEFAULT_STATUS_DASHBOARD_COLUMNS.length)
    expect(isDefaultStatusDashboardLayout(moveStatusDashboardCard(start, 'gps', 'sidebar', 0), specsWithSensors)).toBe(
      false
    )
    expect(isDefaultStatusDashboardLayout(resizeStatusDashboardCard(start, 'gps', 10), specsWithSensors)).toBe(false)
    // A width change alone counts: the page no longer looks like it shipped.
    expect(
      isDefaultStatusDashboardLayout(resizeStatusDashboardColumn(start, 'midcol', 8), specsWithSensors)
    ).toBe(false)
    expect(
      isDefaultStatusDashboardLayout(toggleStatusDashboardColumnFlow(start, 'midcol'), specsWithSensors)
    ).toBe(false)
  })
})

// ── Drop-target hit testing ───────────────────────────────────────────────
//
// The whole point of making this a pure function over a snapshot is that it is
// testable without a DOM, and that the drag itself does no layout reads. These
// rects are a plausible 1440px page: a full-width sensor shelf of three cards
// over two half-width status columns, with the sidebar to the right.

const geometry: StatusDashboardGeometry = {
  regions: [
    { region: 'main', rect: { left: 20, top: 300, right: 900, bottom: 900 } },
    { region: 'side', rect: { left: 920, top: 300, right: 1200, bottom: 900 } }
  ],
  columns: [
    {
      id: 'sensors',
      region: 'main',
      band: 0,
      rect: { left: 20, top: 300, right: 900, bottom: 500 },
      cards: [
        { id: 'gps', rect: { left: 20, top: 300, right: 300, bottom: 500 } },
        { id: 'rangefinder', rect: { left: 320, top: 300, right: 600, bottom: 420 } },
        { id: 'optical-flow', rect: { left: 620, top: 300, right: 900, bottom: 420 } }
      ]
    },
    {
      id: 'midcol',
      region: 'main',
      band: 1,
      rect: { left: 20, top: 520, right: 450, bottom: 800 },
      cards: [
        { id: 'prearm', rect: { left: 20, top: 520, right: 450, bottom: 650 } },
        { id: 'statistics', rect: { left: 20, top: 664, right: 450, bottom: 800 } }
      ]
    },
    {
      id: 'noticecol',
      region: 'main',
      band: 1,
      rect: { left: 470, top: 520, right: 900, bottom: 900 },
      cards: [{ id: 'notices', rect: { left: 470, top: 520, right: 900, bottom: 900 } }]
    },
    {
      id: 'sidebar',
      region: 'side',
      band: 0,
      rect: { left: 920, top: 300, right: 1200, bottom: 860 },
      cards: [
        { id: 'system-info', rect: { left: 920, top: 300, right: 1200, bottom: 480 } },
        { id: 'instruments', rect: { left: 920, top: 490, right: 1200, bottom: 670 } },
        { id: 'guided-setup', rect: { left: 920, top: 680, right: 1200, bottom: 860 } }
      ]
    }
  ]
}

describe('resolveStatusDashboardDrop', () => {
  it('drops into a column, above or below the card under the pointer', () => {
    // Above Statistics' midpoint: index 1, between Pre-arm and Statistics.
    expect(resolveStatusDashboardDrop(geometry, 200, 700, 'gps')).toEqual({
      kind: 'column',
      columnId: 'midcol',
      index: 1
    })
    // Below both midpoints: the end of the column.
    expect(resolveStatusDashboardDrop(geometry, 200, 790, 'gps')).toEqual({
      kind: 'column',
      columnId: 'midcol',
      index: 2
    })
    // Above Pre-arm's midpoint: the top of the column.
    expect(resolveStatusDashboardDrop(geometry, 200, 540, 'gps')).toEqual({
      kind: 'column',
      columnId: 'midcol',
      index: 0
    })
  })

  it('compares horizontally inside a shelf column, where cards sit side by side', () => {
    // Between GPS and the rangefinder in the sensor shelf.
    expect(resolveStatusDashboardDrop(geometry, 310, 400, 'notices')).toEqual({
      kind: 'column',
      columnId: 'sensors',
      index: 1
    })
    // 700 is left of optical flow's midpoint (760), so the card lands before it.
    expect(resolveStatusDashboardDrop(geometry, 700, 400, 'notices')).toEqual({
      kind: 'column',
      columnId: 'sensors',
      index: 2
    })
  })

  it('ignores the dragged card when counting slots, so a drag is a no-op where it started', () => {
    // Dragging Statistics and hovering its own place must resolve to index 1 —
    // where it already is — not index 2.
    expect(resolveStatusDashboardDrop(geometry, 200, 700, 'statistics')).toEqual({
      kind: 'column',
      columnId: 'midcol',
      index: 1
    })
  })

  it('opens a new column in the gutter between two', () => {
    expect(resolveStatusDashboardDrop(geometry, 462, 700, 'gps')).toEqual({
      kind: 'new-column',
      region: 'main',
      band: 1,
      at: 1
    })
    // Hard against the left edge of the first column: a new leading column.
    expect(resolveStatusDashboardDrop(geometry, 24, 700, 'gps')).toEqual({
      kind: 'new-column',
      region: 'main',
      band: 1,
      at: 0
    })
  })

  it('opens a new band above, below, and between the existing ones', () => {
    expect(resolveStatusDashboardDrop(geometry, 200, 260, 'notices')).toEqual({
      kind: 'new-band',
      region: 'main',
      band: 0
    })
    expect(resolveStatusDashboardDrop(geometry, 200, 950, 'gps')).toEqual({
      kind: 'new-band',
      region: 'main',
      band: 2
    })
  })

  it('keeps the sidebar and the main area apart', () => {
    expect(resolveStatusDashboardDrop(geometry, 1000, 400, 'gps')).toEqual({
      kind: 'column',
      columnId: 'sidebar',
      index: 1
    })
  })

  it('does the obvious thing for a pointer just outside everything', () => {
    // A release past the right-hand edge of the page must still land somewhere
    // sensible rather than snapping back, which is a large part of what made
    // the shipped version feel unresponsive. Here: the nearest region is the
    // sidebar, and past its right edge means a new column beside it.
    expect(resolveStatusDashboardDrop(geometry, 1400, 600, 'gps')).toEqual({
      kind: 'new-column',
      region: 'side',
      band: 0,
      at: 1
    })
  })

  it('does not treat the inside of the rightmost card as a gutter', () => {
    // The bug this guards: a 16px gutter applied on BOTH sides of every column
    // edge turned the last 16px of every card into a new-column zone, so the
    // right-hand card of the sensor shelf was nearly impossible to drop onto.
    expect(resolveStatusDashboardDrop(geometry, 880, 400, 'notices')).toEqual({
      kind: 'column',
      columnId: 'sensors',
      index: 3
    })
  })

  it('returns undefined only when there is no dashboard at all', () => {
    expect(resolveStatusDashboardDrop({ regions: [], columns: [] }, 10, 10, 'gps')).toBeUndefined()
  })
})
