// Are the vertical accel gains right for how hard this quad has to work to hover?
//
// ArduPilot's own rule (copter initial-tuning-flight.rst, "Test AltHold", and
// the PSC_D_ACC_* descriptions): once the hover throttle is known, set the
// vertical accel P to 0.1 x MOT_THST_HOVER and I to 0.2 x (4.7 names); on 4.6
// the old PSC_ACCZ_* are ten times that (P = hover, I = 2 x hover).
//
// The rule exists because the same gain does more on a quad that hovers at low
// throttle: each bit of throttle is more thrust. A quad that hovers at 0.05
// with gains set for 0.35 runs its altitude loop several times too hot, and
// bounces — the field case this readout was built from.

/** AP_MOTORS_THST_HOVER_MIN: the parameter cannot go lower. */
export const THST_HOVER_FLOOR = 0.125

export interface AltHoldGainInput {
  hover: number | undefined
  hoverLearn: number | undefined
  /** PSC_D_ACC_P / I on 4.7; PSC_ACCZ_P / I on 4.6. */
  accP: number | undefined
  accI: number | undefined
  scheme: '4.7' | '4.6'
}

export type AltHoldGainTone = 'success' | 'warning' | 'danger'

export interface AltHoldGainCheck {
  recommendedP: number
  recommendedI: number
  pRatio: number
  iRatio: number
  tone: AltHoldGainTone
  verdict: string
  notes: string[]
}

function ratioVerdict(ratio: number): { tone: AltHoldGainTone; text: string } {
  if (ratio > 3) return { tone: 'danger', text: 'Far too high for this hover throttle. Expect AltHold to bounce.' }
  if (ratio > 1.5) return { tone: 'warning', text: 'High for this hover throttle. AltHold may bounce.' }
  if (ratio < 0.4) return { tone: 'warning', text: 'Low for this hover throttle. AltHold may feel soft.' }
  if (ratio > 1.1 || ratio < 0.9) return { tone: 'success', text: 'Close to the suggested gains for this hover throttle.' }
  return { tone: 'success', text: 'Right for this hover throttle.' }
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000
}

export function altHoldGainCheck(input: AltHoldGainInput): AltHoldGainCheck | undefined {
  const { hover, accP, accI } = input
  if (hover === undefined || accP === undefined || accI === undefined || hover <= 0) return undefined
  const scale = input.scheme === '4.7' ? 0.1 : 1
  const recommendedP = round3(hover * scale)
  const recommendedI = round3(hover * 2 * scale)
  const pRatio = accP / recommendedP
  const iRatio = recommendedI > 0 ? accI / recommendedI : 1
  const worst = Math.max(pRatio, iRatio) > 1 ? Math.max(pRatio, iRatio) : Math.min(pRatio, iRatio)
  const { tone, text } = ratioVerdict(worst)
  const notes: string[] = []
  if (hover <= THST_HOVER_FLOOR + 1e-6) {
    notes.push(
      `Hover throttle is at its minimum (${THST_HOVER_FLOOR}). If the quad hovers lower than that, it is overpowered and needs lower gains still.`
    )
  }
  if (input.hoverLearn === 0) {
    notes.push('Hover learning is off.')
  }
  if (iRatio > 2 * pRatio && iRatio > 1.5) {
    notes.push('I is usually 2 × P.')
  }
  return {
    recommendedP,
    recommendedI,
    pRatio,
    iRatio,
    tone,
    verdict: text,
    notes
  }
}
