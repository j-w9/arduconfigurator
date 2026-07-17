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

import { analyzeValtBuffer, type ValtResult } from '@arduconfig/log-analysis'
import type { ConfiguratorSnapshot } from '@arduconfig/ardupilot-core'
import { StatusBadge, buttonStyle } from '@arduconfig/ui-kit'

import { readParameterValue } from '../selectors/parameter-read'

export interface ValtCalibrationCardProps {
  snapshot: ConfiguratorSnapshot
  canApplyDraftParameters: boolean
  busyAction: string | undefined
  setDraft: (paramId: string, value: string) => void
}

export function ValtCalibrationCard({
  snapshot,
  canApplyDraftParameters,
  busyAction,
  setDraft
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

  const currentScale = readParameterValue(snapshot, 'BARO1_THST_SCALE')

  const runAnalysis = useCallback((buf: ArrayBuffer, manualTrueAltM?: number) => {
    try {
      const analysis = analyzeValtBuffer(buf, manualTrueAltM !== undefined ? { manualTrueAltM } : {})
      setResult(analysis)
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
        runAnalysis(buf) // auto: uses the rangefinder if the log has one
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Could not read or parse that log.')
      } finally {
        setBusy(false)
      }
    },
    [runAnalysis]
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
        (<code>BARO1_THST_SCALE</code>). Measured from a flight log — upload a steady hover. If the log has a
        downward rangefinder the scale is fit automatically against it; otherwise enter the height you hovered at
        and it's fit against that.
      </p>

      <div className="log-tuning__upload">
        <label className="log-tuning__file" style={buttonStyle('primary')}>
          {busy ? 'Analyzing…' : 'Choose hover log (.bin)'}
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
