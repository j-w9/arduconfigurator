// Tuning ▸ Pilot: the stick-feel cards (Angle modes, Acro). Number boxes with
// units for every value, the firmware's named values as chips beside them, a
// stick curve per stick model, and the few readouts ArduPilot's input-shaping
// docs give. Presentational: App supplies values and staging.

import { useState, type ReactElement, type ReactNode } from 'react'

import type { ParameterDraftStatus } from '@arduconfig/ardupilot-core'

import { ParamInfoBubble } from './ParamInfoBubble'
import {
  EXPO_CHOICES,
  RESPONSE_TC_CHOICES,
  formatSeconds,
  inputExpo,
  matchingChoice,
  secondsToRate,
  stickCurve,
  yawRateOutrunsAccel,
  type NamedValue
} from '../view-models/pilot-feel'

/** One editable value, in the units it is shown in. */
export interface PilotFeelValue {
  paramId: string
  label: string
  description?: string
  unit?: string
  /** The box's text (draft or live), already in display units. */
  text: string
  draftStatus?: ParameterDraftStatus
  min?: number
  max?: number
  step?: number
  onChange: (text: string) => void
}

const RATE_TC_CHOICES: readonly NamedValue[] = [{ value: 0, label: 'Off' }, ...RESPONSE_TC_CHOICES]

function numberOf(value: PilotFeelValue | undefined): number | undefined {
  if (!value || value.text.trim() === '') return undefined
  const n = Number(value.text)
  return Number.isFinite(n) ? n : undefined
}

function FeelField({ value, choices }: { value: PilotFeelValue; choices?: readonly NamedValue[] }): ReactElement {
  const current = numberOf(value)
  const chosen = choices ? matchingChoice(choices, current) : undefined
  return (
    <div className={`pilot-feel-field pilot-feel-field--${value.draftStatus ?? 'unchanged'}`} data-testid={`pilot-feel-${value.paramId}`}>
      <div className="pilot-feel-field__label">
        <span>{value.label}</span>
        <ParamInfoBubble paramId={value.paramId} label={value.label} description={value.description} testId={`tuning-info-${value.paramId}`} />
      </div>
      <div className="pilot-feel-field__entry">
        <input
          type="number"
          aria-label={value.label}
          data-testid={`tuning-input-${value.paramId}`}
          value={value.text}
          min={value.min}
          max={value.max}
          step={value.step ?? 'any'}
          onChange={(event) => value.onChange(event.target.value)}
        />
        {value.unit ? <span className="tuning-control__unit">{value.unit}</span> : null}
      </div>
      {choices ? (
        <div className="scoped-option-chips pilot-feel-field__chips">
          {choices.map((choice) => (
            <button
              key={choice.value}
              type="button"
              className={`scoped-option-chip${chosen?.value === choice.value ? ' is-set' : ''}`}
              aria-pressed={chosen?.value === choice.value}
              data-testid={`pilot-feel-${value.paramId}-choice-${choice.value}`}
              onClick={() => value.onChange(String(choice.value))}
            >
              {choice.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

interface CurveSeries {
  id: string
  label: string
  rate: number
  expo: number
}

const CHART_W = 280
const CHART_H = 160
const PAD = { left: 40, right: 12, top: 20, bottom: 26 }

/** Stick (0-100 %) against rate (deg/s). One axis, one unit. */
function StickCurveChart({ series, testId }: { series: CurveSeries[]; testId: string }): ReactElement {
  const [hover, setHover] = useState<number | undefined>(undefined)
  const maxRate = Math.max(1, ...series.map((s) => s.rate))
  const yTop = Math.ceil(maxRate / 90) * 90
  const plotW = CHART_W - PAD.left - PAD.right
  const plotH = CHART_H - PAD.top - PAD.bottom
  const x = (stick: number): number => PAD.left + stick * plotW
  const y = (rate: number): number => PAD.top + plotH - (rate / yTop) * plotH
  const ticks = [0, yTop / 2, yTop]
  const curves = series.map((s) => ({ ...s, points: stickCurve(s.rate, s.expo) }))
  const hoverStick = hover
  return (
    <figure className="pilot-feel-chart" data-testid={testId}>
      <svg
        viewBox={`0 0 ${CHART_W} ${CHART_H}`}
        role="img"
        aria-label={`Stick against rotation rate: ${series.map((s) => `${s.label} up to ${Math.round(s.rate)} deg/s`).join(', ')}`}
        onMouseMove={(event) => {
          const box = event.currentTarget.getBoundingClientRect()
          const stick = ((event.clientX - box.left) / box.width * CHART_W - PAD.left) / plotW
          setHover(stick >= 0 && stick <= 1 ? stick : undefined)
        }}
        onMouseLeave={() => setHover(undefined)}
      >
        {ticks.map((tick) => (
          <g key={tick}>
            <line className="pilot-feel-chart__grid" x1={PAD.left} x2={CHART_W - PAD.right} y1={y(tick)} y2={y(tick)} />
            <text className="pilot-feel-chart__tick" x={PAD.left - 6} y={y(tick) + 3} textAnchor="end">
              {Math.round(tick)}
            </text>
          </g>
        ))}
        <text className="pilot-feel-chart__tick" x={PAD.left} y={CHART_H - 8}>0%</text>
        <text className="pilot-feel-chart__tick" x={CHART_W - PAD.right} y={CHART_H - 8} textAnchor="end">full stick</text>
        <text className="pilot-feel-chart__tick" x={PAD.left - 6} y={11} textAnchor="end">°/s</text>
        {curves.map((curve) => (
          <polyline
            key={curve.id}
            className={`pilot-feel-chart__line pilot-feel-chart__line--${curve.id}`}
            points={curve.points.map((p) => `${x(p.stick).toFixed(1)},${y(p.rate).toFixed(1)}`).join(' ')}
          />
        ))}
        {hoverStick !== undefined ? (
          <line className="pilot-feel-chart__cross" x1={x(hoverStick)} x2={x(hoverStick)} y1={PAD.top} y2={PAD.top + plotH} />
        ) : null}
      </svg>
      <figcaption className="pilot-feel-chart__legend">
        {hoverStick !== undefined ? <span>{Math.round(hoverStick * 100)}% stick:</span> : null}
        {curves.map((curve) => (
          <span key={curve.id} className="pilot-feel-chart__key">
            <i className={`pilot-feel-chart__swatch pilot-feel-chart__swatch--${curve.id}`} aria-hidden="true" />
            {curve.label}{' '}
            {Math.round(hoverStick !== undefined ? curve.rate * inputExpo(hoverStick, curve.expo) : curve.rate)} °/s
          </span>
        ))}
      </figcaption>
    </figure>
  )
}

export interface PilotFeelViewProps {
  angle: {
    lean?: PilotFeelValue
    inputTc?: PilotFeelValue
    yawRate?: PilotFeelValue
    yawExpo?: PilotFeelValue
    yawRateTc?: PilotFeelValue
  }
  acro: {
    rpRate?: PilotFeelValue
    rpExpo?: PilotFeelValue
    rpRateTc?: PilotFeelValue
    yRate?: PilotFeelValue
    yExpo?: PilotFeelValue
    yRateTc?: PilotFeelValue
  }
  /** Accel limits, deg/s². */
  limits: { roll?: PilotFeelValue; pitch?: PilotFeelValue; yaw?: PilotFeelValue }
  /** Draft badge for the cards, when anything is staged. */
  statusSlot?: ReactNode
}

function Readout({ children, tone, testId }: { children: ReactNode; tone?: 'warning'; testId: string }): ReactElement {
  return (
    <p className={`pilot-feel-readout${tone ? ` pilot-feel-readout--${tone}` : ''}`} data-testid={testId}>
      {children}
    </p>
  )
}

export function PilotFeelView({ angle, acro, limits, statusSlot }: PilotFeelViewProps): ReactElement {
  const inputTc = numberOf(angle.inputTc)
  const yawRate = numberOf(angle.yawRate)
  const yawAccel = numberOf(limits.yaw)
  const rollAccel = numberOf(limits.roll)
  const rpRate = numberOf(acro.rpRate)
  const yRate = numberOf(acro.yRate)
  const yawSeconds = secondsToRate(yawRate, yawAccel)
  const rollSeconds = secondsToRate(rpRate, rollAccel)
  const acroSeries: CurveSeries[] = [
    ...(rpRate !== undefined ? [{ id: 'rp', label: 'Roll/pitch', rate: rpRate, expo: numberOf(acro.rpExpo) ?? 0 }] : []),
    ...(yRate !== undefined ? [{ id: 'y', label: 'Yaw', rate: yRate, expo: numberOf(acro.yExpo) ?? 0 }] : [])
  ]
  const hasAcro = Object.values(acro).some(Boolean)
  const hasLimits = Object.values(limits).some(Boolean)

  return (
    <div className="pilot-feel" data-testid="pilot-feel">
      {statusSlot}
      <section className="bf-gui-box pilot-feel-card" data-testid="pilot-feel-angle">
        <div className="bf-gui-box__titlebar">
          <strong>Angle modes</strong>
          <small className="pilot-feel-card__modes">Stabilize, AltHold, Loiter</small>
        </div>
        <div className="bf-gui-box__body pilot-feel-card__body">
          <div className="pilot-feel-card__fields">
            {angle.lean ? <FeelField value={angle.lean} /> : null}
            {angle.inputTc ? <FeelField value={angle.inputTc} choices={RESPONSE_TC_CHOICES} /> : null}
            {inputTc !== undefined && inputTc > 0 ? (
              <Readout testId="pilot-feel-lean-time">Full lean in about {formatSeconds(inputTc * 3)}.</Readout>
            ) : null}
            {angle.yawRate ? <FeelField value={angle.yawRate} /> : null}
            {angle.yawExpo ? <FeelField value={angle.yawExpo} choices={EXPO_CHOICES} /> : null}
            {angle.yawRateTc ? <FeelField value={angle.yawRateTc} choices={RATE_TC_CHOICES} /> : null}
            {yawSeconds !== undefined ? (
              yawRateOutrunsAccel(yawRate, yawAccel) ? (
                <Readout tone="warning" testId="pilot-feel-yaw-time">
                  Full yaw rate takes {formatSeconds(yawSeconds)}. ArduPilot suggests yaw rate ≈ half the yaw accel limit
                  ({Math.round((yawAccel ?? 0) / 2)} °/s).
                </Readout>
              ) : (
                <Readout testId="pilot-feel-yaw-time">Full yaw rate in {formatSeconds(yawSeconds)}.</Readout>
              )
            ) : null}
          </div>
          {yawRate !== undefined ? (
            <StickCurveChart testId="pilot-feel-angle-chart" series={[{ id: 'y', label: 'Yaw', rate: yawRate, expo: numberOf(angle.yawExpo) ?? 0 }]} />
          ) : null}
        </div>
      </section>

      {hasAcro ? (
        <section className="bf-gui-box pilot-feel-card" data-testid="pilot-feel-acro">
          <div className="bf-gui-box__titlebar">
            <strong>Acro</strong>
          </div>
          <div className="bf-gui-box__body pilot-feel-card__body">
            <div className="pilot-feel-card__fields">
              {acro.rpRate ? <FeelField value={acro.rpRate} /> : null}
              {acro.rpExpo ? <FeelField value={acro.rpExpo} choices={EXPO_CHOICES} /> : null}
              {acro.rpRateTc ? <FeelField value={acro.rpRateTc} choices={RATE_TC_CHOICES} /> : null}
              {rollSeconds !== undefined ? (
                <Readout testId="pilot-feel-roll-time">Full roll rate in {formatSeconds(rollSeconds)}.</Readout>
              ) : null}
              {acro.yRate ? <FeelField value={acro.yRate} /> : null}
              {acro.yExpo ? <FeelField value={acro.yExpo} choices={EXPO_CHOICES} /> : null}
              {acro.yRateTc ? <FeelField value={acro.yRateTc} choices={RATE_TC_CHOICES} /> : null}
            </div>
            {acroSeries.length > 0 ? <StickCurveChart testId="pilot-feel-acro-chart" series={acroSeries} /> : null}
          </div>
        </section>
      ) : null}

      {hasLimits ? (
        <section className="bf-gui-box pilot-feel-card" data-testid="pilot-feel-limits">
          <div className="bf-gui-box__titlebar">
            <strong>Acceleration limits</strong>
          </div>
          <div className="bf-gui-box__body">
            <p className="pilot-feel-readout">Set by AutoTune. Lower them for a softer feel; don&apos;t raise them past what AutoTune found.</p>
            <div className="pilot-feel-card__fields pilot-feel-card__fields--row">
              {limits.roll ? <FeelField value={limits.roll} /> : null}
              {limits.pitch ? <FeelField value={limits.pitch} /> : null}
              {limits.yaw ? <FeelField value={limits.yaw} /> : null}
            </div>
          </div>
        </section>
      ) : null}
    </div>
  )
}
