// Output-assignment visibility derivations factored out of App.tsx. Mirrors the
// serial-port visibility logic for the Servos/Motors output table: computes the
// "prioritized" channels (the default motor count, plus any configured or
// pending-draft channel), filters the assignment params down to the visible set
// unless the operator expands all, and reports how many are hidden. Output
// values are byte-identical to the inline App.tsx originals.

import { useMemo } from 'react'

import type { ParameterDraftEntry, ParameterState, ServoOutputAssignment } from '@arduconfig/ardupilot-core'

import { parseServoOutputChannelNumber } from '../serial-port-helpers'

export function useOutputAssignmentVisibility(input: {
  expectedMotorCount: number | undefined
  configuredOutputs: ServoOutputAssignment[]
  outputAssignmentDraftEntries: ParameterDraftEntry[]
  outputAssignmentParameters: ParameterState[]
  showAllOutputAssignments: boolean
}) {
  const {
    expectedMotorCount,
    configuredOutputs,
    outputAssignmentDraftEntries,
    outputAssignmentParameters,
    showAllOutputAssignments
  } = input

  const prioritizedOutputAssignmentChannels = useMemo(() => {
    const channels = new Set<number>()
    const defaultVisibleMotorCount = Math.max(expectedMotorCount ?? 0, 4)

    for (let channelNumber = 1; channelNumber <= defaultVisibleMotorCount; channelNumber += 1) {
      channels.add(channelNumber)
    }

    configuredOutputs.forEach((output) => {
      channels.add(output.channelNumber)
    })

    outputAssignmentDraftEntries.forEach((entry) => {
      if (entry.status === 'unchanged') {
        return
      }

      const channelNumber = parseServoOutputChannelNumber(entry.id)
      if (channelNumber !== undefined) {
        channels.add(channelNumber)
      }
    })

    return [...channels].sort((left, right) => left - right)
  }, [expectedMotorCount, configuredOutputs, outputAssignmentDraftEntries])
  const visibleOutputAssignmentParameters = useMemo(() => {
    if (showAllOutputAssignments) {
      return outputAssignmentParameters
    }

    const visibleParameters = outputAssignmentParameters.filter((parameter) => {
      const channelNumber = parseServoOutputChannelNumber(parameter.id)
      return channelNumber !== undefined && prioritizedOutputAssignmentChannels.includes(channelNumber)
    })

    return visibleParameters.length > 0 ? visibleParameters : outputAssignmentParameters.slice(0, Math.min(outputAssignmentParameters.length, 4))
  }, [outputAssignmentParameters, prioritizedOutputAssignmentChannels, showAllOutputAssignments])
  const hiddenOutputAssignmentCount = outputAssignmentParameters.length - visibleOutputAssignmentParameters.length

  return {
    prioritizedOutputAssignmentChannels,
    visibleOutputAssignmentParameters,
    hiddenOutputAssignmentCount
  }
}
