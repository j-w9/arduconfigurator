import type { DronecanParamCatalogDef } from './dronecan-param-display'

// PX4 "cannode" parameter metadata for the CAN/DroneCAN param grids: ARK,
// CUAV, Freefly and Holybro CAN peripherals run PX4, not AP_Periph, and their
// params (CANNODE_*, GPS_UBX_*, CAL_*, SENS_*) match nothing in the AP_Periph
// catalog. GENERATED from PX4's per-board parameter metadata by
// scripts/generate-px4-cannode-params.py (see the module header for the
// boards and the provenance; PX4 documentation is BSD-3-Clause).

export interface Px4CannodeParamMetadata {
  params: Readonly<Record<string, DronecanParamCatalogDef>>
  /** The DroneCAN node names PX4's cannode boards announce (org.ark.can-rtk-gps …). */
  nodeNames: ReadonlySet<string>
}

let loading: Promise<Px4CannodeParamMetadata> | undefined

/** Every PX4 cannode param, loaded on first use: only the CAN surfaces need
 *  it, so it is its own chunk rather than part of the app's first load. */
export function loadPx4CannodeParamMetadata(): Promise<Px4CannodeParamMetadata> {
  loading ??= import('./generated/px4-cannode-params').then((module) => ({
    params: module.PX4_CANNODE_GENERATED_PARAMS,
    nodeNames: new Set(module.PX4_CANNODE_NODE_NAMES)
  }))
  return loading
}
