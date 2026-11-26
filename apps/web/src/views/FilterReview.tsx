import { useCallback, useMemo, useState, type ReactElement } from 'react'

import {
  analyzeFilterReviewBuffer,
  reEstimateAxis,
  type FilterReviewResult,
  type FilterReviewAxisResult,
  type FilterChainParams,
  type NotchParams,
  type PowerSpectrum,
  filterChainMagnitude
} from '@arduconfig/log-analysis'
import { StatusBadge, buttonStyle } from '@arduconfig/ui-kit'

import { OnboardLogPicker, type OnboardLogPickerLogs } from '../sections/OnboardLogPicker'

export interface FilterReviewViewProps {
  onStageParam: (param: string, value: number) => void
  stagedParams?: ReadonlySet<string>
  onboardLogs?: OnboardLogPickerLogs
}

type ActiveAxis = 'roll' | 'pitch' | 'yaw'

const SPECTRUM_WIDTH = 600
const SPECTRUM_HEIGHT = 220
const PADDING_LEFT = 56
const PADDING_RIGHT = 12
const PADDING_TOP = 8
const PADDING_BOTTOM = 40

function dbScale(power: number, refPower: number): number {
  if (power <= 0 || refPower <= 0) return -80
  return Math.max(-80, 10 * Math.log10(power / refPower))
}

function SpectrumOverlay({
  axisResult,
  filterParams
}: {
  axisResult: FilterReviewAxisResult
  filterParams: FilterChainParams
}): ReactElement {
  const { preFilter, postFilter } = axisResult
  const estimatedPower = useMemo(
    () => reEstimateAxis(preFilter, filterParams),
    [preFilter, filterParams]
  )

  const maxFreq = preFilter.freqHz[preFilter.freqHz.length - 1] ?? 500
  let refPower = 0
  for (let i = 0; i < preFilter.power.length; i++) {
    if (preFilter.power[i] > refPower) refPower = preFilter.power[i]
  }

  const plotW = SPECTRUM_WIDTH - PADDING_LEFT - PADDING_RIGHT
  const plotH = SPECTRUM_HEIGHT - PADDING_TOP - PADDING_BOTTOM
  const minDb = -60
  const maxDb = 0

  function toX(freqHz: number): number {
    return PADDING_LEFT + (freqHz / maxFreq) * plotW
  }
  function toY(db: number): number {
    return PADDING_TOP + (1 - (db - minDb) / (maxDb - minDb)) * plotH
  }

  function spectrumPath(spectrum: PowerSpectrum | null, power?: Float64Array): string {
    const src = power ?? spectrum?.power
    const freqs = spectrum?.freqHz
    if (!src || !freqs || freqs.length < 2) return ''
    const points: string[] = []
    for (let i = 1; i < freqs.length; i++) {
      const db = dbScale(src[i], refPower)
      points.push(`${toX(freqs[i]).toFixed(1)},${toY(db).toFixed(1)}`)
    }
    return `M${points[0]} ${points.slice(1).map((p) => `L${p}`).join(' ')}`
  }

  const prePath = spectrumPath(preFilter)
  const postPath = postFilter ? spectrumPath(postFilter) : null
  const estPath = spectrumPath(preFilter, estimatedPower)

  const freqTicks = [50, 100, 150, 200, 250, 300, 350, 400, 450, 500].filter((f) => f <= maxFreq)
  const dbTicks = [-60, -50, -40, -30, -20, -10, 0]

  return (
    <svg
      className="filter-review__spectrum-svg"
      viewBox={`0 0 ${SPECTRUM_WIDTH} ${SPECTRUM_HEIGHT}`}
      preserveAspectRatio="xMidYMid meet"
    >
      {/* Grid */}
      {freqTicks.map((f) => (
        <g key={`f${f}`}>
          <line className="filter-review__grid" x1={toX(f)} y1={PADDING_TOP} x2={toX(f)} y2={PADDING_TOP + plotH} />
          <text className="filter-review__tick" x={toX(f)} y={SPECTRUM_HEIGHT - 2} textAnchor="middle">{f}</text>
        </g>
      ))}
      {dbTicks.map((db) => (
        <g key={`db${db}`}>
          <line className="filter-review__grid" x1={PADDING_LEFT} y1={toY(db)} x2={PADDING_LEFT + plotW} y2={toY(db)} />
          <text className="filter-review__tick" x={PADDING_LEFT - 4} y={toY(db) + 3} textAnchor="end">{db}</text>
        </g>
      ))}

      {/* Pre-filter spectrum */}
      {prePath ? <path className="filter-review__line filter-review__line--pre" d={prePath} /> : null}
      {/* Actual post-filter spectrum (if the log has it) */}
      {postPath ? <path className="filter-review__line filter-review__line--post" d={postPath} /> : null}
      {/* Estimated post-filter spectrum */}
      {estPath ? <path className="filter-review__line filter-review__line--estimated" d={estPath} /> : null}

      {/* Axis labels */}
      <text className="filter-review__axis-label" x={PADDING_LEFT + (SPECTRUM_WIDTH - PADDING_LEFT - PADDING_RIGHT) / 2} y={SPECTRUM_HEIGHT - 6} textAnchor="middle">Hz</text>
      <text className="filter-review__axis-label" x={14} y={(PADDING_TOP + SPECTRUM_HEIGHT - PADDING_BOTTOM) / 2} textAnchor="middle" transform={`rotate(-90 14 ${(PADDING_TOP + SPECTRUM_HEIGHT - PADDING_BOTTOM) / 2})`}>dB</text>
    </svg>
  )
}

const RESPONSE_HEIGHT = 100

function FrequencyResponse({ filterParams }: { filterParams: FilterChainParams }): ReactElement {
  const maxFreq = Math.min(filterParams.sampleRateHz / 2, 500)
  const plotW = SPECTRUM_WIDTH - PADDING_LEFT - PADDING_RIGHT
  const plotH = RESPONSE_HEIGHT - PADDING_TOP - 16

  function toX(freqHz: number): number {
    return PADDING_LEFT + (freqHz / maxFreq) * plotW
  }
  function toY(db: number): number {
    const minDb = -60
    return PADDING_TOP + (1 - (db - minDb) / (0 - minDb)) * plotH
  }

  const points: string[] = []
  for (let f = 1; f <= maxFreq; f += 1) {
    const mag = filterChainMagnitude(filterParams, f)
    const db = mag > 0 ? Math.max(-60, 20 * Math.log10(mag)) : -60
    points.push(`${toX(f).toFixed(1)},${toY(db).toFixed(1)}`)
  }
  const path = points.length > 0 ? `M${points[0]} ${points.slice(1).map((p) => `L${p}`).join(' ')}` : ''

  return (
    <svg
      className="filter-review__response-svg"
      viewBox={`0 0 ${SPECTRUM_WIDTH} ${RESPONSE_HEIGHT}`}
      preserveAspectRatio="xMidYMid meet"
    >
      <line className="filter-review__grid" x1={PADDING_LEFT} y1={toY(0)} x2={PADDING_LEFT + plotW} y2={toY(0)} />
      <line className="filter-review__grid" x1={PADDING_LEFT} y1={toY(-20)} x2={PADDING_LEFT + plotW} y2={toY(-20)} />
      <line className="filter-review__grid" x1={PADDING_LEFT} y1={toY(-40)} x2={PADDING_LEFT + plotW} y2={toY(-40)} />
      <text className="filter-review__tick" x={PADDING_LEFT - 4} y={toY(0) + 3} textAnchor="end">0</text>
      <text className="filter-review__tick" x={PADDING_LEFT - 4} y={toY(-20) + 3} textAnchor="end">-20</text>
      <text className="filter-review__tick" x={PADDING_LEFT - 4} y={toY(-40) + 3} textAnchor="end">-40</text>
      {path ? <path className="filter-review__line filter-review__line--response" d={path} /> : null}
    </svg>
  )
}

function NotchEditor({
  label,
  notch,
  onChange
}: {
  label: string
  notch: NotchParams
  onChange: (n: NotchParams) => void
}): ReactElement {
  return (
    <fieldset className="filter-review__notch-editor">
      <legend>{label}</legend>
      <label>
        <input type="checkbox" checked={notch.enabled} onChange={(e) => onChange({ ...notch, enabled: e.target.checked })} />
        Enable
      </label>
      <label>
        Center (Hz)
        <input
          type="number"
          min={10}
          max={500}
          step={1}
          value={notch.centerFreqHz}
          disabled={!notch.enabled}
          onChange={(e) => onChange({ ...notch, centerFreqHz: Number(e.target.value) })}
        />
      </label>
      <label>
        Bandwidth (Hz)
        <input
          type="number"
          min={1}
          max={200}
          step={1}
          value={notch.bandwidthHz}
          disabled={!notch.enabled}
          onChange={(e) => onChange({ ...notch, bandwidthHz: Number(e.target.value) })}
        />
      </label>
      <label>
        Attenuation (dB)
        <input
          type="number"
          min={1}
          max={80}
          step={1}
          value={notch.attenuationDb}
          disabled={!notch.enabled}
          onChange={(e) => onChange({ ...notch, attenuationDb: Number(e.target.value) })}
        />
      </label>
      <label>
        Harmonics
        <input
          type="number"
          min={0}
          max={65535}
          step={1}
          value={notch.harmonics}
          disabled={!notch.enabled}
          onChange={(e) => onChange({ ...notch, harmonics: Number(e.target.value) })}
        />
      </label>
    </fieldset>
  )
}

function FilterReviewResults({ result, onStageParam, stagedParams }: { result: FilterReviewResult; onStageParam: (param: string, value: number) => void; stagedParams?: ReadonlySet<string> }): ReactElement {
  const [activeAxis, setActiveAxis] = useState<ActiveAxis>('roll')
  const [filterParams, setFilterParams] = useState<FilterChainParams>(result.filterParams)

  const axisResult = result.axes.find((a) => a.axis === activeAxis)

  const paramDiff = useMemo(() => {
    const diffs: { param: string; from: number; to: number }[] = []
    const orig = result.filterParams
    if (filterParams.gyroLowPass.cutoffHz !== orig.gyroLowPass.cutoffHz)
      diffs.push({ param: 'INS_GYRO_FILTER', from: orig.gyroLowPass.cutoffHz, to: filterParams.gyroLowPass.cutoffHz })
    if (filterParams.notch1.enabled !== orig.notch1.enabled)
      diffs.push({ param: 'INS_HNTCH_ENABLE', from: orig.notch1.enabled ? 1 : 0, to: filterParams.notch1.enabled ? 1 : 0 })
    if (filterParams.notch1.centerFreqHz !== orig.notch1.centerFreqHz)
      diffs.push({ param: 'INS_HNTCH_FREQ', from: orig.notch1.centerFreqHz, to: filterParams.notch1.centerFreqHz })
    if (filterParams.notch1.bandwidthHz !== orig.notch1.bandwidthHz)
      diffs.push({ param: 'INS_HNTCH_BW', from: orig.notch1.bandwidthHz, to: filterParams.notch1.bandwidthHz })
    if (filterParams.notch1.attenuationDb !== orig.notch1.attenuationDb)
      diffs.push({ param: 'INS_HNTCH_ATT', from: orig.notch1.attenuationDb, to: filterParams.notch1.attenuationDb })
    if (filterParams.notch1.harmonics !== orig.notch1.harmonics)
      diffs.push({ param: 'INS_HNTCH_HMNCS', from: orig.notch1.harmonics, to: filterParams.notch1.harmonics })
    if (filterParams.notch2.enabled !== orig.notch2.enabled)
      diffs.push({ param: 'INS_HNTC2_ENABLE', from: orig.notch2.enabled ? 1 : 0, to: filterParams.notch2.enabled ? 1 : 0 })
    if (filterParams.notch2.centerFreqHz !== orig.notch2.centerFreqHz)
      diffs.push({ param: 'INS_HNTC2_FREQ', from: orig.notch2.centerFreqHz, to: filterParams.notch2.centerFreqHz })
    if (filterParams.notch2.bandwidthHz !== orig.notch2.bandwidthHz)
      diffs.push({ param: 'INS_HNTC2_BW', from: orig.notch2.bandwidthHz, to: filterParams.notch2.bandwidthHz })
    if (filterParams.notch2.attenuationDb !== orig.notch2.attenuationDb)
      diffs.push({ param: 'INS_HNTC2_ATT', from: orig.notch2.attenuationDb, to: filterParams.notch2.attenuationDb })
    if (filterParams.notch2.harmonics !== orig.notch2.harmonics)
      diffs.push({ param: 'INS_HNTC2_HMNCS', from: orig.notch2.harmonics, to: filterParams.notch2.harmonics })
    return diffs
  }, [filterParams, result.filterParams])

  return (
    <div className="filter-review__results" data-testid="filter-review-results">
      {result.warnings.length > 0 ? (
        <ul className="filter-review__warnings">
          {result.warnings.map((w) => <li key={w}>{w}</li>)}
        </ul>
      ) : null}

      <div className="filter-review__metrics">
        <article>
          <span>Source</span>
          <strong>{result.gyroSource === 'batch' ? `Batch (${result.sampleRateHz.toFixed(0)} Hz)` : `IMU (${result.sampleRateHz.toFixed(0)} Hz)`}</strong>
        </article>
        <article>
          <span>Gyro low-pass</span>
          <strong>{result.filterParams.gyroLowPass.cutoffHz} Hz</strong>
        </article>
        <article>
          <span>Notch 1</span>
          <strong>{result.filterParams.notch1.enabled ? `${result.filterParams.notch1.centerFreqHz} Hz` : 'off'}</strong>
        </article>
        <article>
          <span>Notch 2</span>
          <strong>{result.filterParams.notch2.enabled ? `${result.filterParams.notch2.centerFreqHz} Hz` : 'off'}</strong>
        </article>
      </div>

      <div className="filter-review__axis-tabs" data-testid="filter-review-axis-tabs">
        {(['roll', 'pitch', 'yaw'] as const).map((axis) => (
          <button
            key={axis}
            type="button"
            className={`filter-review__axis-tab${axis === activeAxis ? ' is-active' : ''}`}
            onClick={() => setActiveAxis(axis)}
          >
            {axis}
          </button>
        ))}
      </div>

      {axisResult ? (
        <div className="filter-review__chart-area" data-testid="filter-review-chart">
          <div className="filter-review__legend">
            <span className="filter-review__legend-swatch filter-review__legend-swatch--pre" />
            <span>Pre-filter</span>
            {axisResult.postFilter ? (
              <>
                <span className="filter-review__legend-swatch filter-review__legend-swatch--post" />
                <span>Post-filter (measured)</span>
              </>
            ) : null}
            <span className="filter-review__legend-swatch filter-review__legend-swatch--estimated" />
            <span>Estimated post-filter</span>
          </div>
          <SpectrumOverlay axisResult={axisResult} filterParams={filterParams} />
          <strong className="filter-review__section-label">Filter frequency response</strong>
          <FrequencyResponse filterParams={filterParams} />
        </div>
      ) : null}

      <div className="filter-review__controls" data-testid="filter-review-controls">
        <fieldset className="filter-review__lowpass-editor">
          <legend>Gyro low-pass filter</legend>
          <label>
            Cutoff (Hz)
            <input
              type="number"
              min={5}
              max={250}
              step={1}
              value={filterParams.gyroLowPass.cutoffHz}
              onChange={(e) => setFilterParams((p) => ({ ...p, gyroLowPass: { cutoffHz: Number(e.target.value) } }))}
            />
          </label>
        </fieldset>
        <NotchEditor
          label="Harmonic notch 1"
          notch={filterParams.notch1}
          onChange={(notch1) => setFilterParams((p) => ({ ...p, notch1 }))}
        />
        <NotchEditor
          label="Harmonic notch 2"
          notch={filterParams.notch2}
          onChange={(notch2) => setFilterParams((p) => ({ ...p, notch2 }))}
        />
        <div className="filter-review__actions">
          <button
            type="button"
            style={buttonStyle('secondary')}
            onClick={() => setFilterParams(result.filterParams)}
          >
            Reset to log values
          </button>
        </div>
      </div>

      {paramDiff.length > 0 ? (
        <div className="filter-review__diff" data-testid="filter-review-diff">
          <div className="filter-review__diff-header">
            <strong>Changed parameters</strong>
            <button
              type="button"
              style={buttonStyle('primary')}
              data-testid="filter-review-stage-all"
              onClick={() => paramDiff.forEach((d) => onStageParam(d.param, d.to))}
            >
              Stage all ({paramDiff.length})
            </button>
          </div>
          <table>
            <thead>
              <tr><th>Parameter</th><th>Log value</th><th>New value</th><th></th></tr>
            </thead>
            <tbody>
              {paramDiff.map((d) => {
                const staged = stagedParams?.has(d.param)
                return (
                  <tr key={d.param}>
                    <td><code>{d.param}</code></td>
                    <td>{d.from}</td>
                    <td><strong>{d.to}</strong></td>
                    <td>
                      <button
                        type="button"
                        style={buttonStyle(staged ? 'secondary' : 'primary')}
                        disabled={staged}
                        onClick={() => onStageParam(d.param, d.to)}
                      >
                        {staged ? 'Staged' : 'Stage'}
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  )
}

export function FilterReviewView({ onStageParam, stagedParams, onboardLogs }: FilterReviewViewProps): ReactElement {
  const [result, setResult] = useState<FilterReviewResult | null>(null)
  const [filename, setFilename] = useState<string | undefined>()
  const [error, setError] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)

  const handleBuffer = useCallback(async (buffer: ArrayBuffer, name: string) => {
    setBusy(true)
    setError(undefined)
    setResult(null)
    try {
      await new Promise((resolve) => setTimeout(resolve, 0))
      const analysis = analyzeFilterReviewBuffer(buffer)
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
    <section className="bf-gui-box filter-review" data-testid="filter-review">
      <div className="bf-gui-box__titlebar">
        <strong>Filter Review</strong>
        <StatusBadge tone="neutral">expert</StatusBadge>
      </div>
      <div className="bf-gui-box__body">
        <div className="filter-review__upload">
          <label className="filter-review__file" style={buttonStyle('primary')}>
            {busy ? 'Analyzing…' : 'Choose flight log (.bin)'}
            <input
              type="file"
              accept=".bin,application/octet-stream"
              data-testid="filter-review-file"
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
              testIdPrefix="filter-review"
              onBusy={setBusy}
              onBytes={(bytes, name) => handleBuffer(bytes.slice().buffer as ArrayBuffer, name)}
              onError={setError}
            />
          ) : null}
          {filename ? <small className="filter-review__filename">{filename}</small> : null}
        </div>

        <p className="feel-note">
          Upload a flight log with batch sampler data (INS_LOG_BAT_MASK). Pre+post filter logging (INS_LOG_BAT_OPT bit 1) gives a measured comparison.
        </p>

        {error ? (
          <div className="parameter-follow-up parameter-follow-up--danger" role="alert">
            <StatusBadge tone="danger">error</StatusBadge>
            <p>{error}</p>
          </div>
        ) : null}

        {result ? <FilterReviewResults result={result} onStageParam={onStageParam} stagedParams={stagedParams} /> : null}
      </div>
    </section>
  )
}
