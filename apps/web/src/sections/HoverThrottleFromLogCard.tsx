// Measure MOT_THST_HOVER from a flight log.
//
// This is a NEW-AIRFRAME job, done once when a frame and powertrain are first
// put together -- which is why it is its own card rather than a step inside
// hover learning. Folding it in there made a two-flight calibration into a
// three-flight one for every vehicle that did not need it.
//
// It exists because ArduCopter's own learner can decline to run and say nothing
// about it: Copter::update_throttle_hover returns early in a manual-throttle
// mode, on a commanded climb, off level, or without a vertical-velocity
// estimate. A flight that misses any of those leaves MOT_THST_HOVER at exactly
// its 0.35 default, which is indistinguishable from a vehicle that has never
// flown -- and 0.35 is wildly wrong for a light quad, since the parameter is
// the controller's vertical feedforward.

import { useCallback, useState, type ReactElement } from 'react'
import { StatusBadge, buttonStyle } from '@arduconfig/ui-kit'

import { analyzeHoverThrottleBuffer, type HoverThrottleResult } from '@arduconfig/log-analysis'
import type { ConfiguratorSnapshot } from '@arduconfig/ardupilot-core'

export interface HoverThrottleFromLogCardProps {
  snapshot: ConfiguratorSnapshot
  canApplyDraftParameters: boolean
  busyAction: string | undefined
  setDraft: (paramId: string, value: string) => void
}

export function HoverThrottleFromLogCard({
  snapshot,
  canApplyDraftParameters,
  busyAction,
  setDraft
}: HoverThrottleFromLogCardProps): ReactElement | null {
  const [result, setResult] = useState<HoverThrottleResult | null>(null)
  const [logName, setLogName] = useState<string | undefined>()
  const [error, setError] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)

  const handleFile = useCallback(async (file: File) => {
    setBusy(true)
    setError(undefined)
    setResult(null)
    try {
      const buffer = await file.arrayBuffer()
      // Yield once so the button can paint "Reading…" before the parse blocks.
      await new Promise((resolve) => setTimeout(resolve, 0))
      setLogName(file.name)
      setResult(analyzeHoverThrottleBuffer(buffer))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not read or parse that log.')
    } finally {
      setBusy(false)
    }
  }, [])

  const canStage = canApplyDraftParameters && busyAction === undefined
  const live = snapshot.parameters.find((parameter) => parameter.id === 'MOT_THST_HOVER')
  const liveValue = typeof live?.value === 'number' ? live.value : undefined

  return (
    <article className="calibration-card" data-testid="calibration-card-hover-throttle-log">
      <div className="calibration-card__header">
        <strong>Hover throttle from a log</strong>
        <StatusBadge tone="neutral">new airframe</StatusBadge>
      </div>
      <p>
        Measures what this frame and powertrain actually hover at, from a flight you have already
        flown. Do it once when a new build first flies — after that the firmware keeps the value up
        to date on its own, and hover learning above is the routine calibration.
      </p>

      <div className="config-pills">
        <span data-tone={liveValue === undefined ? 'neutral' : 'success'}>
          MOT_THST_HOVER: {liveValue !== undefined ? liveValue.toFixed(3) : '—'}
        </span>
      </div>

      <div className="log-tuning__upload">
        <label className="log-tuning__file" style={buttonStyle('primary')}>
          {busy ? 'Reading…' : 'Choose hover log (.bin)'}
          <input
            type="file"
            accept=".bin,application/octet-stream"
            data-testid="hover-throttle-log-file"
            style={{ display: 'none' }}
            disabled={busy}
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void handleFile(file)
              event.target.value = ''
            }}
          />
        </label>
      </div>

      {error ? (
        <p className="switch-exercise-warning" data-testid="hover-throttle-log-error">
          {error}
        </p>
      ) : null}

      {result ? (
        <div className="bf-note" data-testid="hover-throttle-log-result">
          <strong>{logName}</strong>
          {result.hoverThrottle === undefined ? (
            <p>No steady hover in this log.</p>
          ) : (
            <>
              <p>
                Measured hover throttle <strong>{result.hoverThrottle.toFixed(3)}</strong>
                {result.standardDeviation !== undefined
                  ? ` (±${result.standardDeviation.toFixed(3)})`
                  : ''}{' '}
                over {result.totalHoverS.toFixed(0)} s of steady hover in {result.windows.length}{' '}
                segment{result.windows.length === 1 ? '' : 's'}
                {result.hoverModes.length > 0 ? `, flown in ${result.hoverModes.join(' / ')}` : ''}.
                {result.source === 'RATE' ? ' Source: RATE.AOut.' : ''}
              </p>
              {result.firmwareLearnedLast !== undefined ? (
                <p data-testid="hover-throttle-log-firmware">
                  The firmware&apos;s own MOT_THST_HOVER ended this flight at{' '}
                  {result.firmwareLearnedLast.toFixed(3)}
                  {result.firmwareLearnerIdle ? ' — it never moved.' : '.'}
                </p>
              ) : null}
              <button
                type="button"
                style={buttonStyle('primary')}
                data-testid="hover-throttle-log-stage"
                disabled={!canStage}
                onClick={() => setDraft('MOT_THST_HOVER', result.hoverThrottle!.toFixed(4))}
              >
                Stage MOT_THST_HOVER = {result.hoverThrottle.toFixed(3)}
              </button>
            </>
          )}
          {result.warnings.map((warning) => (
            <p key={warning} className="switch-exercise-warning">
              {warning}
            </p>
          ))}
        </div>
      ) : null}

      <small>
        {canStage
          ? 'Staged like any other change — nothing is written until you apply it.'
          : 'Connect and finish parameter sync first.'}
      </small>
    </article>
  )
}
