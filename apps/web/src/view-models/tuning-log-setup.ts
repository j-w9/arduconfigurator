// "Set up for a tuning flight": the parameter set that makes a log carry
// what Log Tuning's FFT needs, as drafts.
//
// The IMU batch sampler (INS_LOG_BAT_*) writes raw gyro samples (ISBH/ISBD)
// that the notch analysis reads; without them it falls back to the lower-rate
// IMU messages. Copter only runs the sampler when LOG_BITMASK's "Raw IMU" bit
// is set (ArduCopter/system.cpp: ins.set_log_raw_bit(MASK_LOG_IMU_RAW), bit
// 19). Pre-filter samples at the loop rate (INS_LOG_BAT_OPT = 0) are what
// notch placement wants: they show the noise the filters have to remove.

export const LOG_BITMASK_RAW_IMU_BIT = 19

export interface TuningLogSetupInput {
  /** INS_LOG_BAT_MASK as the board has it (or as staged). */
  batchMask: number | undefined
  /** INS_LOG_BAT_OPT. */
  batchOptions: number | undefined
  /** LOG_BITMASK. */
  logBitmask: number | undefined
}

export interface TuningLogSetupPlan {
  /** Drafts to stage, keyed by parameter id; empty when the log is already set up. */
  drafts: Record<string, string>
  /** What each draft changes, in words, in the same order. */
  steps: string[]
  /** Any of these need a reboot before the sampler runs. */
  rebootNeeded: boolean
}

export function buildTuningLogSetupPlan(input: TuningLogSetupInput): TuningLogSetupPlan {
  const drafts: Record<string, string> = {}
  const steps: string[] = []
  let rebootNeeded = false
  const mask = input.batchMask ?? 0
  if ((mask & 0x7) === 0) {
    drafts.INS_LOG_BAT_MASK = '1'
    steps.push('batch-log the first IMU')
    rebootNeeded = true
  }
  const options = input.batchOptions ?? 0
  if (options !== 0) {
    drafts.INS_LOG_BAT_OPT = '0'
    steps.push('pre-filter samples at the loop rate')
  }
  const bitmask = input.logBitmask ?? 0
  if (((bitmask >>> LOG_BITMASK_RAW_IMU_BIT) & 1) === 0) {
    drafts.LOG_BITMASK = String(((bitmask | (1 << LOG_BITMASK_RAW_IMU_BIT)) >>> 0))
    steps.push('turn on the Raw IMU log bit')
  }
  return { drafts, steps, rebootNeeded }
}
