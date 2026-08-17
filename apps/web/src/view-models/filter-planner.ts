// A filter editor that only does arithmetic ArduPilot documents.
//
// An earlier version derived the whole rate-loop filter set from the gyro
// filter (FLTD = FLTT = gyro/2, FLTE = 0/2, INS_ACCEL_FILTER = 10). Those
// ratios come from Mission Planner's Initial Parameters screen, not from
// ArduPilot's own documentation, and this surface writes to a flight
// controller -- so they are no longer applied automatically. Every filter is
// an operator input, seeded from what the vehicle is already running.
//
// Two rules survive, because ArduPilot states them:
//
//   INS_HNTCH_BW = FREQ / 2 -- "This is typically set to half the base
//   frequency" (Filter/HarmonicNotchFilter.cpp:78), and the throttle-based
//   notch setup page gives the same: BW = hover_freq / 2.
//
//   INS_HNTCH_REF -- "For throttle-based scaling, this parameter is the
//   reference value associated with the specified frequency... For RPM and ESC
//   telemetry based tracking, this parameter is set to 1"
//   (HarmonicNotchFilter.cpp @Param REF). A REF of zero "disables dynamic
//   updates", so an enabled notch with REF at 0 tracks nothing.
//
// Both are offered as suggestions the operator can take or overwrite, never
// as values applied behind their back.

/** INS_HNTCH_MODE values -- HarmonicNotchFilter.cpp @Values. */
export const NOTCH_MODES = [
  { value: 0, label: 'Fixed' },
  { value: 1, label: 'Throttle' },
  { value: 2, label: 'RPM sensor' },
  { value: 3, label: 'ESC telemetry' },
  { value: 4, label: 'In-flight FFT' },
  { value: 5, label: 'Second RPM sensor' }
] as const

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

/** Name the set bits so a bitmask is readable in a review table. */
export function describeNotchOpts(opts: number): string {
  const set = NOTCH_OPTION_BITS.filter((option) => (opts & (1 << option.bit)) !== 0).map((option) => option.label)
  return set.length > 0 ? `Options: ${set.join(', ')}` : 'No notch options set'
}

/**
 * ArduPilot's documented REF for a mode.
 *
 * Returns undefined where the docs give no value — fixed and FFT modes do not
 * scale from a reference, so there is nothing to suggest.
 */
export function documentedNotchRef(mode: number, hoverThrust?: number): number | undefined {
  if (mode === 1) return hoverThrust
  if (mode === 2 || mode === 3 || mode === 5) return 1
  return undefined
}

/** ArduPilot's documented bandwidth: half the base frequency. */
export function documentedNotchBandwidth(freqHz: number): number | undefined {
  return Number.isFinite(freqHz) && freqHz > 0 ? Math.round(freqHz / 2) : undefined
}

/** One editable filter parameter. */
export interface FilterField {
  id: string
  /** What the vehicle reports now, when it reports it. */
  liveValue?: number
  /** What the operator typed, as text so a half-typed value is not clobbered. */
  input: string
}

export interface FilterPlan {
  values: Array<{ id: string; value: number }>
  warnings: string[]
  errors: string[]
}

/**
 * Turn the operator's inputs into a staged change set.
 *
 * Pure bookkeeping: parse, drop anything unchanged or unparseable, and report
 * what could not be read rather than silently skipping it. No value is
 * invented here -- if the operator did not type it, it does not get staged.
 */
export function buildFilterPlan(fields: readonly FilterField[]): FilterPlan {
  const values: Array<{ id: string; value: number }> = []
  const warnings: string[] = []
  const errors: string[] = []

  for (const field of fields) {
    const text = field.input.trim()
    if (text === '') continue
    const parsed = Number.parseFloat(text)
    if (!Number.isFinite(parsed)) {
      errors.push(`${field.id}: "${field.input}" is not a number.`)
      continue
    }
    if (field.liveValue !== undefined && Math.abs(field.liveValue - parsed) < 1e-6) continue
    values.push({ id: field.id, value: parsed })
  }

  // Sanity checks ArduPilot documents, reported rather than enforced -- the
  // operator may know something the app does not.
  const byId = new Map(values.map((entry) => [entry.id, entry.value]))
  const freq = byId.get('INS_HNTCH_FREQ')
  const enable = byId.get('INS_HNTCH_ENABLE')
  const ref = byId.get('INS_HNTCH_REF')
  if (enable === 1 && ref === 0) {
    warnings.push('INS_HNTCH_REF is 0, which ArduPilot documents as disabling dynamic updates — the notch will not track.')
  }
  if (freq !== undefined && freq >= 500) {
    warnings.push(`INS_HNTCH_FREQ ${freq} Hz should stay below half the gyro backend rate (typically 1 kHz).`)
  }

  return { values, warnings, errors }
}
