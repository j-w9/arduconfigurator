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

// Per-IMU THERMAL-CAL state — labelled to make clear it's the calibration that's
// off, not the IMU itself ("disabled" read as "IMU disabled"). enable: 0 = no
// thermal cal, 1 = a learned cal is loaded, 2 = currently learning.
function enableState(value: number | undefined): { label: string; tone: 'neutral' | 'success' | 'warning' } {
  if (value === undefined) return { label: 'n/a', tone: 'neutral' }
  if (value >= 2) return { label: 'learning', tone: 'warning' }
  if (value >= 1) return { label: 'on', tone: 'success' }
  return { label: 'off', tone: 'neutral' }
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
      <p>Learns per-IMU gyro/accel offsets across temperature — online, as the board warms from a cold boot.</p>

      <div className="config-pills">
        {imus.map((imu) => {
          const state = enableState(imu.enable)
          return (
            <span key={imu.i} data-tone={state.tone}>
              IMU{imu.i} TCAL: {state.label}
              {imu.tmin !== undefined && imu.tmax !== undefined ? ` (${imu.tmin.toFixed(0)}→${imu.tmax.toFixed(0)}°C)` : ''}
            </span>
          )
        })}
        {imuTempC !== undefined ? (
          <span data-testid="tcal-imu-temp" data-tone={anyLearning ? 'warning' : 'neutral'}>
            IMU temp: {imuTempC.toFixed(1)}&thinsp;°C
            {anyLearning && warmPct !== undefined && targetTmax !== undefined
              ? ` · warming ${warmPct.toFixed(0)}% → ${targetTmax.toFixed(0)}°C`
              : ''}
          </span>
        ) : null}
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
      <small>
        {!connected
          ? 'Connect to a vehicle first.'
          : !canApplyDraftParameters
            ? 'Finish parameter sync and disarm first.'
            : 'Bench only, props off — the board just sits still and warms up.'}
      </small>

      <details className="calibration-card__howto">
        <summary>How thermal calibration works (cold boot → warm)</summary>
        <ol>
          <li><strong>Start cold.</strong> Power off and let the board cool to ambient — the wider the cold-to-warm swing, the better the fit.</li>
          <li>Click <strong>Prepare thermal calibration</strong>, then <strong>Apply</strong> in the draft bar (sets <code>INS_TCALn_ENABLE = 2</code>, learn).</li>
          <li>Reboot <strong>cold</strong>, props off, and leave it powered and still — it self-heats through the range.</li>
          <li>At the top temperature the fit saves automatically (state flips back to <em>on</em>). Reboot once more to use it.</li>
        </ol>
      </details>
    </article>
  )
}
