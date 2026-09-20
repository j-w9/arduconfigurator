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
//
// The BAROMETER has a separate temperature calibration with its own parameter
// family and its own procedure — AP_TempCalibration (TCAL_*, a Copter g2
// subgroup), not the per-IMU INS_TCALn_*. Same card because it is the same job
// to an operator ("calibrate this board over temperature") and the same bench
// session: power it cold, leave it still, let it warm. Everything below about
// it is from AP_TempCalibration.cpp, not from the name looking similar:
//   TCAL_ENABLED  0 = off, 1 = use learned values, 2 = learn AND use
//   TCAL_TEMP_MIN / TEMP_MAX / BARO_EXP are @ReadOnly — the learn writes them
//   learning runs only while DISARMED, while the IMU reads still (any movement
//     resets it), and only above 25 degC (Tzero); it needs a rise of at least
//     7 degC (min_learn_temp_range) before it fits and saves
//   the correction is applied to the FIRST baro only ("just for first baro now")

import { useEffect, useState, type ReactElement } from 'react'

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

// AP_TempCalibration.h: Tzero, the temperature below which the baro learn
// collects nothing, and the minimum rise it needs before it fits and saves.
const BARO_TCAL_MIN_TEMP_C = 25
const BARO_TCAL_MIN_RANGE_C = 7

// AP_InertialSensor_tempcal.cpp: learning finishes only when the IMU has both
// risen TEMP_RANGE_MIN (10 degC) above where it started AND reached TMAX.
const TCAL_MIN_RANGE_C = 10
// @Range on TMIN/TMAX.
const TCAL_TEMP_LIMIT_LOW_C = -70
const TCAL_TEMP_LIMIT_HIGH_C = 80
// AP_GROUPINFO default for TMAX. Most airframes never reach it, which is why
// leaving it alone is the same as never finishing.
const TCAL_TMAX_FIRMWARE_DEFAULT_C = 70

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
  const baroConnected = snapshot.connection.kind === 'connected'
  const canStartBaro =
    baroConnected && canApplyDraftParameters && busyAction === undefined && hasBaroTcal && !baroLearning

  const baroSection = hasBaroTcal ? (
    <section className="calibration-card__subsection" data-testid="tcal-baro">
      <div className="calibration-card__header">
        <strong>Barometer (TCAL)</strong>
        <StatusBadge tone={baroLearning ? 'warning' : baroState.tone}>{baroState.label}</StatusBadge>
      </div>
      <p>
        Learns how the barometer&apos;s pressure reading drifts as the board heats, and corrects it — the
        altitude equivalent of the IMU calibration above. Separate parameters (<code>TCAL_*</code>) and a
        separate procedure.
      </p>

      <div className="config-pills">
        <span data-tone={baroState.tone}>Baro TCAL: {baroState.label}</span>
        {baroExponent !== undefined ? <span>Learned exponent: {baroExponent.toFixed(3)}</span> : null}
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
          style={buttonStyle('primary')}
          disabled={!canStartBaro}
          data-testid="tcal-baro-start"
          onClick={() => setDraft('TCAL_ENABLED', '2')}
        >
          {baroLearning ? 'Learning already enabled' : 'Prepare baro calibration'}
        </button>
        {/* Learning keeps refining for as long as it is on. Once the range is
            learned, pinning it to "use" stops it re-fitting on every bench
            session — and it is the only way back short of the raw parameter. */}
        <button
          type="button"
          style={buttonStyle()}
          disabled={
            !baroConnected || !canApplyDraftParameters || busyAction !== undefined || !baroLearning
          }
          data-testid="tcal-baro-keep"
          onClick={() => setDraft('TCAL_ENABLED', '1')}
        >
          Stop learning, keep values
        </button>
      </div>
      <small>
        {!baroConnected
          ? 'Connect to a vehicle first.'
          : !canApplyDraftParameters
            ? 'Finish parameter sync and disarm first.'
            : `Bench only, disarmed and completely still — any movement restarts the learn, and it only collects above ${BARO_TCAL_MIN_TEMP_C} °C.`}
      </small>

      <details className="calibration-card__howto">
        <summary>How baro temperature calibration works</summary>
        <ol>
          <li><strong>Start cold</strong>, props off, on the bench. The vehicle must stay <strong>disarmed and still</strong> — the firmware restarts the learn the moment the IMUs report movement.</li>
          <li>Click <strong>Prepare baro calibration</strong>, then <strong>Apply</strong> in the draft bar (stages <code>TCAL_ENABLED = 2</code>, learn and use).</li>
          <li>Leave it powered and untouched while it self-heats. Nothing is collected below {BARO_TCAL_MIN_TEMP_C}&thinsp;°C, and it needs at least {BARO_TCAL_MIN_RANGE_C}&thinsp;°C of rise before it fits.</li>
          <li>The fit saves itself into <code>TCAL_BARO_EXP</code> with the range in <code>TCAL_TEMP_MIN</code>/<code>TEMP_MAX</code> — all three are read-only, written by the learn.</li>
          <li>Leave it learning to keep refining, or press <strong>Stop learning, keep values</strong> to pin what it has (<code>TCAL_ENABLED = 1</code>).</li>
        </ol>
        <p>Corrects the first barometer only.</p>
      </details>
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
          This firmware doesn't expose per-IMU thermal-calibration parameters (<code>INS_TCALn_*</code>). Thermal
          cal is available on builds with per-IMU temperature compensation compiled in.
        </p>
        {baroSection}
      </article>
    )
  }

  const anyLearning = imus.some((imu) => (imu.enable ?? 0) >= 2)
  const connected = snapshot.connection.kind === 'connected'
  const canStartBase = connected && canApplyDraftParameters && busyAction === undefined && !anyLearning

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

  // Target temperature.
  //
  // This is the whole reason the card needed inputs: TMAX is what ENDS the
  // learn (AP_InertialSensor_tempcal.cpp finishes when the IMU reaches it), and
  // its firmware default is 70 degC. Most airframes never get near that, so a
  // board left on the default learns forever and saves nothing — "it won't do
  // anything by default" is literally true.
  //
  // Seeded from the vehicle, and re-seeded when a sync brings real values in,
  // but not while the operator is typing into it.
  const [tmaxText, setTmaxText] = useState('')
  const [tminText, setTminText] = useState('')
  const [touched, setTouched] = useState(false)

  useEffect(() => {
    if (touched) return
    if (targetTmax !== undefined) setTmaxText(String(Math.round(targetTmax)))
    if (baseTmin !== undefined) setTminText(String(Math.round(baseTmin)))
  }, [targetTmax, baseTmin, touched])

  const tmaxValue = Number.parseFloat(tmaxText)
  const tminValue = Number.parseFloat(tminText)
  const tmaxValid = Number.isFinite(tmaxValue) && tmaxValue >= TCAL_TEMP_LIMIT_LOW_C && tmaxValue <= TCAL_TEMP_LIMIT_HIGH_C
  const tminValid = Number.isFinite(tminValue) && tminValue >= TCAL_TEMP_LIMIT_LOW_C && tminValue <= TCAL_TEMP_LIMIT_HIGH_C
  const rangeValid = tmaxValid && tminValid && tmaxValue - tminValue >= TCAL_MIN_RANGE_C
  const temperaturesReady = tmaxValid && tminValid && rangeValid

  const temperatureProblem = !tmaxValid
    ? `Target temperature must be between ${TCAL_TEMP_LIMIT_LOW_C} and ${TCAL_TEMP_LIMIT_HIGH_C} °C.`
    : !tminValid
      ? `Start temperature must be between ${TCAL_TEMP_LIMIT_LOW_C} and ${TCAL_TEMP_LIMIT_HIGH_C} °C.`
      : !rangeValid
        ? `The firmware needs at least ${TCAL_MIN_RANGE_C} °C between them, or it never completes the fit.`
        : undefined

  // A target the board will not reach is the failure this card exists to
  // prevent, so say so rather than staging it silently. Not an error: a heated
  // or enclosed build genuinely can get there.
  const targetLooksUnreachable = tmaxValid && tmaxValue >= TCAL_TMAX_FIRMWARE_DEFAULT_C

  const canStart = canStartBase && temperaturesReady

  const startLearning = (): void => {
    for (const imu of imus) {
      // Temperatures first, then the enable. ENABLE carries
      // AP_PARAM_FLAG_ENABLE, and the range has to be in place before the
      // learn it starts can use it.
      setDraft(`INS_TCAL${imu.i}_TMIN`, String(tminValue))
      setDraft(`INS_TCAL${imu.i}_TMAX`, String(tmaxValue))
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

      {/* The temperature range the learn will run over.
        *
        * TMAX is the input that matters: it is what ends the learn. TMIN is
        * offered because the range has to be at least 10 degC for the fit to be
        * accepted, but the firmware OVERWRITES it with wherever the board
        * actually started when it saves — so it is a floor for validity, not a
        * promise about the run. */}
      <div className="tcal-temp-range" data-testid="tcal-temp-range">
        <label>
          <span>Start (°C)</span>
          <input
            type="number"
            inputMode="decimal"
            min={TCAL_TEMP_LIMIT_LOW_C}
            max={TCAL_TEMP_LIMIT_HIGH_C}
            value={tminText}
            data-testid="tcal-tmin"
            disabled={!canStartBase}
            onChange={(event) => {
              setTouched(true)
              setTminText(event.target.value)
            }}
          />
        </label>
        <label>
          <span>Target (°C)</span>
          <input
            type="number"
            inputMode="decimal"
            min={TCAL_TEMP_LIMIT_LOW_C}
            max={TCAL_TEMP_LIMIT_HIGH_C}
            value={tmaxText}
            data-testid="tcal-tmax"
            disabled={!canStartBase}
            onChange={(event) => {
              setTouched(true)
              setTmaxText(event.target.value)
            }}
          />
        </label>
      </div>

      {temperatureProblem ? (
        <p className="switch-exercise-warning" data-testid="tcal-temp-problem">
          {temperatureProblem}
        </p>
      ) : targetLooksUnreachable ? (
        <p className="switch-exercise-warning" data-testid="tcal-temp-unreachable">
          {tmaxValue.toFixed(0)} °C is the firmware default, and most airframes never get there — the
          learn would run forever and save nothing. Set the target to a temperature this board actually
          reaches on the bench (watch the live IMU temperature above).
        </p>
      ) : null}

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
            : temperatureProblem !== undefined
              ? temperatureProblem
              : 'Bench only, props off — the board just sits still and warms up.'}
      </small>

      <details className="calibration-card__howto">
        <summary>How thermal calibration works (cold boot → warm)</summary>
        <ol>
          <li><strong>Start cold.</strong> Power off and let the board cool to ambient — the wider the cold-to-warm swing, the better the fit.</li>
          <li>Set <strong>Target</strong> to a temperature this board actually reaches — the learn ends there, and the firmware default of 70&thinsp;°C is out of reach for most airframes.</li>
          <li>Click <strong>Prepare thermal calibration</strong>, then <strong>Apply</strong> in the draft bar (stages <code>INS_TCALn_TMIN</code>/<code>TMAX</code> and <code>INS_TCALn_ENABLE = 2</code>, learn).</li>
          <li>Reboot <strong>cold</strong>, props off, and leave it powered and still — it self-heats through the range.</li>
          <li>At the top temperature the fit saves automatically (state flips back to <em>on</em>). Reboot once more to use it.</li>
        </ol>
      </details>

      {baroSection}
    </article>
  )
}
