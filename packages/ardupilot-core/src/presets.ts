import type { PresetDefinition } from '@arduconfig/param-metadata'

import type { ConfiguratorSnapshot, ParameterState } from './types.js'

export interface ParameterPresetDiffResult {
  draftValues: Record<string, string>
  matchedCount: number
  changedCount: number
  unchangedCount: number
  unknownParameterIds: string[]
}

export interface ParameterPresetApplicabilityResult {
  status: 'ready' | 'caution' | 'blocked'
  reasons: string[]
}

export function deriveDraftValuesFromParameterPreset(
  parameters: readonly ParameterState[],
  preset: PresetDefinition
): ParameterPresetDiffResult {
  const parameterById = new Map(parameters.map((parameter) => [parameter.id, parameter]))
  const draftValues: Record<string, string> = {}
  const unknownParameterIds: string[] = []
  let changedCount = 0
  let unchangedCount = 0

  preset.values.forEach((value) => {
    const current = parameterById.get(value.paramId)
    if (!current) {
      unknownParameterIds.push(value.paramId)
      return
    }

    if (Object.is(current.value, value.value)) {
      unchangedCount += 1
      return
    }

    draftValues[value.paramId] = String(value.value)
    changedCount += 1
  })

  return {
    draftValues,
    matchedCount: changedCount + unchangedCount,
    changedCount,
    unchangedCount,
    unknownParameterIds
  }
}

export function evaluateParameterPresetApplicability(
  snapshot: ConfiguratorSnapshot,
  preset: PresetDefinition
): ParameterPresetApplicabilityResult {
  let status: ParameterPresetApplicabilityResult['status'] = 'ready'
  const reasons: string[] = []

  if (snapshot.vehicle?.vehicle && snapshot.vehicle.vehicle !== 'ArduCopter') {
    return {
      status: 'blocked',
      reasons: ['This initial preset library is currently defined only for ArduCopter.']
    }
  }

  const expectedFrameClasses = preset.compatibility?.frameClasses
  if (expectedFrameClasses && expectedFrameClasses.length > 0) {
    const currentFrameClass = readRoundedParameter(snapshot.parameters, 'FRAME_CLASS')

    if (currentFrameClass === undefined) {
      status = 'caution'
      reasons.push('Frame class is not known yet, so preset compatibility cannot be fully confirmed.')
    } else if (!expectedFrameClasses.includes(currentFrameClass)) {
      return {
        status: 'blocked',
        reasons: [`This preset is intended for ${formatFrameClassList(expectedFrameClasses)} airframes, not FRAME_CLASS ${currentFrameClass}.`]
      }
    }
  }

  return {
    status,
    reasons
  }
}

function readRoundedParameter(parameters: readonly ParameterState[], paramId: string): number | undefined {
  const value = parameters.find((parameter) => parameter.id === paramId)?.value
  return value === undefined ? undefined : Math.round(value)
}

function formatFrameClassList(frameClasses: readonly number[]): string {
  if (frameClasses.length === 1) {
    return `FRAME_CLASS ${frameClasses[0]}`
  }

  return `FRAME_CLASS values ${frameClasses.join(', ')}`
}
