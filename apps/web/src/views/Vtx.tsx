import { Panel, StatusBadge, buttonStyle } from '@arduconfig/ui-kit'
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
  linkPorts: readonly VtxLinkPort[]
  enabledLabel: string
  enableField: VtxField | undefined
  frequencyField: VtxField | undefined
  powerField: VtxField | undefined
  maxPowerField: VtxField | undefined
  optionsField: VtxField | undefined
  editedValues: Record<string, string>
  onEditChange: (paramId: string, value: string) => void
  draftStatusById: ScopedFieldDraftMap
  stagedCount: number
  invalidCount: number
  draftCount: number
  canApply: boolean
  isApplying: boolean
  isBusy: boolean
  onApply: () => void
  onRevert: () => void
}

export function VtxView(props: VtxViewProps) {
  const {
    linkPorts,
    enabledLabel,
    enableField,
    frequencyField,
    powerField,
    maxPowerField,
    optionsField,
    editedValues,
    onEditChange,
    draftStatusById,
    stagedCount,
    invalidCount,
    draftCount,
    canApply,
    isApplying,
    isBusy,
    onApply,
    onRevert
  } = props

  const frequency = frequencyField?.liveValue
  const power = powerField?.liveValue
  const maxPower = maxPowerField?.liveValue
  const options = optionsField?.liveValue

  return (
    <section className="grid one-up">
      <Panel
        title="VTX"
        subtitle="Use a dedicated VTX workflow while keeping the actual ArduPilot-backed controls visible and honest."
      >
        <div className="bf-tab-stack">
          <div className="bf-note">
            <p>Assign the control UART in Ports first. This tab is for transmitter-facing behavior, not the serial-role assignment itself.</p>
            <p>
              {linkPorts.length > 0
                ? `Detected control path: ${linkPorts.map((port) => `${port.label} (${port.protocolLabel})`).join(', ')}`
                : 'No VTX control link detected in current port roles.'}
            </p>
          </div>

          <div className="bf-vtx-grid">
            <article className="bf-gui-box bf-vtx-grid__config">
              <div className="bf-gui-box__titlebar">
                <strong>Selected Mode</strong>
              </div>
              <div className="bf-gui-box__body">
                <div className="config-pills">
                  {enableField ? <span>Control: {enabledLabel}</span> : null}
                  {frequencyField ? <span>Frequency: {frequency !== undefined ? `${frequency} MHz` : 'Unknown'}</span> : null}
                  {powerField ? <span>Power: {power !== undefined ? `${power} mW` : 'Unknown'}</span> : null}
                  {maxPowerField ? <span>Max power: {maxPower !== undefined ? `${maxPower} mW` : 'Unknown'}</span> : null}
                </div>

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
                    <ScopedField
                      parameter={powerField.parameter}
                      liveValue={powerField.liveValue}
                      editedValues={editedValues}
                      onChange={onEditChange}
                      draftStatusById={draftStatusById}
                    />
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
                    <strong>{power !== undefined ? `${power} mW` : 'Unknown'}</strong>
                  </div>
                  <div className="bf-gui-box__kv-row">
                    <span>Max power</span>
                    <strong>{maxPower !== undefined ? `${maxPower} mW` : 'Unknown'}</strong>
                  </div>
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
                <strong>VTX Table / Advanced</strong>
              </div>
              <div className="bf-gui-box__body">
                <p className="setup-gui-box__note">ArduPilot currently exposes frequency, power, max power, and an advanced options bitmask here instead of a full band/channel table.</p>
                <div className="bf-vtx-advanced-grid">
                  {optionsField ? (
                    <ScopedField
                      parameter={optionsField.parameter}
                      liveValue={optionsField.liveValue}
                      editedValues={editedValues}
                      onChange={onEditChange}
                      draftStatusById={draftStatusById}
                      caption="Keep this exposed so the ArduPilot gap stays obvious instead of hidden."
                    />
                  ) : null}

                  <div className="bf-vtx-callout">
                    <StatusBadge tone="warning">Table not available</StatusBadge>
                    <p>When ArduPilot grows explicit VTX band/channel table support, this box should turn into a full table editor instead of staying a placeholder.</p>
                  </div>
                </div>
              </div>
            </article>
          </div>

          <div className="bf-toolbar">
            <div className="bf-toolbar__status">
              <span>{stagedCount} staged</span>
              <span>{invalidCount} invalid</span>
            </div>
            <button
              type="button"
              style={buttonStyle('primary')}
              onClick={onApply}
              disabled={isBusy || stagedCount === 0 || invalidCount > 0 || !canApply}
            >
              {isApplying ? 'Applying…' : `Save VTX (${stagedCount})`}
            </button>
            <button
              type="button"
              style={buttonStyle()}
              onClick={onRevert}
              disabled={isBusy || draftCount === 0}
            >
              Revert
            </button>
          </div>
        </div>
      </Panel>
    </section>
  )
}
