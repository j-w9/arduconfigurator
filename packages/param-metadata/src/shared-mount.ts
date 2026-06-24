// Shared gimbal/mount (MNT1_/MNT2_) parameter family. AP_Mount exposes an
// identical per-instance parameter set across Copter/Plane/Rover/Sub, so the
// definitions are generated once here and spread into each vehicle bundle.
// Values/ranges/bitmask verified against libraries/AP_Mount/AP_Mount_Params.cpp.

import type { FirmwareMetadataBundle, ParameterValueOption } from './types.js'

const MOUNT_TYPE_OPTIONS: ParameterValueOption[] = [
  { value: 0, label: 'None' },
  { value: 1, label: 'Servo' },
  { value: 2, label: '3DR Solo' },
  { value: 3, label: 'Alexmos Serial' },
  { value: 4, label: 'SToRM32 MAVLink' },
  { value: 5, label: 'SToRM32 Serial' },
  { value: 6, label: 'Gremsy / AVT (MAVLink)' },
  { value: 7, label: 'BrushlessPWM' },
  { value: 8, label: 'Siyi' },
  { value: 9, label: 'Scripting' },
  { value: 10, label: 'Xacti' },
  { value: 11, label: 'Viewpro' },
  { value: 12, label: 'Topotek' },
  { value: 13, label: 'CADDX' },
  { value: 14, label: 'XFRobot' }
]

const MOUNT_DEFLT_MODE_OPTIONS: ParameterValueOption[] = [
  { value: 0, label: 'Retracted' },
  { value: 1, label: 'Neutral' },
  { value: 2, label: 'MAVLink Targeting' },
  { value: 3, label: 'RC Targeting' },
  { value: 4, label: 'GPS Point' },
  { value: 5, label: 'SysID Target' },
  { value: 6, label: 'Home Location' }
]

// @Bitmask values are bit indices (matching the SERIAL_OPTIONS convention);
// ScopedBitmaskField ORs (1<<index) for the stored value.
const MOUNT_OPTIONS_BITS: ParameterValueOption[] = [
  { value: 0, label: 'Keep RC lock state from previous mode' },
  { value: 1, label: 'Return to neutral angles on RC failsafe' },
  { value: 2, label: 'Force FPV lock on roll and pitch' }
]

/**
 * Builds the MNT{instance}_* parameter family (category `gimbal`). The set is
 * identical for instances 1 and 2; instance 2's labels are suffixed so a second
 * mount stays distinguishable in the shared Gimbal / Mount section.
 */
export function buildMountParameterDefinitions(instance: 1 | 2): FirmwareMetadataBundle['parameters'] {
  const p = `MNT${instance}_`
  const suffix = instance === 1 ? '' : ' 2'
  const which = instance === 1 ? 'the first' : 'the second'
  const angle = (axis: string, bound: 'minimum' | 'maximum') => ({
    id: `${p}${axis}_${bound === 'minimum' ? 'MIN' : 'MAX'}`,
    label: `${axis === 'PITCH' ? 'Pitch' : axis === 'ROLL' ? 'Roll' : 'Yaw'}${suffix} ${bound === 'minimum' ? 'Min' : 'Max'}`,
    description: `${bound === 'minimum' ? 'Minimum' : 'Maximum'} ${axis.toLowerCase()} angle (deg) for ${which} mount.`,
    category: 'gimbal',
    minimum: axis === 'PITCH' ? -90 : -180,
    maximum: axis === 'PITCH' ? 90 : 180,
    step: 1
  })
  const angleTrim = (axisLetter: 'X' | 'Y' | 'Z', kind: 'RETRACT' | 'NEUTRAL') => {
    const axisName = axisLetter === 'X' ? 'roll' : axisLetter === 'Y' ? 'pitch' : 'yaw'
    const kindLabel = kind === 'RETRACT' ? 'Retract' : 'Neutral'
    return {
      id: `${p}${kind}_${axisLetter}`,
      label: `${kindLabel}${suffix} ${axisName[0].toUpperCase()}${axisName.slice(1)}`,
      description: `${axisName[0].toUpperCase()}${axisName.slice(1)} angle (deg) commanded in the ${kind === 'RETRACT' ? 'retracted' : 'neutral'} position.`,
      category: 'gimbal',
      minimum: -180,
      maximum: 180,
      step: 1
    }
  }
  return {
    [`${p}TYPE`]: {
      id: `${p}TYPE`,
      label: `Gimbal Driver${suffix}`,
      description: `Mount/gimbal driver for ${which} mount. Pick the backend that matches your gimbal hardware.`,
      category: 'gimbal',
      rebootRequired: true,
      notes: ['Reboot after changing the driver. Serial gimbals also need a SERIALx_PROTOCOL assignment; Servo gimbals need SERVOx_FUNCTION mount roles.'],
      options: MOUNT_TYPE_OPTIONS
    },
    [`${p}DEFLT_MODE`]: {
      id: `${p}DEFLT_MODE`,
      label: `Default Mode${suffix}`,
      description: 'Mount mode entered on startup and when no other targeting command is active.',
      category: 'gimbal',
      options: MOUNT_DEFLT_MODE_OPTIONS
    },
    [`${p}RC_RATE`]: {
      id: `${p}RC_RATE`,
      label: `RC Control Rate${suffix}`,
      description: 'Rate (deg/s) at which RC input slews the gimbal in RC-targeting mode. 0 selects angle (non-rate) control.',
      category: 'gimbal',
      minimum: 0,
      maximum: 90,
      step: 1
    },
    [`${p}PITCH_MIN`]: angle('PITCH', 'minimum'),
    [`${p}PITCH_MAX`]: angle('PITCH', 'maximum'),
    [`${p}ROLL_MIN`]: angle('ROLL', 'minimum'),
    [`${p}ROLL_MAX`]: angle('ROLL', 'maximum'),
    [`${p}YAW_MIN`]: angle('YAW', 'minimum'),
    [`${p}YAW_MAX`]: angle('YAW', 'maximum'),
    [`${p}RETRACT_X`]: angleTrim('X', 'RETRACT'),
    [`${p}RETRACT_Y`]: angleTrim('Y', 'RETRACT'),
    [`${p}RETRACT_Z`]: angleTrim('Z', 'RETRACT'),
    [`${p}NEUTRAL_X`]: angleTrim('X', 'NEUTRAL'),
    [`${p}NEUTRAL_Y`]: angleTrim('Y', 'NEUTRAL'),
    [`${p}NEUTRAL_Z`]: angleTrim('Z', 'NEUTRAL'),
    [`${p}LEAD_RLL`]: {
      id: `${p}LEAD_RLL`,
      label: `Roll Lead Time${suffix}`,
      description: 'Roll stabilization lead time (s) to compensate for gimbal response lag.',
      category: 'gimbal',
      minimum: 0,
      maximum: 0.2,
      step: 0.01
    },
    [`${p}LEAD_PTCH`]: {
      id: `${p}LEAD_PTCH`,
      label: `Pitch Lead Time${suffix}`,
      description: 'Pitch stabilization lead time (s) to compensate for gimbal response lag.',
      category: 'gimbal',
      minimum: 0,
      maximum: 0.2,
      step: 0.01
    },
    [`${p}OPTIONS`]: {
      id: `${p}OPTIONS`,
      label: `Gimbal Options${suffix}`,
      description: 'Per-mount option flags.',
      category: 'gimbal',
      bitmask: true,
      options: MOUNT_OPTIONS_BITS
    }
  }
}
