// PortsSection — App.tsx's `activeViewId === 'ports'` block, lifted into
// its own component. Ports is unique in that its JSX is INLINE (no
// PortsView component); the section therefore owns ~730 lines of JSX
// directly. App.tsx threads the data via grouped props.

import type { ReactElement, ReactNode } from 'react'
import type { ArduPilotConfiguratorRuntime, ConfiguratorSnapshot, ParameterDraftEntry, ParameterState } from '@arduconfig/ardupilot-core'
import type { AppViewId, BoardCatalogEntry, BoardReferenceLink } from '@arduconfig/param-metadata'
import {
  ARDUCOPTER_MSP_OPTION_BIT_LABELS,
  ARDUCOPTER_SERIAL_OPTION_BIT_LABELS,
  arducopterSerialBaudRate,
  arducopterSerialProtocolOptions,
  encodeArducopterSerialBaud,
  formatArducopterGpsAutoConfig,
  formatArducopterGpsAutoSwitch,
  formatArducopterGpsPrimary,
  formatArducopterGpsRateMs,
  formatArducopterGpsType,
  formatArducopterMspOsdCellCount,
  formatArducopterOsdChannel,
  formatArducopterOsdSwitchMethod,
  formatArducopterOsdType,
  formatArducopterSerialProtocol,
  formatArducopterSerialRtscts,
  formatArducopterVtxEnable
} from '@arduconfig/param-metadata'
import { Panel, StatusBadge, buttonStyle } from '@arduconfig/ui-kit'

import { SERIAL_BAUD_PRESET_RATES, formatBaudRate, isPresetBaudRate, parseSerialBaudInput, selectedBaudPresetValue } from '../baud-helpers'
import type { ParameterNotice } from '../hooks/use-parameter-feedback'
import type { UsePortsViewResult } from '../hooks/use-ports-view'
import { LiveGpsMapCard } from '../live-gps-map'
import { MavlinkSigningPanel } from '../mavlink-signing-panel'
import { normalizeBitmaskValue } from '../parameter-format'
import { describeBitmaskSelections, hasBitmaskFlag, toggleBitmaskFlag } from '../selectors/bitmask'
import type { SerialPortViewModel } from '../serial-port-helpers'
import { toneForScopedDraftReview } from '../tone-helpers'
import type { AdditionalSettingsGroup, CanNodePeripheralViewModel, GpsPeripheralViewModel } from '../view-models/peripherals'
import { ScopedField, ScopedSelectField } from '../views/ScopedField'

export interface PortsSectionProps {
  snapshot: ConfiguratorSnapshot
  busyAction: string | undefined
  canApplyDraftParameters: boolean
  parameterNotice: ParameterNotice | undefined
  // Board catalog data
  boardCatalogEntry: BoardCatalogEntry | undefined
  boardReferenceLinks: readonly BoardReferenceLink[]
  // Serial port models
  serialPortViewModels: readonly SerialPortViewModel[]
  visibleSerialPortViewModels: readonly SerialPortViewModel[]
  gpsPeripheralViewModels: readonly GpsPeripheralViewModel[]
  canNodePeripheralViewModels: readonly CanNodePeripheralViewModel[]
  uartsMappedPortCount: number
  uartsStatusTone: 'success' | 'warning' | 'danger' | 'neutral'
  portVisibilitySummary: string
  // Drafts: this view's scope
  portsDraftEntries: readonly ParameterDraftEntry[]
  portsStagedDrafts: readonly ParameterDraftEntry[]
  portsInvalidDrafts: readonly ParameterDraftEntry[]
  // Additional-settings block
  portsAdditionalGroups: AdditionalSettingsGroup[]
  portsAdditionalDraftEntries: ParameterDraftEntry[]
  portsAdditionalStagedDrafts: ParameterDraftEntry[]
  portsAdditionalInvalidDrafts: ParameterDraftEntry[]
  // VTX/OSD summary card inputs (the Ports tab embeds quick-status pills
  // that read live VTX + OSD params; kept in App.tsx because other views
  // also need them).
  vtxLinkPorts: readonly SerialPortViewModel[]
  osdLinkPorts: readonly SerialPortViewModel[]
  vtxEnabled: number | undefined
  vtxFrequency: number | undefined
  vtxPower: number | undefined
  vtxMaxPower: number | undefined
  vtxEnableParameter: ParameterState | undefined
  vtxFrequencyParameter: ParameterState | undefined
  vtxPowerParameter: ParameterState | undefined
  vtxMaxPowerParameter: ParameterState | undefined
  vtxOptionsParameter: ParameterState | undefined
  osdType: number | undefined
  osdChannel: number | undefined
  osdSwitchMethod: number | undefined
  mspOptions: number | undefined
  mspOsdCellCount: number | undefined
  osdTypeParameter: ParameterState | undefined
  osdChannelParameter: ParameterState | undefined
  osdSwitchMethodParameter: ParameterState | undefined
  mspOptionsParameter: ParameterState | undefined
  mspOsdCellCountParameter: ParameterState | undefined
  // GPS scalars + parameter objects (used by the embedded GPS card)
  gpsAutoConfig: number | undefined
  gpsAutoSwitch: number | undefined
  gpsPrimary: number | undefined
  gpsRateMs: number | undefined
  gpsAutoConfigParameter: ParameterState | undefined
  gpsAutoSwitchParameter: ParameterState | undefined
  gpsPrimaryParameter: ParameterState | undefined
  gpsRateParameter: ParameterState | undefined
  // Live draft / edit plumbing
  editedValues: Record<string, string>
  parameterDraftById: ReadonlyMap<string, ParameterDraftEntry>
  setDraft: (paramId: string, value: string) => void
  updateDrafts: (mutator: (existing: Record<string, string>) => Record<string, string>) => void
  // Sibling view state shared with App
  portsView: UsePortsViewResult
  // Handlers + nav
  onApplyScopedDrafts: (
    drafts: readonly ParameterDraftEntry[],
    busyKey: string,
    scopeLabel: string
  ) => void | Promise<void>
  onDiscardScopedDrafts: (paramIds: readonly string[], scopeLabel: string) => void
  setActiveViewId: (id: AppViewId) => void
  renderAdditionalSettingsCard: (
    title: string,
    description: string,
    groups: AdditionalSettingsGroup[],
    drafts: ParameterDraftEntry[],
    staged: ParameterDraftEntry[],
    invalid: ParameterDraftEntry[],
    applyActionId: string,
    applyLabel: string,
    discardScope: string
  ) => ReactNode
  // The configurator runtime, for the self-contained MAVLink signing panel
  // (it owns its own state + reads the codec's rejection count directly).
  runtime: ArduPilotConfiguratorRuntime
}

export function PortsSection(props: PortsSectionProps): ReactElement {
  const {
    snapshot,
    busyAction,
    canApplyDraftParameters,
    parameterNotice,
    boardCatalogEntry,
    boardReferenceLinks,
    serialPortViewModels,
    visibleSerialPortViewModels,
    gpsPeripheralViewModels,
    canNodePeripheralViewModels,
    uartsMappedPortCount,
    uartsStatusTone,
    portVisibilitySummary,
    portsDraftEntries,
    portsStagedDrafts,
    portsInvalidDrafts,
    portsAdditionalGroups,
    portsAdditionalDraftEntries,
    portsAdditionalStagedDrafts,
    portsAdditionalInvalidDrafts,
    vtxLinkPorts,
    osdLinkPorts,
    vtxEnabled,
    vtxFrequency,
    vtxPower,
    vtxMaxPower,
    vtxEnableParameter,
    vtxFrequencyParameter,
    vtxPowerParameter,
    vtxMaxPowerParameter,
    vtxOptionsParameter,
    osdType,
    osdChannel,
    osdSwitchMethod,
    mspOptions,
    mspOsdCellCount,
    osdTypeParameter,
    osdChannelParameter,
    osdSwitchMethodParameter,
    mspOptionsParameter,
    mspOsdCellCountParameter,
    gpsAutoConfig,
    gpsAutoSwitch,
    gpsPrimary,
    gpsRateMs,
    gpsAutoConfigParameter,
    gpsAutoSwitchParameter,
    gpsPrimaryParameter,
    gpsRateParameter,
    editedValues,
    parameterDraftById,
    setDraft,
    updateDrafts,
    portsView,
    onApplyScopedDrafts,
    onDiscardScopedDrafts,
    setActiveViewId,
    renderAdditionalSettingsCard,
    runtime
  } = props

  const {
    showAllSerialPorts,
    setShowAllSerialPorts,
    customSerialBaudInputs,
    setCustomSerialBaudInputs,
    expandedSerialOptionsPortNumber,
    setExpandedSerialOptionsPortNumber
  } = portsView

  // Some inline references use App-side names that don't survive the
  // verbatim move; aliasing avoids touching the JSX.
  const handleApplyScopedParameterDrafts = onApplyScopedDrafts
  const handleDiscardScopedParameterDrafts = onDiscardScopedDrafts

  return (

	      <section className="grid one-up">
	        <div id="setup-panel-ports">
	          <Panel
	            title="Ports & Peripherals"
	            subtitle="Assign serial roles, baud rates, GPS drivers, and hardware flow-control settings without dropping into the raw parameter table."
	          >
		          <div className="telemetry-stack telemetry-stack--ports">
		            <div className="ports-workspace">
		              <div className="ports-workspace__main">
                    <div className="ports-surface">
                      <div className="ports-surface__header">
                        <div>
                          <h3>Port matrix</h3>
                          <p>One row per UART: role, baud rates, and options inline.</p>
                        </div>
                        <div className="ports-surface__header-actions">
                          <StatusBadge tone={toneForScopedDraftReview(portsStagedDrafts.length, portsInvalidDrafts.length)}>
                            {portsInvalidDrafts.length > 0
                              ? `${portsInvalidDrafts.length} invalid`
                              : portsStagedDrafts.length > 0
                                ? `${portsStagedDrafts.length} staged`
                                : 'in sync'}
                          </StatusBadge>
                          {serialPortViewModels.length > visibleSerialPortViewModels.length || showAllSerialPorts ? (
                            <button
                              style={buttonStyle()}
                              onClick={() => setShowAllSerialPorts((current) => !current)}
                              disabled={busyAction !== undefined}
                            >
                              {showAllSerialPorts ? 'Show Active Ports' : `Show All ${serialPortViewModels.length} Ports`}
                            </button>
                          ) : null}
                        </div>
                      </div>

                      {/* Apply-result notice intentionally rendered next to
                       *  the Apply toolbar below — placing it at the top of
                       *  Ports made post-write content GROW above the
                       *  operator's viewport, causing the page to visually
                       *  scroll down each time a write succeeded. */}

                      <div className="telemetry-metric-grid">
                        <article className="telemetry-metric-card">
                          <span>Detected ports</span>
                          <strong>{serialPortViewModels.length}</strong>
                        </article>
                        <article className="telemetry-metric-card">
                          <span>Staged changes</span>
                          <strong>{portsStagedDrafts.length}</strong>
                        </article>
                        <article className="telemetry-metric-card">
                          <span>Primary GPS</span>
                          <strong>{formatArducopterGpsType(gpsPeripheralViewModels.find((peripheral) => peripheral.label === 'Primary GPS')?.value)}</strong>
                        </article>
                        <article className="telemetry-metric-card">
                          <span>Secondary GPS</span>
                          <strong>{formatArducopterGpsType(gpsPeripheralViewModels.find((peripheral) => peripheral.label === 'Secondary GPS')?.value)}</strong>
                        </article>
                      </div>

                      {serialPortViewModels.length > 0 ? (
                        <>
                          <div className="ports-surface__disclosure">
                            <small>{portVisibilitySummary}</small>
                          </div>

                          <div className="ports-matrix">
                            <div className="ports-matrix__head">
                              <span>Port</span>
                              <span>Function</span>
                              <span>Baud</span>
                              <span>Flow</span>
                              <span>Options</span>
                            </div>

                            {visibleSerialPortViewModels.map((port) => {
                              // Lead every row with the UART number (SERIAL0 is
                              // the USB console, not a hardware UART).
                              const portHeading = port.portNumber === 0 ? 'USB / Console' : `UART ${port.portNumber}`
                              const protocolParameter = port.protocolParameter
                              const baudParameter = port.baudParameter
                              const optionsParameter = port.optionsParameter
                              const flowControlParameter = port.flowControlParameter
                              const editedBaudValue = baudParameter ? editedValues[baudParameter.id] : undefined
                              const currentEncodedBaud = editedBaudValue !== undefined && editedBaudValue !== '' ? Number(editedBaudValue) : port.baudValue
                              const currentBaudRate = arducopterSerialBaudRate(currentEncodedBaud)
                              const customBaudInputValue =
                                baudParameter && customSerialBaudInputs[baudParameter.id] !== undefined
                                  ? customSerialBaudInputs[baudParameter.id]
                                  : currentBaudRate !== undefined
                                    ? String(currentBaudRate)
                                    : ''
                              const showCustomBaudInput =
                                baudParameter !== undefined &&
                                (customSerialBaudInputs[baudParameter.id] !== undefined || !isPresetBaudRate(currentBaudRate))
                              const editedOptionsValue = optionsParameter
                                ? normalizeBitmaskValue(editedValues[optionsParameter.id], port.optionsValue)
                                : undefined
                              const effectiveOptionsValue = optionsParameter
                                ? parameterDraftById.get(optionsParameter.id)?.status === 'staged'
                                  ? parameterDraftById.get(optionsParameter.id)?.nextValue
                                  : editedOptionsValue
                                : port.optionsValue
                              const serialOptionsSummary = optionsParameter
                                ? describeBitmaskSelections(effectiveOptionsValue, ARDUCOPTER_SERIAL_OPTION_BIT_LABELS, 'No special options')
                                : port.optionsLabel
                              const selectedSerialOptionLabels = Object.entries(ARDUCOPTER_SERIAL_OPTION_BIT_LABELS)
                                .filter(([bit]) => hasBitmaskFlag(effectiveOptionsValue, Number(bit)))
                                .map(([, label]) => label)
                              const rowParameterIds = [
                                protocolParameter?.id,
                                baudParameter?.id,
                                optionsParameter?.id,
                                flowControlParameter?.id
                              ].filter((value): value is string => value !== undefined)
                              const rowHasInvalid = rowParameterIds.some((parameterId) => parameterDraftById.get(parameterId)?.status === 'invalid')
                              const rowHasStaged = rowParameterIds.some((parameterId) => parameterDraftById.get(parameterId)?.status === 'staged')

                              return (
                                <article
                                  key={port.portNumber}
                                  className={`ports-matrix-row${rowHasInvalid ? ' is-invalid' : rowHasStaged ? ' is-staged' : ''}${
                                    !port.editable ? ' is-readonly' : ''
                                  }`}
                                >
                                  <div className="ports-matrix-row__grid">
                                    <div className="ports-matrix-row__cell ports-matrix-row__cell--port">
                                      <div className="ports-matrix-row__identity">
                                        <div className="ports-matrix-row__title">
                                          <strong>{portHeading}</strong>
                                          <small>
                                            {`SERIAL${port.portNumber}_PROTOCOL `}
                                            {port.protocolValue ?? '—'}
                                          </small>
                                        </div>
                                        <StatusBadge tone={rowHasInvalid ? 'danger' : rowHasStaged ? 'warning' : port.editable ? 'neutral' : 'warning'}>
                                          {rowHasInvalid ? 'invalid' : rowHasStaged ? 'staged' : port.editable ? 'ready' : 'read only'}
                                        </StatusBadge>
                                      </div>
                                      <div className="config-pills">
                                        {/* Purpose + descriptive role/connector are secondary to the UART number. */}
                                        <span>{port.usageSummary}</span>
                                        {port.label && port.label !== portHeading ? <span>{port.label}</span> : null}
                                        {port.hardwarePort ? <span>{port.hardwarePort}</span> : null}
                                        {port.boardTrafficSummary ? <span>{port.boardTrafficSummary}</span> : null}
                                      </div>
                                    </div>

                                    <div className="ports-matrix-row__cell">
                                      {protocolParameter ? (
                                        <label className="scoped-editor-field scoped-editor-field--compact">
                                          <span>Function</span>
                                          <select
                                            value={editedValues[protocolParameter.id] ?? String(port.protocolValue ?? '')}
                                            onChange={(event) =>
                                              setDraft(protocolParameter.id, event.target.value)
                                            }
                                            disabled={!port.editable}
                                          >
                                            {arducopterSerialProtocolOptions().map((valueOption) => (
                                              <option key={`${protocolParameter.id}:${valueOption.value}`} value={String(valueOption.value)}>
                                                {valueOption.label}
                                              </option>
                                            ))}
                                          </select>
                                          <small>{protocolParameter ? formatArducopterSerialProtocol(Number(editedValues[protocolParameter.id] ?? port.protocolValue)) : port.protocolLabel}</small>
                                        </label>
                                      ) : (
                                        <div className="ports-matrix-row__readout">{port.protocolLabel}</div>
                                      )}
                                    </div>

                                    <div className="ports-matrix-row__cell">
                                      {baudParameter ? (
                                        <div className="ports-matrix-row__baud">
                                          <label className="scoped-editor-field scoped-editor-field--compact">
                                            <span>Baud</span>
                                            <select
                                              value={selectedBaudPresetValue(currentBaudRate)}
                                              onChange={(event) => {
                                                if (event.target.value === 'custom') {
                                                  setCustomSerialBaudInputs((existing) => ({
                                                    ...existing,
                                                    [baudParameter.id]: currentBaudRate !== undefined ? String(currentBaudRate) : ''
                                                  }))
                                                  return
                                                }

                                                const selectedBaudRate = Number(event.target.value)
                                                const encodedValue = encodeArducopterSerialBaud(selectedBaudRate)
                                                setCustomSerialBaudInputs((existing) => {
                                                  if (!(baudParameter.id in existing)) {
                                                    return existing
                                                  }
                                                  const next = { ...existing }
                                                  delete next[baudParameter.id]
                                                  return next
                                                })
                                                setDraft(baudParameter.id, String(encodedValue ?? port.baudValue ?? ''))
                                              }}
                                              disabled={!port.editable}
                                            >
                                              {SERIAL_BAUD_PRESET_RATES.map((baudRate) => (
                                                <option key={`${baudParameter.id}:preset:${baudRate}`} value={String(baudRate)}>
                                                  {formatBaudRate(baudRate)}
                                                </option>
                                              ))}
                                              <option value="custom">Custom / AP value</option>
                                            </select>
                                          </label>
                                          {showCustomBaudInput ? (
                                            <label className="scoped-editor-field scoped-editor-field--compact">
                                              <span>Custom</span>
                                              <input
                                                type="number"
                                                inputMode="numeric"
                                                min={1}
                                                value={customBaudInputValue}
                                                onChange={(event) => {
                                                  const nextValue = event.target.value
                                                  setCustomSerialBaudInputs((existing) => ({
                                                    ...existing,
                                                    [baudParameter.id]: nextValue
                                                  }))
                                                  const parsed = parseSerialBaudInput(nextValue)
                                                  if (parsed.encodedValue === undefined) {
                                                    return
                                                  }
                                                  setDraft(baudParameter.id, String(parsed.encodedValue))
                                                }}
                                                disabled={!port.editable}
                                              />
                                            </label>
                                          ) : null}
                                        </div>
                                      ) : (
                                        <div className="ports-matrix-row__readout">{port.baudLabel}</div>
                                      )}
                                    </div>

                                    <div className="ports-matrix-row__cell">
                                      {flowControlParameter ? (
                                        <label className="scoped-editor-field scoped-editor-field--compact">
                                          <span>Flow</span>
                                          <select
                                            value={editedValues[flowControlParameter.id] ?? String(port.flowControlValue ?? '')}
                                            onChange={(event) =>
                                              setDraft(flowControlParameter.id, event.target.value)
                                            }
                                            disabled={!port.editable}
                                          >
                                            {(flowControlParameter.definition?.options ?? []).map((valueOption) => (
                                              <option key={`${flowControlParameter.id}:${valueOption.value}`} value={String(valueOption.value)}>
                                                {valueOption.label}
                                              </option>
                                            ))}
                                          </select>
                                          <small>{formatArducopterSerialRtscts(Number(editedValues[flowControlParameter.id] ?? port.flowControlValue))}</small>
                                        </label>
                                      ) : (
                                        <div className="ports-matrix-row__readout">{port.flowControlLabel ?? 'N/A'}</div>
                                      )}
                                    </div>

                                    <div className="ports-matrix-row__cell">
                                      <div className="ports-matrix-row__options">
                                        <div className="ports-matrix-row__options-header">
                                          <strong>Serial options</strong>
                                          {optionsParameter ? (
                                            <button
                                              style={buttonStyle()}
                                              onClick={() =>
                                                setExpandedSerialOptionsPortNumber((current) => (current === port.portNumber ? undefined : port.portNumber))
                                              }
                                              disabled={!port.editable}
                                            >
                                              {expandedSerialOptionsPortNumber === port.portNumber ? 'Hide' : 'Edit'}
                                            </button>
                                          ) : null}
                                        </div>
                                        {/* Selected serial options show here as chips (this column
                                            replaced the old Notes column). */}
                                        {selectedSerialOptionLabels.length > 0 ? (
                                          <div className="config-pills ports-matrix-row__option-chips" data-testid={`serial-options-chips-${port.portNumber}`}>
                                            {selectedSerialOptionLabels.map((label) => (
                                              <span key={label}>{label}</span>
                                            ))}
                                          </div>
                                        ) : (
                                          <small>{serialOptionsSummary}</small>
                                        )}
                                      </div>
                                    </div>
                                  </div>

                                  {optionsParameter && expandedSerialOptionsPortNumber === port.portNumber ? (
                                    <div className="ports-matrix-row__expanded">
                                      <div className="scoped-checkbox-list port-row__options-panel">
                                        {Object.entries(ARDUCOPTER_SERIAL_OPTION_BIT_LABELS).map(([bit, label]) => {
                                          const numericBit = Number(bit)
                                          return (
                                            <label key={`${optionsParameter.id}:${bit}`} className="scoped-checkbox-option">
                                              <input
                                                type="checkbox"
                                                checked={hasBitmaskFlag(editedOptionsValue, numericBit)}
                                                onChange={(event) =>
                                                  updateDrafts((existing) => {
                                                    const currentValue = normalizeBitmaskValue(existing[optionsParameter.id], port.optionsValue)
                                                    const nextValue = toggleBitmaskFlag(currentValue, numericBit, event.target.checked)

                                                    return {
                                                      ...existing,
                                                      [optionsParameter.id]: String(nextValue)
                                                    }
                                                  })
                                                }
                                                disabled={!port.editable}
                                              />
                                              <span>{label}</span>
                                            </label>
                                          )
                                        })}
                                      </div>
                                    </div>
                                  ) : null}
                                </article>
                              )
                            })}
                          </div>
                        </>
                      ) : (
                        <p className="telemetry-note">No `SERIALx_*` parameters were detected in the current snapshot.</p>
                      )}
                    </div>
		              </div>
		              <div className="ports-workspace__sidebar">

                {snapshot.hardware.board || snapshot.hardware.uartsFile.status !== 'idle' ? (
                  <article className="port-card">
                    <div className="port-card__header">
                      <div>
                        <strong>{boardCatalogEntry?.label ?? (snapshot.hardware.board ? `Board ${snapshot.hardware.board.boardType}` : 'Board detection')}</strong>
                        <small>
                          {boardCatalogEntry?.familyLabel
                            ?? (snapshot.hardware.board ? `APJ board ${snapshot.hardware.board.boardType}` : 'Waiting for AUTOPILOT_VERSION')}
                        </small>
                      </div>
                      <StatusBadge tone={uartsStatusTone}>
                        {snapshot.hardware.uartsFile.status === 'ready'
                          ? 'uarts.txt ready'
                          : snapshot.hardware.uartsFile.status === 'loading'
                            ? 'loading'
                            : snapshot.hardware.uartsFile.status === 'unsupported'
                              ? 'FTP unavailable'
                              : snapshot.hardware.uartsFile.status === 'missing'
                                ? 'uarts missing'
                                : snapshot.hardware.uartsFile.status === 'error'
                                  ? 'FTP error'
                                  : 'identifying'}
                      </StatusBadge>
                    </div>

                    <div className="config-pills">
                      {snapshot.hardware.board ? <span>Board type {snapshot.hardware.board.boardType}</span> : null}
                      {snapshot.hardware.board ? <span>{snapshot.hardware.board.ftpSupported ? 'MAVFTP supported' : 'MAVFTP unavailable'}</span> : null}
                      {uartsMappedPortCount > 0 ? <span>{uartsMappedPortCount} mapped UARTs</span> : null}
                    </div>

                    <p>
                      {snapshot.hardware.uartsFile.status === 'ready'
                        ? 'Ports now use the controller-reported UART mapping instead of generic SERIAL labels.'
                        : snapshot.hardware.uartsFile.status === 'unsupported'
                          ? 'This controller did not advertise MAVFTP support, so Ports stays generic.'
                          : snapshot.hardware.uartsFile.status === 'missing'
                            ? 'Board identity is available, but this controller did not expose `@SYS/uarts.txt`.'
                            : snapshot.hardware.uartsFile.status === 'error'
                              ? `MAVFTP failed: ${snapshot.hardware.uartsFile.error ?? 'Unknown error.'}`
                              : 'Waiting for board identity and UART mapping from the controller.'}
                    </p>

                    {boardCatalogEntry ? (
                      <div className="port-board-links">
                        <a href={boardCatalogEntry.wikiUrl} target="_blank" rel="noreferrer">
                          ArduPilot Wiki
                        </a>
                        <a href={boardCatalogEntry.manufacturerUrl} target="_blank" rel="noreferrer">
                          {boardCatalogEntry.manufacturerName}
                        </a>
                        {boardReferenceLinks.map((reference) => (
                          <a key={reference.id} href={reference.url} target="_blank" rel="noreferrer">
                            {reference.label}
                          </a>
                        ))}
                      </div>
                    ) : null}

                    {snapshot.hardware.uartsFile.rawText ? (
                      <details className="port-board-debug">
                        <summary>Controller `uarts.txt`</summary>
                        <pre>{snapshot.hardware.uartsFile.rawText}</pre>
                      </details>
                    ) : null}
                  </article>
                ) : null}

		            {gpsPeripheralViewModels.length > 0 ? (
	              <div className="port-card-grid">
	                {gpsPeripheralViewModels.map((peripheral) => (
	                  <article key={peripheral.label} className="port-card">
	                    <div className="port-card__header">
	                      <div>
	                        <strong>{peripheral.label}</strong>
	                        <small>Configured driver: {formatArducopterGpsType(peripheral.value)}</small>
	                      </div>
	                      <StatusBadge
                          tone={
                            peripheral.value === 0
                              ? 'neutral'
                              : peripheral.label === 'Primary GPS' && snapshot.liveVerification.globalPosition.verified
                                ? 'success'
                                : 'warning'
                          }
                        >
	                        {peripheral.value === 0
                            ? 'disabled'
                            : peripheral.label === 'Primary GPS' && snapshot.liveVerification.globalPosition.verified
                              ? 'live position'
                              : 'configured'}
	                      </StatusBadge>
	                    </div>
	                    <p>
                        {peripheral.label === 'Primary GPS' && snapshot.liveVerification.globalPosition.verified
                          ? 'Live position is arriving. Keep the configured driver consistent with the actual hardware after reboot and reconnect.'
                          : 'Choose the expected GPS/peripheral driver, then verify the live device after reboot and reconnect.'}
                      </p>

	                    {peripheral.parameter ? (
	                      <ScopedSelectField
	                        parameter={peripheral.parameter}
	                        liveValue={peripheral.value}
	                        editedValues={editedValues}
	                        onChange={(paramId, value) => setDraft(paramId, value)}
	                        draftStatusById={parameterDraftById}
	                      />
	                    ) : null}
	                  </article>
	                ))}
	              </div>
	            ) : null}

              {canNodePeripheralViewModels.length > 0 ? (
                <section className="dronecan-peripherals" data-testid="ports-dronecan-section">
                  <header className="dronecan-peripherals__header">
                    <strong>DroneCAN bus</strong>
                    <small>
                      {canNodePeripheralViewModels.length} node{canNodePeripheralViewModels.length === 1 ? '' : 's'} discovered via the MAVLink-UAVCAN bridge. Phase 1 surfaces identity and liveness only; per-node parameters are a later step.
                    </small>
                  </header>
                  <div className="port-card-grid">
                    {canNodePeripheralViewModels.map((node) => (
                      <article key={node.componentId} className="port-card" data-testid={`dronecan-node-${node.componentId}`}>
                        <div className="port-card__header">
                          <div>
                            <strong>{node.label}</strong>
                            <small>Node ID {node.componentId}{typeof node.uptimeSec === 'number' ? ` · up ${node.uptimeSec}s` : ''}</small>
                          </div>
                          <StatusBadge tone={node.tone}>{node.statusLine}</StatusBadge>
                        </div>
                        {node.hwUniqueId ? (
                          <p className="dronecan-peripherals__uid"><span>Hardware UID</span><code>{node.hwUniqueId}</code></p>
                        ) : null}
                      </article>
                    ))}
                  </div>
                </section>
              ) : null}

              {gpsPeripheralViewModels.length > 0 || snapshot.liveVerification.globalPosition.verified ? (
                <LiveGpsMapCard
                  snapshot={snapshot}
                  title="GPS map"
                  subtitle="Verify the live aircraft location once the GPS driver and serial link are configured."
                  testId="ports-gps-map-widget"
                />
              ) : null}

              {gpsAutoConfigParameter || gpsAutoSwitchParameter || gpsPrimaryParameter || gpsRateParameter ? (
                <div className="scoped-review-card scoped-review-card--compact">
                  <div className="switch-exercise-card__header">
                    <div>
                      <strong>GPS behavior</strong>
                      <p>Keep GPS redundancy, auto-configuration, and update-rate settings local to this Ports workflow.</p>
                    </div>
                    <StatusBadge tone={toneForScopedDraftReview(portsStagedDrafts.length, portsInvalidDrafts.length)}>
                      {portsInvalidDrafts.length > 0
                        ? `${portsInvalidDrafts.length} invalid`
                        : portsStagedDrafts.length > 0
                          ? `${portsStagedDrafts.length} staged`
                          : 'in sync'}
                    </StatusBadge>
                  </div>

                  <div className="config-pills">
                    {gpsAutoConfigParameter ? <span>Auto config: {formatArducopterGpsAutoConfig(gpsAutoConfig)}</span> : null}
                    {gpsAutoSwitchParameter ? <span>Auto switch: {formatArducopterGpsAutoSwitch(gpsAutoSwitch)}</span> : null}
                    {gpsPrimaryParameter ? <span>Preferred GPS: {formatArducopterGpsPrimary(gpsPrimary)}</span> : null}
                    {gpsRateParameter ? <span>Update rate: {formatArducopterGpsRateMs(gpsRateMs)}</span> : null}
                  </div>

                  <div className="scoped-editor-grid">
                    {gpsAutoConfigParameter ? (
                      <ScopedSelectField
                        parameter={gpsAutoConfigParameter}
                        liveValue={gpsAutoConfig}
                        editedValues={editedValues}
                        onChange={(paramId, value) => setDraft(paramId, value)}
                        draftStatusById={parameterDraftById}
                      />
                    ) : null}

                    {gpsAutoSwitchParameter ? (
                      <ScopedSelectField
                        parameter={gpsAutoSwitchParameter}
                        liveValue={gpsAutoSwitch}
                        editedValues={editedValues}
                        onChange={(paramId, value) => setDraft(paramId, value)}
                        draftStatusById={parameterDraftById}
                      />
                    ) : null}

                    {gpsPrimaryParameter ? (
                      <ScopedSelectField
                        parameter={gpsPrimaryParameter}
                        liveValue={gpsPrimary}
                        editedValues={editedValues}
                        onChange={(paramId, value) => setDraft(paramId, value)}
                        draftStatusById={parameterDraftById}
                      />
                    ) : null}

                    {gpsRateParameter ? (
                      (gpsRateParameter.definition?.options ?? []).length > 0 ? (
                        <ScopedSelectField
                          parameter={gpsRateParameter}
                          liveValue={gpsRateMs}
                          editedValues={editedValues}
                          onChange={(paramId, value) => setDraft(paramId, value)}
                          draftStatusById={parameterDraftById}
                        />
                      ) : (
                        <ScopedField
                          parameter={gpsRateParameter}
                          liveValue={gpsRateMs}
                          editedValues={editedValues}
                          onChange={(paramId, value) => setDraft(paramId, value)}
                          draftStatusById={parameterDraftById}
                        />
                      )
                    ) : null}
                  </div>

                  <ul className="output-note-list">
                    <li>Keep GPS redundancy features simple unless the aircraft actually has two usable GPS links.</li>
                    <li>After GPS behavior changes, reboot, reconnect, and verify live lock/telemetry before flight.</li>
                  </ul>
                </div>
              ) : null}

              {osdTypeParameter || osdChannelParameter || osdSwitchMethodParameter || mspOptionsParameter || mspOsdCellCountParameter ? (
                <div className="scoped-review-card scoped-review-card--compact">
                  <div className="switch-exercise-card__header">
                    <div>
                      <strong>OSD routed through dedicated tab</strong>
                      <p>Keep the serial-port wiring context here, then use the OSD tab for backend, page, and MSP display settings.</p>
                    </div>
                    <button style={buttonStyle('primary')} onClick={() => setActiveViewId('osd')}>
                      Open OSD Tab
                    </button>
                  </div>

                  <div className="config-pills">
                    {osdTypeParameter ? <span>Backend: {formatArducopterOsdType(osdType)}</span> : null}
                    {osdChannelParameter ? <span>Screen channel: {formatArducopterOsdChannel(osdChannel)}</span> : null}
                    {osdSwitchMethodParameter ? <span>Switching: {formatArducopterOsdSwitchMethod(osdSwitchMethod)}</span> : null}
                    {mspOsdCellCountParameter ? <span>Cell count: {formatArducopterMspOsdCellCount(mspOsdCellCount)}</span> : null}
                    {mspOptionsParameter ? <span>MSP options: {describeBitmaskSelections(mspOptions, ARDUCOPTER_MSP_OPTION_BIT_LABELS, 'No special options')}</span> : null}
                    {osdLinkPorts.length > 0
                      ? osdLinkPorts.map((port) => <span key={`osd-link:${port.portNumber}`}>{port.label}: {port.protocolLabel}</span>)
                      : <span>No MSP / DisplayPort OSD link detected in current port roles</span>}
                  </div>
                </div>
              ) : null}

              {vtxEnableParameter || vtxFrequencyParameter || vtxPowerParameter || vtxMaxPowerParameter || vtxOptionsParameter ? (
                <div className="scoped-review-card scoped-review-card--compact">
                  <div className="switch-exercise-card__header">
                    <div>
                      <strong>VTX routed through dedicated tab</strong>
                      <p>Use Ports to assign the actual control link, then use the VTX tab for frequency, power, and control behavior.</p>
                    </div>
                    <button style={buttonStyle('primary')} onClick={() => setActiveViewId('vtx')}>
                      Open VTX Tab
                    </button>
                  </div>

                  <div className="config-pills">
                    {vtxEnableParameter ? <span>Control: {formatArducopterVtxEnable(vtxEnabled)}</span> : null}
                    {vtxFrequencyParameter ? <span>Frequency: {vtxFrequency !== undefined ? `${vtxFrequency} MHz` : 'Unknown'}</span> : null}
                    {vtxPowerParameter ? <span>Power: {vtxPower !== undefined ? `${vtxPower} mW` : 'Unknown'}</span> : null}
                    {vtxMaxPowerParameter ? <span>Max power: {vtxMaxPower !== undefined ? `${vtxMaxPower} mW` : 'Unknown'}</span> : null}
                    {vtxLinkPorts.length > 0
                      ? vtxLinkPorts.map((port) => <span key={`vtx-link:${port.portNumber}`}>{port.label}: {port.protocolLabel}</span>)
                      : <span>No VTX control link detected in current port roles</span>}
                  </div>
                </div>
              ) : null}

	              {renderAdditionalSettingsCard(
	                'Additional port settings',
	                'These metadata-backed port and peripheral settings are kept local to the Ports view so common setup work does not spill into raw Parameters.',
                portsAdditionalGroups,
                portsAdditionalDraftEntries,
                portsAdditionalStagedDrafts,
                portsAdditionalInvalidDrafts,
                'ports:additional',
	                'Apply Additional Port Changes',
	                'additional port settings'
	              )}
		              </div>
		            </div>

		            <div className="switch-exercise-controls ports-toolbar">
	              <button
	                style={buttonStyle('primary')}
	                onClick={() => void handleApplyScopedParameterDrafts(portsDraftEntries, 'ports:apply', 'Ports & peripherals')}
	                disabled={
	                  busyAction !== undefined ||
	                  portsStagedDrafts.length === 0 ||
	                  portsInvalidDrafts.length > 0 ||
	                  !canApplyDraftParameters
	                }
	              >
	                {busyAction === 'ports:apply' ? 'Applying…' : `Apply Port Changes (${portsStagedDrafts.length})`}
	              </button>
	              <button
	                style={buttonStyle()}
	                onClick={() => handleDiscardScopedParameterDrafts(portsDraftEntries.map((entry) => entry.id), 'ports')}
	                disabled={busyAction !== undefined || portsDraftEntries.length === 0}
	              >
	                Discard Port Changes
	              </button>
	            </div>

	            {parameterNotice ? (
	              <div className="parameter-review__notice parameter-review__notice--inline">
	                <StatusBadge tone={parameterNotice.tone}>{parameterNotice.tone}</StatusBadge>
	                <p>{parameterNotice.text}</p>
	              </div>
	            ) : null}

	            <p className="telemetry-note">
	              Use the header session strip to reboot and refresh after changing serial roles, GPS drivers, or flow-control settings.
	            </p>
	          </div>
	          </Panel>	          
	          <MavlinkSigningPanel runtime={runtime} connected={snapshot.connection.kind === 'connected'} />
	        </div>
	      </section>

  )
}
