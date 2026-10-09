// A decoded DroneCAN value as a tree the details pane can render: one node per
// field, with enum-like constants named (health 0 -> "OK" via the type's
// HEALTH_OK constant), printable byte arrays shown as text, short numeric
// arrays inline, and unions showing their active field. Pure: the catalogue
// supplies the type layout, nothing here touches React or the runtime.

import {
  dronecanCatalogue,
  type DronecanTransfer
} from '@arduconfig/dronecan-dsdl'
import type {
  DronecanCatalogue,
  DronecanConstDesc,
  DronecanSectionDesc,
  DronecanSectionKind,
  DronecanTypeDesc,
  DronecanValue
} from '@arduconfig/dronecan-dsdl'

export interface DronecanFieldNode {
  /** Field name, or "[3]" for an array element. */
  label: string
  /** The value as text, for leaves and inline arrays. */
  text?: string
  /** A constant's name for this value (enum-like fields), e.g. "OK". */
  meaning?: string
  /** Type, for the tooltip: "uint2", "float16", "uavcan.protocol.HardwareVersion". */
  typeLabel: string
  /** Keys from the message root to this field: ["value", "integer_value"], ["voltages", 2]. */
  path: (string | number)[]
  /** A number (or bool) that can be plotted over time. */
  plottable: boolean
  children?: DronecanFieldNode[]
}

const INLINE_ARRAY_LIMIT = 16

function typeLabel(desc: DronecanTypeDesc): string {
  if ('p' in desc) return desc.p === 'b' ? 'bool' : `${desc.p === 'u' ? 'uint' : desc.p === 'i' ? 'int' : 'float'}${desc.bits}`
  if ('v' in desc) return `void${desc.v}`
  if ('r' in desc) return desc.r
  return `${typeLabel(desc.a)}[${desc.m === 's' ? '' : '<='}${desc.max}]`
}

export function formatDronecanNumber(value: number | bigint | boolean, desc?: DronecanTypeDesc): string {
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'bigint') return value.toString()
  if (desc && 'p' in desc && desc.p === 'f') {
    if (!Number.isFinite(value)) return String(value)
    return Number.parseFloat(value.toPrecision(desc.bits === 16 ? 4 : desc.bits === 32 ? 7 : 12)).toString()
  }
  return String(value)
}

/** The constant whose name matches this field and value: field `health`, value 0 -> HEALTH_OK -> "OK". */
function constantMeaning(consts: readonly DronecanConstDesc[], field: string, value: DronecanValue): string | undefined {
  if (typeof value !== 'number' && typeof value !== 'boolean') return undefined
  const prefix = `${field.toUpperCase()}_`
  const match = consts.find((constant) => constant.n.startsWith(prefix) && constant.v === value)
  return match ? match.n.slice(prefix.length) : undefined
}

function isPrintable(bytes: readonly number[]): boolean {
  return bytes.every((byte) => (byte >= 0x20 && byte < 0x7f) || byte === 0x0a || byte === 0x0d || byte === 0x09)
}

function hexBytes(bytes: readonly number[]): string {
  return bytes.map((byte) => byte.toString(16).toUpperCase().padStart(2, '0')).join(' ')
}

function node(
  label: string,
  desc: DronecanTypeDesc,
  value: DronecanValue | undefined,
  catalogue: DronecanCatalogue,
  consts: readonly DronecanConstDesc[],
  path: (string | number)[]
): DronecanFieldNode {
  const base = { label, typeLabel: typeLabel(desc), path, plottable: 'p' in desc }
  if ('p' in desc) {
    const leaf = value === undefined ? '—' : formatDronecanNumber(value as number | bigint | boolean, desc)
    const meaning = value === undefined ? undefined : constantMeaning(consts, label, value)
    return { ...base, text: leaf, meaning }
  }
  if ('r' in desc) {
    const section = catalogue.section(desc.r, 'msg')
    return { ...base, children: sectionNodes(section, value, catalogue, path) }
  }
  if ('v' in desc) return { ...base, text: '' }
  const items = Array.isArray(value) ? value : []
  const element = desc.a
  if ('p' in element) {
    if (element.p === 'u' && element.bits === 8) {
      const bytes = items as number[]
      // uint8 arrays are how DSDL spells strings (node names, param names, paths).
      if (bytes.length === 0) return { ...base, text: '""' }
      if (isPrintable(bytes)) return { ...base, text: JSON.stringify(String.fromCharCode(...bytes)) }
      return { ...base, text: hexBytes(bytes) }
    }
    if (items.length <= INLINE_ARRAY_LIMIT) {
      return { ...base, text: `[${items.map((item) => formatDronecanNumber(item as number, element)).join(', ')}]` }
    }
  }
  return {
    ...base,
    text: items.length === 0 ? '[]' : undefined,
    children: items.map((item, index) => node(`[${index}]`, element, item, catalogue, [], [...path, index]))
  }
}

function sectionNodes(
  section: DronecanSectionDesc,
  value: DronecanValue | undefined,
  catalogue: DronecanCatalogue,
  path: (string | number)[] = []
): DronecanFieldNode[] {
  const record = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, DronecanValue>) : {}
  const fields = section.fields.filter((field) => field.n !== null)
  if (section.union) {
    const active = fields.find((field) => field.n! in record)
    return active ? [node(active.n!, active.t, record[active.n!], catalogue, section.consts, [...path, active.n!])] : []
  }
  return fields.map((field) => node(field.n!, field.t, record[field.n!], catalogue, section.consts, [...path, field.n!]))
}

/** The field tree for a decoded transfer. */
export function buildDronecanFieldTree(
  catalogue: DronecanCatalogue,
  fullName: string,
  section: DronecanSectionKind,
  value: { [field: string]: DronecanValue }
): DronecanFieldNode[] {
  return sectionNodes(catalogue.section(fullName, section), value, catalogue)
}

/** A one-line summary for the table: the first few scalar fields. */
export function summarizeDronecanValue(nodes: readonly DronecanFieldNode[], limit = 3): string {
  const parts: string[] = []
  for (const entry of nodes) {
    if (parts.length >= limit) break
    if (entry.text === undefined || entry.children) continue
    parts.push(`${entry.label} ${entry.meaning ?? entry.text}`)
  }
  return parts.join(' · ')
}

/** Which section of its type a transfer carries. */
export function transferSection(transfer: Pick<DronecanTransfer, 'kind'>): DronecanSectionKind {
  return transfer.kind === 'request' ? 'req' : transfer.kind === 'response' ? 'res' : 'msg'
}

/** The field tree for a decoded transfer, or undefined when it did not decode. */
export function transferFieldTree(transfer: DronecanTransfer): DronecanFieldNode[] | undefined {
  if (!transfer.type || !transfer.value) return undefined
  try {
    return buildDronecanFieldTree(dronecanCatalogue(), transfer.type.fullName, transferSection(transfer), transfer.value)
  } catch {
    return undefined
  }
}

/**
 * A type's display name: the full name without the namespaces everyone
 * knows (uavcan.protocol., uavcan.equipment., a vendor's .equipment.), so
 * NodeStatus and esc.Status read apart where the bare short names ("Status")
 * would collide.
 */
export function dronecanDisplayName(fullName: string): string {
  if (fullName.startsWith('uavcan.protocol.')) return fullName.slice('uavcan.protocol.'.length)
  if (fullName.startsWith('uavcan.equipment.')) return fullName.slice('uavcan.equipment.'.length)
  if (fullName.startsWith('uavcan.')) return fullName.slice('uavcan.'.length)
  return fullName.replace('.equipment.', '.')
}

/**
 * The number at `path` in a decoded value, for plotting: numbers as they
 * are, bigints as numbers, bools as 0 / 1. Undefined when the path is not
 * there -- a union with another field active, an array shorter this time.
 */
export function dronecanValueAt(value: DronecanValue | undefined, path: readonly (string | number)[]): number | undefined {
  let cursor: DronecanValue | undefined = value
  for (const key of path) {
    if (cursor === undefined || cursor === null || typeof cursor !== 'object') return undefined
    cursor = Array.isArray(cursor) ? cursor[key as number] : (cursor as Record<string, DronecanValue>)[key as string]
  }
  if (typeof cursor === 'number') return cursor
  if (typeof cursor === 'bigint') return Number(cursor)
  if (typeof cursor === 'boolean') return cursor ? 1 : 0
  return undefined
}

/** "voltages[2]", "value.integer_value": a path as one readable label. */
export function dronecanPathLabel(path: readonly (string | number)[]): string {
  return path.reduce<string>((label, key) => (typeof key === 'number' ? `${label}[${key}]` : label ? `${label}.${key}` : key), '')
}
