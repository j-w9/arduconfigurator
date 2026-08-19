import type { ReactElement, ReactNode } from 'react'
import type { ParameterState } from '@arduconfig/ardupilot-core'
import { StatusBadge } from '@arduconfig/ui-kit'

import type { FilterBank, FilterBankSlot } from '../view-models/filter-bank'

/**
 * The FILTn filter bank, and which slot each rate axis filters through.
 *
 * ArduPilot's standalone filters (Filter/AP_Filter.cpp) were configurable only
 * through the raw parameter tree, and the ATC_RAT_*_NTF / _NEF parameters that
 * point at them were bare number boxes -- so a filter you had set up appeared
 * nowhere on the Filters page, and choosing one meant remembering which slot
 * held what.
 *
 * Presentational: every field goes through the caller's shared metadata
 * renderer, so these edit and stage exactly like any other parameter.
 */
export interface FilterBankPanelProps {
  bank: FilterBank
  /** One entry per slot, with the parameters that slot owns. */
  groups: { slot: FilterBankSlot; parameters: ParameterState[] }[]
  /** ATC_RAT_*_NTF / _NEF, already carrying the named-slot options. */
  indexParameters: ParameterState[]
  renderField: (parameter: ParameterState) => ReactNode
}

export function FilterBankPanel(props: FilterBankPanelProps): ReactElement | null {
  const { bank, groups, indexParameters, renderField } = props

  if (!bank.supported) {
    return null
  }

  return (
    <section className="bf-gui-box filter-bank" data-testid="filter-bank">
      <div className="bf-gui-box__titlebar">
        <strong>Filter bank</strong>
        <StatusBadge tone={bank.configured.length > 0 ? 'success' : 'neutral'}>
          {bank.configured.length} of {bank.slots.length} in use
        </StatusBadge>
      </div>
      <div className="bf-gui-box__body">
        <p className="hint">
          Standalone filters the rate loops can be pointed at. Set a slot's type to Notch and it appears in the
          axis lists below — a reboot away, as the firmware asks.
        </p>

        <div className="tuning-axis-grid tuning-axis-grid--filters">
          {groups.map(({ slot, parameters }) => (
            <article
              key={`filter-slot-${slot.index}`}
              className="tuning-axis-card"
              data-testid={`filter-bank-slot-${slot.index}`}
              /* An unconfigured slot is still shown -- filling one in is how a
                 bank gets built, and hiding the empty ones would make the list
                 change shape underneath the operator. */
              data-configured={slot.configured ? 'yes' : 'no'}
            >
              <div className="tuning-axis-card__header">
                <strong>FILT{slot.index}</strong>
                <span>{slot.summary}</span>
              </div>
              <div className="tuning-control-grid tuning-control-grid--compact">
                {parameters.map((parameter) => renderField(parameter))}
              </div>
            </article>
          ))}
        </div>

        {indexParameters.length > 0 ? (
          <div className="filter-bank__routing" data-testid="filter-bank-routing">
            <div className="tuning-axis-card__header">
              <strong>Which filter each axis uses</strong>
              <span>0 = none</span>
            </div>
            <div className="tuning-control-grid tuning-control-grid--compact">
              {indexParameters.map((parameter) => renderField(parameter))}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  )
}
