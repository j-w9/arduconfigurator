// Device-status display helpers (servo output kinds + battery health), extracted
// from App.tsx as part of its decomposition. Pure label/tone/format helpers for
// the Outputs and Power readouts. No React, no app state.

import type { ConfiguratorSnapshot, ServoOutputKind } from '@arduconfig/ardupilot-core'
import { formatArducopterBatteryMonitor } from '@arduconfig/param-metadata'

import type { StatusTone } from './status-tone'

export function toneForOutputKind(kind: ServoOutputKind): StatusTone {
  switch (kind) {
    case 'motor':
    case 'control-surface':
      return 'success'
    case 'pass-through':
      return 'warning'
    default:
      return 'neutral'
  }
}

export function outputKindLabel(kind: ServoOutputKind): string {
  switch (kind) {
    case 'motor':
      return 'Motor'
    case 'control-surface':
      return 'Control surface'
    case 'pass-through':
      return 'RC pass-through'
    case 'peripheral':
      return 'Peripheral'
    case 'unused':
      return 'Disabled'
    default:
      return 'Other'
  }
}

export function describeOutputAssignment(kind: ServoOutputKind, motorNumber: number | undefined): string {
  switch (kind) {
    case 'motor':
      return motorNumber === undefined ? 'Primary motor output.' : `Assigned as motor ${motorNumber}.`
    case 'control-surface':
      return 'Drives a flight control surface (aileron, elevator, rudder, flap, elevon, etc.).'
    case 'pass-through':
      return 'Mirrors an incoming RC channel rather than driving an autonomous output function.'
    case 'peripheral':
      return 'Mapped to a non-motor peripheral, actuator, or accessory function.'
    case 'unused':
      return 'Currently disabled.'
    default:
      return 'Configured with a function outside the curated labels used by this setup surface.'
  }
}

export function batteryHealthTone(snapshot: ConfiguratorSnapshot): StatusTone {
  const { batteryTelemetry } = snapshot.liveVerification
  if (!batteryTelemetry.verified) {
    return 'warning'
  }

  const remainingPercent = batteryTelemetry.remainingPercent
  if (remainingPercent !== undefined && remainingPercent <= 15) {
    return 'danger'
  }
  if (remainingPercent !== undefined && remainingPercent <= 30) {
    return 'warning'
  }
  return 'success'
}

export function batteryHealthLabel(snapshot: ConfiguratorSnapshot): string {
  const { batteryTelemetry } = snapshot.liveVerification
  if (!batteryTelemetry.verified) {
    return 'Waiting for telemetry'
  }

  const remainingPercent = batteryTelemetry.remainingPercent
  if (remainingPercent !== undefined && remainingPercent <= 15) {
    return 'Low battery'
  }
  if (remainingPercent !== undefined && remainingPercent <= 30) {
    return 'Battery caution'
  }
  return 'Battery healthy'
}

export function describeBatteryMonitor(value: number | undefined): string {
  return formatArducopterBatteryMonitor(value)
}

export function formatVoltage(value: number | undefined): string {
  return value === undefined ? 'Unknown' : `${value.toFixed(2)} V`
}

export function formatCurrent(value: number | undefined): string {
  return value === undefined ? 'Unknown' : `${value.toFixed(2)} A`
}

export function formatRemaining(value: number | undefined): string {
  return value === undefined ? 'Unknown' : `${value}%`
}
