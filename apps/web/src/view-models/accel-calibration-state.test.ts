import { describe, expect, it } from 'vitest'
import type { ConfiguratorSnapshot } from '@arduconfig/ardupilot-core'

import { accelerometerCalibrationVerdict } from './accel-calibration-state'

function snapshotWith(values: Record<string, number>): ConfiguratorSnapshot {
  return {
    parameters: Object.entries(values).map(([id, value], index) => ({
      id,
      value,
      index,
      count: Object.keys(values).length
    }))
  } as unknown as ConfiguratorSnapshot
}

/** One bound, fully calibrated accelerometer. */
const calibratedInstance1 = {
  INS_ACC_ID: 2359298,
  INS_ACCOFFS_X: 0.41,
  INS_ACCOFFS_Y: -0.13,
  INS_ACCOFFS_Z: 0.88,
  INS_ACCSCAL_X: 1.001,
  INS_ACCSCAL_Y: 0.998,
  INS_ACCSCAL_Z: 1.004,
  INS_ACC2_ID: 0,
  INS_ACC3_ID: 0
}

describe('accelerometerCalibrationVerdict', () => {
  it('reads a calibrated vehicle as calibrated, whoever calibrated it', () => {
    // This is the case the guided setup used to miss: the offsets are on the
    // vehicle, so ArduPilot will arm, but this app had no record of running the
    // calibration itself — a Mission Planner calibration, or a snapshot restore
    // that carried the values.
    expect(accelerometerCalibrationVerdict(snapshotWith(calibratedInstance1))).toBe('calibrated')
  })

  it('reads all-zero offsets as not calibrated', () => {
    // AP_InertialSensor.cpp: "exactly 0.0 offset is extremely unlikely", so an
    // all-zero vector means nothing was ever saved.
    const verdict = accelerometerCalibrationVerdict(
      snapshotWith({ ...calibratedInstance1, INS_ACCOFFS_X: 0, INS_ACCOFFS_Y: 0, INS_ACCOFFS_Z: 0 })
    )
    expect(verdict).toBe('not-calibrated')
  })

  it('reads all-zero scales as not calibrated', () => {
    const verdict = accelerometerCalibrationVerdict(
      snapshotWith({ ...calibratedInstance1, INS_ACCSCAL_X: 0, INS_ACCSCAL_Y: 0, INS_ACCSCAL_Z: 0 })
    )
    expect(verdict).toBe('not-calibrated')
  })

  it('does not treat a single zero axis as uncalibrated', () => {
    // A real calibration can legitimately land one axis on zero. ArduPilot
    // rejects only the whole vector being zero, and so must this — otherwise a
    // calibrated vehicle gets told to redo the work.
    const verdict = accelerometerCalibrationVerdict(
      snapshotWith({ ...calibratedInstance1, INS_ACCOFFS_Y: 0 })
    )
    expect(verdict).toBe('calibrated')
  })

  it('checks every accelerometer the board actually has', () => {
    // A second bound IMU with no calibration fails ArduPilot's check, so it
    // must fail here too — the first one being fine is not enough.
    const verdict = accelerometerCalibrationVerdict(
      snapshotWith({
        ...calibratedInstance1,
        INS_ACC2_ID: 2360322,
        INS_ACC2OFFS_X: 0,
        INS_ACC2OFFS_Y: 0,
        INS_ACC2OFFS_Z: 0,
        INS_ACC2SCAL_X: 1,
        INS_ACC2SCAL_Y: 1,
        INS_ACC2SCAL_Z: 1
      })
    )
    expect(verdict).toBe('not-calibrated')
  })

  it('ignores instances the board does not have', () => {
    // A zero id means no such sensor is bound; ArduPilot skips those rather
    // than demanding calibration for hardware that is not there.
    expect(accelerometerCalibrationVerdict(snapshotWith(calibratedInstance1))).toBe('calibrated')
  })

  it('says unknown rather than not-calibrated when the parameters are missing', () => {
    // Before a sync completes there is nothing to read. "We cannot tell" must
    // never render as "you must redo the calibration".
    expect(accelerometerCalibrationVerdict(snapshotWith({}))).toBe('unknown')
    expect(
      accelerometerCalibrationVerdict(snapshotWith({ INS_ACC_ID: 2359298, INS_ACC2_ID: 0, INS_ACC3_ID: 0 }))
    ).toBe('unknown')
  })

  it('says unknown when no accelerometer is bound at all', () => {
    // Distinct from uncalibrated: there is nothing to calibrate.
    expect(
      accelerometerCalibrationVerdict(snapshotWith({ INS_ACC_ID: 0, INS_ACC2_ID: 0, INS_ACC3_ID: 0 }))
    ).toBe('unknown')
  })
})
