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
  StatusTextEntry
} from './types.js'

const MOTOR_TEST_COMPLETION_BUFFER_MS = 250

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

  constructor(private readonly host: MotorTestHost) {}

  getState(): MotorTestState {
    return this.state
  }

  reset(): void {
    this.state = createIdleMotorTestState()
    this.clearCompletionTimer()
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
        for (const output of selectedOutputs) {
          const perMotor = output.motorNumber !== undefined
            ? motorTestSequenceForMotor(frameClass, frameType, output.motorNumber)
            : undefined
          if (perMotor?.mapped === false && output.motorNumber !== undefined) {
            unmappedMotors.push(output.motorNumber)
          }
          await this.host.sendCommand(
            MAV_CMD.DO_MOTOR_TEST,
            [perMotor?.sequence ?? output.motorNumber ?? 1, MOTOR_TEST_THROTTLE_TYPE.PERCENT, request.throttlePercent, request.durationSeconds, 1, MOTOR_TEST_ORDER.DEFAULT, 0],
            { waitForAck: true }
          )
        }
        if (unmappedMotors.length > 0) {
          this.host.appendStatusEntry(
            'warning',
            `Motor test: FRAME_CLASS/FRAME_TYPE ${frameClass ?? '?'} / ${frameType ?? '?'} has no known test-order table — sent raw motor numbers for M${unmappedMotors.join(', M')}. Verify which motors actually spin.`
          )
        }
      } else {
        // param6 is SEQUENCE on the all-outputs sweep (Copter iterates count
        // motors from param1 in test order) and DEFAULT(0) on single-motor.
        const commandParams: number[] = runningSequential
          ? [1, MOTOR_TEST_THROTTLE_TYPE.PERCENT, request.throttlePercent, request.durationSeconds, selectedOutputCount, MOTOR_TEST_ORDER.SEQUENCE, 0]
          : [singleMotorSequence ?? 1, MOTOR_TEST_THROTTLE_TYPE.PERCENT, request.throttlePercent, request.durationSeconds, 1, MOTOR_TEST_ORDER.DEFAULT, 0]

        if (!runningSequential && selectedOutput?.motorNumber !== undefined && sequenceMapping?.mapped === false) {
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
   * Operator-initiated early abort via a zero-throttle DO_MOTOR_TEST (the
   * FC's per-motor timeout remains the hard safety net). Best-effort: a
   * failed abort is surfaced rather than thrown.
   */
  async stop(): Promise<void> {
    if (!this.hasActiveTest()) {
      return
    }
    this.clearCompletionTimer()
    let acknowledged = true
    try {
      await this.host.sendCommand(
        MAV_CMD.DO_MOTOR_TEST,
        [1, MOTOR_TEST_THROTTLE_TYPE.PERCENT, 0, 0, 1, MOTOR_TEST_ORDER.DEFAULT, 0],
        { waitForAck: true }
      )
    } catch {
      acknowledged = false
    }
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
  }

  private scheduleCompletion(): void {
    this.clearCompletionTimer()
    const motorCount = Math.max(this.state.selectedOutputCount ?? 1, 1)
    const durationMs = Math.max((this.state.durationSeconds ?? 0) * 1000, 0)
    // Window length per mode: simultaneous shares one timeout (total ==
    // duration); the sequential sweep is per-motor plus an inter-motor pause
    // estimate (the 0.5× factor — only used to leave the 'running' UI state,
    // not a measured value); single is exactly the one window.
    const totalDurationMs = this.state.simultaneousOutputs
      ? durationMs
      : this.state.allOutputsSelected
        ? durationMs * motorCount + durationMs * 0.5 * Math.max(motorCount - 1, 0)
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
