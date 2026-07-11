import { useEffect, useState, type PointerEvent as ReactPointerEvent } from 'react'

import { Panel, StatusBadge, buttonStyle } from '@arduconfig/ui-kit'
import { RC_LOGIC_CONDITION_LABELS, isRcLogicLevelSelectFunction } from '@arduconfig/param-metadata'

import {
  RC_MIXER_TRACK_MAX_PWM,
  RC_MIXER_TRACK_MIN_PWM,
  computeBandGeometry,
  computeCursorPercent,
  type RcMixerAssignment,
  type RcMixerFunctionDefinition,
  type RcMixerFunctionDefinitionLookup
} from '../view-models/rc-mixer'

/** A condition/link term shown in the Logic section (no channel/PWM). */
export interface RcMixerLogicTerm {
  id: string
  sourceType: 'condition' | 'link'
  /** Condition id (condition) or watched AUX_FUNC (link). */
  sourceValue: number
  functionId: number
  inverted: boolean
  levelMode?: boolean
  outputLevel?: number
}

// Drag step (μs) — snap the range edges like Betaflight's 25 μs mode-range grid.
const RC_MIXER_DRAG_STEP = 25

function clampPwm(pwm: number): number {
  return Math.max(RC_MIXER_TRACK_MIN_PWM, Math.min(RC_MIXER_TRACK_MAX_PWM, pwm))
}
function snapPwm(pwm: number): number {
  return clampPwm(Math.round(pwm / RC_MIXER_DRAG_STEP) * RC_MIXER_DRAG_STEP)
}
/** Map a pointer's clientX to a PWM value along a track rail element. */
function pwmFromClientX(clientX: number, rail: HTMLElement): number {
  const rect = rail.getBoundingClientRect()
  const fraction = rect.width > 0 ? (clientX - rect.left) / rect.width : 0
  const bounded = Math.max(0, Math.min(1, fraction))
  return RC_MIXER_TRACK_MIN_PWM + bounded * (RC_MIXER_TRACK_MAX_PWM - RC_MIXER_TRACK_MIN_PWM)
}

type RcMixerDragEdge = 'low' | 'high' | 'move'
interface RcMixerDragState {
  assignmentId: string
  edge: RcMixerDragEdge
  rail: HTMLElement
  /** Values at grab time, so a "move" drag preserves width without drift. */
  low: number
  high: number
  grabPwm: number
}

// PHASE 0 — UI scaffold for the BF-style "multiple functions per RC channel
// with PWM ranges" mixer. ArduPilot does not yet support this model at the
// parameter / MAVLink level, so this view never writes to the vehicle.
// The chart visualizer below mirrors the pattern used by views/Vtx.tsx's
// "Table not available" callout: surface the desired UX in full alongside
// a permanent badge naming the ArduPilot gap, so reviewers see both what
// we want AND why it's not live yet.

// Three reference ticks across the 800..2200 μs span — matches the values
// a typical FrSky/Crossfire transmitter calibrates against (1000 low end,
// 1500 centre, 2000 high end).
const TRACK_TICKS = [
  RC_MIXER_TRACK_MIN_PWM,
  1000,
  1500,
  2000,
  RC_MIXER_TRACK_MAX_PWM
] as const

// Six bands cycle through these hues so multiple assignments on the same
// channel are visually distinct without needing a per-function colour map.
const BAND_HUES = [210, 285, 30, 150, 0, 60] as const

/** Human display for a @VTX power level. `value` is the protocol value — mW for
 *  Tramp/MSP but dBm/index for SmartAudio — so prefer the author-set label and
 *  append "mW" only when the label is a bare number (a real milliwatt figure). */
function powerLevelDisplay(level: { mw: number; label: string }): string {
  const label = level.label?.trim()
  if (label) {
    return /^\d+$/.test(label) ? `${label} mW` : label
  }
  return `${level.mw} mW`
}

/** The VTX-power level selector shared by range rows and logic terms. Only shown
 *  for a VTX-power target on the firmware-backed path. Handles three edge cases
 *  the audit flagged: an out-of-range stored index (adds a synthetic option so
 *  the row doesn't silently read "Full power"), and a stored level with NO
 *  detected table (surfaces it with a reset instead of leaving it invisible). */
function VtxLevelSelector(props: {
  functionId: number
  levelMode: boolean | undefined
  outputLevel: number | undefined
  vtxPowerLevels: readonly { index: number; mw: number; label: string }[] | undefined
  firmwareSupported: boolean
  testId: string
  onChange: (patch: { levelMode: boolean; outputLevel?: number }) => void
}) {
  const { functionId, levelMode, outputLevel, vtxPowerLevels, firmwareSupported, testId, onChange } = props
  if (!firmwareSupported || !isRcLogicLevelSelectFunction(functionId)) {
    return null
  }
  const level = outputLevel ?? 0
  if (!vtxPowerLevels || vtxPowerLevels.length === 0) {
    // No VTX table detected. Don't offer a picker with no options — but if a
    // level is already stored, surface it (else it's invisible + uneditable).
    if (!levelMode) {
      return null
    }
    return (
      <div className="rc-mixer-vtx-level-note" data-testid={`${testId}-notable`}>
        <small>⚠ Level {level} set — no VTX table detected.</small>
        <button type="button" style={buttonStyle()} onClick={() => onChange({ levelMode: false })}>
          Reset to full power
        </button>
      </div>
    )
  }
  const outOfRange = levelMode === true && !vtxPowerLevels.some((entry) => entry.index === level)
  return (
    <label className="rc-mixer-assignment__position">
      <span>VTX power</span>
      <select
        value={levelMode ? String(level) : 'plain'}
        onChange={(event) => {
          const raw = event.target.value
          onChange(raw === 'plain' ? { levelMode: false } : { levelMode: true, outputLevel: Number(raw) })
        }}
        data-testid={testId}
      >
        <option value="plain">Full power (on/off) — max</option>
        {vtxPowerLevels.map((entry) => (
          <option key={entry.index} value={String(entry.index)}>
            {powerLevelDisplay(entry)}
          </option>
        ))}
        {outOfRange ? <option value={String(level)}>level {level} (not in current table)</option> : null}
      </select>
    </label>
  )
}

export interface RcMixerViewProps {
  /** RC channels 1..maxChannel, each with zero or more assignments. */
  channels: readonly { channel: number; assignments: readonly RcMixerAssignment[] }[]
  /** Full function catalog; the picker iterates this directly. */
  functionCatalog: readonly RcMixerFunctionDefinition[]
  /** Lookup helper so each row can show a human label without a linear scan. */
  functionLookup: RcMixerFunctionDefinitionLookup
  /** Live PWM by channel index (1..16), if RC link is verified. */
  livePwmByChannel?: ReadonlyMap<number, number>
  /** True when the FC is reporting live RC channel data. */
  rcLinkLive: boolean
  /** Add a new assignment to the given channel with a sensible default function. */
  onAddAssignment: (channel: number) => void
  /** Remove an assignment by id. */
  onRemoveAssignment: (assignmentId: string) => void
  /** Mutate any field on an assignment. Partial so each control can submit
   * only what it owns. */
  onUpdateAssignment: (assignmentId: string, patch: Partial<RcMixerAssignment>) => void
  /** True when the connected firmware reports the AP_RC_Logic engine (RCL_*) —
   *  switches this view from a local preview to a real, param-backed editor. */
  firmwareSupported: boolean
  /** RCL_ENABLE state (only meaningful when firmwareSupported). */
  engineEnabled?: boolean
  onToggleEngine?: (enabled: boolean) => void
  /** Condition/link terms — shown in the Logic section below the channels. */
  logicTerms?: readonly RcMixerLogicTerm[]
  /** Add a new (condition) logic term. */
  onAddLogicTerm?: () => void
  /** Remove a logic term by id. */
  onRemoveLogicTerm?: (id: string) => void
  /** Mutate any field on a logic term. */
  onUpdateLogicTerm?: (id: string, patch: Partial<RcMixerLogicTerm>) => void
  /** True when every RCL term slot is in use — the "Add function" buttons stop. */
  tableFull?: boolean
  /** Per-channel claims from OTHER subsystems (flight-mode switch, RCn_OPTION
   *  aux functions) so the operator sees a channel is already in use before
   *  layering an RC Mixer term on it. Keyed by channel number. */
  externalClaimByChannel?: ReadonlyMap<number, readonly string[]>
  /** Non-zero @VTX power levels in table order (0-based index = the value stored
   *  in RCL OPT bits 5-7). Drives the VTX_POWER level selector; absent when no
   *  VTX table is detected. */
  vtxPowerLevels?: readonly { index: number; mw: number; label: string }[]
}

export function RcMixerView(props: RcMixerViewProps) {
  const {
    channels,
    functionCatalog,
    functionLookup,
    livePwmByChannel,
    rcLinkLive,
    onAddAssignment,
    onRemoveAssignment,
    onUpdateAssignment,
    firmwareSupported,
    engineEnabled,
    onToggleEngine,
    logicTerms,
    onAddLogicTerm,
    onRemoveLogicTerm,
    onUpdateLogicTerm,
    tableFull,
    externalClaimByChannel,
    vtxPowerLevels
  } = props

  // Human "resolved VTX power" for a level-select row: the picked table level's
  // mW, or "max" for the plain (non-level) full-power on/off mode. Returns null
  // for non-VTX functions so callers can skip the suffix.
  const resolveVtxPowerLabel = (
    functionId: number,
    levelMode: boolean | undefined,
    outputLevel: number | undefined
  ): string | null => {
    if (!isRcLogicLevelSelectFunction(functionId) || !vtxPowerLevels || vtxPowerLevels.length === 0) {
      return null
    }
    if (!levelMode) {
      return 'max'
    }
    const level = vtxPowerLevels.find((entry) => entry.index === (outputLevel ?? 0))
    return level ? powerLevelDisplay(level) : `level ${outputLevel ?? 0}`
  }

  // Drag-to-resize the PWM range bands (Betaflight-style). The band edges and the
  // band body are pointer targets; movement maps clientX -> PWM and stages the
  // change through onUpdateAssignment (same path as the manual inputs).
  const [drag, setDrag] = useState<RcMixerDragState | null>(null)

  useEffect(() => {
    if (!drag) {
      return
    }
    const { assignmentId, edge, rail, low, high, grabPwm } = drag
    function handleMove(event: PointerEvent): void {
      const pwm = snapPwm(pwmFromClientX(event.clientX, rail))
      if (edge === 'low') {
        onUpdateAssignment(assignmentId, { lowPwm: Math.min(pwm, high - RC_MIXER_DRAG_STEP) })
      } else if (edge === 'high') {
        onUpdateAssignment(assignmentId, { highPwm: Math.max(pwm, low + RC_MIXER_DRAG_STEP) })
      } else {
        const width = high - low
        const nextLow = clampPwm(Math.min(low + (pwm - grabPwm), RC_MIXER_TRACK_MAX_PWM - width))
        onUpdateAssignment(assignmentId, { lowPwm: nextLow, highPwm: nextLow + width })
      }
    }
    function end(): void {
      setDrag(null)
    }
    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
    return () => {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
    }
  }, [drag, onUpdateAssignment])

  function beginDrag(event: ReactPointerEvent, assignment: RcMixerAssignment, edge: RcMixerDragEdge): void {
    const rail = (event.currentTarget as HTMLElement).closest('.rc-mixer-track__rail')
    if (!(rail instanceof HTMLElement)) {
      return
    }
    event.preventDefault()
    if (edge !== 'move') {
      event.stopPropagation() // an edge-handle grab must not also move the band
    }
    setDrag({
      assignmentId: assignment.id,
      edge,
      rail,
      low: assignment.lowPwm,
      high: assignment.highPwm,
      grabPwm: pwmFromClientX(event.clientX, rail)
    })
  }

  // Keyboard nudge on a range edge — accessibility parity with the drag handles.
  function nudgeEdge(assignment: RcMixerAssignment, edge: 'low' | 'high', deltaSteps: number): void {
    const delta = deltaSteps * RC_MIXER_DRAG_STEP
    if (edge === 'low') {
      onUpdateAssignment(assignment.id, {
        lowPwm: clampPwm(Math.min(assignment.lowPwm + delta, assignment.highPwm - RC_MIXER_DRAG_STEP))
      })
    } else {
      onUpdateAssignment(assignment.id, {
        highPwm: clampPwm(Math.max(assignment.highPwm + delta, assignment.lowPwm + RC_MIXER_DRAG_STEP))
      })
    }
  }

  return (
    <div id="setup-panel-rc-mixer">
      <Panel
        title="RC Option Mixer"
        subtitle={
          firmwareSupported
            ? 'Activate ArduPilot AUX functions from RC channel PWM ranges (AP_RC_Logic). Edits stage as RCL_* parameter drafts.'
            : 'Assign multiple ArduPilot AUX functions per RC channel with independent PWM activation ranges. Preview only — not yet wired to the vehicle.'
        }
      >
        {firmwareSupported ? (
          <div className="rc-mixer-engine" data-testid="rc-mixer-engine-controls">
            <label className="rc-mixer-engine__toggle">
              <input
                type="checkbox"
                checked={engineEnabled ?? false}
                onChange={(event) => onToggleEngine?.(event.target.checked)}
                data-testid="rc-mixer-engine-enable"
              />
              <span>
                <strong>RC logic engine</strong> ({engineEnabled ? 'enabled' : 'disabled'}) — <code>RCL_ENABLE</code>
              </span>
            </label>
            <p className="bf-note">
              This firmware reports the AP_RC_Logic engine. Each channel row is a real range term; changes are staged as{' '}
              <code>RCL_*</code> parameter drafts and written through the normal verified write path. Condition and link
              terms live in the Logic section below.
            </p>
          </div>
        ) : (
          <>
            <div className="rc-mixer-callout" data-testid="rc-mixer-ardupilot-gap-callout">
              <StatusBadge tone="warning">Not available in ArduPilot</StatusBadge>
              <p>
                ArduPilot's <code>RCn_OPTION</code> binds one AUX function per channel with no PWM window — there's no
                multi-function-per-channel model and no per-function activation range. This view ships the desired UX so
                it can be reviewed alongside ArduPilot development. The day ArduPilot grows that support (the
                <code>RCL_*</code> AP_RC_Logic family), this box turns into a real editor instead of staying a preview.
              </p>
            </div>

            <div className="bf-note" data-testid="rc-mixer-scaffold-banner">
              <p>
                <strong>Local-only preview.</strong> Edits below stay in the browser; nothing is sent to the vehicle.
              </p>
            </div>
          </>
        )}

        <div className="rc-mixer-stack">
          {channels.map(({ channel, assignments }) => {
            const livePwm = livePwmByChannel?.get(channel)
            const cursorPercent = computeCursorPercent(livePwm)
            return (
              <article key={channel} className="rc-mixer-channel" data-testid={`rc-mixer-channel-${channel}`}>
                <header className="rc-mixer-channel__header">
                  <div>
                    <strong>Channel {channel}</strong>
                    <small>{assignments.length === 0 ? 'No assignments' : `${assignments.length} assigned`}</small>
                    {firmwareSupported && externalClaimByChannel?.get(channel)?.length ? (
                      <small
                        className="rc-mixer-channel__external-claim"
                        data-testid={`rc-mixer-channel-claim-${channel}`}
                        title="This channel is already used by another subsystem. Layering an RC Mixer term here stacks on top of it."
                      >
                        ⚠ Also used by: {externalClaimByChannel.get(channel)!.join(', ')}
                      </small>
                    ) : null}
                  </div>
                  <div className="rc-mixer-channel__header-right">
                    {typeof livePwm === 'number' ? (
                      <StatusBadge tone={rcLinkLive ? 'success' : 'neutral'}>
                        Live {livePwm} μs
                      </StatusBadge>
                    ) : null}
                    <button
                      type="button"
                      style={buttonStyle()}
                      onClick={() => onAddAssignment(channel)}
                      disabled={firmwareSupported && tableFull}
                      title={firmwareSupported && tableFull ? 'All 12 RC logic terms are in use.' : undefined}
                      data-testid={`rc-mixer-add-channel-${channel}`}
                    >
                      + Add function
                    </button>
                  </div>
                </header>

                <div
                  className={`rc-mixer-track${assignments.length === 0 ? ' rc-mixer-track--empty' : ''}`}
                  data-testid={`rc-mixer-track-${channel}`}
                >
                  <div className="rc-mixer-track__rail">
                    {TRACK_TICKS.map((tick) => {
                      const pct = ((tick - RC_MIXER_TRACK_MIN_PWM) / (RC_MIXER_TRACK_MAX_PWM - RC_MIXER_TRACK_MIN_PWM)) * 100
                      return (
                        <span
                          key={tick}
                          className="rc-mixer-track__tick"
                          style={{ left: `${pct}%` }}
                          aria-hidden="true"
                        >
                          <em>{tick}</em>
                        </span>
                      )
                    })}
                    {assignments.map((assignment, index) => {
                      const definition = functionLookup.byId.get(assignment.functionId)
                      const { leftPercent, widthPercent } = computeBandGeometry(assignment.lowPwm, assignment.highPwm)
                      const hue = BAND_HUES[index % BAND_HUES.length]
                      const active =
                        cursorPercent !== undefined &&
                        (assignment.inverted
                          ? cursorPercent < leftPercent || cursorPercent > leftPercent + widthPercent
                          : cursorPercent >= leftPercent && cursorPercent <= leftPercent + widthPercent)
                      const className = [
                        'rc-mixer-track__band',
                        assignment.inverted ? 'rc-mixer-track__band--inverted' : '',
                        active ? 'rc-mixer-track__band--active' : ''
                      ]
                        .filter(Boolean)
                        .join(' ')
                      return (
                        <span
                          key={assignment.id}
                          className={className}
                          style={{
                            left: `${leftPercent}%`,
                            width: `${widthPercent}%`,
                            // Stagger band rows so overlapping ranges stay
                            // independently visible. Each new band on the
                            // channel sits one slot lower than the last.
                            top: `${10 + (index % 3) * 16}%`,
                            // Hue from the cycling palette; saturation /
                            // lightness fixed so the bands never clash with
                            // the existing port-card styling.
                            background: `hsla(${hue}, 70%, 55%, 0.55)`,
                            borderColor: `hsla(${hue}, 70%, 60%, 0.9)`
                          }}
                          title={`${definition?.label ?? `Function ${assignment.functionId}`} · ${assignment.lowPwm}–${assignment.highPwm} μs${assignment.inverted ? ' (inverted)' : ''} · drag to adjust`}
                          data-testid={`rc-mixer-track-band-${assignment.id}`}
                          onPointerDown={(event) => beginDrag(event, assignment, 'move')}
                        >
                          <span
                            className="rc-mixer-track__handle rc-mixer-track__handle--low"
                            role="slider"
                            tabIndex={0}
                            aria-label={`${definition?.label ?? 'Function'} range low (μs)`}
                            aria-valuemin={RC_MIXER_TRACK_MIN_PWM}
                            aria-valuemax={RC_MIXER_TRACK_MAX_PWM}
                            aria-valuenow={assignment.lowPwm}
                            data-testid={`rc-mixer-handle-low-${assignment.id}`}
                            onPointerDown={(event) => beginDrag(event, assignment, 'low')}
                            onKeyDown={(event) => {
                              if (event.key === 'ArrowLeft') {
                                event.preventDefault()
                                nudgeEdge(assignment, 'low', -1)
                              } else if (event.key === 'ArrowRight') {
                                event.preventDefault()
                                nudgeEdge(assignment, 'low', 1)
                              }
                            }}
                          />
                          <em>
                            {definition?.label ?? `Fn ${assignment.functionId}`}
                            {(() => {
                              const power = resolveVtxPowerLabel(assignment.functionId, assignment.levelMode, assignment.outputLevel)
                              return power ? ` → ${power}` : ''
                            })()}
                          </em>
                          <span
                            className="rc-mixer-track__handle rc-mixer-track__handle--high"
                            role="slider"
                            tabIndex={0}
                            aria-label={`${definition?.label ?? 'Function'} range high (μs)`}
                            aria-valuemin={RC_MIXER_TRACK_MIN_PWM}
                            aria-valuemax={RC_MIXER_TRACK_MAX_PWM}
                            aria-valuenow={assignment.highPwm}
                            data-testid={`rc-mixer-handle-high-${assignment.id}`}
                            onPointerDown={(event) => beginDrag(event, assignment, 'high')}
                            onKeyDown={(event) => {
                              if (event.key === 'ArrowLeft') {
                                event.preventDefault()
                                nudgeEdge(assignment, 'high', -1)
                              } else if (event.key === 'ArrowRight') {
                                event.preventDefault()
                                nudgeEdge(assignment, 'high', 1)
                              }
                            }}
                          />
                        </span>
                      )
                    })}
                    {cursorPercent !== undefined ? (
                      <span
                        className="rc-mixer-track__cursor"
                        style={{ left: `${cursorPercent}%` }}
                        aria-hidden="true"
                        data-testid={`rc-mixer-track-cursor-${channel}`}
                      />
                    ) : null}
                  </div>
                </div>

                {assignments.length === 0 ? null : (
                  <ul className="rc-mixer-channel__assignments">
                    {assignments.map((assignment) => {
                      const definition = functionLookup.byId.get(assignment.functionId)
                      const inWindow =
                        typeof livePwm === 'number'
                          ? assignment.inverted
                            ? livePwm < assignment.lowPwm || livePwm > assignment.highPwm
                            : livePwm >= assignment.lowPwm && livePwm <= assignment.highPwm
                          : undefined
                      return (
                        <li key={assignment.id} className="rc-mixer-assignment" data-testid={`rc-mixer-assignment-${assignment.id}`}>
                          <div className="rc-mixer-assignment__function">
                            <label>
                              <span>Function</span>
                              <select
                                value={String(assignment.functionId)}
                                onChange={(event) => onUpdateAssignment(assignment.id, { functionId: Number(event.target.value) })}
                                data-testid={`rc-mixer-function-${assignment.id}`}
                              >
                                {functionCatalog.map((entry) => (
                                  <option key={entry.id} value={entry.id}>
                                    {entry.label} ({entry.id})
                                  </option>
                                ))}
                              </select>
                            </label>
                            <small>{definition?.description ?? 'Unknown function id.'}</small>
                          </div>

                          <div className="rc-mixer-assignment__range">
                            <label>
                              <span>Low μs</span>
                              <input
                                type="number"
                                min={800}
                                max={2200}
                                step={1}
                                value={assignment.lowPwm}
                                onChange={(event) => onUpdateAssignment(assignment.id, { lowPwm: Number(event.target.value) })}
                                data-testid={`rc-mixer-low-${assignment.id}`}
                              />
                            </label>
                            <label>
                              <span>High μs</span>
                              <input
                                type="number"
                                min={800}
                                max={2200}
                                step={1}
                                value={assignment.highPwm}
                                onChange={(event) => onUpdateAssignment(assignment.id, { highPwm: Number(event.target.value) })}
                                data-testid={`rc-mixer-high-${assignment.id}`}
                              />
                            </label>
                            <label className="rc-mixer-assignment__inverted">
                              <input
                                type="checkbox"
                                checked={assignment.inverted}
                                onChange={(event) => onUpdateAssignment(assignment.id, { inverted: event.target.checked })}
                                data-testid={`rc-mixer-inverted-${assignment.id}`}
                              />
                              <span>Inverted</span>
                            </label>
                            <VtxLevelSelector
                              functionId={assignment.functionId}
                              levelMode={assignment.levelMode}
                              outputLevel={assignment.outputLevel}
                              vtxPowerLevels={vtxPowerLevels}
                              firmwareSupported={firmwareSupported}
                              testId={`rc-mixer-level-${assignment.id}`}
                              onChange={(patch) => onUpdateAssignment(assignment.id, patch)}
                            />
                          </div>

                          <div className="rc-mixer-assignment__status">
                            {inWindow === undefined ? (
                              <small>RC not live — connect the radio to preview window activation.</small>
                            ) : inWindow ? (
                              <StatusBadge tone="success">Active</StatusBadge>
                            ) : (
                              <StatusBadge tone="neutral">Inactive</StatusBadge>
                            )}
                            <button
                              type="button"
                              style={buttonStyle()}
                              onClick={() => onRemoveAssignment(assignment.id)}
                              data-testid={`rc-mixer-remove-${assignment.id}`}
                            >
                              Remove
                            </button>
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </article>
            )
          })}
        </div>

        {firmwareSupported ? (
          <section className="rc-mixer-logic" data-testid="rc-mixer-logic-section">
            <header className="rc-mixer-logic__header">
              <div>
                <strong>Logic conditions &amp; links</strong>
                <small>Drive a function from a vehicle condition (failsafe, armed) or another function&apos;s state — no channel needed.</small>
              </div>
              <button
                type="button"
                style={buttonStyle()}
                onClick={() => onAddLogicTerm?.()}
                disabled={tableFull}
                title={tableFull ? 'All 12 RC logic terms are in use.' : undefined}
                data-testid="rc-mixer-add-logic-term"
              >
                + Add logic term
              </button>
            </header>
            {logicTerms && logicTerms.length > 0 ? (
              <ul className="rc-mixer-logic__list">
                {logicTerms.map((term) => {
                  const definition = functionLookup.byId.get(term.functionId)
                  return (
                    <li key={term.id} className="rc-mixer-logic-term" data-testid={`rc-mixer-logic-term-${term.id}`}>
                      <label>
                        <span>Source</span>
                        <select
                          value={term.sourceType}
                          onChange={(event) => onUpdateLogicTerm?.(term.id, { sourceType: event.target.value as 'condition' | 'link' })}
                          data-testid={`rc-mixer-logic-source-${term.id}`}
                        >
                          <option value="condition">Condition</option>
                          <option value="link">Link</option>
                        </select>
                      </label>
                      {term.sourceType === 'condition' ? (
                        <label>
                          <span>When</span>
                          <select
                            value={String(term.sourceValue)}
                            onChange={(event) => onUpdateLogicTerm?.(term.id, { sourceValue: Number(event.target.value) })}
                            data-testid={`rc-mixer-logic-condition-${term.id}`}
                          >
                            {Object.entries(RC_LOGIC_CONDITION_LABELS).map(([value, label]) => (
                              <option key={value} value={value}>
                                {label}
                              </option>
                            ))}
                          </select>
                        </label>
                      ) : (
                        <label>
                          <span>Watching</span>
                          <select
                            value={String(term.sourceValue)}
                            onChange={(event) => onUpdateLogicTerm?.(term.id, { sourceValue: Number(event.target.value) })}
                            data-testid={`rc-mixer-logic-watch-${term.id}`}
                          >
                            {functionCatalog.map((entry) => (
                              <option key={entry.id} value={entry.id}>
                                {entry.label} ({entry.id})
                              </option>
                            ))}
                          </select>
                        </label>
                      )}
                      <label>
                        <span>Drives</span>
                        <select
                          value={String(term.functionId)}
                          onChange={(event) => onUpdateLogicTerm?.(term.id, { functionId: Number(event.target.value) })}
                          data-testid={`rc-mixer-logic-function-${term.id}`}
                        >
                          {functionCatalog.map((entry) => (
                            <option key={entry.id} value={entry.id}>
                              {entry.label} ({entry.id})
                            </option>
                          ))}
                        </select>
                      </label>
                      <VtxLevelSelector
                        functionId={term.functionId}
                        levelMode={term.levelMode}
                        outputLevel={term.outputLevel}
                        vtxPowerLevels={vtxPowerLevels}
                        firmwareSupported={firmwareSupported}
                        testId={`rc-mixer-logic-level-${term.id}`}
                        onChange={(patch) => onUpdateLogicTerm?.(term.id, patch)}
                      />
                      <label className="rc-mixer-logic-term__negate">
                        <input
                          type="checkbox"
                          checked={term.inverted}
                          onChange={(event) => onUpdateLogicTerm?.(term.id, { inverted: event.target.checked })}
                          data-testid={`rc-mixer-logic-negate-${term.id}`}
                        />
                        <span>Negate</span>
                      </label>
                      <div className="rc-mixer-logic-term__meta">
                        <small>
                          {definition?.description ?? 'Unknown function.'}
                          {(() => {
                            const power = resolveVtxPowerLabel(term.functionId, term.levelMode, term.outputLevel)
                            return power ? ` · → ${power}` : ''
                          })()}
                        </small>
                        <button
                          type="button"
                          style={buttonStyle()}
                          onClick={() => onRemoveLogicTerm?.(term.id)}
                          data-testid={`rc-mixer-logic-remove-${term.id}`}
                        >
                          Remove
                        </button>
                      </div>
                    </li>
                  )
                })}
              </ul>
            ) : (
              <p className="rc-mixer-logic__empty" data-testid="rc-mixer-logic-empty">
                No condition or link terms yet. Add one to drive a function from failsafe, arming, or another function&apos;s state.
              </p>
            )}
          </section>
        ) : null}
      </Panel>
    </div>
  )
}
