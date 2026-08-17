// The only arithmetic the Filter Editor offers, and the reasoning behind it.
//
// The editor itself is manual: fields render through the app's shared metadata
// editor and stage drafts like any other parameter. What lives here is the
// handful of rules ArduPilot documents, exposed as suggestions the operator
// takes or ignores.
//
// An earlier version derived the whole rate-loop filter set from the gyro
// filter (FLTD = FLTT = gyro/2, FLTE = 0/2, INS_ACCEL_FILTER = 10). Those
// ratios are Mission Planner's Initial Parameters screen, not ArduPilot's own
// documentation, and this surface writes to a flight controller -- so they are
// no longer applied. Only these two survived, because ArduPilot states them:
//
//   INS_HNTCH_BW = FREQ / 2 -- "This is typically set to half the base
//   frequency" (Filter/HarmonicNotchFilter.cpp:78). The throttle-based notch
//   setup page gives the same as BW = hover_freq / 2.
//
//   INS_HNTCH_REF -- "For throttle-based scaling, this parameter is the
//   reference value associated with the specified frequency... For RPM and ESC
//   telemetry based tracking, this parameter is set to 1" (@Param REF). A REF
//   of zero "disables dynamic updates", so an enabled notch with REF still at
//   zero looks configured and tracks nothing.

/** INS_HNTCH_OPTS bits -- HarmonicNotchFilter.cpp:134 @Bitmask. */
export const NOTCH_OPTION_BITS = [
  { bit: 0, label: 'Double notch' },
  { bit: 1, label: 'Multi-Source' },
  { bit: 2, label: 'Update at loop rate' },
  { bit: 3, label: 'Enable on all IMUs' },
  { bit: 4, label: 'Triple notch' },
  { bit: 5, label: 'Min freq on RPM failure' },
  { bit: 6, label: 'Quintuple notch' }
] as const

/**
 * Name the set bits, so a bitmask reads as words in the summary line.
 *
 * The per-bit toggles carry their own labels; this is for stating what the
 * whole value means in one line.
 */
export function describeNotchOpts(opts: number): string {
  const set = NOTCH_OPTION_BITS.filter((option) => (opts & (1 << option.bit)) !== 0).map((option) => option.label)
  return set.length > 0 ? `Options: ${set.join(', ')}` : 'No notch options set'
}

/**
 * ArduPilot's documented reference value for a tracking mode.
 *
 * Returns undefined where the docs give none -- fixed and in-flight-FFT modes
 * do not scale from a reference, so there is nothing to suggest and nothing is
 * offered.
 */
export function documentedNotchRef(mode: number, hoverThrust?: number): number | undefined {
  if (mode === 1) return hoverThrust
  if (mode === 2 || mode === 3 || mode === 5) return 1
  return undefined
}

/**
 * ArduPilot's documented bandwidth: half the base frequency.
 *
 * This is the THROTTLE-mode rule, where the centre is inferred from throttle
 * position and the notch has to be wide enough to cover the error. With a
 * measured source the centre is known and a narrower notch is usual -- a 15"
 * build might run FREQ 40 with BW 10 -- so the caller does not offer this for
 * those modes.
 */
export function documentedNotchBandwidth(freqHz: number): number | undefined {
  return Number.isFinite(freqHz) && freqHz > 0 ? Math.round(freqHz / 2) : undefined
}
