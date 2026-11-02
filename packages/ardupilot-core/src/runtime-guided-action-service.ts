import type { GuidedActionId } from '@arduconfig/param-metadata'
import type {
  CommandAckMessage,
  CommandLongMessage,
  MagCalProgressMessage,
  MagCalReportMessage,
  MavlinkSession
} from '@arduconfig/protocol-mavlink'
import { MAV_CMD, MAV_RESULT } from '@arduconfig/protocol-mavlink'

import {
  ACCELEROMETER_POSE_ALIGNED_DEG,
  ACCELEROMETER_POSE_ORDER,
  attitudeDeltaDegrees,
  normalizeSignedDegrees,
  poseErrorDegrees
} from './accelerometer-pose.js'
import {
  ACCELEROMETER_CALIBRATION_STEPS,
  GUIDED_ACTION_IDS,
  appendGuidedActionText,
  buildAccelerometerCalibrationGuidedAction,
  createIdleGuidedAction,
  createIdleGuidedActions,
  defaultInstructionsForAction,
  describeMissingCompass,
  enabledCompassCountFromParameters,
  hasActiveGuidedAction,
  matchGuidedActionText
} from './runtime-helpers.js'
import type {
  GuidedActionState,
  ParameterState,
  ParameterSyncState,
  StatusTextEntry,
  VehicleIdentity
} from './types.js'

const DEFAULT_ACCELEROMETER_INITIAL_WARMUP_MS = 6000
const DEFAULT_ACCELEROMETER_STEP_ADVANCE_MS = 1500
const DEFAULT_ACCELEROMETER_COMPLETION_FALLBACK_MS = 4000
const DEFAULT_COMPASS_GUIDANCE_TIMEOUT_MS = 5000
// No-traffic watchdog for a compass cal that already produced progress or a
// partial report set. Sized far above any human pause (mag cal is
// human-paced) so it only fires when the terminal MAG_CAL_REPORTs were lost,
// which would otherwise leave the action 'running' and write-block forever.
const DEFAULT_COMPASS_REPORT_WATCHDOG_MS = 90000
// Auto-confirm: once the frame is inside the pose's acceptance window it must
// also HOLD there this long before the posture is recorded. The operator's hand
// is still on the frame when it first arrives, and sampling mid-settle is
// exactly how a calibration ends up subtly wrong — this is the "hold still"
// beat, not a cosmetic delay.
const DEFAULT_ACCELEROMETER_AUTO_HOLD_MS = 1200
// How far the frame may drift during that hold and still count as still.
//
// 15 degrees, after 3 and then 6 both proved too tight on real hardware: a
// hand-held frame kept restarting the hold, so the auto-progression that exists
// to save the operator a click did not fire and they clicked anyway.
//
// This sits deliberately close to ACCELEROMETER_POSE_ALIGNED_DEG (17), which
// makes the drift check nearly vestigial -- and that is the point. Correctness
// is guaranteed by the ALIGNMENT check, not by this one: every sample is
// re-tested against the pose target on arrival, and a frame that leaves the
// 17-degree window clears the hold outright a few lines below. So whatever this
// value is, the captured sample is always within 17 degrees of the posture that
// was asked for, and ArduPilot's own calibration tolerates roughly 20. What
// this now does is the narrower job it should always have had: stop a capture
// landing mid-movement, without second-guessing a steady hand.
const ACCELEROMETER_AUTO_STILL_DEG = 15

const ACCELCAL_SUCCESS_VALUE = 16777215
const ACCELCAL_FAILED_VALUE = 16777216

// PREFLIGHT_CALIBRATION param5=1 is acknowledged only AFTER a blocking gyro
// calibration (GCS_Common.cpp _handle_command_preflight_calibration:
// calibrate_gyros() then acal start(), under EXPECT_DELAY_MS(30000)). On a
// still vehicle that is ~1 s; a vehicle that is being handled, or a board
// with slow-to-converge gyros, takes many seconds. Same budget as level cal.
const ACCELEROMETER_START_ACK_TIMEOUT_MS = 15000
// If the ack still misses that budget, the autopilot may nevertheless go on
// to start the calibration (the handler was merely slow). A late ACCEPTED
// ack or a first pose prompt inside this window resumes the action instead
// of leaving the operator with a 'failed' card while the vehicle is asking
// for poses. Deliberate: before the 'running'-only gate this happened by
// accident, because 'failed' was not excluded.
const DEFAULT_ACCELEROMETER_LATE_START_RESUME_WINDOW_MS = 15000
// No-prompt watchdog for a running accel cal. While it waits for a posture
// AP_AccelCal re-sends ACCELCAL_VEHICLE_POS every second
// (AP_ACCELCAL_POSITION_REQUEST_INTERVAL_MS), sample collection lasts at most
// ~1.5 s, and after the sixth posture the verdict follows within seconds and
// is then repeated every second. Fifteen seconds of silence therefore means
// the autopilot is gone (rebooted, power-cycled) or the link no longer
// delivers its commands — on a transport that survives a reboot (WebSocket
// bridge, SITL, Ethernet) nothing else would ever end the action, and every
// parameter write stays blocked behind it until the operator finds Cancel.
const DEFAULT_ACCELEROMETER_PROMPT_WATCHDOG_MS = 15000

// What an onboard mag cal does when our cancel cannot reach it. There is no
// onboard timeout: CompassCalibrator keeps fitting until it reaches a result
// (with autosave=1, which we request, a SUCCESS is stored to COMPASS_OFS* on
// its own) or until a reboot; arming is refused while it runs.
const COMPASS_CANCEL_UNDELIVERABLE_TEXT =
  'Disconnected during compass calibration — the cancel could not be sent. The onboard calibration keeps running: with autosave it stores new offsets once the frame has been rotated enough, and it only stops on a reboot. Reboot the autopilot before flying if this calibration was not meant to finish.'

// Parameters a successful calibration writes on the autopilot (AP_AccelCal
// clients save INS_ACC*OFFS/SCAL + the trim; calibrate_trim saves AHRS_TRIM;
// Compass::_accept_calibration saves COMPASS_OFS/DIA/ODI/SCALE and, with
// auto-rotation, COMPASS_ORIENT). Re-read by name after success.
const LEVEL_CALIBRATION_RESULT_PARAMETERS: readonly RegExp[] = [/^AHRS_TRIM_[XY]$/]
const ACCELEROMETER_CALIBRATION_RESULT_PARAMETERS: readonly RegExp[] = [
  /^INS_ACC\d?(OFFS|SCAL)_[XYZ]$/,
  /^INS_ACC\d?_ID$/,
  /^AHRS_TRIM_[XY]$/
]
const COMPASS_CALIBRATION_RESULT_PARAMETERS: readonly RegExp[] = [
  /^COMPASS_(OFS|DIA|ODI)\d?_[XYZ]$/,
  /^COMPASS_SCALE\d?$/,
  /^COMPASS_ORIENT\d?$/
]

// MAG_CAL_STATUS enum (ArduPilot / MAVLink common).
const MAG_CAL_STATUS_SUCCESS = 4
const MAG_CAL_STATUS_FAILED = 5
const MAG_CAL_STATUS_BAD_ORIENTATION = 6
const MAG_CAL_STATUS_BAD_RADIUS = 7

function describeMagCalStatus(calStatus: number): string {
  switch (calStatus) {
    case MAG_CAL_STATUS_SUCCESS:
      return 'success'
    case MAG_CAL_STATUS_FAILED:
      return 'failed'
    case MAG_CAL_STATUS_BAD_ORIENTATION:
      return 'bad orientation'
    case MAG_CAL_STATUS_BAD_RADIUS:
      return 'bad radius (magnetic interference?)'
    default:
      return `status ${calStatus}`
  }
}

/** Bit indices set in a MAG_CAL cal_mask → compass ids. */
function compassIdsFromMask(mask: number): number[] {
  const ids: number[] = []
  for (let bit = 0; bit < 8; bit += 1) {
    if (mask & (1 << bit)) ids.push(bit)
  }
  return ids
}

interface AccelerometerCalibrationProgressState {
  stepIndex: number
  waitingForCompletion: boolean
  /**
   * True once the autopilot itself asked for `stepIndex` (an
   * ACCELCAL_VEHICLE_POS prompt). False for a step we are merely showing —
   * the warm-up fallback, or the step we just confirmed while its sample is
   * being collected. Auto-confirm only acts on a prompted step: AP_AccelCal
   * takes a GCS ack only while `_waiting_for_mavlink_ack` is set, i.e. after
   * it printed a NEW pose, so an ack for a pose it has not asked for is at
   * best dropped and at worst mistaken for the pose it is still on.
   */
  promptedByVehicle: boolean
}

export interface GuidedActionServiceOptions {
  session: MavlinkSession
  getVehicle: () => VehicleIdentity | undefined
  getParameters: () => Map<string, ParameterState>
  getParameterSyncStatus: () => ParameterSyncState['status']
    isConnected: () => boolean
  sendCommand: (
    command: number,
    params: number[],
    options?: { waitForAck?: boolean; ackTimeoutMs?: number; rejectAckOnFailure?: boolean }
  ) => Promise<CommandAckMessage | void>
  appendStatusEntry: (severity: StatusTextEntry['severity'], text: string) => void
  emit: () => void
  /**
   * Re-read the synced parameters whose ids match any pattern (targeted
   * PARAM_REQUEST_READ by name). Called after a calibration succeeds so the
   * snapshot — and every verdict the UI derives from it — reflects the
   * offsets the autopilot just stored instead of the pre-cal values until
   * the next full sync. Optional; best-effort.
   */
  refreshParameters?: (patterns: readonly RegExp[]) => Promise<void>
  accelerometerInitialWarmupMs?: number
  accelerometerStepAdvanceMs?: number
  accelerometerCompletionFallbackMs?: number
  /** Hold time before an aligned posture auto-confirms. 0 disables
   *  auto-confirm entirely and restores the click-every-pose flow. */
  accelerometerAutoHoldMs?: number
  compassGuidanceTimeoutMs?: number
  compassReportWatchdogMs?: number
  /** Test override for the late-start resume window (see
   *  DEFAULT_ACCELEROMETER_LATE_START_RESUME_WINDOW_MS). */
  accelerometerLateStartResumeWindowMs?: number
  /** Test override for the no-prompt watchdog (see
   *  DEFAULT_ACCELEROMETER_PROMPT_WATCHDOG_MS). */
  accelerometerPromptWatchdogMs?: number
}

/**
 * Guided-action / calibration orchestration extracted from the runtime so
 * the runtime class only has to delegate. Owns the guided-action state map,
 * the accelerometer calibration progress state, and the three calibration
 * timers. Talks to the wider runtime through a tight host interface so the
 * service does not reach into runtime internals directly.
 *
 * The `request-parameters` guided action stays interleaved with the runtime
 * parameter-sync state machine, so the runtime drives it via setAction /
 * getAction / failAction here while this service owns calibration end to end.
 */
export class GuidedActionService {
  private readonly session: MavlinkSession
  private readonly getVehicle: () => VehicleIdentity | undefined
  private readonly getParameters: () => Map<string, ParameterState>
  private readonly getParameterSyncStatus: () => ParameterSyncState['status']
  private readonly isConnected: () => boolean
  private readonly sendCommand: GuidedActionServiceOptions['sendCommand']
  private readonly appendStatusEntry: GuidedActionServiceOptions['appendStatusEntry']
  private readonly emit: () => void
  private readonly refreshParameters: GuidedActionServiceOptions['refreshParameters']
  private readonly accelerometerInitialWarmupMs: number
  private readonly accelerometerStepAdvanceMs: number
  private readonly accelerometerCompletionFallbackMs: number
  private readonly accelerometerAutoHoldMs: number
  private readonly compassGuidanceTimeoutMs: number
  private readonly compassReportWatchdogMs: number
  private readonly accelerometerLateStartResumeWindowMs: number
  private readonly accelerometerPromptWatchdogMs: number

  private guidedActions = createIdleGuidedActions()
  private accelerometerCalibration?: AccelerometerCalibrationProgressState
  /** When the PREFLIGHT_CALIBRATION start ack timed out (not: was rejected);
   *  a late ack / first prompt inside the resume window revives the action. */
  private accelerometerStartTimedOutAtMs?: number
  private accelerometerPromptFallbackTimer?: ReturnType<typeof setTimeout>
  private accelerometerAdvanceTimer?: ReturnType<typeof setTimeout>
  private accelerometerPromptWatchdogTimer?: ReturnType<typeof setTimeout>
  /** Auto-confirm hold tracker for the posture currently being requested.
   *  Reset whenever the frame leaves the window, moves, or the step changes. */
  private accelerometerHold?: {
    stepIndex: number
    sinceMs: number
    rollDeg: number
    pitchDeg: number
  }
  /** Guards against a second auto-confirm racing the first for one posture. */
  private accelerometerAutoConfirmInFlight = false
  private compassGuidanceTimer?: ReturnType<typeof setTimeout>
  private compassReportWatchdogTimer?: ReturnType<typeof setTimeout>
  // ArduPilot emits one MAG_CAL_REPORT per compass (common.xml marks
  // compass_id instance="true"). Aggregate terminal reports per compassId and
  // finalize only once every compass named in cal_mask has reported. Cleared
  // on cal start / finalize / reset.
  private magCalReports = new Map<number, { calStatus: number; autosaved: number }>()
  private magCalExpectedMask = 0
  /** compassId → highest MAG_CAL_PROGRESS `attempt` seen above 1 this run. */
  private magCalRetryAttempts = new Map<number, number>()

  constructor(options: GuidedActionServiceOptions) {
    this.session = options.session
    this.getVehicle = options.getVehicle
    this.getParameters = options.getParameters
    this.getParameterSyncStatus = options.getParameterSyncStatus
    this.isConnected = options.isConnected
    this.sendCommand = options.sendCommand
    this.appendStatusEntry = options.appendStatusEntry
    this.emit = options.emit
    this.refreshParameters = options.refreshParameters
    this.accelerometerInitialWarmupMs =
      options.accelerometerInitialWarmupMs ?? DEFAULT_ACCELEROMETER_INITIAL_WARMUP_MS
    this.accelerometerStepAdvanceMs =
      options.accelerometerStepAdvanceMs ?? DEFAULT_ACCELEROMETER_STEP_ADVANCE_MS
    this.accelerometerCompletionFallbackMs =
      options.accelerometerCompletionFallbackMs ?? DEFAULT_ACCELEROMETER_COMPLETION_FALLBACK_MS
    this.accelerometerAutoHoldMs =
      options.accelerometerAutoHoldMs ?? DEFAULT_ACCELEROMETER_AUTO_HOLD_MS
    this.compassGuidanceTimeoutMs =
      options.compassGuidanceTimeoutMs ?? DEFAULT_COMPASS_GUIDANCE_TIMEOUT_MS
    this.compassReportWatchdogMs =
      options.compassReportWatchdogMs ?? DEFAULT_COMPASS_REPORT_WATCHDOG_MS
    this.accelerometerLateStartResumeWindowMs =
      options.accelerometerLateStartResumeWindowMs ?? DEFAULT_ACCELEROMETER_LATE_START_RESUME_WINDOW_MS
    this.accelerometerPromptWatchdogMs =
      options.accelerometerPromptWatchdogMs ?? DEFAULT_ACCELEROMETER_PROMPT_WATCHDOG_MS
  }

  getActions(): Record<GuidedActionId, GuidedActionState> {
    return this.guidedActions
  }

  getAction(actionId: GuidedActionId): GuidedActionState {
    return this.guidedActions[actionId]
  }

  setAction(actionId: GuidedActionId, state: GuidedActionState): void {
    this.guidedActions[actionId] = state
  }

  hasActiveAction(): boolean {
    return hasActiveGuidedAction(this.guidedActions)
  }

  failAction(actionId: GuidedActionId, error: unknown): void {
    const message = error instanceof Error ? error.message : 'Unknown guided action error.'
    if (actionId === 'calibrate-compass') {
      this.clearCompassGuidanceTimer()
      this.clearCompassReportWatchdog()
    }
    if (actionId === 'calibrate-accelerometer') {
      this.clearAccelerometerPromptWatchdog()
    }
    this.setAction(actionId, {
      ...this.guidedActions[actionId],
      status: 'failed',
      summary: message,
      ctaLabel: undefined,
      updatedAtMs: Date.now(),
      completedAtMs: Date.now()
    })
  }

  /**
   * Operator-initiated abort of a stuck or abandoned calibration. An action
   * left 'running' write-blocks the session via hasActiveAction(); this is
   * the recovery path that doesn't require a reboot.
   *
   * Compass: DO_CANCEL_MAG_CAL is awaited (3 s) — the card reads
   * "Cancelling…" and stays active until the autopilot acknowledges, then
   * resets to idle; a rejected or unanswered cancel is reported as a failed
   * cancel instead of pretending the calibrators stopped. Accelerometer:
   * MAVLink has no abort for AP_AccelCal, so it is a configurator-side reset
   * with an honest note about the onboard routine.
   *
   * Never rejects: the UI calls this from a click handler without awaiting.
   */
  async cancelAction(actionId: GuidedActionId): Promise<void> {
    const current = this.guidedActions[actionId]
    if (current.status !== 'requested' && current.status !== 'running') {
      return
    }

    if (actionId === 'calibrate-compass') {
      await this.cancelCompassCalibration(current)
      return
    }

    if (actionId === 'calibrate-accelerometer') {
      // There is no MAVLink command to abort AP_AccelCal. The onboard routine
      // keeps waiting for pose confirmations (re-asking every second) until
      // the autopilot reboots or is armed (acal_update cancels on arming);
      // it has no timeout of its own while waiting.
      this.clearAccelerometerPromptFallbackTimer()
      this.clearAccelerometerAdvanceTimer()
      this.clearAccelerometerPromptWatchdog()
      this.accelerometerCalibration = undefined
      this.accelerometerStartTimedOutAtMs = undefined
      this.appendStatusEntry(
        'warning',
        'Accelerometer calibration cancelled in the configurator. There is no MAVLink command to abort the onboard routine: the autopilot keeps asking for pose confirmations until it reboots (or the vehicle is armed). Reboot it before running another calibration or flying.'
      )
    }

    this.resetActionAfterCancel(actionId)
  }

  // Reset to idle rather than marking it failed. Cancelling is a decision,
  // not an error: leaving the card in a failure state means the operator has
  // to get past an error they caused deliberately before they can start over,
  // and for the accelerometer that matters most — its pose sequence is read
  // from the action, so a cancelled run left the guide stranded partway
  // through instead of back at the first pose.
  //
  // Idle unblocks parameter writes exactly as failed did; the reason the
  // cancel exists at all is to escape a cal stuck in 'running'.
  private resetActionAfterCancel(actionId: GuidedActionId): void {
    this.setAction(actionId, createIdleGuidedAction(actionId))
    this.appendStatusEntry('info', `Guided action cancelled by operator (${actionId}) — reset to its first step.`)
    this.emit()
  }

  private compassCancelInFlight = false

  private async cancelCompassCalibration(current: GuidedActionState): Promise<void> {
    if (this.compassCancelInFlight) {
      return
    }
    this.clearCompassGuidanceTimer()
    this.clearCompassReportWatchdog()
    this.magCalReports = new Map()
    this.magCalExpectedMask = 0
    this.magCalRetryAttempts = new Map()

    if (!this.isConnected()) {
      // Nothing can be delivered. Say what the vehicle will do instead of
      // pretending the cancel went out.
      this.appendStatusEntry('warning', COMPASS_CANCEL_UNDELIVERABLE_TEXT)
      this.resetActionAfterCancel('calibrate-compass')
      return
    }

    this.compassCancelInFlight = true
    this.setAction('calibrate-compass', {
      ...current,
      status: 'running',
      summary: 'Cancelling compass calibration — waiting for the autopilot to confirm it stopped.',
      instructions: ['The onboard calibrators are being stopped with DO_CANCEL_MAG_CAL.'],
      ctaLabel: undefined,
      progressPct: undefined,
      updatedAtMs: Date.now(),
      completedAtMs: undefined
    })
    this.emit()

    try {
      const ack = await this.sendCommand(MAV_CMD.DO_CANCEL_MAG_CAL, [0, 0, 0, 0, 0, 0, 0], {
        waitForAck: true,
        ackTimeoutMs: 3000
      })
      if (ack && ack.result !== MAV_RESULT.ACCEPTED) {
        throw new Error(`Autopilot did not accept DO_CANCEL_MAG_CAL (MAV_RESULT ${ack.result}).`)
      }
      this.resetActionAfterCancel('calibrate-compass')
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Unknown cancel error.'
      const message = `The autopilot did not confirm the compass calibration cancel (${reason}) — the onboard calibration may still be running: with autosave it will store new offsets once the frame has been rotated enough, and it only stops on a reboot. Reboot the autopilot before flying.`
      this.failAction('calibrate-compass', new Error(message))
      this.appendStatusEntry('warning', message)
      this.emit()
    } finally {
      this.compassCancelInFlight = false
    }
  }

  /**
   * The runtime noticed the vehicle restarted on a link that stayed up (a
   * heartbeat gap longer than VEHICLE_RESTART_HEARTBEAT_GAP_MS). A fresh boot
   * is running no calibration of ours and will never report one, so every
   * calibration still 'requested'/'running' is failed here and now rather
   * than left blocking parameter writes until a watchdog or the operator
   * catches up. A pending reboot request, conversely, just got its proof.
   *
   * Trade-off, stated: a multi-second heartbeat dropout on a lossy radio
   * link mid-calibration is read the same way. The alternative — waiting on
   * the per-calibration watchdogs — costs up to 90 s of write-block after a
   * real reboot, and a cal whose progress we stopped seeing for 4 s on a
   * link that drops heartbeats is not one to trust the result of anyway.
   */
  handleVehicleRestart(): void {
    const now = Date.now()
    let changed = false
    for (const actionId of GUIDED_ACTION_IDS) {
      if (actionId === 'request-parameters') {
        continue
      }
      const current = this.guidedActions[actionId]
      if (current.status !== 'requested' && current.status !== 'running') {
        continue
      }
      changed = true
      if (actionId === 'reboot-autopilot') {
        this.setAction(actionId, {
          ...current,
          status: 'succeeded',
          summary: 'Autopilot rebooted — its heartbeat is back.',
          ctaLabel: undefined,
          updatedAtMs: now,
          completedAtMs: now
        })
        continue
      }
      if (actionId === 'calibrate-accelerometer') {
        this.clearAccelerometerPromptFallbackTimer()
        this.clearAccelerometerAdvanceTimer()
        this.accelerometerCalibration = undefined
        this.accelerometerStartTimedOutAtMs = undefined
      }
      if (actionId === 'calibrate-compass') {
        this.magCalReports = new Map()
        this.magCalExpectedMask = 0
        this.magCalRetryAttempts = new Map()
      }
      const message =
        'The autopilot restarted mid-calibration (its heartbeat stopped for several seconds and came back) — the calibration was abandoned. Re-run it once the vehicle has finished booting.'
      this.failAction(actionId, new Error(message))
      this.appendStatusEntry('warning', message)
    }
    if (changed) {
      this.emit()
    }
  }

  async runCalibrationAction(actionId: GuidedActionId): Promise<void> {
    switch (actionId) {
      case 'calibrate-accelerometer':
        await this.runAccelerometerCalibrationAction()
        return
      case 'calibrate-level':
        await this.runLevelCalibrationAction()
        return
      case 'calibrate-compass':
        await this.runCompassCalibrationAction()
        return
      case 'reboot-autopilot':
        await this.runRebootAction()
        return
      default:
        return
    }
  }

  handleCommandLong(message: CommandLongMessage, systemId: number, componentId: number): void {
    if (message.command !== MAV_CMD.ACCELCAL_VEHICLE_POS) {
      return
    }

    const vehicle = this.getVehicle()
    const current = this.guidedActions['calibrate-accelerometer']
    if (!vehicle || vehicle.systemId !== systemId || vehicle.componentId !== componentId) {
      return
    }

    // Only a calibration we started AND the autopilot acknowledged is ours to
    // drive (AP_AccelCal.cpp). Everything else on this command id is noise:
    //
    //  - Once any accel cal has finished, the autopilot re-sends the
    //    SUCCESS/FAILED sentinel every second for the rest of the boot
    //    (`_last_result != NOT_STARTED` branch of AP_AccelCal::update). Taking
    //    it while 'succeeded' re-ran completeAccelerometerCalibration() each
    //    second: a fresh status entry, completedAtMs advancing, and the
    //    dismissable reboot prompt keyed on completedAtMs coming back forever.
    //  - Before our PREFLIGHT_CALIBRATION is ACKed ('requested'), a sentinel
    //    from the PREVIOUS run is still streaming; accepting it would finish
    //    the new run before it began.
    const commandValue = Math.round(message.params[0] ?? 0)
    const isPosePrompt = ACCELEROMETER_CALIBRATION_STEPS.some((step) => step.commandValue === commandValue)
    if (current.status !== 'running') {
      // A late start: the ack budget ran out but the autopilot is now asking
      // for a pose. Only a pose prompt proves a live calibration (a sentinel
      // may be the previous run's), and only inside the resume window.
      if (isPosePrompt && this.canResumeLateAccelerometerStart(current)) {
        this.resumeLateAccelerometerStart()
      } else {
        return
      }
    }

    // Any ACCELCAL_VEHICLE_POS from a running cal is a sign of life.
    this.scheduleAccelerometerPromptWatchdog()

    if (commandValue === ACCELCAL_SUCCESS_VALUE) {
      this.clearAccelerometerPromptFallbackTimer()
      this.clearAccelerometerAdvanceTimer()
      this.completeAccelerometerCalibration()
      return
    }

    if (commandValue === ACCELCAL_FAILED_VALUE) {
      this.clearAccelerometerPromptFallbackTimer()
      this.clearAccelerometerAdvanceTimer()
      this.failAction('calibrate-accelerometer', new Error('Accelerometer calibration failed.'))
      this.accelerometerCalibration = undefined
      return
    }

    const stepIndex = ACCELEROMETER_CALIBRATION_STEPS.findIndex((step) => step.commandValue === commandValue)
    if (stepIndex < 0) {
      return
    }

    const state = this.accelerometerCalibration
    if (state && state.promptedByVehicle && state.stepIndex === stepIndex && !state.waitingForCompletion) {
      // The same prompt again. AP_AccelCal re-sends the posture it is waiting
      // for every second (AP_ACCELCAL_POSITION_REQUEST_INTERVAL_MS); nothing
      // about the step changed, so leave the auto-confirm hold alone. Tearing
      // it down here (as a "step change") reset a 1.2 s hold every ~1 s — the
      // reason auto-confirm never fired on a perfectly still, aligned frame.
      this.clearAccelerometerPromptFallbackTimer()
      return
    }

    this.clearAccelerometerPromptFallbackTimer()
    this.clearAccelerometerAdvanceTimer()
    this.accelerometerCalibration = {
      stepIndex,
      waitingForCompletion: false,
      promptedByVehicle: true
    }
    this.setAction(
      'calibrate-accelerometer',
      buildAccelerometerCalibrationGuidedAction(stepIndex, this.guidedActions['calibrate-accelerometer'])
    )
  }

  /**
   * COMMAND_ACKs from the vehicle, in wire order. The runtime's sendCommand()
   * promise resolves on the same ack, but a promise settles a microtask
   * later — after every frame that shared the transport chunk with the ack
   * has already been dispatched. Flipping 'requested' → 'running' HERE keeps
   * the accept-gate wire-accurate: a MAG_CAL_REPORT / pose prompt that
   * follows the start ack in the same chunk is taken, one that preceded it
   * (a stale report from the previous run) is not.
   *
   * Only an ACCEPTED ack for the command the pending action sent counts;
   * rejections and timeouts are reported by the awaiting runner.
   */
  handleCommandAck(message: CommandAckMessage, systemId: number, componentId: number): void {
    const vehicle = this.getVehicle()
    if (!vehicle || vehicle.systemId !== systemId || vehicle.componentId !== componentId) {
      return
    }
    if (message.result !== MAV_RESULT.ACCEPTED) {
      return
    }

    if (message.command === MAV_CMD.DO_START_MAG_CAL) {
      const compass = this.guidedActions['calibrate-compass']
      if (compass.status === 'requested') {
        this.markCompassCalibrationStarted(compass)
      }
      return
    }

    if (message.command === MAV_CMD.PREFLIGHT_CALIBRATION) {
      const accel = this.guidedActions['calibrate-accelerometer']
      if (accel.status === 'requested' && !this.accelerometerCalibration) {
        this.markAccelerometerCalibrationStarted(accel)
      } else if (this.canResumeLateAccelerometerStart(accel)) {
        this.resumeLateAccelerometerStart()
        this.markAccelerometerCalibrationStarted(this.guidedActions['calibrate-accelerometer'])
      }
    }
  }

  private canResumeLateAccelerometerStart(current: GuidedActionState): boolean {
    return (
      current.status === 'failed' &&
      this.accelerometerStartTimedOutAtMs !== undefined &&
      Date.now() - this.accelerometerStartTimedOutAtMs <= this.accelerometerLateStartResumeWindowMs
    )
  }

  private resumeLateAccelerometerStart(): void {
    this.accelerometerStartTimedOutAtMs = undefined
    this.appendStatusEntry(
      'info',
      'The autopilot started the accelerometer calibration after the acknowledgment window had closed — resuming the guided calibration.'
    )
  }

  /** Vehicle progress for an in-flight onboard mag calibration. */
  handleMagCalProgress(message: MagCalProgressMessage): void {
    const current = this.guidedActions['calibrate-compass']
    // 'running' only — see handleMagCalReport for why 'requested' is excluded.
    if (current.status !== 'running') {
      return
    }

    // Progress proves the calibration started — the only thing the guidance
    // timeout guards — so disarm it permanently. Do NOT re-arm it per
    // progress: mag cal is human-paced, so a >timeout gap between progress
    // messages is normal and must not fail an active calibration.
    this.clearCompassGuidanceTimer()

    // The long no-traffic watchdog covers a lost terminal report (re-armed
    // per message, sized so a human pause can't trip it).
    this.scheduleCompassReportWatchdog()

    const pct = Math.max(0, Math.min(100, Math.round(message.completionPct)))
    const now = Date.now()
    // DO_START_MAG_CAL is sent with retry=1: a compass whose fit fails
    // (FAILED / BAD_ORIENTATION / BAD_RADIUS) is restarted by the autopilot
    // with `attempt` incremented (CompassCalibrator::set_status) instead of
    // ever reporting a terminal status — so a compass that can never fit
    // retries forever and the only visible trace is this field. Surface it,
    // keep the action 'running' so Cancel stays available.
    if (message.attempt > 1) {
      this.magCalRetryAttempts.set(message.compassId, message.attempt)
    }
    const retrying = [...this.magCalRetryAttempts.entries()]
      .sort(([left], [right]) => left - right)
      .map(([compassId, attempt]) => `compass ${compassId + 1} failed its fit — retrying, attempt ${attempt}`)
    const summary =
      retrying.length > 0
        ? `Compass calibration ${pct}% — ${retrying.join('; ')}; check for magnetic interference or the compass orientation, then keep rotating. Cancel if it never settles.`
        : `Compass calibration ${pct}% — keep rotating the vehicle through all axes.`
    this.setAction('calibrate-compass', {
      ...current,
      status: 'running',
      summary,
      progressPct: pct,
      ctaLabel: undefined,
      startedAtMs: current.startedAtMs ?? now,
      updatedAtMs: now,
      completedAtMs: undefined
    })
  }

  /**
   * One terminal MAG_CAL_REPORT arrives per compass instance. Aggregate per
   * compassId and finalize only once every compass named in cal_mask has
   * reported; succeed only if all succeeded, else fail naming each status.
   * DO_ACCEPT_MAG_CAL (mask 0 = all) is sent only after all reported, since
   * accepting earlier would stop still-running calibrators.
   */
  handleMagCalReport(message: MagCalReportMessage): void {
    const current = this.guidedActions['calibrate-compass']
    // Not 'requested': ArduPilot streams a MAG_CAL_REPORT for every calibrator
    // that is in a terminal state until something calls stop() on it
    // (Compass::send_mag_cal_report, AP_Compass_Calibration.cpp), and the
    // autosave path never does. So after one successful run the SUCCESS
    // report of that run keeps arriving at the EXTRA3 rate, and the next
    // DO_START_MAG_CAL only restarts the calibrators once the autopilot has
    // processed it — i.e. a stale SUCCESS can land between our send and its
    // ACK and would finalize the new run before it started. The start ACK is
    // the line (handleCommandAck flips to 'running' in wire order).
    if (current.status !== 'running') {
      return
    }

    this.clearCompassGuidanceTimer()
    const now = Date.now()

    this.magCalReports.set(message.compassId, {
      calStatus: message.calStatus,
      autosaved: message.autosaved
    })
    // cal_mask is the bitmask of compasses being calibrated; union it in
    // case a firmware reports a partial/zero mask on some instance.
    this.magCalExpectedMask |= message.calMask

    // Firmware that never fills cal_mask (mask 0 on every report): the
    // expected set is unknowable, so finalize on the compasses seen so far
    // (with one report this is just the single-compass case).
    const expectedIds = this.magCalExpectedMask > 0
      ? compassIdsFromMask(this.magCalExpectedMask)
      : [...this.magCalReports.keys()]
    const pendingIds = expectedIds.filter((id) => !this.magCalReports.has(id))

    if (pendingIds.length > 0) {
      // Still waiting on more per-compass reports — keep the watchdog
      // alive so a lost remainder can't strand the action in 'running'.
      this.scheduleCompassReportWatchdog()
      // Interim — show per-compass progress, keep the action running.
      const reportedSummary = [...this.magCalReports.entries()]
        .map(([id, report]) => `compass ${id + 1}: ${describeMagCalStatus(report.calStatus)}`)
        .join(', ')
      this.setAction('calibrate-compass', {
        ...current,
        status: 'running',
        summary: `Compass calibration finishing — ${reportedSummary}; waiting for ${pendingIds.length} more compass${pendingIds.length === 1 ? '' : 'es'}.`,
        ctaLabel: undefined,
        updatedAtMs: now,
        completedAtMs: undefined
      })
      return
    }

    // All expected compasses reported — finalize.
    this.clearCompassReportWatchdog()
    const reports = expectedIds.map((id) => ({ id, ...this.magCalReports.get(id)! }))
    this.magCalReports = new Map()
    this.magCalExpectedMask = 0
    this.magCalRetryAttempts = new Map()

    const failures = reports.filter((report) => report.calStatus !== MAG_CAL_STATUS_SUCCESS)
    if (failures.length === 0) {
      // Persist the fits unless the autopilot already auto-saved every one.
      if (reports.some((report) => !report.autosaved)) {
        void this.sendCommand(MAV_CMD.DO_ACCEPT_MAG_CAL, [0, 0, 0, 0, 0, 0, 0]).catch(() => {})
      }
      const compassNoun = reports.length === 1 ? 'compass' : `all ${reports.length} compasses`
      this.appendStatusEntry('info', `Compass calibration complete (${compassNoun}).`)
      this.setAction('calibrate-compass', {
        ...current,
        status: 'succeeded',
        summary: `Compass calibration complete (${compassNoun}).`,
        instructions: ['Reboot the autopilot and refresh parameters before flight.'],
        ctaLabel: undefined,
        updatedAtMs: now,
        completedAtMs: now
      })
      this.refreshCalibrationResultParameters(COMPASS_CALIBRATION_RESULT_PARAMETERS)
      return
    }

    const failureSummary = failures
      .map((report) => `compass ${report.id + 1}: ${describeMagCalStatus(report.calStatus)}`)
      .join('; ')
    const hint = failures.some((report) => report.calStatus === MAG_CAL_STATUS_BAD_ORIENTATION)
      ? ' Check COMPASS/AHRS_ORIENTATION.'
      : ''
    this.failAction(
      'calibrate-compass',
      new Error(`Compass calibration failed — ${failureSummary}.${hint}`)
    )
  }

  reconcileCompassCalibrationAvailability(): void {
    const current = this.guidedActions['calibrate-compass']
    if (
      this.getParameterSyncStatus() !== 'complete' ||
      (current.status !== 'requested' && current.status !== 'running') ||
      enabledCompassCountFromParameters(this.getParameters()) > 0
    ) {
      return
    }

    const message = describeMissingCompass(this.getParameters())
    this.failAction('calibrate-compass', new Error(message))
    this.appendStatusEntry('warning', message)
  }

  processStatusText(text: string): void {
    const now = Date.now()
    GUIDED_ACTION_IDS.filter((actionId) => actionId !== 'request-parameters').forEach((actionId) => {
      const current = this.guidedActions[actionId]
      const match = matchGuidedActionText(actionId, current, text)
      if (!match) {
        return
      }

      const nextStatus = match.status ?? (current.status === 'idle' ? 'running' : current.status)
      if (actionId === 'calibrate-compass') {
        this.clearCompassGuidanceTimer()
        if (nextStatus === 'running') {
          // Any compass-cal sign of life keeps the no-traffic watchdog fed.
          this.scheduleCompassReportWatchdog()
        } else if (nextStatus === 'succeeded' || nextStatus === 'failed') {
          this.clearCompassReportWatchdog()
        }
      }

      this.setAction(actionId, {
        actionId,
        status: nextStatus,
        summary: match.summary,
        instructions: match.instructions ?? current.instructions,
        statusTexts: appendGuidedActionText(current.statusTexts, text),
        ctaLabel: nextStatus === 'running' ? current.ctaLabel : undefined,
        startedAtMs: current.startedAtMs ?? now,
        updatedAtMs: now,
        completedAtMs: nextStatus === 'succeeded' || nextStatus === 'failed' ? now : undefined
      })

      if (actionId === 'calibrate-accelerometer') {
        if (nextStatus === 'succeeded' || nextStatus === 'failed') {
          this.accelerometerCalibration = undefined
          this.clearAccelerometerPromptFallbackTimer()
          this.clearAccelerometerAdvanceTimer()
          this.clearAccelerometerPromptWatchdog()
          if (nextStatus === 'succeeded') {
            this.appendStatusEntry('info', 'Accelerometer calibration complete.')
            this.refreshCalibrationResultParameters(ACCELEROMETER_CALIBRATION_RESULT_PARAMETERS)
          }
        } else if (nextStatus === 'running') {
          // "Place vehicle …" texts travel with the prompts: sign of life.
          this.scheduleAccelerometerPromptWatchdog()
        }
      }
    })
  }

  reset(): void {
    const compass = this.guidedActions['calibrate-compass']
    if (compass.status === 'requested' || compass.status === 'running') {
      if (this.isConnected()) {
        // Link still up (e.g. an in-app disconnect, which resets state
        // before tearing the transport down) — actually cancel the
        // onboard mag cal.
        void this.sendCommand(MAV_CMD.DO_CANCEL_MAG_CAL, [0, 0, 0, 0, 0, 0, 0]).catch(() => {})
      } else {
        // Link already gone (cable pulled / transport error): the cancel
        // cannot be delivered. Don't pretend it was — say what the vehicle
        // actually does (it does NOT time out).
        this.appendStatusEntry('warning', COMPASS_CANCEL_UNDELIVERABLE_TEXT)
      }
    }
    this.guidedActions = createIdleGuidedActions()
    this.accelerometerCalibration = undefined
    this.accelerometerStartTimedOutAtMs = undefined
    this.magCalReports = new Map()
    this.magCalExpectedMask = 0
    this.magCalRetryAttempts = new Map()
    this.clearAccelerometerPromptFallbackTimer()
    this.clearAccelerometerAdvanceTimer()
    this.clearAccelerometerPromptWatchdog()
    this.clearCompassGuidanceTimer()
    this.clearCompassReportWatchdog()
  }

  destroy(): void {
    this.clearAccelerometerPromptFallbackTimer()
    this.clearAccelerometerAdvanceTimer()
    this.clearAccelerometerPromptWatchdog()
    this.clearCompassGuidanceTimer()
    this.clearCompassReportWatchdog()
  }

  private clearAccelerometerPromptWatchdog(): void {
    if (!this.accelerometerPromptWatchdogTimer) {
      return
    }

    clearTimeout(this.accelerometerPromptWatchdogTimer)
    this.accelerometerPromptWatchdogTimer = undefined
  }

  /** Armed when the cal starts running, re-armed on every prompt/sentinel
   *  and accel STATUSTEXT. See DEFAULT_ACCELEROMETER_PROMPT_WATCHDOG_MS. */
  private scheduleAccelerometerPromptWatchdog(): void {
    this.clearAccelerometerPromptWatchdog()
    this.accelerometerPromptWatchdogTimer = setTimeout(() => {
      this.accelerometerPromptWatchdogTimer = undefined
      const current = this.guidedActions['calibrate-accelerometer']
      if (current.status !== 'running') {
        return
      }

      this.clearAccelerometerPromptFallbackTimer()
      this.clearAccelerometerAdvanceTimer()
      this.accelerometerCalibration = undefined
      this.accelerometerStartTimedOutAtMs = undefined
      const seconds = Math.round(this.accelerometerPromptWatchdogMs / 1000)
      const message =
        `No accelerometer calibration prompt arrived from the autopilot for ${seconds} seconds — it re-sends the current posture every second, so it has most likely rebooted or the link stopped delivering its commands. The calibration was abandoned so parameter writes are not blocked. Reboot the autopilot before running it again: there is no MAVLink command to abort the onboard routine, and it only stops on a reboot or when the vehicle is armed.`
      this.failAction('calibrate-accelerometer', new Error(message))
      this.appendStatusEntry('warning', message)
      this.emit()
    }, this.accelerometerPromptWatchdogMs)
    // Must not hold a Node process open (tests, the desktop bridge).
    ;(this.accelerometerPromptWatchdogTimer as unknown as { unref?: () => void }).unref?.()
  }

  private clearAccelerometerPromptFallbackTimer(): void {
    if (!this.accelerometerPromptFallbackTimer) {
      return
    }

    clearTimeout(this.accelerometerPromptFallbackTimer)
    this.accelerometerPromptFallbackTimer = undefined
  }

  private clearAccelerometerAdvanceTimer(): void {
    // The hold is per-posture; any step change or teardown invalidates it.
    this.accelerometerHold = undefined
    if (!this.accelerometerAdvanceTimer) {
      return
    }

    clearTimeout(this.accelerometerAdvanceTimer)
    this.accelerometerAdvanceTimer = undefined
  }

  private clearCompassGuidanceTimer(): void {
    if (!this.compassGuidanceTimer) {
      return
    }

    clearTimeout(this.compassGuidanceTimer)
    this.compassGuidanceTimer = undefined
  }

  private clearCompassReportWatchdog(): void {
    if (!this.compassReportWatchdogTimer) {
      return
    }

    clearTimeout(this.compassReportWatchdogTimer)
    this.compassReportWatchdogTimer = undefined
  }

  private scheduleCompassReportWatchdog(): void {
    this.clearCompassReportWatchdog()
    this.compassReportWatchdogTimer = setTimeout(() => {
      this.compassReportWatchdogTimer = undefined
      const current = this.guidedActions['calibrate-compass']
      if (current.status !== 'requested' && current.status !== 'running') {
        return
      }

      // Best-effort stop of any calibrator still spinning onboard before
      // declaring the session-side wait abandoned.
      if (this.isConnected()) {
        void this.sendCommand(MAV_CMD.DO_CANCEL_MAG_CAL, [0, 0, 0, 0, 0, 0, 0]).catch(() => {})
      }
      this.magCalReports = new Map()
      this.magCalExpectedMask = 0
      this.magCalRetryAttempts = new Map()
      const message = `No compass calibration messages arrived for ${Math.round(
        this.compassReportWatchdogMs / 1000
      )} seconds — abandoning the wait so parameter writes are not blocked. Re-run the calibration and check the compass before flying.`
      this.failAction('calibrate-compass', new Error(message))
      this.appendStatusEntry('warning', message)
      this.emit()
    }, this.compassReportWatchdogMs)
    // The 90s watchdog must not hold a Node process open (tests, the
    // desktop bridge); browser setTimeout returns a number with no unref.
    ;(this.compassReportWatchdogTimer as unknown as { unref?: () => void }).unref?.()
  }

  private scheduleAccelerometerPromptFallback(stepIndex: number): void {
    this.clearAccelerometerPromptFallbackTimer()
    this.accelerometerPromptFallbackTimer = setTimeout(() => {
      const current = this.guidedActions['calibrate-accelerometer']
      const state = this.accelerometerCalibration
      if (!state || state.stepIndex !== stepIndex || current.status === 'failed' || current.status === 'succeeded') {
        return
      }

      this.setAction(
        'calibrate-accelerometer',
        buildAccelerometerCalibrationGuidedAction(stepIndex, this.guidedActions['calibrate-accelerometer'])
      )
      this.emit()
    }, this.accelerometerInitialWarmupMs)
  }

  /**
   * Runs after a posture was confirmed and the sample window has passed. It
   * only changes WORDING: the step index moves on the autopilot's next
   * ACCELCAL_VEHICLE_POS prompt and nowhere else. The timer used to advance
   * the step itself, which put the guide a pose ahead of the vehicle
   * whenever the autopilot re-asked for the same pose (a rejected sample) or
   * was simply slower than 1.5 s, and let auto-confirm ack a pose the
   * autopilot had not requested.
   *
   * A follow-up may replace the snooped COMMAND_ACK confirm with
   * MAV_CMD_ACCELCAL_VEHICLE_POS (which names the pose); that needs
   * hardware validation and is not part of this change.
   */
  private scheduleAccelerometerStepAdvance(stepIndex: number): void {
    this.clearAccelerometerAdvanceTimer()
    this.accelerometerAdvanceTimer = setTimeout(() => {
      this.accelerometerAdvanceTimer = undefined
      const current = this.guidedActions['calibrate-accelerometer']
      const state = this.accelerometerCalibration
      if (!state || state.stepIndex !== stepIndex || current.status !== 'running') {
        return
      }

      if (stepIndex + 1 < ACCELEROMETER_CALIBRATION_STEPS.length) {
        const posture = ACCELEROMETER_CALIBRATION_STEPS[stepIndex].ctaLabel
          .replace(/^Confirm /, '')
          .replace(/ Position$/, '')
          .toLowerCase()
        this.setAction('calibrate-accelerometer', {
          ...current,
          status: 'running',
          summary: `${posture.charAt(0).toUpperCase()}${posture.slice(1)} recorded — waiting for the autopilot's next posture prompt.`,
          instructions: ['Keep the frame where it is until the next posture appears.'],
          ctaLabel: undefined,
          updatedAtMs: Date.now(),
          completedAtMs: undefined
        })
      } else {
        this.accelerometerCalibration = {
          stepIndex,
          waitingForCompletion: true,
          promptedByVehicle: false
        }
        this.setAction('calibrate-accelerometer', {
          ...current,
          status: 'running',
          summary: 'Finalizing accelerometer calibration…',
          instructions: ['Keep the vehicle still while ArduPilot stores the new accelerometer calibration.'],
          ctaLabel: undefined,
          updatedAtMs: Date.now(),
          completedAtMs: undefined
        })
        this.scheduleAccelerometerCompletionFallback(stepIndex)
      }
      this.emit()
    }, this.accelerometerStepAdvanceMs)
  }

  /**
   * The verdict after the sixth posture comes from the autopilot — the
   * "Calibration successful"/"FAILED" STATUSTEXT and then the sentinel
   * ACCELCAL_VEHICLE_POS it repeats every second for the rest of the boot.
   * Nothing is lost by waiting for it, so when this window closes the action
   * says so and stays 'running' (bounded by the no-prompt watchdog) instead
   * of declaring a success the vehicle never reported.
   */
  private scheduleAccelerometerCompletionFallback(stepIndex: number): void {
    this.clearAccelerometerAdvanceTimer()
    this.accelerometerAdvanceTimer = setTimeout(() => {
      this.accelerometerAdvanceTimer = undefined
      const current = this.guidedActions['calibrate-accelerometer']
      const state = this.accelerometerCalibration
      if (!state || state.stepIndex !== stepIndex || !state.waitingForCompletion || current.status !== 'running') {
        return
      }

      this.setAction('calibrate-accelerometer', {
        ...current,
        status: 'running',
        summary: "Finalizing accelerometer calibration — waiting for the autopilot's verdict.",
        instructions: [
          'ArduPilot reports the result itself once the offsets are stored; keep the vehicle still.',
          'If nothing arrives, the calibration is abandoned automatically and can be run again.'
        ],
        ctaLabel: undefined,
        updatedAtMs: Date.now(),
        completedAtMs: undefined
      })
      this.emit()
    }, this.accelerometerCompletionFallbackMs)
  }

  private scheduleCompassGuidanceTimeout(): void {
    this.clearCompassGuidanceTimer()
    this.compassGuidanceTimer = setTimeout(() => {
      this.compassGuidanceTimer = undefined
      const current = this.guidedActions['calibrate-compass']
      if ((current.status !== 'requested' && current.status !== 'running') || current.statusTexts.length > 0) {
        return
      }

      // Armed only after DO_START_MAG_CAL was ACKed accepted: silence here
      // means the link isn't delivering MAG_CAL_PROGRESS (EXTRA3 stream
      // group). Best-effort cancel so vehicle and UI state agree.
      if (this.isConnected()) {
        void this.sendCommand(MAV_CMD.DO_CANCEL_MAG_CAL, [0, 0, 0, 0, 0, 0, 0]).catch(() => {})
      }
      const message =
        'No compass calibration guidance arrived from the autopilot even though it accepted the start command. The onboard calibration was cancelled — check the link and the SRx_EXTRA3 telemetry stream rate, then re-run the calibration.'
      this.failAction('calibrate-compass', new Error(message))
      this.appendStatusEntry('warning', message)
      this.emit()
    }, this.compassGuidanceTimeoutMs)
  }

  private async performCommandGuidedAction(
    actionId: GuidedActionId,
    requestedSummary: string,
    runningSummary: string,
    instructions: string[],
    operation: () => Promise<void>
  ): Promise<void> {
    const startedAtMs = Date.now()
    this.setAction(actionId, {
      actionId,
      status: 'requested',
      summary: requestedSummary,
      instructions,
      statusTexts: [],
      startedAtMs,
      updatedAtMs: startedAtMs,
      completedAtMs: undefined
    })
    this.emit()

    try {
      await operation()
      this.setAction(actionId, {
        ...this.guidedActions[actionId],
        status: 'running',
        summary: runningSummary,
        instructions,
        updatedAtMs: Date.now(),
        completedAtMs: undefined
      })
      this.emit()
    } catch (error) {
      this.failAction(actionId, error)
      this.emit()
      throw error
    }
  }

  /**
   * PREFLIGHT_REBOOT_SHUTDOWN. GCS_Common.cpp sends the ACCEPTED ack BEFORE
   * rebooting ("send ack before we reboot"; AP_Vehicle::reboot then delays
   * so it gets out), so the ack is the whole verdict: ACCEPTED means the
   * board is going down, anything else means it is not. This used to be
   * fire-and-forget and then sat 'running' waiting for a "reboot requested"
   * STATUSTEXT ArduPilot never sends — on a transport that survives the
   * reboot (WebSocket bridge, SITL, Ethernet) that blocked every parameter
   * write until the operator disconnected.
   */
  private async runRebootAction(): Promise<void> {
    await this.performCommandGuidedAction(
      'reboot-autopilot',
      'Autopilot reboot request queued.',
      'Reboot accepted — the autopilot is restarting. Expect the link to drop on USB.',
      defaultInstructionsForAction('reboot-autopilot'),
      async () => {
        const ack = await this.sendCommand(MAV_CMD.PREFLIGHT_REBOOT_SHUTDOWN, [1, 0, 0, 0, 0, 0, 0], {
          waitForAck: true,
          ackTimeoutMs: 3000
        })
        if (ack && ack.result !== MAV_RESULT.ACCEPTED) {
          throw new Error(`Autopilot did not accept the reboot request (MAV_RESULT ${ack.result}).`)
        }
      }
    )

    const current = this.guidedActions['reboot-autopilot']
    if (current.status === 'running') {
      const now = Date.now()
      this.setAction('reboot-autopilot', {
        ...current,
        status: 'succeeded',
        summary: 'Autopilot reboot accepted — it is restarting.',
        updatedAtMs: now,
        completedAtMs: now
      })
      this.emit()
    }
  }

  private async runLevelCalibrationAction(): Promise<void> {
    // Board-level calibration via MAV_CMD_PREFLIGHT_CALIBRATION param5=2:
    // samples a few seconds of level attitude and stores AHRS_TRIM_X/Y.
    // ArduPilot reports the outcome in the COMMAND_ACK (no follow-up
    // STATUSTEXT), so the ACK — not a status text — is the completion
    // signal; a clean return from rejectAckOnFailure means the trim stored.
    await this.performCommandGuidedAction(
      'calibrate-level',
      'Board level calibration queued.',
      'Board level calibration in progress — keep the vehicle motionless while ArduPilot samples gravity.',
      defaultInstructionsForAction('calibrate-level'),
      async () => {
        // calibrate_trim() samples gravity for ~1-2s before ACKing, but the
        // FC can be slower under load; use a generous 15s ACK budget so a
        // healthy command isn't timed out while a genuine hang still fails.
        const ack = await this.sendCommand(MAV_CMD.PREFLIGHT_CALIBRATION, [0, 0, 0, 0, 2, 0, 0], {
          waitForAck: true,
          ackTimeoutMs: 15000
        })
        // The ack IS the verdict, so read it. The waiter already rejects
        // FAILED/DENIED/UNSUPPORTED/TEMPORARILY_REJECTED; what it resolves
        // with that is not a success is an IN_PROGRESS beat whose final ack
        // never came — calibrate_trim() returns its result synchronously, so
        // that is not a stored trim either.
        if (ack && ack.result !== MAV_RESULT.ACCEPTED) {
          throw new Error(
            `Autopilot acknowledged the level calibration with MAV_RESULT ${ack.result} but never confirmed it finished — the trim was not stored.`
          )
        }
      }
    )

    const current = this.guidedActions['calibrate-level']
    if (current.status === 'running') {
      const now = Date.now()
      this.setAction('calibrate-level', {
        ...current,
        status: 'succeeded',
        summary: 'Board level calibration complete.',
        instructions: ['AHRS_TRIM_X and AHRS_TRIM_Y were updated and re-read into the parameter table.'],
        updatedAtMs: now,
        completedAtMs: now
      })
      this.refreshCalibrationResultParameters(LEVEL_CALIBRATION_RESULT_PARAMETERS)
      this.emit()
    }
  }

  private async runCompassCalibrationAction(): Promise<void> {
    this.clearCompassGuidanceTimer()
    this.clearCompassReportWatchdog()

    // Don't start an onboard mag cal on a vehicle with no usable compass —
    // fail fast with the same guidance as the post-sync precheck instead
    // of sending DO_START_MAG_CAL and waiting on an ack that won't help.
    if (enabledCompassCountFromParameters(this.getParameters()) === 0) {
      const message = describeMissingCompass(this.getParameters())
      this.failAction('calibrate-compass', new Error(message))
      this.appendStatusEntry('warning', message)
      this.emit()
      return
    }

    // Fresh per-compass aggregation for this run — a stale report set
    // from an aborted previous cal must not contaminate the new one.
    this.magCalReports = new Map()
    this.magCalExpectedMask = 0
    this.magCalRetryAttempts = new Map()

    await this.performCommandGuidedAction(
      'calibrate-compass',
      'Compass calibration command queued.',
      'Compass calibration started. Rotate the vehicle through all axes.',
      defaultInstructionsForAction('calibrate-compass'),
      async () => {
        // Modern ArduPilot rejects the legacy PREFLIGHT_CALIBRATION
        // magnetometer path (param2) with UNSUPPORTED; onboard mag cal
        // uses DO_START_MAG_CAL. Params: mag_mask=0 (all compasses),
        // retry=1, autosave=1, delay=0s, autoreboot=0.
        await this.sendCommand(MAV_CMD.DO_START_MAG_CAL, [0, 1, 1, 0, 0, 0, 0], {
          waitForAck: true,
          ackTimeoutMs: 3000
        })
      }
    )

    const current = this.guidedActions['calibrate-compass']
    if (current.status === 'requested' || current.status === 'running') {
      this.scheduleCompassGuidanceTimeout()
    }
  }

  /**
   * Live attitude during an accelerometer calibration. Once the frame is inside
   * the requested posture's acceptance window AND has held there for
   * accelerometerAutoHoldMs, the posture is confirmed automatically — so the
   * operator sets the frame down and the calibration walks itself through the
   * remaining postures instead of demanding a click for each one.
   *
   * The FIRST posture (level) is deliberately NOT auto-confirmed: a bench
   * vehicle is already sitting level when the calibration starts, so an
   * auto-confirm would fire the instant the calibration began — before the
   * operator had any chance to actually place the frame. Level stays an
   * explicit "I'm level" click, and everything after it is hands-off.
   *
   * The manual confirm stays available for every posture: this only removes
   * the NEED to click, it never removes the ability to.
   */
  handleAttitudeSample(rollDeg: number | undefined, pitchDeg: number | undefined): void {
    if (this.accelerometerAutoHoldMs <= 0 || rollDeg === undefined || pitchDeg === undefined) {
      return
    }
    if (!Number.isFinite(rollDeg) || !Number.isFinite(pitchDeg)) {
      return
    }

    const state = this.accelerometerCalibration
    const current = this.guidedActions['calibrate-accelerometer']
    if (
      !state ||
      state.waitingForCompletion ||
      // Only a posture the autopilot asked for can be acked; see
      // AccelerometerCalibrationProgressState.promptedByVehicle.
      !state.promptedByVehicle ||
      this.accelerometerAutoConfirmInFlight ||
      current.status !== 'running' ||
      // Level is the operator's own "I'm level" click — see above.
      state.stepIndex <= 0 ||
      state.stepIndex >= ACCELEROMETER_POSE_ORDER.length
    ) {
      this.accelerometerHold = undefined
      return
    }

    const poseId = ACCELEROMETER_POSE_ORDER[state.stepIndex]
    const roll = normalizeSignedDegrees(rollDeg)
    const pitch = normalizeSignedDegrees(pitchDeg)

    if (poseErrorDegrees(poseId, roll, pitch) > ACCELEROMETER_POSE_ALIGNED_DEG) {
      this.accelerometerHold = undefined
      return
    }

    const hold = this.accelerometerHold
    const now = Date.now()
    if (
      !hold ||
      hold.stepIndex !== state.stepIndex ||
      // Still drifting: restart the hold rather than averaging through the
      // movement, so the sample is taken on a settled frame.
      attitudeDeltaDegrees({ rollDeg: hold.rollDeg, pitchDeg: hold.pitchDeg }, { rollDeg: roll, pitchDeg: pitch }) >
        ACCELEROMETER_AUTO_STILL_DEG
    ) {
      this.accelerometerHold = { stepIndex: state.stepIndex, sinceMs: now, rollDeg: roll, pitchDeg: pitch }
      return
    }

    if (now - hold.sinceMs < this.accelerometerAutoHoldMs) {
      return
    }

    this.accelerometerHold = undefined
    this.accelerometerAutoConfirmInFlight = true
    const stepIndex = state.stepIndex
    void this.advanceAccelerometerCalibration(stepIndex)
      .catch(() => {
        // advanceAccelerometerCalibration already failed the action and
        // reported it; swallow here so an auto-confirm can never surface as an
        // unhandled rejection on a telemetry callback.
      })
      .finally(() => {
        this.accelerometerAutoConfirmInFlight = false
      })
  }

  private async runAccelerometerCalibrationAction(): Promise<void> {
    const current = this.guidedActions['calibrate-accelerometer']
    const calibrationState = this.accelerometerCalibration

    if (calibrationState && (current.status === 'requested' || current.status === 'running')) {
      await this.advanceAccelerometerCalibration(calibrationState.stepIndex)
      return
    }

    const startedAtMs = Date.now()
    this.setAction('calibrate-accelerometer', {
      actionId: 'calibrate-accelerometer',
      status: 'requested',
      summary: 'Accelerometer calibration command queued.',
      instructions: defaultInstructionsForAction('calibrate-accelerometer'),
      statusTexts: [],
      startedAtMs,
      updatedAtMs: startedAtMs,
      completedAtMs: undefined
    })
    this.emit()

    try {
      this.accelerometerStartTimedOutAtMs = undefined
      await this.sendCommand(MAV_CMD.PREFLIGHT_CALIBRATION, [0, 0, 0, 0, 1, 0, 0], {
        waitForAck: true,
        ackTimeoutMs: ACCELEROMETER_START_ACK_TIMEOUT_MS
      })
      // handleCommandAck normally got here first (same ack, wire order); this
      // is the fallback for a host that resolves the ack without routing it.
      const afterAck = this.guidedActions['calibrate-accelerometer']
      if (afterAck.status === 'requested' && !this.accelerometerCalibration) {
        this.markAccelerometerCalibrationStarted(afterAck)
      }
      this.emit()
    } catch (error) {
      this.clearAccelerometerPromptFallbackTimer()
      this.clearAccelerometerAdvanceTimer()
      this.accelerometerCalibration = undefined
      // A timeout (the runtime's waiter text) is the one failure the vehicle
      // may still turn into a running calibration; a rejection is final.
      const message = error instanceof Error ? error.message : ''
      this.accelerometerStartTimedOutAtMs = /timed out/i.test(message) ? Date.now() : undefined
      this.failAction('calibrate-accelerometer', error)
      this.emit()
      throw error
    }
  }

  private async advanceAccelerometerCalibration(stepIndex: number): Promise<void> {
    const step = ACCELEROMETER_CALIBRATION_STEPS[stepIndex]
    if (!step) {
      throw new Error('Accelerometer calibration is already waiting for completion.')
    }

    const current = this.guidedActions['calibrate-accelerometer']
    this.setAction('calibrate-accelerometer', {
      ...current,
      status: 'running',
      summary: `Hold still — calibrating ${step.ctaLabel.replace(/^Confirm /, '').replace(/ Position$/, '').toLowerCase()}…`,
      instructions: [`Hold the frame still while ArduPilot records the ${step.ctaLabel.replace(/^Confirm /, '').replace(/ Position$/, '').toLowerCase()} posture.`],
      ctaLabel: undefined,
      updatedAtMs: Date.now(),
      completedAtMs: undefined
    })
    this.emit()

    try {
      this.clearAccelerometerPromptFallbackTimer()
      this.clearAccelerometerAdvanceTimer()
      // Confirmed: the autopilot is sampling this posture. The next step is
      // whatever it prompts for next (possibly this one again).
      this.accelerometerCalibration = {
        stepIndex,
        waitingForCompletion: false,
        promptedByVehicle: false
      }
      const vehicle = this.getVehicle()
      await this.session.send({
        type: 'COMMAND_ACK',
        command: 0,
        result: MAV_RESULT.TEMPORARILY_REJECTED,
        progress: 0,
        resultParam2: 0,
        targetSystem: vehicle?.systemId ?? 1,
        targetComponent: vehicle?.componentId ?? 1
      })
      this.scheduleAccelerometerStepAdvance(stepIndex)
      this.emit()
    } catch (error) {
      this.clearAccelerometerPromptFallbackTimer()
      this.clearAccelerometerAdvanceTimer()
      this.accelerometerCalibration = undefined
      this.failAction('calibrate-accelerometer', error)
      this.emit()
      throw error
    }
  }

  private markCompassCalibrationStarted(current: GuidedActionState): void {
    this.setAction('calibrate-compass', {
      ...current,
      status: 'running',
      summary: 'Compass calibration started. Rotate the vehicle through all axes.',
      updatedAtMs: Date.now(),
      completedAtMs: undefined
    })
  }

  private markAccelerometerCalibrationStarted(current: GuidedActionState): void {
    this.accelerometerCalibration = {
      stepIndex: 0,
      waitingForCompletion: false,
      promptedByVehicle: false
    }
    this.setAction('calibrate-accelerometer', {
      ...current,
      status: 'running',
      summary: 'Preparing accelerometer calibration…',
      instructions: ['Keep the vehicle level and still while ArduPilot prepares the first posture sample.'],
      ctaLabel: undefined,
      updatedAtMs: Date.now(),
      completedAtMs: undefined
    })
    this.scheduleAccelerometerPromptFallback(0)
    this.scheduleAccelerometerPromptWatchdog()
  }

  /** Best-effort post-calibration re-read; see GuidedActionServiceOptions.refreshParameters. */
  private refreshCalibrationResultParameters(patterns: readonly RegExp[]): void {
    if (!this.refreshParameters) {
      return
    }
    void this.refreshParameters(patterns).catch(() => {
      // The next full sync still corrects the snapshot; nothing to surface.
    })
  }

  private completeAccelerometerCalibration(): void {
    const current = this.guidedActions['calibrate-accelerometer']
    const now = Date.now()
    this.clearAccelerometerPromptFallbackTimer()
    this.clearAccelerometerAdvanceTimer()
    this.clearAccelerometerPromptWatchdog()
    this.accelerometerCalibration = undefined
    this.appendStatusEntry('info', 'Accelerometer calibration complete.')
    this.setAction('calibrate-accelerometer', {
      ...current,
      status: 'succeeded',
      summary: 'Accelerometer calibration complete.',
      instructions: ['Review the updated setup state before moving on to compass or radio setup.'],
      ctaLabel: undefined,
      updatedAtMs: now,
      completedAtMs: now
    })
    this.refreshCalibrationResultParameters(ACCELEROMETER_CALIBRATION_RESULT_PARAMETERS)
  }
}
