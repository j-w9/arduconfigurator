import { describe, expect, it } from 'vitest'
import { MAVGRAPHS, createGraphEvaluator } from '@arduconfig/plot-core'

import { LiveFieldIndex, filterLiveGraphs, graphSeriesKey, liveGraphEntries, missingMessages } from './mavlink-live-graphs'
import { mavlinkRecordForPlot } from './plot-live-mavlink'

describe('live graphs', () => {
  it('know which graphs the link can draw, from what has arrived', () => {
    const index = new LiveFieldIndex()
    const none = liveGraphEntries(MAVGRAPHS, index.availability())
    expect(none.every((entry) => entry.unavailable)).toBe(true)

    const attitude = mavlinkRecordForPlot({ type: 'ATTITUDE', timeBootMs: 1, rollRad: 0.5, pitchRad: 0, yawRad: 0, rollSpeedRadS: 0, pitchSpeedRadS: 0, yawSpeedRadS: 0 })!
    expect(index.record(attitude.name, attitude.record)).toBe(true)
    expect(index.record(attitude.name, attitude.record)).toBe(false)
    const entries = liveGraphEntries(MAVGRAPHS, index.availability())
    const rollPitch = entries.find((entry) => entry.name === 'Attitude/Roll and Pitch')!
    expect(rollPitch).toMatchObject({ category: 'Attitude', title: 'Roll and Pitch' })
    expect(rollPitch.unavailable).toBeUndefined()
    // Drawable graphs come first.
    expect(entries[0].unavailable).toBeUndefined()

    // And it draws: degrees(ATTITUDE.roll) from the decoded message.
    const graph = createGraphEvaluator(rollPitch.terms!)
    graph.push(attitude.name, attitude.record, 1)
    expect(graph.series()[0].v[0]).toBeCloseTo(28.6479, 3)
  })

  it('filters by words and hides what cannot draw unless asked', () => {
    const index = new LiveFieldIndex()
    const entries = liveGraphEntries(MAVGRAPHS, index.availability())
    expect(filterLiveGraphs(entries, 'roll pitch', false)).toEqual([])
    expect(filterLiveGraphs(entries, 'roll pitch', true).length).toBeGreaterThan(0)
    expect(graphSeriesKey('Attitude/Roll and Pitch', 1)).toBe('graph|Attitude/Roll and Pitch|1')
  })

  it('says which messages a graph still waits for', () => {
    const index = new LiveFieldIndex()
    const attitude = mavlinkRecordForPlot({ type: 'ATTITUDE', timeBootMs: 1, rollRad: 0, pitchRad: 0, yawRad: 0, rollSpeedRadS: 0, pitchSpeedRadS: 0, yawSpeedRadS: 0 })!
    index.record(attitude.name, attitude.record)
    const graph = { name: 'X/Speed', path: ['X', 'Speed'], description: '', expressions: ['GPS.Spd', 'VFR_HUD.groundspeed VFR_HUD.airspeed', 'VFR_HUD.groundspeed ATTITUDE.roll'] }
    expect(missingMessages(graph, index.availability())).toEqual(['GPS'])
    const vfrOnly = { ...graph, expressions: ['VFR_HUD.groundspeed ATTITUDE.nope', 'VFR_HUD.groundspeed'] }
    expect(missingMessages(vfrOnly, index.availability())).toEqual(['VFR_HUD'])
  })
})
