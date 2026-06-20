// Serial-port / peripheral helpers, extracted from App.tsx as part of its
// decomposition. Pure functions that classify serial protocols, parse SERIALn /
// SERVOn ids, summarize board UART traffic, and build the per-port view models
// the Ports tab renders. No React, no app state.

import type { ConfiguratorSnapshot, ParameterState } from '@arduconfig/ardupilot-core'
import {
  ARDUCOPTER_SERIAL_OPTION_BIT_LABELS,
  arducopterSerialBaudRate,
  formatArducopterSerialBaud,
  formatArducopterSerialProtocol,
  formatArducopterSerialRtscts,
  type BoardCatalogEntry
} from '@arduconfig/param-metadata'

import { describeBitmaskSelections } from './selectors/bitmask'

export interface SerialPortViewModel {
  portNumber: number
  label: string
  hardwarePort?: string
  boardConnectorLabel?: string
  boardTrafficSummary?: string
  protocolParameter?: ParameterState
  baudParameter?: ParameterState
  optionsParameter?: ParameterState
  flowControlParameter?: ParameterState
  protocolValue?: number
  baudValue?: number
  actualBaudRate?: number
  optionsValue?: number
  flowControlValue?: number
  protocolLabel: string
  baudLabel: string
  optionsLabel: string
  flowControlLabel?: string
  usageSummary: string
  notes: string[]
  editable: boolean
}

export function serialPortDisplayName(portNumber: number): string {
  switch (portNumber) {
    case 0:
      return 'USB / Console'
    case 1:
      return 'Telemetry 1'
    case 2:
      return 'Telemetry 2'
    case 3:
      return 'GPS / UART3'
    default:
      return `Serial ${portNumber}`
  }
}

// Protocol numbers verbatim from AP_SerialManager.cpp SERIALn_PROTOCOL
// @Values. Conformance-audit fix: these classifiers previously inherited
// a scrambled protocol table (18 treated as RC-receiver — upstream 18 is
// OpticalFlow; 30 treated as DJI FPV — upstream 30 is Generator; 36
// described as ADS-B — upstream 36 is AHRS, ADSB is 35; 41 described as
// Rangefinder — upstream 41 is CoDevESC, Rangefinder is 9).
export function describeSerialPortUsage(protocolValue: number | undefined): string {
  switch (protocolValue) {
    case -1:
      return 'Disabled in the current configuration.'
    case 1:
    case 2:
      return 'Telemetry / companion link.'
    case 5:
      return 'GPS or GNSS receiver.'
    case 9:
      return 'Rangefinder or similar distance peripheral.'
    case 16:
      return 'ESC telemetry input.'
    case 23:
      return 'Serial receiver / RC input path.'
    case 29: // Crossfire VTX
    case 33: // DJI FPV
    case 37: // SmartAudio
    case 44: // IRC Tramp
      return 'VTX control or digital FPV link.'
    case 32:
      return 'MSP display or peripheral link.'
    case 42:
      return 'DisplayPort OSD / HD display link.'
    case 35:
      return 'ADS-B receiver input.'
    default:
      return 'Peripheral or accessory link.'
  }
}

/** Serial RC input is ONLY protocol 23 (RCIN) on ArduPilot — 15 is SBus
 *  servo OUTPUT and 18 is OpticalFlow. */
export function isReceiverSerialProtocol(protocolValue: number | undefined): boolean {
  return protocolValue === 23
}

/** 29 Crossfire VTX, 33 DJI FPV, 37 SmartAudio, 44 IRC Tramp. */
export function isVtxControlSerialProtocol(protocolValue: number | undefined): boolean {
  return protocolValue === 29 || protocolValue === 33 || protocolValue === 37 || protocolValue === 44
}

/** 32 MSP, 33 DJI FPV, 42 DisplayPort — the OSD-bearing links. */
export function isOsdSerialProtocol(protocolValue: number | undefined): boolean {
  return protocolValue === 32 || protocolValue === 33 || protocolValue === 42
}

export function isNotificationLedServoFunction(functionValue: number | undefined): boolean {
  return functionValue !== undefined && functionValue >= 120 && functionValue <= 123
}

export function parseServoOutputChannelNumber(paramId: string): number | undefined {
  const match = paramId.match(/^SERVO(\d+)_FUNCTION$/)
  return match ? Number(match[1]) : undefined
}

export function parseSerialPortNumber(paramId: string): number | undefined {
  const match = paramId.match(/^SERIAL(\d+)_(PROTOCOL|BAUD|OPTIONS)$/)
  return match ? Number(match[1]) : undefined
}

export function describeBoardTrafficSummary(mapping: ConfiguratorSnapshot['hardware']['uartsFile']['mappings'][number] | undefined): string | undefined {
  if (!mapping) {
    return undefined
  }

  const notes: string[] = []
  if (mapping.txActive) {
    notes.push(`TX ${mapping.txBytes ?? 0}`)
  }
  if (mapping.rxActive) {
    notes.push(`RX ${mapping.rxBytes ?? 0}`)
  }
  if ((mapping.txBufferDrops ?? 0) > 0 || (mapping.rxBufferDrops ?? 0) > 0) {
    notes.push(`Drops ${(mapping.txBufferDrops ?? 0) + (mapping.rxBufferDrops ?? 0)}`)
  }

  return notes.length > 0 ? notes.join(' · ') : 'Idle in current `uarts.txt` snapshot.'
}

export function buildSerialPortViewModels(snapshot: ConfiguratorSnapshot, boardCatalogEntry?: BoardCatalogEntry): SerialPortViewModel[] {
  const parameterById = new Map(snapshot.parameters.map((parameter) => [parameter.id, parameter]))
  const hardwarePortBySerialPort = new Map(snapshot.hardware.uartsFile.mappings.map((mapping) => [mapping.serialPortNumber, mapping]))
  const portNumbers = [
    ...new Set(
      snapshot.parameters
        .map((parameter) => {
          const match = parameter.id.match(/^SERIAL(\d+)_(PROTOCOL|BAUD|OPTIONS)$/)
          return match ? Number(match[1]) : undefined
        })
        .filter((portNumber): portNumber is number => portNumber !== undefined)
    )
  ].sort((left, right) => left - right)

  return portNumbers.map((portNumber) => {
    const protocolParameter = parameterById.get(`SERIAL${portNumber}_PROTOCOL`)
    const baudParameter = parameterById.get(`SERIAL${portNumber}_BAUD`)
    const optionsParameter = parameterById.get(`SERIAL${portNumber}_OPTIONS`)
    const flowControlParameter = portNumber > 0 ? parameterById.get(`BRD_SER${portNumber}_RTSCTS`) : undefined
    const protocolValue = protocolParameter?.value
    const baudValue = baudParameter?.value
    const optionsValue = optionsParameter?.value
    const flowControlValue = flowControlParameter?.value
    const hardwareMapping = hardwarePortBySerialPort.get(portNumber)
    const boardConnectorLabel = hardwareMapping
      ? boardCatalogEntry?.hardwarePortLabels[hardwareMapping.hardwarePort] ?? hardwareMapping.hardwarePort
      : undefined

    const notes = portNumber === 0
      ? ['USB / console is shown for awareness. Leave it on MAVLink unless there is a specific board-level reason to change it.']
      : []

    return {
      portNumber,
      label: boardConnectorLabel ?? serialPortDisplayName(portNumber),
      hardwarePort: hardwareMapping?.hardwarePort,
      boardConnectorLabel,
      boardTrafficSummary: describeBoardTrafficSummary(hardwareMapping),
      protocolParameter,
      baudParameter,
      optionsParameter,
      flowControlParameter,
      protocolValue,
      baudValue,
      actualBaudRate: arducopterSerialBaudRate(baudValue),
      optionsValue,
      flowControlValue,
      protocolLabel: formatArducopterSerialProtocol(protocolValue),
      baudLabel: formatArducopterSerialBaud(baudValue),
      optionsLabel: describeBitmaskSelections(optionsValue, ARDUCOPTER_SERIAL_OPTION_BIT_LABELS, 'No special options'),
      flowControlLabel: flowControlParameter ? formatArducopterSerialRtscts(flowControlValue) : undefined,
      usageSummary: describeSerialPortUsage(protocolValue),
      notes,
      editable: portNumber !== 0 && protocolParameter !== undefined && baudParameter !== undefined
    }
  })
}
