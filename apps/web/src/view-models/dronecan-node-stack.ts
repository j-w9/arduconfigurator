/**
 * Which firmware a DroneCAN node runs — that decides where its parameter
 * metadata comes from. AP_Periph nodes (ArduPilot) take the AP_Periph catalog;
 * PX4 "cannode" peripherals (ARK, CUAV, Freefly, Holybro CAN GPS/flow boards)
 * expose PX4 parameters (CANNODE_*, GPS_UBX_*, CAL_*), so the AP_Periph names
 * match nothing and the PX4 catalog is the right source.
 */
export type DronecanNodeStack = 'ap_periph' | 'px4' | 'unknown'

/** Params only a PX4 cannode build has. */
const PX4_SIGNATURE_PARAMS = new Set(['CANNODE_NODE_ID', 'CANNODE_BITRATE', 'CANNODE_TERM'])
/** Params only an AP_Periph build has. */
const AP_PERIPH_SIGNATURE_PARAMS = new Set(['CAN_NODE', 'FORMAT_VERSION', 'FLASH_BOOTLOADER'])

/**
 * The node's parameter names decide first (they are what the node really
 * runs); before any parameter is read, the node name does — PX4's cannode
 * boards announce the names in `px4NodeNames` (org.ark.can-rtk-gps …) and
 * AP_Periph builds announce org.ardupilot.* or a vendor name.
 */
export function dronecanNodeStack(
  node: { name?: string; parameters: ReadonlyArray<{ name: string }> },
  px4NodeNames: ReadonlySet<string> | readonly string[] = []
): DronecanNodeStack {
  for (const entry of node.parameters) {
    if (PX4_SIGNATURE_PARAMS.has(entry.name)) return 'px4'
    if (AP_PERIPH_SIGNATURE_PARAMS.has(entry.name)) return 'ap_periph'
  }
  const name = node.name ?? ''
  if (name.length === 0) return 'unknown'
  const px4Names = px4NodeNames instanceof Set ? px4NodeNames : new Set(px4NodeNames)
  if (px4Names.has(name) || name.startsWith('org.ark.') || name.startsWith('org.px4.')) return 'px4'
  if (name.startsWith('org.ardupilot.')) return 'ap_periph'
  return 'unknown'
}

export function dronecanNodeStackLabel(stack: DronecanNodeStack): string {
  return stack === 'px4' ? 'PX4 cannode' : stack === 'ap_periph' ? 'AP_Periph' : '—'
}
