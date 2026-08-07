import type { DronecanEscTelemetry } from '@arduconfig/ardupilot-core'
import { describe, expect, it } from 'vitest'

import {
  buildCanBusTrafficSummary,
  canDevicePopoutKey,
  canDevicePopoutTitle,
  filterEscTelemetryForNode
} from './can-device-inspector'

function esc(overrides: Partial<DronecanEscTelemetry> = {}): DronecanEscTelemetry {
  return {
    escIndex: 0,
    nodeId: 50,
    rpm: 1200,
    voltage: 15.9,
    current: 3.2,
    temperatureC: 31,
    powerRatingPct: 40,
    errorCount: 0,
    lastSeenAtMs: 1000,
    ...overrides
  }
}

describe('buildCanBusTrafficSummary', () => {
  it('reads out node count, rate, and session frames', () => {
    expect(
      buildCanBusTrafficSummary({ nodeCount: 2, unhealthyCount: 0, framesPerSec: 41.6, framesReceived: 803 })
    ).toBe('2 nodes · 42 frames/s · 803 this session')
  })

  it('singularizes one node and calls out unhealthy nodes', () => {
    expect(
      buildCanBusTrafficSummary({ nodeCount: 1, unhealthyCount: 1, framesPerSec: 0, framesReceived: 0 })
    ).toBe('1 node (1 unhealthy) · 0 frames/s · 0 this session')
  })
})

describe('filterEscTelemetryForNode', () => {
  it('keeps only the requested node — popout scoping is a real filter', () => {
    const stream = [esc({ escIndex: 0, nodeId: 50 }), esc({ escIndex: 1, nodeId: 51 }), esc({ escIndex: 2, nodeId: 50 })]
    expect(filterEscTelemetryForNode(stream, 50).map((entry) => entry.escIndex)).toEqual([0, 2])
    expect(filterEscTelemetryForNode(stream, 51).map((entry) => entry.escIndex)).toEqual([1])
    expect(filterEscTelemetryForNode(stream, 99)).toEqual([])
  })
})

describe('popout identity', () => {
  it('keys one window per node id', () => {
    expect(canDevicePopoutKey(124)).toBe('can-device-124')
    expect(canDevicePopoutKey(124)).toBe(canDevicePopoutKey(124))
    expect(canDevicePopoutKey(50)).not.toBe(canDevicePopoutKey(124))
  })

  it('titles the window with the device name and node id', () => {
    expect(canDevicePopoutTitle(124, 'Front GPS')).toBe('Front GPS · node 124 — ArduConfigurator')
    expect(canDevicePopoutTitle(124, '  ')).toBe('Node 124 — ArduConfigurator')
    expect(canDevicePopoutTitle(124, undefined)).toBe('Node 124 — ArduConfigurator')
  })
})
