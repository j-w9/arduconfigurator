// PortsSection — App.tsx's `activeViewId === 'ports'` block, lifted into
// its own component. Ports is unique in that its JSX is INLINE (no
// PortsView component); the section therefore owns ~730 lines of JSX
// directly. App.tsx threads the data via grouped props.

import type { ReactElement, ReactNode } from 'react'
import type { ArduPilotConfiguratorRuntime, ConfiguratorSnapshot, ParameterDraftEntry, ParameterState } from '@arduconfig/ardupilot-core'
import type { AppViewId, BoardCatalogEntry, BoardReferenceLink } from '@arduconfig/param-metadata'
import {
  ARDUCOPTER_SERIAL_OPTION_BIT_LABELS,
  arducopterSerialBaudRate,
  arducopterSerialProtocolOptions,
  encodeArducopterSerialBaud,
  formatArducopterGpsType,
  formatArducopterSerialProtocol,
  formatArducopterSerialRtscts
} from '@arduconfig/param-metadata'
import { Panel, StatusBadge, buttonStyle } from '@arduconfig/ui-kit'
import { derivePortLiveness } from '../view-models/port-liveness'

import { SERIAL_BAUD_PRESET_RATES, formatBaudRate, isPresetBaudRate, parseSerialBaudInput, selectedBaudPresetValue } from '../baud-helpers'
import type { ParameterNotice } from '../hooks/use-parameter-feedback'
import type { UsePortsViewResult } from '../hooks/use-ports-view'
import { statusToneLabel } from '../status-tone'
import { MavlinkSigningPanel } from '../mavlink-signing-panel'
import { normalizeBitmaskValue } from '../parameter-format'
import { describeBitmaskSelections, hasBitmaskFlag, toggleBitmaskFlag } from '../selectors/bitmask'
import type { SerialPortViewModel } from '../serial-port-helpers'
import { toneForScopedDraftReview } from '../tone-helpers'
import type { AdditionalSettingsGroup, CanNodePeripheralViewModel, GpsPeripheralViewModel } from '../view-models/peripherals'
import { pairedDraftsForSerialProtocol, pairingNoteForSerialProtocol } from '../view-models/port-protocol-pairings'
import { ScopedSelectField } from '../views/ScopedField'

export interface PortsSectionProps {
  snapshot: ConfiguratorSnapshot
  busyAction: string | undefined
  canApplyDraftParameters: boolean
  parameterNotice: ParameterNotice | undefined
  /** A pending reboot-required follow-up (serial-role changes need a reboot). */
  rebootRequired: boolean
  onReboot: () => void
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
    rebootRequired,
    onReboot,
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
    editedValues,
    parameterDraftById,
    setDraft,
    updateDrafts,
    portsView,
    onApplyScopedDrafts,
    onDiscardScopedDrafts,
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

  // Set a port's protocol AND stage any paired peripheral-enable drafts, so
  // picking DisplayPort also turns on the OSD backend and picking a VTX-control
  // protocol enables the VTX — staged (visible, revertible), applied with the
  // port change. See view-models/port-protocol-pairings.
  const handleSelectSerialProtocol = (protocolParamId: string, rawValue: string) => {
    setDraft(protocolParamId, rawValue)
    const protocolValue = Number(rawValue)
    if (Number.isNaN(protocolValue)) {
      return
    }
    for (const paired of pairedDraftsForSerialProtocol(protocolValue, snapshot)) {
      setDraft(paired.paramId, String(paired.value))
    }
  }

  return (

	      <section className="grid one-up">
	        <div id="setup-panel-ports">
	          <Panel
	            title="Ports"
	            subtitle="Assign serial roles, baud rates, and hardware flow-control settings without dropping into the raw parameter table."
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

                      {/* No metric strip above the matrix. Detected-ports and
                       *  staged-changes restated what the list and the draft
                       *  bar already show, and the two GPS cards belonged with
                       *  the GPS surface rather than above a table of UARTs.
                       *  The label now leads straight into the list. */}

                      {serialPortViewModels.length > 0 ? (
                        <>
                          <div className="ports-surface__disclosure">
                            <small>{portVisibilitySummary}</small>
                          </div>

                          {/* Without @SYS/uarts.txt there are no activity dots
                              at all, which is indistinguishable from "every
                              port is idle". Bench report: a working drive
                              plugged in and showed no lights, with nothing
                              saying why. Absence of the file is now stated. */}
                          {snapshot.hardware.uartsFile.status !== 'ready' ? (
                            <p className="bf-note" data-testid="ports-activity-unavailable">
                              {snapshot.hardware.uartsFile.status === 'unsupported'
                                ? 'This firmware does not serve @SYS/uarts.txt, so per-port receive activity cannot be shown.'
                                : snapshot.hardware.uartsFile.status === 'loading'
                                  ? 'Reading @SYS/uarts.txt for per-port receive activity…'
                                  : 'Per-port receive activity is unavailable — @SYS/uarts.txt has not been read.'}
                            </p>
                          ) : null}
                          <div className="ports-matrix">
                            <div className="ports-matrix__head">
                              <span>Port</span>
                              <span>Function</span>
                              <span>Baud</span>
                              <span>Flow</span>
                              <span>Options</span>
                            </div>

                            {[...visibleSerialPortViewModels]
                              // Order by the physical peripheral NUMBER — USART1, 2, 3
                              // then UART4, 5, 6… — which is what the operator reads off
                              // the board, not the SERIAL number (SERIALn maps to those
                              // peripherals in a board-specific order). USB / console
                              // (SERIAL0) stays first; ports with no board map fall back
                              // to SERIAL order.
                              .sort((left, right) => {
                                const rank = (port: typeof left): number => {
                                  if (port.portNumber === 0) {
                                    return -1
                                  }
                                  // OTGn sorts last. It is a USB interface
                                  // rather than a solderable UART, so it was
                                  // landing in the middle of the physical ports
                                  // purely because its digit is small.
                                  if (port.hardwarePort?.startsWith('OTG')) {
                                    return 9000 + port.portNumber
                                  }
                                  const match = /(\d+)/.exec(port.hardwarePort ?? '')
                                  return match ? Number(match[1]) : 1000 + port.portNumber
                                }
                                return rank(left) - rank(right)
                              })
                              .map((port) => {
                              // Lead with the board's physical peripheral name
                              // (USART1, UART4, …) from the board map — that's what
                              // the operator reads off the silkscreen / wiring. The
                              // SERIAL number (which the params use) is shown as a
                              // secondary pill + in the SERIALn_PROTOCOL sub-line.
                              // Rows are still ordered by SERIAL number. Falls back
                              // to "SERIAL n" when the board map is unknown; SERIAL0
                              // is the USB console.
                              // OTGn is a USB peripheral, not a UART. Reported
                              // bench-side as confusing next to UART1/UART2:
                              // "OTG2" names the STM32 peripheral, but what the
                              // operator has in front of them is the second
                              // interface on the same USB cable.
                              const liveness = derivePortLiveness(
                                snapshot,
                                port.protocolValue,
                                port.boardTrafficActive,
                                port.optionsValue
                              )
                              const portHeading =
                                port.portNumber === 0
                                  ? 'USB / Console'
                                  : port.hardwarePort?.startsWith('OTG')
                                    ? `USB1_${port.hardwarePort.slice(3)} (${port.hardwarePort})`
                                    : port.hardwarePort ?? `SERIAL ${port.portNumber}`
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
                                          {/* Live traffic from @SYS/uarts.txt, which the app already
                                              parsed and then never showed. A dot rather than the old
                                              text pill that was pulled as redundant chrome: "is this
                                              port actually doing anything" is the question, and the
                                              byte counts belong on hover.

                                              Three states, not two — undefined means uarts.txt has
                                              not been read, which is not the same as idle, so the dot
                                              is absent rather than grey-and-wrong. */}
                                          <strong>
                                            {/* Inside the heading, not beside it: the title is a
                                                grid whose strong is display:block, so a sibling
                                                would stack above the name instead of sitting with
                                                it. */}
                                            {/* The PORT'S PROTOCOL picks the evidence. A byte
                                                counter only says the wire is busy; the GPS driver's
                                                satellite count says the peripheral works. Three
                                                states, because "output-only" and "silent" are
                                                different facts — a SmartAudio VTX is mostly talked
                                                at, so calling a working one silent cries wolf. */}
                                            {liveness.state !== 'unknown' ? (
                                              <span
                                                className={`ports-traffic-dot ports-traffic-dot--${liveness.state}`}
                                                data-testid={`ports-traffic-${port.portNumber}`}
                                                data-state={liveness.state}
                                                title={
                                                  liveness.detail
                                                    ? `${liveness.detail}${port.boardTrafficSummary ? ` · ${port.boardTrafficSummary}` : ''}`
                                                    : port.boardTrafficSummary
                                                }
                                                aria-label={
                                                  liveness.state === 'working'
                                                    ? `SERIAL${port.portNumber} is working: ${liveness.detail ?? 'receiving data'}`
                                                    : liveness.state === 'output-only'
                                                      ? `SERIAL${port.portNumber} is output only`
                                                      : `SERIAL${port.portNumber} has nothing arriving`
                                                }
                                              />
                                            ) : null}
                                            {portHeading}
                                          </strong>
                                          <small>
                                            {`SERIAL${port.portNumber}_PROTOCOL `}
                                            {port.protocolValue ?? '—'}
                                          </small>
                                        </div>
                                      </div>
                                      {/* Physical UART/USART leads (heading), with the SERIALn_PROTOCOL id in
                                          the sub-line above. Only the board connector label remains as a pill
                                          (and only when it doesn't just repeat the heading). The SERIAL-number
                                          pill was dropped as redundant with the SERIALn_PROTOCOL sub-line, and
                                          the role/usage, live-traffic, and status pills as redundant chrome. */}
                                      {port.label && port.label !== portHeading ? (
                                        <div className="config-pills">
                                          <span>{port.label}</span>
                                        </div>
                                      ) : null}
                                    </div>

                                    <div className="ports-matrix-row__cell">
                                      {protocolParameter ? (
                                        <label className="scoped-editor-field scoped-editor-field--compact">
                                          <span>Function</span>
                                          <select
                                            value={editedValues[protocolParameter.id] ?? String(port.protocolValue ?? '')}
                                            onChange={(event) =>
                                              handleSelectSerialProtocol(protocolParameter.id, event.target.value)
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
                                          {(() => {
                                            const note = pairingNoteForSerialProtocol(
                                              Number(editedValues[protocolParameter.id] ?? port.protocolValue)
                                            )
                                            return note ? (
                                              <small className="ports-matrix-row__pairing-note" data-testid={`port-pairing-note-${port.portNumber}`}>
                                                {note}
                                              </small>
                                            ) : null
                                          })()}
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
                                            {/* The port matrix hand-rolls its fields instead of using the
                                                Scoped* components, so it doesn't inherit their param-name
                                                hint — add it here so Baud/Flow/Options aren't the only
                                                editable knobs in the app with no visible raw param name.
                                                aria-hidden for the same reason ScopedField does it: a
                                                <label> folds all its text into the control's a11y name. */}
                                            <small className="scoped-editor-field__param-id" aria-hidden="true">
                                              {baudParameter.id}
                                            </small>
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
                                          <small className="scoped-editor-field__param-id" aria-hidden="true">
                                            {flowControlParameter.id}
                                          </small>
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
                                          <strong>
                                            Serial options
                                            {optionsParameter ? (
                                              <small className="scoped-editor-field__param-id">{optionsParameter.id}</small>
                                            ) : null}
                                          </strong>
                                          {optionsParameter ? (
                                            <button
                                              style={buttonStyle()}
                                              onClick={() =>
                                                setExpandedSerialOptionsPortNumber((current) => (current === port.portNumber ? undefined : port.portNumber))
                                              }
                                              disabled={!port.editable}
                                            >
                                              {expandedSerialOptionsPortNumber === port.portNumber ? 'Hide' : 'Bitmask'}
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
                                      <div className="scoped-bitmask-bits port-row__options-panel">
                                        {Object.entries(ARDUCOPTER_SERIAL_OPTION_BIT_LABELS).map(([bit, label]) => {
                                          const numericBit = Number(bit)
                                          const checked = hasBitmaskFlag(editedOptionsValue, numericBit)
                                          return (
                                            <button
                                              type="button"
                                              key={`${optionsParameter.id}:${bit}`}
                                              className={`scoped-bitmask-bit${checked ? ' is-set' : ''}`}
                                              aria-pressed={checked}
                                              onClick={() =>
                                                updateDrafts((existing) => {
                                                  const currentValue = normalizeBitmaskValue(existing[optionsParameter.id], port.optionsValue)
                                                  const nextValue = toggleBitmaskFlag(currentValue, numericBit, !checked)

                                                  return {
                                                    ...existing,
                                                    [optionsParameter.id]: String(nextValue)
                                                  }
                                                })
                                              }
                                              disabled={!port.editable}
                                            >
                                              {label}
                                            </button>
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
                              : peripheral.id === 'primary' && snapshot.liveVerification.globalPosition.verified
                                ? 'success'
                                : peripheral.id === 'primary' && !snapshot.liveVerification.gpsReceiver.detected
                                  ? 'danger'
                                  : 'warning'
                          }
                        >
	                        {peripheral.value === 0
                            ? 'disabled'
                            : peripheral.id === 'primary' && snapshot.liveVerification.globalPosition.verified
                              ? 'live position'
                              // "configured" used to cover BOTH a working GPS
                              // waiting on a fix and a GPS that was never wired
                              // up — a driver selected in a parameter reads as
                              // an accomplished setup. GPS_RAW_INT separates
                              // them: no frames at all means nothing is talking.
                              : peripheral.id !== 'primary'
                                ? 'configured'
                                : !snapshot.liveVerification.gpsReceiver.detected
                                  ? 'not detected'
                                  : `no fix · ${snapshot.liveVerification.gpsReceiver.satellitesVisible ?? 0} sats`}
	                      </StatusBadge>
	                    </div>
	                    <p>
                        {peripheral.id === 'primary' && snapshot.liveVerification.globalPosition.verified
                          ? 'Live position is arriving. Keep the configured driver consistent with the actual hardware after reboot and reconnect.'
                          : peripheral.id === 'primary' && !snapshot.liveVerification.gpsReceiver.detected
                            ? 'A driver is selected but no GPS is reporting at all — not even an unfixed one. That points at wiring rather than sky view: check the module is on a UART with TX/RX the right way round (a GPS on I2C pins never reports), that the port protocol is GPS, and that the module has power.'
                            : peripheral.id === 'primary'
                              ? 'The GPS module is reporting but has no position fix yet. This is normal indoors — give it sky view.'
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

              {/* The "GPS behavior" card lived here and edited GPS_AUTO_CONFIG,
               *  GPS_AUTO_SWITCH, GPS_PRIMARY and GPS_RATE_MS -- every one of
               *  which Peripherals > GPS already owns, under the same heading,
               *  alongside GPS_TYPE and the GNSS mode. Two editors for one set
               *  of parameters is how they drift apart in an operator's head.
               *  Ports configures the UART; what the GPS then does with it is a
               *  peripheral concern. */}


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

	            {rebootRequired && snapshot.connection.kind === 'connected' ? (
	              <div className="ports-reboot-prompt" data-testid="ports-reboot-prompt">
	                <span>Serial-port changes only take effect after a reboot.</span>
	                <button
	                  style={buttonStyle('primary')}
	                  onClick={onReboot}
	                  disabled={busyAction !== undefined}
	                  data-testid="ports-reboot"
	                >
	                  Reboot now
	                </button>
	              </div>
	            ) : null}

	            {parameterNotice ? (
	              <div className="parameter-review__notice parameter-review__notice--inline">
	                <StatusBadge tone={parameterNotice.tone}>{statusToneLabel(parameterNotice.tone)}</StatusBadge>
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
