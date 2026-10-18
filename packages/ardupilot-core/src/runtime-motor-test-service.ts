import {
  MAV_CMD,
  MOTOR_TEST_ORDER,
  MOTOR_TEST_THROTTLE_TYPE,
  type CommandAckMessage
} from '@arduconfig/protocol-mavlink'

import { evaluateMotorTestEligibility, motorTestInstructions, type MotorTestEligibilityOptions } from './motor-test.js'
import { motorTestSequenceForMotor } from './motor-test-order.js'
import { createIdleMotorTestState } from './runtime-helpers.js'
import type {
  ConfiguratorSnapshot,
  MotorTestRequest,
  MotorTestState,
  MotorTestStopResult,
  StatusTextEntry
} from './types.js'

const MOTOR_TEST_COMPLETION_BUFFER_MS = 250
/**
 * Pause between motors on the in-order sweep, so each one is felt stopping
 * before the next starts. The sweep is driven from here, not by ArduPilot's
 * own SEQUENCE mode: that mode walks the frame's test-order table (quad X:
 * front-right, rear-right, rear-left, front-left), which is not the M1..Mn
 * order the Motors tab shows, and the operator saw "2-1-3-4" against a list
 * that read 1-2-3-4.
 */
export const MOTOR_TEST_SWEEP_GAP_MS = 500

export interface MotorTestHost {
  getSnapshot(): ConfiguratorSnapshot
  sendCommand(
    command: number,
    params: number[],
    options?: { waitForAck?: boolean; ackTimeoutMs?: number; rejectAckOnFailure?: boolean }
  ): Promise<CommandAckMessage | void>
  appendStatusEntry(severity: StatusTextEntry['severity'], text: string): void
  emit(): void
}

/**
 * Motor-test orchestration extracted from the runtime. Owns the
 * motor-test state machine + completion timer. Talks to the wider
 * runtime through a tight host interface so the service does not
 * reach into snapshot internals directly.
 */
export class MotorTestService {
  private state: MotorTestState = createIdleMotorTestState()
  private completionTimer?: ReturnType<typeof setTimeout>
  /**
   * The per-motor DO_MOTOR_TEST sequence numbers a SIMULTANEOUS run started.
   *
   * Needed because stop() has to command each of them back to zero. ArduPilot's
   * _output_test_seq writes only the motor named in the command and never
   * touches the others, so a single abort left motors 2..N spinning until the
   * FC's own per-motor timeout — with the UI already reporting the test
   * stopped. The battery-current calibration uses exactly this mode.
   */
  private activeSimultaneousSequences: number[] = []
  /** Bumped by run()/stop()/reset(); an in-order sweep stops when it changes. */
  private sweepToken = 0

  constructor(private readonly host: MotorTestHost) {}

  getState(): MotorTestState {
    return this.state
  }

  reset(): void {
    this.state = createIdleMotorTestState()
    this.clearCompletionTimer()
    this.sweepToken += 1
    // Otherwise a stop after a reconnect would fire aborts for the PREVIOUS
    // session's motors.
    this.activeSimultaneousSequences = []
  }

  clearCompletionTimer(): void {
    if (this.completionTimer) {
      clearTimeout(this.completionTimer)
      this.completionTimer = undefined
    }
  }

  hasActiveTest(): boolean {
    return this.state.status === 'requested' || this.state.status === 'running'
  }

  async run(request: MotorTestRequest, options: MotorTestEligibilityOptions = {}): Promise<void> {
    // The same options the UI gate used must reach this enforced gate, or a
    // request the UI allowed (e.g. an Expert duration ceiling) is refused.
    const eligibility = evaluateMotorTestEligibility(this.host.getSnapshot(), request, options)
    if (!eligibility.allowed) {
      throw new Error(eligibility.reasons[0] ?? 'Motor test request is not currently allowed.')
    }

    const selectedOutput = eligibility.selectedOutput
    const selectedOutputs = eligibility.selectedOutputs
    // Simultaneous takes precedence if somehow both set; the UI sends one.
    const runningSimultaneous = request.runAllOutputsSimultaneous === true
    const runningSequential = request.runAllOutputs === true && !runningSimultaneous
    const runningAllOutputs = runningSequential || runningSimultaneous
    const selectedOutputCount = runningAllOutputs ? selectedOutputs.length : 1
    const singleOutputChannel = selectedOutput?.channelNumber ?? request.outputChannel
    // ArduCopter matches DO_MOTOR_TEST param1 against the frame's testing
    // order (AP_MotorsMatrix _test_order), not the MOT_n motor number, and
    // ignores param6. Translate via FRAME_CLASS/FRAME_TYPE; unknown frames
    // pass the motor number through unchanged and say so.
    const snapshotParameters = this.host.getSnapshot().parameters
    const frameClass = snapshotParameters.find((parameter) => parameter.id === 'FRAME_CLASS')?.value
    const frameType = snapshotParameters.find((parameter) => parameter.id === 'FRAME_TYPE')?.value
    const sequenceMapping = selectedOutput?.motorNumber !== undefined
      ? motorTestSequenceForMotor(frameClass, frameType, selectedOutput.motorNumber)
      : undefined
    const singleMotorSequence = sequenceMapping?.sequence
    const instructions = motorTestInstructions(request, selectedOutput, selectedOutputs)
    const startedAtMs = Date.now()
    this.state = {
      status: 'requested',
      summary: runningSimultaneous
        ? `Queueing a simultaneous motor test across all ${selectedOutputCount} mapped motors.`
        : runningSequential
          ? `Queueing a motor test across all ${selectedOutputCount} mapped motors.`
          : selectedOutput?.motorNumber !== undefined
            ? `Queueing a motor test for OUT${singleOutputChannel} / M${selectedOutput.motorNumber}.`
            : `Queueing a motor test for OUT${singleOutputChannel}.`,
      instructions,
      allOutputsSelected: runningAllOutputs,
      simultaneousOutputs: runningSimultaneous,
      selectedOutputChannel: runningAllOutputs ? undefined : singleOutputChannel,
      selectedOutputCount,
      selectedMotorNumber: runningAllOutputs ? undefined : selectedOutput?.motorNumber,
      throttlePercent: request.throttlePercent,
      durationSeconds: request.durationSeconds,
      startedAtMs,
      updatedAtMs: startedAtMs,
      completedAtMs: undefined
    }
    this.host.emit()

    try {
      if (runningSimultaneous) {
        // Fire one DO_MOTOR_TEST per motor back-to-back. ArduPilot's
        // _output_test_seq writes only the matching motor and never zeroes
        // the others, so every motor keeps spinning until the shared
        // per-motor timeout. Each command uses the motor's test-order
        // sequence (param1) with motor_count=1 so the FC doesn't itself sweep.
        const unmappedMotors: number[] = []
        this.activeSimultaneousSequences = []
        for (const output of selectedOutputs) {
          const perMotor = output.motorNumber !== undefined
            ? motorTestSequenceForMotor(frameClass, frameType, output.motorNumber)
            : undefined
          if (perMotor?.mapped === false && output.motorNumber !== undefined) {
            unmappedMotors.push(output.motorNumber)
          }
          const sequence = perMotor?.sequence ?? output.motorNumber ?? 1
          // Recorded BEFORE the send: a command that throws mid-sweep may still
          // have started that motor, so stop() must know to zero it.
          this.activeSimultaneousSequences.push(sequence)
          await this.host.sendCommand(
            MAV_CMD.DO_MOTOR_TEST,
            [sequence, MOTOR_TEST_THROTTLE_TYPE.PERCENT, request.throttlePercent, request.durationSeconds, 1, MOTOR_TEST_ORDER.DEFAULT, 0],
            { waitForAck: true }
          )
        }
        if (unmappedMotors.length > 0) {
          this.host.appendStatusEntry(
            'warning',
            `Motor test: FRAME_CLASS/FRAME_TYPE ${frameClass ?? '?'} / ${frameType ?? '?'} has no known test-order table — sent raw motor numbers for M${unmappedMotors.join(', M')}. Verify which motors actually spin.`
          )
        }
      } else if (runningSequential) {
        // One motor at a time, M1 upward -- the order the Motors tab lists
        // them -- each as its own single-motor DO_MOTOR_TEST. The first goes
        // now; the rest follow from a timer (see continueSweep), each after
        // the previous one's window plus a short gap.
        this.sweepToken += 1
        const token = this.sweepToken
        const ordered = [...selectedOutputs].sort(
          (a, b) => (a.motorNumber ?? Number.MAX_SAFE_INTEGER) - (b.motorNumber ?? Number.MAX_SAFE_INTEGER) || a.channelNumber - b.channelNumber
        )
        const unmappedMotors: number[] = []
        const sequences = ordered.map((output) => {
          const perMotor = output.motorNumber !== undefined
            ? motorTestSequenceForMotor(frameClass, frameType, output.motorNumber)
            : undefined
          if (perMotor?.mapped === false && output.motorNumber !== undefined) {
            unmappedMotors.push(output.motorNumber)
          }
          return perMotor?.sequence ?? output.motorNumber ?? 1
        })
        if (unmappedMotors.length > 0) {
          this.host.appendStatusEntry(
            'warning',
            `Motor test: FRAME_CLASS/FRAME_TYPE ${frameClass ?? '?'} / ${frameType ?? '?'} has no known test-order table — sending raw motor numbers for M${unmappedMotors.join(', M')}. Verify which motors actually spin.`
          )
        }
        this.activeSimultaneousSequences = [sequences[0]]
        await this.host.sendCommand(
          MAV_CMD.DO_MOTOR_TEST,
          [sequences[0], MOTOR_TEST_THROTTLE_TYPE.PERCENT, request.throttlePercent, request.durationSeconds, 1, MOTOR_TEST_ORDER.DEFAULT, 0],
          { waitForAck: true }
        )
        void this.continueSweep(token, ordered, sequences, request)
      } else {
        this.activeSimultaneousSequences = []
        const commandParams: number[] = [singleMotorSequence ?? 1, MOTOR_TEST_THROTTLE_TYPE.PERCENT, request.throttlePercent, request.durationSeconds, 1, MOTOR_TEST_ORDER.DEFAULT, 0]

        if (selectedOutput?.motorNumber !== undefined && sequenceMapping?.mapped === false) {
          this.host.appendStatusEntry(
            'warning',
            `Motor test: FRAME_CLASS/FRAME_TYPE ${frameClass ?? '?'} / ${frameType ?? '?'} has no known test-order table — sending the raw motor number ${selectedOutput.motorNumber}. Verify which motor actually spins.`
          )
        }

        await this.host.sendCommand(MAV_CMD.DO_MOTOR_TEST, commandParams, { waitForAck: true })
      }

      const runningAtMs = Date.now()
      const selectedOutputLabel = runningAllOutputs
        ? `all ${selectedOutputCount} mapped motors`
        : selectedOutput?.motorNumber !== undefined
          ? `OUT${singleOutputChannel} / M${selectedOutput.motorNumber}`
          : `OUT${singleOutputChannel}`
      this.state = {
        ...this.state,
        status: 'running',
        summary: runningSimultaneous
          ? `Motor test running on ${selectedOutputLabel} simultaneously at ${request.throttlePercent}% for ${request.durationSeconds.toFixed(1)} seconds.`
          : runningSequential
            ? `Motor test running across ${selectedOutputLabel} at ${request.throttlePercent}% for ${request.durationSeconds.toFixed(1)} seconds per motor.`
            : `Motor test running on ${selectedOutputLabel} at ${request.throttlePercent}% for ${request.durationSeconds.toFixed(1)} seconds.`,
        instructions,
        updatedAtMs: runningAtMs,
        completedAtMs: undefined
      }
      this.host.appendStatusEntry(
        'warning',
        runningSimultaneous
          ? `Motor test started on ${selectedOutputLabel} simultaneously at ${request.throttlePercent}% for ${request.durationSeconds.toFixed(1)}s.`
          : runningSequential
            ? `Motor test started across ${selectedOutputLabel} at ${request.throttlePercent}% for ${request.durationSeconds.toFixed(1)}s per motor.`
            : `Motor test started on ${selectedOutputLabel} at ${request.throttlePercent}% for ${request.durationSeconds.toFixed(1)}s.`
      )
      this.host.emit()
      this.scheduleCompletion()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown motor test error.'
      this.clearCompletionTimer()
      this.state = {
        ...this.state,
        status: 'failed',
        summary: message,
        updatedAtMs: Date.now(),
        completedAtMs: Date.now()
      }
      this.host.emit()
      throw error
    }
  }

  /**
   * The rest of an in-order sweep: motor i+1 starts after motor i's window
   * plus the gap. Stops silently when the token changes (stop, reset, or a
   * new run) or the state has left 'running'. A send that fails ends the
   * sweep and says so; the FC's per-motor timeout has already stopped the
   * previous motor by then.
   */
  private async continueSweep(
    token: number,
    ordered: readonly { channelNumber: number; motorNumber?: number }[],
    sequences: readonly number[],
    request: MotorTestRequest
  ): Promise<void> {
    const stepMs = Math.max(request.durationSeconds * 1000, 0) + MOTOR_TEST_SWEEP_GAP_MS
    for (let index = 1; index < ordered.length; index += 1) {
      await new Promise((resolve) => setTimeout(resolve, stepMs))
      if (token !== this.sweepToken || this.state.status !== 'running') {
        return
      }
      const output = ordered[index]
      const sequence = sequences[index]
      this.activeSimultaneousSequences = [sequence]
      try {
        await this.host.sendCommand(
          MAV_CMD.DO_MOTOR_TEST,
          [sequence, MOTOR_TEST_THROTTLE_TYPE.PERCENT, request.throttlePercent, request.durationSeconds, 1, MOTOR_TEST_ORDER.DEFAULT, 0],
          { waitForAck: true }
        )
      } catch (error) {
        if (token !== this.sweepToken) return
        const message = error instanceof Error ? error.message : 'Unknown motor test error.'
        this.clearCompletionTimer()
        this.state = {
          ...this.state,
          status: 'failed',
          summary: `Motor test sweep stopped at M${output.motorNumber ?? '?'}: ${message}`,
          updatedAtMs: Date.now(),
          completedAtMs: Date.now()
        }
        this.host.appendStatusEntry('error', `Motor test sweep stopped at M${output.motorNumber ?? '?'}: ${message}`)
        this.host.emit()
        return
      }
      if (token !== this.sweepToken) return
      this.state = {
        ...this.state,
        summary: `Motor test running on OUT${output.channelNumber}${output.motorNumber !== undefined ? ` / M${output.motorNumber}` : ''} (${index + 1} of ${ordered.length}) at ${request.throttlePercent}% for ${request.durationSeconds.toFixed(1)} seconds per motor.`,
        updatedAtMs: Date.now()
      }
      this.host.emit()
    }
  }

  /**
   * Operator-initiated early abort via a zero-throttle DO_MOTOR_TEST (the
   * FC's per-motor timeout remains the hard safety net). Best-effort: a
   * failed abort is surfaced rather than thrown.
   *
   * Returns whether the abort reached the wire and whether it was ACKed, so
   * a caller that wants to start ANOTHER motor immediately behind the stop
   * (guided identify's advance-on-selection) can refuse to do so while the
   * previous motor's state is unproven. The wire behaviour is unchanged —
   * this only stops throwing the evidence away.
   */
  async stop(): Promise<MotorTestStopResult> {
    if (!this.hasActiveTest()) {
      // Nothing running: either it never started or the FC's own per-motor
      // timeout already ended it. No command to send, nothing unproven.
      return { sent: false, acknowledged: true }
    }
    this.clearCompletionTimer()
    // Ends an in-order sweep before its next motor fires.
    this.sweepToken += 1
    let acknowledged = true
    // A simultaneous run started every motor individually, so stopping it has
    // to stop every motor individually. One abort zeroed motor 1 and left the
    // rest turning while the UI said the test had stopped.
    const abortSequences = this.activeSimultaneousSequences.length > 0 ? [...this.activeSimultaneousSequences] : [1]
    for (const sequence of abortSequences) {
      try {
        await this.host.sendCommand(
          MAV_CMD.DO_MOTOR_TEST,
          [sequence, MOTOR_TEST_THROTTLE_TYPE.PERCENT, 0, 0, 1, MOTOR_TEST_ORDER.DEFAULT, 0],
          { waitForAck: true }
        )
      } catch {
        // Keep going: an unacknowledged abort for one motor must not leave the
        // remaining motors uncommanded. The result reports the shortfall.
        acknowledged = false
      }
    }
    this.activeSimultaneousSequences = []
    const now = Date.now()
    this.state = {
      ...this.state,
      status: 'failed',
      summary: acknowledged
        ? 'Motor test stopped on request — a zero-throttle abort was sent and acknowledged by the autopilot.'
        : 'Motor test stop was requested but the abort was not acknowledged; the autopilot still enforces its own per-motor timeout (≤ the configured duration), so the motor stops on that.',
      updatedAtMs: now,
      completedAtMs: now
    }
    this.host.appendStatusEntry(
      acknowledged ? 'warning' : 'error',
      acknowledged
        ? 'Motor test stopped on request.'
        : 'Motor test stop sent but not acknowledged; the autopilot per-motor timeout still applies.'
    )
    this.host.emit()
    return { sent: true, acknowledged }
  }

  private scheduleCompletion(): void {
    this.clearCompletionTimer()
    const motorCount = Math.max(this.state.selectedOutputCount ?? 1, 1)
    const durationMs = Math.max((this.state.durationSeconds ?? 0) * 1000, 0)
    // Window length per mode: simultaneous shares one timeout (total ==
    // duration); the in-order sweep is per-motor plus the gap this service
    // itself leaves between motors; single is exactly the one window.
    const totalDurationMs = this.state.simultaneousOutputs
      ? durationMs
      : this.state.allOutputsSelected
        ? durationMs * motorCount + MOTOR_TEST_SWEEP_GAP_MS * Math.max(motorCount - 1, 0)
        : durationMs
    this.completionTimer = setTimeout(() => {
      if (this.state.status !== 'running') {
        return
      }

      const selectedOutputLabel = this.state.allOutputsSelected
        ? `all ${this.state.selectedOutputCount ?? 0} mapped motors`
        : this.state.selectedOutputChannel !== undefined
          ? `OUT${this.state.selectedOutputChannel}${this.state.selectedMotorNumber !== undefined ? ` / M${this.state.selectedMotorNumber}` : ''}`
          : 'the selected output'
      this.state = {
        ...this.state,
        status: 'succeeded',
        // The protocol has no "motor test done" message, so completion is
        // never observed — only that the window elapsed. The FC enforces the
        // per-motor timeout and stops the motors; the copy says so.
        summary: this.state.allOutputsSelected
          ? `Estimated motor-test window elapsed for ${selectedOutputLabel}; the autopilot runs and stops each motor on its own per-motor timeout (exact total is enforced by the autopilot, not measured here). Confirm what you observed.`
          : `Motor-test window elapsed for ${selectedOutputLabel}; the autopilot stops the motor on its own timeout. Confirm what you observed.`,
        updatedAtMs: Date.now(),
        completedAtMs: Date.now()
      }
      this.host.appendStatusEntry(
        'info',
        this.state.allOutputsSelected
          ? `Estimated motor-test window elapsed for ${selectedOutputLabel} (the autopilot enforces the real per-motor timeout).`
          : `Motor-test window elapsed for ${selectedOutputLabel} (the autopilot enforces the timeout).`
      )
      this.host.emit()
      this.completionTimer = undefined
    }, totalDurationMs + MOTOR_TEST_COMPLETION_BUFFER_MS)
  }
}
