import type { DronecanEscTelemetry, DronecanInspectedNode } from '@arduconfig/ardupilot-core'
import { describe, expect, it } from 'vitest'

import {
  buildDronecanEscRows,
  buildDronecanNodeDetailRows,
  buildDronecanParamRows,
  summarizeDronecanNodes
} from './dronecan-inspector'

function node(overrides: Partial<DronecanInspectedNode> = {}): DronecanInspectedNode {
  return {
    nodeId: 11,
    health: 'ok',
    mode: 'operational',
    uptimeSec: 125,
    parameters: [],
    paramFetch: { status: 'idle', nextIndex: 0 },
    firstSeenAtMs: 1000,
    lastSeenAtMs: 9000,
    ...overrides
  }
}

describe('buildDronecanNodeDetailRows', () => {
  it('always surfaces the core NodeStatus rows', () => {
    const rows = buildDronecanNodeDetailRows(node(), 10000)
    const byLabel = Object.fromEntries(rows.map((r) => [r.label, r.value]))
    expect(byLabel['Node ID']).toBe('#11')
    expect(byLabel.Name).toBe('—')
    expect(byLabel.Health).toBe('OK')
    expect(byLabel.Mode).toBe('Operational')
    expect(byLabel.Uptime).toBe('2m 5s')
    expect(byLabel['Last seen']).toBe('now')
    expect(byLabel['First seen']).toBe('9.0s ago')
  })

  it('omits version/identity rows until the node reports them', () => {
    const labels = buildDronecanNodeDetailRows(node()).map((r) => r.label)
    expect(labels).not.toContain('HW version')
    expect(labels).not.toContain('SW version')
    expect(labels).not.toContain('Git hash')
    expect(labels).not.toContain('Unique ID')
  })

  it('renders version identity + git hash when present', () => {
    const rows = buildDronecanNodeDetailRows(
      node({
        name: 'Here3',
        hwVersion: { major: 1, minor: 0 },
        swVersion: { major: 1, minor: 13, vcsCommit: 0xabcd1234 },
        hwUniqueId: 'deadbeef'
      }),
      10000
    )
    const byLabel = Object.fromEntries(rows.map((r) => [r.label, r.value]))
    expect(byLabel.Name).toBe('Here3')
    expect(byLabel['HW version']).toBe('1.0')
    expect(byLabel['SW version']).toBe('1.13')
    expect(byLabel['Git hash']).toBe('abcd1234')
    expect(byLabel['Unique ID']).toBe('deadbeef')
  })

  it('surfaces a param-fetch error', () => {
    const rows = buildDronecanNodeDetailRows(
      node({ paramFetch: { status: 'stalled', nextIndex: 3, error: 'timeout' } }),
      10000
    )
    const fetch = rows.find((r) => r.label === 'Param fetch')
    expect(fetch?.value).toBe('error — timeout')
  })
})

describe('summarizeDronecanNodes', () => {
  it('counts healthy vs unhealthy', () => {
    const summary = summarizeDronecanNodes([
      node({ nodeId: 1, health: 'ok' }),
      node({ nodeId: 2, health: 'warning' }),
      node({ nodeId: 3, health: 'critical' }),
      node({ nodeId: 4, health: 'unknown' })
    ])
    expect(summary).toEqual({ nodeCount: 4, healthyCount: 1, unhealthyCount: 2 })
  })
})

describe('buildDronecanParamRows', () => {
  it('shapes editable rows sorted by index with range + default hints', () => {
    const rows = buildDronecanParamRows(
      node({
        parameters: [
          {
            index: 1,
            name: 'GPS_TYPE',
            value: { tag: 'int64', int64: '1' },
            defaultValue: { tag: 'int64', int64: '0' },
            minValue: { tag: 'int64', int64: '0' },
            maxValue: { tag: 'int64', int64: '26' },
            lastFetchedAtMs: 1
          },
          {
            index: 0,
            name: 'NODEID',
            value: { tag: 'int64', int64: '124' },
            lastFetchedAtMs: 1
          }
        ]
      })
    )
    expect(rows.map((r) => r.name)).toEqual(['NODEID', 'GPS_TYPE'])
    const gps = rows[1]
    expect(gps.valueLabel).toBe('1')
    expect(gps.type).toBe('int64')
    expect(gps.editable).toBe(true)
    expect(gps.rangeLabel).toBe('0..26')
    expect(gps.defaultLabel).toBe('0')
    // NODEID has no min/max/default reported.
    expect(rows[0].rangeLabel).toBeUndefined()
    expect(rows[0].defaultLabel).toBeUndefined()
  })

  it('marks empty/unknown values as non-editable', () => {
    const rows = buildDronecanParamRows(
      node({ parameters: [{ index: 0, name: 'X', value: { tag: 'empty' }, lastFetchedAtMs: 1 }] })
    )
    expect(rows[0].editable).toBe(false)
    expect(rows[0].valueLabel).toBe('—')
  })
})

describe('buildDronecanEscRows', () => {
  const esc = (overrides: Partial<DronecanEscTelemetry> = {}): DronecanEscTelemetry => ({
    escIndex: 0,
    nodeId: 50,
    rpm: 1234,
    voltage: 16.2,
    current: 12.5,
    temperatureK: 313.15,
    temperatureC: 40,
    errorCount: 0,
    powerRatingPct: 42,
    lastSeenAtMs: 9000,
    ...overrides
  })

  it('formats RPM/V/A/temp/power per ESC, sorted by index', () => {
    const rows = buildDronecanEscRows([esc({ escIndex: 1 }), esc({ escIndex: 0 })], 10000)
    expect(rows.map((r) => r.escIndex)).toEqual([0, 1])
    const first = rows[0]
    expect(first.rpmLabel).toBe('1234')
    expect(first.voltageLabel).toBe('16.20 V')
    expect(first.currentLabel).toBe('12.50 A')
    expect(first.temperatureLabel).toBe('40 °C')
    expect(first.powerLabel).toBe('42%')
    expect(first.errorCountLabel).toBe('0')
    expect(first.ageLabel).toBe('now')
  })

  it('shows — for fields the node did not report (NaN → undefined)', () => {
    const rows = buildDronecanEscRows([
      esc({ voltage: undefined, current: undefined, temperatureC: undefined, temperatureK: undefined })
    ])
    expect(rows[0].voltageLabel).toBe('—')
    expect(rows[0].currentLabel).toBe('—')
    expect(rows[0].temperatureLabel).toBe('—')
  })
})
