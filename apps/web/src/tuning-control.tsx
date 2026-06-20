// Curated-tuning control (slider + number field) and its value helpers,
// extracted from App.tsx as part of its decomposition. The slider holds its
// value locally while dragging and commits the staged draft only on release.

import { useState } from 'react'
import type { ReactElement } from 'react'

import type { ParameterDraftStatus, ParameterState } from '@arduconfig/ardupilot-core'
import { StatusBadge } from '@arduconfig/ui-kit'

import { formatNumericDisplayValue, formatParameterDisplayValue, formatAngleMaxDegrees } from './parameter-format'

export function tuningInputValue(parameter: ParameterState, editedValues: Record<string, string>): string {
  const rawValue = editedValues[parameter.id]
  if (parameter.id === 'ANGLE_MAX') {
    if (rawValue === undefined) {
      return String(Math.round(parameter.value / 100))
    }

    const parsed = Number(rawValue)
    return Number.isFinite(parsed) ? String(Math.round(parsed / 100)) : ''
  }

  // Default (unedited) display: show a rounded value, not the raw float.
  // Many ArduPilot floats arrive as e.g. 0.13500000000000001 — the number
  // field rendered all those digits. formatNumericDisplayValue rounds to a
  // sensible precision and strips trailing zeros while staying a valid
  // numeric string for the <input type="number">.
  if (rawValue !== undefined) {
    return rawValue
  }
  return Number.isFinite(parameter.value)
    ? formatNumericDisplayValue(parameter.value)
    : String(parameter.value)
}

export function applyTuningEditedValue(
  existing: Record<string, string>,
  parameter: ParameterState,
  nextValue: string
): Record<string, string> {
  if (parameter.id === 'ANGLE_MAX') {
    return {
      ...existing,
      [parameter.id]: nextValue.trim().length === 0 ? '' : String(Math.round(Number(nextValue) * 100))
    }
  }

  return {
    ...existing,
    [parameter.id]: nextValue
  }
}

export function tuningNumericValue(parameter: ParameterState, editedValues: Record<string, string>): number {
  const normalizedInputValue = tuningInputValue(parameter, editedValues)
  const parsed = Number(normalizedInputValue)

  if (Number.isFinite(parsed)) {
    return parsed
  }

  return parameter.id === 'ANGLE_MAX' ? Math.round(parameter.value / 100) : parameter.value
}

export function tuningControlBounds(parameter: ParameterState): { min?: number; max?: number; step?: number } {
  if (parameter.id === 'ANGLE_MAX') {
    return {
      min: 10,
      max: 80,
      step: 1
    }
  }

  return {
    min: parameter.definition?.minimum,
    max: parameter.definition?.maximum,
    step: parameter.definition?.step ?? 0.01
  }
}

export function formatTuningDisplayValue(parameter: ParameterState, value: number | undefined): string {
  if (parameter.id === 'ANGLE_MAX') {
    return formatAngleMaxDegrees(value)
  }

  return formatParameterDisplayValue(parameter, value)
}

export function clampNumericValue(value: number, minimum?: number, maximum?: number): number {
  let nextValue = value
  if (minimum !== undefined) {
    nextValue = Math.max(minimum, nextValue)
  }
  if (maximum !== undefined) {
    nextValue = Math.min(maximum, nextValue)
  }
  return nextValue
}

export function normalizeTuningNumericValue(parameter: ParameterState, value: number): number {
  const { min, max, step } = tuningControlBounds(parameter)
  const clamped = clampNumericValue(value, min, max)

  if (step === undefined || step <= 0) {
    return clamped
  }

  const rounded = Math.round(clamped / step) * step
  const precision = Math.max(0, Math.ceil(Math.log10(1 / step)))
  return Number(rounded.toFixed(Math.min(precision, 6)))
}

export interface TuningControlProps {
  parameter: ParameterState
  draftStatus: ParameterDraftStatus | undefined
  draftReason: string | undefined
  min?: number
  max?: number
  step?: number
  inputValue: string
  numericValue: number
  currentValue: string
  stagedValue: string
  label: string
  onStage: (parameter: ParameterState, nextValue: string) => void
}

/**
 * A single curated-tuning control (slider + number field). The slider holds
 * its value locally while you drag it and only commits to the staged-draft
 * store on release (pointer up / blur / key up). Committing on every drag
 * tick re-staged the draft and re-rendered the whole configurator each tick,
 * which made the slider stutter and snap to "staged" before you could finish
 * the drag. The number field commits per change (typing is discrete, not a
 * hot-path drag).
 */
export function TuningControl(props: TuningControlProps): ReactElement {
  const {
    parameter,
    draftStatus,
    draftReason,
    min,
    max,
    step,
    inputValue,
    numericValue,
    currentValue,
    stagedValue,
    label,
    onStage
  } = props

  const [dragValue, setDragValue] = useState<string | null>(null)
  const isDragging = dragValue !== null
  const rangeValue = isDragging ? Number(dragValue) : numericValue
  const numberFieldValue = isDragging ? dragValue : inputValue

  const commit = (): void => {
    if (dragValue !== null) {
      onStage(parameter, dragValue)
      setDragValue(null)
    }
  }

  return (
    <article className={`tuning-control tuning-control--${draftStatus ?? 'unchanged'}`}>
      <div className="tuning-control__header">
        <div>
          <span>{label}</span>
          <strong>{stagedValue}</strong>
        </div>
        {draftStatus === 'staged' ? <StatusBadge tone="warning">staged</StatusBadge> : null}
        {draftStatus === 'invalid' ? <StatusBadge tone="danger">invalid</StatusBadge> : null}
      </div>

      <input
        className="tuning-control__range"
        aria-label={`${label} slider`}
        type="range"
        min={min}
        max={max}
        step={step}
        value={rangeValue}
        onChange={(event) => setDragValue(event.target.value)}
        onPointerUp={commit}
        onPointerCancel={commit}
        onKeyUp={commit}
        onBlur={commit}
      />

      <div className="tuning-control__footer">
        <input
          data-testid={`tuning-input-${parameter.id}`}
          aria-label={`${label} value`}
          type="number"
          min={min}
          max={max}
          step={step}
          value={numberFieldValue}
          onChange={(event) => onStage(parameter, event.target.value)}
        />
        <small>
          {draftStatus === 'staged' ? `Current ${currentValue}` : draftReason ?? `Current ${currentValue}`}
        </small>
      </div>
    </article>
  )
}
