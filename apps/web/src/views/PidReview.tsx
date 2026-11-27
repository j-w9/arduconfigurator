import { useCallback, useState, type ReactElement } from 'react'

import {
  analyzePidBuffer,
  type PidAnalysisResult,
  type PidAxisAnalysis,
  type PidFinding,
  type SpectrogramResult,
  type Severity
} from '@arduconfig/log-analysis'
import { StatusBadge, buttonStyle } from '@arduconfig/ui-kit'

import { OnboardLogPicker, type OnboardLogPickerLogs } from '../sections/OnboardLogPicker'

export interface PidReviewViewProps {
  onboardLogs?: OnboardLogPickerLogs
}

// ---------------------------------------------------------------------------
// Severity badge
// ---------------------------------------------------------------------------

function severityTone(s: Severity): 'success' | 'warning' | 'danger' {
  return s === 'ok' ? 'success' : s === 'check' ? 'warning' : 'danger'
}

function severityLabel(s: Severity): string {
  return s === 'ok' ? 'OK' : s === 'check' ? 'CHECK' : 'ACTION'
}

// ---------------------------------------------------------------------------
// Spectrogram SVG
// ---------------------------------------------------------------------------

const SPEC_WIDTH = 600
const SPEC_HEIGHT = 200
const SPEC_PAD_L = 56
const SPEC_PAD_R = 12
const SPEC_PAD_T = 8
const SPEC_PAD_B = 32

function SpectrogramChart({ spec }: { spec: SpectrogramResult }): ReactElement {
  const plotW = SPEC_WIDTH - SPEC_PAD_L - SPEC_PAD_R
  const plotH = SPEC_HEIGHT - SPEC_PAD_T - SPEC_PAD_B
  const nCols = spec.times.length
  const nRows = spec.freqs.length
  if (nCols === 0 || nRows === 0) return <p>No spectrogram data</p>

  let zMin = Infinity, zMax = -Infinity
  for (const col of spec.z) {
    for (const v of col) {
      if (v < zMin) zMin = v
      if (v > zMax) zMax = v
    }
  }
  const zRange = zMax - zMin || 1

  const cellW = plotW / nCols
  const cellH = plotH / nRows

  const rects: ReactElement[] = []
  for (let c = 0; c < nCols; c++) {
    for (let r = 0; r < nRows; r++) {
      const frac = (spec.z[c][r] - zMin) / zRange
      const lightness = Math.round((1 - frac) * 90 + 5)
      rects.push(
        <rect
          key={`${c}-${r}`}
          x={SPEC_PAD_L + c * cellW}
          y={SPEC_PAD_T + (nRows - 1 - r) * cellH}
          width={cellW + 0.5}
          height={cellH + 0.5}
          fill={`hsl(220, 80%, ${lightness}%)`}
        />
      )
    }
  }

  const tMin = spec.times[0], tMax = spec.times[nCols - 1]
  const fMax = spec.freqs[nRows - 1]

  return (
    <svg viewBox={`0 0 ${SPEC_WIDTH} ${SPEC_HEIGHT}`} style={{ width: '100%', maxWidth: SPEC_WIDTH }}>
      {rects}
      {[0, 100, 200, 300, 400, 500].filter(f => f <= fMax).map(f => {
        const y = SPEC_PAD_T + plotH * (1 - f / fMax)
        return <g key={`f${f}`}>
          <line x1={SPEC_PAD_L} x2={SPEC_PAD_L + plotW} y1={y} y2={y} stroke="var(--text-muted)" strokeWidth={0.5} opacity={0.3} />
          <text x={SPEC_PAD_L - 4} y={y + 3} textAnchor="end" fontSize={10} fill="var(--text-muted)">{f} Hz</text>
        </g>
      })}
      {Array.from({ length: 5 }, (_, i) => {
        const t = tMin + (tMax - tMin) * i / 4
        const x = SPEC_PAD_L + plotW * i / 4
        return <text key={`t${i}`} x={x} y={SPEC_HEIGHT - 4} textAnchor="middle" fontSize={10} fill="var(--text-muted)">{t.toFixed(0)}s</text>
      })}
      <rect x={SPEC_PAD_L} y={SPEC_PAD_T} width={plotW} height={plotH} fill="none" stroke="var(--text-muted)" strokeWidth={0.5} />
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Findings list
// ---------------------------------------------------------------------------

function FindingsList({ findings }: { findings: PidFinding[] }): ReactElement {
  if (findings.length === 0) {
    return <p style={{ color: 'var(--color-success)' }}>No issues found — rate controller looks clean.</p>
  }
  return (
    <div className="pid-review__findings">
      {findings.map((f, i) => (
        <div key={i} className="pid-review__finding" data-severity={f.severity}>
          <StatusBadge tone={severityTone(f.severity)}>{severityLabel(f.severity)}</StatusBadge>
          <span>{f.message}</span>
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Per-axis detail
// ---------------------------------------------------------------------------

function AxisDetail({ analysis }: { analysis: PidAxisAnalysis }): ReactElement {
  const { axis, dTermNoise, rateTracking, overtune, pvsD, activityWindows } = analysis
  const activeCount = activityWindows.filter(w => w.kind === 'active').length
  const quietCount = activityWindows.filter(w => w.kind === 'quiet').length

  return (
    <div className="pid-review__axis">
      <h4>{axis}</h4>
      <div className="pid-review__axis-stats">
        <span className="pid-review__stat-label">Windows:</span>
        <span>{activeCount} active, {quietCount} quiet</span>
      </div>

      {dTermNoise ? (
        <div className="pid-review__metric">
          <div className="pid-review__metric-header">
            <span>D-term noise</span>
            <StatusBadge tone={severityTone(dTermNoise.severity)}>{dTermNoise.noisePercent.toFixed(2)}%</StatusBadge>
          </div>
          <div className="pid-review__metric-detail">
            {dTermNoise.narrowPeak
              ? `Concentrated at ${dTermNoise.noiseFreqHz.toFixed(0)} Hz`
              : `Broadband, peak near ${dTermNoise.noiseFreqHz.toFixed(0)} Hz`}
            {' · '}Target: &lt; 0.3%
          </div>
        </div>
      ) : (
        <div className="pid-review__metric">
          <span className="pid-review__metric-na">D-term noise: no hover data or D gain is zero</span>
        </div>
      )}

      {rateTracking ? (
        <div className="pid-review__metric">
          <div className="pid-review__metric-header">
            <span>Rate tracking</span>
            <StatusBadge tone={severityTone(rateTracking.severity)}>corr {rateTracking.correlation.toFixed(2)}</StatusBadge>
          </div>
          <div className="pid-review__metric-detail">
            RMS error {rateTracking.rmsError.toFixed(1)} deg/s · Lag {rateTracking.lagMs.toFixed(1)} ms · Saturation {(rateTracking.saturationFraction * 100).toFixed(1)}%
          </div>
        </div>
      ) : (
        <div className="pid-review__metric">
          <span className="pid-review__metric-na">Rate tracking: not enough manoeuvre windows</span>
        </div>
      )}

      {overtune ? (
        <div className="pid-review__metric">
          <div className="pid-review__metric-header">
            <span>Overtune check</span>
            <StatusBadge tone={severityTone(overtune.severity)}>{overtune.verdict}</StatusBadge>
          </div>
          <div className="pid-review__metric-detail">
            std(actual)/std(desired): median {overtune.medianRatio.toFixed(2)}, 90th pct {overtune.p90Ratio.toFixed(2)}
            {overtune.oscillationFreqHz !== null ? ` · Oscillation at ${overtune.oscillationFreqHz.toFixed(0)} Hz` : ''}
          </div>
        </div>
      ) : (
        <div className="pid-review__metric">
          <span className="pid-review__metric-na">Overtune check: not enough manoeuvre windows</span>
        </div>
      )}

      {pvsD ? (
        <div className="pid-review__metric">
          <div className="pid-review__metric-header">
            <span>P vs D balance</span>
            <StatusBadge tone={severityTone(pvsD.severity)}>D/P {pvsD.dpRatio.toFixed(2)}</StatusBadge>
          </div>
          <div className="pid-review__metric-detail">
            {pvsD.verdict} · rms(P) {pvsD.rmsP.toFixed(4)} · rms(D) {pvsD.rmsD.toFixed(4)} · Target: D/P 0.3–0.8
          </div>
        </div>
      ) : (
        <div className="pid-review__metric">
          <span className="pid-review__metric-na">P vs D: no PID data</span>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Peak classification table
// ---------------------------------------------------------------------------

function PeakClassificationTable({ result }: { result: PidAnalysisResult }): ReactElement | null {
  if (result.peakClassification.length === 0) return null
  return (
    <div className="pid-review__section">
      <h3>Peak classification</h3>
      <table className="pid-review__table">
        <thead>
          <tr>
            <th>Frequency</th>
            <th>Classification</th>
            <th>Harmonic</th>
            <th>Detail</th>
          </tr>
        </thead>
        <tbody>
          {result.peakClassification.map((pk, i) => (
            <tr key={i}>
              <td>{pk.freqHz.toFixed(1)} Hz</td>
              <td>{pk.classification}</td>
              <td>{pk.harmonic ?? '–'}</td>
              <td>{pk.detail}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Results composite
// ---------------------------------------------------------------------------

function PidReviewResults({ result }: { result: PidAnalysisResult }): ReactElement {
  return (
    <div className="pid-review__results">
      {result.warnings.length > 0 ? (
        <div className="pid-review__warnings">
          {result.warnings.map((w, i) => <p key={i} className="pid-review__warning">{w}</p>)}
        </div>
      ) : null}

      <div className="pid-review__section">
        <h3>Findings</h3>
        <FindingsList findings={result.findings} />
      </div>

      <div className="pid-review__section">
        <h3>Per-axis analysis</h3>
        {result.axes.map(a => <AxisDetail key={a.axis} analysis={a} />)}
      </div>

      <PeakClassificationTable result={result} />

      {result.spectrogram ? (
        <div className="pid-review__section">
          <h3>Spectrogram</h3>
          <SpectrogramChart spec={result.spectrogram} />
        </div>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------

export function PidReviewView({ onboardLogs }: PidReviewViewProps): ReactElement {
  const [result, setResult] = useState<PidAnalysisResult | null>(null)
  const [filename, setFilename] = useState<string | undefined>()
  const [error, setError] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)

  const handleBuffer = useCallback(async (buffer: ArrayBuffer, name: string) => {
    setBusy(true)
    setError(undefined)
    setResult(null)
    try {
      await new Promise((resolve) => setTimeout(resolve, 0))
      const analysis = analyzePidBuffer(buffer)
      setResult(analysis)
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
    <section className="bf-gui-box pid-review" data-testid="pid-review">
      <div className="bf-gui-box__titlebar">
        <strong>PID Review</strong>
        <StatusBadge tone="neutral">expert</StatusBadge>
      </div>
      <div className="bf-gui-box__body">
        <div className="pid-review__upload">
          <label className="pid-review__file" style={buttonStyle('primary')}>
            {busy ? 'Analyzing…' : 'Choose flight log (.bin)'}
            <input
              type="file"
              accept=".bin,application/octet-stream"
              data-testid="pid-review-file"
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
              testIdPrefix="pid-review"
              onBusy={setBusy}
              onBytes={(bytes, name) => handleBuffer(bytes.slice().buffer as ArrayBuffer, name)}
              onError={setError}
            />
          ) : null}
          {filename ? <small className="pid-review__filename">{filename}</small> : null}
        </div>

        <p className="feel-note">
          Upload a flight log with RATE and PID messages (LOG_BITMASK bit 0 + bit 12). Fly with stick inputs for rate tracking and overtune analysis.
        </p>

        {error ? (
          <div className="parameter-follow-up parameter-follow-up--danger" role="alert">
            <StatusBadge tone="danger">error</StatusBadge>
            <p>{error}</p>
          </div>
        ) : null}

        {result ? <PidReviewResults result={result} /> : null}
      </div>
    </section>
  )
}
