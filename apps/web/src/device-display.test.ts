import type { ConfiguratorSnapshot, ServoOutputKind } from '@arduconfig/ardupilot-core'
import { describe, expect, it } from 'vitest'

import {
  batteryHealthLabel,
  batteryHealthTone,
  describeOutputAssignment,
  formatCurrent,
  formatRemaining,
  formatVoltage,
  outputKindLabel,
  toneForOutputKind
} from './device-display'

const battery = (over: Record<string, unknown>): ConfiguratorSnapshot =>
  ({ liveVerification: { batteryTelemetry: { verified: true, ...over } } }) as unknown as ConfiguratorSnapshot

describe('output kind display', () => {
  it('maps kinds to tones and labels', () => {
    expect(toneForOutputKind('motor')).toBe('success')
    expect(toneForOutputKind('pass-through')).toBe('warning')
    expect(toneForOutputKind('peripheral')).toBe('neutral')
    expect(outputKindLabel('control-surface')).toBe('Control surface')
    expect(outputKindLabel('unused')).toBe('Disabled')
    expect(outputKindLabel('other' as ServoOutputKind)).toBe('Other')
  })

  it('describes a motor assignment with or without a number', () => {
    expect(describeOutputAssignment('motor', 3)).toBe('Assigned as motor 3.')
    expect(describeOutputAssignment('motor', undefined)).toBe('Primary motor output.')
    expect(describeOutputAssignment('unused', undefined)).toBe('Currently disabled.')
  })
})

describe('battery health', () => {
  it('tone: warning before telemetry, then danger/warning/success by remaining %', () => {
    expect(batteryHealthTone(battery({ verified: false }))).toBe('warning')
    expect(batteryHealthTone(battery({ remainingPercent: 10 }))).toBe('danger')
    expect(batteryHealthTone(battery({ remainingPercent: 25 }))).toBe('warning')
    expect(batteryHealthTone(battery({ remainingPercent: 80 }))).toBe('success')
  })

  it('label matches the tone thresholds', () => {
    expect(batteryHealthLabel(battery({ verified: false }))).toBe('Waiting for telemetry')
    expect(batteryHealthLabel(battery({ remainingPercent: 15 }))).toBe('Low battery')
    expect(batteryHealthLabel(battery({ remainingPercent: 30 }))).toBe('Battery caution')
    expect(batteryHealthLabel(battery({ remainingPercent: 90 }))).toBe('Battery healthy')
  })
})

describe('value formatters', () => {
  it('format voltage/current to 2 dp and remaining as a percent, Unknown for undefined', () => {
    expect(formatVoltage(16.8)).toBe('16.80 V')
    expect(formatVoltage(undefined)).toBe('Unknown')
    expect(formatCurrent(2.5)).toBe('2.50 A')
    expect(formatRemaining(72)).toBe('72%')
    expect(formatRemaining(undefined)).toBe('Unknown')
  })
})
