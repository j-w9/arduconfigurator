// Motor-reorder workbench derivations, lifted out of App.tsx as another
// bounded slice toward a MotorsSection cleanup. The Motors tab's reorder
// table needs four derived values from the operator's pending channel
// re-assignments: a per-row view-model list, a duplicate-channel
// detector, a changed-count, and a "can stage" gate. All four are
// byte-identical to the App.tsx originals.

import { useMemo } from 'react'

import type { ServoOutputAssignment } from '@arduconfig/ardupilot-core'

export interface MotorReorderRow {
  motorNumber: number
  currentChannelNumber: number
  currentOutputLabel: string
  selectedChannelNumber: number
  selectedOutputLabel: string
  functionValue: number
  functionLabel: string
}

export interface UseMotorReorderResult {
  motorReorderRows: MotorReorderRow[]
  motorReorderDuplicateChannels: number[]
  motorReorderChangedCount: number
  motorReorderCanStage: boolean
}

/**
 * Derives the Motors-tab reorder workbench's view-model from the live
 * motor outputs + the operator's pending channel selection state. The
 * row list, duplicate-channel detector, changed-count, and "can stage"
 * gate are byte-identical to the App.tsx originals.
 */
export function useMotorReorder(input: {
  effectiveMotorOutputs: ServoOutputAssignment[]
  motorReorderSelections: Record<string, string>
}): UseMotorReorderResult {
  const { effectiveMotorOutputs, motorReorderSelections } = input

  const motorReorderRows = useMemo<MotorReorderRow[]>(
    () =>
      effectiveMotorOutputs
        .filter((output) => output.motorNumber !== undefined)
        .map((output) => {
          const selectedChannelValue = motorReorderSelections[String(output.motorNumber)] ?? String(output.channelNumber)
          const selectedChannelNumber = Number(selectedChannelValue)
          const selectedOutput = effectiveMotorOutputs.find((candidate) => candidate.channelNumber === selectedChannelNumber)

          return {
            motorNumber: output.motorNumber ?? 0,
            currentChannelNumber: output.channelNumber,
            currentOutputLabel: `OUT${output.channelNumber}`,
            selectedChannelNumber,
            selectedOutputLabel: selectedOutput ? `OUT${selectedOutput.channelNumber}` : `OUT${selectedChannelNumber}`,
            functionValue: output.functionValue,
            functionLabel: output.functionLabel
          }
        }),
    [effectiveMotorOutputs, motorReorderSelections]
  )
  const motorReorderDuplicateChannels = useMemo(() => {
    const counts = new Map<number, number>()
    motorReorderRows.forEach((row) => {
      counts.set(row.selectedChannelNumber, (counts.get(row.selectedChannelNumber) ?? 0) + 1)
    })
    return [...counts.entries()].filter(([, count]) => count > 1).map(([channelNumber]) => channelNumber)
  }, [motorReorderRows])
  const motorReorderChangedCount = motorReorderRows.filter((row) => row.selectedChannelNumber !== row.currentChannelNumber).length
  const motorReorderCanStage =
    motorReorderRows.length > 0 &&
    motorReorderChangedCount > 0 &&
    motorReorderDuplicateChannels.length === 0 &&
    motorReorderRows.every((row) => Number.isFinite(row.selectedChannelNumber) && row.selectedChannelNumber > 0)

  return {
    motorReorderRows,
    motorReorderDuplicateChannels,
    motorReorderChangedCount,
    motorReorderCanStage
  }
}
