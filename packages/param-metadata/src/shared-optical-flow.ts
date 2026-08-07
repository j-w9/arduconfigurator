// Shared optical-flow (FLOW_*) parameter family. AP_OpticalFlow is a single
// (non-instanced) driver object shared verbatim by Copter/Plane/Rover/Sub, so —
// like shared-rangefinder.ts — the definitions are built once here and spread
// into each vehicle bundle.
//
// EVERY value, range, unit and default below was read out of the firmware
// source, not from memory (the standing rule in this repo after a wrong
// MNT1_TYPE map shipped). Primary source:
//
//   libraries/AP_OpticalFlow/AP_OpticalFlow.cpp — `AP_OpticalFlow::var_info[]`
//   read at both `Copter-4.6.3` (the operator's shipping firmware) and
//   `origin/ArduPilot-4.7` (the 4.7.0-beta line). Lines 24–105 on 4.7.
//
// The two versions differ in exactly two places, both handled explicitly:
//   * FLOW_TYPE gains `10:SITL` in 4.7. The base map below stays at the 4.6
//     set (0..8) and the extra option is applied only on a detected >= 4.7
//     build via ARDUCOPTER_4_7_PARAMETER_OVERRIDES.
//   * FLOW_OPTIONS is NEW in 4.7 (absent from 4.6.3 entirely). It is curated
//     unconditionally here because the peripherals card only renders params
//     the FC actually reports — a 4.6 board never streams FLOW_OPTIONS, so the
//     field simply does not appear. Same technique shared-rangefinder.ts uses
//     for the pre-4.7 `_CM` distance params.

import type { FirmwareMetadataBundle, ParameterValueOption } from './types.js'

// Verbatim from the FLOW_TYPE @Values line, so the labels read identically to
// the ArduPilot wiki and Mission Planner:
//   @Values: 0:None, 1:PX4Flow, 2:Pixart, 3:Bebop, 4:CXOF, 5:MAVLink,
//            6:DroneCAN, 7:MSP, 8:UPFLOW[, 10:SITL]
// (9 is genuinely unassigned in the enum — AP_OpticalFlow.h `Type` jumps from
// UPFLOW = 8 to SITL = 10 — so the gap here is correct, not an omission.)
//
// Value 6 is DroneCAN, i.e. the HereFlow and every other CAN-attached flow
// sensor. Calling it out because a stale tooltip in this app once claimed 10
// was HereFlow, which could never have worked.
export const OPTICAL_FLOW_TYPE_OPTIONS: ParameterValueOption[] = [
  { value: 0, label: 'None' },
  { value: 1, label: 'PX4Flow' },
  { value: 2, label: 'Pixart' },
  { value: 3, label: 'Bebop' },
  { value: 4, label: 'CXOF' },
  { value: 5, label: 'MAVLink' },
  { value: 6, label: 'DroneCAN' },
  { value: 7, label: 'MSP' },
  { value: 8, label: 'UPFLOW' }
]

/** 4.7 adds `10:SITL` to the same @Values line. Consumed by the 4.7 overrides. */
export const OPTICAL_FLOW_TYPE_OPTIONS_4_7: ParameterValueOption[] = [
  ...OPTICAL_FLOW_TYPE_OPTIONS,
  { value: 10, label: 'SITL' }
]

// FLOW_OPTIONS @Bitmask: 0:Roll/Pitch stabilised. Bit INDICES, not values —
// `bitmask: true` makes the generic editor render a per-bit checkbox grid.
const OPTICAL_FLOW_OPTION_BITS: ParameterValueOption[] = [
  { value: 0, label: 'Sensor is roll/pitch stabilised (gimbal-mounted)' }
]

/**
 * Builds the FLOW_* parameter family (category `optical-flow`).
 *
 * Deliberately NOT gated on FLOW_TYPE being non-zero: the section is a
 * configuration surface, and an operator fitting a sensor needs to reach the
 * Type dropdown before anything is enabled. This matches the rangefinder
 * section, which is likewise always present in the catalog and simply renders
 * whichever of its params the connected FC reports. In practice FLOW_TYPE is
 * ArduPilot's AP_PARAM_FLAG_ENABLE for this group, so a board with the sensor
 * disabled reports only FLOW_TYPE and the card shows exactly one field — the
 * one that is useful — until the type is set and the board rebooted.
 *
 * No `enableGate: true` on FLOW_TYPE even though it carries
 * AP_PARAM_FLAG_ENABLE: the siblings are hidden from the param tree while the
 * gate is 0, so they can never be co-staged in the same batch as the gate, and
 * the write-ordering the flag would buy has nothing to order. shared-rangefinder
 * leaves RNGFND1_TYPE unmarked for the same reason.
 */
export function buildOpticalFlowParameterDefinitions(): FirmwareMetadataBundle['parameters'] {
  // FLOW_POS_X/Y/Z share one @Param block per axis with identical
  // @Units/@Range/@Increment (m, -5..5, 0.01) — generated rather than repeated.
  const pos = (axis: 'X' | 'Y' | 'Z') => {
    const direction = axis === 'X' ? 'forward' : axis === 'Y' ? 'right' : 'down'
    return {
      id: `FLOW_POS_${axis}`,
      label: `Position ${axis}`,
      description: `${axis} position of the flow sensor's focal point in body frame (m, ${direction}-positive from the origin).`,
      category: 'optical-flow',
      unit: 'm',
      minimum: -5,
      maximum: 5,
      step: 0.01
    }
  }

  return {
    FLOW_TYPE: {
      id: 'FLOW_TYPE',
      label: 'Optical Flow Type',
      description: 'Driver for the optical flow sensor. Pick the backend that matches your sensor.',
      category: 'optical-flow',
      // @RebootRequired: True on the FLOW_TYPE @Param block.
      rebootRequired: true,
      notes: [
        // The two traps that make a correctly-wired sensor look dead, both hit
        // by real operators. Kept as notes rather than extra editable fields:
        // EK3_SRC* belongs to the EKF, and surfacing it here would invite
        // edits with a far wider blast radius than a flow sensor.
        'Reboot after changing the type — the driver is only created at boot.',
        'DroneCAN (6) sensors — HereFlow and friends — also need the CAN bus itself enabled (CAN_P1_DRIVER=1, CAN_D1_PROTOCOL=1). The CAN tab offers a one-click "Enable CAN bus & reboot" when it spots that combination.',
        'Flow is only used for navigation once the EKF sources from it: EK3_SRC1_VELXY = 5 (OptFlow). Source: libraries/AP_NavEKF/AP_NavEKF_Source.h, SourceXY::OPTFLOW = 5.',
        'Flow needs a height reference. A downward rangefinder (RNGFND1_ORIENT = 25) is what supplies it below a few metres.'
      ],
      options: OPTICAL_FLOW_TYPE_OPTIONS
    },
    FLOW_FXSCALER: {
      id: 'FLOW_FXSCALER',
      label: 'X Scale Correction',
      description:
        'Parts-per-thousand scale correction for the sensor X-axis optical rate — corrects effective focal-length variation. Each +1 raises the X scale factor by 0.1%.',
      category: 'optical-flow',
      // @Range: -800 +800, @Increment: 1
      minimum: -800,
      maximum: 800,
      step: 1
    },
    FLOW_FYSCALER: {
      id: 'FLOW_FYSCALER',
      label: 'Y Scale Correction',
      description:
        'Parts-per-thousand scale correction for the sensor Y-axis optical rate — corrects effective focal-length variation. Each +1 raises the Y scale factor by 0.1%.',
      category: 'optical-flow',
      minimum: -800,
      maximum: 800,
      step: 1
    },
    FLOW_ORIENT_YAW: {
      id: 'FLOW_ORIENT_YAW',
      label: 'Yaw Alignment',
      description:
        'How far the sensor is yawed relative to the vehicle, in centi-degrees. A sensor whose X axis points to the right of the vehicle X axis has a positive angle.',
      category: 'optical-flow',
      // @Units: cdeg, @Range: -17999 +18000, @Increment: 10
      unit: 'cdeg',
      minimum: -17999,
      maximum: 18000,
      step: 10
    },
    FLOW_POS_X: pos('X'),
    FLOW_POS_Y: pos('Y'),
    FLOW_POS_Z: pos('Z'),
    FLOW_ADDR: {
      id: 'FLOW_ADDR',
      label: 'Bus Address',
      description:
        'Selects between multiple possible I2C addresses for sensor types that offer them (PX4Flow accepts 0–7). Ignored by serial/CAN backends.',
      category: 'optical-flow',
      // @Range: 0 127
      minimum: 0,
      maximum: 127,
      step: 1
    },
    // 4.7+ only (absent from the 4.6.3 var_info entirely) — renders only when
    // the connected FC actually reports it.
    FLOW_OPTIONS: {
      id: 'FLOW_OPTIONS',
      label: 'Flow Options',
      description: 'Optical flow options. Set bit 0 when the sensor is roll/pitch stabilised, e.g. mounted on a gimbal.',
      category: 'optical-flow',
      bitmask: true,
      options: OPTICAL_FLOW_OPTION_BITS
    },
    // AP_GROUPINFO_FRAME(..., AP_PARAM_FRAME_ROVER): ArduPilot only exposes
    // this on Rover frames, so a Copter/Plane/Sub never reports it and the
    // field never renders there. Curated in the shared builder rather than
    // branched per-vehicle for the same reason the rangefinder builder curates
    // both the metre and centimetre distance params in one place.
    FLOW_HGT_OVR: {
      id: 'FLOW_HGT_OVR',
      label: 'Height Override',
      description: 'Rover only: fixed height of the sensor above the ground (m), used instead of a rangefinder.',
      category: 'optical-flow',
      // @Units: m, @Range: 0 2, @Increment: 0.01
      unit: 'm',
      minimum: 0,
      maximum: 2,
      step: 0.01
    }
  }
}
