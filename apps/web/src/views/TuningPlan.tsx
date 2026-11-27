import { useCallback, useState, type ReactElement } from 'react'

import {
  buildTuningPlanBuffer,
  type TuningPlanResult,
  type TuningStep,
  type StepStatus
} from '@arduconfig/log-analysis'
import { StatusBadge, buttonStyle } from '@arduconfig/ui-kit'

import { OnboardLogPicker, type OnboardLogPickerLogs } from '../sections/OnboardLogPicker'

export interface TuningPlanViewProps {
  onStageParam: (param: string, value: number) => void
  stagedParams?: ReadonlySet<string>
  onboardLogs?: OnboardLogPickerLogs
}

// ---------------------------------------------------------------------------
// Step status badge
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

// ---------------------------------------------------------------------------
// Step card
// ---------------------------------------------------------------------------

function StepCard({
  step,
  index,
  isCurrent,
  onStageParam,
  stagedParams
}: {
  step: TuningStep
  index: number
  isCurrent: boolean
  onStageParam: (param: string, value: number) => void
  stagedParams?: ReadonlySet<string>
}): ReactElement {
  const [expanded, setExpanded] = useState(isCurrent || step.status === 'now')

  return (
    <div
      className={`tuning-plan__step tuning-plan__step--${step.status}${isCurrent ? ' tuning-plan__step--current' : ''}`}
      data-testid={`tuning-plan-step-${step.id}`}
    >
      <button
        className="tuning-plan__step-header"
        onClick={() => setExpanded(!expanded)}
        type="button"
      >
        <span className="tuning-plan__step-number">{index + 1}</span>
        <span className="tuning-plan__step-title">{step.title}</span>
        <StatusBadge tone={statusTone(step.status)}>{statusLabel(step.status)}</StatusBadge>
        {step.alongside ? <StatusBadge tone="neutral">alongside</StatusBadge> : null}
      </button>

      {expanded ? (
        <div className="tuning-plan__step-body">
          <p className="tuning-plan__step-summary">{step.summary}</p>

          {step.why.length > 0 ? (
            <ul className="tuning-plan__step-why">
              {step.why.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          ) : null}

          {step.changes.length > 0 ? (
            <div className="tuning-plan__step-changes">
              <table className="tuning-plan__param-table">
                <thead>
                  <tr>
                    <th>Parameter</th>
                    <th>Current</th>
                    <th>Recommended</th>
                    <th>Note</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {step.changes.map(c => {
                    const isStaged = stagedParams?.has(c.param)
                    return (
                      <tr key={c.param} data-staged={isStaged || undefined}>
                        <td><code>{c.param}</code></td>
                        <td>{c.from !== null ? c.from : '–'}</td>
                        <td><strong>{c.to}</strong></td>
                        <td>{c.note}</td>
                        <td>
                          {step.status === 'now' ? (
                            <button
                              className="tuning-plan__stage-btn"
                              onClick={() => onStageParam(c.param, c.to)}
                              disabled={isStaged}
                              type="button"
                            >
                              {isStaged ? 'Staged' : 'Stage'}
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : null}

          {step.fly ? (
            <div className="tuning-plan__step-instruction">
              <strong>Fly:</strong> {step.fly}
            </div>
          ) : null}

          {step.verify ? (
            <div className="tuning-plan__step-instruction">
              <strong>Verify:</strong> {step.verify}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Param download
// ---------------------------------------------------------------------------

function downloadParamFile(lines: string[]): void {
  const text = lines.join('\n') + '\n'
  const blob = new Blob([text], { type: 'text/plain' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'tuning-plan.param'
  a.click()
  URL.revokeObjectURL(url)
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

function TuningPlanResults({
  result,
  onStageParam,
  stagedParams
}: {
  result: TuningPlanResult
  onStageParam: (param: string, value: number) => void
  stagedParams?: ReadonlySet<string>
}): ReactElement {
  const { steps, currentStepId, paramLines } = result

  const doneCount = steps.filter(s => s.status === 'done').length
  const nowCount = steps.filter(s => s.status === 'now').length
  const totalChanges = steps.filter(s => s.status === 'now').reduce((acc, s) => acc + s.changes.length, 0)

  return (
    <div className="tuning-plan__results">
      <div className="tuning-plan__summary-bar">
        <StatusBadge tone="success">{doneCount} done</StatusBadge>
        {nowCount > 0 ? <StatusBadge tone="danger">{nowCount} now</StatusBadge> : null}
        {totalChanges > 0 ? (
          <button
            className="tuning-plan__download"
            style={buttonStyle('secondary')}
            onClick={() => downloadParamFile(paramLines)}
            type="button"
          >
            Download {totalChanges} param changes
          </button>
        ) : null}
      </div>

      <div className="tuning-plan__steps">
        {steps.map((step, i) => (
          <StepCard
            key={step.id}
            step={step}
            index={i}
            isCurrent={step.id === currentStepId}
            onStageParam={onStageParam}
            stagedParams={stagedParams}
          />
        ))}
      </div>
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
      await new Promise((resolve) => setTimeout(resolve, 0))
      const plan = buildTuningPlanBuffer(buffer)
      setResult(plan)
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
        <strong>Tuning Plan</strong>
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
          Upload a flight log and get an ordered tuning plan: what to do now, what to verify, and what parameter changes to make. Steps gate on each other — fix the first before moving on.
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
