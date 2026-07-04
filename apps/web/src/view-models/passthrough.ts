// Pure helpers for the DroneNet passthrough-row editor. AP_Periph passthrough
// (NET_PASSn_*) bridges two serial-manager endpoints; the raw params give each
// endpoint as an ID number (0–9 UART/USB, 21–29 network port, 41–49 CAN1 tunnel,
// 51–59 CAN2 tunnel). These helpers turn that into labelled dropdowns + grouped
// blocks, and back into DroneCAN param writes.

import type { DronecanParamEntry, DronecanParamValueState } from '@arduconfig/ardupilot-core'

export interface EndpointOption {
  value: number
  label: string
}

/** Every selectable passthrough endpoint, labelled (AP_Periph serial-manager IDs). */
export function passthroughEndpointOptions(): EndpointOption[] {
  const options: EndpointOption[] = [{ value: 0, label: 'Serial 0 (USB / console)' }]
  for (let i = 1; i <= 9; i += 1) options.push({ value: i, label: `Serial ${i}` })
  for (let i = 1; i <= 9; i += 1) options.push({ value: 20 + i, label: `Network port ${i}` })
  for (let i = 1; i <= 9; i += 1) options.push({ value: 40 + i, label: `CAN1 tunnel ${i}` })
  for (let i = 1; i <= 9; i += 1) options.push({ value: 50 + i, label: `CAN2 tunnel ${i}` })
  return options
}

/**
 * The endpoints actually available on a node, derived from its full param set:
 * Serial 0 (console) + every SERIALn_ UART it reports + every NET_Pn_ network
 * port, plus any endpoint IDs currently selected (so existing config always
 * renders). CAN-tunnel endpoints (41–59) are offered only when already in use —
 * AP_Periph nodes rarely wire them, so we don't advertise all 18. Prevents the
 * dropdown listing endpoints the node doesn't actually have.
 */
export function availablePassthroughEndpoints(
  paramNames: readonly string[],
  selected: readonly number[]
): EndpointOption[] {
  // Do NOT assume Serial 0 / USB console exists — an AP_Periph/DroneNet node
  // often has no USB, so offering "Serial 0 (USB / console)" is misleading.
  // Derive serials purely from the SERIALn_ params the node actually reports.
  const present = new Set<number>()
  for (const name of paramNames) {
    const serial = /^SERIAL(\d)_/.exec(name)
    if (serial) {
      present.add(Number(serial[1]))
    }
    const net = /^NET_P(\d)_/.exec(name)
    if (net) {
      const port = Number(net[1])
      if (port >= 1 && port <= 9) {
        present.add(20 + port)
      }
    }
  }
  for (const value of selected) {
    present.add(value)
  }
  return passthroughEndpointOptions().filter((option) => present.has(option.value))
}

export function endpointLabel(id: number | undefined): string {
  if (id === undefined) return '—'
  return passthroughEndpointOptions().find((option) => option.value === id)?.label ?? `ID ${id}`
}

/** Only a hardware UART endpoint (0–9) has a meaningful baud / options. */
export function isUartEndpoint(id: number | undefined): boolean {
  return id !== undefined && id >= 0 && id <= 9
}

export interface PassthroughBlock {
  /** n in NET_PASSn_. */
  index: number
  enable: number
  ep1: number
  ep2: number
  baud1?: number
  baud2?: number
  /** Raw param entries by suffix (ENABLE/EP1/EP2/BAUD1/BAUD2/OPT1/OPT2). */
  entries: Record<string, DronecanParamEntry>
}

/** Read a DroneCAN param value as a number (int64 serialized as string, etc.). */
export function paramInt(value: DronecanParamValueState | undefined): number | undefined {
  if (!value) return undefined
  if (value.tag === 'int64' && value.int64 !== undefined) return Number(value.int64)
  if (value.tag === 'real32' && value.real32 !== undefined) return value.real32
  if (value.tag === 'bool' && value.bool !== undefined) return (value.bool ? 1 : 0)
  return undefined
}

/** Rebuild a value state of the same tag as `original`, carrying `next`. */
export function intValueLike(original: DronecanParamValueState, next: number): DronecanParamValueState {
  if (original.tag === 'real32') return { tag: 'real32', real32: next }
  if (original.tag === 'bool') return { tag: 'bool', bool: next !== 0 }
  return { tag: 'int64', int64: String(Math.round(next)) }
}

/** Group a node's NET_PASSn_ params into passthrough blocks, sorted by index. */
export function groupPassthroughBlocks(params: readonly DronecanParamEntry[]): PassthroughBlock[] {
  const byIndex = new Map<number, Record<string, DronecanParamEntry>>()
  for (const entry of params) {
    const match = /^NET_PASS(\d+)_([A-Z0-9]+)$/.exec(entry.name)
    if (!match) continue
    const index = Number(match[1])
    const existing = byIndex.get(index) ?? {}
    existing[match[2]] = entry
    byIndex.set(index, existing)
  }
  return [...byIndex.entries()]
    .filter(([, entries]) => entries.ENABLE !== undefined || entries.EP1 !== undefined)
    .sort((left, right) => left[0] - right[0])
    .map(([index, entries]) => ({
      index,
      enable: paramInt(entries.ENABLE?.value) ?? 0,
      ep1: paramInt(entries.EP1?.value) ?? 0,
      ep2: paramInt(entries.EP2?.value) ?? 0,
      baud1: paramInt(entries.BAUD1?.value),
      baud2: paramInt(entries.BAUD2?.value),
      entries
    }))
}
