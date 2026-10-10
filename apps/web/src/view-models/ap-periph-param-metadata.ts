import type { DronecanParamCatalogDef } from './dronecan-param-display'

// AP_Periph (DroneCAN peripheral) parameter metadata for the CAN/DroneCAN param
// grids, used as a fallback after the FC catalog.
//
// The bulk is GENERATED from ArduPilot source (generated/ap-periph-params.ts,
// via scripts/generate-ap-periph-params.py = ArduPilot's own
// `param_parse.py --vehicle AP_Periph`): every documented AP_Periph param —
// Tools/AP_Periph/Parameters.cpp plus the library groups it registers (GPS,
// COMPASS_, BARO, RNGFND, BATT, OUT, NTF_, SERIAL, STAT_, …).
//
// The curated overlay below wins FIELD BY FIELD over the generated def: it keeps
// shorter grid labels, "DroneCAN" (not the legacy "UAVCAN") in CAN_PROTOCOL,
// friendlier enum wording, and DEBUG's bits spelled out in its description (the
// grid shows a description, not the bitmask). Fields the overlay leaves out
// (units, step, reboot-required, bitmask bits, the FLASH_BOOTLOADER "DANGER"
// text) come from the generated def.
//
// Bitmask params (DEBUG, BATT_HIDE_MASK) carry `bits`, never `options` — the
// display helper treats `options` as a single-select enum, which would
// mislabel a bitmask value.
const CURATED_OVERLAY: Record<string, DronecanParamCatalogDef> = {
  FORMAT_VERSION: { label: 'EEPROM format version', description: 'Storage format version number for this node.' },
  CAN_NODE: {
    label: 'DroneCAN node ID',
    description: 'DroneCAN node ID this node uses on all networks (0 = dynamic allocation).',
    minimum: 0,
    maximum: 127
  },
  CAN_BAUDRATE: { label: 'CAN bitrate', description: 'Bitrate of the CAN interface.', minimum: 10000, maximum: 1000000 },
  CAN2_BAUDRATE: { label: 'CAN2 bitrate', description: 'Bitrate of the CAN2 interface.', minimum: 10000, maximum: 1000000 },
  CAN_FDMODE: {
    label: 'CAN FD mode',
    description: 'Enable CAN FD mode on this node.',
    options: [
      { value: 0, label: 'Disabled' },
      { value: 1, label: 'Enabled' }
    ]
  },
  CAN_FDBAUDRATE: {
    label: 'CAN FD data bitrate',
    description: 'Bitrate for the data section in CAN FD mode (CAN1).',
    options: [
      { value: 1, label: '1 Mbit' },
      { value: 2, label: '2 Mbit' },
      { value: 4, label: '4 Mbit' },
      { value: 5, label: '5 Mbit' },
      { value: 8, label: '8 Mbit' }
    ]
  },
  CAN_TERMINATE: {
    label: 'CAN termination',
    description: 'Enable CAN software termination in this node.',
    options: [
      { value: 0, label: 'Disabled' },
      { value: 1, label: 'Enabled' }
    ]
  },
  CAN_PROTOCOL: {
    label: 'CAN protocol',
    description: 'Protocol used on this CAN port.',
    options: [
      { value: 0, label: 'Disabled' },
      { value: 1, label: 'DroneCAN' },
      { value: 4, label: 'PiccoloCAN' },
      { value: 6, label: 'EFI_NWPMU' },
      { value: 7, label: 'USD1' },
      { value: 8, label: 'KDECAN' }
    ]
  },
  CAN_SLCAN_CPORT: {
    label: 'SLCAN route',
    description: 'CAN interface routed to the SLCAN serial port.',
    options: [
      { value: 0, label: 'Disabled' },
      { value: 1, label: 'First interface' },
      { value: 2, label: 'Second interface' }
    ]
  },
  FLASH_BOOTLOADER: {
    label: 'Trigger bootloader update',
    minimum: 0,
    maximum: 1
  },
  DEBUG: {
    label: 'Debug options',
    description: 'Debug bitmask: 0=show free stack, 1=auto-reboot after 15s, 2=send stats.'
  },
  BRD_SERIAL_NUM: { label: 'Board serial number', description: 'Serial number of this device.', minimum: 0, maximum: 2147483648 },
  BUZZER_VOLUME: { label: 'Buzzer volume', description: 'Notification buzzer volume.', minimum: 0, maximum: 100, unit: '%' },
  GPS_PORT: { label: 'GPS serial port', description: 'Serial port the GPS is connected to.', minimum: 0, maximum: 10 },
  MB_CAN_PORT: {
    label: 'Moving-baseline CAN port',
    description: 'How moving-baseline RTK data is transmitted across CAN ports.',
    options: [
      { value: 0, label: 'All ports' },
      { value: 1, label: 'Auto-select remaining port' }
    ]
  },
  BARO_ENABLE: {
    label: 'Barometer enable',
    description: 'Enable the barometer on this node.',
    options: [
      { value: 0, label: 'Disabled' },
      { value: 1, label: 'Enabled' }
    ]
  }
}

/** The hand-curated entries alone: in the main bundle, so a node's grid has
 *  its best-known labels at once while the generated table loads. */
export const AP_PERIPH_CURATED_METADATA: Readonly<Record<string, DronecanParamCatalogDef>> = CURATED_OVERLAY

/** The generated table with the curated overlay on top, field by field. */
export function mergeApPeriphMetadata(
  generated: Readonly<Record<string, DronecanParamCatalogDef>>
): Record<string, DronecanParamCatalogDef> {
  const merged: Record<string, DronecanParamCatalogDef> = { ...generated }
  for (const [name, curated] of Object.entries(CURATED_OVERLAY)) {
    merged[name] = { ...generated[name], ...curated }
  }
  return merged
}

let loading: Promise<Record<string, DronecanParamCatalogDef>> | undefined

/**
 * Every AP_Periph param (generated + curated), loaded on first use: the
 * generated table is ~46 KB gzipped and only the CAN surfaces need it, so it
 * is its own chunk rather than part of the app's first load.
 */
export function loadApPeriphParamMetadata(): Promise<Record<string, DronecanParamCatalogDef>> {
  loading ??= import('./generated/ap-periph-params').then((module) => mergeApPeriphMetadata(module.AP_PERIPH_GENERATED_PARAMS))
  return loading
}
