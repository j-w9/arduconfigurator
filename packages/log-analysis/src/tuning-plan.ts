// Tuning plan / step sequencer — an ordered list of tuning steps that gate
// on each other, derived from a flight log's PID analysis and parameters.
// Each step says what to do now, what to verify, and what parameter changes
// to make. The first blocking "now" step is the action; later blocking steps
// wait until it clears.
//
// Ported from the SFD Tuning Tool's `A.plan()`, adapted to consume this
// repo's typed PidAnalysisResult + filter review data.

import type { ParsedDataflashLog, DataflashMessage } from './dataflash-parser.js'
import { parseDataflashLog } from './dataflash-parser.js'
import { paramsFromLog } from './notch-tuning-analysis.js'
import { analyzePid, type PidAnalysisResult } from './pid-analysis.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type StepStatus = 'done' | 'now' | 'next' | 'blocked'

export interface ParamChange {
  param: string
  from: number | null
  to: number
  note: string
}

export interface TuningStep {
  id: string
  title: string
  status: StepStatus
  summary: string
  why: string[]
  changes: ParamChange[]
  fly: string
  verify: string
  /** True if this step must clear before later steps can proceed. */
  blocking: boolean
  /** True when status is 'now' but not blocking — do alongside the current step. */
  alongside?: boolean
}

export interface TuningPlanResult {
  steps: TuningStep[]
  /** The id of the current blocking step, or null if everything is done. */
  currentStepId: string | null
  /** Parameter file lines for all 'now' steps with changes. */
  paramLines: string[]
  /** The PID analysis feeding this plan. */
  pidAnalysis: PidAnalysisResult
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function num(msg: DataflashMessage, field: string): number | undefined {
  const v = msg[field]
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

function sig(v: number, digits: number): number {
  if (v === 0) return 0
  const d = Math.ceil(Math.log10(Math.abs(v)))
  const factor = Math.pow(10, digits - d)
  return Math.round(v * factor) / factor
}

function p(params: Map<string, number>, name: string, fallback = 0): number {
  return params.get(name) ?? fallback
}

function makeStep(id: string, title: string, blocking: boolean): TuningStep {
  return { id, title, status: 'done', summary: '', why: [], changes: [], fly: '', verify: '', blocking }
}

function chg(step: TuningStep, params: Map<string, number>, param: string, to: number, note: string): void {
  const from = params.has(param) ? params.get(param)! : null
  if (from !== null && Math.abs(from - to) < 1e-9) return
  for (const c of step.changes) {
    if (c.param === param) { c.to = to; return }
  }
  step.changes.push({ param, from, to, note })
}

// ---------------------------------------------------------------------------
// Plan builder
// ---------------------------------------------------------------------------

export function buildTuningPlan(log: ParsedDataflashLog): TuningPlanResult {
  const params = paramsFromLog(log)
  const pidResult = analyzePid(log)
  const steps: TuningStep[] = []

  // Detect log rate from RATE messages
  const rateMessages = log.messagesByType.get('RATE')
  let rateHz = 0
  if (rateMessages && rateMessages.length >= 2) {
    const t0 = num(rateMessages[0], 'TimeUS')
    const t1 = num(rateMessages[rateMessages.length - 1], 'TimeUS')
    if (t0 !== undefined && t1 !== undefined && t1 > t0) {
      rateHz = (rateMessages.length - 1) / ((t1 - t0) / 1e6)
    }
  }
  const fast = rateHz >= 100
  const logBitmask = p(params, 'LOG_BITMASK', 0) | 0
  const pidLogged = !!(logBitmask & (1 << 12))

  // -----------------------------------------------------------------------
  // 1. Logging
  // -----------------------------------------------------------------------
  const lg = makeStep('logging', 'Logging', false)
  if (!fast || !pidLogged) {
    lg.status = 'now'
    if (!fast) lg.why.push(`RATE logged at ${rateHz.toFixed(0)} Hz — need loop rate (ATTITUDE_FAST).`)
    if (!pidLogged) lg.why.push('PID messages (PIDR/PIDP/PIDY) not logged.')
    chg(lg, params, 'LOG_BITMASK', logBitmask | 1 | (1 << 12), 'ATTITUDE_FAST (bit 0) + PID (bit 12)')
  }
  const hasBatchData = (log.messagesByType.get('ISBH')?.length ?? 0) > 0
  if (!hasBatchData) {
    if (lg.status === 'done') lg.status = 'now'
    lg.why.push('No pre/post-filter gyro data for noise measurement.')
    if (!(p(params, 'INS_LOG_BAT_MASK') | 0)) chg(lg, params, 'INS_LOG_BAT_MASK', 1, 'batch-sample IMU 1')
    chg(lg, params, 'INS_LOG_BAT_OPT', 4, 'pre- and post-filter')
  }
  lg.summary = lg.status === 'done'
    ? 'Loop-rate PID + gyro batch samples present.'
    : 'Enable the logging below. No flight change.'
  lg.verify = 'RATE/PID/ANG at 400 Hz+.'
  lg.fly = 'No flight change — only records more data.'
  steps.push(lg)

  // -----------------------------------------------------------------------
  // 2. Power and hover basics
  // -----------------------------------------------------------------------
  const pw = makeStep('power', 'Battery compensation', false)
  const vmax = p(params, 'MOT_BAT_VOLT_MAX')
  const vmin = p(params, 'MOT_BAT_VOLT_MIN')
  if (!vmax || !vmin) {
    // Try to detect cell count from BAT voltage
    const bat = log.messagesByType.get('BAT')
    let cells = 0
    if (bat && bat.length > 0) {
      let maxV = 0
      for (const m of bat) {
        const v = num(m, 'Volt')
        if (v !== undefined && v > 3 && v > maxV) maxV = v
      }
      cells = Math.round(maxV / 4.15)
    }
    pw.status = 'now'
    pw.why.push('MOT_BAT_VOLT_MAX/MIN not set — gains drop as battery sags.')
    if (cells >= 1) {
      chg(pw, params, 'MOT_BAT_VOLT_MAX', sig(4.2 * cells, 4), `${cells}S at 4.2 V/cell`)
      chg(pw, params, 'MOT_BAT_VOLT_MIN', sig(3.3 * cells, 4), `${cells}S at 3.3 V/cell`)
    }
  }
  // Hover throttle from CTUN
  const ctun = log.messagesByType.get('CTUN')
  let hoverThrottle: number | null = null
  if (ctun && ctun.length > 0) {
    const thhs: number[] = []
    for (const m of ctun) {
      const thh = num(m, 'ThH')
      const alt = num(m, 'Alt')
      if (thh !== undefined && alt !== undefined && alt > 1) thhs.push(thh)
    }
    if (thhs.length > 10) {
      thhs.sort((a, b) => a - b)
      hoverThrottle = thhs[Math.floor(thhs.length / 2)]
      if (hoverThrottle < 0.15) pw.why.push(`Hover throttle ${hoverThrottle.toFixed(2)} — lots of spare thrust, gains will be low.`)
      if (hoverThrottle > 0.6) {
        pw.status = 'now'
        pw.why.push(`Hover throttle ${hoverThrottle.toFixed(2)} — little headroom. Reduce weight or add thrust.`)
      }
    }
  }
  pw.summary = pw.status === 'done'
    ? 'Voltage compensation set.'
    : 'Set voltage compensation before tuning gains.'
  pw.verify = 'MOT_THST_HOVER within 10% of hover throttle.'
  pw.fly = 'Hover 60 s.'
  steps.push(pw)

  // -----------------------------------------------------------------------
  // 3. Vibration
  // -----------------------------------------------------------------------
  const vb = makeStep('vibe', 'Vibration', true)
  const vibeMessages = log.messagesByType.get('VIBE')
  if (vibeMessages && vibeMessages.length > 0) {
    let maxVibe = 0, worstAxis = 'X', clipCount = 0
    for (const m of vibeMessages) {
      for (const ax of ['VibeX', 'VibeY', 'VibeZ'] as const) {
        const v = num(m, ax)
        if (v !== undefined && v > maxVibe) { maxVibe = v; worstAxis = ax.slice(4) }
      }
      const c0 = num(m, 'Clip0') ?? num(m, 'Clip') ?? 0
      if (c0 > 0) clipCount++
    }
    const p95 = maxVibe * 0.95 // approximate
    if (p95 > 30) {
      vb.status = 'now'
      vb.why.push(`VIBE p95 ${p95.toFixed(1)} m/s² on ${worstAxis}. Target: under 30.`)
      vb.summary = 'Fix mechanical cause before tuning.'
      vb.fly = 'Check props, bearings, FC mount. Hover 60 s.'
    } else if (clipCount > 0) {
      vb.status = 'now'
      vb.blocking = false
      vb.why.push(`Vibration OK (${p95.toFixed(1)} m/s²) but ${clipCount} clip events.`)
      vb.summary = 'Check clip times. Not blocking.'
    } else {
      vb.summary = `VIBE ${p95.toFixed(1)} m/s², no clipping.`
    }
  } else {
    vb.status = 'blocked'
    vb.summary = 'No VIBE data in this log.'
  }
  vb.verify = 'VIBE p95 under 30 m/s², no clipping.'
  vb.fly = 'Check props, bearings, FC mount. Hover 60 s.'
  steps.push(vb)

  // -----------------------------------------------------------------------
  // 4. Harmonic notch
  // -----------------------------------------------------------------------
  const nt = makeStep('notch', 'Harmonic notch', true)
  const hntchEnable = !!p(params, 'INS_HNTCH_ENABLE')
  if (!hasBatchData) {
    nt.status = 'blocked'
    nt.summary = 'Needs pre-filter gyro data (see Logging).'
  } else if (!hntchEnable) {
    nt.status = 'now'
    nt.why.push('No harmonic notch enabled.')
    chg(nt, params, 'INS_HNTCH_ENABLE', 1, 'enable, then reboot')
    const esc = log.messagesByType.get('ESC')
    if (esc && esc.length > 50) {
      chg(nt, params, 'INS_HNTCH_MODE', 3, 'ESC telemetry tracking')
      chg(nt, params, 'INS_HNTCH_OPTS', (p(params, 'INS_HNTCH_OPTS') | 0) | 2, 'multi-source')
      chg(nt, params, 'INS_HNTCH_HMNCS', 3, '1st + 2nd harmonics')
    } else {
      chg(nt, params, 'INS_HNTCH_MODE', 1, 'throttle-based')
      if (hoverThrottle) chg(nt, params, 'INS_HNTCH_REF', sig(hoverThrottle, 3), 'hover throttle')
    }
    nt.summary = 'Enable the notch, then re-fly and re-analyze.'
  } else {
    nt.summary = 'Harmonic notch enabled.'
  }
  nt.fly = 'Hover 60 s with gentle stick movements.'
  nt.verify = '20+ dB broadband reduction in Filter Review.'
  steps.push(nt)

  // -----------------------------------------------------------------------
  // 5. D-term noise and rate filters
  // -----------------------------------------------------------------------
  const dn = makeStep('dnoise', 'D-term noise', true)
  const gyroFilter = p(params, 'INS_GYRO_FILTER')
  let dnChecked = false
  let dnBlocking = false

  for (const name of ['Roll', 'Pitch'] as const) {
    const axCode = name === 'Roll' ? 'RLL' : 'PIT'
    const prefix = `ATC_RAT_${axCode}_`
    const fltd = p(params, `${prefix}FLTD`)
    const dGain = p(params, `${prefix}D`)

    if (gyroFilter > 0 && fltd > gyroFilter) {
      dn.status = 'now'
      dn.why.push(`${name}: FLTD ${fltd} Hz above gyro filter ${gyroFilter} Hz — no effect.`)
      chg(dn, params, `${prefix}FLTD`, Math.round(gyroFilter / 2), 'half of INS_GYRO_FILTER')
    }

    // Use the PID analysis D-term noise result
    const axisAnalysis = pidResult.axes.find(a => a.axis === name)
    const dNoise = axisAnalysis?.dTermNoise
    if (dNoise && dGain > 0) {
      dnChecked = true
      if (dNoise.noiseFraction >= 0.003) {
        dn.status = 'now'
        if (dNoise.noiseFraction >= 0.008) dnBlocking = true
        const where = dNoise.narrowPeak
          ? `peak ${dNoise.noiseFreqHz.toFixed(0)} Hz`
          : `broadband, peak ${dNoise.noiseFreqHz.toFixed(0)} Hz`
        dn.why.push(`${name}: D noise ${dNoise.noisePercent.toFixed(2)}% (${where}). Target: under 0.3%.`)

        // Suggest lowering FLTD
        if (fltd > 0) {
          const floor = Math.max(10, gyroFilter > 0 ? gyroFilter / 4 : 10)
          const newFltd = Math.max(Math.round(floor), Math.round(fltd * 0.7))
          if (newFltd < fltd) chg(dn, params, `${prefix}FLTD`, newFltd, `lower FLTD to reduce D noise`)
        }
        if (dNoise.noiseFraction >= 0.008) {
          chg(dn, params, `${prefix}D`, sig(dGain * 0.8, 3), '-20%: high D noise')
        }
      }
    }
  }

  if (!dnChecked && !fast) {
    if (dn.status === 'done') dn.status = 'blocked'
    dn.summary = 'Needs loop-rate PID logging (see Logging).'
  } else if (dn.status === 'done') {
    dn.summary = 'D noise under 0.3% on roll and pitch.'
  } else {
    dn.summary = 'Reduce D noise before tuning gains.'
  }
  dn.blocking = dnBlocking
  dn.fly = 'Hover 60 s. Motors should be warm, not hot.'
  dn.verify = 'D noise under 0.3%.'
  steps.push(dn)

  // -----------------------------------------------------------------------
  // 6. Roll and pitch rate gains
  // -----------------------------------------------------------------------
  const rp = makeStep('rp', 'Roll and pitch gains', true)
  if (!fast) {
    rp.status = 'blocked'
    rp.summary = 'Needs loop-rate logging (see Logging).'
  } else {
    let needsInput = false
    for (const name of ['Roll', 'Pitch'] as const) {
      const axCode = name === 'Roll' ? 'RLL' : 'PIT'
      const prefix = `ATC_RAT_${axCode}_`
      const axisAnalysis = pidResult.axes.find(a => a.axis === name)
      const ot = axisAnalysis?.overtune
      const rt = axisAnalysis?.rateTracking

      if (!rt || rt.windowCount < 5) {
        needsInput = true
        continue
      }

      if (ot) {
        const pGain = p(params, `${prefix}P`)
        const dGain = p(params, `${prefix}D`)

        if (ot.medianRatio > 1.3) {
          rp.status = 'now'
          if (ot.oscillationFreqHz !== null && ot.oscillationFreqHz >= 10) {
            rp.why.push(`${name}: ratio ${ot.medianRatio.toFixed(2)}, osc ${ot.oscillationFreqHz.toFixed(0)} Hz — reduce D.`)
            chg(rp, params, `${prefix}D`, sig(dGain * 0.75, 3), '-25%')
          } else {
            rp.why.push(`${name}: ratio ${ot.medianRatio.toFixed(2)}, slow oscillation — reduce P.`)
            chg(rp, params, `${prefix}P`, sig(pGain * 0.75, 3), '-25%')
            chg(rp, params, `${prefix}I`, sig(pGain * 0.75, 3), 'keep I = P')
          }
        } else if (ot.medianRatio > 1.15) {
          rp.status = 'now'
          rp.why.push(`${name}: mild overshoot (${ot.medianRatio.toFixed(2)}, p90 ${ot.p90Ratio.toFixed(2)}).`)
          const pvsD = axisAnalysis?.pvsD
          if (pvsD && pvsD.dpRatio < 0.3 && axisAnalysis?.dTermNoise?.noiseFraction !== undefined && axisAnalysis.dTermNoise.noiseFraction < 0.003) {
            chg(rp, params, `${prefix}D`, sig(dGain * 1.15, 3), '+15%: D is low and noise allows it')
          } else {
            chg(rp, params, `${prefix}P`, sig(pGain * 0.9, 3), '-10%')
            chg(rp, params, `${prefix}I`, sig(pGain * 0.9, 3), 'keep I = P')
          }
        } else if (ot.medianRatio < 0.8) {
          rp.status = 'now'
          rp.why.push(`${name}: under-tuned (${ot.medianRatio.toFixed(2)}).`)
          chg(rp, params, `${prefix}P`, sig(pGain * 1.15, 3), '+15%')
          chg(rp, params, `${prefix}I`, sig(pGain * 1.15, 3), 'keep I = P')
        } else {
          rp.why.push(`${name}: ratio ${ot.medianRatio.toFixed(2)} — good.`)
        }
      }
    }

    if (needsInput && rp.status === 'done') {
      rp.status = 'now'
      rp.summary = 'Not enough stick inputs. Fly sharp roll/pitch or run AUTOTUNE.'
      rp.why.push('Need 5+ manoeuvre windows per axis.')
    } else {
      rp.summary = rp.status === 'done'
        ? 'Roll and pitch track targets without overshoot.'
        : 'Apply the changes, re-fly the same inputs, compare.'
    }
  }
  rp.fly = 'AltHold 5 m+. 6 sharp rolls (full stick 0.3 s, centre, 2 s apart), then pitch.'
  rp.verify = 'Overtune ratio 0.9–1.15 on both axes.'
  steps.push(rp)

  // -----------------------------------------------------------------------
  // 7. Yaw
  // -----------------------------------------------------------------------
  const yw = makeStep('yaw', 'Yaw', true)
  const yawAnalysis = pidResult.axes.find(a => a.axis === 'Yaw')
  const yawOt = yawAnalysis?.overtune
  if (!fast) {
    yw.status = 'blocked'
    yw.summary = 'Needs loop-rate logging.'
  } else if (!yawOt || yawOt.windowRatios.length < 5) {
    yw.status = 'next'
    yw.summary = 'Not enough yaw input. AUTOTUNE covers yaw, or fly sharp yaw inputs.'
  } else {
    const yP = p(params, 'ATC_RAT_YAW_P')
    if (yawOt.medianRatio < 0.7) {
      yw.status = 'now'
      yw.why.push(`Yaw reaches ${(yawOt.medianRatio * 100).toFixed(0)}% of target.`)
      chg(yw, params, 'ATC_RAT_YAW_P', sig(yP * 1.2, 3), '+20%')
      chg(yw, params, 'ATC_RAT_YAW_I', sig(yP * 0.12, 3), 'I = P/10')
    } else if (yawOt.medianRatio > 1.3) {
      yw.status = 'now'
      yw.why.push(`Yaw overshoot ratio ${yawOt.medianRatio.toFixed(2)}.`)
      chg(yw, params, 'ATC_RAT_YAW_P', sig(yP * 0.8, 3), '-20%')
      chg(yw, params, 'ATC_RAT_YAW_I', sig(yP * 0.08, 3), 'I = P/10')
    }
    yw.summary = yw.status === 'done'
      ? `Yaw response ratio ${yawOt.medianRatio.toFixed(2)}.`
      : 'Adjust yaw as below.'
  }
  yw.verify = 'Yaw ratio 0.8–1.2.'
  yw.fly = 'Sharp yaw inputs in AltHold.'
  steps.push(yw)

  // -----------------------------------------------------------------------
  // 8. Finishing: slew limiter and feel
  // -----------------------------------------------------------------------
  const fin = makeStep('finish', 'Slew limiter and feel', false)
  fin.status = 'next'
  for (const c of ['RLL', 'PIT']) {
    if (!p(params, `ATC_RAT_${c}_SMAX`)) {
      chg(fin, params, `ATC_RAT_${c}_SMAX`, 50, 'oscillation safety net')
    }
  }
  fin.summary = 'Once gains are good: slew limiter + stick feel.'
  fin.why.push('ATC_INPUT_TC: 0.15 smooth, 0.1 sporty, 0.05 direct.')
  fin.verify = 'Dmod stays at 1.00.'
  fin.fly = 'Fly normally, check the feel.'
  steps.push(fin)

  // -----------------------------------------------------------------------
  // Resolve step ordering: first blocking 'now' is the action
  // -----------------------------------------------------------------------
  let foundBlocking = false
  for (const st of steps) {
    if (st.status === 'now' && st.blocking) {
      if (foundBlocking) st.status = 'next'
      foundBlocking = true
    }
  }

  // Build param lines
  const paramLines: string[] = []
  for (const st of steps) {
    if (st.status !== 'now' || st.changes.length === 0) continue
    paramLines.push(`# ${st.title}`)
    for (const c of st.changes) paramLines.push(`${c.param},${c.to}`)
  }

  // Mark alongside steps
  const currentStep = steps.find(st => st.status === 'now' && st.blocking) ?? null
  for (const st of steps) {
    st.alongside = st.status === 'now' && !st.blocking
  }

  return {
    steps,
    currentStepId: currentStep?.id ?? null,
    paramLines,
    pidAnalysis: pidResult
  }
}

export function buildTuningPlanBuffer(buffer: ArrayBuffer): TuningPlanResult {
  return buildTuningPlan(parseDataflashLog(buffer))
}
