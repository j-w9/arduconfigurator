import { useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Panel, StatusBadge, buttonStyle } from '@arduconfig/ui-kit'
import type { ParameterState, VtxPowerTable } from '@arduconfig/ardupilot-core'
import {
  defaultVtxPowerLabel,
  defaultVtxTable,
  parseBetaflightVtxTable,
  serializeBetaflightVtxTable,
  VTX_TABLE_PRESETS,
  VTX_POWER_PRESETS
} from '@arduconfig/ardupilot-core'

import type { UseVtxTableResult } from '../hooks/use-vtx-table'
import { downloadTextFile } from '../download-file'
import { ScopedField, ScopedSelectField, type ScopedFieldDraftMap } from './ScopedField'

export interface VtxLinkPort {
  label: string
  protocolLabel: string
}

export interface VtxField {
  parameter: ParameterState
  liveValue: number | undefined
}

interface VtxPowerTableProps {
  powerTable: VtxPowerTable
  onPowerSlotChange: (index: number, value: number | 'pit' | undefined) => void
  onPowerEnabledChange: (enabled: boolean) => void
  onPowerPreset: (presetId: string) => void
}

export interface VtxViewProps extends VtxPowerTableProps {
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
  /** True when a digital/MSP video system owns the @VTX table (learned from the
   *  goggles over MSP). The table then renders read-only — no edit/upload. */
  tableLearned: boolean
}

export function VtxView(props: VtxViewProps) {
  const {
    headerNav,
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
    powerTable,
    onPowerSlotChange,
    onPowerEnabledChange,
    onPowerPreset,
    stagedCount,
    invalidCount,
    draftCount,
    canApply,
    isApplying,
    isBusy,
    onApply,
    onRevert,
    tableLearned
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
                    <VtxTableEditor
                      vtxTable={vtxTable}
                      learned={tableLearned}
                      powerTable={powerTable}
                      onPowerSlotChange={onPowerSlotChange}
                      onPowerEnabledChange={onPowerEnabledChange}
                      onPowerPreset={onPowerPreset}
                    />
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
 * Band/frequency grid + power levels, shown when the firmware exposes a VTX
 * table over MAVFTP. For an analog VTX the operator authors it: both halves edit
 * the in-RAM draft and Save uploads the whole table (@VTX/vtxtable.dat). For a
 * digital/MSP video system (`learned`) the goggles own the table (pushed over
 * MSP), so it renders read-only — no upload, import/export, or field editing.
 */
function VtxTableEditor({
  vtxTable,
  learned,
  powerTable,
  onPowerSlotChange,
  onPowerEnabledChange,
  onPowerPreset
}: { vtxTable: UseVtxTableResult; learned: boolean } & VtxPowerTableProps) {
  const [importOpen, setImportOpen] = useState(false)
  const [importText, setImportText] = useState('')
  const [importError, setImportError] = useState<string | undefined>(undefined)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const table = vtxTable.table
  if (!table) return null
  const channels = Array.from({ length: table.numChannels }, (_, index) => index)

  const handleExport = (): void => {
    downloadTextFile('vtxtable.txt', serializeBetaflightVtxTable(table), 'text/plain')
  }
  const applyImport = (text: string): void => {
    try {
      const imported = parseBetaflightVtxTable(text)
      vtxTable.loadTable(imported.table)
      // A Betaflight snippet still carries power levels, and they are the half
      // an operator most expects to arrive. Stage them into the parameters that
      // now hold them rather than dropping them on the floor.
      if (imported.powerLevels.length > 0) {
        onPowerPreset('')
        imported.powerLevels.forEach((level, index) => {
          onPowerSlotChange(index, level.value)
        })
      }
      setImportError(undefined)
      setImportOpen(false)
      setImportText('')
    } catch (caught) {
      setImportError(caught instanceof Error ? caught.message : 'Could not parse that Betaflight table.')
    }
  }
  const handleFile = (file: File | undefined): void => {
    if (!file) return
    void file.text().then(applyImport).catch(() => setImportError('Could not read that file.'))
  }
  const handlePreset = (id: string): void => {
    const preset = VTX_TABLE_PRESETS.find((candidate) => candidate.id === id)
    if (preset) {
      // Reuse the same parse+load path as a manual import — a preset is just a
      // known-good Betaflight table. The operator still edits/Saves afterwards.
      applyImport(preset.table)
    }
  }
  return (
    <div className="bf-vtx-table" data-testid="vtx-table-editor">
      {learned ? (
        <p className="setup-gui-box__note" data-testid="vtx-table-learned-note">
          This band/frequency + power table (<code>@VTX/vtxtable.dat</code>) is provided by your digital VTX and learned
          over MSP, so it is read-only here. Analog VTXs (SmartAudio/Tramp) let you author and upload the table.
        </p>
      ) : (
        <p className="setup-gui-box__note">
          VTX band/frequency + power table from the flight controller (<code>@VTX/vtxtable.dat</code>). Edit any frequency
          cell (MHz, 0 = channel disabled) or power level, then Save to upload the whole table. Factory bands use the
          VTX&apos;s own frequency map.
        </p>
      )}

      {learned ? null : (
      <>
      <div className="bf-vtx-table__io" data-testid="vtx-table-io">
        <select
          className="bf-vtx-table__preset-select"
          data-testid="vtx-table-preset-select"
          aria-label="Load a VTX table preset"
          value=""
          onChange={(event) => handlePreset(event.target.value)}
        >
          <option value="">Load a preset…</option>
          {VTX_TABLE_PRESETS.map((preset) => (
            <option key={preset.id} value={preset.id} title={preset.description}>
              {preset.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          style={buttonStyle()}
          data-testid="vtx-table-export-bf"
          onClick={handleExport}
        >
          Export Betaflight table
        </button>
        <button
          type="button"
          style={buttonStyle()}
          data-testid="vtx-table-import-toggle"
          onClick={() => {
            setImportOpen((open) => !open)
            setImportError(undefined)
          }}
        >
          {importOpen ? 'Cancel import' : 'Import Betaflight table'}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".txt,.config,text/plain"
          style={{ display: 'none' }}
          data-testid="vtx-table-import-file"
          onChange={(event) => {
            handleFile(event.target.files?.[0])
            event.target.value = ''
          }}
        />
      </div>

      {importOpen ? (
        <div className="bf-vtx-table__import" data-testid="vtx-table-import-panel">
          <p className="setup-gui-box__note">
            Paste a Betaflight <code>vtxtable</code> snippet (or a full CLI dump), or load a <code>.txt</code> file. It
            loads into the editor below — review it, then Save to upload.
          </p>
          <textarea
            data-testid="vtx-table-import-text"
            value={importText}
            onChange={(event) => setImportText(event.target.value)}
            placeholder={'vtxtable bands 5\nvtxtable channels 8\nvtxtable band 1 BOSCAM_A A FACTORY 5865 …'}
            rows={5}
          />
          <div className="bf-vtx-table__import-actions">
            <button
              type="button"
              style={buttonStyle('primary')}
              data-testid="vtx-table-import-load"
              onClick={() => applyImport(importText)}
              disabled={importText.trim().length === 0}
            >
              Load pasted table
            </button>
            <button
              type="button"
              style={buttonStyle()}
              data-testid="vtx-table-import-file-button"
              onClick={() => fileInputRef.current?.click()}
            >
              Load .txt file…
            </button>
          </div>
          {importError ? (
            <div className="parameter-follow-up parameter-follow-up--warning" data-testid="vtx-table-import-error">
              <StatusBadge tone="danger">import failed</StatusBadge>
              <p>{importError}</p>
            </div>
          ) : null}
        </div>
      ) : null}
      </>
      )}
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
                      disabled={learned}
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

      {/* Power is PARAMETERS now, not part of the @VTX blob: VTX_PWRTBL_EN and
          six slots VTX_PWRTBL1..6. They stage as ordinary drafts and apply
          through the normal reviewed Apply, and -- unlike the band table --
          they work on every board, including ones with no storage for a table.
          A slot is -1 unused, 0 pit mode, or a power in mW. */}
      <div className="bf-vtx-table__power" data-testid="vtx-table-power">
        <div className="bf-vtx-table__power-head">
          <strong>Power levels</strong>
          {powerTable.supported && !learned ? (
            <select
              className="bf-vtx-table__preset-select"
              data-testid="vtx-table-power-preset-select"
              aria-label="Load a VTX power-table preset"
              value=""
              onChange={(event) => onPowerPreset(event.target.value)}
            >
              <option value="">Load a power preset…</option>
              {VTX_POWER_PRESETS.map((preset) => (
                <option key={preset.id} value={preset.id} title={preset.description}>
                  {preset.label}
                </option>
              ))}
            </select>
          ) : null}
        </div>

        {!powerTable.supported ? (
          <p className="bf-note" data-testid="vtx-table-power-unsupported">
            This firmware does not expose the user power table (VTX_PWRTBL_EN), so the VTX&apos;s own
            power levels are in use.
          </p>
        ) : (
          <>
            <label className="bf-vtx-table__power-enable">
              <input
                type="checkbox"
                data-testid="vtx-table-power-enable"
                checked={powerTable.enabled}
                disabled={learned}
                onChange={(event) => onPowerEnabledChange(event.target.checked)}
              />
              <span>
                Use this power table <code>(VTX_PWRTBL_EN)</code>
              </span>
            </label>

            <table className="bf-vtx-table__power-grid">
              <thead>
                <tr>
                  <th scope="col">Slot</th>
                  <th scope="col">Use</th>
                  <th scope="col">Power (mW)</th>
                  <th scope="col">Shown as</th>
                </tr>
              </thead>
              <tbody>
                {powerTable.slots.map((slot) => (
                  <tr key={slot.paramId} data-testid={`vtx-table-power-${slot.index}`}>
                    <th scope="row" title={slot.paramId}>
                      {slot.index + 1}
                    </th>
                    <td>
                      <select
                        data-testid={`vtx-table-power-kind-${slot.index}`}
                        aria-label={`Slot ${slot.index + 1} use`}
                        value={slot.kind}
                        disabled={learned}
                        onChange={(event) =>
                          onPowerSlotChange(
                            slot.index,
                            event.target.value === 'unused'
                              ? undefined
                              : event.target.value === 'pit'
                                ? 'pit'
                                : (slot.milliwatts ?? 25)
                          )
                        }
                      >
                        <option value="unused">Unused</option>
                        <option value="pit">Pit mode</option>
                        <option value="power">Power</option>
                      </select>
                    </td>
                    <td>
                      <input
                        type="number"
                        min={1}
                        step={1}
                        data-testid={`vtx-table-power-value-${slot.index}`}
                        aria-label={`Slot ${slot.index + 1} power in milliwatts`}
                        value={slot.milliwatts ?? ''}
                        disabled={learned || slot.kind !== 'power'}
                        onChange={(event) => onPowerSlotChange(slot.index, Number(event.target.value))}
                      />
                    </td>
                    <td data-testid={`vtx-table-power-label-${slot.index}`}>
                      {slot.kind === 'power' && slot.milliwatts !== undefined
                        ? defaultVtxPowerLabel(slot.milliwatts)
                        : slot.kind === 'pit'
                          ? 'PIT'
                          : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <small>
              Power in <strong>milliwatts (mW)</strong>. The firmware stores mW for every protocol and
              derives the SmartAudio dBm / dac step from it, so enter mW here (e.g. 400, not 26 dBm).
              The switch position is the slot number, and there are no stored labels any more — the
              text shown is derived from the value.
            </small>
          </>
        )}
      </div>

      {vtxTable.error ? (
        <div className="parameter-follow-up parameter-follow-up--warning" data-testid="vtx-table-error">
          <StatusBadge tone="danger">upload failed</StatusBadge>
          <p>{vtxTable.error}</p>
        </div>
      ) : null}

      {learned ? null : (
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
            Discard edits
          </button>
          {/* There is no reset command in the protocol: restoring the standard
              bands means UPLOADING them, which is why the ground station
              carries a copy. Staged like any other edit so the operator sees
              what it will do before Save sends it. */}
          <button
            type="button"
            style={buttonStyle()}
            data-testid="vtx-table-restore-defaults"
            onClick={() => vtxTable.loadTable(defaultVtxTable())}
            disabled={vtxTable.saving}
            title="Load the firmware's standard 11 bands, ready to save"
          >
            Load default bands
          </button>
        </div>
      )}
    </div>
  )
}
