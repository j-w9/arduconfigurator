import {
  arducopterMotorNumberForServoFunction,
  expectedMotorCountForArducopterFrameClass,
  formatArducopterFrameClass,
  formatArducopterFrameType,
  formatArducopterServoFunction,
  isArducopterFrameTypeIgnored,
} from '@arduconfig/param-metadata'

import type { ConfiguratorSnapshot, VehicleIdentity } from './types.js'

type VehicleClass = VehicleIdentity['vehicle']

export interface AirframeSummary {
  frameClassValue?: number
  frameClassLabel: string
  frameTypeValue?: number
  frameTypeLabel: string
  expectedMotorCount?: number
  frameTypeIgnored: boolean
}

export type ServoOutputKind = 'motor' | 'control-surface' | 'unused' | 'pass-through' | 'peripheral' | 'other'

export interface ServoOutputAssignment {
  channelNumber: number
  paramId: string
  functionValue: number
  functionLabel: string
  kind: ServoOutputKind
  motorNumber?: number
}

export interface OutputMappingSummary {
  airframe: AirframeSummary
  outputs: ServoOutputAssignment[]
  motorOutputs: ServoOutputAssignment[]
  configuredAuxOutputs: ServoOutputAssignment[]
  disabledOutputs: ServoOutputAssignment[]
  notes: string[]
}

// ArduPilot exposes up to 32 SERVOn outputs on high-output boards (Cube
// Orange + PWM expansion, Pixhawk 6X with breakout boards, CAN ESC arrays).
// The runtime filters channels by what the FC actually reports — only
// `SERVOn_FUNCTION` params that arrive in PARAM_VALUE produce assignments —
// so this cap is a defensive ceiling, not a count. Most boards expose far
// fewer (e.g. the BrainFPV Radix 2 HD reports "RCOut: PWM:1-11").
const DEFAULT_MAX_SERVO_OUTPUTS = 32

export function deriveArducopterAirframe(snapshot: ConfiguratorSnapshot): AirframeSummary {
  const frameClassValue = readRoundedParameter(snapshot, 'FRAME_CLASS')
  const frameTypeValue = readRoundedParameter(snapshot, 'FRAME_TYPE')
  const frameTypeIgnored = isArducopterFrameTypeIgnored(frameClassValue)

  return {
    frameClassValue,
    frameClassLabel: formatArducopterFrameClass(frameClassValue),
    frameTypeValue,
    frameTypeLabel: frameTypeIgnored ? `${formatArducopterFrameType(frameTypeValue)} (ignored)` : formatArducopterFrameType(frameTypeValue),
    expectedMotorCount: expectedMotorCountForArducopterFrameClass(frameClassValue),
    frameTypeIgnored,
  }
}

// Honest non-Copter airframe summaries. Plane/Rover/Sub are not a fixed
// motor matrix keyed off FRAME_CLASS, so they carry no expectedMotorCount
// (the UI keys "specialized frame" / no-quad-logic off that) and a
// vehicle-appropriate label instead of Copter frame-class garbage.
// Vehicle-specific output surfaces (Plane control-surface mapping, etc.)
// arrive in later frame-awareness phases; this keeps Copter byte-identical.
const NON_COPTER_AIRFRAME_LABEL: Partial<Record<VehicleClass, string>> = {
  ArduPlane: 'Fixed-wing / QuadPlane',
  ArduRover: 'Rover',
  ArduSub: 'Sub',
}

export function deriveAirframe(
  snapshot: ConfiguratorSnapshot,
  vehicle: VehicleClass | undefined
): AirframeSummary {
  const nonCopterLabel = vehicle ? NON_COPTER_AIRFRAME_LABEL[vehicle] : undefined
  if (nonCopterLabel !== undefined) {
    return {
      frameClassValue: undefined,
      frameClassLabel: nonCopterLabel,
      frameTypeValue: undefined,
      frameTypeLabel: '—',
      expectedMotorCount: undefined,
      frameTypeIgnored: true,
    }
  }

  // ArduCopter, plus Unknown/undefined which historically used the
  // Copter derivation — unchanged.
  return deriveArducopterAirframe(snapshot)
}

export function deriveServoOutputAssignments(
  snapshot: ConfiguratorSnapshot,
  maxServoOutputs = DEFAULT_MAX_SERVO_OUTPUTS
): ServoOutputAssignment[] {
  const parameterValues = new Map(snapshot.parameters.map((parameter) => [parameter.id, parameter.value]))
  const assignments: ServoOutputAssignment[] = []

  for (let channelNumber = 1; channelNumber <= maxServoOutputs; channelNumber += 1) {
    const paramId = `SERVO${channelNumber}_FUNCTION`
    const rawValue = parameterValues.get(paramId)
    if (rawValue === undefined) {
      continue
    }

    const functionValue = Math.round(rawValue)
    const motorNumber = arducopterMotorNumberForServoFunction(functionValue)
    assignments.push({
      channelNumber,
      paramId,
      functionValue,
      functionLabel: formatArducopterServoFunction(functionValue),
      kind: classifyServoOutput(functionValue, motorNumber),
      motorNumber,
    })
  }

  return assignments
}

export function deriveOutputMappingSummary(
  snapshot: ConfiguratorSnapshot,
  vehicle?: VehicleClass,
  maxServoOutputs = DEFAULT_MAX_SERVO_OUTPUTS
): OutputMappingSummary {
  const airframe = deriveAirframe(snapshot, vehicle)
  const outputs = deriveServoOutputAssignments(snapshot, maxServoOutputs)
  const motorOutputs = outputs.filter((output) => output.kind === 'motor').sort(sortByMotorNumber)
  const configuredAuxOutputs = outputs.filter(
    (output) => output.kind !== 'motor' && output.kind !== 'unused'
  )
  const disabledOutputs = outputs.filter((output) => output.kind === 'unused')
  const notes = buildOutputMappingNotes(airframe, outputs, motorOutputs)

  return {
    airframe,
    outputs,
    motorOutputs,
    configuredAuxOutputs,
    disabledOutputs,
    notes,
  }
}

function classifyServoOutput(functionValue: number, motorNumber: number | undefined): ServoOutputKind {
  if (motorNumber !== undefined) {
    return 'motor'
  }

  if (functionValue === 0) {
    return 'unused'
  }

  if ((functionValue >= 51 && functionValue <= 66) || (functionValue >= 140 && functionValue <= 155) || functionValue === 1) {
    return 'pass-through'
  }

  if (
    functionValue === -1 ||
    functionValue === 6 ||
    functionValue === 7 ||
    functionValue === 8 ||
    functionValue === 9 ||
    functionValue === 10 ||
    functionValue === 12 ||
    functionValue === 13 ||
    functionValue === 14 ||
    functionValue === 15 ||
    functionValue === 27 ||
    functionValue === 29 ||
    functionValue === 30 ||
    functionValue === 31 ||
    functionValue === 32 ||
    functionValue === 41 ||
    functionValue === 45 ||
    functionValue === 46 ||
    functionValue === 47 ||
    functionValue === 70 ||
    functionValue === 73 ||
    functionValue === 74 ||
    functionValue === 75 ||
    functionValue === 76 ||
    functionValue === 81 ||
    functionValue === 88 ||
    functionValue === 90 ||
    functionValue === 91 ||
    functionValue === 92 ||
    functionValue === 93 ||
    (functionValue >= 120 && functionValue <= 123)
  ) {
    return 'peripheral'
  }

  // Fixed-wing / rover / boat control surfaces. Universal SERVOn_FUNCTION
  // codes: Flap (2), Flap Auto (3), Aileron (4), Differential Spoiler
  // 1/2 (16/17), Elevator (19), Rudder (21), Flaperon L/R (24/25),
  // Ground Steering (26), Elevon L/R (77/78), VTail L/R (79/80),
  // Differential Spoiler Left/Right 2 (86/87).
  if (
    functionValue === 2 ||
    functionValue === 3 ||
    functionValue === 4 ||
    functionValue === 16 ||
    functionValue === 17 ||
    functionValue === 19 ||
    functionValue === 21 ||
    functionValue === 24 ||
    functionValue === 25 ||
    functionValue === 26 ||
    functionValue === 77 ||
    functionValue === 78 ||
    functionValue === 79 ||
    functionValue === 80 ||
    functionValue === 86 ||
    functionValue === 87
  ) {
    return 'control-surface'
  }

  return 'other'
}

function buildOutputMappingNotes(
  airframe: AirframeSummary,
  outputs: ServoOutputAssignment[],
  motorOutputs: ServoOutputAssignment[]
): string[] {
  const notes: string[] = []

  if (outputs.length === 0) {
    return ['No SERVOx_FUNCTION parameters were available in the current snapshot.']
  }

  if (airframe.frameTypeIgnored) {
    notes.push(`FRAME_TYPE is not used for ${airframe.frameClassLabel} airframes.`)
  }

  if (airframe.expectedMotorCount !== undefined) {
    if (motorOutputs.length < airframe.expectedMotorCount) {
      notes.push(`Expected ${airframe.expectedMotorCount} motor outputs for ${airframe.frameClassLabel}, but only ${motorOutputs.length} are mapped.`)
    } else if (motorOutputs.length > airframe.expectedMotorCount) {
      notes.push(`Detected ${motorOutputs.length} motor outputs, which is more than the usual ${airframe.expectedMotorCount} for ${airframe.frameClassLabel}.`)
    }

    const missingMotorNumbers = []
    for (let motorNumber = 1; motorNumber <= airframe.expectedMotorCount; motorNumber += 1) {
      if (!motorOutputs.some((output) => output.motorNumber === motorNumber)) {
        missingMotorNumbers.push(motorNumber)
      }
    }

    if (missingMotorNumbers.length > 0) {
      notes.push(`Missing motor assignments: ${missingMotorNumbers.map((motorNumber) => `M${motorNumber}`).join(', ')}.`)
    }
  }

  if (motorOutputs.length === 0) {
    notes.push('No motor outputs are currently mapped in the inspected SERVO function range.')
  }

  if (notes.length === 0) {
    notes.push('Frame geometry and primary output mapping look internally consistent in the current parameter snapshot.')
  }

  return notes
}

function sortByMotorNumber(left: ServoOutputAssignment, right: ServoOutputAssignment): number {
  return (left.motorNumber ?? Number.MAX_SAFE_INTEGER) - (right.motorNumber ?? Number.MAX_SAFE_INTEGER)
}

function readRoundedParameter(snapshot: ConfiguratorSnapshot, paramId: string): number | undefined {
  const parameter = snapshot.parameters.find((candidate) => candidate.id === paramId)
  return parameter === undefined ? undefined : Math.round(parameter.value)
}
