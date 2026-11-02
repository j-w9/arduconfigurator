// FSTRATE_DIV as the PID loop rate it gives.
//
// ArduCopter runs the fast-rate PID thread at gyro rate ÷ FSTRATE_DIV
// (ArduCopter/rate_thread.cpp), and caps the divisor at gyro rate ÷ main loop
// rate. Nobody thinks in divisors: at a 4 kHz gyro the choice is a 4, 2 or
// 1 kHz PID loop. So the field offers rates, and writes the divisor.

export interface FastRatePidOption {
  value: number
  label: string
  description: string
}

/** INS_GYRO_RATE 0..3 → 1, 2, 4, 8 kHz. */
export function gyroRateHzFromIndex(index: number | undefined): number | undefined {
  if (index === undefined || !Number.isInteger(index) || index < 0 || index > 3) return undefined
  return 1000 * 2 ** index
}

function rateLabel(hz: number): string {
  return hz >= 1000 && hz % 1000 === 0 ? `${hz / 1000} kHz` : `${Math.round(hz)} Hz`
}

/**
 * The PID loop rates the gyro rate allows: whole divisions (÷1, ÷2, ÷4, ÷8)
 * down to 1 kHz, within the firmware's divisor cap. A current divisor outside
 * that list is kept as an option, so the field never hides what is set.
 */
export function fastRatePidOptions(input: {
  gyroRateIndex: number | undefined
  loopRateHz: number | undefined
  currentDivisor: number | undefined
}): FastRatePidOption[] | undefined {
  const gyroHz = gyroRateHzFromIndex(input.gyroRateIndex)
  if (gyroHz === undefined) return undefined
  const loopHz = input.loopRateHz !== undefined && input.loopRateHz > 0 ? input.loopRateHz : 400
  // FSTRATE_DIV's own range is 1..10; the thread clamps it to gyro ÷ loop rate.
  const cap = Math.max(1, Math.min(10, Math.round(gyroHz / loopHz)))
  const divisors = [1, 2, 4, 8].filter((divisor) => divisor <= cap && gyroHz / divisor >= 1000)
  const current = input.currentDivisor
  if (current !== undefined && Number.isInteger(current) && current >= 1 && !divisors.includes(current)) {
    divisors.push(current)
  }
  return divisors
    .sort((a, b) => a - b)
    .map((divisor) => {
      const effective = Math.min(divisor, cap)
      const hz = gyroHz / effective
      return {
        value: divisor,
        label: rateLabel(hz),
        description:
          effective === divisor
            ? `FSTRATE_DIV ${divisor}: ${rateLabel(gyroHz)} gyro ÷ ${divisor}`
            : `FSTRATE_DIV ${divisor}, capped to ${effective} by the ${loopHz} Hz main loop`
      }
    })
}
