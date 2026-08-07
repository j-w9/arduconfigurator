// Detect the common "I set a peripheral to DroneCAN but the CAN bus is still
// off" trap. When a driver param is set to a DroneCAN value but CAN bus 1 isn't
// enabled for DroneCAN, this surfaces a one-click enable (CAN_P1_DRIVER=1 +
// CAN_D1_PROTOCOL=1) — the two params a fresh board needs before any DroneCAN
// GPS/compass/battery node will talk. Values verified against ArduPilot source:
//   CAN_Pn_DRIVER  0:Disabled 1:First driver … (enabling it enables the bus)
//   CAN_Dn_PROTOCOL 0:Disabled 1:DroneCAN 4:PiccoloCAN …
// Both are @RebootRequired.

import type { ConfiguratorSnapshot } from '@arduconfig/ardupilot-core'

const CAN_D_PROTOCOL_DRONECAN = 1

// Driver params whose "this peripheral is on DroneCAN" value(s) should trigger
// the helper. Deliberately a small, high-confidence set (GPS is by far the most
// common); extend as more DroneCAN peripheral flows are covered.
const DRONECAN_DRIVER_TRIGGERS: ReadonlyArray<{ paramId: string; values: readonly number[]; label: string }> = [
  { paramId: 'GPS_TYPE', values: [9, 22, 23], label: 'GPS is set to DroneCAN' },
  { paramId: 'GPS_TYPE2', values: [9, 22, 23], label: 'GPS 2 is set to DroneCAN' },
  { paramId: 'BATT_MONITOR', values: [8], label: 'Battery monitor is set to DroneCAN' },
  { paramId: 'BATT2_MONITOR', values: [8], label: 'Battery monitor 2 is set to DroneCAN' },
  // FLOW_TYPE 6 = DroneCAN (HereFlow and friends). Verified against
  // libraries/AP_OpticalFlow/AP_OpticalFlow.cpp @Values `6:DroneCAN` and
  // AP_OpticalFlow.h `Type::UAVCAN = 6` (branch origin/ArduPilot-4.7; the
  // 4.6.3 tag carries the identical value). Added because a CAN flow sensor is
  // exactly as dead-on-a-disabled-bus as a CAN GPS, and the operator report
  // that drove the flow config section was a DroneCAN sensor that reported
  // nothing.
  { paramId: 'FLOW_TYPE', values: [6], label: 'Optical flow is set to DroneCAN' }
]

export interface CanEnablementState {
  /** True when a DroneCAN driver is selected but CAN bus 1 isn't enabled for it. */
  needsEnable: boolean
  /** Human-readable reasons (e.g. "GPS is set to DroneCAN"). */
  triggerLabels: string[]
  /**
   * The driver params that fired, so a surface can decide whether the prompt is
   * ITS business. The CAN tab shows the prompt for any trigger; the Servos ▸
   * Peripherals optical-flow section only shows it when FLOW_TYPE is one of
   * them (a DroneCAN GPS is not a reason to interrupt someone editing flow).
   */
  triggerParamIds: string[]
  /** The exact writes to enable DroneCAN on bus 1 (only params not already correct). */
  writes: Array<{ paramId: string; paramValue: number }>
}

const EMPTY: CanEnablementState = { needsEnable: false, triggerLabels: [], triggerParamIds: [], writes: [] }

function value(snapshot: ConfiguratorSnapshot, paramId: string): number | undefined {
  return snapshot.parameters.find((p) => p.id === paramId)?.value
}

export function deriveCanEnablement(snapshot: ConfiguratorSnapshot): CanEnablementState {
  // No CAN params reported → the board has no CAN bus; nothing to enable.
  const p1 = value(snapshot, 'CAN_P1_DRIVER')
  if (p1 === undefined) {
    return EMPTY
  }

  const firedTriggers = DRONECAN_DRIVER_TRIGGERS.filter((trigger) => {
    const current = value(snapshot, trigger.paramId)
    return current !== undefined && trigger.values.includes(Math.round(current))
  })
  const triggerLabels = firedTriggers.map((trigger) => trigger.label)
  const triggerParamIds = firedTriggers.map((trigger) => trigger.paramId)

  if (triggerLabels.length === 0) {
    return EMPTY
  }

  const d1 = value(snapshot, 'CAN_D1_PROTOCOL')
  const busEnabled = p1 >= 1 && d1 === CAN_D_PROTOCOL_DRONECAN
  if (busEnabled) {
    return EMPTY
  }

  const writes: CanEnablementState['writes'] = []
  if (!(p1 >= 1)) {
    writes.push({ paramId: 'CAN_P1_DRIVER', paramValue: 1 })
  }
  // Only stage the protocol write when the param exists and isn't already DroneCAN.
  if (value(snapshot, 'CAN_D1_PROTOCOL') !== undefined && d1 !== CAN_D_PROTOCOL_DRONECAN) {
    writes.push({ paramId: 'CAN_D1_PROTOCOL', paramValue: CAN_D_PROTOCOL_DRONECAN })
  }

  if (writes.length === 0) {
    return EMPTY
  }

  return { needsEnable: true, triggerLabels, triggerParamIds, writes }
}
