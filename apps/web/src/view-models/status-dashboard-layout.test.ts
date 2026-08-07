import { describe, expect, it } from 'vitest'

import {
  STATUS_DASHBOARD_LAYOUT_VERSION,
  STATUS_DASHBOARD_MAX_ROWS,
  STATUS_DASHBOARD_MIN_ROWS,
  defaultStatusDashboardLayout,
  isDefaultStatusDashboardLayout,
  moveStatusDashboardCard,
  nudgeStatusDashboardCard,
  parseStoredStatusDashboardLayout,
  reconcileStatusDashboardLayout,
  resizeStatusDashboardCard,
  shiftStatusDashboardCardZone,
  zoneCardIds,
  type StatusDashboardCardSpec
} from './status-dashboard-layout'

/**
 * The default card set with both conditional sensor cards present. This mirrors
 * `statusDashboardSpecs` in App.tsx, which is the page exactly as it ships:
 * GPS + the two advanced sensors in one row, Pre-arm/Statistics and Recent
 * Notices in the two status columns below it, and System Info leading the
 * sidebar above Instruments and Guided setup.
 */
const specsWithSensors: StatusDashboardCardSpec[] = [
  { id: 'gps', label: 'GPS', zone: 'sensors' },
  { id: 'rangefinder', label: 'Rangefinder', zone: 'sensors' },
  { id: 'optical-flow', label: 'Optical Flow', zone: 'sensors' },
  { id: 'prearm', label: 'Pre-arm', zone: 'midcol' },
  { id: 'statistics', label: 'Statistics', zone: 'midcol' },
  { id: 'notices', label: 'Recent Notices', zone: 'noticecol' },
  { id: 'system-info', label: 'System Info', zone: 'sidebar' },
  { id: 'instruments', label: 'Instruments', zone: 'sidebar' },
  { id: 'guided-setup', label: 'Guided setup', zone: 'sidebar' }
]

/** The same page with the sensors unconfigured — those two cards do not exist. */
const specsWithoutSensors = specsWithSensors.filter(
  (spec) => spec.id !== 'rangefinder' && spec.id !== 'optical-flow'
)

describe('defaultStatusDashboardLayout', () => {
  it('describes the shipped arrangement, one placement per card', () => {
    const layout = defaultStatusDashboardLayout(specsWithSensors)
    expect(layout.version).toBe(STATUS_DASHBOARD_LAYOUT_VERSION)
    expect(zoneCardIds(layout, 'sensors')).toEqual(['gps', 'rangefinder', 'optical-flow'])
    expect(zoneCardIds(layout, 'midcol')).toEqual(['prearm', 'statistics'])
    expect(zoneCardIds(layout, 'noticecol')).toEqual(['notices'])
    expect(zoneCardIds(layout, 'sidebar')).toEqual(['system-info', 'instruments', 'guided-setup'])
    expect(isDefaultStatusDashboardLayout(layout, specsWithSensors)).toBe(true)
  })
})

describe('parseStoredStatusDashboardLayout', () => {
  it('round-trips a layout it wrote', () => {
    const layout = resizeStatusDashboardCard(defaultStatusDashboardLayout(specsWithSensors), 'notices', 12)
    expect(parseStoredStatusDashboardLayout(JSON.stringify(layout))).toEqual(layout)
  })

  it('falls back to undefined on anything it cannot trust', () => {
    // Nothing stored, unparseable JSON, wrong shape, wrong version: all must
    // degrade to "use the default", never throw.
    expect(parseStoredStatusDashboardLayout(null)).toBeUndefined()
    expect(parseStoredStatusDashboardLayout('')).toBeUndefined()
    expect(parseStoredStatusDashboardLayout('{not json')).toBeUndefined()
    expect(parseStoredStatusDashboardLayout('[]')).toBeUndefined()
    expect(parseStoredStatusDashboardLayout('"a string"')).toBeUndefined()
    expect(parseStoredStatusDashboardLayout(JSON.stringify({ version: 999, cards: [] }))).toBeUndefined()
    expect(parseStoredStatusDashboardLayout(JSON.stringify({ version: 1 }))).toBeUndefined()
    expect(
      parseStoredStatusDashboardLayout(JSON.stringify({ version: 1, cards: 'nope' }))
    ).toBeUndefined()
  })

  it('drops junk entries and repairs bad fields instead of failing whole', () => {
    const parsed = parseStoredStatusDashboardLayout(
      JSON.stringify({
        version: 1,
        cards: [
          { id: 'system-info', zone: 'sidebar' },
          { id: 'system-info', zone: 'midcol' }, // duplicate id — ignored
          { id: '', zone: 'midcol' }, // empty id — ignored
          { id: 42, zone: 'midcol' }, // non-string id — ignored
          null,
          'notices',
          { id: 'notices', zone: 'from-the-future' }, // unknown zone — repaired
          { id: 'gps', zone: 'sidebar', heightRows: 9999 }, // out of range — clamped
          { id: 'prearm', zone: 'midcol', heightRows: 'tall' } // wrong type — dropped
        ]
      })
    )
    expect(parsed).toEqual({
      version: 1,
      cards: [
        { id: 'system-info', zone: 'sidebar' },
        { id: 'notices', zone: 'sensors' },
        { id: 'gps', zone: 'sidebar', heightRows: STATUS_DASHBOARD_MAX_ROWS },
        { id: 'prearm', zone: 'midcol' }
      ]
    })
  })
})

describe('reconcileStatusDashboardLayout', () => {
  it('uses the default when there is nothing stored', () => {
    expect(reconcileStatusDashboardLayout(undefined, specsWithSensors)).toEqual(
      defaultStatusDashboardLayout(specsWithSensors)
    )
  })

  it('drops cards that are no longer on the page', () => {
    // Layout saved while a rangefinder and flow sensor were configured, then
    // reopened with both set to type 0 — the cards do not render at all.
    const saved = moveStatusDashboardCard(
      defaultStatusDashboardLayout(specsWithSensors),
      'rangefinder',
      'sidebar',
      0
    )
    const reconciled = reconcileStatusDashboardLayout(saved, specsWithoutSensors)
    expect(reconciled.cards.map((card) => card.id).sort()).toEqual(
      specsWithoutSensors.map((spec) => spec.id).sort()
    )
    expect(zoneCardIds(reconciled, 'sidebar')).toEqual(['system-info', 'instruments', 'guided-setup'])
    expect(zoneCardIds(reconciled, 'sensors')).toEqual(['gps'])
  })

  it('inserts a newly-present card at its default neighbourhood', () => {
    // Saved with no sensors; the operator then wires up a lidar mid-session.
    const saved = defaultStatusDashboardLayout(specsWithoutSensors)
    const reconciled = reconcileStatusDashboardLayout(saved, specsWithSensors)
    expect(zoneCardIds(reconciled, 'sensors')).toEqual(['gps', 'rangefinder', 'optical-flow'])
    expect(reconciled.cards).toHaveLength(specsWithSensors.length)
  })

  it('honours a customised position for the anchor when inserting new cards', () => {
    // GPS dragged to the sidebar; a rangefinder then appears. The new card takes
    // its DEFAULT zone (the sensor row — a rangefinder card belongs with the
    // other sensors however the operator has arranged them), but its slot in the
    // flat order follows its anchor, so it never lands orphaned at the bottom.
    const saved = moveStatusDashboardCard(
      defaultStatusDashboardLayout(specsWithoutSensors),
      'gps',
      'sidebar',
      0
    )
    const reconciled = reconcileStatusDashboardLayout(saved, specsWithSensors)
    const rangefinder = reconciled.cards.find((card) => card.id === 'rangefinder')
    expect(rangefinder?.zone).toBe('sensors')
    // Immediately after GPS in the flat list, wherever that ended up.
    const ids = reconciled.cards.map((card) => card.id)
    expect(ids[ids.indexOf('gps') + 1]).toBe('rangefinder')
  })

  it('never yields duplicates or losses even from a hostile stored layout', () => {
    const reconciled = reconcileStatusDashboardLayout(
      { version: 1, cards: [{ id: 'ghost', zone: 'midcol' }] },
      specsWithSensors
    )
    expect(reconciled.cards.map((card) => card.id).sort()).toEqual(
      specsWithSensors.map((spec) => spec.id).sort()
    )
  })
})

describe('moveStatusDashboardCard', () => {
  it('reorders inside a zone', () => {
    const layout = moveStatusDashboardCard(
      defaultStatusDashboardLayout(specsWithSensors),
      'guided-setup',
      'sidebar',
      0
    )
    expect(zoneCardIds(layout, 'sidebar')).toEqual(['guided-setup', 'system-info', 'instruments'])
  })

  it('moves between zones at the requested index', () => {
    const layout = moveStatusDashboardCard(
      defaultStatusDashboardLayout(specsWithSensors),
      'gps',
      'midcol',
      1
    )
    expect(zoneCardIds(layout, 'midcol')).toEqual(['prearm', 'gps', 'statistics'])
    expect(zoneCardIds(layout, 'sensors')).toEqual(['rangefinder', 'optical-flow'])
  })

  it('clamps an out-of-range index and lands in an empty zone', () => {
    const base = defaultStatusDashboardLayout(specsWithSensors)
    const emptied = moveStatusDashboardCard(base, 'notices', 'sidebar', 99)
    expect(zoneCardIds(emptied, 'noticecol')).toEqual([])
    expect(zoneCardIds(emptied, 'sidebar')).toEqual([
      'system-info',
      'instruments',
      'guided-setup',
      'notices'
    ])
    const back = moveStatusDashboardCard(emptied, 'gps', 'noticecol', -5)
    expect(zoneCardIds(back, 'noticecol')).toEqual(['gps'])
  })

  it('returns the same object when nothing changes', () => {
    const base = defaultStatusDashboardLayout(specsWithSensors)
    expect(moveStatusDashboardCard(base, 'prearm', 'midcol', 0)).toBe(base)
    expect(moveStatusDashboardCard(base, 'no-such-card', 'midcol', 0)).toBe(base)
  })
})

describe('keyboard moves', () => {
  it('nudges up and down within a zone and stops at the ends', () => {
    const base = defaultStatusDashboardLayout(specsWithSensors)
    expect(zoneCardIds(nudgeStatusDashboardCard(base, 'guided-setup', -1), 'sidebar')).toEqual([
      'system-info',
      'guided-setup',
      'instruments'
    ])
    // Already first in the zone: up is a no-op rather than an escape into the
    // previous zone, so a held arrow key cannot walk a card off the page.
    expect(zoneCardIds(nudgeStatusDashboardCard(base, 'system-info', -1), 'sidebar')).toEqual([
      'system-info',
      'instruments',
      'guided-setup'
    ])
    expect(zoneCardIds(nudgeStatusDashboardCard(base, 'guided-setup', 1), 'sidebar')).toEqual([
      'system-info',
      'instruments',
      'guided-setup'
    ])
  })

  it('shifts a card to the neighbouring zone and refuses past the edges', () => {
    const base = defaultStatusDashboardLayout(specsWithSensors)
    const shifted = shiftStatusDashboardCardZone(base, 'notices', -1)
    expect(zoneCardIds(shifted, 'midcol')).toEqual(['notices', 'prearm', 'statistics'])
    // GPS is in the first zone and Guided setup in the last, so there is no
    // zone to their left / right respectively.
    expect(shiftStatusDashboardCardZone(base, 'gps', -1)).toBe(base)
    expect(shiftStatusDashboardCardZone(base, 'guided-setup', 1)).toBe(base)
  })
})

describe('resizeStatusDashboardCard', () => {
  it('snaps, clamps and clears the height cap', () => {
    const base = defaultStatusDashboardLayout(specsWithSensors)
    expect(resizeStatusDashboardCard(base, 'notices', 12.4).cards.find((c) => c.id === 'notices')).toEqual({
      id: 'notices',
      zone: 'noticecol',
      heightRows: 12
    })
    expect(resizeStatusDashboardCard(base, 'notices', 1).cards.find((c) => c.id === 'notices')?.heightRows).toBe(
      STATUS_DASHBOARD_MIN_ROWS
    )
    expect(
      resizeStatusDashboardCard(base, 'notices', 10_000).cards.find((c) => c.id === 'notices')?.heightRows
    ).toBe(STATUS_DASHBOARD_MAX_ROWS)
    const sized = resizeStatusDashboardCard(base, 'notices', 12)
    expect(resizeStatusDashboardCard(sized, 'notices', undefined).cards.find((c) => c.id === 'notices')).toEqual({
      id: 'notices',
      zone: 'noticecol'
    })
    expect(resizeStatusDashboardCard(base, 'notices', undefined)).toBe(base)
  })
})

describe('isDefaultStatusDashboardLayout', () => {
  it('is false once anything has been moved or resized', () => {
    const base = defaultStatusDashboardLayout(specsWithSensors)
    expect(isDefaultStatusDashboardLayout(moveStatusDashboardCard(base, 'gps', 'midcol', 0), specsWithSensors)).toBe(
      false
    )
    expect(
      isDefaultStatusDashboardLayout(resizeStatusDashboardCard(base, 'gps', 10), specsWithSensors)
    ).toBe(false)
    // A default layout built for a different card set is not "the default" here.
    expect(isDefaultStatusDashboardLayout(defaultStatusDashboardLayout(specsWithoutSensors), specsWithSensors)).toBe(
      false
    )
  })
})
