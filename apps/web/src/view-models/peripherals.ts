import type { CanNodeState, ConfiguratorSnapshot, ParameterState } from '@arduconfig/ardupilot-core'
import type { AppViewId, NormalizedFirmwareMetadataBundle } from '@arduconfig/param-metadata'

import { readRoundedParameter, selectParameterById } from '../selectors/parameter-read'

// View-model helpers for peripheral-shaped surfaces in the configurator.
// Extracted from App.tsx so the Setup, Ports, and (eventually) DroneCAN
// peripheral views can derive their shapes without depending on App.tsx
// internals.
//
// Behavior-preserving move — the helpers below are byte-equivalent to the
// originals other than now consuming the memoized parameter-id selector
// instead of building local maps on every call.

export interface GpsPeripheralViewModel {
  label: string
  parameter?: ParameterState
  value?: number
}

export interface AdditionalSettingsGroup {
  categoryId: string
  categoryLabel: string
  categoryDescription: string
  parameters: ParameterState[]
}

export function buildGpsPeripheralViewModels(snapshot: ConfiguratorSnapshot): GpsPeripheralViewModel[] {
  return [
    {
      label: 'Primary GPS',
      parameter: selectParameterById(snapshot, 'GPS_TYPE'),
      value: readRoundedParameter(snapshot, 'GPS_TYPE')
    },
    {
      label: 'Secondary GPS',
      parameter: selectParameterById(snapshot, 'GPS_TYPE2'),
      value: readRoundedParameter(snapshot, 'GPS_TYPE2')
    }
  ].filter((peripheral) => peripheral.parameter !== undefined)
}

export interface CanNodePeripheralViewModel {
  componentId: number
  /** Human-readable node name, falling back to "Node <componentId>" when the
   * bridge has not delivered UAVCAN_NODE_INFO yet. */
  label: string
  /** Vendor name string from UAVCAN_NODE_INFO when known, else undefined. */
  nodeName?: string
  health: CanNodeState['health']
  mode: CanNodeState['mode']
  /** A short status sentence suitable for inline display. */
  statusLine: string
  /** Maps the UAVCAN health onto the configurator's StatusTone vocabulary so
   * the peripheral card can colour-match the rest of the sensor strip. */
  tone: 'success' | 'warning' | 'danger' | 'neutral'
  uptimeSec?: number
  hwUniqueId?: string
  source: CanNodeState['lastSeenSource']
  lastSeenAtMs: number
}

function toneForCanNode(node: CanNodeState): CanNodePeripheralViewModel['tone'] {
  switch (node.health) {
    case 'ok':
      return 'success'
    case 'warning':
      return 'warning'
    case 'error':
    case 'critical':
      return 'danger'
    case 'unknown':
    default:
      return 'neutral'
  }
}

function modeLabel(mode: CanNodeState['mode']): string {
  switch (mode) {
    case 'operational':
      return 'Operational'
    case 'initialization':
      return 'Initializing'
    case 'maintenance':
      return 'Maintenance'
    case 'software_update':
      return 'Updating firmware'
    case 'offline':
      return 'Offline'
    case 'unknown':
    default:
      return 'Unknown mode'
  }
}

function healthLabel(health: CanNodeState['health']): string {
  switch (health) {
    case 'ok':
      return 'OK'
    case 'warning':
      return 'Warning'
    case 'error':
      return 'Error'
    case 'critical':
      return 'Critical'
    case 'unknown':
    default:
      return 'Unknown'
  }
}

/**
 * Shape the DroneCAN nodes discovered via the MAVLink-UAVCAN bridge for the
 * peripherals UI. Phase 1: identity + liveness, no parameter editing.
 */
export function buildCanNodePeripheralViewModels(snapshot: ConfiguratorSnapshot): CanNodePeripheralViewModel[] {
  return snapshot.canNodes.map((node) => ({
    componentId: node.componentId,
    label: node.name && node.name.length > 0 ? node.name : `Node ${node.componentId}`,
    nodeName: node.name,
    health: node.health,
    mode: node.mode,
    statusLine: `${healthLabel(node.health)} · ${modeLabel(node.mode)}`,
    tone: toneForCanNode(node),
    uptimeSec: node.uptimeSec,
    hwUniqueId: node.hwUniqueId,
    source: node.lastSeenSource,
    lastSeenAtMs: node.lastSeenAtMs
  }))
}

export function buildAdditionalSettingsGroups(
  snapshot: ConfiguratorSnapshot,
  metadataCatalog: NormalizedFirmwareMetadataBundle,
  viewId: AppViewId,
  excludedParameterIds: Set<string>
): AdditionalSettingsGroup[] {
  return metadataCatalog.categories
    .filter((category) => category.viewId === viewId)
    .map((category) => {
      const parameters = (metadataCatalog.parametersByCategory[category.id] ?? [])
        .map((definition) => selectParameterById(snapshot, definition.id))
        .filter((parameter): parameter is ParameterState => parameter !== undefined && !excludedParameterIds.has(parameter.id))

      return {
        categoryId: category.id,
        categoryLabel: category.label,
        categoryDescription: category.description,
        parameters
      }
    })
    .filter((group) => group.parameters.length > 0)
}
