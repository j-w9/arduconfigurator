// Inline detail for one parameter, revealed when its row is expanded in the raw
// Parameters table. Brings back the metadata the flat table dropped: the
// friendly label + full description, the old/renamed name (so you know what to
// search the wiki for), the unit and documented range, what the CURRENT value
// means for an enum, and a richer editor — typeable input AND a dropdown for
// enums, per-bit chips for bitmasks. Dumb presentational component.

import type { ParameterAlias, ParameterState } from '@arduconfig/ardupilot-core'
import type { ParameterDefinition } from '@arduconfig/param-metadata'

import { ScopedBitmaskField, type ScopedFieldDraftMap } from './ScopedField'

export interface ParameterDetailProps {
  parameter: ParameterState
  /** Enriched definition (catalog ?? snapshot). */
  definition: ParameterDefinition | undefined
  /** The renamed form of this param, if any. */
  alias: ParameterAlias | undefined
  editedValues: Record<string, string>
  onChange: (paramId: string, value: string) => void
  draftStatusById: ScopedFieldDraftMap
}

export function ParameterDetail({
  parameter,
  definition,
  alias,
  editedValues,
  onChange,
  draftStatusById
}: ParameterDetailProps) {
  const options = definition?.options ?? []
  const isBitmask = definition?.bitmask === true
  const isEnum = options.length > 0 && !isBitmask
  const raw = editedValues[parameter.id] ?? String(parameter.value)
  const numeric = Number(raw)
  const currentMeaning = isEnum ? options.find((option) => Object.is(option.value, numeric))?.label : undefined

  return (
    <div className="parameter-detail" data-testid={`parameter-detail-${parameter.id}`}>
      <div className="parameter-detail__head">
        <strong>{definition?.label ?? parameter.id}</strong>
        {alias ? (
          <span className="parameter-detail__alias" data-testid={`parameter-detail-alias-${parameter.id}`}>
            {alias.aliasIsLegacy ? 'Old name' : 'Also known as'}: <code>{alias.name}</code>
          </span>
        ) : null}
      </div>

      {definition?.description ? <p className="parameter-detail__desc">{definition.description}</p> : null}

      <dl className="parameter-detail__meta">
        {definition?.unit ? (
          <div>
            <dt>Unit</dt>
            <dd>{definition.unit}</dd>
          </div>
        ) : null}
        {definition?.minimum !== undefined || definition?.maximum !== undefined ? (
          <div>
            <dt>Range</dt>
            <dd>
              {definition?.minimum ?? '−∞'} – {definition?.maximum ?? '∞'}
            </dd>
          </div>
        ) : null}
        {isEnum ? (
          <div>
            <dt>Current</dt>
            <dd>
              {numeric}
              {currentMeaning ? ` — ${currentMeaning}` : ' (not a listed value)'}
            </dd>
          </div>
        ) : null}
      </dl>

      <div className="parameter-detail__editor">
        {isBitmask ? (
          // Per-bit chips, each labelled with its bit meaning.
          <ScopedBitmaskField
            parameter={{ ...parameter, definition }}
            liveValue={parameter.value}
            editedValues={editedValues}
            onChange={onChange}
            draftStatusById={draftStatusById}
          />
        ) : (
          <div className="parameter-detail__value-row">
            {/* Type the raw value directly… */}
            <label className="parameter-detail__field">
              <span>Value</span>
              <input
                type="number"
                step="any"
                data-testid={`parameter-detail-input-${parameter.id}`}
                value={raw}
                onChange={(event) => onChange(parameter.id, event.target.value)}
                aria-label={`Edit ${parameter.id}`}
              />
            </label>
            {/* …or pick a named option (enums only). Both edit the same draft. */}
            {isEnum ? (
              <label className="parameter-detail__field">
                <span>Pick</span>
                <select
                  data-testid={`parameter-detail-select-${parameter.id}`}
                  value={options.some((option) => Object.is(option.value, numeric)) ? String(numeric) : ''}
                  onChange={(event) => onChange(parameter.id, event.target.value)}
                  aria-label={`${parameter.id} named value`}
                >
                  {!options.some((option) => Object.is(option.value, numeric)) ? (
                    <option value="" disabled>
                      Custom ({numeric})
                    </option>
                  ) : null}
                  {options.map((option) => (
                    <option key={option.value} value={String(option.value)}>
                      {option.label} ({option.value})
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
        )}
      </div>
    </div>
  )
}
