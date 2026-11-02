import { describe, expect, it } from 'vitest'

import { buildCompassOrder, decodeCompassDeviceId, removeCompassPriority, swapCompassPriorities } from './compass-order'

// AK09916 (0x09) on I2C bus 1 at 0x0C; IST8310 (0x0A) on I2C bus 0 at 0x0E;
// RM3100 (0x11) on SPI bus 0 select 1; a DroneCAN node 125, sensor 0 on CAN1.
const AK09916_I2C = 1 | (1 << 3) | (0x0c << 8) | (0x09 << 16)
const IST8310_I2C = 1 | (0 << 3) | (0x0e << 8) | (0x0a << 16)
const RM3100_SPI = 2 | (0 << 3) | (1 << 8) | (0x11 << 16)
const DRONECAN = 3 | (0 << 3) | (125 << 8) | (1 << 16)

describe('decodeCompassDeviceId', () => {
  it('unpacks bus type, bus, address and sensor type into words', () => {
    expect(decodeCompassDeviceId(AK09916_I2C)).toMatchObject({ busType: 'I2C', bus: 1, address: 0x0c, sensor: 'AK09916', location: 'I2C bus 1, address 0x0C' })
    expect(decodeCompassDeviceId(RM3100_SPI)).toMatchObject({ busType: 'SPI', sensor: 'RM3100', location: 'SPI bus 0, select 1' })
    expect(decodeCompassDeviceId(DRONECAN)).toMatchObject({ busType: 'DroneCAN', sensor: 'DroneCAN node 125', location: 'CAN1, node 125, sensor 1' })
  })

  it('names an unknown chip by its type number rather than failing', () => {
    expect(decodeCompassDeviceId(1 | (0x7e << 16)).sensor).toBe('Compass type 126')
  })
})

function params(values: Record<string, number>): { id: string; value: number }[] {
  return Object.entries(values).map(([id, value]) => ({ id, value }))
}

const vehicle = {
  COMPASS_PRIO1_ID: AK09916_I2C,
  COMPASS_PRIO2_ID: IST8310_I2C,
  COMPASS_PRIO3_ID: RM3100_SPI,
  COMPASS_DEV_ID: AK09916_I2C,
  COMPASS_DEV_ID2: IST8310_I2C,
  COMPASS_DEV_ID3: 0,
  COMPASS_DEV_ID4: DRONECAN,
  COMPASS_USE: 1,
  COMPASS_USE2: 0,
  COMPASS_EXTERNAL: 1,
  COMPASS_EXTERN2: 0,
  COMPASS_ORIENT: 0,
  COMPASS_ORIENT2: 0,
  COMPASS_OFS_X: -12.5,
  COMPASS_OFS_Y: 33.1,
  COMPASS_OFS_Z: -8,
  COMPASS_OFS2_X: 0,
  COMPASS_OFS2_Y: 0,
  COMPASS_OFS2_Z: 0
}

describe('buildCompassOrder', () => {
  it('is unsupported without the priority list', () => {
    expect(buildCompassOrder({ parameters: params({ COMPASS_USE: 1 }), editedValues: {} }).supported).toBe(false)
  })

  it('reads each priority with the settings of the slot that holds its device, flags the ghost, lists the extras', () => {
    const model = buildCompassOrder({ parameters: params(vehicle), editedValues: {} })
    expect(model.supported).toBe(true)
    expect(model.rows.map((row) => row.state)).toEqual(['detected', 'detected', 'missing'])
    expect(model.rows[0]).toMatchObject({ slot: 1, use: true, external: true, calibrated: true })
    expect(model.rows[1]).toMatchObject({ slot: 2, use: false, external: false, calibrated: false })
    expect(model.rows[2].device?.sensor).toBe('RM3100')
    expect(model.extras.map((device) => device.sensor)).toEqual(['DroneCAN node 125'])
    expect(model.changed).toBe(false)
  })

  it('follows staged PRIO drafts: a swapped list keeps each device with its own slot settings', () => {
    const model = buildCompassOrder({
      parameters: params(vehicle),
      editedValues: { COMPASS_PRIO1_ID: String(IST8310_I2C), COMPASS_PRIO2_ID: String(AK09916_I2C) }
    })
    expect(model.changed).toBe(true)
    expect(model.rows[0]).toMatchObject({ device: { sensor: 'IST8310' }, slot: 2, external: false })
    expect(model.rows[1]).toMatchObject({ device: { sensor: 'AK09916' }, slot: 1, external: true })
  })

  it('shows an empty slot as empty, not as a device', () => {
    const model = buildCompassOrder({ parameters: params({ ...vehicle, COMPASS_PRIO3_ID: 0 }), editedValues: {} })
    expect(model.rows[2]).toMatchObject({ state: 'empty', devId: 0 })
    expect(model.rows[2].device).toBeUndefined()
  })
})

describe('swap and remove', () => {
  const model = buildCompassOrder({ parameters: params(vehicle), editedValues: {} })

  it('swaps two priorities as two PRIO drafts', () => {
    expect(swapCompassPriorities(model, 1, 2)).toEqual([
      { paramId: 'COMPASS_PRIO1_ID', value: String(IST8310_I2C) },
      { paramId: 'COMPASS_PRIO2_ID', value: String(AK09916_I2C) }
    ])
    expect(swapCompassPriorities(model, 2, 2)).toEqual([])
  })

  it('removes a priority and closes the gap the way the firmware does on boot', () => {
    expect(removeCompassPriority(model, 2)).toEqual([
      { paramId: 'COMPASS_PRIO2_ID', value: String(RM3100_SPI) },
      { paramId: 'COMPASS_PRIO3_ID', value: '0' }
    ])
    expect(removeCompassPriority(model, 3)).toEqual([{ paramId: 'COMPASS_PRIO3_ID', value: '0' }])
  })
})
