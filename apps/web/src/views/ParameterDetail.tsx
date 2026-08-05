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
  /**
   * Firmware default from the FC's own param.pck, when it has been fetched.
   * Undefined means "not known", NOT "no default" — the app must not guess one
   * from metadata, since the authoritative value depends on the board and build.
   */
  defaultValue?: number
}

export function ParameterDetail({
  parameter,
  definition,
  alias,
  editedValues,
  onChange,
  draftStatusById,
  defaultValue
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

      {/* Two columns on a wide screen: prose on the left, the numbers and the
        * editor in the dead space on the right, which is otherwise empty on a
        * desktop. Collapses back to a single stack below 900px — the same
        * layout on a phone would squeeze the description to a ribbon. */}
      <div className="parameter-detail__body">
        <div className="parameter-detail__prose">
      {definition?.description ? <p className="parameter-detail__desc">{definition.description}</p> : null}
        </div>
        <div className="parameter-detail__side">

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
        {defaultValue !== undefined ? (
          <div data-testid={`parameter-detail-default-${parameter.id}`}>
            <dt>Default</dt>
            <dd>
              {defaultValue}
              {/* Restoring is offered only when the live value actually differs,
                * so the control never appears as a no-op. It stages a draft like
                * any other edit rather than writing — nothing reaches the FC
                * without the usual review and Apply. */}
              {defaultValue !== parameter.value ? (
                <>
                  {' '}
                  <button
                    type="button"
                    className="parameter-detail__restore"
                    data-testid={`parameter-restore-default-${parameter.id}`}
                    onClick={() => onChange(parameter.id, String(defaultValue))}
                  >
                    Restore default
                  </button>
                </>
              ) : (
                <span className="parameter-detail__at-default"> (at default)</span>
              )}
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
            {/* No raw number field here: the row's own Draft cell already edits
              * this parameter, and having both meant typing into one while
              * staring at the other. The bitmask branch above keeps ITS value
              * box, because a bitmask row shows chips rather than a number and
              * there would otherwise be nowhere to enter a raw value. */}
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
      </div>
    </div>
  )
}
