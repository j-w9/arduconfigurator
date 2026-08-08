import type { EscTelemetryState } from '@arduconfig/ardupilot-core'

/**
 * Motor Test RPM readout.
 *
 * The Motor Test tab could tell an operator that it had *commanded* a motor and
 * nothing else. Whether the motor turned, and how fast, was theirs to observe by
 * eye. ESC telemetry answers it directly — but only when the vehicle has it, so
 * most of the work here is being honest about which of three situations the
 * operator is in, because all three previously looked like a blank space:
 *
 *   - `unavailable`: the vehicle has never reported ESC telemetry this session.
 *     ArduPilot's AP_ESC_Telem::send_esc_telemetry_mavlink returns early on
 *     !_have_data, so this really does mean "no bidirectional DShot and no ESC
 *     telemetry wire", not "not yet". It is a setup answer, not a fault.
 *   - `stale`: it reported, then stopped. That is a fault worth naming.
 *   - `live`: readings inside the freshness window.
 *
 * Rows are built from the expected motor list rather than from whatever
 * telemetry arrived, so a quad with one dead ESC shows four rows with one
 * blank — the shape of the problem — instead of three rows and no hint that a
 * fourth was expected.
 */

export type EscRpmReadoutStatus = 'unavailable' | 'stale' | 'live'

export interface EscRpmRowViewModel {
  /** 1-based motor number as the Motor Test tab labels it. */
  motorNumber: number
  /** "OUT5" etc. when the mapping is known, else undefined. */
  outputLabel?: string
  /** Undefined when this motor's ESC has never reported. */
  rpm?: number
  /** True when this row's reading is inside the freshness window. */
  fresh: boolean
  voltageV?: number
  currentA?: number
  temperatureC?: number
}

export interface EscRpmReadoutViewModel {
  status: EscRpmReadoutStatus
  /** One line explaining the status. Always present. */
  summary: string
  rows: EscRpmRowViewModel[]
}

export interface EscRpmReadoutInputs {
  escTelemetry: EscTelemetryState
  /**
   * Motors the frame is expected to have, with their output labels. Empty when
   * the frame is not known yet — the readout then falls back to whatever ESCs
   * reported, which is still better than nothing.
   */
  motors: ReadonlyArray<{ motorNumber: number; outputLabel?: string }>
  nowMs: number
}

/**
 * ESC telemetry is requested at 2 Hz, so ~1.5 s is three missed frames. Short
 * enough that an operator watching a motor spin down sees the reading go stale
 * rather than freeze at the last RPM, which would read as "still spinning".
 */
const ESC_TELEMETRY_FRESHNESS_MS = 1500

export function buildEscRpmReadoutViewModel({
  escTelemetry,
  motors,
  nowMs
}: EscRpmReadoutInputs): EscRpmReadoutViewModel {
  if (!escTelemetry.everReported) {
    return {
      status: 'unavailable',
      summary:
        'No ESC telemetry from this vehicle. RPM needs either bidirectional DShot or an ESC telemetry wire — without one, the flight controller has no RPM to report.',
      rows: []
    }
  }

  const byMotor = new Map(escTelemetry.escs.map((esc) => [esc.escNumber, esc]))
  // Motors the frame expects, plus any ESC that reported outside that list —
  // an ESC on an output we did not expect is exactly the kind of surprise
  // worth showing rather than filtering away.
  const motorNumbers = [
    ...new Set([...motors.map((motor) => motor.motorNumber), ...byMotor.keys()])
  ].sort((left, right) => left - right)
  const outputLabelByMotor = new Map(motors.map((motor) => [motor.motorNumber, motor.outputLabel]))

  const rows = motorNumbers.map((motorNumber) => {
    const esc = byMotor.get(motorNumber)
    const fresh = esc !== undefined && nowMs - esc.lastSeenAtMs <= ESC_TELEMETRY_FRESHNESS_MS
    return {
      motorNumber,
      outputLabel: outputLabelByMotor.get(motorNumber),
      rpm: esc?.rpm,
      fresh,
      voltageV: esc?.voltageV,
      currentA: esc?.currentA,
      temperatureC: esc?.temperatureC
    }
  })

  const freshCount = rows.filter((row) => row.fresh).length
  if (freshCount === 0) {
    return {
      status: 'stale',
      summary: 'ESC telemetry has gone quiet. The last readings are shown; treat them as history, not live values.',
      rows
    }
  }

  const missing = rows.filter((row) => row.rpm === undefined).length
  return {
    status: 'live',
    summary:
      missing > 0
        ? `Live RPM from ${freshCount} ESC${freshCount === 1 ? '' : 's'}. ${missing} expected motor${missing === 1 ? ' is' : 's are'} not reporting — check that ESC's telemetry.`
        : `Live RPM from all ${freshCount} ESC${freshCount === 1 ? '' : 's'}.`,
    rows
  }
}
