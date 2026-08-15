import type {
  ConfiguratorSnapshot,
  ParameterState,
  ServoOutputAssignment,
  ServoOutputKind
} from '@arduconfig/ardupilot-core'

import type { ServoFunctionMappingRow } from '../views/ServoFunctionMapping'
import { buildServoLiveOutput, livePwmForOutput } from './servo-live-output'

const KIND_LABEL: Record<ServoOutputKind, string> = {
  motor: 'Motor',
  'control-surface': 'Control Surface',
  'pass-through': 'RC Pass-through',
  peripheral: 'Peripheral',
  other: 'Other',
  unused: 'Disabled'
}

const KIND_TONE: Record<ServoOutputKind, ServoFunctionMappingRow['tone']> = {
  motor: 'success',
  'control-surface': 'success',
  'pass-through': 'warning',
  peripheral: 'neutral',
  other: 'neutral',
  unused: 'neutral'
}

/**
 * Map a single SERVOn assignment to a row the view can render. Pure
 * lookup — composing `motorN` labels for assignments with a known
 * motor number, dropping into the generic "Disabled" tone when the
 * channel is unused.
 *
 * The optional min/max/trim/reversed parameters carry the PWM range
 * editing fields. They may be undefined when the FC doesn't expose
 * SERVOn_MIN/MAX/TRIM/REVERSED (rare — ArduPilot always defines them
 * but a board with fewer outputs simply skips channels).
 */
export function buildServoFunctionMappingRow(
  assignment: ServoOutputAssignment,
  parameter: ParameterState,
  rangeParameters: {
    min: ParameterState | undefined
    max: ParameterState | undefined
    trim: ParameterState | undefined
    reversed: ParameterState | undefined
  }
): ServoFunctionMappingRow {
  const baseLabel = KIND_LABEL[assignment.kind]
  const toneLabel = assignment.kind === 'motor' && assignment.motorNumber !== undefined
    ? `Motor ${assignment.motorNumber}`
    : baseLabel
  return {
    parameter,
    assignment,
    tone: KIND_TONE[assignment.kind],
    toneLabel,
    minParameter: rangeParameters.min,
    maxParameter: rangeParameters.max,
    trimParameter: rangeParameters.trim,
    reversedParameter: rangeParameters.reversed
  }
}

/**
 * Build the full table from a snapshot + the assignment summary already
 * computed by deriveOutputMappingSummary. For each SERVOn_FUNCTION
 * channel, look up the matching SERVOn_MIN / MAX / TRIM / REVERSED
 * parameters as well — they live in the same param namespace and ride
 * the same draft scope when edited.
 */
export function buildServoFunctionMappingRows(
  snapshot: ConfiguratorSnapshot,
  assignments: readonly ServoOutputAssignment[]
): ServoFunctionMappingRow[] {
  const parametersById = new Map(snapshot.parameters.map((parameter) => [parameter.id, parameter]))
  return assignments
    .map((assignment): ServoFunctionMappingRow | undefined => {
      const parameter = parametersById.get(assignment.paramId)
      if (!parameter) {
        return undefined
      }
      const channel = assignment.channelNumber
      const min = parametersById.get(`SERVO${channel}_MIN`)
      const max = parametersById.get(`SERVO${channel}_MAX`)
      const row = buildServoFunctionMappingRow(assignment, parameter, {
        min,
        max,
        trim: parametersById.get(`SERVO${channel}_TRIM`),
        reversed: parametersById.get(`SERVO${channel}_REVERSED`)
      })
      // The live reading is placed against the CONFIGURED range, not a nominal
      // 1000-2000, so the bar answers "is it moving as far as this output is
      // allowed to" rather than "is it moving as far as a servo usually does".
      return {
        ...row,
        live: buildServoLiveOutput({
          pwm: livePwmForOutput(snapshot.liveVerification.servoOutputs.pwm, channel),
          min: min?.value,
          max: max?.value
        })
      }
    })
    .filter((row): row is ServoFunctionMappingRow => row !== undefined)
    .sort((left, right) => left.assignment.channelNumber - right.assignment.channelNumber)
}
