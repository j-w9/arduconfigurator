// Thermal calibration (TCAL): what to write, in what order, and what the
// operator should be doing. Everything here is from
// libraries/AP_InertialSensor/AP_InertialSensor_tempcal.cpp and
// libraries/AP_TempCalibration/AP_TempCalibration.cpp, not from the names.
//
// The order is the point. INS_TCALn_ENABLE carries AP_PARAM_FLAG_ENABLE, so a
// board with thermal cal off does not REPORT TMIN/TMAX at all — a draft for
// them had nothing to attach to and was dropped, leaving only ENABLE = 2. And
// learning starts the moment ENABLE becomes 2, capturing TMAX as its target
// there and then. So the target is written first (the firmware accepts a
// hidden param by name) and the enable last.

import type { StatusTextEntry } from '@arduconfig/ardupilot-core'

export interface TcalWrite {
  paramId: string
  paramValue: number
}

/** The learn only finishes once the IMU has risen this far above where it started. */
export const TCAL_MIN_RISE_C = 10
/** ...and then ends at the target, or this long after the temperature stops rising. */
export const TCAL_STALL_MINUTES = 10
/** @Range on TMIN / TMAX. */
export const TCAL_TEMP_LIMIT_LOW_C = -70
export const TCAL_TEMP_LIMIT_HIGH_C = 80
/** TMAX's AP_GROUPINFO default — out of reach for most airframes. */
export const TCAL_TMAX_FIRMWARE_DEFAULT_C = 70
/** A target to offer when the board reports none (thermal cal off hides TMAX). */
export const TCAL_SUGGESTED_TARGET_C = 45
/** AP_TempCalibration: the baro learn collects nothing below this. */
export const BARO_TCAL_MIN_TEMP_C = 25

/** Target first, then the enable, per IMU; the baro enable last. */
export function tcalStartWrites(imuIds: readonly number[], targetC: number, includeBaro: boolean): TcalWrite[] {
  return [
    ...imuIds.map((i) => ({ paramId: `INS_TCAL${i}_TMAX`, paramValue: targetC })),
    ...imuIds.map((i) => ({ paramId: `INS_TCAL${i}_ENABLE`, paramValue: 2 })),
    ...(includeBaro ? [{ paramId: 'TCAL_ENABLED', paramValue: 2 }] : [])
  ]
}

/**
 * Stop the IMU learn, or turn thermal cal off.
 *
 * `keep` (ENABLE = 1) stops learning and uses what is saved: the learn saves a
 * partial fit every 15 s once the board has risen 10 °C, so a stop after that
 * keeps a usable calibration; before it, whatever was there before (nothing, on
 * a fresh board) stays. `off` (ENABLE = 0) stops it and uses no thermal
 * correction at all.
 */
export function tcalStopWrites(imuIds: readonly number[], mode: 'keep' | 'off'): TcalWrite[] {
  return imuIds.map((i) => ({ paramId: `INS_TCAL${i}_ENABLE`, paramValue: mode === 'keep' ? 1 : 0 }))
}

export interface TcalTargetCheck {
  /** Blocks Start. */
  problem?: string
  /** Worth knowing, does not block. */
  note?: string
}

export function tcalTargetCheck(targetC: number, boardTempC: number | undefined): TcalTargetCheck {
  if (!Number.isFinite(targetC) || targetC < TCAL_TEMP_LIMIT_LOW_C || targetC > TCAL_TEMP_LIMIT_HIGH_C) {
    return { problem: `Set a target between ${TCAL_TEMP_LIMIT_LOW_C} and ${TCAL_TEMP_LIMIT_HIGH_C} °C.` }
  }
  if (boardTempC !== undefined && targetC - boardTempC < TCAL_MIN_RISE_C) {
    return {
      problem: `The board is at ${boardTempC.toFixed(0)} °C. The learn needs at least ${TCAL_MIN_RISE_C} °C of rise, so let it cool below ${(targetC - TCAL_MIN_RISE_C).toFixed(0)} °C or raise the target.`
    }
  }
  if (targetC >= TCAL_TMAX_FIRMWARE_DEFAULT_C) {
    return {
      note: `Most boards never reach ${targetC.toFixed(0)} °C on the bench. That is fine: once it has warmed ${TCAL_MIN_RISE_C} °C, the learn also ends ${TCAL_STALL_MINUTES} minutes after the temperature stops rising.`
    }
  }
  return {}
}

/** The newest per-IMU TCAL message ("TCAL[1]: started calibration …"), if any. The list is newest-first. */
export function latestTcalMessage(statusTexts: readonly StatusTextEntry[]): StatusTextEntry | undefined {
  return statusTexts.find((entry) => /^TCAL\[\d+\]:/.test(entry.text))
}
