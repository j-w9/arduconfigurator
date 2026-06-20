import type { ParameterState } from '@arduconfig/ardupilot-core'
import type { ParameterDefinition } from '@arduconfig/param-metadata'
import { describe, expect, it } from 'vitest'

import {
  describeBitmaskDraftValue,
  findParameterOption,
  formatAngleMaxDegrees,
  formatNumericDisplayValue,
  formatParameterDelta,
  formatParameterDisplayValue,
  formatParameterRange,
  formatParameterStep,
  formatParameterValue,
  normalizeBitmaskValue
} from './parameter-format'

const def = (d: Partial<ParameterDefinition>): ParameterDefinition => d as ParameterDefinition

describe('formatNumericDisplayValue', () => {
  it('passes integers through and reports non-finite values as Unknown', () => {
    expect(formatNumericDisplayValue(42)).toBe('42')
    expect(formatNumericDisplayValue(Number.NaN)).toBe('Unknown')
    expect(formatNumericDisplayValue(Number.POSITIVE_INFINITY)).toBe('Unknown')
  })

  it('scales decimal precision by magnitude and strips trailing zeros', () => {
    expect(formatNumericDisplayValue(123.456)).toBe('123.5') // >=100 -> 1 dp
    expect(formatNumericDisplayValue(12.3456)).toBe('12.35') // >=10 -> 2 dp
    expect(formatNumericDisplayValue(1.23456)).toBe('1.235') // >=1 -> 3 dp
    expect(formatNumericDisplayValue(0.123456)).toBe('0.1235') // >=0.1 -> 4 dp
    expect(formatNumericDisplayValue(0.001234)).toBe('0.001234') // small -> 6 dp
    expect(formatNumericDisplayValue(1.5)).toBe('1.5') // trailing zeros gone
  })

  it('normalizes a tiny negative that rounds to "-0" back to "0"', () => {
    expect(formatNumericDisplayValue(-0.0000001)).toBe('0')
  })
})

describe('formatParameterValue', () => {
  it('reports undefined as Unknown and appends a unit when given', () => {
    expect(formatParameterValue(undefined)).toBe('Unknown')
    expect(formatParameterValue(5)).toBe('5')
    expect(formatParameterValue(5, 'V')).toBe('5 V')
  })
})

describe('formatParameterDelta', () => {
  it('says "no change" for zero/undefined and signs real deltas', () => {
    expect(formatParameterDelta(undefined)).toBe('no change')
    expect(formatParameterDelta(0)).toBe('no change')
    expect(formatParameterDelta(3, 'A')).toBe('+3 A')
    expect(formatParameterDelta(-2)).toBe('-2')
  })
})

describe('formatParameterRange / formatParameterStep', () => {
  it('handles missing metadata, bounded ranges, and unbounded ends', () => {
    expect(formatParameterRange(undefined)).toBe('No range metadata yet')
    expect(formatParameterRange(def({ minimum: 0, maximum: 100, unit: 'm' }))).toBe('0 to 100 m')
    expect(formatParameterRange(def({ maximum: 100 }))).toBe('unbounded to 100')
    expect(formatParameterRange(def({ minimum: 5 }))).toBe('5 to unbounded')
  })

  it('formats the step, with unit when present', () => {
    expect(formatParameterStep(undefined)).toBe('No step metadata yet')
    expect(formatParameterStep(def({ step: 0.1 }))).toBe('0.1')
    expect(formatParameterStep(def({ step: 1, unit: 'deg' }))).toBe('1 deg')
  })
})

describe('option-aware display', () => {
  const definition = def({ unit: 'x', options: [{ value: 2, label: 'Two' }] as ParameterDefinition['options'] })

  it('findParameterOption matches an exact option value', () => {
    expect(findParameterOption(definition, 2)?.label).toBe('Two')
    expect(findParameterOption(definition, 9)).toBeUndefined()
    expect(findParameterOption(undefined, 2)).toBeUndefined()
  })

  it('shows the option label plus the raw value, or falls back to the formatted value', () => {
    const param = { definition } as unknown as ParameterState
    expect(formatParameterDisplayValue(param, 2)).toBe('Two (2 x)')
    expect(formatParameterDisplayValue(param, 7)).toBe('7 x')
    expect(formatParameterDisplayValue(undefined, 7)).toBe('7')
  })
})

describe('normalizeBitmaskValue', () => {
  it('parses a numeric string, clamps to a non-negative integer, else uses the fallback', () => {
    expect(normalizeBitmaskValue('5', 0)).toBe(5)
    expect(normalizeBitmaskValue('3.7', 0)).toBe(4) // rounded
    expect(normalizeBitmaskValue('-2', 0)).toBe(0) // clamped
    expect(normalizeBitmaskValue('', 9)).toBe(9) // empty -> fallback
    expect(normalizeBitmaskValue(undefined, 9)).toBe(9)
    expect(normalizeBitmaskValue('nope', undefined)).toBe(0) // bad + no fallback -> 0
  })
})

describe('describeBitmaskDraftValue', () => {
  const mask = def({
    bitmask: true,
    options: [
      { value: 0, label: 'GPS' },
      { value: 2, label: 'Baro' }
    ] as ParameterDefinition['options']
  })

  it('lists set-bit labels and falls back to "bit N" for unlabelled bits', () => {
    expect(describeBitmaskDraftValue(mask, 0b101)).toBe('GPS, Baro')
    expect(describeBitmaskDraftValue(mask, 0b1101)).toBe('GPS, Baro, bit 3')
    expect(describeBitmaskDraftValue(mask, 0)).toBe('none')
  })

  it('returns undefined for non-bitmask definitions and non-finite values', () => {
    expect(describeBitmaskDraftValue(def({ options: mask.options }), 5)).toBeUndefined()
    expect(describeBitmaskDraftValue(undefined, 5)).toBeUndefined()
    expect(describeBitmaskDraftValue(mask, undefined)).toBeUndefined()
    expect(describeBitmaskDraftValue(mask, Number.NaN)).toBeUndefined()
  })
})

describe('formatAngleMaxDegrees', () => {
  it('converts centidegrees to whole degrees', () => {
    expect(formatAngleMaxDegrees(4500)).toBe('45 deg')
    expect(formatAngleMaxDegrees(undefined)).toBe('Unknown')
    expect(formatAngleMaxDegrees(Number.NaN)).toBe('Unknown')
  })
})
