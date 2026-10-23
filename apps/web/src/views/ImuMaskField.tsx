import type { ReactElement } from 'react'

import type { ParameterState } from '@arduconfig/ardupilot-core'

import { isOutputSet, normalizeMask, withOutputBit } from '../view-models/output-mask'
import { InfoDot } from './InfoDot'
import type { ScopedFieldDraftMap } from './ScopedField'

export interface ImuMaskFieldProps {
  parameter: ParameterState
  editedValues: Record<string, string>
  draftStatusById: ScopedFieldDraftMap
  onChange: (paramId: string, value: string) => void
}

/** IMUs a per-IMU mask addresses: one bit each up to the metadata maximum (7 = three IMUs). */
function imuCount(parameter: ParameterState): number {
  const maximum = parameter.definition?.maximum
  if (maximum === undefined || !Number.isFinite(maximum) || maximum < 1) return 3
  return Math.min(8, Math.max(1, Math.floor(Math.log2(Math.round(maximum) + 1))))
}

/**
 * A per-IMU bitmask (INS_FAST_SAMPLE: bit n-1 = IMU n) as one small box per
 * IMU, styled like the ESC card's per-output boxes. It was a bare number field
 * an operator had to decode. A box flips that IMU's bit only; any other bit
 * stays as reported. The raw value is in the "i".
 */
export function ImuMaskField({ parameter, editedValues, draftStatusById, onChange }: ImuMaskFieldProps): ReactElement {
  const status = draftStatusById.get(parameter.id)?.status ?? 'unchanged'
  const edited = editedValues[parameter.id]
  const mask = normalizeMask(edited !== undefined && edited !== '' ? edited : parameter.value)
  const liveMask = normalizeMask(parameter.value)
  const label = parameter.definition?.label ?? parameter.id
  const description = parameter.definition?.description?.trim()
  const imus = Array.from({ length: imuCount(parameter) }, (_, index) => index + 1)
  return (
    <div
      className={`scoped-editor-field scoped-editor-field--compact scoped-editor-field--${status} output-mask-field`}
      data-testid={`imu-mask-${parameter.id}`}
    >
      <span>
        <span className="scoped-editor-field__title">{label}</span>
        <span className="scoped-editor-field__meta">
          <InfoDot label="Parameter details" testId={`param-info-${parameter.id}`} wide paramId={parameter.id}>
            <span className="info-dot-line">
              <strong>{parameter.id}</strong>
            </span>
            {description ? <span className="info-dot-line">{description}</span> : null}
            <span className="info-dot-line" data-testid={`imu-mask-value-${parameter.id}`}>
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
        {imus.map((imu) => {
          const checked = isOutputSet(mask, imu)
          return (
            <label key={imu} className={`output-mask-field__box${checked ? ' is-set' : ''}`}>
              <input
                type="checkbox"
                checked={checked}
                data-testid={`imu-mask-${parameter.id}-${imu}`}
                aria-label={`${label}: IMU ${imu}`}
                onChange={(event) => onChange(parameter.id, String(withOutputBit(mask, imu, event.target.checked)))}
              />
              IMU {imu}
            </label>
          )
        })}
      </span>
    </div>
  )
}
