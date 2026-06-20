// Param-display number formatter, centralized so every surface follows the
// same noise-suppression policy: ArduPilot ships some params as float32
// whose serialized PARAM_VALUE arrives with a long mantissa tail (e.g.
// 0.0500000007450580596923828125 for what the firmware actually stores as
// 0.05). Anything past ~1e-7 of magnitude is float-encoding noise the
// operator never wants to see.
//
// Policy used by every formatter below:
//   - non-finite values render as the provided fallback (default '—')
//   - exact integers render with zero decimals (`0`, `1500`, `42`)
//   - floats round to `digits` decimal places (default 6) and then strip
//     trailing zeros — so 0.05000000074 → "0.05", 1.5 → "1.5", but
//     0.123456789 → "0.123457" with the default precision
//
// A `unit` suffix is appended with a space if provided (e.g. "0.05 V").

export interface FormatParamNumberOptions {
  /** Maximum decimal places to render before trailing-zero strip.
   *  Default 6 (covers AP's float32 mantissa precision without leaking
   *  the noisy tail past 1e-7). */
  digits?: number
  /** Optional unit appended after a single space ("V", "ms", "°"). */
  unit?: string
  /** What to render when the value is undefined / NaN / Infinity. */
  fallback?: string
}

export function formatParamNumber(value: number | undefined, options: FormatParamNumberOptions = {}): string {
  const { digits = 6, unit, fallback = '—' } = options
  if (value === undefined || !Number.isFinite(value)) {
    return fallback
  }
  let text: string
  if (Number.isInteger(value)) {
    text = value.toFixed(0)
  } else {
    // Round to `digits` then strip trailing zeros + a dangling decimal.
    text = value.toFixed(digits).replace(/\.?0+$/, '')
    // Edge case: very small floats like 1e-9 round to "0" through
    // toFixed(6); we want them to render as "0" too. Nothing to do.
    if (text === '' || text === '-') {
      text = '0'
    }
  }
  return unit ? `${text} ${unit}` : text
}

/**
 * Format a numeric draft input as a STRING for the editor's value
 * attribute. Same rounding policy as `formatParamNumber` but always
 * keeps a leading "0." for sub-unit floats (so the editor doesn't
 * jump cursor positions when the user types past the decimal). No
 * unit, no fallback — pure number rendering.
 */
export function formatParamNumberInput(value: number | undefined, digits = 6): string {
  if (value === undefined || !Number.isFinite(value)) {
    return ''
  }
  if (Number.isInteger(value)) {
    return value.toFixed(0)
  }
  return value.toFixed(digits).replace(/\.?0+$/, '') || '0'
}
