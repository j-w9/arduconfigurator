// Shared value/environment types for the expression evaluator and functions.

/** A decoded message: DataFlash record or MAVLink message, keyed by field name. */
export type MessageRecord = Readonly<Record<string, unknown>>

/** A 3-vector, as returned by mavextra's vector functions (`expected_mag(..).x`). */
export interface Vec3 {
  readonly x: number
  readonly y: number
  readonly z: number
}

/**
 * Anything an expression can produce. Booleans are 1/0 numbers; `undefined`
 * is Python's None / a failed evaluation — the point is skipped.
 */
export type Value = number | string | Vec3 | MessageRecord | readonly unknown[] | undefined

/** What an expression reads from when it is evaluated. */
export interface EvalEnv {
  /** Latest record of a message type (of one instance when `instance` is given). */
  message(name: string, instance?: number): MessageRecord | undefined
  /** Timestamp (seconds) of that latest record — backs the `MSG._timestamp` field. */
  timestamp?(name: string, instance?: number): number | undefined
  /** Vehicle parameter lookup (altitude() needs GND_ABS_PRESS, mag_heading() COMPASS_DEC). */
  param?(name: string): number | undefined
  /** Per-term state for stateful functions (lowpass, diff, delta, ...). */
  state?: Map<string, unknown>
  /** Time of the message being processed, seconds (delta() without a time argument). */
  time?: number
}
