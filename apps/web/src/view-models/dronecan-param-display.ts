import type { DronecanParamEntry, DronecanParamValueState } from '@arduconfig/ardupilot-core'

import { formatParamValue } from './can-bus'

/**
 * The subset of a curated parameter definition we use to enrich a node's
 * DroneCAN params. AP_Periph builds usually strip param metadata, so the node
 * reports its value but empty min/max/default and no labels/enums — leaving the
 * grids showing "—" for range and a raw integer for enums. We match the param
 * by NAME against the curated FC catalog and fill in label / range / enum /
 * description. Best-effort: a peripheral's enum or range *may* differ from the
 * flight-controller param of the same name, and node-reported values always
 * win when present.
 */
export interface DronecanParamCatalogDef {
  label?: string
  description?: string
  minimum?: number
  maximum?: number
  unit?: string
  options?: ReadonlyArray<{ value: number; label: string }>
}

export type DronecanParamCatalogLookup = (name: string) => DronecanParamCatalogDef | undefined

export interface DronecanParamDisplay {
  /** Friendly label (catalog) or the raw param name. */
  label: string
  /** The raw on-node param name. */
  name: string
  /** Enum label for the current value when the catalog knows it, else the
   *  formatted raw value. */
  valueLabel: string
  /** True when valueLabel is an enum label distinct from the raw value. */
  valueIsEnum: boolean
  /** Range hint: node-reported when present, else catalog minimum..maximum. */
  rangeLabel?: string
  /** Default hint: node-reported when present. */
  defaultLabel?: string
  /** Description (catalog), for a tooltip. */
  description?: string
  /** True when the catalog supplied any enrichment. */
  fromCatalog: boolean
}

function numericValue(state: DronecanParamValueState | undefined): number | undefined {
  if (!state) return undefined
  if (state.tag === 'int64') {
    const n = Number(state.int64)
    return Number.isFinite(n) ? n : undefined
  }
  if (state.tag === 'real32') {
    return typeof state.real32 === 'number' ? state.real32 : undefined
  }
  return undefined
}

function isPresent(state: DronecanParamValueState | undefined): boolean {
  return state !== undefined && state.tag !== 'empty'
}

export function describeDronecanParam(
  entry: DronecanParamEntry,
  def: DronecanParamCatalogDef | undefined
): DronecanParamDisplay {
  const nodeRange =
    isPresent(entry.minValue) || isPresent(entry.maxValue)
      ? `${formatParamValue(entry.minValue)} … ${formatParamValue(entry.maxValue)}`
      : undefined
  const unit = def?.unit ? ` ${def.unit}` : ''
  const catalogRange =
    def && (def.minimum !== undefined || def.maximum !== undefined)
      ? `${def.minimum ?? '−∞'} … ${def.maximum ?? '∞'}${unit}`
      : undefined

  const numeric = numericValue(entry.value)
  const option =
    def?.options && numeric !== undefined ? def.options.find((candidate) => candidate.value === numeric) : undefined

  return {
    label: def?.label ?? entry.name,
    name: entry.name,
    valueLabel: option ? option.label : formatParamValue(entry.value),
    valueIsEnum: option !== undefined,
    rangeLabel: nodeRange ?? catalogRange,
    defaultLabel: isPresent(entry.defaultValue) ? formatParamValue(entry.defaultValue) : undefined,
    description: def?.description,
    fromCatalog: def !== undefined
  }
}
