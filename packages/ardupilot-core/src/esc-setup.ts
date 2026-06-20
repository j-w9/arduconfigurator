import { formatArducopterMotorPwmType } from '@arduconfig/param-metadata'

import type { ConfiguratorSnapshot } from './types.js'

export type EscCalibrationPath = 'analog-calibration' | 'digital-protocol' | 'manual-review'

export interface EscRelevantParameter {
  id: string
  value?: number
}

export interface EscSetupSummary {
  pwmTypeValue?: number
  pwmTypeLabel: string
  calibrationPath: EscCalibrationPath
  relevantParameters: EscRelevantParameter[]
  notes: string[]
}

export function deriveEscSetupSummary(snapshot: ConfiguratorSnapshot): EscSetupSummary {
  const pwmTypeValue = readRoundedParameter(snapshot, 'MOT_PWM_TYPE')
  const pwmTypeLabel = formatArducopterMotorPwmType(pwmTypeValue)
  const calibrationPath = deriveEscCalibrationPath(pwmTypeValue)
  const motPwmMin = readRoundedParameter(snapshot, 'MOT_PWM_MIN')
  const motPwmMax = readRoundedParameter(snapshot, 'MOT_PWM_MAX')
  const spinArm = readParameterValue(snapshot, 'MOT_SPIN_ARM')
  const spinMin = readParameterValue(snapshot, 'MOT_SPIN_MIN')
  const spinMax = readParameterValue(snapshot, 'MOT_SPIN_MAX')

  const notes: string[] = []
  let spinNotesAdded = false

  if (calibrationPath === 'analog-calibration') {
    notes.push('PWM / OneShot ESCs still need the offline all-at-once ESC calibration flow with USB disconnected.')
  } else if (calibrationPath === 'digital-protocol') {
    notes.push('Digital motor protocols such as DShot do not use the normal PWM endpoint calibration workflow.')
  } else {
    notes.push('Motor output protocol could not be classified confidently. Review the ESC documentation before first flight.')
  }

  if (motPwmMin === undefined || motPwmMax === undefined) {
    notes.push('MOT_PWM_MIN and MOT_PWM_MAX are not both present in the current snapshot.')
  } else if (motPwmMin >= motPwmMax) {
    notes.push('MOT_PWM_MIN must be lower than MOT_PWM_MAX.')
  } else {
    notes.push(`Motor PWM range is ${motPwmMin}-${motPwmMax}us.`)
  }

  if (spinArm === undefined || spinMin === undefined || spinMax === undefined) {
    notes.push('One or more motor spin threshold parameters are missing from the current snapshot.')
  } else {
    if (spinMin <= spinArm) {
      notes.push('MOT_SPIN_MIN should stay above MOT_SPIN_ARM so motors transition cleanly after arming.')
      spinNotesAdded = true
    }
    if (spinMax <= spinMin) {
      notes.push('MOT_SPIN_MAX should stay above MOT_SPIN_MIN.')
      spinNotesAdded = true
    }
    if (spinArm < 0 || spinMax > 1) {
      notes.push('Motor spin thresholds should remain inside the normalized 0.0-1.0 range.')
      spinNotesAdded = true
    }
    if (!spinNotesAdded) {
      notes.push(`Spin thresholds look internally consistent (arm ${formatFraction(spinArm)}, min ${formatFraction(spinMin)}, max ${formatFraction(spinMax)}).`)
    }
  }

  return {
    pwmTypeValue,
    pwmTypeLabel,
    calibrationPath,
    relevantParameters: [
      { id: 'MOT_PWM_TYPE', value: pwmTypeValue },
      { id: 'MOT_PWM_MIN', value: motPwmMin },
      { id: 'MOT_PWM_MAX', value: motPwmMax },
      { id: 'MOT_SPIN_ARM', value: spinArm },
      { id: 'MOT_SPIN_MIN', value: spinMin },
      { id: 'MOT_SPIN_MAX', value: spinMax }
    ],
    notes
  }
}

function deriveEscCalibrationPath(pwmTypeValue: number | undefined): EscCalibrationPath {
  if (pwmTypeValue === 0 || pwmTypeValue === 1 || pwmTypeValue === 2) {
    return 'analog-calibration'
  }

  if (pwmTypeValue === 4 || pwmTypeValue === 5 || pwmTypeValue === 6 || pwmTypeValue === 7) {
    return 'digital-protocol'
  }

  return 'manual-review'
}

function readRoundedParameter(snapshot: ConfiguratorSnapshot, paramId: string): number | undefined {
  const value = readParameterValue(snapshot, paramId)
  return value === undefined ? undefined : Math.round(value)
}

function readParameterValue(snapshot: ConfiguratorSnapshot, paramId: string): number | undefined {
  const parameter = snapshot.parameters.find((candidate) => candidate.id === paramId)
  return parameter?.value
}

function formatFraction(value: number | undefined): string {
  return value === undefined ? 'unknown' : value.toFixed(2).replace(/\.?0+$/, '')
}
