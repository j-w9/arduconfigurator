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
  ACCELEROMETER_CALIBRATION_STEPS,
  GUIDED_ACTION_IDS,
  appendGuidedActionText,
  buildAccelerometerCalibrationGuidedAction,
  createIdleGuidedActions,
  defaultInstructionsForAction,
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

const ACCELCAL_SUCCESS_VALUE = 16777215
const ACCELCAL_FAILED_VALUE = 16777216

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
  accelerometerInitialWarmupMs?: number
  accelerometerStepAdvanceMs?: number
  accelerometerCompletionFallbackMs?: number
  compassGuidanceTimeoutMs?: number
  compassReportWatchdogMs?: number
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
  private readonly accelerometerInitialWarmupMs: number
  private readonly accelerometerStepAdvanceMs: number
  private readonly accelerometerCompletionFallbackMs: number
  private readonly compassGuidanceTimeoutMs: number
  private readonly compassReportWatchdogMs: number

  private guidedActions = createIdleGuidedActions()
  private accelerometerCalibration?: AccelerometerCalibrationProgressState
  private accelerometerPromptFallbackTimer?: ReturnType<typeof setTimeout>
  private accelerometerAdvanceTimer?: ReturnType<typeof setTimeout>
  private compassGuidanceTimer?: ReturnType<typeof setTimeout>
  private compassReportWatchdogTimer?: ReturnType<typeof setTimeout>
  // ArduPilot emits one MAG_CAL_REPORT per compass (common.xml marks
  // compass_id instance="true"). Aggregate terminal reports per compassId and
  // finalize only once every compass named in cal_mask has reported. Cleared
  // on cal start / finalize / reset.
  private magCalReports = new Map<number, { calStatus: number; autosaved: number }>()
  private magCalExpectedMask = 0

  constructor(options: GuidedActionServiceOptions) {
    this.session = options.session
    this.getVehicle = options.getVehicle
    this.getParameters = options.getParameters
    this.getParameterSyncStatus = options.getParameterSyncStatus
    this.isConnected = options.isConnected
    this.sendCommand = options.sendCommand
    this.appendStatusEntry = options.appendStatusEntry
    this.emit = options.emit
    this.accelerometerInitialWarmupMs =
      options.accelerometerInitialWarmupMs ?? DEFAULT_ACCELEROMETER_INITIAL_WARMUP_MS
    this.accelerometerStepAdvanceMs =
      options.accelerometerStepAdvanceMs ?? DEFAULT_ACCELEROMETER_STEP_ADVANCE_MS
    this.accelerometerCompletionFallbackMs =
      options.accelerometerCompletionFallbackMs ?? DEFAULT_ACCELEROMETER_COMPLETION_FALLBACK_MS
    this.compassGuidanceTimeoutMs =
      options.compassGuidanceTimeoutMs ?? DEFAULT_COMPASS_GUIDANCE_TIMEOUT_MS
    this.compassReportWatchdogMs =
      options.compassReportWatchdogMs ?? DEFAULT_COMPASS_REPORT_WATCHDOG_MS
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
   * the recovery path that doesn't require a reboot. Marks the action failed
   * with a cancelled summary so the write gate clears immediately.
   */
  cancelAction(actionId: GuidedActionId): void {
    const current = this.guidedActions[actionId]
    if (current.status !== 'requested' && current.status !== 'running') {
      return
    }

    if (actionId === 'calibrate-compass') {
      // Proven cancel path (same as reset()): stop the onboard calibrators.
      if (this.isConnected()) {
        void this.sendCommand(MAV_CMD.DO_CANCEL_MAG_CAL, [0, 0, 0, 0, 0, 0, 0]).catch(() => {})
      }
      this.magCalReports = new Map()
      this.magCalExpectedMask = 0
    }

    if (actionId === 'calibrate-accelerometer') {
      // MAVLink has no accel-cal abort command; the onboard routine keeps
      // waiting for pose confirmations until its own timeout or a reboot.
      this.clearAccelerometerPromptFallbackTimer()
      this.clearAccelerometerAdvanceTimer()
      this.accelerometerCalibration = undefined
      this.appendStatusEntry(
        'warning',
        'Accelerometer calibration cancelled in the configurator — the onboard routine may keep waiting until it times out or the autopilot reboots.'
      )
    }

    this.failAction(actionId, new Error('Cancelled by operator.'))
    this.appendStatusEntry('info', `Guided action cancelled by operator (${actionId}).`)
    this.emit()
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
        await this.performCommandGuidedAction(
          'reboot-autopilot',
          'Autopilot reboot request queued.',
          'Reboot request sent. Expect the link to drop if the autopilot accepts it.',
          defaultInstructionsForAction('reboot-autopilot'),
          async () => {
            await this.sendCommand(MAV_CMD.PREFLIGHT_REBOOT_SHUTDOWN, [1, 0, 0, 0, 0, 0, 0])
          }
        )
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
    if (
      !vehicle ||
      vehicle.systemId !== systemId ||
      vehicle.componentId !== componentId ||
      (current.status === 'idle' && !this.accelerometerCalibration)
    ) {
      return
    }

    const commandValue = Math.round(message.params[0] ?? 0)
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

    this.clearAccelerometerPromptFallbackTimer()
    this.clearAccelerometerAdvanceTimer()
    this.accelerometerCalibration = {
      stepIndex,
      waitingForCompletion: false
    }
    this.setAction(
      'calibrate-accelerometer',
      buildAccelerometerCalibrationGuidedAction(stepIndex, this.guidedActions['calibrate-accelerometer'])
    )
  }

  /** Vehicle progress for an in-flight onboard mag calibration. */
  handleMagCalProgress(message: MagCalProgressMessage): void {
    const current = this.guidedActions['calibrate-compass']
    if (current.status !== 'requested' && current.status !== 'running') {
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
    this.setAction('calibrate-compass', {
      ...current,
      status: 'running',
      summary: `Compass calibration ${pct}% — keep rotating the vehicle through all axes.`,
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
    if (current.status !== 'requested' && current.status !== 'running') {
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

    const message = 'No enabled compass detected on this vehicle. Skip this step or enable a compass first.'
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

      if (actionId === 'calibrate-accelerometer' && (nextStatus === 'succeeded' || nextStatus === 'failed')) {
        this.accelerometerCalibration = undefined
        this.clearAccelerometerPromptFallbackTimer()
        this.clearAccelerometerAdvanceTimer()
        if (nextStatus === 'succeeded') {
          this.appendStatusEntry('info', 'Accelerometer calibration complete.')
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
        // cannot be delivered. Don't pretend it was — say plainly the
        // onboard calibration will self-time-out on the vehicle.
        this.appendStatusEntry(
          'warning',
          'Disconnected during compass calibration — the cancel could not be sent; the onboard magnetometer calibration will self-time-out on the vehicle.'
        )
      }
    }
    this.guidedActions = createIdleGuidedActions()
    this.accelerometerCalibration = undefined
    this.magCalReports = new Map()
    this.magCalExpectedMask = 0
    this.clearAccelerometerPromptFallbackTimer()
    this.clearAccelerometerAdvanceTimer()
    this.clearCompassGuidanceTimer()
    this.clearCompassReportWatchdog()
  }

  destroy(): void {
    this.clearAccelerometerPromptFallbackTimer()
    this.clearAccelerometerAdvanceTimer()
    this.clearCompassGuidanceTimer()
    this.clearCompassReportWatchdog()
  }

  private clearAccelerometerPromptFallbackTimer(): void {
    if (!this.accelerometerPromptFallbackTimer) {
      return
    }

    clearTimeout(this.accelerometerPromptFallbackTimer)
    this.accelerometerPromptFallbackTimer = undefined
  }

  private clearAccelerometerAdvanceTimer(): void {
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

  private scheduleAccelerometerStepAdvance(stepIndex: number): void {
    this.clearAccelerometerAdvanceTimer()
    this.accelerometerAdvanceTimer = setTimeout(() => {
      this.accelerometerAdvanceTimer = undefined
      const current = this.guidedActions['calibrate-accelerometer']
      const state = this.accelerometerCalibration
      if (!state || state.stepIndex !== stepIndex || current.status === 'failed' || current.status === 'succeeded') {
        return
      }

      if (stepIndex + 1 < ACCELEROMETER_CALIBRATION_STEPS.length) {
        this.accelerometerCalibration = {
          stepIndex: stepIndex + 1,
          waitingForCompletion: false
        }
        this.setAction(
          'calibrate-accelerometer',
          buildAccelerometerCalibrationGuidedAction(stepIndex + 1, this.guidedActions['calibrate-accelerometer'])
        )
      } else {
        this.accelerometerCalibration = {
          stepIndex,
          waitingForCompletion: true
        }
        this.setAction('calibrate-accelerometer', {
          ...this.guidedActions['calibrate-accelerometer'],
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

  private scheduleAccelerometerCompletionFallback(stepIndex: number): void {
    this.clearAccelerometerAdvanceTimer()
    this.accelerometerAdvanceTimer = setTimeout(() => {
      this.accelerometerAdvanceTimer = undefined
      const current = this.guidedActions['calibrate-accelerometer']
      const state = this.accelerometerCalibration
      if (
        !state ||
        state.stepIndex !== stepIndex ||
        !state.waitingForCompletion ||
        current.status === 'failed' ||
        current.status === 'succeeded'
      ) {
        return
      }

      this.completeAccelerometerCalibration()
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
        await this.sendCommand(MAV_CMD.PREFLIGHT_CALIBRATION, [0, 0, 0, 0, 2, 0, 0], {
          waitForAck: true,
          ackTimeoutMs: 15000
        })
      }
    )

    const current = this.guidedActions['calibrate-level']
    if (current.status === 'running') {
      const now = Date.now()
      this.setAction('calibrate-level', {
        ...current,
        status: 'succeeded',
        summary: 'Board level calibration complete.',
        instructions: [
          'AHRS_TRIM_X and AHRS_TRIM_Y were updated; re-pull parameters if you want a clean post-cal snapshot.'
        ],
        updatedAtMs: now,
        completedAtMs: now
      })
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
      const message = 'No enabled compass detected on this vehicle. Skip this step or enable a compass first.'
      this.failAction('calibrate-compass', new Error(message))
      this.appendStatusEntry('warning', message)
      this.emit()
      return
    }

    // Fresh per-compass aggregation for this run — a stale report set
    // from an aborted previous cal must not contaminate the new one.
    this.magCalReports = new Map()
    this.magCalExpectedMask = 0

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
      await this.sendCommand(MAV_CMD.PREFLIGHT_CALIBRATION, [0, 0, 0, 0, 1, 0, 0], {
        waitForAck: true,
        ackTimeoutMs: 3000
      })
      this.accelerometerCalibration = {
        stepIndex: 0,
        waitingForCompletion: false
      }
      this.setAction('calibrate-accelerometer', {
        ...this.guidedActions['calibrate-accelerometer'],
        status: 'running',
        summary: 'Preparing accelerometer calibration…',
        instructions: ['Keep the vehicle level and still while ArduPilot prepares the first posture sample.'],
        ctaLabel: undefined,
        updatedAtMs: Date.now(),
        completedAtMs: undefined
      })
      this.scheduleAccelerometerPromptFallback(0)
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

  private async advanceAccelerometerCalibration(stepIndex: number): Promise<void> {
    const step = ACCELEROMETER_CALIBRATION_STEPS[stepIndex]
    if (!step) {
      throw new Error('Accelerometer calibration is already waiting for completion.')
    }

    const current = this.guidedActions['calibrate-accelerometer']
    this.setAction('calibrate-accelerometer', {
      ...current,
      status: 'running',
      summary: `Confirming ${step.ctaLabel.replace(/^Confirm /, '').replace(/ Position$/, '').toLowerCase()}...`,
      instructions: [`Hold the frame still while ArduPilot records the ${step.ctaLabel.replace(/^Confirm /, '').replace(/ Position$/, '').toLowerCase()} posture.`],
      ctaLabel: undefined,
      updatedAtMs: Date.now(),
      completedAtMs: undefined
    })
    this.emit()

    try {
      this.clearAccelerometerPromptFallbackTimer()
      this.clearAccelerometerAdvanceTimer()
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

  private completeAccelerometerCalibration(): void {
    const current = this.guidedActions['calibrate-accelerometer']
    const now = Date.now()
    this.clearAccelerometerPromptFallbackTimer()
    this.clearAccelerometerAdvanceTimer()
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
  }
}
