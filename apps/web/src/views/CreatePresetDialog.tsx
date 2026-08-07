// The "Create preset" dialog raised from the Parameter Editor's row selection.
//
// Presentational only: every value it shows and every decision it records is
// computed by the caller (ParametersSection) from
// view-models/preset-dependencies.ts. The one thing worth calling out about its
// shape is that the dependency questions arrive PRE-ANSWERED. An empty
// questionnaire gets skipped; a list of "we found 6 SERIAL3 params — does this
// preset depend on the port position? [x]" gets read, because the app has
// already done the work and is asking the operator to correct it.

import type { ReactElement } from 'react'

import { StatusBadge, buttonStyle } from '@arduconfig/ui-kit'

import { ParamInfoBubble } from './ParamInfoBubble'

export interface CreatePresetParam {
  id: string
  label: string
  description?: string
  /** Formatted live value that will be baked into the preset. */
  valueText: string
  /** Dropped by the operator — kept in the list, struck through, not saved. */
  excluded: boolean
}

export interface CreatePresetQuestion {
  classId: string
  label: string
  question: string
  rationale: string
  /** e.g. "6 parameters on SERIAL3" — what detection actually found. */
  detail: string
  checked: boolean
}

export interface CreatePresetDialogProps {
  /** Params that will be saved (selection minus exclusions). */
  params: readonly CreatePresetParam[]
  savedCount: number
  name: string
  onNameChange: (name: string) => void
  description: string
  onDescriptionChange: (description: string) => void
  questions: readonly CreatePresetQuestion[]
  onToggleQuestion: (classId: string) => void
  /**
   * Cell-count answer, rendered under the battery question. Empty string means
   * "not stated" — the preset then warns without a number rather than claiming
   * a cell count it does not have.
   */
  showCellCount: boolean
  cellCount: string
  onCellCountChange: (value: string) => void
  /** Params classified as per-board calibration, which are almost never wanted. */
  calibrationParamIds: readonly string[]
  rebootRequiredParamIds: readonly string[]
  /** Params matched by no rule — reported so the count in the header adds up. */
  unclassifiedCount: number
  onToggleParamExcluded: (paramId: string) => void
  onSave: () => void
  onCancel: () => void
}

export function CreatePresetDialog(props: CreatePresetDialogProps): ReactElement {
  const {
    params,
    savedCount,
    name,
    onNameChange,
    description,
    onDescriptionChange,
    questions,
    onToggleQuestion,
    showCellCount,
    cellCount,
    onCellCountChange,
    calibrationParamIds,
    rebootRequiredParamIds,
    unclassifiedCount,
    onToggleParamExcluded,
    onSave,
    onCancel
  } = props

  const canSave = name.trim().length > 0 && savedCount > 0

  return (
    <div
      className="app-modal-overlay"
      data-testid="create-preset-dialog"
      role="dialog"
      aria-modal="true"
      aria-label="Create preset"
      // Click-outside closes, matching the rest of the app's dismissable
      // surfaces. Guarded on the target being the overlay itself so a click
      // that started inside the panel never dismisses it.
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onCancel()
        }
      }}
    >
      <div className="create-preset">
        <header className="create-preset__header">
          <div>
            <h3>Create preset</h3>
            <p>
              Saves the current value of {savedCount} selected parameter{savedCount === 1 ? '' : 's'} as a reusable preset in the Presets
              tab. Nothing is written to the aircraft.
            </p>
          </div>
          <StatusBadge tone={savedCount > 0 ? 'neutral' : 'warning'}>{savedCount} params</StatusBadge>
        </header>

        <label className="create-preset__field">
          <span>Name</span>
          <input
            data-testid="create-preset-name"
            value={name}
            onChange={(event) => onNameChange(event.target.value)}
            placeholder="e.g. ARK Flow + 6S OSD"
            autoFocus
          />
        </label>

        <label className="create-preset__field">
          <span>What it is for</span>
          <input
            data-testid="create-preset-description"
            value={description}
            onChange={(event) => onDescriptionChange(event.target.value)}
            placeholder="e.g. OSD layout and rates for the 5in 6S build"
          />
        </label>

        {questions.length > 0 ? (
          <section className="create-preset__questions" data-testid="create-preset-questions">
            <strong>Does this preset depend on…</strong>
            <p className="create-preset__hint">
              Ticked answers are recorded on the preset and warn you before it is applied to an aircraft that differs. These are
              pre-answered from what the selection contains — untick anything that does not apply.
            </p>
            {questions.map((question) => (
              <div key={question.classId} className="create-preset__question">
                <label>
                  <input
                    type="checkbox"
                    data-testid={`create-preset-dependency-${question.classId}`}
                    checked={question.checked}
                    onChange={() => onToggleQuestion(question.classId)}
                  />
                  <span>
                    <strong>{question.label}</strong>
                    <small>{question.question}</small>
                  </span>
                </label>
                <small className="create-preset__question-detail">{question.detail}</small>
                <small className="create-preset__question-rationale">{question.rationale}</small>
                {question.classId === 'battery-pack' && showCellCount ? (
                  <label className="create-preset__cells">
                    <span>Pack cell count (S)</span>
                    <input
                      type="number"
                      min={2}
                      max={14}
                      step={1}
                      data-testid="create-preset-cell-count"
                      value={cellCount}
                      onChange={(event) => onCellCountChange(event.target.value)}
                      placeholder="e.g. 6"
                    />
                  </label>
                ) : null}
              </div>
            ))}
          </section>
        ) : null}

        {calibrationParamIds.length > 0 ? (
          <div className="parameter-follow-up parameter-follow-up--warning" data-testid="create-preset-calibration-warning">
            <StatusBadge tone="warning">calibration</StatusBadge>
            <p>
              {calibrationParamIds.length} selected parameter{calibrationParamIds.length === 1 ? ' is' : 's are'} per-board calibration
              (compass/accel offsets, thermal calibration, AHRS trims) and {calibrationParamIds.length === 1 ? 'has' : 'have'} been left
              out of the preset by default. These are measured on one physical board and are never valid on another. Press Keep on a row
              below if you meant to include it.
            </p>
          </div>
        ) : null}

        {rebootRequiredParamIds.length > 0 ? (
          <div className="parameter-follow-up" data-testid="create-preset-reboot-note">
            <StatusBadge tone="neutral">reboot</StatusBadge>
            <p>
              {rebootRequiredParamIds.length} parameter{rebootRequiredParamIds.length === 1 ? '' : 's'} in this preset need a reboot to
              take effect once applied.
            </p>
          </div>
        ) : null}

        <section className="create-preset__params">
          <header>
            <strong>Parameters</strong>
            <span>
              {savedCount} of {params.length} kept
              {unclassifiedCount > 0 ? ` · ${unclassifiedCount} matched no dependency rule` : ''}
            </span>
          </header>
          <div className="create-preset__param-list">
            {params.map((param) => (
              <div
                key={param.id}
                className={`create-preset__param${param.excluded ? ' create-preset__param--excluded' : ''}`}
              >
                <span className="create-preset__param-id">
                  <strong>{param.id}</strong>
                  <ParamInfoBubble
                    paramId={param.id}
                    label={param.label}
                    description={param.description}
                    testId={`create-preset-info-${param.id}`}
                  />
                </span>
                <span className="create-preset__param-label">{param.label}</span>
                <span className="create-preset__param-value">{param.valueText}</span>
                <button
                  type="button"
                  style={buttonStyle()}
                  data-testid={`create-preset-drop-${param.id}`}
                  onClick={() => onToggleParamExcluded(param.id)}
                  aria-pressed={param.excluded}
                  title={param.excluded ? `Put ${param.id} back in the preset.` : `Leave ${param.id} out of the preset.`}
                >
                  {param.excluded ? 'Keep' : 'Drop'}
                </button>
              </div>
            ))}
          </div>
        </section>

        <div className="button-row create-preset__actions">
          <button
            type="button"
            style={buttonStyle('primary')}
            data-testid="create-preset-save"
            onClick={onSave}
            disabled={!canSave}
            title={canSave ? undefined : 'Give the preset a name and keep at least one parameter.'}
          >
            Save preset
          </button>
          <button type="button" style={buttonStyle()} data-testid="create-preset-cancel" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
