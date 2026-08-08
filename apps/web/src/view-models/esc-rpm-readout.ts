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
  /**
   * 1-based OUTPUT CHANNEL. ESC telemetry is indexed by servo output, not by
   * motor number — AP_BLHeli passes `motor_map[esc]` and bdshot passes
   * `normalized_chan` to update_rpm() — so the row identity has to be the
   * channel or the two lists cannot be joined.
   */
  channelNumber: number
  /** "M3" when this output drives a motor; absent for a non-motor output. */
  motorLabel?: string
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
   * Motor outputs the frame is expected to have, keyed by OUTPUT CHANNEL —
   * `motorNumber` is only a label. Empty when the frame is not known yet; the
   * readout then falls back to whatever ESCs reported, which still beats
   * nothing.
   */
  motors: ReadonlyArray<{ channelNumber: number; motorNumber?: number }>
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

  // `escNumber` is an output channel (see EscRpmRowViewModel.channelNumber).
  const byChannel = new Map(escTelemetry.escs.map((esc) => [esc.escNumber, esc]))
  // Expected motor outputs, plus any channel that reported outside that list —
  // an ESC on an output we did not expect is exactly the kind of surprise
  // worth showing rather than filtering away.
  const channelNumbers = [
    ...new Set([...motors.map((motor) => motor.channelNumber), ...byChannel.keys()])
  ].sort((left, right) => left - right)
  const motorNumberByChannel = new Map(motors.map((motor) => [motor.channelNumber, motor.motorNumber]))

  const rows = channelNumbers.map((channelNumber) => {
    const esc = byChannel.get(channelNumber)
    const fresh = esc !== undefined && nowMs - esc.lastSeenAtMs <= ESC_TELEMETRY_FRESHNESS_MS
    const motorNumber = motorNumberByChannel.get(channelNumber)
    return {
      channelNumber,
      motorLabel: motorNumber !== undefined ? `M${motorNumber}` : undefined,
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
        ? `Live RPM from ${freshCount} ESC${freshCount === 1 ? '' : 's'}. ${missing} expected output${missing === 1 ? ' is' : 's are'} not reporting — check that ESC's telemetry.`
        : `Live RPM from all ${freshCount} ESC${freshCount === 1 ? '' : 's'}.`,
    rows
  }
}
