// Baro thrust-compensation (VALT) calibration card for the Calibration tab —
// Expert-gated, and shown only when a rangefinder is detected on the connected
// vehicle (CalibrationSection does that gating).
//
// A multirotor's prop wash lowers static pressure over the barometer as throttle
// rises, so the baro reads high under load. ArduPilot corrects this with
// BARO1_THST_SCALE (Pascals subtracted per unit throttle). We can't measure this
// live on the bench — it needs a real hover — so this is a LOG-based calibration:
// fly a steady hover (ideally at 2–3 heights) with a downward rangefinder, then
// upload that .bin here. The analyzer (@arduconfig/log-analysis) fits the scale
// from CTUN throttle/baro-altitude vs the rangefinder ground truth and stages
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
  const [filename, setFilename] = useState<string | undefined>()
  const [error, setError] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)
  const [staged, setStaged] = useState(false)

  const currentScale = readParameterValue(snapshot, 'BARO1_THST_SCALE')

  const handleFile = useCallback(async (file: File) => {
    setBusy(true)
    setError(undefined)
    setResult(null)
    setStaged(false)
    try {
      const buffer = await file.arrayBuffer()
      await new Promise((resolve) => setTimeout(resolve, 0))
      const analysis = analyzeValtBuffer(buffer)
      setResult(analysis)
      setFilename(file.name)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not read or parse that log.')
    } finally {
      setBusy(false)
    }
  }, [])

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
        (<code>BARO1_THST_SCALE</code>). This is measured from a flight log — upload a steady hover flown with a
        downward rangefinder and the scale is fit from baro altitude vs the rangefinder ground truth.
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
          <li>Fit a <strong>downward rangefinder</strong> and confirm it logs (RFND, orientation Down).</li>
          <li>Hover as steadily as you can at a fixed height in a stable mode, holding throttle constant for several seconds. Repeat at 2–3 different heights for a better fit.</li>
          <li>Download that flight's <code>.bin</code> log and upload it above.</li>
          <li>The scale is fit from baro altitude vs the rangefinder ground truth: <code>BARO1_THST_SCALE = −(baro_error_m × 12) / throttle</code>. Review the points, then <em>Stage</em> and apply in the draft bar.</li>
          <li>Re-fly and re-check that baro altitude holds steadier through throttle changes.</li>
        </ol>
      </details>
    </article>
  )
}
