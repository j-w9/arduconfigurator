// Log Tuning — a sub-tab of the Tuning view. Upload a flight log (.bin), run the
// in-browser analyzer (@arduconfig/log-analysis: gyro-FFT vibration/oscillation,
// motor-RPM harmonic-notch placement, rate-loop limit-cycle detection), and
// stage the recommended parameter changes for review through the shared
// draft/verified-write machinery (via the onStageParam prop).
//
// Presentational + pure analysis only: it imports the analysis engine (a pure
// function over an uploaded buffer — no runtime/transport/MAVLink), owns its
// local upload/result state, and delegates staging to the parent.

import { useCallback, useState, type ReactElement } from 'react'

import { analyzeLogBuffer, type AxisSpectrum, type LogTuningResult, type TuningRecommendation } from '@arduconfig/log-analysis'
import { StatusBadge, buttonStyle } from '@arduconfig/ui-kit'

export interface LogTuningViewProps {
  /** Stage a recommended parameter change as a draft (parent owns the draft set). */
  onStageParam: (param: string, value: number) => void
  /** Params already staged from a recommendation, so the row can show "staged". */
  stagedParams?: ReadonlySet<string>
}

const CONFIDENCE_TONE: Record<TuningRecommendation['confidence'], 'success' | 'warning' | 'neutral'> = {
  high: 'success',
  medium: 'warning',
  low: 'neutral'
}

export function LogTuningView({ onStageParam, stagedParams }: LogTuningViewProps): ReactElement {
  const [result, setResult] = useState<LogTuningResult | null>(null)
  const [filename, setFilename] = useState<string | undefined>()
  const [error, setError] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)

  const handleFile = useCallback(async (file: File) => {
    setBusy(true)
    setError(undefined)
    setResult(null)
    try {
      const buffer = await file.arrayBuffer()
      // Analysis is synchronous but can be a moment on a large log — yield first
      // so the "Analyzing…" state paints.
      await new Promise((resolve) => setTimeout(resolve, 0))
      const analysis = analyzeLogBuffer(buffer)
      setResult(analysis)
      setFilename(file.name)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not read or parse that log.')
    } finally {
      setBusy(false)
    }
  }, [])

  return (
    <section className="bf-gui-box log-tuning" data-testid="log-tuning">
      <div className="bf-gui-box__titlebar">
        <strong>Log Tuning</strong>
        <StatusBadge tone="warning">beta</StatusBadge>
      </div>
      <div className="bf-gui-box__body">
        <p className="bf-note">
          Upload a dataflash flight log (<code>.bin</code>) from the SD card. The analyzer works through
          vibration, oscillation, motor-noise, and rate-loop tuning, then stages the recommended parameter
          changes for you to review and apply.
        </p>

        <div className="log-tuning__upload">
          <label className="log-tuning__file" style={buttonStyle('primary')}>
            {busy ? 'Analyzing…' : 'Choose flight log (.bin)'}
            <input
              type="file"
              accept=".bin,application/octet-stream"
              data-testid="log-tuning-file"
              style={{ display: 'none' }}
              disabled={busy}
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) {
                  void handleFile(file)
                }
                event.target.value = ''
              }}
            />
          </label>
          {filename ? <small className="log-tuning__filename">{filename}</small> : null}
        </div>

        <div className="parameter-follow-up parameter-follow-up--warning" data-testid="log-tuning-gate-note">
          <StatusBadge tone="warning">read first</StatusBadge>
          <p>
            This only works on a <strong>good flight log</strong>: a real hover/flight (not a bench run), ideally
            30–60 s of steady hovering. For the harmonic notch you also want ESC RPM telemetry, and for the best
            spectrum enable the IMU batch sampler (<code>INS_LOG_BAT_MASK</code>). A poor log gives poor advice.
          </p>
        </div>

        {error ? (
          <div className="parameter-follow-up parameter-follow-up--danger" role="alert" data-testid="log-tuning-error">
            <StatusBadge tone="danger">error</StatusBadge>
            <p>{error}</p>
          </div>
        ) : null}

        {result ? <LogTuningResults result={result} onStageParam={onStageParam} stagedParams={stagedParams} /> : null}
      </div>
    </section>
  )
}

function SpectrumChart({ axis }: { axis: AxisSpectrum }): ReactElement | null {
  const chart = axis.chart
  if (!chart) {
    return null
  }
  const width = 280
  const height = 40
  const n = chart.level.length
  // Filled area under the spectrum curve.
  const points = chart.level
    .map((level, i) => `${((i / Math.max(1, n - 1)) * width).toFixed(1)},${(height - level * (height - 3) - 1).toFixed(1)}`)
    .join(' ')
  const peakX = axis.dominant ? (axis.dominant.freqHz / chart.maxFreqHz) * width : undefined
  const isLimitCycleAxis = axis.dominant && (axis.prominence ?? 0) >= 40 && axis.dominant.freqHz >= 8 && axis.dominant.freqHz < 40

  return (
    <div className="log-tuning__spectrum" data-testid={`log-tuning-spectrum-${axis.axis}`}>
      <span className="log-tuning__axis">{axis.axis}</span>
      <svg
        className="log-tuning__spectrum-svg"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`${axis.axis} gyro spectrum`}
      >
        <polyline className="log-tuning__spectrum-area" points={`0,${height} ${points} ${width},${height}`} />
        {peakX !== undefined ? (
          <line
            className={`log-tuning__spectrum-peak${isLimitCycleAxis ? ' is-limit-cycle' : ''}`}
            x1={peakX}
            y1={0}
            x2={peakX}
            y2={height}
          />
        ) : null}
      </svg>
      <small>
        {axis.dominant ? `${axis.dominant.freqHz.toFixed(0)} Hz` : '—'}
        <span className="log-tuning__spectrum-scale"> · 0–{chart.maxFreqHz.toFixed(0)} Hz</span>
      </small>
    </div>
  )
}

function LogTuningResults({
  result,
  onStageParam,
  stagedParams
}: {
  result: LogTuningResult
  onStageParam: (param: string, value: number) => void
  stagedParams?: ReadonlySet<string>
}): ReactElement {
  return (
    <div className="log-tuning__results" data-testid="log-tuning-results">
      {!result.usable ? (
        <div className="parameter-follow-up parameter-follow-up--danger" data-testid="log-tuning-unusable">
          <StatusBadge tone="danger">not usable</StatusBadge>
          <p>This log isn't suitable for tuning analysis — see the warnings below.</p>
        </div>
      ) : null}

      {result.gateWarnings.length > 0 ? (
        <ul className="log-tuning__warnings" data-testid="log-tuning-warnings">
          {result.gateWarnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      ) : null}

      <p className="log-tuning__summary" data-testid="log-tuning-summary">
        {result.summary || 'Analysis complete.'}
      </p>

      <div className="log-tuning__metrics">
        <article>
          <span>Gyro source</span>
          <strong>
            {result.gyroSource === 'batch'
              ? `Batch (${result.gyroSampleRateHz.toFixed(0)} Hz)`
              : result.gyroSource === 'imu'
                ? `IMU (${result.gyroSampleRateHz.toFixed(0)} Hz)`
                : 'None'}
          </strong>
        </article>
        {result.vibe ? (
          <article>
            <span>Vibration</span>
            <strong>
              {result.vibe.verdict} · peak {Math.max(...result.vibe.max).toFixed(0)} m/s² · clip {Math.max(...result.vibe.clip)}
            </strong>
          </article>
        ) : null}
        {result.motorFundamentalHz ? (
          <article>
            <span>Motor fundamental</span>
            <strong>{result.motorFundamentalHz.toFixed(0)} Hz</strong>
          </article>
        ) : null}
        {result.limitCycle ? (
          <article>
            <span>Limit cycle</span>
            <strong>
              {result.limitCycle.freqHz.toFixed(0)} Hz on {result.limitCycle.axis}
            </strong>
          </article>
        ) : null}
      </div>

      {result.advisories.length > 0 ? (
        <div className="log-tuning__advisories" data-testid="log-tuning-advisories">
          {result.advisories.map((advisory) => (
            <div key={advisory} className="parameter-follow-up parameter-follow-up--warning">
              <StatusBadge tone="warning">action needed</StatusBadge>
              <p>{advisory}</p>
            </div>
          ))}
        </div>
      ) : null}

      {result.axisSpectra.some((axis) => axis.chart) ? (
        <div className="log-tuning__spectra" data-testid="log-tuning-spectra">
          <strong>Gyro spectrum</strong>
          {result.axisSpectra.map((axis) => (
            <SpectrumChart key={axis.axis} axis={axis} />
          ))}
        </div>
      ) : null}

      {result.recommendations.length > 0 ? (
        <div className="log-tuning__recs" data-testid="log-tuning-recommendations">
          <div className="log-tuning__recs-header">
            <strong>Recommended changes</strong>
            <button
              type="button"
              style={buttonStyle('primary')}
              data-testid="log-tuning-stage-all"
              onClick={() => result.recommendations.forEach((rec) => onStageParam(rec.param, rec.suggestedValue))}
            >
              Stage all ({result.recommendations.length})
            </button>
          </div>
          {result.recommendations.map((rec) => {
            const staged = stagedParams?.has(rec.param)
            return (
              <article className="log-tuning__rec" key={rec.param} data-testid={`log-tuning-rec-${rec.param}`}>
                <div className="log-tuning__rec-head">
                  <code>{rec.param}</code>
                  <StatusBadge tone={CONFIDENCE_TONE[rec.confidence]}>{rec.confidence}</StatusBadge>
                  <span className="log-tuning__rec-values">
                    {rec.currentValue !== undefined ? `${rec.currentValue} → ` : ''}
                    <strong>{rec.suggestedValue}</strong>
                  </span>
                  <button
                    type="button"
                    style={buttonStyle(staged ? 'secondary' : 'primary')}
                    disabled={staged}
                    onClick={() => onStageParam(rec.param, rec.suggestedValue)}
                  >
                    {staged ? 'Staged' : 'Stage'}
                  </button>
                </div>
                <p>{rec.reason}</p>
              </article>
            )
          })}
          <small className="log-tuning__recs-note">
            Staged changes appear in the Tuning <strong>Review</strong> tab and the global draft bar — nothing is
            written to the aircraft until you apply them there.
          </small>
        </div>
      ) : result.usable ? (
        <p className="bf-note" data-testid="log-tuning-no-recs">
          {result.advisories.length > 0
            ? 'No parameter changes to stage — address the finding above first.'
            : 'No parameter changes recommended — the tune looks clean.'}
        </p>
      ) : null}
    </div>
  )
}
