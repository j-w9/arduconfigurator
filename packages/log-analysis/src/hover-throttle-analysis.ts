// Measure a vehicle's hover throttle from a flight log.
//
// ArduCopter learns MOT_THST_HOVER itself, but only while every gate in
// Copter::update_throttle_hover is open: armed, not landed, NOT in a
// manual-throttle mode (Stabilize/Acro/SystemID/Turtle) or Drift, zero
// commanded climb rate, a usable vertical-velocity estimate, and within 5
// degrees of level. A flight that misses any of those learns NOTHING, and the
// parameter stays at its 0.35 default -- which is indistinguishable from a
// vehicle that has never flown. That is a real field report, and it blocks
// everything downstream: the Z-bias flight and the thrust-curve work both need
// a hover throttle that means something.
//
// The log has the answer either way. CTUN.ThO is `motors->get_throttle()` --
// literally the quantity the firmware would have filtered -- so a steady hover
// segment gives the number directly, whether or not the learner ever ran.
//
// Data used (dataflash only, no live connection):
//   - CTUN.ThO    normalized throttle out (0..1)
//   - CTUN.ThH    the firmware's own learned hover throttle, to report whether
//                 its learner moved at all
//   - CTUN.DCRt   desired climb rate -- the firmware's own "not climbing" gate
//   - CTUN.CRt    achieved climb rate
//   - RATE.AOut   fallback throttle source ("percentage of vertical thrust
//                 output currently being used") when CTUN is not logged
//   - MODE.ModeNum  which mode the hover was flown in, to explain a learner
//                 that never ran

import { parseDataflashLog, type ParsedDataflashLog } from './dataflash-parser.js'

/** AP_MOTORS_THST_HOVER_MIN / _MAX, AP_MotorsMulticopter.h. */
export const THST_HOVER_MIN = 0.125
export const THST_HOVER_MAX = 0.6875
/** AP_MOTORS_THST_HOVER_DEFAULT. */
export const THST_HOVER_DEFAULT = 0.35

/**
 * Modes that cannot learn a hover throttle at all: every mode whose
 * `has_manual_throttle()` is true (ArduCopter/mode.h), plus Drift, which
 * Copter::update_throttle_hover excludes by name.
 */
const BLIND_MODE_NUMBERS = new Map<number, string>([
  [0, 'Stabilize'],
  [1, 'Acro'],
  [11, 'Drift'],
  [25, 'SystemID'],
  [28, 'Turtle']
])

const MODE_NAMES = new Map<number, string>([
  [0, 'Stabilize'], [1, 'Acro'], [2, 'AltHold'], [3, 'Auto'], [4, 'Guided'],
  [5, 'Loiter'], [6, 'RTL'], [7, 'Circle'], [9, 'Land'], [11, 'Drift'],
  [13, 'Sport'], [14, 'Flip'], [15, 'AutoTune'], [16, 'PosHold'], [17, 'Brake'],
  [18, 'Throw'], [19, 'Avoid ADS-B'], [20, 'Guided NoGPS'], [21, 'SmartRTL'],
  [22, 'FlowHold'], [23, 'Follow'], [24, 'ZigZag'], [25, 'SystemID'],
  [26, 'Heli Autorotate'], [27, 'Auto RTL'], [28, 'Turtle'], [29, 'VALT']
])

// Steady-hover detection.
/** Below this the vehicle is not carrying its own weight. */
const MIN_THROTTLE = 0.04
/** The firmware's own gate is vel_desired == 0; allow for shaping residue. */
const MAX_DESIRED_CLIMB_MS = 0.05
/** Copter::update_throttle_hover's own |vel_d| < 0.6 m/s test. */
const MAX_CLIMB_MS = 0.6
/** Throttle must hold within this band for the window to count as steady. */
const THROTTLE_BAND = 0.03
const MIN_WINDOW_S = 3
const MIN_WINDOW_SAMPLES = 20
const MAX_SAMPLE_GAP_S = 0.5

export interface HoverThrottleWindow {
  startS: number
  endS: number
  durationS: number
  samples: number
  /** Mean normalized throttle out over the window (0..1). */
  throttle: number
}

export interface HoverThrottleResult {
  /** The measured hover throttle, or undefined when no steady hover was found. */
  hoverThrottle?: number
  /** Standard deviation of the per-sample throttle across all windows. */
  standardDeviation?: number
  windows: HoverThrottleWindow[]
  totalHoverS: number
  totalSamples: number
  /** 'CTUN' when CTUN.ThO was available, 'RATE' when it fell back. */
  source?: 'CTUN' | 'RATE'
  /** The firmware's own MOT_THST_HOVER as the log saw it, first and last. */
  firmwareLearnedFirst?: number
  firmwareLearnedLast?: number
  /** True when the firmware's own learner never moved during this flight. */
  firmwareLearnerIdle: boolean
  /** Mode names seen during the steady-hover windows. */
  hoverModes: string[]
  /** Hover modes in which the firmware can learn nothing at all. */
  blindHoverModes: string[]
  /**
   * True when the measurement is at or below AP_MOTORS_THST_HOVER_MIN, i.e.
   * the aircraft hovers below the lowest value MOT_THST_HOVER can hold. The
   * parameter is then a clamp rather than a measurement.
   */
  belowParameterFloor: boolean
  warnings: string[]
}

function num(message: Record<string, unknown>, field: string): number | undefined {
  const value = message[field]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

interface Sample {
  t: number
  throttle: number
  /** Undefined when the source carries no climb-rate fields (RATE fallback). */
  desiredClimb?: number
  climb?: number
}

/** Mode number in effect at time `t`, from the MODE message timeline. */
function modeAt(modes: { t: number; mode: number }[], t: number): number | undefined {
  let current: number | undefined
  for (const entry of modes) {
    if (entry.t > t) break
    current = entry.mode
  }
  return current
}

export function analyzeHoverThrottleLog(log: ParsedDataflashLog): HoverThrottleResult {
  const warnings: string[] = []

  const modes: { t: number; mode: number }[] = []
  for (const message of log.messagesByType.get('MODE') ?? []) {
    const t = num(message, 'TimeUS')
    const mode = num(message, 'ModeNum') ?? num(message, 'Mode')
    if (t !== undefined && mode !== undefined) {
      modes.push({ t: t / 1e6, mode })
    }
  }
  modes.sort((left, right) => left.t - right.t)

  let source: HoverThrottleResult['source']
  const samples: Sample[] = []
  let firmwareLearnedFirst: number | undefined
  let firmwareLearnedLast: number | undefined

  const ctun = log.messagesByType.get('CTUN') ?? []
  for (const message of ctun) {
    const t = num(message, 'TimeUS')
    const throttle = num(message, 'ThO')
    if (t === undefined || throttle === undefined) continue
    source = 'CTUN'
    samples.push({
      t: t / 1e6,
      throttle,
      desiredClimb: num(message, 'DCRt'),
      climb: num(message, 'CRt')
    })
    const learned = num(message, 'ThH')
    if (learned !== undefined) {
      firmwareLearnedFirst ??= learned
      firmwareLearnedLast = learned
    }
  }

  if (samples.length === 0) {
    // CTUN is gated by LOG_BITMASK. RATE.AOut is "percentage of vertical
    // thrust output currently being used" -- the same quantity, and it is what
    // the UAV Log Viewer plots when someone reads a hover throttle by eye.
    for (const message of log.messagesByType.get('RATE') ?? []) {
      const t = num(message, 'TimeUS')
      const throttle = num(message, 'AOut')
      if (t === undefined || throttle === undefined) continue
      source = 'RATE'
      samples.push({ t: t / 1e6, throttle })
    }
    if (samples.length > 0) {
      warnings.push(
        'CTUN is not in this log, so the throttle came from RATE.AOut and the climb-rate gate could not be applied — check the steady windows below look like real hover.'
      )
    }
  }

  samples.sort((left, right) => left.t - right.t)

  if (samples.length === 0) {
    warnings.push(
      'No throttle data (CTUN or RATE) in this log. Enable the CTUN log bit (LOG_BITMASK) and fly again.'
    )
    return {
      windows: [],
      totalHoverS: 0,
      totalSamples: 0,
      firmwareLearnerIdle: false,
      hoverModes: [],
      blindHoverModes: [],
      belowParameterFloor: false,
      warnings
    }
  }

  // A sample is hover-eligible on the firmware's own terms.
  const eligible = samples.filter(
    (sample) =>
      sample.throttle >= MIN_THROTTLE &&
      (sample.desiredClimb === undefined || Math.abs(sample.desiredClimb) <= MAX_DESIRED_CLIMB_MS) &&
      (sample.climb === undefined || Math.abs(sample.climb) <= MAX_CLIMB_MS)
  )

  // Group into windows: contiguous in time, and steady in throttle. A window
  // breaks when the throttle leaves the band around its own mean, so a slow
  // drift cannot be averaged into a number that was never flown.
  const windows: HoverThrottleWindow[] = []
  const windowSamples: Sample[][] = []
  let current: Sample[] = []

  const flush = (): void => {
    if (current.length < MIN_WINDOW_SAMPLES) {
      current = []
      return
    }
    const startS = current[0]!.t
    const endS = current[current.length - 1]!.t
    const durationS = endS - startS
    if (durationS < MIN_WINDOW_S) {
      current = []
      return
    }
    const mean = current.reduce((total, sample) => total + sample.throttle, 0) / current.length
    windows.push({ startS, endS, durationS, samples: current.length, throttle: mean })
    windowSamples.push(current)
    current = []
  }

  for (const sample of eligible) {
    if (current.length === 0) {
      current = [sample]
      continue
    }
    const previous = current[current.length - 1]!
    const mean = current.reduce((total, entry) => total + entry.throttle, 0) / current.length
    if (sample.t - previous.t > MAX_SAMPLE_GAP_S || Math.abs(sample.throttle - mean) > THROTTLE_BAND) {
      flush()
      current = [sample]
      continue
    }
    current.push(sample)
  }
  flush()

  const allWindowSamples = windowSamples.flat()
  const totalSamples = allWindowSamples.length
  const totalHoverS = windows.reduce((total, window) => total + window.durationS, 0)

  let hoverThrottle: number | undefined
  let standardDeviation: number | undefined
  if (totalSamples > 0) {
    hoverThrottle = allWindowSamples.reduce((total, sample) => total + sample.throttle, 0) / totalSamples
    const variance =
      allWindowSamples.reduce((total, sample) => total + (sample.throttle - hoverThrottle!) ** 2, 0) / totalSamples
    standardDeviation = Math.sqrt(variance)
  } else {
    warnings.push(
      'No steady hover found in this log. It needs a few seconds of level hover with the throttle stick centred — a climb or descent is gated out, by the same rule the firmware uses.'
    )
  }

  const hoverModeNumbers = new Set<number>()
  for (const window of windows) {
    const mode = modeAt(modes, (window.startS + window.endS) / 2)
    if (mode !== undefined) {
      hoverModeNumbers.add(mode)
    }
  }
  const hoverModes = [...hoverModeNumbers].map((mode) => MODE_NAMES.get(mode) ?? `Mode ${mode}`)
  const blindHoverModes = [...hoverModeNumbers]
    .filter((mode) => BLIND_MODE_NUMBERS.has(mode))
    .map((mode) => BLIND_MODE_NUMBERS.get(mode)!)

  const firmwareLearnerIdle =
    firmwareLearnedFirst !== undefined &&
    firmwareLearnedLast !== undefined &&
    Math.abs(firmwareLearnedLast - firmwareLearnedFirst) < 1e-6

  if (firmwareLearnerIdle && blindHoverModes.length > 0) {
    warnings.push(
      `The firmware's own hover learning never moved, and the hover was flown in ${blindHoverModes.join(' / ')} — that mode learns no hover throttle at all.`
    )
  } else if (firmwareLearnerIdle && totalSamples > 0) {
    warnings.push(
      "The firmware's own hover learning never moved during this flight, so MOT_HOVER_LEARN may be off, or a gate (climb demand, attitude, vertical-velocity estimate) stayed closed."
    )
  }

  const belowParameterFloor = hoverThrottle !== undefined && hoverThrottle <= THST_HOVER_MIN
  if (belowParameterFloor) {
    warnings.push(
      `This aircraft hovers at or below ${THST_HOVER_MIN}, the lowest value MOT_THST_HOVER can hold (AP_MOTORS_THST_HOVER_MIN). The parameter will clamp, so it records a floor rather than the real hover throttle.`
    )
  }

  return {
    hoverThrottle,
    standardDeviation,
    windows,
    totalHoverS,
    totalSamples,
    source,
    firmwareLearnedFirst,
    firmwareLearnedLast,
    firmwareLearnerIdle,
    hoverModes,
    blindHoverModes,
    belowParameterFloor,
    warnings
  }
}

/** Convenience wrapper: parse a raw .bin and measure its hover throttle. */
export function analyzeHoverThrottleBuffer(input: ArrayBuffer | Uint8Array): HoverThrottleResult {
  return analyzeHoverThrottleLog(parseDataflashLog(input))
}
