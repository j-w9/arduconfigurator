// CalibrationSection — App.tsx's `activeViewId === 'calibration'` block,
// lifted into its own component. Accelerometer / level / compass guided
// actions + battery voltage / battery current / airspeed / ESC throttle
// calibration cards. ~470 lines of inline JSX moved verbatim.

import { useState, type ReactElement } from 'react'
import type { ConfiguratorSnapshot, AirframeSummary } from '@arduconfig/ardupilot-core'
import type { ArduPilotConfiguratorRuntime, ParameterWriteOptions } from '@arduconfig/ardupilot-core'
import { MAX_MOTOR_TEST_DURATION_SECONDS } from '@arduconfig/ardupilot-core'
import { Panel, StatusBadge, buttonStyle } from '@arduconfig/ui-kit'
import { formatArducopterMotorPwmType } from '@arduconfig/param-metadata'

import { AccelerometerPoseGuide } from '../accelerometer-pose-guide'
import { CalibrationLocationButton } from './CalibrationLocationCard'
import { TcalCalibrationCard } from './TcalCalibrationCard'
import { ValtCalibrationCard } from './ValtCalibrationCard'
import {
  accelerometerPoseFromAction,
  guidedActionBlockingReason,
  guidedActionButtonLabel,
  setupActionBusyReason
} from '../guided-action-helpers'
import type { GuidedActionId } from '../guided-action-labels'
import type { ParameterNotice } from '../hooks/use-parameter-feedback'
import type { UseCalibrationNoticesResult } from '../hooks/use-calibration-notices'
import type { UseSafetyAcksResult } from '../hooks/use-safety-acks'
import { readParameterValue, readRoundedParameter } from '../selectors/parameter-read'

export interface CalibrationSectionProps {
  snapshot: ConfiguratorSnapshot
  runtime: ArduPilotConfiguratorRuntime
  busyAction: string | undefined
  canApplyDraftParameters: boolean
  airframe: AirframeSummary
  isCopterVehicle: boolean
  /** Expert product-mode — gates the advanced Thermal Calibration (TCAL) card. */
  isExpertMode: boolean
  uiParameterWriteOptions: ParameterWriteOptions
  editedValues: Record<string, string>
  calibrationNotices: UseCalibrationNoticesResult
  safetyAcks: UseSafetyAcksResult
  setDraft: (paramId: string, value: string) => void
  clearDraft: (paramId: string) => void
  setParameterNotice: (notice: ParameterNotice | undefined) => void
  handleGuidedAction: (actionId: GuidedActionId) => void | Promise<void>
  handleCancelGuidedAction: (actionId: GuidedActionId) => void
}

/** Load-spin duration for battery-current calibration. Pinned to the shared
 *  motor-test cap: the card used to hardcode 8 s, which every non-Expert
 *  session rejected outright with "Duration must stay between ...", so the
 *  button could never work. */
const BATTERY_CURRENT_LOAD_SECONDS = MAX_MOTOR_TEST_DURATION_SECONDS

export function CalibrationSection(props: CalibrationSectionProps): ReactElement {
  // Throttle used for the current-calibration load spin. Local to this card:
  // it is a transient bench choice, not something worth persisting.
  const [currentCalThrottlePercent, setCurrentCalThrottlePercent] = useState('20')
  const {
    snapshot,
    runtime,
    busyAction,
    canApplyDraftParameters,
    airframe,
    isCopterVehicle,
    isExpertMode,
    uiParameterWriteOptions: UI_PARAMETER_WRITE_OPTIONS,
    editedValues,
    calibrationNotices,
    safetyAcks,
    setDraft,
    clearDraft,
    setParameterNotice,
    handleGuidedAction,
    handleCancelGuidedAction
  } = props

  const {
    batteryMeasuredVoltage,
    setBatteryMeasuredVoltage,
    batteryMeasuredCurrent,
    setBatteryMeasuredCurrent,
    batteryCalNotice,
    setBatteryCalNotice,
    airspeedCalNotice,
    setAirspeedCalNotice,
    escCalNotice,
    setEscCalNotice,
    escCalArmed,
    setEscCalArmed
  } = calibrationNotices

  const {
    propsRemovedAcknowledged,
    setPropsRemovedAcknowledged,
    testAreaAcknowledged,
    setTestAreaAcknowledged
  } = safetyAcks

  // Mark airframe as referenced even if the JSX below uses it indirectly — keep
  // it as a prop so future cal cards can branch on frame class without a new
  // signature change.
  void airframe

  return (

        <section className="grid one-up">
          <Panel
            title="Calibration"
            subtitle="Accelerometer, level, and compass calibration."
          >
            <div className="calibration-grid" data-testid="calibration-grid">
              {([
                { actionId: 'calibrate-accelerometer' as const, title: 'Accelerometer', copy: 'Keep the aircraft flat, then step through the six pose prompts until the calibration completes.' },
                { actionId: 'calibrate-level' as const, title: 'Level', copy: 'Set the aircraft level on the bench and run a quick level trim (AHRS_TRIM).' },
                { actionId: 'calibrate-compass' as const, title: 'Compass', copy: 'Run onboard compass calibration; rotate the vehicle through all axes when prompted.' }
              ]).map((action) => {
                const actionState = snapshot.guidedActions[action.actionId]
                const blockingReason = guidedActionBlockingReason(snapshot, action.actionId)
                const busyReason = setupActionBusyReason(busyAction, action.actionId, action.title)
                const disabledReason = busyReason ?? blockingReason
                const tone =
                  actionState.status === 'failed' ? 'danger'
                    : actionState.status === 'succeeded' ? 'success'
                      : actionState.status === 'requested' || actionState.status === 'running' ? 'warning'
                        : 'neutral'
                const showPoseGuide =
                  action.actionId === 'calibrate-accelerometer' &&
                  (actionState.status === 'requested' || actionState.status === 'running')
                return (
                  <article key={action.actionId} className="calibration-card" data-testid={`calibration-card-${action.actionId}`}>
                    <div className="calibration-card__header">
                      <strong>{action.title}</strong>
                      <StatusBadge tone={tone}>{actionState.status}</StatusBadge>
                    </div>
                    {/* Live status summary (pose prompts, progress, completion)
                        falls back to the static copy when idle. */}
                    <p>{actionState.summary ?? action.copy}</p>
                    <button
                      type="button"
                      style={buttonStyle('primary')}
                      data-testid={`calibration-run-${action.actionId}`}
                      onClick={() => void handleGuidedAction(action.actionId)}
                      disabled={disabledReason !== undefined}
                    >
                      {guidedActionButtonLabel(action.actionId, snapshot, busyAction)}
                    </button>
                    {actionState.status === 'requested' || actionState.status === 'running' ? (
                      // A cal stranded in 'running' (lost completion message,
                      // abandoned mid-cal) blocks every parameter write —
                      // the cancel is the recovery path that isn't a reboot.
                      <button
                        type="button"
                        style={buttonStyle()}
                        data-testid={`calibration-cancel-${action.actionId}`}
                        onClick={() => handleCancelGuidedAction(action.actionId)}
                      >
                        Cancel calibration
                      </button>
                    ) : null}
                    {disabledReason ? <p className="calibration-card__blocked">{disabledReason}</p> : null}
                    {showPoseGuide ? (
                      <AccelerometerPoseGuide
                        compact
                        currentPose={accelerometerPoseFromAction(snapshot)}
                        rollDeg={snapshot.liveVerification.attitudeTelemetry.rollDeg}
                        pitchDeg={snapshot.liveVerification.attitudeTelemetry.pitchDeg}
                        attitudeVerified={snapshot.liveVerification.attitudeTelemetry.verified}
                        testId="calibration-accelerometer-guide"
                      />
                    ) : null}
                    {/* Inline how-to hint per guided cal action. Collapsed by
                      * default; same low-key styling as the battery cards. */}
                    {action.actionId === 'calibrate-accelerometer' ? (
                      <details className="calibration-card__howto">
                        <summary>How to calibrate the accelerometer (6-pose)</summary>
                        <ol>
                          <li>Click <em>Calibrate Accelerometer</em>; wait for the first pose prompt (the FC asks you to place the frame in six successive orientations).</li>
                          <li>For each pose: hold the frame motionless in the requested orientation (level, left side, right side, nose-down, nose-up, on its back), then click the matching <em>Confirm</em> button.</li>
                          <li>The 6-pose chain ends with "Accelerometer calibration complete." Re-run any time you re-mount the FC on the frame.</li>
                        </ol>
                      </details>
                    ) : null}
                    {action.actionId === 'calibrate-level' ? (
                      <details className="calibration-card__howto">
                        <summary>How to calibrate level (AHRS trim)</summary>
                        <ol>
                          <li>Place the airframe on a known-level surface with the FC's nominal "forward" axis pointing forward.</li>
                          <li>Click <em>Calibrate Level</em>. The FC samples gravity for ~1 second and writes <code>AHRS_TRIM_X</code> / <code>AHRS_TRIM_Y</code>.</li>
                          <li>Re-run whenever the FC is repositioned on the frame. Only corrects ±10° of mounting tilt — past that you need to physically straighten the FC.</li>
                        </ol>
                      </details>
                    ) : null}
                    {action.actionId === 'calibrate-compass' ? (
                      <CalibrationLocationButton snapshot={snapshot} runtime={runtime} />
                    ) : null}
                    {action.actionId === 'calibrate-compass' ? (
                      <details className="calibration-card__howto">
                        <summary>How to calibrate the compass (rotate-through-all-axes)</summary>
                        <ol>
                          <li>Move the airframe away from large metal objects and powered electronics (motors, ESCs idle are fine; computers and steel benches are not).</li>
                          <li>Click <em>Calibrate Compass</em>; rotate the airframe through every axis (nose-up, nose-down, on its side, upside down) until the progress reaches 100%.</li>
                          <li>The cal writes <code>COMPASS_OFS_X/Y/Z</code> on success. Healthy offsets are well within ±400 mGauss; larger values mean nearby magnetic interference.</li>
                        </ol>
                      </details>
                    ) : null}
                  </article>
                )
              })}

              {(() => {
                const battery = snapshot.liveVerification.batteryTelemetry
                const reportedV = battery.verified ? battery.voltageV : undefined
                const currentMult = readParameterValue(snapshot, 'BATT_VOLT_MULT')
                const measured = Number.parseFloat(batteryMeasuredVoltage)
                const connected = snapshot.connection.kind === 'connected'
                const inputsValid =
                  currentMult !== undefined && currentMult > 0 &&
                  reportedV !== undefined && reportedV > 0 &&
                  Number.isFinite(measured) && measured > 0
                const newMult = inputsValid ? currentMult! * (measured / reportedV!) : undefined
                const canApply = canApplyDraftParameters && inputsValid && busyAction === undefined
                const blockedReason = !connected
                  ? 'Connect to a vehicle first.'
                  : !canApplyDraftParameters
                    ? 'Finish parameter sync and disarm before applying.'
                    : reportedV === undefined
                      ? 'No live battery voltage yet — enable a battery monitor.'
                      : currentMult === undefined
                        ? 'BATT_VOLT_MULT not retrieved yet.'
                        : undefined
                return (
                  <article className="calibration-card" data-testid="calibration-card-battery">
                    <div className="calibration-card__header">
                      <strong>Battery voltage</strong>
                      <StatusBadge tone={batteryCalNotice?.tone ?? 'neutral'}>
                        {batteryCalNotice ? (batteryCalNotice.tone === 'danger' ? 'failed' : 'done') : 'idle'}
                      </StatusBadge>
                    </div>
                    <p>Measure the pack voltage with a multimeter and enter it — BATT_VOLT_MULT is rescaled so the FC reads true.</p>
                    <div className="config-pills">
                      <span>FC reads: {reportedV !== undefined ? `${reportedV.toFixed(2)} V` : 'no telemetry'}</span>
                      <span>Multiplier: {currentMult !== undefined ? currentMult.toFixed(2) : 'unknown'}</span>
                    </div>
                    <label className="scoped-editor-field scoped-editor-field--compact">
                      <span>Measured voltage (V)</span>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        inputMode="decimal"
                        value={batteryMeasuredVoltage}
                        onChange={(event) => setBatteryMeasuredVoltage(event.target.value)}
                        data-testid="battery-cal-measured-input"
                      />
                    </label>
                    {newMult !== undefined ? <small>New multiplier: {newMult.toFixed(2)}</small> : null}
                    <button
                      type="button"
                      style={buttonStyle('primary')}
                      data-testid="battery-cal-apply"
                      disabled={!canApply}
                      onClick={() => {
                        if (newMult === undefined) return
                        void (async () => {
                          try {
                            await runtime.setParameter('BATT_VOLT_MULT', Number(newMult.toFixed(4)), UI_PARAMETER_WRITE_OPTIONS)
                            setBatteryCalNotice({ tone: 'success', text: `BATT_VOLT_MULT set to ${newMult.toFixed(2)}.` })
                            setBatteryMeasuredVoltage('')
                          } catch (error) {
                            setBatteryCalNotice({ tone: 'danger', text: error instanceof Error ? error.message : 'Failed to write BATT_VOLT_MULT.' })
                          }
                        })()
                      }}
                    >
                      Apply voltage calibration
                    </button>
                    {blockedReason ? <p className="calibration-card__blocked">{blockedReason}</p> : null}
                    {batteryCalNotice ? <p className="calibration-card__blocked">{batteryCalNotice.text}</p> : null}
                    <details className="calibration-card__howto">
                      <summary>How to calibrate battery voltage (BATT_VOLT_MULT)</summary>
                      <ol>
                        <li>Read pack voltage with a <strong>known-good multimeter</strong> directly on the battery's main XT60 / XT30 / etc. (or the FC's voltage sense pad — the autopilot reads exactly what the pad sees).</li>
                        <li>Enter the measured value above. The new BATT_VOLT_MULT shown below is computed so the FC will report the measured voltage on this very sample.</li>
                        <li>Click <em>Apply voltage calibration</em>. The FC echoes the new multiplier in PARAM_VALUE; the in-app reading should match the multimeter within ~10 mV after the next telemetry tick.</li>
                        <li>If the reading still drifts, suspect the battery analog divider — check BATT_VOLT_PIN / BATT_VOLT_MULT defaults for your board.</li>
                      </ol>
                    </details>
                  </article>
                )
              })()}

              {(() => {
                // Battery current calibration. Cooperates with the FC's analog
                // current sense path: the autopilot reads a voltage on
                // BATT_CURR_PIN and converts it via:
                //   amps = (sensor_voltage - BATT_AMP_OFFSET) * BATT_AMP_PERVLT
                // where BATT_AMP_OFFSET is the sensor voltage at 0 A (the
                // bias/intercept) and BATT_AMP_PERVLT is amps per volt (the
                // slope). Both are typically board-specific and need to be
                // calibrated against a known current load (motors at fixed
                // throttle, with a clamp meter as ground truth).
                const battery = snapshot.liveVerification.batteryTelemetry
                const reportedA = battery.verified ? battery.currentA : undefined
                const currentOffset = readParameterValue(snapshot, 'BATT_AMP_OFFSET')
                const currentPerVolt = readParameterValue(snapshot, 'BATT_AMP_PERVLT')
                const monitorMode = readRoundedParameter(snapshot, 'BATT_MONITOR')
                // This card calibrates the ANALOG current sensor via
                // BATT_AMP_OFFSET/BATT_AMP_PERVLT, so it only applies to monitor
                // types whose driver actually reads current through that path —
                // the AP_BattMonitor_Analog family: 4 (Analog Voltage+Current),
                // 25 (Synthetic Current + Analog Voltage, a subclass of Analog),
                // 28 (AD7091R5 ADC), and 31 (Analog Current Only). Verified
                // against the AP_BattMonitor driver factory in ~/ardupilot.
                // Smart/CAN/SMBus/ESC monitors (7/8/9/13/14/16/…) report already-
                // calibrated current over their own bus and ignore these params,
                // so the card is hidden for them; voltage-only (3) and disabled
                // (0) have no current path at all.
                const monitorUsesAnalogCurrentCal =
                  monitorMode !== undefined && [4, 25, 28, 31].includes(monitorMode)
                const connected = snapshot.connection.kind === 'connected'
                const blockedReason = !connected
                  ? 'Connect to a vehicle first.'
                  : !canApplyDraftParameters
                    ? 'Finish parameter sync and disarm before applying.'
                    : monitorMode === undefined
                      ? 'BATT_MONITOR not retrieved yet.'
                      : !monitorUsesAnalogCurrentCal
                        ? `BATT_MONITOR=${monitorMode} has no analog current sensor to calibrate — set it up in Power first.`
                        : undefined
                if (!monitorUsesAnalogCurrentCal && monitorMode !== undefined) {
                  // Hide entirely on monitor modes that don't expose current
                  // (voltage-only setups AND BATT_MONITOR=0 / disabled) —
                  // keeps the cal stack tidy on FCs without a current sensor.
                  // The `monitorMode !== 0` exception that used to live here
                  // surfaced a useless "BATT_MONITOR=0 doesn't read current"
                  // blocker banner on every Plane / bench FC that doesn't
                  // have BATT_MONITOR configured yet (verified against a
                  // real Plane 2026-05-28). The Power tab is the right place
                  // to set it up; this card belongs hidden until then.
                  return null
                }
                return (
                  <article className="calibration-card" data-testid="calibration-card-battery-current">
                    <div className="calibration-card__header">
                      <strong>Battery current</strong>
                      <StatusBadge tone="neutral">
                        {currentOffset !== undefined && currentPerVolt !== undefined ? 'edit' : 'idle'}
                      </StatusBadge>
                    </div>
                    <p>Calibrates the analog current sensor: <code>amps = (sensor_voltage − BATT_AMP_OFFSET) × BATT_AMP_PERVLT</code>. Offset is the sensor voltage at 0 A; per-volt is amps per volt of sensor output.</p>
                    <p className="calibration-card__tip">
                      You need a reference reading to calibrate against. An inline watt/current meter between the
                      pack and the craft is the easiest option — e.g. a ToolkitRC (WM series) or a Turnigy/HobbyKing
                      inline meter; a DC clamp meter around the positive lead works too and avoids breaking the
                      circuit. Take the reading under a steady load, not at idle: the per-volt fit is
                      measured&nbsp;÷&nbsp;reported at one operating point, and near 0&nbsp;A that ratio is mostly noise.
                    </p>
                    <div className="config-pills">
                      <span>FC reads: {reportedA !== undefined ? `${reportedA.toFixed(2)} A` : 'no telemetry'}</span>
                      <span>Offset: {currentOffset !== undefined ? `${currentOffset.toFixed(3)} V` : 'unknown'}</span>
                      <span>Per-volt: {currentPerVolt !== undefined ? `${currentPerVolt.toFixed(2)} A/V` : 'unknown'}</span>
                    </div>
                    {(() => {
                      // Guided current calibration — does the arithmetic the how-to
                      // below describes by hand, so the operator only has to (1)
                      // zero the offset at no-load, then (2) type the clamp-meter
                      // reading under a steady load. Both write straight through
                      // like the voltage-cal card (no draft round-trip), so the
                      // user's "press a button, give the measured value, done"
                      // expectation holds.
                      const canGuide =
                        currentPerVolt !== undefined &&
                        currentPerVolt > 0 &&
                        reportedA !== undefined &&
                        busyAction === undefined &&
                        canApplyDraftParameters &&
                        blockedReason === undefined
                      // Zero offset: shift BATT_AMP_OFFSET so the present (no-load)
                      // sensor reading reports 0 A. amps = (v - offset) * pervlt, so
                      // making amps read 0 at this sample means offset' = offset +
                      // reportedA / pervlt.
                      const zeroedOffset =
                        currentOffset !== undefined && currentPerVolt !== undefined && currentPerVolt > 0 && reportedA !== undefined
                          ? currentOffset + reportedA / currentPerVolt
                          : undefined
                      const measuredA = Number.parseFloat(batteryMeasuredCurrent)
                      const newPerVolt =
                        currentPerVolt !== undefined &&
                        currentPerVolt > 0 &&
                        reportedA !== undefined &&
                        reportedA > 0 &&
                        Number.isFinite(measuredA) &&
                        measuredA > 0
                          ? currentPerVolt * (measuredA / reportedA)
                          : undefined
                      return (
                        <div className="guided-current-cal" data-testid="battery-current-guided">
                          <div className="switch-exercise-controls">
                            <button
                              type="button"
                              style={buttonStyle()}
                              data-testid="battery-current-zero-offset"
                              disabled={!canGuide || zeroedOffset === undefined}
                              onClick={() => {
                                if (zeroedOffset === undefined) return
                                void (async () => {
                                  try {
                                    await runtime.setParameter('BATT_AMP_OFFSET', Number(zeroedOffset.toFixed(4)), UI_PARAMETER_WRITE_OPTIONS)
                                    setBatteryCalNotice({
                                      tone: 'success',
                                      text: `Zeroed current offset (BATT_AMP_OFFSET = ${zeroedOffset.toFixed(3)} V). Reported current should now read ~0 A at no load.`
                                    })
                                  } catch (error) {
                                    setBatteryCalNotice({
                                      tone: 'danger',
                                      text: error instanceof Error ? error.message : 'Failed to write BATT_AMP_OFFSET.'
                                    })
                                  }
                                })()
                              }}
                            >
                              Zero offset now ({reportedA !== undefined ? `${reportedA.toFixed(2)} A` : '—'} → 0 A)
                            </button>
                          </div>
                          {/* Step 2: put a real load on the pack. Current
                           *  calibration needs a steady draw to scale against —
                           *  BATT_AMP_PERVLT is fitted from (measured / reported)
                           *  at one operating point, and at ~0 A that ratio is
                           *  noise. The operator previously had to leave for the
                           *  Motors bench to get any load at all, so the two
                           *  halves of the procedure lived on different pages.
                           *  Spins every motor together (Mission Planner's "test
                           *  all motors"), gated on the SAME props-off /
                           *  restrained acknowledgements as every other
                           *  motor-spinning action here. */}
                          {isCopterVehicle ? (
                            <div className="guided-current-cal__load" data-testid="battery-current-load">
                              <label className="scoped-editor-field scoped-editor-field--compact">
                                <span>Load throttle (%)</span>
                                <input
                                  type="number"
                                  min="1"
                                  max="35"
                                  step="1"
                                  inputMode="numeric"
                                  value={currentCalThrottlePercent}
                                  onChange={(event) => setCurrentCalThrottlePercent(event.target.value)}
                                  data-testid="battery-current-load-throttle"
                                />
                              </label>
                              <button
                                type="button"
                                style={buttonStyle()}
                                data-testid="battery-current-spin-motors"
                                disabled={
                                  busyAction !== undefined ||
                                  snapshot.connection.kind !== 'connected' ||
                                  snapshot.vehicle?.armed === true ||
                                  !(propsRemovedAcknowledged && testAreaAcknowledged) ||
                                  snapshot.motorTest.status === 'requested' ||
                                  snapshot.motorTest.status === 'running'
                                }
                                onClick={() => {
                                  const throttlePercent = Number.parseFloat(currentCalThrottlePercent)
                                  if (!Number.isFinite(throttlePercent) || throttlePercent <= 0) {
                                    return
                                  }
                                  void (async () => {
                                    try {
                                      await runtime.runMotorTest({
                                        runAllOutputsSimultaneous: true,
                                        throttlePercent,
                                        durationSeconds: BATTERY_CURRENT_LOAD_SECONDS
                                      })
                                      setBatteryCalNotice({
                                        tone: 'warning',
                                        text: `Spinning all motors at ${throttlePercent}% for ${BATTERY_CURRENT_LOAD_SECONDS} s — read your meter NOW and type the value below.`
                                      })
                                    } catch (error) {
                                      setBatteryCalNotice({
                                        tone: 'danger',
                                        text: error instanceof Error ? error.message : 'Failed to start the motor load.'
                                      })
                                    }
                                  })()
                                }}
                              >
                                {snapshot.motorTest.status === 'running' ? 'Motors spinning…' : `Spin motors for ${BATTERY_CURRENT_LOAD_SECONDS} s`}
                              </button>
                              {!(propsRemovedAcknowledged && testAreaAcknowledged) ? (
                                <small>Acknowledge the motor-spin safety checks below before applying a load.</small>
                              ) : null}
                            </div>
                          ) : null}
                          <label className="scoped-editor-field scoped-editor-field--compact">
                            <span>Measured current (A)</span>
                            <input
                              type="number"
                              step="0.1"
                              min="0"
                              inputMode="decimal"
                              value={batteryMeasuredCurrent}
                              onChange={(event) => setBatteryMeasuredCurrent(event.target.value)}
                              data-testid="battery-current-measured-input"
                            />
                          </label>
                          {newPerVolt !== undefined ? <small>New per-volt: {newPerVolt.toFixed(2)} A/V</small> : null}
                          <button
                            type="button"
                            style={buttonStyle('primary')}
                            data-testid="battery-current-calibrate-pervlt"
                            disabled={!canGuide || newPerVolt === undefined}
                            onClick={() => {
                              if (newPerVolt === undefined) return
                              void (async () => {
                                try {
                                  await runtime.setParameter('BATT_AMP_PERVLT', Number(newPerVolt.toFixed(4)), UI_PARAMETER_WRITE_OPTIONS)
                                  setBatteryCalNotice({ tone: 'success', text: `BATT_AMP_PERVLT set to ${newPerVolt.toFixed(2)} A/V.` })
                                  setBatteryMeasuredCurrent('')
                                } catch (error) {
                                  setBatteryCalNotice({
                                    tone: 'danger',
                                    text: error instanceof Error ? error.message : 'Failed to write BATT_AMP_PERVLT.'
                                  })
                                }
                              })()
                            }}
                          >
                            Calibrate from measured current
                          </button>
                          {batteryCalNotice ? <p className="calibration-card__blocked">{batteryCalNotice.text}</p> : null}
                        </div>
                      )
                    })()}
                    <details className="calibration-card__advanced">
                      <summary>Manual offset / per-volt</summary>
                    <div className="scoped-editor-grid">
                      <label className="scoped-editor-field scoped-editor-field--compact">
                        <span>BATT_AMP_OFFSET (V)</span>
                        <input
                          type="number"
                          step="0.001"
                          inputMode="decimal"
                          defaultValue={currentOffset !== undefined ? currentOffset.toFixed(3) : ''}
                          onChange={(event) => setDraft('BATT_AMP_OFFSET', event.target.value)}
                          data-testid="battery-current-cal-offset-input"
                        />
                      </label>
                      <label className="scoped-editor-field scoped-editor-field--compact">
                        <span>BATT_AMP_PERVLT (A/V)</span>
                        <input
                          type="number"
                          step="0.01"
                          inputMode="decimal"
                          defaultValue={currentPerVolt !== undefined ? currentPerVolt.toFixed(2) : ''}
                          onChange={(event) => setDraft('BATT_AMP_PERVLT', event.target.value)}
                          data-testid="battery-current-cal-pervlt-input"
                        />
                      </label>
                    </div>
                    <button
                      type="button"
                      style={buttonStyle('primary')}
                      data-testid="battery-current-cal-apply"
                      disabled={busyAction !== undefined || !canApplyDraftParameters || blockedReason !== undefined}
                      onClick={() => {
                        void (async () => {
                          const offsetDraft = editedValues['BATT_AMP_OFFSET']
                          const perVoltDraft = editedValues['BATT_AMP_PERVLT']
                          try {
                            if (offsetDraft !== undefined && offsetDraft !== '') {
                              const value = Number.parseFloat(offsetDraft)
                              if (Number.isFinite(value)) {
                                await runtime.setParameter('BATT_AMP_OFFSET', value, UI_PARAMETER_WRITE_OPTIONS)
                              }
                            }
                            if (perVoltDraft !== undefined && perVoltDraft !== '') {
                              const value = Number.parseFloat(perVoltDraft)
                              if (Number.isFinite(value) && value > 0) {
                                await runtime.setParameter('BATT_AMP_PERVLT', value, UI_PARAMETER_WRITE_OPTIONS)
                              }
                            }
                            clearDraft('BATT_AMP_OFFSET')
                            clearDraft('BATT_AMP_PERVLT')
                            setParameterNotice({ tone: 'success', text: 'Battery current calibration written.' })
                          } catch (error) {
                            setParameterNotice({
                              tone: 'danger',
                              text: error instanceof Error ? error.message : 'Failed to write battery current calibration.'
                            })
                          }
                        })()
                      }}
                    >
                      Apply current calibration
                    </button>
                    {blockedReason ? <p className="calibration-card__blocked">{blockedReason}</p> : null}
                    </details>
                    <details className="calibration-card__howto">
                      <summary>How to calibrate battery current (BATT_AMP_OFFSET / BATT_AMP_PERVLT)</summary>
                      <ol>
                        <li>Zero offset: disconnect the main battery (USB-power the FC). If reported current isn't 0 A, adjust BATT_AMP_OFFSET until it is.</li>
                        <li>Per-volt slope: reconnect battery, apply a known steady load (motors at fixed throttle, props off / restrained), measure actual current with a clamp meter, multiply BATT_AMP_PERVLT by <code>measured_A / fc_reported_A</code>.</li>
                        <li>Apply and verify across a couple of throttle points. Skip entirely on CAN/SMBUS/I²C monitors — they report calibrated current directly.</li>
                      </ol>
                    </details>
                  </article>
                )
              })()}

              {(() => {
                // Airspeed calibration is plane-only and only meaningful with an
                // airspeed sensor configured (ARSPD_TYPE > 0).
                const isPlane = (snapshot.vehicle?.vehicle ?? 'ArduCopter') === 'ArduPlane'
                const arspdType = readRoundedParameter(snapshot, 'ARSPD_TYPE')
                if (!isPlane || arspdType === undefined || arspdType <= 0) {
                  return null
                }
                const autoCalOn = readRoundedParameter(snapshot, 'ARSPD_AUTOCAL') === 1
                const ratio = readParameterValue(snapshot, 'ARSPD_RATIO')
                const canApply = canApplyDraftParameters && busyAction === undefined
                const blocked = snapshot.connection.kind !== 'connected'
                  ? 'Connect to a vehicle first.'
                  : !canApplyDraftParameters
                    ? 'Finish parameter sync and disarm before applying.'
                    : undefined
                return (
                  <article className="calibration-card" data-testid="calibration-card-airspeed">
                    <div className="calibration-card__header">
                      <strong>Airspeed</strong>
                      <StatusBadge tone={airspeedCalNotice?.tone ?? (autoCalOn ? 'success' : 'neutral')}>
                        {airspeedCalNotice ? (airspeedCalNotice.tone === 'danger' ? 'failed' : 'done') : autoCalOn ? 'auto-cal on' : 'idle'}
                      </StatusBadge>
                    </div>
                    <p>
                      The zero offset auto-calibrates on each boot (cover the pitot, no wind). Enable in-flight
                      ratio auto-cal (ARSPD_AUTOCAL) to refine the airspeed ratio while flying.
                    </p>
                    <div className="config-pills">
                      <span>Ratio: {ratio !== undefined ? ratio.toFixed(2) : 'unknown'}</span>
                      <span>Auto-cal: {autoCalOn ? 'enabled' : 'disabled'}</span>
                    </div>
                    <button
                      type="button"
                      style={buttonStyle('primary')}
                      data-testid="airspeed-cal-autocal"
                      disabled={!canApply || autoCalOn}
                      onClick={() => {
                        void (async () => {
                          try {
                            await runtime.setParameter('ARSPD_AUTOCAL', 1, UI_PARAMETER_WRITE_OPTIONS)
                            setAirspeedCalNotice({ tone: 'success', text: 'In-flight airspeed ratio auto-cal enabled (ARSPD_AUTOCAL=1).' })
                          } catch (error) {
                            setAirspeedCalNotice({ tone: 'danger', text: error instanceof Error ? error.message : 'Failed to write ARSPD_AUTOCAL.' })
                          }
                        })()
                      }}
                    >
                      {autoCalOn ? 'Auto-cal already enabled' : 'Enable in-flight ratio auto-cal'}
                    </button>
                    {blocked ? <p className="calibration-card__blocked">{blocked}</p> : null}
                    {airspeedCalNotice ? <p className="calibration-card__blocked">{airspeedCalNotice.text}</p> : null}
                    <details className="calibration-card__howto">
                      <summary>How to calibrate airspeed (ARSPD_AUTOCAL in flight)</summary>
                      <ol>
                        <li>Zero offset: every boot, with the pitot covered and the airframe in still air, the FC auto-calibrates the zero point. Power-cycle if you suspect a drifted offset.</li>
                        <li>Ratio: enable <code>ARSPD_AUTOCAL=1</code> here and fly a few minutes of normal cruise. ArduPlane converges ARSPD_RATIO against GPS ground speed automatically.</li>
                        <li>Disable ARSPD_AUTOCAL once the ratio is stable to lock the value in.</li>
                      </ol>
                    </details>
                  </article>
                )
              })()}

              {(() => {
                // Motor-spinning calibrations (CompassMot, ESC) — multirotor only,
                // and gated on the same props-off / restrained acknowledgements as
                // the motor test, plus connected + disarmed.
                if (!isCopterVehicle) {
                  return null
                }
                const motorSafetyOk = propsRemovedAcknowledged && testAreaAcknowledged
                const baseReady = snapshot.connection.kind === 'connected' && snapshot.vehicle?.armed !== true && busyAction === undefined
                // ESC endpoint calibration is a PWM-era procedure — the ESCs learn
                // min/max from the analog throttle-range pulses. It only applies to
                // MOT_PWM_TYPE Normal (0) / OneShot (1) / OneShot125 (2). DShot (4–7)
                // is digital with no endpoints; Brushed (3) and PWMRange/PWMAngle
                // (8/9) don't calibrate this way either — block all of them.
                const motPwmType = readRoundedParameter(snapshot, 'MOT_PWM_TYPE')
                const escCalUnsupported = motPwmType !== undefined && (motPwmType < 0 || motPwmType > 2)
                const escProtocolLabel = formatArducopterMotorPwmType(motPwmType)
                const escIsDShot = motPwmType !== undefined && motPwmType >= 4 && motPwmType <= 7
                const blockedBase = snapshot.connection.kind !== 'connected'
                  ? 'Connect to a vehicle first.'
                  : snapshot.vehicle?.armed
                    ? 'Disarm the vehicle first.'
                    : !motorSafetyOk
                      ? 'Acknowledge the motor-safety checks below first.'
                      : undefined
                return (
                  <>
                    {/* These acks gate EVERY motor-spinning action on this page,
                      * not just ESC calibration — the battery-current load spin
                      * uses them too. They used to be hidden whenever ESC cal was
                      * inapplicable (DShot/Brushed/PWMRange), which on any DShot
                      * build left the current-calibration card telling the
                      * operator to "acknowledge the checks below" with no
                      * checkboxes anywhere: permanently blocked. Always shown for
                      * a copter; the copy names whichever action still applies. */}
                    <article className="calibration-card calibration-card--danger" data-testid="calibration-card-motor-safety">
                        <div className="calibration-card__header">
                          <strong>Motor-spin safety</strong>
                          <StatusBadge tone={motorSafetyOk ? 'success' : 'warning'}>{motorSafetyOk ? 'acknowledged' : 'required'}</StatusBadge>
                        </div>
                        <p>
                          {escCalUnsupported
                            ? 'Applying a battery-current load spins the motors. Confirm before running it.'
                            : 'ESC calibration and the battery-current load both spin the motors. Confirm before running either.'}
                        </p>
                        <label className="scoped-checkbox-option">
                          <input type="checkbox" checked={propsRemovedAcknowledged} onChange={(e) => setPropsRemovedAcknowledged(e.target.checked)} data-testid="cal-props-ack" />
                          <span>All propellers are removed.</span>
                        </label>
                        <label className="scoped-checkbox-option">
                          <input type="checkbox" checked={testAreaAcknowledged} onChange={(e) => setTestAreaAcknowledged(e.target.checked)} data-testid="cal-area-ack" />
                          <span>The vehicle is restrained and the area is clear.</span>
                        </label>
                      </article>

                    {/* CompassMot was removed from the Calibration tab — the
                      * bench procedure (spin motors at fixed throttle, log
                      * the magnetic interference at that current) doesn't
                      * generalise well to a typical bench session (no real
                      * flight current draw, no real prop wash) and the
                      * operator-facing best practice is to use in-flight
                      * data instead. The runtime still exposes
                      * startCompassMotCalibration() in case a guided flow
                      * needs it later. */}

                    <article className="calibration-card" data-testid="calibration-card-esc">
                      <div className="calibration-card__header">
                        <strong>ESC calibration</strong>
                        <StatusBadge tone={escCalUnsupported ? 'neutral' : (escCalNotice?.tone ?? 'neutral')}>
                          {escCalUnsupported ? 'n/a' : escCalNotice ? (escCalNotice.tone === 'danger' ? 'failed' : 'armed') : 'idle'}
                        </StatusBadge>
                      </div>
                      {escCalUnsupported ? (
                        <div className="parameter-follow-up parameter-follow-up--warning" data-testid="esc-cal-unsupported">
                          <StatusBadge tone="neutral">not applicable</StatusBadge>
                          <p>
                            ESC endpoint calibration only applies to PWM / OneShot ESCs. This vehicle's motor output is
                            {' '}<strong>{escProtocolLabel}</strong> (<code>MOT_PWM_TYPE</code>)
                            {escIsDShot
                              ? ' — a digital protocol with no throttle endpoints to calibrate.'
                              : ' — which does not use throttle-endpoint calibration.'}
                            {' '}Change <code>MOT_PWM_TYPE</code> to a PWM/OneShot type in Motors if you truly need to calibrate analog ESCs.
                          </p>
                        </div>
                      ) : (
                        <>
                          <p>Calibrates the ESC throttle endpoints. Sets ESC_CALIBRATION=3 and reboots; on the next boot (safety off) the ESCs learn min/max from the throttle range. Reconnect after the reboot.</p>
                          {!escCalArmed ? (
                            <button
                              type="button"
                              style={buttonStyle('secondary')}
                              data-testid="esc-cal-arm"
                              disabled={!baseReady || !motorSafetyOk || !canApplyDraftParameters}
                              onClick={() => setEscCalArmed(true)}
                            >
                              Set ESC calibration mode
                            </button>
                          ) : (
                            <div className="setup-bench__dfu-confirm">
                              <button
                                type="button"
                                style={buttonStyle('secondary')}
                                className="setup-bench__dfu-danger"
                                data-testid="esc-cal-confirm"
                                onClick={() => {
                                  setEscCalArmed(false)
                                  void (async () => {
                                    try {
                                      await runtime.setParameter('ESC_CALIBRATION', 3, UI_PARAMETER_WRITE_OPTIONS)
                                      await runtime.reboot()
                                      setEscCalNotice({ tone: 'success', text: 'ESC_CALIBRATION=3 set and reboot sent. Reconnect, then raise throttle to complete on the bench.' })
                                    } catch (error) {
                                      setEscCalNotice({ tone: 'danger', text: error instanceof Error ? error.message : 'Failed to start ESC calibration.' })
                                    }
                                  })()
                                }}
                              >
                                Confirm: set + reboot
                              </button>
                              <button type="button" style={buttonStyle()} onClick={() => setEscCalArmed(false)}>Cancel</button>
                            </div>
                          )}
                          {blockedBase ? <p className="calibration-card__blocked">{blockedBase}</p> : null}
                          {escCalNotice ? <p className="calibration-card__blocked">{escCalNotice.text}</p> : null}
                          <details className="calibration-card__howto">
                            <summary>How to calibrate ESC throttle endpoints (PWM ESCs only)</summary>
                            <ol>
                              <li>Confirm props are off and the airframe is restrained.</li>
                              <li>Click <em>Set ESC calibration mode</em> then <em>Confirm: set + reboot</em> — the FC reboots with ESC_CALIBRATION=3 set.</li>
                              <li>On the next boot, raise the throttle stick to full, power-cycle the ESCs (or wait for the FC to drive max PWM), then drop to zero. ESCs learn the new endpoints from the pulse range.</li>
                              <li>Reconnect once the ESCs finish their startup chime. Skip entirely for DShot ESCs — they don't need endpoint calibration.</li>
                            </ol>
                          </details>
                        </>
                      )}
                    </article>
                  </>
                )
              })()}

              {/* Thermal calibration (TCAL) — Expert-only advanced surface. */}
              {isExpertMode ? (
                <TcalCalibrationCard
                  snapshot={snapshot}
                  canApplyDraftParameters={canApplyDraftParameters}
                  busyAction={busyAction}
                  setDraft={setDraft}
                />
              ) : null}

              {/* Baro thrust calibration (VALT) — Expert-only, log-based. The
                * card fits against a downward rangefinder in the log when present,
                * and otherwise against a manually-entered hover height, so it no
                * longer requires a rangefinder to be configured. Shows n/a on
                * firmware without BARO1_THST_SCALE. */}
              {isExpertMode ? (
                <ValtCalibrationCard
                  snapshot={snapshot}
                  canApplyDraftParameters={canApplyDraftParameters}
                  busyAction={busyAction}
                  setDraft={setDraft}
                />
              ) : null}
            </div>
          </Panel>
        </section>

  )
}
