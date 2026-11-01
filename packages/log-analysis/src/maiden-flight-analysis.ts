// The maiden hover, read from its log.
//
// ArduPilot's first-flight page (initial-tuning-flight.rst) asks for a short,
// specific flight: Stabilize; arm, disarm, arm; creep the throttle; lift a
// hand's width and set down; then a short hover with small inputs; land on any
// oscillation. The guided setup's Maiden Hover step reads the log of that
// flight and answers the questions the page asks the pilot to answer by eye.
// Nothing here writes a parameter.

import type { DataflashMessage, ParsedDataflashLog } from './dataflash-parser.js'
import { parseDataflashLog } from './dataflash-parser.js'
import { airborneWindow, analyzeLogTuning, type LogTuningResult } from './notch-tuning-analysis.js'

const EV_ARMED = 10
const EV_DISARMED = 11
/** ArduCopter mode numbers the first flight is judged against. */
const MODE_NAMES: Record<number, string> = {
  0: 'Stabilize',
  1: 'Acro',
  2: 'AltHold',
  3: 'Auto',
  4: 'Guided',
  5: 'Loiter',
  6: 'RTL',
  9: 'Land',
  16: 'PosHold',
  17: 'Brake',
  18: 'Throw',
  21: 'Smart RTL',
  25: 'SystemID',
  28: 'Turtle'
}
export const STABILIZE_MODE = 0
/** A hover worth judging; shorter airtime is a hop. */
export const MAIDEN_MIN_AIRBORNE_S = 8
/** Firmware messages that mean the airframe, not the pilot, has a problem. */
const WARNING_TEXT = /thrust loss|yaw imbalance|crash|vibration compensation|ekf variance|failsafe/i

export interface MaidenFlightResult {
  /** The log carried at least one armed segment. */
  hasFlight: boolean
  /** Mode in force when the motors first armed, and its name. */
  firstArmedMode?: number
  firstArmedModeName?: string
  /** Armed segments in the log (EV armed → disarmed pairs; an open one counts). */
  armCycles: number
  /** An arm → disarm with no airtime came before the flying arm: the rehearsal
   *  the first-flight page asks for. */
  rehearsedArmDisarm: boolean
  /** Airborne window (s since boot), from CTUN altitude. */
  airborne?: { startS: number; endS: number }
  airborneSeconds: number
  /** Rate-loop oscillation seen in the gyro spectrum (from the tuning analysis). */
  limitCycle?: LogTuningResult['limitCycle']
  /** In-air vibration and clipping (from the tuning analysis). */
  vibe?: LogTuningResult['vibe']
  /** Firmware messages that name an airframe problem, in log order, deduplicated. */
  warningTexts: string[]
  /** One line per thing to act on, in operator words; empty when the flight was clean. */
  findings: string[]
  verdict: 'clean' | 'review' | 'no-flight'
}

function num(message: DataflashMessage, field: string): number | undefined {
  const value = message[field]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function text(message: DataflashMessage, field: string): string | undefined {
  const value = message[field]
  return typeof value === 'string' ? value : undefined
}

export function analyzeMaidenFlightLog(log: ParsedDataflashLog): MaidenFlightResult {
  const modes: { t: number; mode: number }[] = []
  for (const message of log.messagesByType.get('MODE') ?? []) {
    const t = num(message, 'TimeUS')
    const mode = num(message, 'ModeNum') ?? num(message, 'Mode')
    if (t !== undefined && mode !== undefined) modes.push({ t: t / 1e6, mode })
  }
  modes.sort((left, right) => left.t - right.t)
  const modeAt = (t: number): number | undefined => {
    let current: number | undefined
    for (const entry of modes) {
      if (entry.t <= t) current = entry.mode
      else break
    }
    // A MODE record logged a moment after the arm event still describes the
    // mode the vehicle armed in; fall back to the first one.
    return current ?? modes[0]?.mode
  }

  const segments: { startS: number; endS?: number }[] = []
  let armedAt: number | undefined
  for (const event of log.messagesByType.get('EV') ?? []) {
    const t = num(event, 'TimeUS')
    const id = num(event, 'Id')
    if (t === undefined || id === undefined) continue
    if (id === EV_ARMED && armedAt === undefined) armedAt = t / 1e6
    if (id === EV_DISARMED && armedAt !== undefined) {
      segments.push({ startS: armedAt, endS: t / 1e6 })
      armedAt = undefined
    }
  }
  if (armedAt !== undefined) segments.push({ startS: armedAt })

  const airborne = airborneWindow(log)
  const airborneSeconds = airborne ? Math.max(0, airborne.endS - airborne.startS) : 0
  const flewIn = (segment: { startS: number; endS?: number }): boolean =>
    airborne !== undefined && airborne.startS < (segment.endS ?? Number.POSITIVE_INFINITY) && airborne.endS > segment.startS
  const flyingSegment = segments.find(flewIn)
  const rehearsedArmDisarm = segments.some(
    (segment) => segment.endS !== undefined && !flewIn(segment) && (flyingSegment === undefined || segment.endS <= flyingSegment.startS)
  )
  const firstArmedMode = segments.length > 0 ? modeAt(segments[0].startS) : undefined

  let tuning: LogTuningResult | undefined
  try {
    tuning = analyzeLogTuning(log)
  } catch {
    tuning = undefined
  }

  const warningTexts: string[] = []
  for (const message of log.messagesByType.get('MSG') ?? []) {
    const body = text(message, 'Message')
    if (body && WARNING_TEXT.test(body) && !warningTexts.includes(body)) warningTexts.push(body)
  }

  const hasFlight = segments.length > 0 || airborne !== undefined
  const findings: string[] = []
  if (!hasFlight) {
    findings.push('Never armed: this log is not a flight.')
  } else {
    if (firstArmedMode !== undefined && firstArmedMode !== STABILIZE_MODE) {
      findings.push(`First armed in ${MODE_NAMES[firstArmedMode] ?? `mode ${firstArmedMode}`}; the first flight belongs in Stabilize.`)
    }
    if (!rehearsedArmDisarm) {
      findings.push('No arm-disarm rehearsal before the flight. Arm, disarm, arm first, so you know the disarm works.')
    }
    if (airborne === undefined) {
      findings.push('Never left the ground.')
    } else if (airborneSeconds < MAIDEN_MIN_AIRBORNE_S) {
      findings.push(`Only ${airborneSeconds.toFixed(0)} s in the air. The next steps need a hover of ${MAIDEN_MIN_AIRBORNE_S} s or more.`)
    }
    if (tuning?.limitCycle) {
      findings.push(
        `A ${tuning.limitCycle.freqHz.toFixed(0)} Hz oscillation on ${tuning.limitCycle.axis}: halve ATC_RAT_RLL/PIT P, I and D and fly again before anything else.`
      )
    }
    if (tuning?.vibe && tuning.vibe.verdict !== 'good') {
      const peak = Math.max(...tuning.vibe.max)
      findings.push(
        tuning.vibe.clip.some((count) => count > 0)
          ? `Accelerometer clipping in the air (${tuning.vibe.clip.join('/')} clips). Fix the mechanics first: props, motors, mounts.`
          : `Vibration peaks at ${peak.toFixed(0)} m/s² in the air (over 30 is marginal): check props, motor bearings and the board mount.`
      )
    }
    for (const warning of warningTexts) findings.push(`The firmware reported "${warning}".`)
  }

  return {
    hasFlight,
    firstArmedMode,
    firstArmedModeName: firstArmedMode === undefined ? undefined : MODE_NAMES[firstArmedMode] ?? `mode ${firstArmedMode}`,
    armCycles: segments.length,
    rehearsedArmDisarm,
    airborne,
    airborneSeconds,
    limitCycle: tuning?.limitCycle,
    vibe: tuning?.vibe,
    warningTexts,
    findings,
    verdict: !hasFlight ? 'no-flight' : findings.length === 0 ? 'clean' : 'review'
  }
}

export function analyzeMaidenFlightBuffer(input: ArrayBuffer | Uint8Array): MaidenFlightResult {
  return analyzeMaidenFlightLog(parseDataflashLog(input))
}
