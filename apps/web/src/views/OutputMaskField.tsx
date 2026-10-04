import type { ReactElement } from 'react'

import type { ParameterState } from '@arduconfig/ardupilot-core'

import { buildMaskOutputRows, normalizeMask, withOutputBit, type MaskOutput } from '../view-models/output-mask'
import { InfoDot } from './InfoDot'
import type { ScopedFieldDraftMap } from './ScopedField'

export interface OutputMaskFieldProps {
  parameter: ParameterState
  /** The outputs the board has, motors tagged. */
  outputs: readonly MaskOutput[]
  editedValues: Record<string, string>
  draftStatusById: ScopedFieldDraftMap
  onChange: (paramId: string, value: string) => void
  /** Per-box test id prefix; the box for output n is `${testIdPrefix}-<n>`. */
  testIdPrefix: string
}

/**
 * A per-output bitmask (SERVO_BLH_BDMASK, SERVO_BLH_RVMASK) as one compact row
 * of small checkboxes, one per output the board has, labelled by output number
 * and tagged with the motor it drives ("1 · M1").
 *
 * The generic bitmask editor listed the mask's full 32 outputs plus a raw value
 * box. A toggle flips that output's bit and nothing else, so a bit the vehicle
 * reported on an output that is not shown is kept exactly as it was. The raw
 * value is in the "i".
 */
export function OutputMaskField({
  parameter,
  outputs,
  editedValues,
  draftStatusById,
  onChange,
  testIdPrefix
}: OutputMaskFieldProps): ReactElement {
  const status = draftStatusById.get(parameter.id)?.status ?? 'unchanged'
  const edited = editedValues[parameter.id]
  const mask = normalizeMask(edited !== undefined && edited !== '' ? edited : parameter.value)
  const liveMask = normalizeMask(parameter.value)
  const rows = buildMaskOutputRows(mask, outputs)
  const label = parameter.definition?.label ?? parameter.id
  const description = parameter.definition?.description?.trim()
  return (
    <div
      className={`scoped-editor-field scoped-editor-field--compact scoped-editor-field--${status} output-mask-field`}
      data-testid={`output-mask-${parameter.id}`}
    >
      <span>
        <span className="scoped-editor-field__title">{label}</span>
        <span className="scoped-editor-field__meta">
          <InfoDot label="Parameter details" testId={`param-info-${parameter.id}`} wide paramId={parameter.id}>
            <span className="info-dot-line">
              <strong>{parameter.id}</strong>
            </span>
            {description ? <span className="info-dot-line">{description}</span> : null}
            <span className="info-dot-line" data-testid={`output-mask-value-${parameter.id}`}>
              Value {mask}
              {status === 'staged' && mask !== liveMask ? ` (was ${liveMask})` : ''}
            </span>
            {parameter.definition?.rebootRequired ? (
              <span className="info-dot-line">Takes effect after a reboot.</span>
            ) : null}
          </InfoDot>
        </span>
      </span>
      <span className="output-mask-field__boxes">
        {rows.map((row) => (
          <label key={row.channelNumber} className={`output-mask-field__box${row.checked ? ' is-set' : ''}`}>
            <input
              type="checkbox"
              checked={row.checked}
              data-testid={`${testIdPrefix}-${row.channelNumber}`}
              aria-label={`${label}: output ${row.channelNumber}${row.motorNumber !== undefined ? `, motor ${row.motorNumber}` : ''}`}
              onChange={(event) =>
                onChange(parameter.id, String(withOutputBit(mask, row.channelNumber, event.target.checked)))
              }
            />
            {row.label}
          </label>
        ))}
      </span>
    </div>
  )
}
