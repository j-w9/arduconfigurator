// Does the VEHICLE consider its accelerometers calibrated?
//
// The guided setup used to answer this with "did WE run the calibration, or did
// the operator tick a box saying they had" — which is a record of this app's
// own history, not of the aircraft. An operator who calibrated in Mission
// Planner, or restored a snapshot carrying the offsets, had a fully calibrated
// vehicle and a step that still demanded the work be redone.
//
// This reads the same thing ArduPilot's own pre-arm check reads, so the answer
// agrees with the firmware that would refuse to arm. From
// AP_InertialSensor::accel_calibrated_ok_all(), which fails "3D Accel
// calibration needed" unless, for every detected accelerometer:
//
//   - the saved sensor id is set (a zero id means nothing was ever saved)
//   - the offset vector is not exactly zero ("extremely unlikely" otherwise)
//   - the scale vector is not exactly zero
//
// Instances 1-3 use the flat INS_ACC[n]OFFS_*/SCAL_*/_ID names; instances 4-5
// live under INS_4_/INS_5_ subgroups and are not checked here, because a board
// with five IMUs is not the case this step exists to unblock and guessing at
// the mapping would be worse than saying nothing.

import type { ConfiguratorSnapshot } from '@arduconfig/ardupilot-core'

/** The ids backing one accelerometer instance, in ArduPilot's own naming. */
interface AccelInstanceIds {
  id: string
  offsets: readonly [string, string, string]
  scales: readonly [string, string, string]
}

function instanceIds(instance: 1 | 2 | 3): AccelInstanceIds {
  // Instance 1 has no digit: INS_ACCOFFS_X, INS_ACC_ID. 2 and 3 carry theirs.
  const n = instance === 1 ? '' : String(instance)
  return {
    id: `INS_ACC${n}_ID`,
    offsets: [`INS_ACC${n}OFFS_X`, `INS_ACC${n}OFFS_Y`, `INS_ACC${n}OFFS_Z`],
    scales: [`INS_ACC${n}SCAL_X`, `INS_ACC${n}SCAL_Y`, `INS_ACC${n}SCAL_Z`]
  }
}

export type AccelCalibrationVerdict =
  /** Every detected accelerometer has a saved id, offsets and scales. */
  | 'calibrated'
  /** At least one detected accelerometer is missing its calibration. */
  | 'not-calibrated'
  /**
   * Not enough parameters in hand to say — before a sync completes, or on
   * firmware that does not report these. Deliberately distinct from
   * 'not-calibrated': "we cannot tell" must never read as "you must redo it".
   */
  | 'unknown'

/**
 * Read a numeric parameter, returning undefined when it has not been reported.
 *
 * readRoundedParameter rounds, which would turn a real offset of 0.4 m/s² into
 * 0 and read as uncalibrated, so the raw value is used here.
 */
function rawValue(snapshot: ConfiguratorSnapshot, id: string): number | undefined {
  const parameter = snapshot.parameters.find((entry) => entry.id === id)
  return typeof parameter?.value === 'number' && Number.isFinite(parameter.value) ? parameter.value : undefined
}

export function accelerometerCalibrationVerdict(snapshot: ConfiguratorSnapshot): AccelCalibrationVerdict {
  let sawAnyInstance = false

  for (const instance of [1, 2, 3] as const) {
    const ids = instanceIds(instance)
    const sensorId = rawValue(snapshot, ids.id)

    // Not reported at all: the parameter set is incomplete, so no verdict.
    if (sensorId === undefined) {
      return 'unknown'
    }
    // Reported as 0 means no such accelerometer is bound on this board —
    // ArduPilot skips those, and so do we.
    if (sensorId === 0) {
      continue
    }

    const offsets = ids.offsets.map((id) => rawValue(snapshot, id))
    const scales = ids.scales.map((id) => rawValue(snapshot, id))
    if (offsets.some((value) => value === undefined) || scales.some((value) => value === undefined)) {
      return 'unknown'
    }

    sawAnyInstance = true

    // "exactly 0.0 offset is extremely unlikely" — AP_InertialSensor.cpp. An
    // all-zero vector means the calibration was never saved for this sensor.
    if (offsets.every((value) => value === 0) || scales.every((value) => value === 0)) {
      return 'not-calibrated'
    }
  }

  // Every id read as 0: the vehicle reports no bound accelerometer at all,
  // which is not the same as one that needs calibrating.
  return sawAnyInstance ? 'calibrated' : 'unknown'
}
