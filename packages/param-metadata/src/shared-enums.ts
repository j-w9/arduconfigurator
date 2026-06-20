// Enums shared across every vehicle catalog (AHRS_ORIENTATION,
// COMPASS_*, …). Centralized so a curated edit to one of these
// surfaces consistently in Copter/Plane/Rover/Sub instead of forking
// four times.

import type { ParameterValueOption } from './types.js'

/**
 * AHRS_ORIENTATION: the IMU/compass mounting rotation. Values are an
 * ArduPilot enum (0..43 + custom 100..102) used by every vehicle. The
 * upstream parameter docs ship the same enum across Copter / Plane /
 * Rover / Sub; matching Mission Planner's spacing here so the dropdown
 * reads naturally instead of "Yaw180Roll90".
 */
export const AHRS_ORIENTATION_OPTIONS: ParameterValueOption[] = [
  { value: 0, label: 'None' },
  { value: 1, label: 'Yaw 45' },
  { value: 2, label: 'Yaw 90' },
  { value: 3, label: 'Yaw 135' },
  { value: 4, label: 'Yaw 180' },
  { value: 5, label: 'Yaw 225' },
  { value: 6, label: 'Yaw 270' },
  { value: 7, label: 'Yaw 315' },
  { value: 8, label: 'Roll 180' },
  { value: 9, label: 'Yaw 45 Roll 180' },
  { value: 10, label: 'Yaw 90 Roll 180' },
  { value: 11, label: 'Yaw 135 Roll 180' },
  { value: 12, label: 'Pitch 180' },
  { value: 13, label: 'Yaw 225 Roll 180' },
  { value: 14, label: 'Yaw 270 Roll 180' },
  { value: 15, label: 'Yaw 315 Roll 180' },
  { value: 16, label: 'Roll 90' },
  { value: 17, label: 'Yaw 45 Roll 90' },
  { value: 18, label: 'Yaw 90 Roll 90' },
  { value: 19, label: 'Yaw 135 Roll 90' },
  { value: 20, label: 'Roll 270' },
  { value: 21, label: 'Yaw 45 Roll 270' },
  { value: 22, label: 'Yaw 90 Roll 270' },
  { value: 23, label: 'Yaw 135 Roll 270' },
  { value: 24, label: 'Pitch 90' },
  { value: 25, label: 'Pitch 270' },
  { value: 26, label: 'Yaw 90 Pitch 180' },
  { value: 27, label: 'Yaw 270 Pitch 180' },
  { value: 28, label: 'Pitch 90 Roll 90' },
  { value: 29, label: 'Pitch 90 Roll 180' },
  { value: 30, label: 'Pitch 90 Roll 270' },
  { value: 31, label: 'Pitch 180 Roll 90' },
  { value: 32, label: 'Pitch 180 Roll 270' },
  { value: 33, label: 'Pitch 270 Roll 90' },
  { value: 34, label: 'Pitch 270 Roll 180' },
  { value: 35, label: 'Pitch 270 Roll 270' },
  { value: 36, label: 'Yaw 90 Pitch 180 Roll 90' },
  { value: 37, label: 'Yaw 270 Roll 90' },
  { value: 38, label: 'Yaw 293 Pitch 68 Roll 180' },
  { value: 39, label: 'Pitch 315' },
  { value: 40, label: 'Pitch 315 Roll 90' },
  { value: 42, label: 'Roll 45' },
  { value: 43, label: 'Roll 315' },
  { value: 100, label: 'Custom (4.1 and older)' },
  { value: 101, label: 'Custom 1' },
  { value: 102, label: 'Custom 2' }
]
