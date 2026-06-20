import type { ServoOutputAssignment } from '@arduconfig/ardupilot-core'
import type { ParameterState } from '@arduconfig/ardupilot-core'
import { describe, expect, it } from 'vitest'

import { buildServoFunctionMappingRow } from './servo-function-mapping'

const param = (id: string): ParameterState => ({ id }) as unknown as ParameterState

function assignment(kind: ServoOutputAssignment['kind'], motorNumber?: number): ServoOutputAssignment {
  return { kind, motorNumber, channelNumber: 1, functionValue: 33 } as unknown as ServoOutputAssignment
}

const noRange = { min: undefined, max: undefined, trim: undefined, reversed: undefined }

describe('buildServoFunctionMappingRow', () => {
  it('labels a numbered motor "Motor N" with the motor tone', () => {
    const row = buildServoFunctionMappingRow(assignment('motor', 3), param('SERVO1_FUNCTION'), noRange)
    expect(row.toneLabel).toBe('Motor 3')
    expect(row.tone).toBe('success')
  })

  it('falls back to the generic kind label when a motor has no number', () => {
    expect(buildServoFunctionMappingRow(assignment('motor'), param('SERVO1_FUNCTION'), noRange).toneLabel).toBe('Motor')
  })

  it('maps each output kind to its label + tone', () => {
    const cases: Array<[ServoOutputAssignment['kind'], string, string]> = [
      ['control-surface', 'Control Surface', 'success'],
      ['pass-through', 'RC Pass-through', 'warning'],
      ['peripheral', 'Peripheral', 'neutral'],
      ['other', 'Other', 'neutral'],
      ['unused', 'Disabled', 'neutral']
    ]
    for (const [kind, label, tone] of cases) {
      const row = buildServoFunctionMappingRow(assignment(kind), param('SERVO2_FUNCTION'), noRange)
      expect(row.toneLabel).toBe(label)
      expect(row.tone).toBe(tone)
    }
  })

  it('carries the parameter and PWM-range parameters through onto the row', () => {
    const range = { min: param('SERVO1_MIN'), max: param('SERVO1_MAX'), trim: param('SERVO1_TRIM'), reversed: param('SERVO1_REVERSED') }
    const row = buildServoFunctionMappingRow(assignment('motor', 1), param('SERVO1_FUNCTION'), range)
    expect(row.parameter.id).toBe('SERVO1_FUNCTION')
    expect(row.minParameter?.id).toBe('SERVO1_MIN')
    expect(row.maxParameter?.id).toBe('SERVO1_MAX')
    expect(row.trimParameter?.id).toBe('SERVO1_TRIM')
    expect(row.reversedParameter?.id).toBe('SERVO1_REVERSED')
  })
})
