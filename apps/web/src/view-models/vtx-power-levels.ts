// The RC Mixer's VTX_POWER level selector stores a 0-based index into the
// vehicle's ACTIVE (non-zero) @VTX power levels — the firmware's
// set_power_by_index / get_power_mw_for_index walk exactly the non-zero
// entries, so a value=0 (disabled/pit) row is dropped and the index runs over
// the surviving list, in table order.

export interface VtxPowerLevelOption {
  /** 0-based index over the non-zero levels = the value stored in OPT bits 5-7. */
  index: number
  /** Protocol value (mW for Tramp/MSP, dBm/index for SmartAudio). */
  mw: number
  label: string
}

export function deriveVtxPowerLevels(
  powerLevels: readonly { value: number; label: string }[] | undefined
): VtxPowerLevelOption[] | undefined {
  if (!powerLevels) {
    return undefined
  }
  return powerLevels
    .filter((level) => level.value !== 0)
    .map((level, index) => ({ index, mw: level.value, label: level.label }))
}
