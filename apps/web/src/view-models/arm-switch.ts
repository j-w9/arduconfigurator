// Pure builder for the Receiver tab's "Arm switch" control — confirmed gap:
// no UI in this app wrote a real RCn_OPTION Arm/Disarm value to a channel
// (the RC Mixer tab's own "Arm/Disarm" entry either does nothing without the
// RCL_* engine, or writes RCL_FUNC, a different subsystem, when it is
// present). This binds directly to the plain RCn_OPTION parameter every
// ArduPilot vehicle exposes, independent of AP_RC_Logic.

import type { ConfiguratorSnapshot } from '@arduconfig/ardupilot-core'

import { readRoundedParameter } from '../selectors/parameter-read'

/** RCn_OPTION value for a plain Arm/Disarm switch (firmware 4.2+; ArduPilot
 *  keeps the old value 41 recognized for 4.1-and-earlier compatibility, but
 *  153 is what current firmware documents and what this control writes). */
export const ARM_SWITCH_OPTION_VALUE = 153
/** RCn_OPTION value for Arm/Disarm bundled with AirMode-on-arm. */
export const ARM_SWITCH_AIRMODE_OPTION_VALUE = 154

// RCn_OPTION only makes sense on AUX channels — the primary stick axes are
// excluded elsewhere in the app (see derivePrimaryStickChannels) and AUX
// options by convention start no earlier than channel 5. Internal to this
// module (never referenced externally).
const ARM_SWITCH_MIN_CHANNEL = 5
const ARM_SWITCH_MAX_CHANNEL = 16

export interface ArmSwitchAssignment {
  /** The channel currently carrying an Arm/Disarm RCn_OPTION value, or
   *  undefined if none does. */
  channel: number | undefined
  /** True when the assigned channel uses the AirMode variant (154) rather
   *  than the plain one (153). Meaningless when channel is undefined. */
  airmode: boolean
}

/** Reads a param honoring an in-progress staged edit over the live value —
 *  same effective-value convention used by rc-logic.ts, so the control
 *  reflects a just-made selection immediately, before Apply. */
function effectiveOptionValue(
  snapshot: ConfiguratorSnapshot,
  editedValues: Record<string, string>,
  channel: number
): number | undefined {
  const paramId = `RC${channel}_OPTION`
  const staged = editedValues[paramId]
  if (staged !== undefined && staged !== '') {
    const parsed = Number(staged)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return readRoundedParameter(snapshot, paramId)
}

/** Scans RC5_OPTION..RC16_OPTION for an existing Arm/Disarm assignment. Only
 *  the first match is reported — if more than one channel somehow carries
 *  it (hand-edited via raw Parameters), this is the one the control treats
 *  as "current" and will move away from a re-assignment. */
export function deriveArmSwitchAssignment(
  snapshot: ConfiguratorSnapshot,
  editedValues: Record<string, string>
): ArmSwitchAssignment {
  for (let channel = ARM_SWITCH_MIN_CHANNEL; channel <= ARM_SWITCH_MAX_CHANNEL; channel += 1) {
    const value = effectiveOptionValue(snapshot, editedValues, channel)
    if (value === ARM_SWITCH_OPTION_VALUE) {
      return { channel, airmode: false }
    }
    if (value === ARM_SWITCH_AIRMODE_OPTION_VALUE) {
      return { channel, airmode: true }
    }
  }
  return { channel: undefined, airmode: false }
}

/** Drafts to move (or clear) the arm-switch assignment. `targetChannel`
 *  undefined clears whichever channel currently holds it (sets its
 *  RCn_OPTION to 0). Moving to a new channel also clears the previous one —
 *  ArduPilot doesn't reject two live arm switches, but that's a footgun this
 *  control shouldn't invite; exactly one channel is ever assigned at a time. */
export function armSwitchAssignmentDrafts(
  current: ArmSwitchAssignment,
  targetChannel: number | undefined,
  airmode: boolean
): Record<string, string> {
  const drafts: Record<string, string> = {}
  if (current.channel !== undefined && current.channel !== targetChannel) {
    drafts[`RC${current.channel}_OPTION`] = '0'
  }
  if (targetChannel !== undefined) {
    drafts[`RC${targetChannel}_OPTION`] = String(
      airmode ? ARM_SWITCH_AIRMODE_OPTION_VALUE : ARM_SWITCH_OPTION_VALUE
    )
  }
  return drafts
}

/** ArduPilot AUX_SWITCH_PWM_TRIGGER_HIGH: an aux switch reads HIGH — the arm
 *  position for ARMDISARM (153) / ARMDISARM_AIRMODE (154) — above 1800µs. */
export const ARM_SWITCH_HIGH_PWM_US = 1800

/** True when a channel PWM puts the arm switch in the arm (HIGH) position.
 *  Rejects undefined and the RC_CHANNELS no-data sentinel (0xffff) / other
 *  out-of-band values so a silent or missing channel never reads as "armed". */
export function isArmSwitchInArmPosition(pwm: number | undefined): boolean {
  return pwm !== undefined && Number.isFinite(pwm) && pwm > ARM_SWITCH_HIGH_PWM_US && pwm < 2500
}

/** Whether the arm-switch channel row should be boxed red in the Receiver tab:
 *  the vehicle is armed, an arm switch is assigned, and that channel is in the
 *  arm (high) position — i.e. the switch is actively holding the craft armed. */
export function isArmSwitchHighlightActive(
  assignment: ArmSwitchAssignment,
  armed: boolean,
  armChannelPwm: number | undefined
): boolean {
  return armed && assignment.channel !== undefined && isArmSwitchInArmPosition(armChannelPwm)
}

export interface ArmSwitchChannelOption {
  value: number
  label: string
}

/** Channel picker options: 0 = "None" (clears the assignment), then every
 *  AUX channel in range. */
export function armSwitchChannelOptions(): readonly ArmSwitchChannelOption[] {
  const options: ArmSwitchChannelOption[] = [{ value: 0, label: 'None' }]
  for (let channel = ARM_SWITCH_MIN_CHANNEL; channel <= ARM_SWITCH_MAX_CHANNEL; channel += 1) {
    options.push({ value: channel, label: `Channel ${channel}` })
  }
  return options
}
