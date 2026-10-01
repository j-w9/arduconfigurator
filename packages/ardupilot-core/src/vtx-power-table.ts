// The VTX user power table, which is PARAMETERS rather than part of the
// @VTX/vtxtable.dat blob.
//
// Version 2 of the table blob dropped its power section. Power now lives in
// VTX_PWRTBL_EN plus six slots VTX_PWRTBL1..VTX_PWRTBL6, which has a practical
// consequence worth knowing: these work on EVERY board, while the band table
// can only be stored on boards with 32 KB of parameter storage (most H7s; most
// F405s cannot). So a board that cannot keep custom bands can still have a
// custom power table.
//
// Slot semantics, from the firmware:
//   -1  the slot is unused
//    0  pit mode at that switch position
//   >0  power in milliwatts
//
// There are no stored labels any more — display text is derived from the mW
// value (defaultVtxPowerLabel).

/** Parameter that turns the user power table on. */
export const VTX_POWER_TABLE_ENABLE_PARAM = 'VTX_PWRTBL_EN'

/** The six slot parameters, in the order the firmware uses them. */
export const VTX_POWER_TABLE_SLOT_PARAMS = [
  'VTX_PWRTBL1',
  'VTX_PWRTBL2',
  'VTX_PWRTBL3',
  'VTX_PWRTBL4',
  'VTX_PWRTBL5',
  'VTX_PWRTBL6'
] as const

export const VTX_POWER_TABLE_SLOTS = VTX_POWER_TABLE_SLOT_PARAMS.length

/** A slot value of -1 means "not used"; 0 means pit mode. */
export const VTX_POWER_SLOT_UNUSED = -1
export const VTX_POWER_SLOT_PIT = 0

export type VtxPowerSlotKind = 'unused' | 'pit' | 'power'

export interface VtxPowerSlot {
  /** 0-based index into VTX_POWER_TABLE_SLOT_PARAMS. */
  index: number
  paramId: string
  /** Raw parameter value, or undefined when the board did not report it. */
  raw?: number
  kind: VtxPowerSlotKind
  /** Milliwatts, only when kind === 'power'. */
  milliwatts?: number
}

export interface VtxPowerTable {
  /** True when VTX_PWRTBL_EN is 1. */
  enabled: boolean
  /** False when the firmware does not expose VTX_PWRTBL_EN at all. */
  supported: boolean
  slots: VtxPowerSlot[]
}

export function classifyVtxPowerSlot(raw: number | undefined): VtxPowerSlotKind {
  if (raw === undefined || raw < 0) {
    return 'unused'
  }
  return raw === VTX_POWER_SLOT_PIT ? 'pit' : 'power'
}

/**
 * Read the power table out of a parameter lookup.
 *
 * Takes a plain reader rather than a snapshot so the same function serves the
 * runtime, the UI and the tests without any of them needing a whole
 * ConfiguratorSnapshot to ask a question about six numbers.
 */
export function readVtxPowerTable(read: (paramId: string) => number | undefined): VtxPowerTable {
  const enable = read(VTX_POWER_TABLE_ENABLE_PARAM)
  const slots = VTX_POWER_TABLE_SLOT_PARAMS.map((paramId, index) => {
    const raw = read(paramId)
    const kind = classifyVtxPowerSlot(raw)
    return {
      index,
      paramId,
      raw,
      kind,
      milliwatts: kind === 'power' ? raw : undefined
    }
  })
  return { enabled: enable === 1, supported: enable !== undefined, slots }
}

/**
 * The parameter writes for a desired set of slots, in slot order.
 *
 * Entries are the value for each slot: a number of milliwatts, 'pit', or
 * undefined for an unused slot. Shorter lists leave the remaining slots
 * explicitly unused rather than whatever was there before — a stale slot 5 from
 * a previous table is a power level the pilot did not choose.
 */
export function vtxPowerTableWrites(
  entries: readonly (number | 'pit' | undefined)[],
  options: { enable?: boolean } = {}
): { paramId: string; value: number }[] {
  const writes: { paramId: string; value: number }[] = VTX_POWER_TABLE_SLOT_PARAMS.map((paramId, index) => {
    const entry = entries[index]
    const value =
      entry === undefined
        ? VTX_POWER_SLOT_UNUSED
        : entry === 'pit'
          ? VTX_POWER_SLOT_PIT
          : Math.max(0, Math.round(entry))
    return { paramId, value }
  })
  if (options.enable !== undefined) {
    writes.unshift({ paramId: VTX_POWER_TABLE_ENABLE_PARAM, value: options.enable ? 1 : 0 })
  }
  return writes
}
