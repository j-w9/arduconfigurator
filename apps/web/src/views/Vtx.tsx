import { Panel, StatusBadge, buttonStyle } from '@arduconfig/ui-kit'
import type { ParameterState } from '@arduconfig/ardupilot-core'

import type { UseVtxTableResult } from '../hooks/use-vtx-table'
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
  typesField: VtxField | undefined
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
  /** MAVFTP-backed VTX band/frequency table (detection + edit state). */
  vtxTable: UseVtxTableResult
}

export function VtxView(props: VtxViewProps) {
  const {
    vtxTable,
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
                <strong>VTX Table / Advanced</strong>
                {vtxTable.status === 'available' ? <StatusBadge tone="success">Table detected</StatusBadge> : null}
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

                  {vtxTable.status === 'available' && vtxTable.table ? (
                    <VtxTableEditor vtxTable={vtxTable} />
                  ) : vtxTable.status === 'unavailable' ? (
                    <div className="bf-vtx-callout" data-testid="vtx-table-unavailable">
                      <StatusBadge tone="warning">Table not available</StatusBadge>
                      <p>
                        This firmware does not expose a VTX band/frequency table (<code>@VTX/vtxtable.dat</code>).
                        ArduPilot exposes frequency, power, max power, and an options bitmask instead. Build firmware
                        with the VTX table feature to edit bands/frequencies here.
                      </p>
                    </div>
                  ) : (
                    <div className="bf-vtx-callout" data-testid="vtx-table-checking">
                      <StatusBadge tone="neutral">Checking…</StatusBadge>
                      <p>Reading the VTX band/frequency table from the flight controller…</p>
                    </div>
                  )}
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

/**
 * Editable band/frequency grid + read-only power levels, shown when the
 * firmware exposes a VTX table over MAVFTP. Slice 1: band frequencies are
 * editable + savable (upload); power levels are read-only pending firmware
 * driver integration (Task 5).
 */
function VtxTableEditor({ vtxTable }: { vtxTable: UseVtxTableResult }) {
  const table = vtxTable.table
  if (!table) return null
  const channels = Array.from({ length: table.numChannels }, (_, index) => index)
  return (
    <div className="bf-vtx-table" data-testid="vtx-table-editor">
      <p className="setup-gui-box__note">
        Band/channel frequencies from the flight controller (<code>@VTX/vtxtable.dat</code>). Edit any cell (MHz, 0 =
        channel disabled) and Save to upload the whole table. Factory bands use the VTX&apos;s own frequency map.
      </p>
      <div className="bf-vtx-table__scroll">
        <table className="bf-vtx-table__grid">
          <thead>
            <tr>
              <th scope="col">Band</th>
              {channels.map((channel) => (
                <th key={channel} scope="col">
                  {channel + 1}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.bands.map((band, bandIndex) => (
              <tr key={bandIndex} data-testid={`vtx-table-band-${bandIndex}`}>
                <th scope="row" className="bf-vtx-table__band">
                  <strong>{band.letter || '?'}</strong>
                  <small>
                    {band.name || `Band ${bandIndex + 1}`}
                    {band.isFactory ? ' · factory' : ''}
                  </small>
                </th>
                {channels.map((channel) => (
                  <td key={channel}>
                    <input
                      type="number"
                      min={0}
                      step={1}
                      data-testid={`vtx-table-freq-${bandIndex}-${channel}`}
                      value={band.frequencies[channel] ?? 0}
                      onChange={(event) =>
                        vtxTable.setFrequency(bandIndex, channel, Number(event.target.value))
                      }
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="bf-vtx-table__power" data-testid="vtx-table-power">
        <div className="bf-vtx-table__power-head">
          <strong>Power levels</strong>
          <StatusBadge tone="neutral">read-only</StatusBadge>
        </div>
        <div className="config-pills">
          {table.powerLevels.map((level, index) => (
            <span key={index}>
              {level.label || String(level.value)} · {level.value}
            </span>
          ))}
        </div>
        <small>
          Power levels are stored and transported, but the VTX drivers don&apos;t apply the table&apos;s power values
          yet (pending firmware work) — editing lands in a follow-up.
        </small>
      </div>

      {vtxTable.error ? (
        <div className="parameter-follow-up parameter-follow-up--warning" data-testid="vtx-table-error">
          <StatusBadge tone="danger">upload failed</StatusBadge>
          <p>{vtxTable.error}</p>
        </div>
      ) : null}

      <div className="bf-vtx-table__actions">
        <button
          type="button"
          style={buttonStyle('primary')}
          data-testid="vtx-table-save"
          onClick={vtxTable.save}
          disabled={!vtxTable.dirty || vtxTable.saving}
        >
          {vtxTable.saving ? 'Uploading…' : vtxTable.dirty ? 'Save VTX Table' : 'Saved'}
        </button>
        <button
          type="button"
          style={buttonStyle()}
          data-testid="vtx-table-reset"
          onClick={vtxTable.reset}
          disabled={!vtxTable.dirty || vtxTable.saving}
        >
          Reset
        </button>
      </div>
    </div>
  )
}
