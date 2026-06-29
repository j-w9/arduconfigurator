import type { DronecanInspectedNode } from '@arduconfig/ardupilot-core'
import { describe, expect, it } from 'vitest'

import { buildDronecanNodeDetailRows, summarizeDronecanNodes } from './dronecan-inspector'

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
