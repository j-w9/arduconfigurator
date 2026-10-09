// Pure helpers behind the CAN bus monitor: what a frame IS (DroneCAN header
// breakdown or plain CAN), the filter form's parsed state, and the formatting
// the frame table and the frame-details pane share. No React, no runtime.

import {
  ALL_CAN_FRAME_KINDS,
  parseCanDataSearch,
  parseCanIdFilter,
  type CanFrame,
  type CanFrameDirection,
  type CanFrameFilter,
  type CanFrameKinds
} from '@arduconfig/can-core'
import {
  dronecanIsServiceFrame,
  dronecanIsServiceRequest,
  dronecanMessageTypeId,
  dronecanParseTailByte,
  dronecanServiceDestinationNodeId,
  dronecanServiceTypeId,
  dronecanSourceNodeId
} from '@arduconfig/protocol-mavlink'
import { dronecanCatalogue, type DronecanTransfer } from '@arduconfig/dronecan-dsdl'

/** The DSDL short name for a message / service id, from the bundled catalogue. */
function messageName(typeId: number): string | undefined {
  return dronecanCatalogue().messageById(typeId)?.shortName
}
function serviceName(typeId: number): string | undefined {
  return dronecanCatalogue().serviceById(typeId)?.shortName
}

export interface DronecanFrameHeader {
  /** 0 (highest) .. 31 (lowest). */
  priority: number
  kind: 'message' | 'anonymous' | 'service'
  typeId: number
  typeName?: string
  sourceNodeId: number
  destinationNodeId?: number
  /** Service frames: request (true) or response (false). */
  request?: boolean
  sot: boolean
  eot: boolean
  toggle: boolean
  transferId: number
}

/**
 * The DroneCAN header of a frame, or undefined for anything DroneCAN cannot
 * be: standard ids, remote, error and FD frames, and frames with no tail byte.
 * A 29-bit frame that is not really DroneCAN still parses -- the bus cannot
 * tell us -- so the UI calls this a reading, not a fact.
 */
export function dronecanFrameHeader(frame: CanFrame): DronecanFrameHeader | undefined {
  if (!frame.extended || frame.rtr || frame.error || frame.fd || frame.data.length === 0) {
    return undefined
  }
  const id = frame.id
  const tail = dronecanParseTailByte(frame.data[frame.data.length - 1])
  const sourceNodeId = dronecanSourceNodeId(id)
  const priority = (id >>> 24) & 0x1f
  if (dronecanIsServiceFrame(id)) {
    const typeId = dronecanServiceTypeId(id)
    return {
      priority,
      kind: 'service',
      typeId,
      typeName: serviceName(typeId),
      sourceNodeId,
      destinationNodeId: dronecanServiceDestinationNodeId(id),
      request: dronecanIsServiceRequest(id),
      ...tail
    }
  }
  // Anonymous messages (source 0) carry only the low 2 bits of the type id.
  const anonymous = sourceNodeId === 0
  const typeId = anonymous ? (id >>> 8) & 0x3 : dronecanMessageTypeId(id)
  return {
    priority,
    kind: anonymous ? 'anonymous' : 'message',
    typeId,
    typeName: anonymous ? undefined : messageName(typeId),
    sourceNodeId,
    ...tail
  }
}

/** One short line for the table's "Decoded" column. */
export function describeCanFrame(frame: CanFrame): string {
  if (frame.error) return 'Error frame'
  if (frame.rtr) return 'Remote request'
  const header = dronecanFrameHeader(frame)
  if (!header) return frame.fd ? 'CAN FD' : ''
  const name = header.typeName ?? `${header.kind === 'service' ? 'service' : 'msg'} ${header.typeId}`
  const part = header.sot && header.eot ? '' : header.sot ? ' (start)' : header.eot ? ' (end)' : ' (cont.)'
  if (header.kind === 'service') {
    return `${name} ${header.request ? 'req' : 'resp'} ${header.sourceNodeId}→${header.destinationNodeId}${part}`
  }
  if (header.kind === 'anonymous') {
    return `anonymous ${header.typeId}${part}`
  }
  return `${name} ← ${header.sourceNodeId}${part}`
}

/** Seconds since the capture origin, millisecond resolution: "12.345". */
export function formatCaptureTime(timestampMs: number, originMs: number): string {
  return Math.max(0, (timestampMs - originMs) / 1000).toFixed(3)
}

/** The filter form as typed; parsed by buildCanMonitorFilter. */
export interface CanMonitorFilterForm {
  idText: string
  /** Decoded message names: "mag*", "esc.Status, NodeStatus". */
  nameText: string
  dataText: string
  kinds: CanFrameKinds
  direction: 'all' | CanFrameDirection
}

export const DEFAULT_CAN_MONITOR_FILTER_FORM: CanMonitorFilterForm = {
  idText: '',
  nameText: '',
  dataText: '',
  kinds: ALL_CAN_FRAME_KINDS,
  direction: 'all'
}

export interface CanMonitorFilterState {
  filter: CanFrameFilter
  /** Set when a name filter is typed: does a frame's decoded name match. */
  matchesName?: (names: readonly string[]) => boolean
  idError?: string
  dataError?: string
  /** True when anything would hide a frame. */
  active: boolean
}

/**
 * Parse the form. A field that does not parse is reported and IGNORED (the
 * rest of the filter still applies), so a half-typed expression never blanks
 * the table.
 */
export function buildCanMonitorFilter(form: CanMonitorFilterForm): CanMonitorFilterState {
  const ids = parseCanIdFilter(form.idText)
  const data = parseCanDataSearch(form.dataText)
  const filter: CanFrameFilter = {
    idTerms: ids.ok ? ids.value : [],
    kinds: form.kinds,
    direction: form.direction === 'all' ? undefined : form.direction,
    dataContains: data.ok ? data.value : undefined
  }
  const kindsActive = Object.values(form.kinds).some((on) => !on)
  return {
    filter,
    matchesName: parseCanNameFilter(form.nameText),
    idError: ids.ok ? undefined : ids.error,
    dataError: data.ok ? undefined : data.error,
    active:
      form.nameText.trim() !== '' ||
      (ids.ok && ids.value.length > 0) ||
      (data.ok && data.value !== undefined) ||
      kindsActive ||
      form.direction !== 'all'
  }
}

/**
 * A name filter: comma-separated terms, any of which may match. `*` and `?`
 * are wildcards ("mag*", "esc.*Status"); a term without one matches anywhere
 * in the name ("mag" finds MagneticFieldStrength2). Case does not matter.
 * Undefined when nothing is typed.
 */
export function parseCanNameFilter(text: string): ((names: readonly string[]) => boolean) | undefined {
  const terms = text
    .split(',')
    .map((term) => term.trim().toLowerCase())
    .filter((term) => term !== '')
  if (terms.length === 0) return undefined
  const patterns = terms.map((term) => {
    if (!/[*?]/.test(term)) return (name: string) => name.includes(term)
    const source = term.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')
    // A wildcard term matches a whole dotted segment run: "mag*" finds
    // "uavcan.equipment.ahrs.MagneticFieldStrength2" by its last part.
    const regex = new RegExp(`(^|\\.)${source}$`)
    return (name: string) => regex.test(name)
  })
  return (names) => names.some((name) => {
    const lower = name.toLowerCase()
    return patterns.some((pattern) => pattern(lower))
  })
}

/** The names a frame answers to in the name filter: its decoded DroneCAN type's full name. */
export function canFrameNames(transfer: DronecanTransfer | undefined): string[] {
  const type = transfer?.type
  return type ? [type.fullName] : []
}

/** Byte-by-byte views for the details pane. */
export function canByteRows(data: Uint8Array): { index: number; hex: string; dec: string; bin: string; ascii: string }[] {
  return Array.from(data, (byte, index) => ({
    index,
    hex: byte.toString(16).toUpperCase().padStart(2, '0'),
    dec: String(byte),
    bin: byte.toString(2).padStart(8, '0'),
    ascii: byte >= 0x20 && byte < 0x7f ? String.fromCharCode(byte) : '·'
  }))
}
