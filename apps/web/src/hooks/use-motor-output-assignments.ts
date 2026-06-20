// Motor output-assignment derivations factored out of App.tsx. Builds the
// sorted list of SERVOn_FUNCTION output-assignment parameters (and an id-keyed
// map), then resolves the *effective* motor outputs by overlaying pending edits
// onto the snapshot values and mapping each servo function to its ArduCopter
// motor number. Output values are byte-identical to the inline App.tsx
// originals.

import { useMemo } from 'react'

import {
  type ConfiguratorSnapshot,
  type ServoOutputAssignment
} from '@arduconfig/ardupilot-core'
import { arducopterMotorNumberForServoFunction, formatArducopterServoFunction } from '@arduconfig/param-metadata'

import { isOutputAssignmentParamId } from '../param-review'
import { parseServoOutputChannelNumber } from '../serial-port-helpers'
import { sortMotorOutputsByMotorNumber } from '../setup-exercise-helpers'
import type { ParameterDraftValues } from './use-parameter-drafts'

export function useMotorOutputAssignments(input: {
  snapshot: ConfiguratorSnapshot
  editedValues: ParameterDraftValues
}) {
  const { snapshot, editedValues } = input

  const outputAssignmentParameters = useMemo(
    () =>
      snapshot.parameters
        .filter((parameter) => isOutputAssignmentParamId(parameter.id))
        .sort((left, right) => (parseServoOutputChannelNumber(left.id) ?? 99) - (parseServoOutputChannelNumber(right.id) ?? 99)),
    [snapshot.parameters]
  )
  const outputAssignmentParameterById = useMemo(
    () => new Map(outputAssignmentParameters.map((parameter) => [parameter.id, parameter])),
    [outputAssignmentParameters]
  )
  const effectiveMotorOutputs = useMemo<ServoOutputAssignment[]>(
    () => {
      const outputs: ServoOutputAssignment[] = []

      outputAssignmentParameters.forEach((parameter) => {
        const channelNumber = parseServoOutputChannelNumber(parameter.id)
        if (channelNumber === undefined) {
          return
        }

        const nextValue = editedValues[parameter.id]
        const functionValue = nextValue !== undefined ? Number(nextValue) : Math.round(parameter.value)
        const motorNumber = arducopterMotorNumberForServoFunction(functionValue)

        if (motorNumber === undefined) {
          return
        }

        outputs.push({
          channelNumber,
          paramId: parameter.id,
          functionValue,
          functionLabel: formatArducopterServoFunction(functionValue),
          kind: 'motor',
          motorNumber,
        })
      })

      return outputs.sort(sortMotorOutputsByMotorNumber)
    },
    [editedValues, outputAssignmentParameters]
  )
  const effectiveMotorOutputByMotorNumber = useMemo(
    () => new Map(effectiveMotorOutputs.map((output) => [output.motorNumber ?? 0, output])),
    [effectiveMotorOutputs]
  )

  return {
    outputAssignmentParameters,
    outputAssignmentParameterById,
    effectiveMotorOutputs,
    effectiveMotorOutputByMotorNumber
  }
}
