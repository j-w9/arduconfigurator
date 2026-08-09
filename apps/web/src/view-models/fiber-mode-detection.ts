import type { ConfiguratorSnapshot } from '@arduconfig/ardupilot-core'

// Whether the connected vehicle actually has Fiber mode.
//
// Fiber is a fork-only mode — upstream ArduCopter has no such thing — so
// nothing about it may be shown on a stock build. Everything Fiber-specific in
// the UI hangs off this, which keeps the fork feature invisible to the
// operators who make up most of this app's users.
//
// Detection is by evidence from the vehicle, never by firmware version string:
// forks are cherry-picked and rebased, so a version tells you nothing reliable
// about which features are compiled in.

/** The mode number Fiber uses on the fork it originates from. */
const FIBER_CUSTOM_MODE = 31

export function isFiberModeAvailable(snapshot: ConfiguratorSnapshot): boolean {
  // Preferred signal: the vehicle enumerated a mode it calls Fiber. Matching on
  // the NAME rather than the number, because a number is just whatever slot the
  // fork had free and another fork could reuse 31 for something else entirely.
  const advertised = snapshot.availableModes?.some((mode) => /(^|\b)fiber\b/i.test(mode.name))
  if (advertised) {
    return true
  }

  // Fallback for firmware that has Fiber but does not advertise its modes —
  // which is the norm, since a custom mode has to be added to the firmware's
  // AVAILABLE_MODES list by hand and that step is easy to miss. The parameter
  // only exists when the mode is compiled in.
  return snapshot.parameters?.some((parameter) => parameter.id === 'FIBER_TILT_T') ?? false
}

/**
 * Whether a mode number is Fiber on this vehicle, for labelling a slot.
 *
 * Only meaningful once isFiberModeAvailable is true; on a stock build 31 is not
 * a mode at all.
 */
export function isFiberModeNumber(snapshot: ConfiguratorSnapshot, modeNumber: number | undefined): boolean {
  if (modeNumber === undefined) {
    return false
  }
  const named = snapshot.availableModes?.find((mode) => /(^|\b)fiber\b/i.test(mode.name))
  if (named) {
    return named.customMode === modeNumber
  }
  return isFiberModeAvailable(snapshot) && modeNumber === FIBER_CUSTOM_MODE
}
