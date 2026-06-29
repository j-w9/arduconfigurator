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

const RANGEFINDER_PIN_OPTIONS: ParameterValueOption[] = [
  { value: -1, label: 'Not Used' },
  { value: 11, label: 'Pixracer' },
  { value: 13, label: 'Pixhawk ADC4' },
  { value: 14, label: 'Pixhawk ADC3' },
  { value: 15, label: 'Pixhawk ADC6/Pixhawk2 ADC' },
  { value: 50, label: 'AUX1' },
  { value: 51, label: 'AUX2' },
  { value: 52, label: 'AUX3' },
  { value: 53, label: 'AUX4' },
  { value: 54, label: 'AUX5' },
  { value: 55, label: 'AUX6' },
  { value: 103, label: 'Pixhawk SBUS' }
]

const RANGEFINDER_STOP_PIN_OPTIONS: ParameterValueOption[] = [
  { value: -1, label: 'Not Used' },
  { value: 50, label: 'AUX1' },
  { value: 51, label: 'AUX2' },
  { value: 52, label: 'AUX3' },
  { value: 53, label: 'AUX4' },
  { value: 54, label: 'AUX5' },
  { value: 55, label: 'AUX6' },
  { value: 111, label: 'PX4 FMU Relay1' },
  { value: 112, label: 'PX4 FMU Relay2' },
  { value: 113, label: 'PX4IO Relay1' },
  { value: 114, label: 'PX4IO Relay2' },
  { value: 115, label: 'PX4IO ACC1' },
  { value: 116, label: 'PX4IO ACC2' }
]

const RANGEFINDER_FUNCTION_OPTIONS: ParameterValueOption[] = [
  { value: 0, label: 'Linear' },
  { value: 1, label: 'Inverted' },
  { value: 2, label: 'Hyperbolic' }
]

const RANGEFINDER_RMETRIC_OPTIONS: ParameterValueOption[] = [
  { value: 0, label: 'No' },
  { value: 1, label: 'Yes' }
]

/**
 * Builds the RNGFND{instance}_* parameter family (category `rangefinder`).
 * Instance 2's labels are suffixed so a second sensor stays distinguishable.
 * Analog/PWM-only knobs carry `visibleWhen` so they appear only once the
 * matching TYPE is selected.
 */
export function buildRangefinderParameterDefinitions(instance: 1 | 2): FirmwareMetadataBundle['parameters'] {
  const p = `RNGFND${instance}_`
  const suffix = instance === 1 ? '' : ' 2'
  const which = instance === 1 ? 'the first' : 'the second'
  const ctrlType = `${p}TYPE`
  const ANALOG = [1]
  const PWM = [5, 22]
  const ANALOG_OR_PWM = [1, 5, 22]
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
    // Legacy pre-4.7 distance params (centimetres). ArduPilot 4.7 renamed these
    // to the metre-based MIN/MAX/GNDCLR above. Both are curated so the field
    // binds whichever the FC streams — the peripherals card only renders params
    // actually present in the synced tree, so 4.6 shows the _CM/GNDCLEAR set and
    // 4.7 shows the metre set, never both. Can't be aliased (units differ).
    // Ranges source-verified vs AP_RangeFinder_Params.cpp on Copter-4.6.3.
    [`${p}MIN_CM`]: {
      id: `${p}MIN_CM`,
      label: `Min Distance${suffix}`,
      description: 'Minimum reliable distance (cm). Pre-4.7 firmware; 4.7+ uses the metre-based Min Distance.',
      category: 'rangefinder',
      unit: 'cm',
      minimum: 0,
      maximum: 10000,
      step: 1
    },
    [`${p}MAX_CM`]: {
      id: `${p}MAX_CM`,
      label: `Max Distance${suffix}`,
      description: 'Maximum reliable distance (cm). Pre-4.7 firmware; 4.7+ uses the metre-based Max Distance.',
      category: 'rangefinder',
      unit: 'cm',
      minimum: 0,
      maximum: 10000,
      step: 1
    },
    [`${p}GNDCLEAR`]: {
      id: `${p}GNDCLEAR`,
      label: `Ground Clearance${suffix}`,
      description: 'Distance (cm) the sensor reads on the ground (mounting height). Pre-4.7 firmware; 4.7+ uses the metre-based Ground Clearance.',
      category: 'rangefinder',
      unit: 'cm',
      minimum: 5,
      maximum: 127,
      step: 1
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
    [`${p}POS_Z`]: pos('Z'),
    // Analog / PWM-only knobs — revealed by visibleWhen once the matching
    // TYPE is selected.
    [`${p}PIN`]: {
      id: `${p}PIN`,
      label: `Analog/PWM Pin${suffix}`,
      description: 'ADC (analog) or PWM input pin the sensor is wired to.',
      category: 'rangefinder',
      minimum: -1,
      maximum: 127,
      options: RANGEFINDER_PIN_OPTIONS,
      visibleWhen: { paramId: ctrlType, in: ANALOG_OR_PWM }
    },
    [`${p}FUNCTION`]: {
      id: `${p}FUNCTION`,
      label: `Analog Function${suffix}`,
      description: 'Transfer function applied to the analog voltage before scaling.',
      category: 'rangefinder',
      options: RANGEFINDER_FUNCTION_OPTIONS,
      visibleWhen: { paramId: ctrlType, in: ANALOG }
    },
    [`${p}SCALING`]: {
      id: `${p}SCALING`,
      label: `Analog Scaling${suffix}`,
      description: 'Distance per volt (m/V) for analog sensors.',
      category: 'rangefinder',
      unit: 'm/V',
      step: 0.01,
      visibleWhen: { paramId: ctrlType, in: ANALOG }
    },
    [`${p}OFFSET`]: {
      id: `${p}OFFSET`,
      label: `Analog Offset${suffix}`,
      description: 'Voltage (V) at zero distance for analog sensors.',
      category: 'rangefinder',
      unit: 'V',
      step: 0.01,
      visibleWhen: { paramId: ctrlType, in: ANALOG }
    },
    [`${p}RMETRIC`]: {
      id: `${p}RMETRIC`,
      label: `Ratiometric${suffix}`,
      description: 'Whether the analog sensor output scales with supply voltage.',
      category: 'rangefinder',
      options: RANGEFINDER_RMETRIC_OPTIONS,
      visibleWhen: { paramId: ctrlType, in: ANALOG }
    },
    [`${p}STOP_PIN`]: {
      id: `${p}STOP_PIN`,
      label: `Stop Pin${suffix}`,
      description: 'Optional GPIO that powers the sensor down between reads (analog/PWM).',
      category: 'rangefinder',
      minimum: -1,
      maximum: 127,
      options: RANGEFINDER_STOP_PIN_OPTIONS,
      visibleWhen: { paramId: ctrlType, in: ANALOG_OR_PWM }
    },
    [`${p}PWRRNG`]: {
      id: `${p}PWRRNG`,
      label: `Power-save Range${suffix}`,
      description: 'Above this altitude (m) the PWM sensor is powered down to save energy. 0 disables.',
      category: 'rangefinder',
      unit: 'm',
      minimum: 0,
      maximum: 32767,
      step: 1,
      visibleWhen: { paramId: ctrlType, in: PWM }
    }
  }
}
