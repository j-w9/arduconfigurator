// Tuning ▸ PID Gains: one grid, axes across (Roll | Pitch | Yaw), the gains
// down, in the order the signal travels — angle P (the outer loop) into the
// rate PID and its feedforward. The rarer rate-loop terms fold underneath, and
// so does scaling the whole tune. Presentational: App supplies values and
// staging (views/PilotFeel's FeelGrid and value shape).

import type { ReactElement } from 'react'
import { buttonStyle } from '@arduconfig/ui-kit'

import { FeelGrid, type PilotFeelValue } from './PilotFeel'

type AxisValues = [PilotFeelValue | undefined, PilotFeelValue | undefined, PilotFeelValue | undefined]

export interface PidScale {
  id: 'pi' | 'd' | 'ff' | 'pitch-ratio' | 'filter'
  label: string
  value: number
  min: number
  max: number
  onChange: (value: number) => void
}

export interface PidGainsViewProps {
  linked: boolean
  onLinkedChange: (linked: boolean) => void
  rows: { angleP: AxisValues; p: AxisValues; i: AxisValues; d: AxisValues; ff: AxisValues }
  more: { imax: AxisValues; dff: AxisValues; pdmax: AxisValues; smax: AxisValues }
  scale: {
    values: PidScale[]
    /** "Roll P: 0.11" style lines for what staging would change. */
    preview: string[]
    canStage: boolean
    isNeutral: boolean
    onReset: () => void
    onStage: () => void
  }
}

const AXES = ['Roll', 'Pitch', 'Yaw']

export function PidGainsView({ linked, onLinkedChange, rows, more, scale }: PidGainsViewProps): ReactElement {
  return (
    <section className="bf-gui-box pilot-feel-card" data-testid="pid-gains">
      <div className="bf-gui-box__titlebar">
        <strong>PID gains</strong>
      </div>
      <div className="bf-gui-box__body">
        <label className="pid-gains__link">
          <input
            type="checkbox"
            checked={linked}
            data-testid="tuning-roll-pitch-link-toggle"
            onChange={(event) => onLinkedChange(event.target.checked)}
          />{' '}
          Link roll &amp; pitch (an edit to one sets the other)
        </label>
        <FeelGrid
          testId="pid-gains-grid"
          columns={AXES}
          rows={[
            { label: 'Angle P', cells: rows.angleP },
            { label: 'Rate P', cells: rows.p },
            { label: 'Rate I', cells: rows.i },
            { label: 'Rate D', cells: rows.d },
            { label: 'Feedforward', cells: rows.ff }
          ]}
        />

        <details className="calibration-card__howto" data-testid="pid-gains-more">
          <summary data-testid="tuning-toggle-advanced-button">More rate-loop terms</summary>
          <FeelGrid
            testId="pid-gains-more-grid"
            columns={AXES}
            rows={[
              { label: 'I max', cells: more.imax },
              { label: 'D feedforward', cells: more.dff },
              { label: 'P + D max', cells: more.pdmax },
              { label: 'Slew max', cells: more.smax }
            ]}
          />
        </details>

        <details className="calibration-card__howto" data-testid="pid-gains-scale">
          <summary>Scale the whole tune</summary>
          <div className="pid-scale">
            {scale.values.map((item) => (
              <label key={item.id} className="pid-scale__item">
                <span>{item.label}</span>
                <span className="feel-input">
                  <input
                    type="number"
                    data-testid={`tuning-master-${item.id}-range`}
                    min={item.min}
                    max={item.max}
                    step={0.05}
                    value={item.value}
                    onChange={(event) => {
                      const next = Number(event.target.value)
                      if (Number.isFinite(next)) item.onChange(next)
                    }}
                  />
                  <span className="feel-input__unit">×</span>
                </span>
              </label>
            ))}
          </div>
          {scale.preview.length > 0 ? (
            <p className="feel-note" data-testid="pid-scale-preview">
              {scale.preview.slice(0, 9).join(' · ')}
              {scale.preview.length > 9 ? ` · +${scale.preview.length - 9} more` : ''}
            </p>
          ) : null}
          <div className="button-row">
            <button type="button" style={buttonStyle()} onClick={scale.onReset} disabled={scale.isNeutral}>
              Reset
            </button>
            <button
              type="button"
              style={buttonStyle('primary')}
              data-testid="tuning-stage-master-adjustments-button"
              onClick={scale.onStage}
              disabled={!scale.canStage}
            >
              Stage scaled values
            </button>
          </div>
        </details>
      </div>
    </section>
  )
}
