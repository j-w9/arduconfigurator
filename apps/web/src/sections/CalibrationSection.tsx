// CalibrationSection — App.tsx's `activeViewId === 'calibration'` block,
// lifted into its own component. Accelerometer / level / compass guided
// actions + battery voltage / battery current / airspeed / ESC throttle
// calibration cards. ~470 lines of inline JSX moved verbatim.

import { useEffect, useRef, useState, type ReactElement } from 'react'
import type { ConfiguratorSnapshot, AirframeSummary } from '@arduconfig/ardupilot-core'
import type { ArduPilotConfiguratorRuntime, ParameterWriteOptions } from '@arduconfig/ardupilot-core'
import { EXPERT_MAX_MOTOR_TEST_DURATION_SECONDS, MAX_MOTOR_TEST_DURATION_SECONDS } from '@arduconfig/ardupilot-core'
import {
  computeCurrentOffset,
  computeCurrentPerVolt,
  loadPointIsWeak,
  summariseLoadCurrent
} from '../view-models/battery-current-offset'
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
  /** Signed in to a log server: the baro thrust (VALT) calibration is gated on it. */
  logServerSignedIn: boolean
  /** Where they are signed in, shown on the VALT card. */
  logServerLabel?: string
  clearDraft: (paramId: string) => void
  setParameterNotice: (notice: ParameterNotice | undefined) => void
  handleGuidedAction: (actionId: GuidedActionId) => void | Promise<void>
  handleCancelGuidedAction: (actionId: GuidedActionId) => void
}

/**
 * What each guided calibration actually needs after it succeeds, taken from
 * ArduPilot rather than from habit.
 *
 * Accelerometer and compass both set a latch the firmware itself refuses to arm
 * past: AP_InertialSensor::_acal_event_success sets `_accel_cal_requires_reboot`
 * and Compass::_start_calibration sets `_cal_requires_reboot`, which AP_Arming
 * turns into "Accels calibrated requires reboot" / "Compass calibrated requires
 * reboot" (AP_Arming.cpp:529, :616). An operator who finishes a calibration and
 * walks away has a vehicle that will not arm and no obvious reason why.
 *
 * Level is different and is NOT presented as required: calibrate_trim() ends at
 * AP_AHRS::set_trim -> _trim.set_and_save, so the trim is persisted and live
 * immediately, and no reboot latch is set. Saying "reboot required" there would
 * be teaching a superstition.
 */
const CALIBRATION_REBOOT_ADVICE: Partial<
  Record<GuidedActionId, { required: boolean; reason: string; promptOn: ReadonlyArray<'succeeded' | 'failed'> }>
> = {
  'calibrate-accelerometer': {
    required: true,
    // _accel_cal_requires_reboot is set in _acal_event_success, so only a
    // completed calibration latches it.
    promptOn: ['succeeded'],
    reason:
      'ArduPilot will not arm until the board reboots — its pre-arm check reports "Accels calibrated requires reboot" until then.'
  },
  'calibrate-compass': {
    required: true,
    // Compass is different, and getting this wrong left the worst version of
    // the original bug in place. Compass::_start_calibration sets
    // _cal_requires_reboot when the calibrator thread is CREATED
    // (AP_Compass_Calibration.cpp:125) — before any outcome — and nothing ever
    // clears it. So merely starting a compass calibration and then cancelling
    // it leaves the vehicle refusing to arm. Prompt on failure and cancellation
    // too; cancelAction routes through failAction, so 'failed' covers both.
    promptOn: ['succeeded', 'failed'],
    reason:
      'ArduPilot will not arm until the board reboots — its pre-arm check reports "Compass calibrated requires reboot" until then. Starting a compass calibration sets this even if it did not finish.'
  },
  'calibrate-level': {
    required: false,
    promptOn: ['succeeded'],
    reason:
      'Not required: the level trim is saved to AHRS_TRIM_X / AHRS_TRIM_Y and takes effect immediately. Reboot only if you want to confirm it from a cold start.'
  }
}

/**
 * Post-calibration reboot prompt. Dismissable, and keyed on the completion
 * timestamp by the caller so a later run of the same calibration re-raises it
 * rather than inheriting the previous dismissal.
 */
function CalibrationRebootPrompt(props: {
  actionId: GuidedActionId
  runtime: ArduPilotConfiguratorRuntime
  connected: boolean
  onDismiss: () => void
}): ReactElement | null {
  const advice = CALIBRATION_REBOOT_ADVICE[props.actionId]
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string>()
  if (!advice) {
    return null
  }
  return (
    <div
      className={`calibration-card__reboot${advice.required ? ' is-required' : ''}`}
      data-testid={`calibration-reboot-${props.actionId}`}
      data-required={advice.required ? 'true' : 'false'}
    >
      <p>
        <strong>{advice.required ? 'Reboot the autopilot' : 'Reboot the autopilot?'}</strong> {advice.reason}
      </p>
      {error ? <p className="calibration-card__blocked">{error}</p> : null}
      <div className="calibration-card__reboot-actions">
        <button
          type="button"
          style={buttonStyle(advice.required ? 'primary' : undefined)}
          data-testid={`calibration-reboot-run-${props.actionId}`}
          disabled={sending || !props.connected}
          onClick={() => {
            setSending(true)
            setError(undefined)
            void runtimeReboot(props.runtime)
              .then(() => props.onDismiss())
              .catch((cause: unknown) => {
                setError(cause instanceof Error ? cause.message : 'Reboot request failed.')
                setSending(false)
              })
          }}
        >
          {sending ? 'Rebooting…' : 'Reboot now'}
        </button>
        <button
          type="button"
          style={buttonStyle()}
          data-testid={`calibration-reboot-dismiss-${props.actionId}`}
          onClick={props.onDismiss}
        >
          {advice.required ? 'Later' : 'No thanks'}
        </button>
      </div>
      {advice.required ? (
        <p className="calibration-card__reboot-note">The link will drop; reconnect once the board comes back up.</p>
      ) : null}
    </div>
  )
}

/** Kept separate so the prompt stays a pure render of one runtime call. */
async function runtimeReboot(runtime: ArduPilotConfiguratorRuntime): Promise<void> {
  await runtime.reboot()
}

/** Load-spin duration for battery-current calibration. Pinned to the shared
 *  motor-test cap: the card used to hardcode 8 s, which every non-Expert
 *  session rejected outright with "Duration must stay between ...", so the
 *  button could never work. */
const BATTERY_CURRENT_LOAD_SECONDS = MAX_MOTOR_TEST_DURATION_SECONDS

/**
 * The two motor-spin acknowledgements, rendered next to whichever control
 * they gate.
 *
 * They used to live in one standalone "Motor-spin safety" card beside the
 * cards whose buttons they unlocked, and operators did not connect the two:
 * the button that would not run was in one box and the reason was in another.
 * Colouring the button and naming the card in the hint helped but did not fix
 * the adjacency, so the widget now goes where the action is.
 *
 * Presentation is duplicated; STATE IS NOT. Both copies are controlled by the
 * single `propsRemovedAcknowledged` / `testAreaAcknowledged` pair from
 * `useSafetyAcks`, so ticking either copy ticks all of them and every gate
 * (here, the motor test, the reorder dialog) still reads one truth. A second
 * copy of the state would let one surface look armed while another gate it
 * shares is still closed.
 */
function MotorSpinAcknowledgements(props: {
  propsRemovedAcknowledged: boolean
  setPropsRemovedAcknowledged: (value: boolean) => void
  testAreaAcknowledged: boolean
  setTestAreaAcknowledged: (value: boolean) => void
  /** Prefix for the two checkbox test ids — each copy needs unique hooks. */
  testIdPrefix: string
}): ReactElement {
  // Deliberately minimal: two checkboxes on one line, short labels, no card,
  // heading or badge. Sitting directly against the button supplies the context
  // the old standalone card's long sentences were compensating for.
  return (
    <div className="motor-spin-acks" data-testid={`${props.testIdPrefix}-motor-acks`}>
      <label>
        <input
          type="checkbox"
          checked={props.propsRemovedAcknowledged}
          onChange={(event) => props.setPropsRemovedAcknowledged(event.target.checked)}
          data-testid={`${props.testIdPrefix}-props-ack`}
        />
        <span>Props removed</span>
      </label>
      <label>
        <input
          type="checkbox"
          checked={props.testAreaAcknowledged}
          onChange={(event) => props.setTestAreaAcknowledged(event.target.checked)}
          data-testid={`${props.testIdPrefix}-area-ack`}
        />
        <span>Area clear, craft restrained</span>
      </label>
    </div>
  )
}

export function CalibrationSection(props: CalibrationSectionProps): ReactElement {
  // Throttle used for the current-calibration load spin. Local to this card:
  // it is a transient bench choice, not something worth persisting.
  const [currentCalThrottlePercent, setCurrentCalThrottlePercent] = useState('20')
  /**
   * Load duration, operator-set.
   *
   * Was pinned to the motor-test cap, which is a SAFETY ceiling rather than a
   * sensible default for this procedure: the operator has to read a clamp
   * meter and type the value, and the motors stopped before they could.
   */
  const [currentCalLoadSeconds, setCurrentCalLoadSeconds] = useState(String(BATTERY_CURRENT_LOAD_SECONDS))
  /**
   * Reported current CAPTURED during the load, not read live at click time.
   *
   * The per-volt fit needs the reported value from the moment the meter was
   * read. Reading it live meant that once the motors stopped it fell to idle,
   * the ratio became noise, and Apply went dead unless the field was re-edited
   * mid-spin -- which is exactly the reported bug.
   */
  const [capturedLoadCurrentA, setCapturedLoadCurrentA] = useState<number | undefined>(undefined)
  /** Idle draw recorded just before the load, for the weak-point warning. */
  const [capturedIdleCurrentA, setCapturedIdleCurrentA] = useState<number | undefined>(undefined)
  /** How many samples the capture rests on, so the operator can judge it. */
  const [capturedSampleCount, setCapturedSampleCount] = useState(0)
  /** Wall-clock end of the load spin, for the countdown. */
  const [loadEndsAtMs, setLoadEndsAtMs] = useState<number | undefined>(undefined)
  const [loadSecondsLeft, setLoadSecondsLeft] = useState<number | undefined>(undefined)
  /** Focused the moment the capture lands, so the meter value can just be typed. */
  const measuredCurrentInputRef = useRef<HTMLInputElement | null>(null)
  /** Step 1 done, so the flow can show its own progress. */
  const [offsetWritten, setOffsetWritten] = useState(false)
  /** Every reported current seen during the load; summarised when it ends. */
  const loadSamplesRef = useRef<number[]>([])
  const loadSamplerRef = useRef<number | undefined>(undefined)
  /** What the operator's meter reads for the offset step. 0 = pack off. */
  const [offsetActualCurrent, setOffsetActualCurrent] = useState('0')
  /**
   * Live reported current, mirrored into a ref.
   *
   * The capture runs from a timer started when the load began, so it must read
   * the value as of when it FIRES. Closing over the render-time value would
   * capture the idle current from before the motors spun -- the exact opposite
   * of what the fit needs.
   */
  const reportedCurrentRef = useRef<number | undefined>(undefined)
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
    logServerSignedIn,
    logServerLabel,
    clearDraft,
    setParameterNotice,
    handleGuidedAction,
    handleCancelGuidedAction
  } = props
  // A load sampler left running after the card unmounts would keep pushing
  // into a ref nobody reads, and would fire setState on a dead component.
  useEffect(() => () => window.clearInterval(loadSamplerRef.current), [])

  // Count the spin down. Knowing when to look at the meter is most of what
  // made this procedure awkward to do alone: the operator was watching a
  // button that said "Motors spinning…" with no idea how long was left.
  useEffect(() => {
    if (loadEndsAtMs === undefined) {
      setLoadSecondsLeft(undefined)
      return
    }
    const tick = (): void => {
      const remaining = Math.max(0, Math.ceil((loadEndsAtMs - Date.now()) / 1000))
      setLoadSecondsLeft(remaining)
      if (remaining === 0) {
        setLoadEndsAtMs(undefined)
      }
    }
    tick()
    const timer = window.setInterval(tick, 250)
    return () => window.clearInterval(timer)
  }, [loadEndsAtMs])

  // The moment the capture lands, put the cursor where the meter value goes.
  // Otherwise the operator puts the meter down, comes back, and has to hunt
  // for the field before the number they memorised goes stale.
  useEffect(() => {
    if (capturedLoadCurrentA !== undefined) {
      measuredCurrentInputRef.current?.focus()
    }
  }, [capturedLoadCurrentA])

  // Mirror the live reported current so the capture timer reads it as of when
  // it FIRES, not as of the render that scheduled it.
  useEffect(() => {
    const telemetry = snapshot.liveVerification.batteryTelemetry
    reportedCurrentRef.current = telemetry.verified ? telemetry.currentA : undefined
  }, [snapshot.liveVerification.batteryTelemetry])

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

  /**
   * Both motor-spin acknowledgements, named once.
   *
   * The gate, the button's colour and the hint text must agree — they were
   * three separate spellings of the same condition, which is how a button that
   * could not run ended up looking exactly like one that could.
   */
  const motorSpinReady = propsRemovedAcknowledged && testAreaAcknowledged

  /**
   * Dismissed reboot prompts, keyed `${actionId}:${completedAtMs}`. Keying on
   * the completion stamp rather than the action id is what makes a second run
   * of the same calibration prompt again — a dismissal answers one calibration,
   * not the calibration type forever.
   */
  const [dismissedRebootPrompts, setDismissedRebootPrompts] = useState<ReadonlySet<string>>(() => new Set())

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
                // Undefined unless this calibration has a completed run whose
                // prompt is still unanswered. `completedAtMs` is cleared when a
                // calibration restarts, so a re-run cannot show a stale prompt.
                const rebootAdvice = CALIBRATION_REBOOT_ADVICE[action.actionId]
                const rebootPromptKey =
                  rebootAdvice !== undefined &&
                  (actionState.status === 'succeeded' || actionState.status === 'failed') &&
                  rebootAdvice.promptOn.includes(actionState.status) &&
                  actionState.completedAtMs !== undefined
                    ? `${action.actionId}:${actionState.completedAtMs}`
                    : undefined
                const pendingRebootPromptKey =
                  rebootPromptKey !== undefined && !dismissedRebootPrompts.has(rebootPromptKey)
                    ? rebootPromptKey
                    : undefined
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
                    {pendingRebootPromptKey !== undefined ? (
                      <CalibrationRebootPrompt
                        actionId={action.actionId}
                        runtime={runtime}
                        connected={snapshot.connection.kind === 'connected'}
                        onDismiss={() =>
                          setDismissedRebootPrompts((current) => new Set(current).add(pendingRebootPromptKey))
                        }
                      />
                    ) : null}
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
                    {/* One line stays visible so the card still says what it is
                      * at a glance; the formula and the "which meter, measured
                      * under load" advice fold away by default. They are worth
                      * reading once and then never again, and at full length
                      * they pushed the actual controls (and the safety gate)
                      * below the fold. Same disclosure pattern as the how-to and
                      * manual-value blocks further down this card. */}
                    <p>Makes reported current match a meter. Needs a reference reading taken under a steady load.</p>
                    <details className="calibration-card__howto">
                      <summary>What this calibrates, and what you need to measure it</summary>
                      <p>Calibrates the analog current sensor: <code>amps = (sensor_voltage − BATT_AMP_OFFSET) × BATT_AMP_PERVLT</code>. Offset is the sensor voltage at 0 A; per-volt is amps per volt of sensor output.</p>
                      <p className="calibration-card__tip">
                        You need a reference reading to calibrate against. An inline watt/current meter between the
                        pack and the craft is the easiest option — e.g. a ToolkitRC (WM series) or a Turnigy/HobbyKing
                        inline meter; a DC clamp meter around the positive lead works too and avoids breaking the
                        circuit. Take the reading under a steady load, not at idle: the per-volt fit is
                        measured&nbsp;÷&nbsp;reported at one operating point, and near 0&nbsp;A that ratio is mostly noise.
                      </p>
                    </details>
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
                      // The offset is calibrated against what the operator's
                      // METER reads, not against an assumption that the true
                      // current is zero. Zero is simply the common case (pack
                      // off, board on USB) rather than a precondition, which is
                      // why there is no longer a pack-connected refusal.
                      const offsetResult = computeCurrentOffset({
                        offsetV: currentOffset,
                        perVolt: currentPerVolt,
                        reportedA,
                        actualA: Number.parseFloat(offsetActualCurrent)
                      })
                      // The cap the runtime will actually enforce. Surfaced so
                      // the input cannot promise a duration that gets thrown
                      // out before it reaches the flight controller.
                      // No ceiling on this path by operator request, so
                      // there is no cap to surface -- but a long all-motor
                      // spin is worth naming out loud, because it is the one
                      // action here that runs every motor at once.
                      const loadSecondsValue = Number.parseFloat(currentCalLoadSeconds)
                      const measuredA = Number.parseFloat(batteryMeasuredCurrent)
                      // Against the CAPTURED load current, so typing the meter
                      // value after the motors stop still works.
                      const perVoltResult = computeCurrentPerVolt({
                        perVolt: currentPerVolt,
                        reportedA: capturedLoadCurrentA,
                        measuredA
                      })
                      return (
                        <div className="guided-current-cal" data-testid="battery-current-guided">
                          {/* Three numbered steps rather than a flat row of
                            * controls. The procedure has a required order --
                            * zero the offset, load the pack, match the meter --
                            * and the flat layout neither said so nor showed how
                            * far through it you were, which is what made it
                            * awkward to do single-handed. */}
                          <ol className="guided-current-cal__steps">
                          <li className="guided-current-cal__step" data-testid="battery-current-step-offset">
                          <div className="guided-current-cal__step-title">
                            <strong>1 · Zero it at no load</strong>
                            {offsetWritten ? <StatusBadge tone="success">done</StatusBadge> : null}
                          </div>
                          <p className="hint">
                            Nothing drawing current — pack off, or the craft idle. Type what your meter reads (0 with
                            the pack disconnected) and set the offset.
                          </p>
                          <div className="switch-exercise-controls">
                            <label className="scoped-editor-field scoped-editor-field--compact">
                              <span>Meter reads (A)</span>
                              <input
                                type="number"
                                step="0.1"
                                min="0"
                                inputMode="decimal"
                                value={offsetActualCurrent}
                                onChange={(event) => setOffsetActualCurrent(event.target.value)}
                                data-testid="battery-current-offset-actual"
                                title="What your clamp meter reads right now. 0 with the pack disconnected; a real value (e.g. 0.4) is equally valid."
                              />
                            </label>
                            <button
                              type="button"
                              style={buttonStyle()}
                              data-testid="battery-current-zero-offset"
                              title={offsetResult.ok ? undefined : offsetResult.reason}
                              disabled={!canGuide || !offsetResult.ok}
                              onClick={() => {
                                if (!offsetResult.ok) return
                                void (async () => {
                                  try {
                                    await runtime.setParameter('BATT_AMP_OFFSET', Number(offsetResult.offsetV.toFixed(4)), UI_PARAMETER_WRITE_OPTIONS)
                                    setOffsetWritten(true)
                                    setBatteryCalNotice({
                                      tone: 'success',
                                      text: `BATT_AMP_OFFSET set to ${offsetResult.offsetV.toFixed(3)} V — reported current shifts by ${offsetResult.shiftA.toFixed(2)} A to match your meter. Next: put a load on the pack.`
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
                              Set offset ({reportedA !== undefined ? `${reportedA.toFixed(2)} A` : '—'} → {offsetActualCurrent || '0'} A)
                            </button>
                          </div>
                          {!offsetResult.ok ? (
                            <p className="switch-exercise-warning" data-testid="battery-current-zero-blocked">
                              {offsetResult.reason}
                            </p>
                          ) : null}
                          </li>

                          <li className="guided-current-cal__step" data-testid="battery-current-step-load">
                          <div className="guided-current-cal__step-title">
                            <strong>2 · Put a real load on it</strong>
                            {capturedLoadCurrentA !== undefined ? <StatusBadge tone="success">captured</StatusBadge> : null}
                          </div>
                          <p className="hint">
                            The gain is fitted from one loaded reading, so the load has to be big enough to matter.
                            Props off. Have the meter in view before you start — the spin counts down.
                          </p>
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
                                <span>Load seconds</span>
                                <input
                                  type="number"
                                  min="1"
                                  step="1"
                                  inputMode="numeric"
                                  value={currentCalLoadSeconds}
                                  onChange={(event) => setCurrentCalLoadSeconds(event.target.value)}
                                  data-testid="battery-current-load-seconds"
                                  title="How long the motors run. Not capped here — long enough to read your meter."
                                />
                              </label>
                              {/* The cap is lifted on this path, so the length
                                  is the operator's to choose. Say what a long
                                  one means rather than silently accepting it:
                                  this is the only action that spins every
                                  motor simultaneously. */}
                              {Number.isFinite(loadSecondsValue) && loadSecondsValue > EXPERT_MAX_MOTOR_TEST_DURATION_SECONDS ? (
                                <p className="switch-exercise-warning" data-testid="battery-current-load-long">
                                  {`All motors will spin together for ${loadSecondsValue}s — longer than the ${EXPERT_MAX_MOTOR_TEST_DURATION_SECONDS}s motor-test ceiling. Props off, and keep the stop control within reach.`}
                                </p>
                              ) : null}
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
                              {/* The gate, inline, immediately above the button
                                *  it unlocks — same shared state as every other
                                *  motor-spinning action, just rendered here so
                                *  the operator reads "confirm these, then press
                                *  this" without leaving the card. Legacy
                                *  cal-props-ack / cal-area-ack test ids stay on
                                *  this copy. */}
                              <MotorSpinAcknowledgements
                                propsRemovedAcknowledged={propsRemovedAcknowledged}
                                setPropsRemovedAcknowledged={setPropsRemovedAcknowledged}
                                testAreaAcknowledged={testAreaAcknowledged}
                                setTestAreaAcknowledged={setTestAreaAcknowledged}
                                testIdPrefix="cal"
                              />
                              {/* Green once the safety checks are acknowledged.
                                *  The button sat in the neutral style whether or
                                *  not it was armed to run, so "have I done the
                                *  thing that lets me press this?" was not
                                *  answerable from the button. Same grammar as
                                *  "Calibrate from measured current" below it,
                                *  which is green when it can run. */}
                              <button
                                type="button"
                                style={buttonStyle(motorSpinReady ? 'primary' : 'secondary')}
                                data-testid="battery-current-spin-motors"
                                disabled={
                                  busyAction !== undefined ||
                                  snapshot.connection.kind !== 'connected' ||
                                  snapshot.vehicle?.armed === true ||
                                  !motorSpinReady ||
                                  snapshot.motorTest.status === 'requested' ||
                                  snapshot.motorTest.status === 'running'
                                }
                                onClick={() => {
                                  const throttlePercent = Number.parseFloat(currentCalThrottlePercent)
                                  const loadSeconds = Number.parseFloat(currentCalLoadSeconds)
                                  if (!Number.isFinite(throttlePercent) || throttlePercent <= 0) {
                                    return
                                  }
                                  if (!Number.isFinite(loadSeconds) || loadSeconds <= 0) {
                                    return
                                  }
                                  void (async () => {
                                    try {
                                      setCapturedLoadCurrentA(undefined)
                                      // Idle first: the fit is only as good as
                                      // the difference between this and the
                                      // loaded reading.
                                      setCapturedIdleCurrentA(reportedCurrentRef.current)
                                      loadSamplesRef.current = []
                                      setCapturedSampleCount(0)
                                      window.clearInterval(loadSamplerRef.current)
                                      await runtime.runMotorTest(
                                        {
                                          runAllOutputsSimultaneous: true,
                                          throttlePercent,
                                          durationSeconds: loadSeconds
                                        },
                                        // Without this the card was capped at the
                                        // basic 5 s even for an Expert operator,
                                        // because the option defaults to false --
                                        // so a longer duration was accepted by the
                                        // input and then rejected by the runtime.
                                        // Operator-requested: this path is not
                                        // bound by the motor-test duration
                                        // ceiling, because the load has to be
                                        // held long enough to read a clamp
                                        // meter. Every other guard -- props
                                        // off, test area, disarmed, connected,
                                        // outputs mapped -- still applies.
                                        { expertMode: isExpertMode, uncappedDuration: true }
                                      )
                                      // Sample throughout the run and take the
                                      // median of the settled window, rather
                                      // than one instantaneous reading partway
                                      // through: current telemetry is noisy,
                                      // and every bit of that noise lands in
                                      // BATT_AMP_PERVLT, which then scales
                                      // every current the vehicle reports.
                                      // Captured rather than read live at Apply
                                      // time, so typing the meter value after
                                      // the motors stop still calibrates.
                                      loadSamplerRef.current = window.setInterval(() => {
                                        const sample = reportedCurrentRef.current
                                        if (sample !== undefined) {
                                          loadSamplesRef.current.push(sample)
                                        }
                                      }, 200)
                                      window.setTimeout(
                                        () => {
                                          window.clearInterval(loadSamplerRef.current)
                                          loadSamplerRef.current = undefined
                                          setCapturedSampleCount(loadSamplesRef.current.length)
                                          setCapturedLoadCurrentA(
                                            summariseLoadCurrent(loadSamplesRef.current) ?? reportedCurrentRef.current
                                          )
                                        },
                                        // Stop just before the motors do, so a
                                        // spin-down reading cannot enter the set.
                                        Math.max(loadSeconds * 1000 - 500, 500)
                                      )
                                      setLoadEndsAtMs(Date.now() + loadSeconds * 1000)
                                      setBatteryCalNotice({
                                        tone: 'warning',
                                        text: `Spinning all motors at ${throttlePercent}% for ${loadSeconds} s — read your meter now. What you type stays usable after the motors stop.`
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
                                {snapshot.motorTest.status === 'running' ? 'Motors spinning…' : `Spin motors for ${currentCalLoadSeconds} s`}
                              </button>
                              {!motorSpinReady ? (
                                <small>
                                  Tick both boxes above before applying a load. This button turns green when it
                                  can run.
                                </small>
                              ) : null}
                              {/* While the motors run: what the vehicle reports,
                                * and how long is left to read the meter. The
                                * button alone said "Motors spinning…" with no
                                * clock, so the one time-critical action in the
                                * procedure had no timer against it. */}
                              {loadSecondsLeft !== undefined && loadSecondsLeft > 0 ? (
                                <p className="guided-current-cal__live" data-testid="battery-current-live">
                                  <strong>Read your meter now.</strong> FC reads{' '}
                                  {reportedA !== undefined ? `${reportedA.toFixed(2)} A` : '—'} · {loadSecondsLeft} s left
                                </p>
                              ) : null}
                              {capturedLoadCurrentA !== undefined ? (
                                <p className="guided-current-cal__captured" data-testid="battery-current-captured">
                                  Captured {capturedLoadCurrentA.toFixed(2)} A
                                  {capturedSampleCount > 0 ? ` — median of ${capturedSampleCount} readings` : ''}
                                  {capturedIdleCurrentA !== undefined
                                    ? `, against ${capturedIdleCurrentA.toFixed(2)} A at idle`
                                    : ''}
                                  .
                                </p>
                              ) : null}
                            </div>
                          ) : null}
                          </li>

                          <li className="guided-current-cal__step" data-testid="battery-current-step-match">
                          <div className="guided-current-cal__step-title">
                            <strong>3 · Match your meter</strong>
                          </div>
                          <p className="hint">
                            {capturedLoadCurrentA === undefined
                              ? 'Run the load above first — there is nothing to match against yet.'
                              : 'Type what your meter read during that spin. The field is already focused.'}
                          </p>
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
                              ref={measuredCurrentInputRef}
                            />
                          </label>
                          {perVoltResult.ok ? (
                            <>
                              {/* The old wording named the number it was fed
                                * ("from 2.22 A under load"), which reads as a
                                * claim about the result. Say what applying it
                                * does instead. */}
                              <small data-testid="battery-current-pervolt-preview">
                                New per-volt: {perVoltResult.perVolt.toFixed(2)} A/V — the FC would read{' '}
                                {Number.parseFloat(batteryMeasuredCurrent).toFixed(2)} A where it read{' '}
                                {capturedLoadCurrentA?.toFixed(2)} A under this load.
                              </small>
                              {loadPointIsWeak(capturedIdleCurrentA, capturedLoadCurrentA) ? (
                                <small className="switch-exercise-warning" data-testid="battery-current-weak-point">
                                  That load barely moved the current above the {capturedIdleCurrentA?.toFixed(2)} A the
                                  aircraft draws standing still, so this ratio mostly reflects the offset rather than
                                  the gain. Zero the offset first, then load it harder — more throttle, or a longer
                                  spin — before trusting the per-volt.
                                </small>
                              ) : null}
                            </>
                          ) : (
                            <small className="switch-exercise-warning">{perVoltResult.reason}</small>
                          )}
                          <button
                            type="button"
                            style={buttonStyle('primary')}
                            data-testid="battery-current-calibrate-pervlt"
                            disabled={!canGuide || !perVoltResult.ok}
                            onClick={() => {
                              if (!perVoltResult.ok) return
                              void (async () => {
                                try {
                                  await runtime.setParameter('BATT_AMP_PERVLT', Number(perVoltResult.perVolt.toFixed(4)), UI_PARAMETER_WRITE_OPTIONS)
                                  setBatteryCalNotice({ tone: 'success', text: `BATT_AMP_PERVLT set to ${perVoltResult.perVolt.toFixed(2)} A/V.` })
                                  setBatteryMeasuredCurrent('')
                                  setCapturedLoadCurrentA(undefined)
                                  setCapturedSampleCount(0)
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
                          </li>
                          </ol>
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
                const motorSafetyOk = motorSpinReady
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
                      ? 'Acknowledge the motor-safety checks above first.'
                      : undefined
                return (
                  <>
                    {/* The standalone "Motor-spin safety" card that used to sit
                      * here is gone. It carried the acknowledgements for BOTH
                      * motor-spinning actions on this page (ESC calibration and
                      * the battery-current load spin) from a third box, which is
                      * exactly what confused operators: the gate and the button
                      * it gates were never in the same place. Each action now
                      * renders its own copy of the checkbox pair next to its own
                      * button, off the same shared state, so an action can no
                      * longer be blocked by something the operator cannot see.
                      * Nothing else depended on the card: the acks themselves
                      * live in useSafetyAcks and are also rendered by the Motors
                      * view and the motor-reorder dialog, which have always drawn
                      * their own widgets. */}

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
                          {/* Second copy of the same shared acknowledgements —
                            *  this card spins motors too, so the gate belongs
                            *  next to its own button rather than in a card the
                            *  operator has to go find. */}
                          <MotorSpinAcknowledgements
                            propsRemovedAcknowledged={propsRemovedAcknowledged}
                            setPropsRemovedAcknowledged={setPropsRemovedAcknowledged}
                            testAreaAcknowledged={testAreaAcknowledged}
                            setTestAreaAcknowledged={setTestAreaAcknowledged}
                            testIdPrefix="esc-cal"
                          />
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

              {/* Baro thrust calibration (VALT) — Expert-only, log-based, and
                * only offered with a log server signed in: the whole input is a
                * flight log, and the scale is only as good as the hover behind
                * it, so the log that produced a number stays retrievable. Signed
                * out there is no card, not a locked one. The card fits against a
                * downward rangefinder in the log when present, otherwise against
                * a manually-entered hover height, so it does not require a
                * rangefinder to be configured. Shows n/a on firmware without
                * BARO1_THST_SCALE. */}
              {isExpertMode && logServerSignedIn ? (
                <ValtCalibrationCard
                  snapshot={snapshot}
                  canApplyDraftParameters={canApplyDraftParameters}
                  busyAction={busyAction}
                  setDraft={setDraft}
                  logServerLabel={logServerLabel}
                />
              ) : null}
            </div>
          </Panel>
        </section>

  )
}
