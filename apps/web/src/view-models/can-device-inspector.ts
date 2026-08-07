// Pure view-model helpers for the merged CAN tab (device list + per-device
// inspector, inline or popped out into its own window).
//
// The DroneCAN inspector used to be a second top-level tab showing the same bus
// from a different angle; it now lives inside the CAN tab, one device at a time.
// These helpers shape the bits that used to be computed inline in the inspector
// view: the bus-traffic summary line, the device-scoped ESC telemetry, and the
// popout window identity. Kept pure so they are unit-tested off the runtime.

import type { DronecanEscTelemetry } from '@arduconfig/ardupilot-core'

export interface CanBusTrafficSummaryInputs {
  nodeCount: number
  unhealthyCount: number
  /** Frames/s over the CAN_FORWARD tunnel (smoothed by use-dronecan-bus-stats). */
  framesPerSec: number
  /** Frames seen since forwarding started. */
  framesReceived: number
}

/**
 * One-line bus health/traffic read-out for the CAN tab header. Same content the
 * standalone inspector's summary carried (node count, unhealthy count, frames/s,
 * session frame count) so nothing is lost by folding the tab in.
 */
export function buildCanBusTrafficSummary(inputs: CanBusTrafficSummaryInputs): string {
  const { nodeCount, unhealthyCount, framesPerSec, framesReceived } = inputs
  const nodes = `${nodeCount} node${nodeCount === 1 ? '' : 's'}`
  const unhealthy = unhealthyCount > 0 ? ` (${unhealthyCount} unhealthy)` : ''
  return `${nodes}${unhealthy} · ${framesPerSec.toFixed(0)} frames/s · ${framesReceived} this session`
}

/**
 * ESC telemetry belonging to ONE node. A popped-out device inspector must show
 * that device's traffic and nothing else — the scoping is a real filter over the
 * bus-wide stream, not a label on an unfiltered list.
 */
export function filterEscTelemetryForNode(
  escTelemetry: readonly DronecanEscTelemetry[],
  nodeId: number
): DronecanEscTelemetry[] {
  return escTelemetry.filter((entry) => entry.nodeId === nodeId)
}

/** Stable popout identity for a device — one window per node id, so clicking
 *  "Pop out" twice re-focuses the existing window instead of spawning a second. */
export function canDevicePopoutKey(nodeId: number): string {
  return `can-device-${nodeId}`
}

/** Window title for a device popout: the operator's/reported name plus the node
 *  id, so several popouts are told apart from the taskbar alone. */
export function canDevicePopoutTitle(nodeId: number, label: string | undefined): string {
  const trimmed = label?.trim()
  return trimmed ? `${trimmed} · node ${nodeId} — ArduConfigurator` : `Node ${nodeId} — ArduConfigurator`
}
