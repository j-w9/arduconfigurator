import type { ConfiguratorSnapshot } from '@arduconfig/ardupilot-core'
import { describe, expect, it } from 'vitest'

import {
  formatBatteryTelemetry,
  formatHeadingTelemetry,
  formatParameterSync,
  formatRcLink,
  formatRxRssi,
  formatStatHours,
  normalizeHeadingDegrees
} from './status-formatters'

const sync = (stats: Record<string, unknown>): ConfiguratorSnapshot =>
  ({ parameterStats: stats }) as unknown as ConfiguratorSnapshot
const live = (over: Record<string, unknown>): ConfiguratorSnapshot =>
  ({ liveVerification: over }) as unknown as ConfiguratorSnapshot

describe('formatParameterSync', () => {
  it('names the lifecycle states', () => {
    expect(formatParameterSync(sync({ status: 'idle' }))).toBe('Idle')
    expect(formatParameterSync(sync({ status: 'awaiting-vehicle' }))).toBe('Waiting for heartbeat')
    expect(formatParameterSync(sync({ status: 'requesting' }))).toBe('Parameter request sent')
  })

  it('reports a received count when progress is unknown, else a percentage', () => {
    expect(formatParameterSync(sync({ status: 'downloading', downloaded: 12, total: 0, progress: null }))).toBe('downloading (12 received)')
    expect(formatParameterSync(sync({ status: 'downloading', downloaded: 50, total: 100, progress: 0.5 }))).toBe('50% (50/100)')
  })
})

describe('live telemetry formatters', () => {
  it('formatRcLink reflects verification + channel/RSSI', () => {
    expect(formatRcLink(live({ rcInput: { verified: false } }))).toBe('No live RC telemetry')
    expect(formatRcLink(live({ rcInput: { verified: true, channelCount: 8, rssi: 254 } }))).toBe('8 channels, RX RSSI 100%')
  })

  it('formatRxRssi scales 0..254 to a clamped percentage', () => {
    expect(formatRxRssi(undefined)).toBe('Unknown')
    expect(formatRxRssi(254)).toBe('100%')
    expect(formatRxRssi(127)).toBe('50%')
    expect(formatRxRssi(1000)).toBe('100%')
  })

  it('formatBatteryTelemetry shows voltage and optional remaining', () => {
    expect(formatBatteryTelemetry(live({ batteryTelemetry: { verified: false } }))).toBe('No live battery telemetry')
    expect(formatBatteryTelemetry(live({ batteryTelemetry: { verified: true, voltageV: 16.8, remainingPercent: 70 } }))).toBe('16.8 V, 70%')
    expect(formatBatteryTelemetry(live({ batteryTelemetry: { verified: true, voltageV: 16.8 } }))).toBe('16.8 V')
  })

  it('formatStatHours uses a decimal under 10h and rounds above', () => {
    expect(formatStatHours(undefined)).toBe('—')
    expect(formatStatHours(1800)).toBe('0.5 h')
    expect(formatStatHours(54000)).toBe('15 h')
  })
})

describe('heading math', () => {
  it('normalizeHeadingDegrees wraps into 0..360', () => {
    expect(normalizeHeadingDegrees(undefined)).toBeUndefined()
    expect(normalizeHeadingDegrees(370)).toBe(10)
    expect(normalizeHeadingDegrees(-10)).toBe(350)
    expect(normalizeHeadingDegrees(45)).toBe(45)
  })

  it('formatHeadingTelemetry normalizes then rounds to whole degrees', () => {
    expect(formatHeadingTelemetry(undefined)).toBe('Waiting')
    expect(formatHeadingTelemetry(359.6)).toBe('360°')
    expect(formatHeadingTelemetry(-1)).toBe('359°')
  })
})
