import { describe, expect, it } from 'vitest'

import {
  assignPane,
  decimateMinMax,
  groupIntoPanes,
  parseSavedLayouts,
  prunePanes,
  serializeSavedLayouts,
  upsertLayout,
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
})

describe('saved layouts', () => {
  const isName = (value: unknown): value is string => typeof value === 'string'
  it('round-trip, replace by name, and drop what does not parse', () => {
    const layouts = upsertLayout<string>([], { name: 'ESCs', panes: [{ height: 'l', series: ['rpm', 'temp'] }] })
    expect(parseSavedLayouts(serializeSavedLayouts(layouts), isName)).toEqual(layouts)
    expect(upsertLayout(layouts, { name: 'ESCs', panes: [] })).toEqual([{ name: 'ESCs', panes: [] }])
    const junk = JSON.stringify({ format: 1, layouts: [{ name: 'x', panes: [{ series: [1, 'ok'] }, { series: [2] }] }, { nope: true }] })
    expect(parseSavedLayouts(junk, isName)).toEqual([{ name: 'x', panes: [{ height: 'm', series: ['ok'] }] }])
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
