// Tuning ▸ Pilot: the stick-feel cards. Each card is a grid: columns are the
// axes (or climb/descent, moving/braking), rows the same settings, so the
// structure ArduPilot uses (a rate, an expo and a response per stick model;
// input-shaping.rst, AC_CommandModel) is the layout. Every value is a typed box
// with its unit; the firmware's named values sit beside it as a dropdown. A dot
// marks a value changed from the firmware default and resets it on click.
// Presentational: App supplies values, defaults and staging.

import { useState, type ReactElement, type ReactNode } from 'react'

import type { ParameterDraftStatus } from '@arduconfig/ardupilot-core'

import { ParamInfoBubble } from './ParamInfoBubble'
import {
  formatSeconds,
  inputExpo,
  isChangedFromDefault,
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
  /** The firmware default in display units, when the FC reported it. */
  defaultValue?: number
  /** Named values for the dropdown beside the box. */
  choices?: readonly NamedValue[]
  draftStatus?: ParameterDraftStatus
  min?: number
  max?: number
  onChange: (text: string) => void
  /** Small prefix when two values share a cell (Roll / Pitch). */
  tag?: string
  /** An enum with no meaningful number to type: the named list only. */
  selectOnly?: boolean
  /** A bitmask: one toggle per named bit instead of a number. */
  bits?: ReadonlyArray<{ bit: number; label: string }>
  /** A documented value worth one click (notch bandwidth = half the frequency). */
  suggestion?: { label: string; text: string }
}

function numberOf(value: PilotFeelValue | undefined): number | undefined {
  if (!value || value.text.trim() === '') return undefined
  const n = Number(value.text)
  return Number.isFinite(n) ? n : undefined
}

function formatDefault(value: number): string {
  return String(Number(value.toPrecision(6)))
}

function FeelInput({ value }: { value: PilotFeelValue }): ReactElement {
  const current = numberOf(value)
  const chosen = value.choices ? matchingChoice(value.choices, current) : undefined
  const changed = isChangedFromDefault(current, value.defaultValue)
  if (value.bits) {
    const mask = current !== undefined && Number.isInteger(current) ? current : 0
    return (
      <div className={`feel-input feel-input--bits feel-input--${value.draftStatus ?? 'unchanged'}`} data-testid={`pilot-feel-${value.paramId}`}>
        <div className="scoped-option-chips">
          {value.bits.map(({ bit, label }) => {
            const on = Math.floor(mask / 2 ** bit) % 2 === 1
            return (
              <button
                key={bit}
                type="button"
                className={`scoped-option-chip${on ? ' is-set' : ''}`}
                aria-pressed={on}
                data-testid={`pilot-feel-${value.paramId}-bit-${bit}`}
                onClick={() => value.onChange(String(on ? mask - 2 ** bit : mask + 2 ** bit))}
              >
                {label}
              </button>
            )
          })}
        </div>
        <ParamInfoBubble paramId={value.paramId} label={value.label} description={value.description} testId={`tuning-info-${value.paramId}`} />
      </div>
    )
  }
  if (value.selectOnly && value.choices) {
    return (
      <div className={`feel-input feel-input--${value.draftStatus ?? 'unchanged'}`} data-testid={`pilot-feel-${value.paramId}`}>
        <select
          className="feel-input__choice feel-input__choice--only"
          aria-label={value.label}
          data-testid={`tuning-input-${value.paramId}`}
          value={chosen ? String(chosen.value) : value.text}
          onChange={(event) => value.onChange(event.target.value)}
        >
          {chosen ? null : <option value={value.text}>{value.text === '' ? '—' : `Value ${value.text}`}</option>}
          {value.choices.map((choice) => (
            <option key={choice.value} value={String(choice.value)}>
              {choice.label}
            </option>
          ))}
        </select>
        {changed ? (
          <button
            type="button"
            className="feel-input__changed"
            data-testid={`pilot-feel-${value.paramId}-reset`}
            title={`Changed from the default (${formatDefault(value.defaultValue!)}). Click to reset.`}
            aria-label={`Reset ${value.label} to its default, ${formatDefault(value.defaultValue!)}`}
            onClick={() => value.onChange(formatDefault(value.defaultValue!))}
          />
        ) : null}
        <ParamInfoBubble paramId={value.paramId} label={value.label} description={value.description} testId={`tuning-info-${value.paramId}`} />
      </div>
    )
  }
  return (
    <div className={`feel-input feel-input--${value.draftStatus ?? 'unchanged'}`} data-testid={`pilot-feel-${value.paramId}`}>
      {value.tag ? <span className="feel-input__tag">{value.tag}</span> : null}
      <input
        type="number"
        aria-label={value.tag ? `${value.label} ${value.tag}` : value.label}
        data-testid={`tuning-input-${value.paramId}`}
        value={value.text}
        min={value.min}
        max={value.max}
        step="any"
        onChange={(event) => value.onChange(event.target.value)}
      />
      {value.unit ? <span className="feel-input__unit">{value.unit}</span> : null}
      {value.choices ? (
        <select
          className="feel-input__choice"
          aria-label={`${value.label} preset`}
          data-testid={`pilot-feel-${value.paramId}-choice`}
          value={chosen ? String(chosen.value) : ''}
          onChange={(event) => {
            if (event.target.value !== '') value.onChange(event.target.value)
          }}
        >
          {chosen ? null : <option value="">{value.choices.length === 1 ? 'Set value' : 'Custom'}</option>}
          {value.choices.map((choice) => (
            <option key={choice.value} value={String(choice.value)}>
              {choice.label}
            </option>
          ))}
        </select>
      ) : null}
      {changed ? (
        <button
          type="button"
          className="feel-input__changed"
          data-testid={`pilot-feel-${value.paramId}-reset`}
          title={`Changed from the default (${formatDefault(value.defaultValue!)}). Click to reset.`}
          aria-label={`Reset ${value.label} to its default, ${formatDefault(value.defaultValue!)}`}
          onClick={() => value.onChange(formatDefault(value.defaultValue!))}
        />
      ) : null}
      {value.suggestion && value.suggestion.text !== value.text ? (
        <button
          type="button"
          className="feel-input__suggest"
          data-testid={`pilot-feel-${value.paramId}-suggest`}
          onClick={() => value.onChange(value.suggestion!.text)}
        >
          {value.suggestion.label}
        </button>
      ) : null}
      <ParamInfoBubble paramId={value.paramId} label={value.label} description={value.description} testId={`tuning-info-${value.paramId}`} />
    </div>
  )
}

type Cell = PilotFeelValue | PilotFeelValue[] | undefined

export interface FeelGridRow {
  label: string
  cells: Cell[]
  /** One value for every column (PILOT_ACCEL_Z: climb and descent). */
  span?: boolean
}

function hasValue(cell: Cell): boolean {
  return Array.isArray(cell) ? cell.length > 0 : cell !== undefined
}

export function FeelGrid({
  columns,
  rows,
  footer,
  testId
}: {
  columns: string[]
  rows: FeelGridRow[]
  footer?: ReactNode[]
  testId: string
}): ReactElement | null {
  const live = rows.filter((row) => row.cells.some(hasValue))
  if (live.length === 0) return null
  const headed = columns.some((column) => column !== '')
  return (
    <div className="feel-grid" data-testid={testId} style={{ ['--feel-columns' as string]: columns.length }}>
      {headed ? (
        <div className="feel-grid__row feel-grid__row--head" aria-hidden="true">
          <span />
          {columns.map((column) => (
            <span key={column} className="feel-grid__column">
              {column}
            </span>
          ))}
        </div>
      ) : null}
      {live.map((row) => (
        <div key={row.label} className="feel-grid__row">
          <span className="feel-grid__label">{row.label}</span>
          {(row.span ? row.cells.slice(0, 1) : row.cells).map((cell, index) => (
            <div
              key={index}
              className={`feel-grid__cell${row.span ? ' feel-grid__cell--span' : ''}${cell === undefined ? ' feel-grid__cell--empty' : ''}`}
              data-column={headed ? (row.span ? columns.join(' & ') : columns[index]) : undefined}
            >
              {cell === undefined ? (
                <span className="feel-grid__none" aria-hidden="true">
                  —
                </span>
              ) : Array.isArray(cell) ? (
                cell.map((value) => <FeelInput key={value.paramId} value={value} />)
              ) : (
                <FeelInput value={cell} />
              )}
            </div>
          ))}
        </div>
      ))}
      {footer && footer.some(Boolean) ? (
        <div className="feel-grid__row feel-grid__row--foot">
          <span />
          {footer.map((node, index) => (
            <div key={index} className={`feel-grid__readout${node ? '' : ' feel-grid__cell--empty'}`} data-column={headed ? columns[index] : undefined}>
              {node}
            </div>
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

const CHART_W = 560
const CHART_H = 190
const PAD = { left: 44, right: 96, top: 20, bottom: 26 }

/** Stick (centre to full) against rate (deg/s). One axis, one unit; lines labelled at their ends. */
function StickCurveChart({ series, testId }: { series: CurveSeries[]; testId: string }): ReactElement {
  const [hover, setHover] = useState<number | undefined>(undefined)
  const maxRate = Math.max(1, ...series.map((s) => s.rate))
  const yTop = Math.ceil(maxRate / 90) * 90
  const plotW = CHART_W - PAD.left - PAD.right
  const plotH = CHART_H - PAD.top - PAD.bottom
  const x = (stick: number): number => PAD.left + stick * plotW
  const y = (rate: number): number => PAD.top + plotH - (rate / yTop) * plotH
  const ticks = [0, yTop / 2, yTop]
  // End labels, nudged apart when two rates are close.
  const ends = series.map((s) => ({ id: s.id, y: y(s.rate) }))
  if (ends.length === 2 && Math.abs(ends[0].y - ends[1].y) < 14) {
    const [high, low] = ends[0].y < ends[1].y ? [ends[0], ends[1]] : [ends[1], ends[0]]
    high.y -= 7
    low.y += 7
  }
  return (
    <figure className="pilot-feel-chart" data-testid={testId}>
      <svg
        viewBox={`0 0 ${CHART_W} ${CHART_H}`}
        role="img"
        aria-label={`Stick against rotation rate: ${series.map((s) => `${s.label} up to ${Math.round(s.rate)} deg/s`).join(', ')}`}
        onMouseMove={(event) => {
          const box = event.currentTarget.getBoundingClientRect()
          const stick = (((event.clientX - box.left) / box.width) * CHART_W - PAD.left) / plotW
          setHover(stick >= 0 && stick <= 1 ? stick : undefined)
        }}
        onMouseLeave={() => setHover(undefined)}
      >
        {ticks.map((tick) => (
          <g key={tick}>
            <line className="pilot-feel-chart__grid" x1={PAD.left} x2={PAD.left + plotW} y1={y(tick)} y2={y(tick)} />
            <text className="pilot-feel-chart__tick" x={PAD.left - 6} y={y(tick) + 3} textAnchor="end">
              {Math.round(tick)}
            </text>
          </g>
        ))}
        <text className="pilot-feel-chart__tick" x={PAD.left - 6} y={11} textAnchor="end">
          °/s
        </text>
        <text className="pilot-feel-chart__tick" x={PAD.left} y={CHART_H - 8}>
          centre
        </text>
        <text className="pilot-feel-chart__tick" x={PAD.left + plotW} y={CHART_H - 8} textAnchor="end">
          full stick
        </text>
        {series.map((s) => (
          <polyline
            key={s.id}
            className={`pilot-feel-chart__line pilot-feel-chart__line--${s.id}`}
            points={stickCurve(s.rate, s.expo)
              .map((p) => `${x(p.stick).toFixed(1)},${y(p.rate).toFixed(1)}`)
              .join(' ')}
          />
        ))}
        {series.map((s) => {
          const end = ends.find((e) => e.id === s.id)!
          return (
            <g key={`label-${s.id}`}>
              <line
                className={`pilot-feel-chart__line pilot-feel-chart__line--${s.id}`}
                x1={PAD.left + plotW + 6}
                x2={PAD.left + plotW + 16}
                y1={end.y}
                y2={end.y}
              />
              <text className="pilot-feel-chart__end" x={PAD.left + plotW + 20} y={end.y + 4}>
                {s.label}
              </text>
            </g>
          )
        })}
        {hover !== undefined ? (
          <line className="pilot-feel-chart__cross" x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + plotH} />
        ) : null}
      </svg>
      <figcaption className="pilot-feel-chart__legend" data-testid={`${testId}-readout`}>
        <span>{hover !== undefined ? `${Math.round(hover * 100)}% stick` : 'Full stick'}</span>
        {series.map((s) => (
          <span key={s.id} className="pilot-feel-chart__key">
            <i className={`pilot-feel-chart__swatch pilot-feel-chart__swatch--${s.id}`} aria-hidden="true" />
            {s.label} {Math.round(hover !== undefined ? s.rate * inputExpo(hover, s.expo) : s.rate)} °/s
          </span>
        ))}
      </figcaption>
    </figure>
  )
}

function Readout({ children, tone, testId }: { children: ReactNode; tone?: 'warning'; testId: string }): ReactElement {
  return (
    <span className={`feel-readout${tone ? ` feel-readout--${tone}` : ''}`} data-testid={testId}>
      {children}
    </span>
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
    /** One value when roll and pitch match, two (tagged) when they differ. */
    rpAccel: PilotFeelValue[]
    yAccel?: PilotFeelValue
  }
  altHold: {
    climb?: PilotFeelValue
    descent?: PilotFeelValue
    accel?: PilotFeelValue
    deadzone?: PilotFeelValue
    throttleFilter?: PilotFeelValue
    takeoffAlt?: PilotFeelValue
  }
  loiter: {
    speed?: PilotFeelValue
    accel?: PilotFeelValue
    maxLean?: PilotFeelValue
    brakeAccel?: PilotFeelValue
    brakeJerk?: PilotFeelValue
    brakeDelay?: PilotFeelValue
  }
  /** The altitude controller group (hover throttle, PSC gains), under Alt Hold. */
  altHoldControllerSlot?: ReactNode
}

export function PilotFeelView({ angle, acro, altHold, loiter, altHoldControllerSlot }: PilotFeelViewProps): ReactElement {
  const inputTc = numberOf(angle.inputTc)
  const yawRate = numberOf(angle.yawRate)
  const yawAccel = numberOf(acro.yAccel)
  const rollAccel = numberOf(acro.rpAccel[0])
  const rpRate = numberOf(acro.rpRate)
  const yRate = numberOf(acro.yRate)
  const pilotYawSeconds = secondsToRate(yawRate, yawAccel)
  const rollSeconds = secondsToRate(rpRate, rollAccel)
  const acroYawSeconds = secondsToRate(yRate, yawAccel)
  const acroSeries: CurveSeries[] = [
    ...(rpRate !== undefined ? [{ id: 'rp', label: 'Roll / pitch', rate: rpRate, expo: numberOf(acro.rpExpo) ?? 0 }] : []),
    ...(yRate !== undefined ? [{ id: 'y', label: 'Yaw', rate: yRate, expo: numberOf(acro.yExpo) ?? 0 }] : [])
  ]

  return (
    <div className="pilot-feel" data-testid="pilot-feel">
      <details className="bf-gui-box pilot-feel-card" data-testid="pilot-feel-angle" open>
        <summary className="bf-gui-box__titlebar">
          <strong>Angle modes</strong>
          <small className="pilot-feel-card__modes">Stabilize · AltHold · Loiter</small>
        </summary>
        <div className="bf-gui-box__body">
          <FeelGrid
            testId="pilot-feel-angle-grid"
            columns={['Roll / pitch', 'Yaw']}
            rows={[
              { label: 'Max', cells: [angle.lean, angle.yawRate] },
              { label: 'Expo', cells: [undefined, angle.yawExpo] },
              { label: 'Response', cells: [angle.inputTc, angle.yawRateTc] }
            ]}
            footer={[
              inputTc !== undefined && inputTc > 0 ? (
                <Readout testId="pilot-feel-lean-time">Full lean in ≈ {formatSeconds(inputTc * 3)}</Readout>
              ) : null,
              pilotYawSeconds !== undefined ? (
                yawRateOutrunsAccel(yawRate, yawAccel) ? (
                  <Readout tone="warning" testId="pilot-feel-yaw-time">
                    Full rate in {formatSeconds(pilotYawSeconds)}: limited by yaw accel. Try ≤ {Math.round((yawAccel ?? 0) / 2)} °/s.
                  </Readout>
                ) : (
                  <Readout testId="pilot-feel-yaw-time">Full rate in {formatSeconds(pilotYawSeconds)}</Readout>
                )
              ) : null
            ]}
          />
        </div>
      </details>

      <details className="bf-gui-box pilot-feel-card" data-testid="pilot-feel-acro" open>
        <summary className="bf-gui-box__titlebar">
          <strong>Acro</strong>
        </summary>
        <div className="bf-gui-box__body">
          <FeelGrid
            testId="pilot-feel-acro-grid"
            columns={['Roll / pitch', 'Yaw']}
            rows={[
              { label: 'Rate', cells: [acro.rpRate, acro.yRate] },
              { label: 'Expo', cells: [acro.rpExpo, acro.yExpo] },
              { label: 'Response', cells: [acro.rpRateTc, acro.yRateTc] },
              { label: 'Accel limit', cells: [acro.rpAccel.length > 0 ? acro.rpAccel : undefined, acro.yAccel] }
            ]}
            footer={[
              rollSeconds !== undefined ? <Readout testId="pilot-feel-roll-time">Full rate in {formatSeconds(rollSeconds)}</Readout> : null,
              acroYawSeconds !== undefined ? (
                <Readout testId="pilot-feel-acro-yaw-time">Full rate in {formatSeconds(acroYawSeconds)}</Readout>
              ) : null
            ]}
          />
          {acro.rpAccel.length > 0 || acro.yAccel ? (
            <p className="feel-note">Accel limits come from AutoTune. Lower them to soften; don&apos;t raise them past it.</p>
          ) : null}
          {acroSeries.length > 0 ? <StickCurveChart testId="pilot-feel-acro-chart" series={acroSeries} /> : null}
        </div>
      </details>

      <details className="bf-gui-box pilot-feel-card" data-testid="pilot-feel-althold">
        <summary className="bf-gui-box__titlebar">
          <strong>Alt Hold</strong>
        </summary>
        <div className="bf-gui-box__body">
          <FeelGrid
            testId="pilot-feel-althold-grid"
            columns={['Climb', 'Descent']}
            rows={[
              { label: 'Max speed', cells: [altHold.climb, altHold.descent] },
              { label: 'Accel (both)', cells: [altHold.accel], span: true }
            ]}
          />
          <FeelGrid
            testId="pilot-feel-althold-stick"
            columns={['']}
            rows={[
              { label: 'Throttle deadzone', cells: [altHold.deadzone] },
              { label: 'Throttle filter', cells: [altHold.throttleFilter] },
              { label: 'Takeoff altitude', cells: [altHold.takeoffAlt] }
            ]}
          />
          {altHoldControllerSlot}
        </div>
      </details>

      <details className="bf-gui-box pilot-feel-card" data-testid="pilot-feel-loiter">
        <summary className="bf-gui-box__titlebar">
          <strong>Loiter</strong>
        </summary>
        <div className="bf-gui-box__body">
          <FeelGrid
            testId="pilot-feel-loiter-grid"
            columns={['Moving', 'Braking']}
            rows={[
              { label: 'Accel', cells: [loiter.accel, loiter.brakeAccel] },
              { label: 'Max speed', cells: [loiter.speed, undefined] },
              { label: 'Max lean', cells: [loiter.maxLean, undefined] },
              { label: 'Jerk', cells: [undefined, loiter.brakeJerk] },
              { label: 'Delay', cells: [undefined, loiter.brakeDelay] }
            ]}
          />
        </div>
      </details>
    </div>
  )
}
