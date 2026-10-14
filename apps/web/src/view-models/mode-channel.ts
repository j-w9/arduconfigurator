// One job per channel: the flight-mode switch (FLTMODE_CH, Rover MODE_CH) and
// a channel function (RCn_OPTION, e.g. Arm/Disarm) are separate settings, and
// ArduPilot acts on both when they name the same channel -- flicking the mode
// switch would also arm or disarm. Picking one on a channel clears the other.

/** Copter's Acro flight-mode number (FLTMODEn = 1). */
export const COPTER_ACRO_MODE = 1

/** Drafts that make `channel` the flight-mode channel: the mode parameter
 *  names it, and a function already on that channel is cleared. */
export function modeChannelPickDrafts(
  modeParamId: string,
  channel: number,
  optionOf: (channel: number) => number | undefined
): Record<string, string> {
  const drafts: Record<string, string> = { [modeParamId]: String(channel) }
  const option = channel > 0 ? optionOf(channel) : undefined
  if (option !== undefined && option !== 0) {
    drafts[`RC${channel}_OPTION`] = '0'
  }
  return drafts
}

/** Drafts for a function picked on `channel`: its RCn_OPTION, and when the
 *  channel is the flight-mode channel, the mode switch comes off it
 *  (mode channel 0 = no mode switch). */
export function functionPickDrafts(
  modeParamId: string | undefined,
  modeChannel: number | undefined,
  channel: number,
  option: number
): Record<string, string> {
  const drafts: Record<string, string> = { [`RC${channel}_OPTION`]: String(option) }
  if (modeParamId && option !== 0 && modeChannel === channel) {
    drafts[modeParamId] = '0'
  }
  return drafts
}
