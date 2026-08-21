// Baro thrust-compensation (VALT) calibration card for the Calibration tab —
// Expert-gated (CalibrationSection). Shows the n/a state on firmware without
// BARO1_THST_SCALE.
//
// A multirotor's prop wash lowers static pressure over the barometer as throttle
// rises, so the baro reads high under load. ArduPilot corrects this with
// BARO1_THST_SCALE (Pascals subtracted per unit throttle). We can't measure this
// live on the bench — it needs a real hover — so this is a LOG-based calibration:
// fly a steady hover, then upload that .bin here. The analyzer
// (@arduconfig/log-analysis) fits the scale from CTUN throttle/baro-altitude vs a
// ground-truth height — a downward rangefinder (RFND.Dist) when the log has one,
// otherwise a manually-entered measured hover height — and stages
// BARO1_THST_SCALE as a draft for the normal verified-write path.

import { useCallback, useState, type ReactElement } from 'react'

import {
  analyzeBaroThrustRamp,
  analyzeValtBuffer,
  type BaroThrustRampResult,
  type ValtResult
} from '@arduconfig/log-analysis'
import type { ConfiguratorSnapshot } from '@arduconfig/ardupilot-core'
import { StatusBadge, buttonStyle } from '@arduconfig/ui-kit'

import { readParameterValue } from '../selectors/parameter-read'

export interface ValtCalibrationCardProps {
  snapshot: ConfiguratorSnapshot
  canApplyDraftParameters: boolean
  busyAction: string | undefined
  setDraft: (paramId: string, value: string) => void
  /**
   * Where they are signed in, so the card says so rather than just being here.
   *
   * The card is only rendered when a log server IS signed in -- that gate lives
   * at the render site in CalibrationSection, so there is one of it.
   */
  logServerLabel?: string
}

export function ValtCalibrationCard({
  snapshot,
  canApplyDraftParameters,
  busyAction,
  setDraft,
  logServerLabel
}: ValtCalibrationCardProps): ReactElement {
  const [result, setResult] = useState<ValtResult | null>(null)
  // Keep the uploaded buffer so a manual-height entry can re-fit the same log
  // without re-uploading (logs without a rangefinder need a ground-truth height).
  const [buffer, setBuffer] = useState<ArrayBuffer | null>(null)
  const [filename, setFilename] = useState<string | undefined>()
  const [error, setError] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)
  const [staged, setStaged] = useState(false)
  const [manualHeight, setManualHeight] = useState('')
  /**
   * Which method the log is fitted with.
   *
   * The bench ramp is the default because it needs no altitude truth at all:
   * with the airframe physically restrained, every Pascal the baro moves after
   * throttle-up is the thrust effect, so the scale is just a slope. The hover
   * method needs a rangefinder or a measured height, and both of those are
   * things that can be wrong.
   */
  const [method, setMethod] = useState<'ramp' | 'hover'>('ramp')
  const [rampResult, setRampResult] = useState<BaroThrustRampResult | null>(null)

  const currentScale = readParameterValue(snapshot, 'BARO1_THST_SCALE')

  const runAnalysis = useCallback((buf: ArrayBuffer, manualTrueAltM?: number) => {
    try {
      const analysis = analyzeValtBuffer(buf, manualTrueAltM !== undefined ? { manualTrueAltM } : {})
      setResult(analysis)
      setRampResult(null)
      setStaged(false)
      setError(undefined)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not read or parse that log.')
    }
  }, [])

  const runRampAnalysis = useCallback((buf: ArrayBuffer) => {
    try {
      const analysis = analyzeBaroThrustRamp(buf)
      setRampResult(analysis)
      setResult(null)
      setStaged(false)
      setError(undefined)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not read or parse that log.')
    }
  }, [])

  const handleFile = useCallback(
    async (file: File) => {
      setBusy(true)
      setError(undefined)
      setResult(null)
      setStaged(false)
      setManualHeight('')
      try {
        const buf = await file.arrayBuffer()
        await new Promise((resolve) => setTimeout(resolve, 0))
        setBuffer(buf)
        setFilename(file.name)
        if (method === 'ramp') {
          runRampAnalysis(buf)
        } else {
          runAnalysis(buf) // auto: uses the rangefinder if the log has one
        }
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Could not read or parse that log.')
      } finally {
        setBusy(false)
      }
    },
    [method, runAnalysis, runRampAnalysis]
  )

  // BARO1_THST_SCALE is compiled out on some builds (AP_BARO_THST_COMP_ENABLED).
  // If the synced params don't include it, the firmware can't apply a scale.
  if (currentScale === undefined) {
    return (
      <article className="calibration-card" data-testid="calibration-card-valt">
        <div className="calibration-card__header">
          <strong>Baro thrust calibration (VALT)</strong>
          <StatusBadge tone="neutral">n/a</StatusBadge>
        </div>
        <p>
          This firmware doesn't expose the baro thrust-compensation parameter (<code>BARO1_THST_SCALE</code>). It's
          available on builds with barometer thrust compensation compiled in.
        </p>
      </article>
    )
  }

  const canStage = canApplyDraftParameters && busyAction === undefined
  const suggested = result?.suggestedScale

  return (
    <article className="calibration-card" data-testid="calibration-card-valt">
      <div className="calibration-card__header">
        <strong>Baro thrust calibration (VALT)</strong>
        <StatusBadge tone="neutral">{`now ${Number(currentScale.toFixed(1))} Pa`}</StatusBadge>
      </div>
      <p>
        Corrects the barometer altitude error that prop wash induces under throttle
        (<code>BARO1_THST_SCALE</code>), measured from a log.
      </p>

      {/* Two methods, and the difference is what they need to be true. The
        * bench ramp needs the airframe restrained; the hover method needs a
        * height that is right. The first is easier to guarantee, so it leads. */}
      <div className="switch-exercise-controls" data-testid="valt-method">
        {(
          [
            ['ramp', 'Bench ramp'],
            ['hover', 'Hover vs height']
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            style={buttonStyle(method === id ? 'primary' : 'secondary')}
            data-testid={`valt-method-${id}`}
            disabled={busy}
            onClick={() => {
              setMethod(id)
              setStaged(false)
              if (buffer) {
                if (id === 'ramp') {
                  runRampAnalysis(buffer)
                } else {
                  runAnalysis(buffer)
                }
              }
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="hint" data-testid="valt-method-hint">
        {method === 'ramp'
          ? 'Restrain the airframe — clamped, or held nose-down so the wash goes sideways and nothing lifts — then ramp the throttle in steps. Every Pascal the baro moves is thrust, so no height measurement is needed.'
          : 'Fly a steady hover. Fit against a downward rangefinder if the log has one, otherwise against the height you measured.'}
      </p>

      {logServerLabel ? (
        <p className="hint" data-testid="valt-log-server">
          Signed in to {logServerLabel}.
        </p>
      ) : null}

      <div className="log-tuning__upload">
        <label className="log-tuning__file" style={buttonStyle('primary')}>
          {busy ? 'Analyzing…' : method === 'ramp' ? 'Choose ramp log (.bin)' : 'Choose hover log (.bin)'}
          <input
            type="file"
            accept=".bin,application/octet-stream"
            data-testid="valt-file"
            style={{ display: 'none' }}
            disabled={busy}
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void handleFile(file)
              event.target.value = ''
            }}
          />
        </label>
        {filename ? <small className="log-tuning__filename">{filename}</small> : null}
      </div>

      {error ? (
        <div className="parameter-follow-up parameter-follow-up--danger" role="alert" data-testid="valt-error">
          <StatusBadge tone="danger">error</StatusBadge>
          <p>{error}</p>
        </div>
      ) : null}

      {rampResult ? (
        <div data-testid="valt-ramp-results">
          {rampResult.warnings.length > 0 ? (
            <ul className="log-tuning__warnings" data-testid="valt-ramp-warnings">
              {rampResult.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          ) : null}

          <p className="log-tuning__summary" data-testid="valt-ramp-summary">
            {rampResult.runs.length} run{rampResult.runs.length === 1 ? '' : 's'}, fitted at{' '}
            {rampResult.filterHz.toFixed(1)} Hz. Slope {rampResult.globalSlopePaPerThrottle.toFixed(0)} Pa per unit
            throttle
            {rampResult.hoverSlopePaPerThrottle !== undefined
              ? `, ${rampResult.hoverSlopePaPerThrottle.toFixed(0)} Pa in the hover band (${rampResult.hoverSamples} samples) — the recommendation comes from that, since one linear parameter cannot follow a bent response.`
              : '.'}
          </p>

          <div className="config-pills" data-testid="valt-ramp-pills">
            <span>Current: {Number(currentScale.toFixed(1))} Pa</span>
            <span data-tone="success">Suggested: {rampResult.recommendedScale} Pa</span>
            {rampResult.hoverErrorM !== undefined ? (
              <span>
                uncompensated at hover ≈ {rampResult.hoverErrorM >= 0 ? '+' : ''}
                {rampResult.hoverErrorM.toFixed(2)} m
              </span>
            ) : null}
            <span>
              best filter {rampResult.bestFilterHz.toFixed(1)} Hz
              {rampResult.currentFilterHz !== undefined ? ` (BARO_THST_FILT ${rampResult.currentFilterHz})` : ''}
            </span>
          </div>

          {/* The bucket column is the honest part: the response is usually
            * mildly convex, and this is where the operator sees whether the
            * single number they are about to set is right where they fly. */}
          {rampResult.runs[0]?.buckets.length ? (
            <details className="calibration-card__advanced" data-testid="valt-ramp-buckets">
              <summary>Per-throttle detail (run 1)</summary>
              <div className="parameter-reference">
                {rampResult.runs[0].buckets.map((bucket) => (
                  <div className="parameter-reference__row" key={bucket.throttleFrom}>
                    <div className="parameter-reference__head">
                      <code>
                        {bucket.throttleFrom.toFixed(2)}–{bucket.throttleTo.toFixed(2)}
                      </code>
                      <span className="parameter-reference__unit">{bucket.samples} samples</span>
                      <span className="parameter-reference__unit">
                        {bucket.meanDeltaPa >= 0 ? '+' : ''}
                        {bucket.meanDeltaPa.toFixed(1)} Pa
                      </span>
                      <span className="parameter-reference__unit">
                        {bucket.slopePaPerThrottle.toFixed(0)} Pa/thr
                      </span>
                      {bucket.isHoverBand ? <StatusBadge tone="success">hover</StatusBadge> : null}
                    </div>
                  </div>
                ))}
              </div>
            </details>
          ) : null}

          <button
            type="button"
            style={buttonStyle(staged ? 'secondary' : 'primary')}
            data-testid="valt-ramp-stage"
            disabled={!canStage || staged}
            onClick={() => {
              setDraft('BARO1_THST_SCALE', String(rampResult.recommendedScale))
              setStaged(true)
            }}
          >
            {staged ? 'Staged' : `Stage BARO1_THST_SCALE = ${rampResult.recommendedScale} Pa`}
          </button>
          {!canApplyDraftParameters ? <small>Finish parameter sync and disarm to stage.</small> : null}
          <small className="log-tuning__recs-note">
            Staged changes appear in the draft bar — nothing is written to the aircraft until you apply them.
          </small>
        </div>
      ) : null}

      {result ? (
        <div data-testid="valt-results">
          {result.warnings.length > 0 ? (
            <ul className="log-tuning__warnings" data-testid="valt-warnings">
              {result.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          ) : null}

          <p className="log-tuning__summary" data-testid="valt-summary">
            {result.summary}
          </p>

          {result.groundTruth !== 'rangefinder' && buffer ? (
            <div className="valt-manual" data-testid="valt-manual">
              <p className="bf-note">
                {result.groundTruth === 'manual'
                  ? 'Fit from your measured height. Adjust and re-fit if needed:'
                  : 'No downward rangefinder in this log — enter the height you actually hovered at to fit manually (best with a single steady hover at that height):'}
              </p>
              <div className="valt-manual__row">
                <label className="scoped-editor-field scoped-editor-field--compact">
                  <span>Measured hover height (m)</span>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    inputMode="decimal"
                    data-testid="valt-manual-height"
                    value={manualHeight}
                    onChange={(event) => setManualHeight(event.target.value)}
                  />
                </label>
                <button
                  type="button"
                  style={buttonStyle('secondary')}
                  data-testid="valt-manual-fit"
                  disabled={!(Number.parseFloat(manualHeight) > 0) || busy}
                  onClick={() => runAnalysis(buffer, Number.parseFloat(manualHeight))}
                >
                  Fit with manual height
                </button>
              </div>
            </div>
          ) : null}

          {result.points.length > 0 ? (
            <div className="config-pills" data-testid="valt-points">
              {result.points.map((p, i) => (
                <span key={i}>
                  {(p.throttle * 100).toFixed(0)}% · err {p.errorM >= 0 ? '+' : ''}
                  {p.errorM.toFixed(2)} m
                </span>
              ))}
            </div>
          ) : null}

          {result.usable && suggested !== undefined ? (
            <>
              <div className="config-pills">
                <span>Current: {Number(currentScale.toFixed(1))} Pa</span>
                <span data-tone="success">Suggested: {suggested} Pa</span>
              </div>
              <button
                type="button"
                style={buttonStyle(staged ? 'secondary' : 'primary')}
                data-testid="valt-stage"
                disabled={!canStage || staged}
                onClick={() => {
                  setDraft('BARO1_THST_SCALE', String(suggested))
                  setStaged(true)
                }}
              >
                {staged ? 'Staged' : `Stage BARO1_THST_SCALE = ${suggested} Pa`}
              </button>
              {!canApplyDraftParameters ? <small>Finish parameter sync and disarm to stage.</small> : null}
              <small className="log-tuning__recs-note">
                Staged changes appear in the draft bar — nothing is written to the aircraft until you apply them.
              </small>
            </>
          ) : null}
        </div>
      ) : null}

      <details className="calibration-card__howto">
        <summary>How to calibrate baro thrust scale (VALT, from a log)</summary>
        <p className="calibration-card__tip">
          <strong>Bench ramp (preferred).</strong> Restrain the airframe so the props cannot lift it — clamped down,
          or held nose-down so the wash goes sideways. Arm, sit at idle for a few seconds (that quiet pressure is the
          baseline), then step the throttle up through the range you fly, holding each step a second or two. Disarm,
          download the <code>.bin</code>, and upload it here. Nothing about height is measured or needed: with the
          airframe fixed, every Pascal the baro moves after throttle-up is thrust, so the scale is just the slope of
          pressure against filtered throttle. <em>The one thing the log cannot prove is that the aircraft was
          restrained</em> — a real hover reads identically to the accelerometer, so the analysis flags a run that
          looks like one and leaves the judgement to you.
        </p>
        <p className="calibration-card__tip">
          <strong>Hover vs height</strong>, when a bench ramp is not practical:
        </p>
        <ol>
          <li>Hover as steadily as you can at a fixed height in a stable mode, holding throttle constant for several seconds.</li>
          <li><strong>With a downward rangefinder</strong> (RFND, orientation Down): repeat at 2–3 heights for a better fit — it's fit automatically against the rangefinder.</li>
          <li><strong>Without a rangefinder</strong>: hover once at a <em>measured</em> height (tape/known height), then enter that height above — it's the ground truth for the fit.</li>
          <li>Download that flight's <code>.bin</code> log and upload it. The scale is fit as <code>BARO1_THST_SCALE = −(baro_error_m × 12) / throttle</code>. Review the points, then <em>Stage</em> and apply in the draft bar.</li>
          <li>Re-fly and re-check that baro altitude holds steadier through throttle changes.</li>
        </ol>
      </details>
    </article>
  )
}
