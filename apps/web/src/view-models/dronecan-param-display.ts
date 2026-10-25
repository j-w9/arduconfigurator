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
  /** Bitmask bit labels (bit index -> meaning). Kept apart from `options`,
   *  which is a single-select enum and would mislabel a bitmask value. (Not
   *  named `bitmask`: the FC catalog's ParameterDefinition, which is passed
   *  through this type too, uses `bitmask: boolean`.) */
  bits?: ReadonlyArray<{ bit: number; label: string }>
  /** Suggested edit step (ArduPilot @Increment; same name as the FC catalog). */
  step?: number
  /** A change only takes effect after the node reboots. */
  rebootRequired?: boolean
  /** Documented read-only (statistics etc.). */
  readOnly?: boolean
  /** The FC catalog's flag that `options` holds BIT indexes, not values. */
  bitmask?: boolean
}

/** Metadata for a node's param by name. The node is passed too: which catalog
 *  answers (AP_Periph or PX4 cannode) depends on what the node runs. */
export type DronecanParamCatalogLookup = (
  name: string,
  node?: { name?: string; parameters: ReadonlyArray<{ name: string }> }
) => DronecanParamCatalogDef | undefined

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
  /** A bitmask's set bits by name ("Show free stack space, Enable sending stats"), or "none". */
  bitsLabel?: string
  step?: number
  rebootRequired?: boolean
  readOnly?: boolean
  /** A single-choice param's named values (never a bitmask's), for a dropdown editor. */
  options?: ReadonlyArray<{ value: number; label: string }>
}

/** A def's bit labels: its own, or the FC catalog's bitmask `options` (bit indexes). */
export function dronecanParamBits(def: DronecanParamCatalogDef | undefined): ReadonlyArray<{ bit: number; label: string }> | undefined {
  if (!def) return undefined
  if (def.bits && def.bits.length > 0) return def.bits
  if (def.bitmask === true && def.options) return def.options.map((option) => ({ bit: option.value, label: option.label }))
  return undefined
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
  // Range reads as "min–max unit" (en-dash, e.g. "50–200 ms", "-5–5 m").
  const nodeRange =
    isPresent(entry.minValue) || isPresent(entry.maxValue)
      ? `${formatParamValue(entry.minValue)}–${formatParamValue(entry.maxValue)}`
      : undefined
  const unit = def?.unit ? ` ${def.unit}` : ''
  const catalogRange =
    def && (def.minimum !== undefined || def.maximum !== undefined)
      ? `${def.minimum ?? '−∞'}–${def.maximum ?? '∞'}${unit}`
      : undefined

  const numeric = numericValue(entry.value)
  // A bitmask's value is a sum of bits, never one of its labels: reading it as
  // an enum named the wrong thing (value 3 = bits 0 and 1, not "option 3").
  const bits = dronecanParamBits(def)
  const option =
    !bits && def?.options && numeric !== undefined ? def.options.find((candidate) => candidate.value === numeric) : undefined
  const bitsLabel =
    bits && numeric !== undefined && Number.isInteger(numeric)
      ? bits
          .filter((entry) => entry.bit >= 0 && entry.bit < 53 && Math.floor(numeric / 2 ** entry.bit) % 2 === 1)
          .map((entry) => entry.label)
          .join(', ') || 'none'
      : undefined

  return {
    label: def?.label ?? entry.name,
    name: entry.name,
    valueLabel: option ? option.label : formatParamValue(entry.value),
    valueIsEnum: option !== undefined,
    rangeLabel: nodeRange ?? catalogRange,
    defaultLabel: isPresent(entry.defaultValue) ? formatParamValue(entry.defaultValue) : undefined,
    description: def?.description,
    fromCatalog: def !== undefined,
    bitsLabel,
    step: def?.step,
    rebootRequired: def?.rebootRequired,
    readOnly: def?.readOnly,
    options: !bits && def?.options && def.options.length > 0 ? def.options : undefined
  }
}
