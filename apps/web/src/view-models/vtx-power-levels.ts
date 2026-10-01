// The RC Mixer's VTX_POWER level selector stores a 0-based index into the
// vehicle's ACTIVE power levels — the firmware's set_power_by_index /
// get_power_mw_for_index walk exactly the entries that carry a power, so a pit
// (0) or unused (-1) slot is dropped and the index runs over the surviving
// list, in slot order.
//
// Those levels are VTX_PWRTBL1..6 now rather than a section of the @VTX blob,
// so this reads the PARAMETERS. The index must resolve against what the vehicle
// actually has, which is another reason parameters are the right source: they
// are the live values, with no unsaved-upload gap between what the RC Mixer
// indexes and what the firmware will do.

export interface VtxPowerLevelOption {
  /** 0-based index over the non-zero levels = the value stored in OPT bits 5-7. */
  index: number
  /** Protocol value (mW for Tramp/MSP, dBm/index for SmartAudio). */
  mw: number
  label: string
}

export function deriveVtxPowerLevels(
  slots: readonly { kind: string; milliwatts?: number }[] | undefined,
  labelFor: (mw: number) => string
): VtxPowerLevelOption[] | undefined {
  if (!slots) {
    return undefined
  }
  return slots
    .filter((slot) => slot.kind === 'power' && slot.milliwatts !== undefined)
    .map((slot, index) => ({ index, mw: slot.milliwatts!, label: labelFor(slot.milliwatts!) }))
}
