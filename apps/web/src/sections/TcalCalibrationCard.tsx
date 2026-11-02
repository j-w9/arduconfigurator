// Thermal calibration (TCAL) card for the Calibration tab.
//
// ArduPilot per-IMU thermal calibration (INS_TCALn_*) learns gyro/accel offsets
// across temperature so the estimator stays stable from a cold boot to warm.
// What the operator does, from AP_InertialSensor_tempcal.cpp:
//   - the learn starts the moment INS_TCALn_ENABLE becomes 2, from whatever
//     temperature the board is at — so start COLD;
//   - it ends at TMAX once the board has risen at least 10 °C, or 10 minutes
//     after the temperature stops rising (also only after a 10 °C rise);
//   - it saves itself (ENABLE flips to 1, TMIN/TMAX become the real range), or
//     on a failed fit turns itself off.
// So the card is three steps — cool it, pick a target, press Start — and then
// a wait with nothing to press. The writes go straight through the verified
// write path in order (target, then enable: see view-models/tcal-plan.ts for
// why a draft could not do it).
//
// The BAROMETER has a separate temperature calibration with its own parameter
// family — AP_TempCalibration (TCAL_*, a Copter g2 subgroup). Same card
// because it is the same bench session: power it cold, leave it still, let it
// warm. From AP_TempCalibration.cpp:
//   TCAL_ENABLED  0 = off, 1 = use learned values, 2 = learn AND use
//   TCAL_TEMP_MIN / TEMP_MAX / BARO_EXP are @ReadOnly — the learn writes them
//   learning runs only while DISARMED and still, above 25 °C, and needs a
//     rise of at least 7 °C before it fits and saves
//   the correction is applied to the FIRST baro only

import { useEffect, useState, type ReactElement } from 'react'

import type { ConfiguratorSnapshot } from '@arduconfig/ardupilot-core'
import { StatusBadge, buttonStyle } from '@arduconfig/ui-kit'

import { readParameterValue } from '../selectors/parameter-read'
import {
  BARO_TCAL_MIN_TEMP_C,
  TCAL_MIN_RISE_C,
  TCAL_STALL_MINUTES,
  TCAL_SUGGESTED_TARGET_C,
  TCAL_TEMP_LIMIT_HIGH_C,
  TCAL_TEMP_LIMIT_LOW_C,
  latestTcalMessage,
  tcalOutcome,
  tcalStopWrites,
  tcalStartWrites,
  tcalTargetCheck,
  type TcalWrite
} from '../view-models/tcal-plan'

export interface TcalCalibrationCardProps {
  snapshot: ConfiguratorSnapshot
  /** Synced and disarmed: writes may go. */
  canApplyDraftParameters: boolean
  busyAction: string | undefined
  /** Verified writes, in this order. */
  onWrite: (writes: TcalWrite[], description: string) => void
}

const IMU_INSTANCES = [1, 2, 3]
const BARO_TCAL_MIN_RANGE_C = 7

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
  onWrite
}: TcalCalibrationCardProps): ReactElement {
  const imus = IMU_INSTANCES.map((i) => ({
    i,
    enable: readParameterValue(snapshot, `INS_TCAL${i}_ENABLE`),
    // Absent while thermal cal is off: ENABLE hides the rest of its group.
    tmin: readParameterValue(snapshot, `INS_TCAL${i}_TMIN`),
    tmax: readParameterValue(snapshot, `INS_TCAL${i}_TMAX`)
  })).filter((imu) => imu.enable !== undefined)

  // Baro temperature calibration (AP_TempCalibration). Gated on the firmware
  // actually reporting it: it is a Copter g2 subgroup and a compile-time
  // feature, so plenty of builds have no TCAL_ENABLED at all.
  const baroEnabled = readParameterValue(snapshot, 'TCAL_ENABLED')
  const baroExponent = readParameterValue(snapshot, 'TCAL_BARO_EXP')
  const baroTempMin = readParameterValue(snapshot, 'TCAL_TEMP_MIN')
  const baroTempMax = readParameterValue(snapshot, 'TCAL_TEMP_MAX')
  const hasBaroTcal = baroEnabled !== undefined
  const baroLearning = (baroEnabled ?? 0) >= 2
  const baroState = enableState(baroEnabled)

  const connected = snapshot.connection.kind === 'connected'
  const canWrite = connected && canApplyDraftParameters && busyAction === undefined
  const writeBlockedReason = !connected
    ? 'Connect to a vehicle first.'
    : !canApplyDraftParameters
      ? 'Finish parameter sync and disarm first.'
      : busyAction !== undefined
        ? 'Waiting for the current action to finish.'
        : undefined

  const imuTempC = snapshot.liveVerification.imuTemperatureC
  const anyLearning = imus.some((imu) => (imu.enable ?? 0) >= 2)
  const learningImuIds = imus.filter((imu) => (imu.enable ?? 0) >= 2).map((imu) => imu.i)
  const reportedTargets = imus.map((imu) => imu.tmax).filter((t): t is number => typeof t === 'number')
  const learningTarget = reportedTargets.length > 0 ? Math.max(...reportedTargets) : undefined
  const tcalMessage = latestTcalMessage(snapshot.statusTexts)
  const outcome = tcalOutcome(snapshot.statusTexts, anyLearning)

  // Folded by default (operator request): the full card is the tallest on the
  // page, and on a wide screen its height pushed the rest of the Sensors row
  // out of view. EVERY hook sits above the early return below — a board whose
  // INS_TCALn_* arrived mid-session once crashed the page (React #310).
  const [expanded, setExpanded] = useState(false)
  // The target, seeded from what the vehicle reports (only while thermal cal
  // is on — it is hidden otherwise), else a temperature most boards reach.
  const [targetText, setTargetText] = useState('')
  const [touched, setTouched] = useState(false)
  const [includeBaro, setIncludeBaro] = useState(true)
  useEffect(() => {
    if (touched) return
    setTargetText(String(Math.round(learningTarget ?? TCAL_SUGGESTED_TARGET_C)))
  }, [learningTarget, touched])

  const expandToggle = (
    <button
      type="button"
      className="calibration-card__expand"
      data-testid="tcal-expand"
      aria-expanded={expanded}
      onClick={() => setExpanded((open) => !open)}
    >
      {expanded ? 'Hide thermal calibration ▾' : 'Set up thermal calibration ▸'}
    </button>
  )

  const baroSection = hasBaroTcal ? (
    <section className="calibration-card__subsection" data-testid="tcal-baro">
      <div className="calibration-card__header">
        <strong>Barometer</strong>
        <StatusBadge tone={baroState.tone}>{baroState.label}</StatusBadge>
      </div>
      <p>
        Learns how the barometer&apos;s altitude drifts as the board heats, and corrects it. Same bench session as
        the IMUs: it only collects above {BARO_TCAL_MIN_TEMP_C}&thinsp;°C, needs {BARO_TCAL_MIN_RANGE_C}&thinsp;°C
        of rise, and restarts if the board moves. Corrects the first barometer only.
      </p>
      <div className="config-pills">
        <span data-tone={baroState.tone}>Baro TCAL: {baroState.label}</span>
        {baroExponent !== undefined && baroExponent !== 0 ? <span>Learned exponent: {baroExponent.toFixed(3)}</span> : null}
        {baroTempMin !== undefined && baroTempMax !== undefined && baroTempMax > baroTempMin ? (
          <span data-testid="tcal-baro-range">
            Learned over {baroTempMin.toFixed(0)}→{baroTempMax.toFixed(0)}&thinsp;°C
          </span>
        ) : (
          <span data-testid="tcal-baro-range">No range learned yet</span>
        )}
      </div>
      <div className="button-row">
        <button
          type="button"
          style={buttonStyle(imus.length === 0 ? 'primary' : undefined)}
          disabled={!canWrite || baroLearning}
          data-testid="tcal-baro-start"
          onClick={() => onWrite([{ paramId: 'TCAL_ENABLED', paramValue: 2 }], 'Baro temperature learning started')}
        >
          {baroLearning ? 'Baro is learning' : 'Start baro learning'}
        </button>
        {/* Learning keeps refining for as long as it is on. Pinning it to
            "use" stops it re-fitting on every bench session. */}
        <button
          type="button"
          style={buttonStyle()}
          disabled={!canWrite || !baroLearning}
          data-testid="tcal-baro-keep"
          onClick={() => onWrite([{ paramId: 'TCAL_ENABLED', paramValue: 1 }], 'Baro learning stopped; learned values kept')}
        >
          Stop learning, keep values
        </button>
        <button
          type="button"
          style={buttonStyle()}
          disabled={!canWrite || (baroEnabled ?? 0) === 0}
          data-testid="tcal-baro-off"
          onClick={() => onWrite([{ paramId: 'TCAL_ENABLED', paramValue: 0 }], 'Baro temperature calibration turned off')}
        >
          Turn off
        </button>
      </div>
    </section>
  ) : null

  if (imus.length === 0) {
    return (
      <article className="calibration-card" data-testid="calibration-card-tcal">
        <div className="calibration-card__header">
          <strong>Thermal calibration (TCAL)</strong>
          <StatusBadge tone="neutral">n/a</StatusBadge>
        </div>
        <p>
          This firmware doesn&apos;t expose per-IMU thermal-calibration parameters (<code>INS_TCALn_*</code>). Thermal
          cal is available on builds with per-IMU temperature compensation compiled in.
        </p>
        {baroSection ? expandToggle : null}
        {expanded ? baroSection : null}
      </article>
    )
  }

  const targetC = Number.parseFloat(targetText)
  const check = tcalTargetCheck(targetC, imuTempC)
  const canStart = canWrite && !anyLearning && check.problem === undefined
  const allCalibrated = imus.every((imu) => (imu.enable ?? 0) === 1)
  const onImuIds = imus.filter((imu) => (imu.enable ?? 0) === 1).map((imu) => imu.i)

  const start = (): void => {
    const withBaro = hasBaroTcal && includeBaro && !baroLearning
    onWrite(
      tcalStartWrites(
        imus.map((imu) => imu.i),
        targetC,
        withBaro
      ),
      `Thermal calibration started: target ${targetC.toFixed(0)} °C${withBaro ? ', barometer too' : ''}`
    )
  }

  return (
    <article className="calibration-card" data-testid="calibration-card-tcal">
      <div className="calibration-card__header">
        <strong>Thermal calibration (TCAL)</strong>
        <StatusBadge tone={anyLearning ? 'warning' : allCalibrated ? 'success' : 'neutral'}>
          {anyLearning ? 'learning' : allCalibrated ? 'calibrated' : 'idle'}
        </StatusBadge>
      </div>
      <p>Learns how each IMU drifts as the board warms up, and corrects it — one bench session from cold to warm.</p>

      <div className="config-pills">
        {imus.map((imu) => {
          const state = enableState(imu.enable)
          return (
            <span key={imu.i} data-tone={state.tone}>
              IMU{imu.i} TCAL: {state.label}
              {state.label === 'on' && imu.tmin !== undefined && imu.tmax !== undefined
                ? ` (${imu.tmin.toFixed(0)}→${imu.tmax.toFixed(0)}°C)`
                : ''}
            </span>
          )
        })}
        {imuTempC !== undefined ? (
          <span data-testid="tcal-imu-temp" data-tone={anyLearning ? 'warning' : 'neutral'}>
            IMU temp: {imuTempC.toFixed(1)}&thinsp;°C
          </span>
        ) : null}
      </div>

      {/* The learn ends inside the firmware, which never announces the new
          state; the runtime re-reads it on these messages. Said here too, so
          the result is visible without opening the card. */}
      {outcome === 'finished' ? (
        <p className="success-copy" data-testid="tcal-finished">
          Finished. Thermal cal is on and in use.
        </p>
      ) : outcome === 'failed' ? (
        <p className="switch-exercise-warning" data-testid="tcal-failed">
          The fit failed, so thermal cal is off. Let the board cool and start again.
        </p>
      ) : null}

      {expandToggle}

      {expanded ? (
        <>
          {anyLearning ? (
            <section className="tcal-learning" data-testid="tcal-learning">
              <p>
                <strong>Learning now.</strong>{' '}
                {imuTempC !== undefined ? `Board ${imuTempC.toFixed(1)} °C` : 'Board temperature unknown'}
                {learningTarget !== undefined ? ` → target ${learningTarget.toFixed(0)} °C.` : '.'}
              </p>
              <p>
                Leave it powered, on the bench and still — nothing to press. It saves itself at the target, or{' '}
                {TCAL_STALL_MINUTES} minutes after it stops warming (once it has risen {TCAL_MIN_RISE_C}&thinsp;°C). The
                state then reads <em>on</em>.
              </p>
              <div className="button-row">
                <button
                  type="button"
                  style={buttonStyle()}
                  disabled={!canWrite}
                  data-testid="tcal-stop-keep"
                  onClick={() =>
                    onWrite(tcalStopWrites(learningImuIds, 'keep'), 'Thermal learning stopped; what it saved is in use')
                  }
                >
                  Stop learning, keep values
                </button>
                <button
                  type="button"
                  style={buttonStyle()}
                  disabled={!canWrite}
                  data-testid="tcal-stop-off"
                  onClick={() => onWrite(tcalStopWrites(learningImuIds, 'off'), 'Thermal learning stopped; thermal cal off')}
                >
                  Stop and turn off
                </button>
              </div>
              <small>
                Keep uses what it has saved: a partial fit is saved every 15 s once the board has risen{' '}
                {TCAL_MIN_RISE_C}&thinsp;°C. Before that there is nothing new to keep.
              </small>
            </section>
          ) : (
            <ol className="tcal-steps" data-testid="tcal-steps">
              <li>
                <strong>Start cold.</strong> Let the board cool to room temperature, then power it up, props off, and
                start straight away — it learns from wherever it is when you press Start
                {imuTempC !== undefined ? <> (now <strong>{imuTempC.toFixed(1)}&thinsp;°C</strong>)</> : null}.
              </li>
              <li>
                <strong>Pick a target</strong> this board reaches on the bench, at least {TCAL_MIN_RISE_C}&thinsp;°C
                above where it starts.
                <div className="tcal-temp-range" data-testid="tcal-temp-range">
                  <label>
                    <span>Target (°C)</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      min={TCAL_TEMP_LIMIT_LOW_C}
                      max={TCAL_TEMP_LIMIT_HIGH_C}
                      value={targetText}
                      data-testid="tcal-tmax"
                      disabled={!canWrite}
                      onChange={(event) => {
                        setTouched(true)
                        setTargetText(event.target.value)
                      }}
                    />
                  </label>
                </div>
                {check.problem ? (
                  <p className="switch-exercise-warning" data-testid="tcal-temp-problem">
                    {check.problem}
                  </p>
                ) : check.note ? (
                  <p className="calibration-card__note" data-testid="tcal-temp-note">
                    {check.note}
                  </p>
                ) : null}
              </li>
              <li>
                <strong>Start</strong>, then leave it powered and still while it warms.
                {hasBaroTcal && !baroLearning ? (
                  <label className="tcal-include-baro">
                    <input
                      type="checkbox"
                      checked={includeBaro}
                      data-testid="tcal-include-baro"
                      onChange={(event) => setIncludeBaro(event.target.checked)}
                    />{' '}
                    Learn the barometer in the same session
                  </label>
                ) : null}
                <div className="button-row">
                  <button
                    type="button"
                    style={buttonStyle('primary')}
                    disabled={!canStart}
                    data-testid="tcal-start"
                    onClick={start}
                  >
                    {allCalibrated ? 'Learn again' : 'Start learning'}
                  </button>
                  {onImuIds.length > 0 ? (
                    <button
                      type="button"
                      style={buttonStyle()}
                      disabled={!canWrite}
                      data-testid="tcal-turn-off"
                      onClick={() => onWrite(tcalStopWrites(onImuIds, 'off'), 'Thermal cal turned off')}
                    >
                      Turn thermal cal off
                    </button>
                  ) : null}
                </div>
                <small>{writeBlockedReason ?? check.problem ?? 'Bench only, props off, disarmed.'}</small>
              </li>
            </ol>
          )}

          {tcalMessage ? (
            <p className="calibration-card__note" data-testid="tcal-message">
              Vehicle: {tcalMessage.text}
            </p>
          ) : null}

          {baroSection}
        </>
      ) : null}
    </article>
  )
}
