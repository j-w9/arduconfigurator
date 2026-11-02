import type { ReactNode } from 'react'
import { Panel, buttonStyle } from '@arduconfig/ui-kit'
import type { ParameterState } from '@arduconfig/ardupilot-core'

import { ScopedField, ScopedSelectField, type ScopedFieldDraftMap } from './ScopedField'

export interface VtxLinkPort {
  label: string
  protocolLabel: string
}

export interface VtxField {
  parameter: ParameterState
  liveValue: number | undefined
}

export interface VtxViewProps {
  /** The OSD/VTX switcher, rendered under the panel title like every other
   *  view's tab strip. */
  headerNav?: ReactNode
  linkPorts: readonly VtxLinkPort[]
  enabledLabel: string
  enableField: VtxField | undefined
  frequencyField: VtxField | undefined
  powerField: VtxField | undefined
  maxPowerField: VtxField | undefined
  optionsField: VtxField | undefined
  typesField: VtxField | undefined
  editedValues: Record<string, string>
  onEditChange: (paramId: string, value: string) => void
  draftStatusById: ScopedFieldDraftMap
  isBusy: boolean
}

/** Requested VTX power for display; 0 mW is pit mode. */
export function formatVtxPower(power: number | undefined): string {
  if (power === undefined) return 'Unknown'
  return power === 0 ? 'Pit mode (0 mW)' : `${power} mW`
}

export function VtxView(props: VtxViewProps) {
  const {
    headerNav,
    linkPorts,
    enabledLabel,
    enableField,
    frequencyField,
    powerField,
    maxPowerField,
    optionsField,
    typesField,
    editedValues,
    onEditChange,
    draftStatusById,
    isBusy
  } = props

  const frequency = frequencyField?.liveValue
  const power = powerField?.liveValue
  const maxPower = maxPowerField?.liveValue
  const options = optionsField?.liveValue
  const types = typesField?.liveValue
  // Human-readable list of the allowed VTX transports, derived from the param's
  // own bit labels so the view stays free of a hard-coded transport map.
  const transportsLabel = (() => {
    if (types === undefined) {
      return 'Unknown'
    }
    const bitOptions = typesField?.parameter.definition?.options
    if (!bitOptions || bitOptions.length === 0) {
      return `0x${Number(types).toString(16).toUpperCase()}`
    }
    const enabled = bitOptions.filter((option) => (Number(types) & (1 << option.value)) !== 0).map((option) => option.label)
    return enabled.length > 0 ? enabled.join(', ') : 'None'
  })()

  return (
    <section className="grid one-up">
      <Panel
        title="VTX"
      >
        <div className="bf-tab-stack">
          {headerNav}
          <div className="bf-vtx-grid">
            <article className="bf-gui-box bf-vtx-grid__config">
              <div className="bf-gui-box__titlebar">
                <strong>Selected Mode</strong>
              </div>
              <div className="bf-gui-box__body">
                <div className="bf-compact-field-grid">
                  {enableField ? (
                    <ScopedSelectField
                      parameter={enableField.parameter}
                      liveValue={enableField.liveValue}
                      editedValues={editedValues}
                      onChange={onEditChange}
                      draftStatusById={draftStatusById}
                      layout="chips"
                    />
                  ) : null}

                  {frequencyField ? (
                    <ScopedField
                      parameter={frequencyField.parameter}
                      liveValue={frequencyField.liveValue}
                      editedValues={editedValues}
                      onChange={onEditChange}
                      draftStatusById={draftStatusById}
                    />
                  ) : null}

                  {powerField ? (
                    <div className="bf-vtx-power-field">
                      <ScopedField
                        parameter={powerField.parameter}
                        liveValue={powerField.liveValue}
                        editedValues={editedValues}
                        onChange={onEditChange}
                        draftStatusById={draftStatusById}
                      />
                      <button
                        type="button"
                        style={buttonStyle()}
                        data-testid="vtx-pit-mode-button"
                        title="0 mW is pit mode on SmartAudio 2.1 VTXs (TBS Unify Pro32)."
                        onClick={() => onEditChange(powerField.parameter.id, '0')}
                        disabled={isBusy}
                      >
                        Pit mode (0 mW)
                      </button>
                    </div>
                  ) : null}

                  {maxPowerField ? (
                    <ScopedField
                      parameter={maxPowerField.parameter}
                      liveValue={maxPowerField.liveValue}
                      editedValues={editedValues}
                      onChange={onEditChange}
                      draftStatusById={draftStatusById}
                    />
                  ) : null}
                </div>
              </div>
            </article>

            <article className="bf-gui-box bf-vtx-grid__status">
              <div className="bf-gui-box__titlebar">
                <strong>Actual State</strong>
              </div>
              <div className="bf-gui-box__body">
                <div className="bf-gui-box__kv-list">
                  <div className="bf-gui-box__kv-row">
                    <span>Device ready</span>
                    <strong>{linkPorts.length > 0 ? 'Linked' : 'Not detected'}</strong>
                  </div>
                  <div className="bf-gui-box__kv-row">
                    <span>Control</span>
                    <strong>{enabledLabel}</strong>
                  </div>
                  <div className="bf-gui-box__kv-row">
                    <span>Frequency</span>
                    <strong>{frequency !== undefined ? `${frequency} MHz` : 'Unknown'}</strong>
                  </div>
                  <div className="bf-gui-box__kv-row">
                    <span>Power</span>
                    <strong data-testid="vtx-actual-power">{formatVtxPower(power)}</strong>
                  </div>
                  <div className="bf-gui-box__kv-row">
                    <span>Max power</span>
                    <strong>{maxPower !== undefined ? `${maxPower} mW` : 'Unknown'}</strong>
                  </div>
                  {typesField ? (
                    <div className="bf-gui-box__kv-row">
                      <span>Transports</span>
                      <strong>{transportsLabel}</strong>
                    </div>
                  ) : null}
                  <div className="bf-gui-box__kv-row">
                    <span>Advanced</span>
                    <strong>
                      {options !== undefined
                        ? `0x${Number(options).toString(16).toUpperCase()}`
                        : 'Unknown'}
                    </strong>
                  </div>
                </div>
              </div>
            </article>

            <article className="bf-gui-box bf-vtx-grid__advanced">
              <div className="bf-gui-box__titlebar">
                <strong>Advanced</strong>
              </div>
              <div className="bf-gui-box__body">
                <div className="bf-vtx-advanced-grid">
                  {typesField ? (
                    <ScopedField
                      parameter={typesField.parameter}
                      liveValue={typesField.liveValue}
                      editedValues={editedValues}
                      onChange={onEditChange}
                      draftStatusById={draftStatusById}
                      caption="Allowed control transports (CRSF / SmartAudio / Tramp / MSP). Clear a bit to forbid that transport."
                    />
                  ) : null}

                  {optionsField ? (
                    <ScopedField
                      parameter={optionsField.parameter}
                      liveValue={optionsField.liveValue}
                      editedValues={editedValues}
                      onChange={onEditChange}
                      draftStatusById={draftStatusById}
                    />
                  ) : null}

                </div>
              </div>
            </article>
          </div>

        </div>
      </Panel>
    </section>
  )
}
