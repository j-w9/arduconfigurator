import { describe, expect, it } from 'vitest'

import {
  assignPane,
  decimateMinMax,
  groupIntoPanes,
  histogram,
  transformTag,
  transformValues,
  lanesAreDisparate,
  overlayAll,
  rangeStats,
  thinLane,
  parseSavedLayouts,
  prunePanes,
  serializeSavedLayouts,
  upsertLayout,
  withCondition,
  valueAt
} from './plot-workspace'

const key = (entry: string) => entry

describe('panes', () => {
  it('gives each series its own pane until one is moved onto another', () => {
    expect(groupIntoPanes(['a', 'b', 'c'], key, new Map()).map((pane) => pane.series)).toEqual([['a'], ['b'], ['c']])
    const merged = assignPane(new Map(), 'c', 'a')
    expect(groupIntoPanes(['a', 'b', 'c'], key, merged).map((pane) => [pane.id, pane.series])).toEqual([
      ['a', ['a', 'c']],
      ['b', ['b']]
    ])
    // Back onto a pane of its own.
    expect(groupIntoPanes(['a', 'b', 'c'], key, assignPane(merged, 'c', undefined)).map((pane) => pane.series)).toEqual([['a'], ['b'], ['c']])
  })

  it('keeps the rest of a pane together when the series it is named after leaves', () => {
    let paneOf = assignPane(new Map(), 'b', 'a')
    paneOf = assignPane(paneOf, 'c', 'a')
    paneOf = assignPane(paneOf, 'a', undefined)
    expect(groupIntoPanes(['a', 'b', 'c'], key, paneOf).map((pane) => pane.series)).toEqual([['a'], ['b', 'c']])
    expect([...prunePanes(paneOf, new Set(['b'])).keys()]).toEqual([])
  })

  it('overlays every series on the first chart', () => {
    expect(groupIntoPanes(['a', 'b', 'c'], key, overlayAll(['a', 'b', 'c'])).map((pane) => pane.series)).toEqual([['a', 'b', 'c']])
  })
})

describe('saved layouts', () => {
  const isName = (value: unknown): value is string => typeof value === 'string'
  it('round-trip, replace by name, and drop what does not parse', () => {
    const layouts = upsertLayout<string>([], { name: 'ESCs', panes: [{ height: 220, series: ['rpm', 'temp'] }] })
    expect(parseSavedLayouts(serializeSavedLayouts(layouts), isName)).toEqual(layouts)
    expect(upsertLayout(layouts, { name: 'ESCs', panes: [] })).toEqual([{ name: 'ESCs', panes: [] }])
    const junk = JSON.stringify({ format: 1, layouts: [{ name: 'x', panes: [{ series: [1, 'ok'], height: 9999 }, { series: [2] }] }, { nope: true }] })
    expect(parseSavedLayouts(junk, isName)).toEqual([{ name: 'x', panes: [{ height: 640, series: ['ok'] }] }])
    expect(parseSavedLayouts('not json', isName)).toEqual([])
    expect(parseSavedLayouts(JSON.stringify({ format: 9, layouts: [] }), isName)).toEqual([])
  })
})

describe('drawing many points', () => {
  it('keeps every point when there are few, and runs one past each edge', () => {
    const t = [0, 1, 2, 3, 4, 5]
    expect(decimateMinMax(t, t, 1.5, 3.5, 100)).toEqual({ t: [1, 2, 3, 4], v: [1, 2, 3, 4] })
  })

  it('thins a long series to a few points per bucket without losing a spike', () => {
    const n = 100_000
    const t = Array.from({ length: n }, (_u, i) => i / 1000)
    const v = Array.from({ length: n }, (_u, i) => (i === 54_321 ? 999 : Math.sin(i / 500)))
    const out = decimateMinMax(t, v, 0, 100, 200)
    expect(out.t.length).toBeLessThanOrEqual(200 * 4 + 8)
    expect(out.t.length).toBeGreaterThan(200)
    expect(Math.max(...out.v)).toBe(999)
    expect(out.t.every((value, i) => i === 0 || value >= out.t[i - 1])).toBe(true)
  })

  it('reads the value at the cursor from the point at or before it', () => {
    expect(valueAt([1, 2, 3], [10, 20, 30], 2)).toBe(20)
    expect(valueAt([1, 2, 3], [10, 20, 30], 2.5)).toBe(20)
    expect(valueAt([1, 2, 3], [10, 20, 30], 0.5)).toBeUndefined()
  })
})

describe('range stats and thinning', () => {
  it('summarise only the points in range, skipping gaps', () => {
    const t = [0, 1, 2, 3, 4]
    const v = [5, Number.NaN, 1, 9, 100]
    expect(rangeStats(t, v, 0, 3)).toEqual({ min: 1, max: 9, mean: 5, count: 3, rateHz: 2 / 3 })
    expect(rangeStats(t, v, 10, 20)).toBeUndefined()
  })

  it('leaves a short lane alone and thins a long one, keeping its extremes', () => {
    const short = { t: [0, 1], v: [1, 2], label: 'a' }
    expect(thinLane(short, undefined, undefined)).toBe(short)
    const n = 50_000
    const long = { t: Array.from({ length: n }, (_u, i) => i), v: Array.from({ length: n }, (_u, i) => (i === 777 ? -50 : i % 7)), label: 'b' }
    const thin = thinLane(long, 0, n)
    expect(thin.t.length).toBeLessThan(n / 5)
    expect(Math.min(...thin.v)).toBe(-50)
    expect(thin.label).toBe('b')
  })
})

describe('disparate lines', () => {
  it('get their own axes when one would flatten the other', () => {
    const t = [0, 1, 2]
    expect(lanesAreDisparate([{ t, v: [100000, 100500, 99000] }, { t, v: [0, 1, 0] }])).toBe(true)
    expect(lanesAreDisparate([{ t, v: [10, 12, 11] }, { t, v: [0, 5, 2] }])).toBe(false)
    expect(lanesAreDisparate([{ t, v: [1, 2, 3] }])).toBe(false)
    // Only what is in view counts.
    expect(lanesAreDisparate([{ t, v: [100000, 1, 2] }, { t, v: [0, 1, 0] }], 1, 2)).toBe(false)
  })
})

describe('transforms', () => {
  const t = [0, 1, 2, 3, 4]
  const v = [0, 2, 4, 4, -2]
  it('rate of change per second, integral, abs, scale', () => {
    expect(Array.from(transformValues(t, v, { kind: 'rate' }))).toEqual([Number.NaN, 2, 2, 0, -6])
    expect(Array.from(transformValues(t, v, { kind: 'integral' }))).toEqual([0, 1, 4, 8, 9])
    expect(Array.from(transformValues(t, v, { kind: 'abs' }))).toEqual([0, 2, 4, 4, 2])
    expect(Array.from(transformValues(t, v, { kind: 'scale', factor: 10, offset: -1 }))).toEqual([-1, 19, 39, 39, -21])
    expect(transformValues(t, v, { kind: 'none' })).toBe(v)
  })

  it('smooths over a trailing window, and tags each kind', () => {
    expect(Array.from(transformValues(t, v, { kind: 'smooth', windowS: 1 }))).toEqual([0, 1, 3, 4, 1])
    expect(transformTag({ kind: 'rate' })).toBe('d/dt')
    expect(transformTag({ kind: 'scale', factor: 0.01, offset: 0 })).toBe('×0.01+0')
    expect(transformTag({ kind: 'none' })).toBeUndefined()
  })
})

describe('histogram', () => {
  it('counts every line over shared bins, only what is in view', () => {
    const t = [0, 1, 2, 3]
    const result = histogram([{ t, v: [0, 0, 10, 10] }, { t, v: [5, 5, 5, 5] }], undefined, undefined, 2)!
    expect(result.centers).toEqual([2.5, 7.5])
    expect(result.counts).toEqual([[2, 2], [0, 4]])
    expect(histogram([{ t, v: [1, 1, 1, 1] }], 0, 3, 4)!.counts[0].reduce((a, b) => a + b)).toBe(4)
    expect(histogram([{ t, v: [1, 2, 3, 4] }], 10, 20)).toBeUndefined()
  })
})

describe('conditions', () => {
  it('go on every term, before a right-axis suffix', () => {
    expect(withCondition('ATTITUDE.roll ATTITUDE.pitch:2', 'VFR_HUD.throttle > 10')).toBe('ATTITUDE.roll{VFR_HUD.throttle>10} ATTITUDE.pitch{VFR_HUD.throttle>10}:2')
    expect(withCondition(' A.x ', '  ')).toBe('A.x')
  })
})
