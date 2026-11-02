// Compass order: which compass ArduPilot uses first, decoded from the three
// lists the firmware keeps (AP_Compass.cpp, read 2026-10-22):
//
//   COMPASS_PRIO1..3_ID   the order, as device ids. 0 = "fill in on boot".
//                         Writable; takes effect after a reboot.
//   COMPASS_DEV_ID,2,3    what sits in instance slot 1..3 THIS boot. Set by
//                         the firmware, never written here. Reads 0 for a
//                         compass that was not found this boot.
//   COMPASS_DEV_ID4..8    detected with no slot left. Display only.
//
// At boot the firmware squashes gaps and duplicates out of the PRIO list and
// then swaps its instance state so that slot n IS priority n: USEn, EXTERNn,
// ORIENTn and the OFSn calibration travel with the device. So the row for a
// priority shows the settings of whichever slot currently holds that device.
//
// A device id is a packed uint32 (AP_HAL::Device::DeviceStructure): bus type
// in the low 3 bits, bus number in the next 5, the address in the next 8 and
// the sensor type in the next 8. DroneCAN compasses pack the node id as the
// address and sensor_id + 1 as the type.

export const COMPASS_PRIORITY_PARAM_IDS = ['COMPASS_PRIO1_ID', 'COMPASS_PRIO2_ID', 'COMPASS_PRIO3_ID'] as const
export const COMPASS_SLOT_DEV_ID_PARAM_IDS = ['COMPASS_DEV_ID', 'COMPASS_DEV_ID2', 'COMPASS_DEV_ID3'] as const
export const COMPASS_EXTRA_DEV_ID_PARAM_IDS = [
  'COMPASS_DEV_ID4',
  'COMPASS_DEV_ID5',
  'COMPASS_DEV_ID6',
  'COMPASS_DEV_ID7',
  'COMPASS_DEV_ID8'
] as const

const SLOT_PARAMS = [
  { use: 'COMPASS_USE', external: 'COMPASS_EXTERNAL', orient: 'COMPASS_ORIENT', offsets: ['COMPASS_OFS_X', 'COMPASS_OFS_Y', 'COMPASS_OFS_Z'] },
  { use: 'COMPASS_USE2', external: 'COMPASS_EXTERN2', orient: 'COMPASS_ORIENT2', offsets: ['COMPASS_OFS2_X', 'COMPASS_OFS2_Y', 'COMPASS_OFS2_Z'] },
  { use: 'COMPASS_USE3', external: 'COMPASS_EXTERN3', orient: 'COMPASS_ORIENT3', offsets: ['COMPASS_OFS3_X', 'COMPASS_OFS3_Y', 'COMPASS_OFS3_Z'] }
] as const

export function isCompassOrderParamId(paramId: string): boolean {
  return (COMPASS_PRIORITY_PARAM_IDS as readonly string[]).includes(paramId)
}

/** AP_HAL::Device::BusType. */
const BUS_TYPES: Record<number, string> = {
  0: 'Unknown bus',
  1: 'I2C',
  2: 'SPI',
  3: 'DroneCAN',
  4: 'SITL',
  5: 'MSP',
  6: 'Serial',
  7: 'WSPI'
}

/** AP_Compass_Backend.h DevTypes. */
const SENSOR_TYPES: Record<number, string> = {
  0x01: 'HMC5883 (old)',
  0x02: 'LSM303D',
  0x04: 'AK8963',
  0x05: 'BMM150',
  0x06: 'LSM9DS1',
  0x07: 'HMC5883',
  0x08: 'LIS3MDL',
  0x09: 'AK09916',
  0x0a: 'IST8310',
  0x0b: 'ICM20948',
  0x0c: 'MMC3416',
  0x0d: 'QMC5883L',
  0x0e: 'MAG3110',
  0x0f: 'SITL',
  0x10: 'IST8308',
  0x11: 'RM3100',
  0x12: 'RM3100',
  0x13: 'MMC5983',
  0x14: 'AK09918',
  0x15: 'AK09915',
  0x16: 'QMC5883P',
  0x17: 'BMM350',
  0x18: 'IIS2MDC',
  0x19: 'LIS2MDL'
}

export interface CompassDevice {
  devId: number
  busType: string
  bus: number
  address: number
  devType: number
  /** The chip, or "DroneCAN node 125" when the bus carries no chip name. */
  sensor: string
  /** Where it is: "I2C bus 1, address 0x0C" / "DroneCAN bus 1, node 125, sensor 1". */
  location: string
}

export function decodeCompassDeviceId(devId: number): CompassDevice {
  const id = devId >>> 0
  const busTypeCode = id & 0x7
  const bus = (id >>> 3) & 0x1f
  const address = (id >>> 8) & 0xff
  const devType = (id >>> 16) & 0xff
  const busType = BUS_TYPES[busTypeCode] ?? 'Unknown bus'
  if (busTypeCode === 3) {
    return {
      devId: id,
      busType,
      bus,
      address,
      devType,
      sensor: `DroneCAN node ${address}`,
      location: `CAN${bus + 1}, node ${address}, sensor ${devType}`
    }
  }
  const sensor = SENSOR_TYPES[devType] ?? `Compass type ${devType}`
  const hex = `0x${address.toString(16).toUpperCase().padStart(2, '0')}`
  const location =
    busTypeCode === 1
      ? `I2C bus ${bus}, address ${hex}`
      : busTypeCode === 2
        ? `SPI bus ${bus}, select ${address}`
        : `${busType} ${bus}, ${hex}`
  return { devId: id, busType, bus, address, devType, sensor, location }
}

export type CompassOrderState =
  /** The device in this priority slot was found this boot. */
  | 'detected'
  /** The slot names a device that was not found this boot: the ghost that
   *  fails pre-arm after a module is unplugged. */
  | 'missing'
  /** 0: the next compass found takes this slot. */
  | 'empty'

export interface CompassOrderRow {
  priority: 1 | 2 | 3
  paramId: (typeof COMPASS_PRIORITY_PARAM_IDS)[number]
  /** The stored id, with a staged draft applied. */
  devId: number
  /** The id the firmware reports in this slot this boot. */
  slotDevId: number
  device?: CompassDevice
  state: CompassOrderState
  /** The slot (1..3) whose per-instance settings belong to this device, when it was found. */
  slot?: 1 | 2 | 3
  use?: boolean
  external?: boolean
  calibrated?: boolean
  orientation?: number
}

export interface CompassOrderModel {
  /** COMPASS_PRIO1_ID is reported: the firmware has the priority list at all. */
  supported: boolean
  rows: CompassOrderRow[]
  /** Found this boot but every slot was taken. */
  extras: CompassDevice[]
  /** A staged PRIO value differs from what the vehicle reports. */
  changed: boolean
}

export interface CompassOrderInputs {
  parameters: ReadonlyArray<{ id: string; value: unknown }>
  /** Staged drafts by parameter id, as the editor keeps them. */
  editedValues: Readonly<Record<string, string>>
}

function readNumber(parameters: CompassOrderInputs['parameters'], id: string): number | undefined {
  const parameter = parameters.find((entry) => entry.id === id)
  return typeof parameter?.value === 'number' && Number.isFinite(parameter.value) ? parameter.value : undefined
}

export function buildCompassOrder({ parameters, editedValues }: CompassOrderInputs): CompassOrderModel {
  const stored = COMPASS_PRIORITY_PARAM_IDS.map((id) => readNumber(parameters, id))
  if (stored[0] === undefined) {
    return { supported: false, rows: [], extras: [], changed: false }
  }
  const effective = COMPASS_PRIORITY_PARAM_IDS.map((id, index) => {
    const edited = editedValues[id]
    const value = edited !== undefined && edited.trim() !== '' ? Number(edited) : stored[index]
    return Number.isFinite(value) ? (value as number) : 0
  })
  const slots = COMPASS_SLOT_DEV_ID_PARAM_IDS.map((id) => readNumber(parameters, id) ?? 0)

  const rows = effective.map((devId, index): CompassOrderRow => {
    const priority = (index + 1) as 1 | 2 | 3
    const paramId = COMPASS_PRIORITY_PARAM_IDS[index]
    const slotDevId = slots[index]
    if (devId === 0) {
      return { priority, paramId, devId, slotDevId, state: 'empty' }
    }
    const slotIndex = slots.findIndex((id) => id === devId)
    if (slotIndex === -1) {
      return { priority, paramId, devId, slotDevId, device: decodeCompassDeviceId(devId), state: 'missing' }
    }
    const slotParams = SLOT_PARAMS[slotIndex]
    const offsets = slotParams.offsets.map((id) => readNumber(parameters, id) ?? 0)
    return {
      priority,
      paramId,
      devId,
      slotDevId,
      device: decodeCompassDeviceId(devId),
      state: 'detected',
      slot: (slotIndex + 1) as 1 | 2 | 3,
      use: (readNumber(parameters, slotParams.use) ?? 0) !== 0,
      external: (readNumber(parameters, slotParams.external) ?? 0) !== 0,
      calibrated: offsets.some((offset) => offset !== 0),
      orientation: readNumber(parameters, slotParams.orient)
    }
  })

  const extras = COMPASS_EXTRA_DEV_ID_PARAM_IDS.map((id) => readNumber(parameters, id) ?? 0)
    .filter((devId) => devId !== 0)
    .map(decodeCompassDeviceId)

  const changed = effective.some((value, index) => value !== (stored[index] ?? 0))
  return { supported: true, rows, extras, changed }
}

export interface CompassOrderDraft {
  paramId: (typeof COMPASS_PRIORITY_PARAM_IDS)[number]
  value: string
}

/** Swap two priorities: the drafts for both PRIO parameters. */
export function swapCompassPriorities(model: CompassOrderModel, a: 1 | 2 | 3, b: 1 | 2 | 3): CompassOrderDraft[] {
  const rowA = model.rows[a - 1]
  const rowB = model.rows[b - 1]
  if (!rowA || !rowB || a === b) return []
  return [
    { paramId: rowA.paramId, value: String(rowB.devId) },
    { paramId: rowB.paramId, value: String(rowA.devId) }
  ]
}

/** Drop a priority and close the gap, the way the firmware would on boot --
 *  so what the operator sees staged is what the vehicle will have. */
export function removeCompassPriority(model: CompassOrderModel, priority: 1 | 2 | 3): CompassOrderDraft[] {
  const ids = model.rows.map((row) => row.devId)
  const next = [...ids.slice(0, priority - 1), ...ids.slice(priority), 0]
  return COMPASS_PRIORITY_PARAM_IDS.map((paramId, index) => ({ paramId, value: String(next[index]) })).filter(
    (draft, index) => draft.value !== String(ids[index])
  )
}
