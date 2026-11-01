// The Maiden Hover step's body: read the first flight's log (from disk or
// straight off the vehicle) and hand the analysis to the wizard, whose
// criteria are read from it. Presentational apart from the file read; the
// analysis is pure (@arduconfig/log-analysis).

import { useCallback, useState, type ReactElement } from 'react'
import { StatusBadge, buttonStyle } from '@arduconfig/ui-kit'
import { analyzeMaidenFlightBuffer, type MaidenFlightResult } from '@arduconfig/log-analysis'

import { OnboardLogPicker, type OnboardLogPickerLogs } from './OnboardLogPicker'

export interface MaidenFlightCardProps {
  result: MaidenFlightResult | undefined
  logName: string | undefined
  onResult: (result: MaidenFlightResult | undefined, logName: string | undefined) => void
  /** When given, the card also offers the logs already on the vehicle. */
  onboardLogs?: OnboardLogPickerLogs
}

export function MaidenFlightCard({ result, logName, onResult, onboardLogs }: MaidenFlightCardProps): ReactElement {
  const [error, setError] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)

  const handleBuffer = useCallback(
    async (buffer: ArrayBuffer, name: string) => {
      setBusy(true)
      setError(undefined)
      try {
        // Yield once so the button can paint "Reading…" before the parse blocks.
        await new Promise((resolve) => setTimeout(resolve, 0))
        onResult(analyzeMaidenFlightBuffer(buffer), name)
      } catch (caught) {
        onResult(undefined, undefined)
        setError(caught instanceof Error ? caught.message : 'Could not read that log.')
      } finally {
        setBusy(false)
      }
    },
    [onResult]
  )

  return (
    <article className="calibration-card" data-testid="maiden-flight-card">
      <div className="calibration-card__header">
        <strong>The first flight\u2019s log</strong>
        {result ? (
          <StatusBadge tone={result.verdict === 'clean' ? 'success' : result.verdict === 'review' ? 'warning' : 'neutral'}>
            {result.verdict === 'clean' ? 'clean' : result.verdict === 'review' ? `${result.findings.length} to look at` : 'no flight'}
          </StatusBadge>
        ) : null}
      </div>
      <div className="log-tuning__upload">
        <label className="log-tuning__file" style={buttonStyle('primary')}>
          {busy ? 'Reading…' : 'Choose the flight log (.bin)'}
          <input
            type="file"
            accept=".bin,application/octet-stream"
            data-testid="maiden-flight-log-file"
            style={{ display: 'none' }}
            disabled={busy}
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void file.arrayBuffer().then((buffer) => handleBuffer(buffer, file.name))
              event.target.value = ''
            }}
          />
        </label>
        {onboardLogs ? (
          <OnboardLogPicker
            onboardLogs={onboardLogs}
            busy={busy}
            testIdPrefix="maiden-flight-log"
            onBusy={setBusy}
            // Copy into a standalone ArrayBuffer: a view onto a larger
            // allocation would carry the rest with it.
            onBytes={(bytes, name) => handleBuffer(bytes.slice().buffer as ArrayBuffer, name)}
            onError={setError}
          />
        ) : null}
      </div>
      {error ? (
        <p className="switch-exercise-warning" data-testid="maiden-flight-log-error">
          {error}
        </p>
      ) : null}
      {result && logName ? (
        <div className="bf-note" data-testid="maiden-flight-log-result">
          <strong>{logName}</strong>
          {result.findings.length === 0 ? (
            <p>Stabilize, a rehearsed disarm, {result.airborneSeconds.toFixed(0)} s in the air, nothing reported. A clean first flight.</p>
          ) : (
            <ul>
              {result.findings.map((finding) => (
                <li key={finding}>{finding}</li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </article>
  )
}
