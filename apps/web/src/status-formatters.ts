// Status / telemetry string formatters, extracted from App.tsx as part of its
// decomposition. Pure formatters over the runtime snapshot (and a couple of raw
// numbers) — no React, no app state. They feed the Status page's parameter-sync,
// RC-link, battery, and attitude/heading readouts.

import type { ConfiguratorSnapshot } from '@arduconfig/ardupilot-core'

export function formatParameterSync(snapshot: ConfiguratorSnapshot): string {
  const { status, downloaded, total, progress } = snapshot.parameterStats
  if (status === 'idle') {
    return 'Idle'
  }
  if (status === 'awaiting-vehicle') {
    return 'Waiting for heartbeat'
  }
  if (status === 'requesting') {
    return 'Parameter request sent'
  }
  if (progress === null || total === 0) {
    return `${status} (${downloaded} received)`
  }
  return `${Math.round(progress * 100)}% (${downloaded}/${total})`
}

export function formatRcLink(snapshot: ConfiguratorSnapshot): string {
  const { rcInput } = snapshot.liveVerification
  if (!rcInput.verified) {
    return 'No live RC telemetry'
  }

  return `${rcInput.channelCount} channels, RX RSSI ${formatRxRssi(rcInput.rssi)}`
}

// RC_CHANNELS.rssi is a 0-254 raw value (255 = unknown), where 254 = 100%.
// Showing the raw byte reads as a meaningless "very high number"; present it
// as the RX link percentage instead.
export function formatRxRssi(rssi: number | undefined): string {
  if (rssi === undefined || !Number.isFinite(rssi)) {
    return 'Unknown'
  }
  const pct = Math.max(0, Math.min(100, Math.round((rssi / 254) * 100)))
  return `${pct}%`
}

// STAT_RUNTIME / STAT_FLTTIME are lifetime counters in seconds; render
// them as compact hours for the Setup statistics card.
export function formatStatHours(seconds: number | undefined): string {
  if (seconds === undefined || !Number.isFinite(seconds)) {
    return '—'
  }
  const hours = seconds / 3600
  return hours >= 10 ? `${Math.round(hours)} h` : `${hours.toFixed(1)} h`
}

export function formatBatteryTelemetry(snapshot: ConfiguratorSnapshot): string {
  const { batteryTelemetry } = snapshot.liveVerification
  if (!batteryTelemetry.verified) {
    return 'No live battery telemetry'
  }

  const remaining = batteryTelemetry.remainingPercent !== undefined ? `, ${batteryTelemetry.remainingPercent}%` : ''
  return `${batteryTelemetry.voltageV ?? 'unknown'} V${remaining}`
}

export function normalizeHeadingDegrees(value: number | undefined): number | undefined {
  if (value === undefined || Number.isNaN(value)) {
    return undefined
  }

  const normalized = value % 360
  return normalized >= 0 ? normalized : normalized + 360
}

export function formatDegreeTelemetry(value: number | undefined): string {
  return value === undefined || Number.isNaN(value) ? 'Waiting' : `${value.toFixed(1)}°`
}

export function formatHeadingTelemetry(value: number | undefined): string {
  const normalized = normalizeHeadingDegrees(value)
  return normalized === undefined ? 'Waiting' : `${Math.round(normalized)}°`
}

/**
 * audit-30: decoded HEARTBEAT.system_status (MAV_STATE) → operator-readable
 * label for the setup-gui-box "System state" row. 'Waiting' covers the
 * pre-heartbeat case; the snapshot field is required once vehicle is
 * known, so 'unknown' is reserved for genuinely out-of-range enum codes.
 */
export function formatVehicleSystemStatus(
  status:
    | 'uninit'
    | 'boot'
    | 'calibrating'
    | 'standby'
    | 'active'
    | 'critical'
    | 'emergency'
    | 'poweroff'
    | 'flight-termination'
    | 'unknown'
    | undefined
): string {
  switch (status) {
    case undefined:
      return 'Waiting'
    case 'uninit':
      return 'Initialising'
    case 'boot':
      return 'Booting'
    case 'calibrating':
      return 'Calibrating'
    case 'standby':
      return 'Standby'
    case 'active':
      return 'Active'
    case 'critical':
      return 'Critical'
    case 'emergency':
      return 'Emergency'
    case 'poweroff':
      return 'Powering off'
    case 'flight-termination':
      return 'Flight termination'
    default:
      return 'Unknown'
  }
}
