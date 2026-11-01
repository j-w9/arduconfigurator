// Filters step body: read a hover log, plan the harmonic notch from it, and
// stage the drafts. The judgement of what the vehicle has now lives in the
// step's criteria (view-models/notch-setup.ts); this card only reads the log
// and offers the plan.

import { useCallback, useState, type ReactElement } from 'react'
import { StatusBadge, buttonStyle } from '@arduconfig/ui-kit'
import { planNotchFromBuffer, type NotchPlanFromLog } from '@arduconfig/log-analysis'

import { OnboardLogPicker, type OnboardLogPickerLogs } from './OnboardLogPicker'
import type { NotchSetupPlan } from '../view-models/notch-setup'

export interface NotchFromLogCardProps {
  plan: NotchPlanFromLog | undefined
  logName: string | undefined
  setup: NotchSetupPlan
  onPlan: (plan: NotchPlanFromLog | undefined, logName: string | undefined) => void
  onStage: (drafts: Record<string, string>) => void
  canApplyDraftParameters: boolean
  busyAction: string | undefined
  editedValues: Record<string, string>
  onboardLogs?: OnboardLogPickerLogs
}

export function NotchFromLogCard({
  plan,
  logName,
  setup,
  onPlan,
  onStage,
  canApplyDraftParameters,
  busyAction,
  editedValues,
  onboardLogs
}: NotchFromLogCardProps): ReactElement {
  const [error, setError] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)

  const handleBuffer = useCallback(
    async (buffer: ArrayBuffer, name: string) => {
      setBusy(true)
      setError(undefined)
      try {
        await new Promise((resolve) => setTimeout(resolve, 0))
        onPlan(planNotchFromBuffer(buffer), name)
      } catch (caught) {
        onPlan(undefined, undefined)
        setError(caught instanceof Error ? caught.message : 'Could not read that log.')
      } finally {
        setBusy(false)
      }
    },
    [onPlan]
  )

  const draftIds = Object.keys(setup.drafts)
  const staged = draftIds.length > 0 && draftIds.every((id) => editedValues[id] !== undefined)
  const canStage = draftIds.length > 0 && setup.blockers.length === 0 && canApplyDraftParameters && busyAction === undefined && !staged

  return (
    <article className="calibration-card" data-testid="notch-from-log-card">
      <div className="calibration-card__header">
        <strong>Harmonic notch from the hover</strong>
        <StatusBadge tone={setup.source === 'esc' ? 'success' : setup.source === 'throttle' ? 'neutral' : 'warning'}>
          {setup.source === 'esc' ? 'ESC telemetry' : setup.source === 'throttle' ? 'from throttle' : 'needs a log'}
        </StatusBadge>
      </div>
      <p>{setup.summary}</p>
      <div className="log-tuning__upload">
        <label className="log-tuning__file" style={buttonStyle('secondary')}>
          {busy ? 'Reading…' : 'Choose the hover log (.bin)'}
          <input
            type="file"
            accept=".bin,application/octet-stream"
            data-testid="notch-log-file"
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
            testIdPrefix="notch-log"
            onBusy={setBusy}
            onBytes={(bytes, name) => handleBuffer(bytes.slice().buffer as ArrayBuffer, name)}
            onError={setError}
          />
        ) : null}
      </div>
      {error ? (
        <p className="switch-exercise-warning" data-testid="notch-log-error">
          {error}
        </p>
      ) : null}
      {plan && logName ? (
        <div className="bf-note" data-testid="notch-log-result">
          <strong>{logName}</strong>
          <p>
            {plan.hoverSeconds.toFixed(0)} s of steady hover
            {plan.hoverFundamentalHz !== undefined ? `, motors at ${plan.hoverFundamentalHz.toFixed(0)} Hz` : ''}
            {plan.gyroPeakHz !== undefined ? `, strongest gyro peak ${plan.gyroPeakHz.toFixed(0)} Hz on ${plan.gyroPeakAxis ?? 'gyro'}` : ''}
            {plan.hoverThrottle !== undefined ? `, hover throttle ${plan.hoverThrottle.toFixed(3)}` : ''}.
          </p>
          {plan.notes.length > 0 ? (
            <ul>
              {plan.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      {draftIds.length > 0 ? (
        <div className="config-pills" data-testid="notch-plan-drafts">
          {draftIds.map((id) => (
            <span key={id} data-tone={editedValues[id] !== undefined ? 'warning' : 'neutral'}>
              {id} → {setup.drafts[id]}
            </span>
          ))}
        </div>
      ) : null}
      {setup.blockers.length > 0 ? <p className="bf-note">{setup.blockers.join(' ')}</p> : null}
      <button
        type="button"
        style={buttonStyle('primary')}
        data-testid="notch-plan-stage"
        disabled={!canStage}
        onClick={() => onStage(setup.drafts)}
      >
        {staged ? 'Staged — apply to write it' : 'Stage the notch'}
      </button>
    </article>
  )
}
