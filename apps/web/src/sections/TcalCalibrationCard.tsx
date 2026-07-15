// Thermal calibration (TCAL) card for the Calibration tab — Expert-gated.
//
// ArduPilot per-IMU thermal calibration (INS_TCALn_*) learns gyro/accel offsets
// across temperature so the estimator stays stable from a cold boot to warm.
// It learns ONLINE: set each IMU to "learn", reboot cold, and let the board heat
// through its range — the firmware computes and saves the fit at the top
// temperature on its own. This card reads the current TCAL state from the synced
// parameters and stages the "learn" enable (INS_TCALn_ENABLE=2) as a draft; the
// operator applies it through the normal verified-write path, then reboots cold.
//
// Live IMU temperature (from SCALED_IMU, streamed at 1 Hz) is shown for warm-up
// progress; the firmware itself computes and saves the fit at the top temperature.

import type { ReactElement } from 'react'

import type { ConfiguratorSnapshot } from '@arduconfig/ardupilot-core'
import { StatusBadge, buttonStyle } from '@arduconfig/ui-kit'

import { readParameterValue } from '../selectors/parameter-read'

export interface TcalCalibrationCardProps {
  snapshot: ConfiguratorSnapshot
  canApplyDraftParameters: boolean
  busyAction: string | undefined
  setDraft: (paramId: string, value: string) => void
}

const IMU_INSTANCES = [1, 2, 3]

function enableState(value: number | undefined): { label: string; tone: 'neutral' | 'success' | 'warning' } {
  if (value === undefined) return { label: 'n/a', tone: 'neutral' }
  if (value >= 2) return { label: 'learning', tone: 'warning' }
  if (value >= 1) return { label: 'enabled', tone: 'success' }
  return { label: 'disabled', tone: 'neutral' }
}

export function TcalCalibrationCard({
  snapshot,
  canApplyDraftParameters,
  busyAction,
  setDraft
}: TcalCalibrationCardProps): ReactElement {
  const imus = IMU_INSTANCES.map((i) => ({
    i,
    enable: readParameterValue(snapshot, `INS_TCAL${i}_ENABLE`),
    tmin: readParameterValue(snapshot, `INS_TCAL${i}_TMIN`),
    tmax: readParameterValue(snapshot, `INS_TCAL${i}_TMAX`)
  })).filter((imu) => imu.enable !== undefined)

  if (imus.length === 0) {
    return (
      <article className="calibration-card" data-testid="calibration-card-tcal">
        <div className="calibration-card__header">
          <strong>Thermal calibration (TCAL)</strong>
          <StatusBadge tone="neutral">n/a</StatusBadge>
        </div>
        <p>
          This firmware doesn't expose thermal-calibration parameters (<code>INS_TCALn_*</code>). Thermal cal is
          available on builds with per-IMU temperature compensation compiled in.
        </p>
      </article>
    )
  }

  const anyLearning = imus.some((imu) => (imu.enable ?? 0) >= 2)
  const connected = snapshot.connection.kind === 'connected'
  const canStart = connected && canApplyDraftParameters && busyAction === undefined && !anyLearning

  // Live IMU temperature (from SCALED_IMU) + warm-up progress toward the target.
  const imuTempC = snapshot.liveVerification.imuTemperatureC
  const tmaxValues = imus.map((imu) => imu.tmax ?? 0).filter((t) => t > 0)
  const tminValues = imus.map((imu) => imu.tmin).filter((t): t is number => typeof t === 'number')
  const targetTmax = tmaxValues.length > 0 ? Math.max(...tmaxValues) : undefined
  const baseTmin = tminValues.length > 0 ? Math.min(...tminValues) : undefined
  const warmPct =
    imuTempC !== undefined && targetTmax !== undefined && baseTmin !== undefined && targetTmax > baseTmin
      ? Math.min(100, Math.max(0, ((imuTempC - baseTmin) / (targetTmax - baseTmin)) * 100))
      : undefined

  const startLearning = (): void => {
    for (const imu of imus) {
      setDraft(`INS_TCAL${imu.i}_ENABLE`, '2')
    }
  }

  return (
    <article className="calibration-card" data-testid="calibration-card-tcal">
      <div className="calibration-card__header">
        <strong>Thermal calibration (TCAL)</strong>
        <StatusBadge tone={anyLearning ? 'warning' : 'neutral'}>{anyLearning ? 'learning' : 'idle'}</StatusBadge>
      </div>
      <p>
        Learns per-IMU gyro/accel offsets across temperature so the estimator stays stable from a cold boot to warm.
        It learns online while the board heats through its temperature range.
      </p>

      <div className="config-pills">
        {imus.map((imu) => {
          const state = enableState(imu.enable)
          return (
            <span key={imu.i} data-tone={state.tone}>
              IMU{imu.i}: {state.label}
              {imu.tmin !== undefined && imu.tmax !== undefined ? ` (${imu.tmin.toFixed(0)}→${imu.tmax.toFixed(0)}°C)` : ''}
            </span>
          )
        })}
      </div>

      {imuTempC !== undefined ? (
        <div className="config-pills" data-testid="tcal-imu-temp">
          <span>IMU temp: {imuTempC.toFixed(1)}&thinsp;°C</span>
          {anyLearning && warmPct !== undefined && targetTmax !== undefined ? (
            <span>warming: {warmPct.toFixed(0)}% → {targetTmax.toFixed(0)}&thinsp;°C</span>
          ) : null}
        </div>
      ) : null}

      <ol className="calibration-card__steps">
        <li>
          <strong>Start cold.</strong> Power the board off and let it cool to ambient — a genuinely cold board is
          essential; the wider the temperature swing, the better the fit.
        </li>
        <li>
          Click <strong>Prepare thermal calibration</strong> below, then <strong>Apply</strong> in the draft bar. This
          sets each IMU to <em>learn</em> (<code>INS_TCALn_ENABLE = 2</code>).
        </li>
        <li>Reboot the board <strong>cold</strong>, props off, and leave it powered and still — it self-heats through the range.</li>
        <li>
          At the top temperature the fit is computed and saved automatically (enable flips back to <em>enabled</em>).
          Reboot once more to use it.
        </li>
      </ol>

      <div className="parameter-follow-up parameter-follow-up--warning">
        <StatusBadge tone="warning">props off</StatusBadge>
        <p>
          Do this on the bench with props removed — the board just needs to sit still and warm up, not fly. The live
          IMU temperature is shown above; the firmware completes and saves the fit automatically once it reaches the
          target temperature.
        </p>
      </div>

      <button
        type="button"
        style={buttonStyle('primary')}
        disabled={!canStart}
        data-testid="tcal-start"
        onClick={startLearning}
      >
        {anyLearning ? 'Learning already enabled' : 'Prepare thermal calibration'}
      </button>
      {!connected ? (
        <small>Connect to a vehicle first.</small>
      ) : !canApplyDraftParameters ? (
        <small>Finish parameter sync and disarm first.</small>
      ) : null}
    </article>
  )
}
