import { useCallback, useState, type ReactElement } from 'react'

import {
  buildTuningPlanBuffer,
  type TuningPlanResult,
  type TuningStep,
  type StepStatus,
  type PidAnalysisResult,
  type PidAxisAnalysis,
  type PidFinding,
  type SpectrogramResult,
  type Severity
} from '@arduconfig/log-analysis'
import { StatusBadge, buttonStyle } from '@arduconfig/ui-kit'

import { OnboardLogPicker, type OnboardLogPickerLogs } from '../sections/OnboardLogPicker'

export interface TuningPlanViewProps {
  onStageParam: (param: string, value: number) => void
  stagedParams?: ReadonlySet<string>
  onboardLogs?: OnboardLogPickerLogs
}

function formatParamValue(v: number): string {
  if (Number.isInteger(v)) return String(v)
  const s = v.toPrecision(6)
  return parseFloat(s).toString()
}

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------

function statusTone(s: StepStatus): 'success' | 'warning' | 'danger' | 'neutral' {
  switch (s) {
    case 'done': return 'success'
    case 'now': return 'danger'
    case 'next': return 'warning'
    case 'blocked': return 'neutral'
  }
}

function statusLabel(s: StepStatus): string {
  switch (s) {
    case 'done': return 'DONE'
    case 'now': return 'NOW'
    case 'next': return 'NEXT'
    case 'blocked': return 'BLOCKED'
  }
}

function severityTone(s: Severity): 'success' | 'warning' | 'danger' {
  return s === 'ok' ? 'success' : s === 'check' ? 'warning' : 'danger'
}

// ---------------------------------------------------------------------------
// Spectrogram
// ---------------------------------------------------------------------------

const SW = 580, SH = 160, SPL = 48, SPR = 8, SPT = 6, SPB = 24

function SpectrogramChart({ spec }: { spec: SpectrogramResult }): ReactElement {
  const pw = SW - SPL - SPR, ph = SH - SPT - SPB
  const nC = spec.times.length, nR = spec.freqs.length
  if (!nC || !nR) return <p className="tuning-plan__empty">No spectrogram data.</p>

  let zMin = Infinity, zMax = -Infinity
  for (const col of spec.z) for (const v of col) { if (v < zMin) zMin = v; if (v > zMax) zMax = v }
  const zRange = zMax - zMin || 1
  const cW = pw / nC, cH = ph / nR

  const rects: ReactElement[] = []
  for (let c = 0; c < nC; c++) {
    for (let r = 0; r < nR; r++) {
      const frac = (spec.z[c][r] - zMin) / zRange
      rects.push(
        <rect key={`${c}-${r}`}
          x={SPL + c * cW} y={SPT + (nR - 1 - r) * cH}
          width={cW + 0.5} height={cH + 0.5}
          fill={`hsl(220, 80%, ${Math.round((1 - frac) * 90 + 5)}%)`}
        />
      )
    }
  }
  const fMax = spec.freqs[nR - 1]

  return (
    <svg className="tuning-plan__spectrogram-svg" viewBox={`0 0 ${SW} ${SH}`}>
      {rects}
      {[0, 100, 200, 300, 400, 500].filter(f => f <= fMax).map(f => {
        const y = SPT + ph * (1 - f / fMax)
        return <g key={f}>
          <line x1={SPL} x2={SPL + pw} y1={y} y2={y} stroke="var(--text-muted)" strokeWidth={0.5} opacity={0.3} />
          <text x={SPL - 4} y={y + 3} textAnchor="end" fontSize={9} fill="var(--text-muted)">{f}</text>
        </g>
      })}
      {Array.from({ length: 5 }, (_, i) => {
        const t = spec.times[0] + (spec.times[nC - 1] - spec.times[0]) * i / 4
        return <text key={i} x={SPL + pw * i / 4} y={SH - 4} textAnchor="middle" fontSize={9} fill="var(--text-muted)">{t.toFixed(0)}s</text>
      })}
      <rect x={SPL} y={SPT} width={pw} height={ph} fill="none" stroke="var(--text-muted)" strokeWidth={0.5} />
    </svg>
  )
}

// ---------------------------------------------------------------------------
// PID findings (top-level summary)
// ---------------------------------------------------------------------------

function FindingsBanner({ findings }: { findings: PidFinding[] }): ReactElement | null {
  if (findings.length === 0) return null
  return (
    <div className="tuning-plan__findings">
      {findings.map((f, i) => (
        <div key={i} className="tuning-plan__finding" data-severity={f.severity}>
          <StatusBadge tone={severityTone(f.severity)}>{f.severity === 'ok' ? 'OK' : f.severity === 'check' ? 'CHECK' : 'ACTION'}</StatusBadge>
          <span>{f.message}</span>
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Inline PID axis metric (compact, embedded in a step)
// ---------------------------------------------------------------------------

function AxisMetricRow({ analysis, metric }: { analysis: PidAxisAnalysis; metric: 'dnoise' | 'tracking' | 'overtune' | 'pvsd' }): ReactElement | null {
  const { axis, dTermNoise, rateTracking, overtune, pvsD } = analysis

  if (metric === 'dnoise') {
    if (!dTermNoise) return <tr><td>{axis}</td><td colSpan={2} className="tuning-plan__dim">No hover data or D = 0</td></tr>
    return (
      <tr>
        <td>{axis}</td>
        <td><StatusBadge tone={severityTone(dTermNoise.severity)}>{dTermNoise.noisePercent.toFixed(2)}%</StatusBadge></td>
        <td className="tuning-plan__dim">
          {dTermNoise.narrowPeak ? `peak ${dTermNoise.noiseFreqHz.toFixed(0)} Hz` : `broadband, peak ${dTermNoise.noiseFreqHz.toFixed(0)} Hz`}
        </td>
      </tr>
    )
  }

  if (metric === 'tracking') {
    if (!rateTracking) return <tr><td>{axis}</td><td colSpan={2} className="tuning-plan__dim">Not enough manoeuvres</td></tr>
    return (
      <tr>
        <td>{axis}</td>
        <td><StatusBadge tone={severityTone(rateTracking.severity)}>r={rateTracking.correlation.toFixed(2)}</StatusBadge></td>
        <td className="tuning-plan__dim">
          lag {rateTracking.lagMs.toFixed(1)} ms, error {rateTracking.rmsError.toFixed(1)} deg/s, sat {(rateTracking.saturationFraction * 100).toFixed(0)}%
        </td>
      </tr>
    )
  }

  if (metric === 'overtune') {
    if (!overtune) return <tr><td>{axis}</td><td colSpan={2} className="tuning-plan__dim">Not enough manoeuvres</td></tr>
    return (
      <tr>
        <td>{axis}</td>
        <td><StatusBadge tone={severityTone(overtune.severity)}>{overtune.verdict}</StatusBadge></td>
        <td className="tuning-plan__dim">
          ratio {overtune.medianRatio.toFixed(2)} (p90 {overtune.p90Ratio.toFixed(2)}){overtune.oscillationFreqHz !== null ? `, osc ${overtune.oscillationFreqHz.toFixed(0)} Hz` : ''}
        </td>
      </tr>
    )
  }

  if (metric === 'pvsd') {
    if (!pvsD) return <tr><td>{axis}</td><td colSpan={2} className="tuning-plan__dim">No PID data</td></tr>
    return (
      <tr>
        <td>{axis}</td>
        <td><StatusBadge tone={severityTone(pvsD.severity)}>D/P {pvsD.dpRatio.toFixed(2)}</StatusBadge></td>
        <td className="tuning-plan__dim">{pvsD.verdict}</td>
      </tr>
    )
  }

  return null
}

function PidMetricsTable({ axes, metric, label }: {
  axes: PidAxisAnalysis[]
  metric: 'dnoise' | 'tracking' | 'overtune' | 'pvsd'
  label: string
}): ReactElement {
  return (
    <table className="tuning-plan__pid-metrics">
      <thead><tr><th>Axis</th><th>{label}</th><th></th></tr></thead>
      <tbody>
        {axes.map(a => <AxisMetricRow key={a.axis} analysis={a} metric={metric} />)}
      </tbody>
    </table>
  )
}

// ---------------------------------------------------------------------------
// Step-specific PID detail (shown inside the step body)
// ---------------------------------------------------------------------------

function StepPidDetail({ stepId, pid }: { stepId: string; pid: PidAnalysisResult }): ReactElement | null {
  if (stepId === 'dnoise') {
    return <PidMetricsTable axes={pid.axes} metric="dnoise" label="D noise (% motor)" />
  }
  if (stepId === 'rp') {
    return (
      <>
        <PidMetricsTable axes={pid.axes.filter(a => a.axis !== 'Yaw')} metric="overtune" label="Overtune" />
        <PidMetricsTable axes={pid.axes.filter(a => a.axis !== 'Yaw')} metric="tracking" label="Rate tracking" />
        <PidMetricsTable axes={pid.axes.filter(a => a.axis !== 'Yaw')} metric="pvsd" label="P vs D" />
      </>
    )
  }
  if (stepId === 'yaw') {
    const yaw = pid.axes.find(a => a.axis === 'Yaw')
    if (!yaw) return null
    return <PidMetricsTable axes={[yaw]} metric="overtune" label="Overtune" />
  }
  return null
}

// ---------------------------------------------------------------------------
// Step card
// ---------------------------------------------------------------------------

function StepCard({
  step, index, isCurrent, pid, onStageParam, stagedParams
}: {
  step: TuningStep
  index: number
  isCurrent: boolean
  pid: PidAnalysisResult
  onStageParam: (param: string, value: number) => void
  stagedParams?: ReadonlySet<string>
}): ReactElement {
  const [expanded, setExpanded] = useState(isCurrent || step.status === 'now')

  return (
    <div
      className={`tuning-plan__step tuning-plan__step--${step.status}${isCurrent ? ' tuning-plan__step--current' : ''}`}
      data-testid={`tuning-plan-step-${step.id}`}
    >
      <button className="tuning-plan__step-header" onClick={() => setExpanded(!expanded)} type="button" aria-expanded={expanded}>
        <span className="tuning-plan__step-num">{index + 1}</span>
        <span className="tuning-plan__step-title">{step.title}</span>
        <StatusBadge tone={statusTone(step.status)}>{statusLabel(step.status)}</StatusBadge>
        {step.alongside ? <StatusBadge tone="neutral">also</StatusBadge> : null}
        <span className="tuning-plan__step-chevron">{expanded ? '▾' : '▸'}</span>
      </button>

      {expanded ? (
        <div className="tuning-plan__step-body">
          {step.summary ? <p className="tuning-plan__step-summary">{step.summary}</p> : null}

          {step.why.length > 0 ? (
            <ul className="tuning-plan__step-why">
              {step.why.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          ) : null}

          <StepPidDetail stepId={step.id} pid={pid} />

          {step.changes.length > 0 ? (
            <div className="tuning-plan__changes">
              <div className="tuning-plan__changes-header">
                <strong>Parameter changes</strong>
                {step.status === 'now' && step.changes.length > 1 ? (
                  <button
                    type="button"
                    style={buttonStyle('primary')}
                    onClick={() => step.changes.forEach(c => onStageParam(c.param, c.to))}
                  >
                    Stage all ({step.changes.length})
                  </button>
                ) : null}
              </div>
              {step.changes.map(c => {
                const isStaged = stagedParams?.has(c.param)
                return (
                  <article className="tuning-plan__change" key={c.param} data-staged={isStaged || undefined}>
                    <div className="tuning-plan__change-head">
                      <code>{c.param}</code>
                      <span className="tuning-plan__change-values">
                        {c.from !== null ? `${formatParamValue(c.from)} → ` : ''}<strong>{c.to}</strong>
                      </span>
                      {step.status === 'now' ? (
                        <button
                          type="button"
                          style={buttonStyle(isStaged ? 'secondary' : 'primary')}
                          disabled={isStaged}
                          onClick={() => onStageParam(c.param, c.to)}
                        >
                          {isStaged ? 'Staged' : 'Stage'}
                        </button>
                      ) : null}
                    </div>
                    <p className="tuning-plan__change-note">{c.note}</p>
                  </article>
                )
              })}
            </div>
          ) : null}

          <div className="tuning-plan__step-instructions">
            {step.fly ? <p><strong>Fly:</strong> {step.fly}</p> : null}
            {step.verify ? <p><strong>Verify:</strong> {step.verify}</p> : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Param download
// ---------------------------------------------------------------------------

function downloadParamFile(lines: string[]): void {
  const blob = new Blob([lines.join('\n') + '\n'], { type: 'text/plain' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'verify-tune.param'
  a.click()
  URL.revokeObjectURL(url)
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

function TuningPlanResults({
  result, onStageParam, stagedParams
}: {
  result: TuningPlanResult
  onStageParam: (param: string, value: number) => void
  stagedParams?: ReadonlySet<string>
}): ReactElement {
  const { steps, currentStepId, paramLines, pidAnalysis } = result
  const [showSpectrogram, setShowSpectrogram] = useState(false)

  const doneCount = steps.filter(s => s.status === 'done').length
  const totalChanges = steps.filter(s => s.status === 'now').reduce((acc, s) => acc + s.changes.length, 0)

  return (
    <div className="tuning-plan__results">
      <div className="tuning-plan__bar">
        <StatusBadge tone="success">{doneCount}/{steps.length} done</StatusBadge>
        {currentStepId ? <StatusBadge tone="danger">action: {steps.find(s => s.id === currentStepId)?.title}</StatusBadge> : null}
        {totalChanges > 0 ? (
          <button type="button" style={buttonStyle('secondary')} onClick={() => downloadParamFile(paramLines)}>
            Download {totalChanges} changes
          </button>
        ) : null}
      </div>

      <FindingsBanner findings={pidAnalysis.findings} />

      <div className="tuning-plan__steps">
        {steps.map((step, i) => (
          <StepCard
            key={step.id} step={step} index={i}
            isCurrent={step.id === currentStepId}
            pid={pidAnalysis}
            onStageParam={onStageParam} stagedParams={stagedParams}
          />
        ))}
      </div>

      {pidAnalysis.spectrogram || pidAnalysis.peakClassification.length > 0 ? (
        <div className="tuning-plan__detail-section">
          <button
            type="button"
            className="tuning-plan__detail-toggle"
            onClick={() => setShowSpectrogram(!showSpectrogram)}
          >
            {showSpectrogram ? '▾' : '▸'} Spectrogram and peak classification
          </button>
          {showSpectrogram ? (
            <div className="tuning-plan__detail-body">
              {pidAnalysis.spectrogram ? <SpectrogramChart spec={pidAnalysis.spectrogram} /> : null}
              {pidAnalysis.peakClassification.length > 0 ? (
                <table className="tuning-plan__peak-table">
                  <thead><tr><th>Frequency</th><th>Type</th><th>Harmonic</th><th>Detail</th></tr></thead>
                  <tbody>
                    {pidAnalysis.peakClassification.map((pk, i) => (
                      <tr key={i}>
                        <td>{pk.freqHz.toFixed(1)} Hz</td>
                        <td>{pk.classification}</td>
                        <td>{pk.harmonic ?? '–'}</td>
                        <td>{pk.detail}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      <small className="tuning-plan__footer">
        Staged changes appear in the draft bar. Nothing is written until you apply.
      </small>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------

export function TuningPlanView({ onStageParam, stagedParams, onboardLogs }: TuningPlanViewProps): ReactElement {
  const [result, setResult] = useState<TuningPlanResult | null>(null)
  const [filename, setFilename] = useState<string | undefined>()
  const [error, setError] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)

  const handleBuffer = useCallback(async (buffer: ArrayBuffer, name: string) => {
    setBusy(true)
    setError(undefined)
    setResult(null)
    try {
      await new Promise(resolve => setTimeout(resolve, 0))
      setResult(buildTuningPlanBuffer(buffer))
      setFilename(name)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not parse that log.')
    } finally {
      setBusy(false)
    }
  }, [])

  const handleFile = useCallback(
    async (file: File) => handleBuffer(await file.arrayBuffer(), file.name),
    [handleBuffer]
  )

  return (
    <section className="bf-gui-box tuning-plan" data-testid="tuning-plan">
      <div className="bf-gui-box__titlebar">
        <strong>Verify Tune</strong>
        <StatusBadge tone="neutral">expert</StatusBadge>
      </div>
      <div className="bf-gui-box__body">
        <div className="tuning-plan__upload">
          <label className="tuning-plan__file" style={buttonStyle('primary')}>
            {busy ? 'Analyzing…' : 'Choose flight log (.bin)'}
            <input
              type="file"
              accept=".bin,application/octet-stream"
              data-testid="tuning-plan-file"
              style={{ display: 'none' }}
              disabled={busy}
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) void handleFile(file)
                event.target.value = ''
              }}
            />
          </label>
          {onboardLogs ? (
            <OnboardLogPicker
              onboardLogs={onboardLogs}
              busy={busy}
              testIdPrefix="tuning-plan"
              onBusy={setBusy}
              onBytes={(bytes, name) => handleBuffer(bytes.slice().buffer as ArrayBuffer, name)}
              onError={setError}
            />
          ) : null}
          {filename ? <small className="tuning-plan__filename">{filename}</small> : null}
        </div>

        <p className="feel-note">
          Upload a flight log to check your tune. Each step says what to fix, what to fly, and what to verify.
        </p>

        {error ? (
          <div className="parameter-follow-up parameter-follow-up--danger" role="alert">
            <StatusBadge tone="danger">error</StatusBadge>
            <p>{error}</p>
          </div>
        ) : null}

        {result ? <TuningPlanResults result={result} onStageParam={onStageParam} stagedParams={stagedParams} /> : null}
      </div>
    </section>
  )
}
