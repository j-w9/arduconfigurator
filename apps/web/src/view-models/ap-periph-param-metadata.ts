import type { DronecanParamCatalogDef } from './dronecan-param-display'

// Curated metadata for AP_Periph-specific params (CAN_*, FLASH_BOOTLOADER, etc.)
// that the flight-controller catalog doesn't know — so the CAN/DroneCAN param
// grids enrich them (label / range / enum) too. Verified against
// Tools/AP_Periph/Parameters.cpp. The shared param families a periph reuses
// (GPS_*, COMPASS_*, BARO_*, NTF_*, …) are already covered by the FC catalog;
// this only fills the periph-only gaps. Used as a fallback after the FC catalog.
//
// Bitmask params (DEBUG, BATT_HIDE_MASK) intentionally carry no `options` —
// the display helper treats `options` as a single-select enum, which would
// mislabel a bitmask value; a label + description is the useful part.
export const AP_PERIPH_PARAM_METADATA: Record<string, DronecanParamCatalogDef> = {
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
    description: 'Set to 1 to flash the bootloader from this firmware (advanced).',
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
