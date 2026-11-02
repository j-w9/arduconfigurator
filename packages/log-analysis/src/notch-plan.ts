// What a hover log says about where the harmonic notch belongs.
//
// ESC telemetry present: the motor fundamental over the STEADY-HOVER windows
// (not the whole log, whose minimum includes idle and spin-up) is the hover
// frequency the ESC-telemetry notch page asks for. No telemetry: the strongest
// gyro peak in the air is the hover_freq the throttle-based notch page asks
// for, and the measured hover throttle is its reference.

import type { DataflashMessage, ParsedDataflashLog } from './dataflash-parser.js'
import { parseDataflashLog } from './dataflash-parser.js'
import { analyzeHoverThrottleLog } from './hover-throttle-analysis.js'
import { analyzeLogTuning } from './notch-tuning-analysis.js'

export interface NotchPlanFromLog {
  /** ESC RPM records were in the log. */
  escTelemetry: boolean
  /** Mean motor frequency (Hz) over the steady-hover windows, from ESC RPM. */
  hoverFundamentalHz?: number
  /** Strongest gyro peak in the air (Hz) and which axis carried it. */
  gyroPeakHz?: number
  gyroPeakAxis?: string
  /** Measured hover throttle (0..1) over the steady-hover windows. */
  hoverThrottle?: number
  /** Seconds of steady hover the figures are read from. */
  hoverSeconds: number
  /** Why a figure is missing, in operator words. */
  notes: string[]
}

function num(message: DataflashMessage, field: string): number | undefined {
  const value = message[field]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export function planNotchFromLog(log: ParsedDataflashLog): NotchPlanFromLog {
  const notes: string[] = []
  const hover = analyzeHoverThrottleLog(log)
  const windows = hover.windows
  const hoverSeconds = hover.totalHoverS
  if (windows.length === 0) {
    notes.push('No steady hover in this log: hold a hover of 30 s or more with the sticks still.')
  }

  const esc = log.messagesByType.get('ESC') ?? []
  let hoverFundamentalHz: number | undefined
  if (esc.length > 0 && windows.length > 0) {
    const rpms: number[] = []
    for (const message of esc) {
      const t = num(message, 'TimeUS')
      const rpm = num(message, 'RPM')
      if (t === undefined || rpm === undefined || rpm <= 100) continue
      const seconds = t / 1e6
      if (windows.some((window) => seconds >= window.startS && seconds <= window.endS)) rpms.push(rpm)
    }
    if (rpms.length > 0) {
      hoverFundamentalHz = rpms.reduce((sum, value) => sum + value, 0) / rpms.length / 60
    } else {
      notes.push('ESC telemetry is in the log but none of it falls inside the steady hover.')
    }
  }

  let gyroPeakHz: number | undefined
  let gyroPeakAxis: string | undefined
  try {
    const tuning = analyzeLogTuning(log)
    let best: { freqHz: number; power: number; axis: string } | undefined
    for (const spectrum of tuning.axisSpectra) {
      if (spectrum.dominant && (!best || spectrum.dominant.power > best.power)) {
        best = { freqHz: spectrum.dominant.freqHz, power: spectrum.dominant.power, axis: spectrum.axis }
      }
    }
    if (best) {
      gyroPeakHz = best.freqHz
      gyroPeakAxis = best.axis
    } else if (tuning.gyroSource === 'none') {
      notes.push('No gyro samples in the log. Turn on Logs ▸ Logging for tuning and fly the hover again.')
    }
  } catch {
    notes.push('The gyro spectrum could not be read from this log.')
  }

  return {
    escTelemetry: esc.length > 0,
    hoverFundamentalHz,
    gyroPeakHz,
    gyroPeakAxis,
    hoverThrottle: hover.hoverThrottle,
    hoverSeconds,
    notes
  }
}

export function planNotchFromBuffer(input: ArrayBuffer | Uint8Array): NotchPlanFromLog {
  return planNotchFromLog(parseDataflashLog(input))
}
