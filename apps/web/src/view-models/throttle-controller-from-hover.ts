// The vertical acceleration controller follows the hover throttle.
//
// ArduPilot's first-flight page ("Test AltHold", initial-tuning-flight.rst)
// sets, once MOT_THST_HOVER has been learned:
//   PSC_D_ACC_P = 0.1 x MOT_THST_HOVER,  PSC_D_ACC_I = 0.2 x MOT_THST_HOVER
// and notes that Copter 4.6 and earlier named them PSC_ACCZ_P / PSC_ACCZ_I at
// ten times the scale (P = hover, I = 2 x hover). AC_PosControl.cpp's @Param
// text says the same ("if upgrading from 4.6 this is _ACCZ_P * 0.1"). A board
// reports one pair or the other; the names decide the scale.

export interface ThrottleControllerGains {
  pParamId: 'PSC_D_ACC_P' | 'PSC_ACCZ_P'
  iParamId: 'PSC_D_ACC_I' | 'PSC_ACCZ_I'
  /** Targets for the hover throttle given. */
  targetP: number
  targetI: number
  /** What the vehicle reports now (undefined when not reported). */
  currentP?: number
  currentI?: number
  /** Both current gains sit within the tolerance of their targets. */
  matches: boolean
}

/** Relative tolerance: the wiki's factors are starting points, not a fit. */
export const THROTTLE_CONTROLLER_TOLERANCE = 0.25

export function deriveThrottleControllerGains(
  hoverThrottle: number,
  readParameter: (paramId: string) => number | undefined
): ThrottleControllerGains | undefined {
  if (!Number.isFinite(hoverThrottle) || hoverThrottle <= 0) {
    return undefined
  }
  const modern = readParameter('PSC_D_ACC_P') !== undefined || readParameter('PSC_D_ACC_I') !== undefined
  const legacy = readParameter('PSC_ACCZ_P') !== undefined || readParameter('PSC_ACCZ_I') !== undefined
  if (!modern && !legacy) {
    return undefined
  }
  const pParamId = modern ? 'PSC_D_ACC_P' : 'PSC_ACCZ_P'
  const iParamId = modern ? 'PSC_D_ACC_I' : 'PSC_ACCZ_I'
  const scale = modern ? 0.1 : 1
  const targetP = round(hoverThrottle * scale, 4)
  const targetI = round(hoverThrottle * 2 * scale, 4)
  const currentP = readParameter(pParamId)
  const currentI = readParameter(iParamId)
  const within = (current: number | undefined, target: number): boolean =>
    current !== undefined && Math.abs(current - target) <= target * THROTTLE_CONTROLLER_TOLERANCE
  return {
    pParamId,
    iParamId,
    targetP,
    targetI,
    currentP,
    currentI,
    matches: within(currentP, targetP) && within(currentI, targetI)
  }
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}
