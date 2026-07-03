import type { ParameterState } from '@arduconfig/ardupilot-core'

import type { ScopedFieldDraftMap } from './ScopedField'

export interface IpAddressFieldProps {
  label: string
  description?: string
  /** The four octet params in order (NET_…IP0..3), highest-order octet first. */
  octets: ParameterState[]
  editedValues: Record<string, string>
  draftStatusById: ScopedFieldDraftMap
  onChange: (paramId: string, value: string) => void
}

/**
 * A dotted-quad IPv4 editor over four octet parameters — `192 . 168 . 144 . 14`
 * instead of four separate "byte N" number fields. Each octet writes its own
 * NET_…IPn parameter through the same scoped-draft path, so staging/apply is
 * unchanged; the whole row colours by the worst octet's draft status.
 */
export function IpAddressField({ label, description, octets, editedValues, draftStatusById, onChange }: IpAddressFieldProps) {
  const statuses = octets.map((octet) => draftStatusById.get(octet.id)?.status ?? 'unchanged')
  const rowStatus = statuses.includes('invalid') ? 'invalid' : statuses.includes('staged') ? 'staged' : 'unchanged'
  return (
    <div
      className={`scoped-editor-field scoped-editor-field--compact scoped-editor-field--${rowStatus} ip-address-field`}
      title={description}
    >
      <span>{label}</span>
      <div className="ip-address-field__octets">
        {octets.map((octet, index) => {
          const edited = editedValues[octet.id]
          const numeric = edited !== undefined && edited !== '' ? Number(edited) : octet.value
          const displayed = numeric === undefined || Number.isNaN(numeric) ? '' : String(Math.round(numeric))
          return (
            <span key={octet.id} className="ip-address-field__group">
              {index > 0 ? <span className="ip-address-field__sep" aria-hidden="true">.</span> : null}
              <input
                className="ip-address-field__octet"
                type="number"
                inputMode="numeric"
                min={0}
                max={255}
                value={displayed}
                onChange={(event) => onChange(octet.id, event.target.value)}
                aria-label={`${label} octet ${index + 1}`}
                data-testid={`ip-octet-${octet.id}`}
              />
            </span>
          )
        })}
      </div>
    </div>
  )
}
