// Shared rangefinder/lidar (RNGFND1_/RNGFND2_) parameter family. AP_RangeFinder
// exposes an identical per-instance set across Copter/Plane/Rover/Sub, so the
// definitions are generated once here and spread into each vehicle bundle.
// Values/ranges verified against libraries/AP_RangeFinder/AP_RangeFinder_Params.cpp.

import type { FirmwareMetadataBundle, ParameterValueOption } from './types.js'

// Labels match the canonical ArduPilot @Values verbatim (see the generated
// param-upstream catalog), so they read identically to the wiki / Mission Planner.
const RANGEFINDER_TYPE_OPTIONS: ParameterValueOption[] = [
  { value: 0, label: 'None' },
  { value: 1, label: 'Analog' },
  { value: 2, label: 'MaxbotixI2C' },
  { value: 3, label: 'LidarLite-I2C' },
  { value: 5, label: 'PWM' },
  { value: 6, label: 'BBB-PRU' },
  { value: 7, label: 'LightWareI2C' },
  { value: 8, label: 'LightWareSerial' },
  { value: 9, label: 'Bebop' },
  { value: 10, label: 'MAVLink' },
  { value: 11, label: 'USD1_Serial' },
  { value: 12, label: 'LeddarOne' },
  { value: 13, label: 'MaxbotixSerial' },
  { value: 14, label: 'TeraRangerI2C' },
  { value: 15, label: 'LidarLiteV3-I2C' },
  { value: 16, label: 'VL53L0X or VL53L1X' },
  { value: 17, label: 'NMEA' },
  { value: 18, label: 'WASP-LRF' },
  { value: 19, label: 'BenewakeTF02' },
  { value: 20, label: 'BenewakeTFmini-Serial' },
  { value: 21, label: 'LidarLightV3HP' },
  { value: 22, label: 'PWM' },
  { value: 23, label: 'BlueRoboticsPing' },
  { value: 24, label: 'DroneCAN' },
  { value: 25, label: 'BenewakeTFmini-I2C' },
  { value: 26, label: 'LanbaoPSK-CM8JL65-CC5' },
  { value: 27, label: 'BenewakeTF03' },
  { value: 28, label: 'VL53L1X-ShortRange' },
  { value: 29, label: 'LeddarVu8-Serial' },
  { value: 30, label: 'HC-SR04' },
  { value: 31, label: 'GYUS42v2' },
  { value: 32, label: 'MSP' },
  { value: 33, label: 'USD1_CAN' },
  { value: 34, label: 'Benewake_CAN' },
  { value: 35, label: 'TeraRangerSerial' },
  { value: 36, label: 'Lua_Scripting' },
  { value: 37, label: 'NoopLoop_TOFSense' },
  { value: 38, label: 'NoopLoop_TOFSense_CAN' },
  { value: 39, label: 'NRA24_CAN' },
  { value: 40, label: 'NoopLoop_TOFSenseF_I2C' },
  { value: 41, label: 'JRE_Serial' },
  { value: 42, label: 'Ainstein_LR_D1' },
  { value: 43, label: 'RDS02UF' },
  { value: 44, label: 'HexsoonRadar' },
  { value: 45, label: 'LightWare-GRF' },
  { value: 46, label: 'BenewakeTFS20L' },
  { value: 47, label: 'DTS6012M-Serial' },
  { value: 48, label: 'LightWare-GRF-I2C' },
  { value: 100, label: 'SITL' }
]

const RANGEFINDER_ORIENT_OPTIONS: ParameterValueOption[] = [
  { value: 0, label: 'Forward' },
  { value: 1, label: 'Forward-Right' },
  { value: 2, label: 'Right' },
  { value: 3, label: 'Back-Right' },
  { value: 4, label: 'Back' },
  { value: 5, label: 'Back-Left' },
  { value: 6, label: 'Left' },
  { value: 7, label: 'Forward-Left' },
  { value: 24, label: 'Up' },
  { value: 25, label: 'Down' }
]

/**
 * Builds the RNGFND{instance}_* parameter family (category `rangefinder`).
 * Instance 2's labels are suffixed so a second sensor stays distinguishable.
 */
export function buildRangefinderParameterDefinitions(instance: 1 | 2): FirmwareMetadataBundle['parameters'] {
  const p = `RNGFND${instance}_`
  const suffix = instance === 1 ? '' : ' 2'
  const which = instance === 1 ? 'the first' : 'the second'
  const pos = (axis: 'X' | 'Y' | 'Z') => {
    const name = axis === 'X' ? 'forward' : axis === 'Y' ? 'right' : 'down'
    return {
      id: `${p}POS_${axis}`,
      label: `Position ${axis}${suffix}`,
      description: `Sensor ${axis} offset (m, ${name}-positive) from the vehicle center of gravity.`,
      category: 'rangefinder',
      minimum: -5,
      maximum: 5,
      step: 0.01
    }
  }
  return {
    [`${p}TYPE`]: {
      id: `${p}TYPE`,
      label: `Rangefinder Type${suffix}`,
      description: `Driver for ${which} rangefinder/lidar. Pick the backend that matches your sensor.`,
      category: 'rangefinder',
      rebootRequired: true,
      notes: ['Reboot after changing the type. Serial sensors also need a SERIALx_PROTOCOL = Rangefinder assignment; I2C sensors use the address below.'],
      options: RANGEFINDER_TYPE_OPTIONS
    },
    [`${p}ORIENT`]: {
      id: `${p}ORIENT`,
      label: `Orientation${suffix}`,
      description: 'Direction the sensor faces. Down is used for terrain/altitude; Forward for obstacle avoidance.',
      category: 'rangefinder',
      options: RANGEFINDER_ORIENT_OPTIONS
    },
    [`${p}MIN`]: {
      id: `${p}MIN`,
      label: `Min Distance${suffix}`,
      description: 'Minimum reliable distance (m). Readings below this are treated as out of range.',
      category: 'rangefinder',
      minimum: 0,
      maximum: 100,
      step: 0.01
    },
    [`${p}MAX`]: {
      id: `${p}MAX`,
      label: `Max Distance${suffix}`,
      description: 'Maximum reliable distance (m). Readings above this are treated as out of range.',
      category: 'rangefinder',
      minimum: 0,
      maximum: 100,
      step: 0.01
    },
    [`${p}GNDCLR`]: {
      id: `${p}GNDCLR`,
      label: `Ground Clearance${suffix}`,
      description: 'Distance (m) the sensor reads when the vehicle is on the ground (mounting height).',
      category: 'rangefinder',
      minimum: 0.05,
      maximum: 1.5,
      step: 0.01
    },
    [`${p}ADDR`]: {
      id: `${p}ADDR`,
      label: `I2C Address${suffix}`,
      description: 'Bus address for I2C sensors (0 = default). Ignored by serial/CAN backends.',
      category: 'rangefinder',
      minimum: 0,
      maximum: 127,
      step: 1
    },
    [`${p}POS_X`]: pos('X'),
    [`${p}POS_Y`]: pos('Y'),
    [`${p}POS_Z`]: pos('Z')
  }
}
