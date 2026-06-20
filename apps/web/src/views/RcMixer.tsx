import { Panel, StatusBadge, buttonStyle } from '@arduconfig/ui-kit'

import {
  RC_MIXER_TRACK_MAX_PWM,
  RC_MIXER_TRACK_MIN_PWM,
  computeBandGeometry,
  computeCursorPercent,
  type RcMixerAssignment,
  type RcMixerFunctionDefinition,
  type RcMixerFunctionDefinitionLookup
} from '../view-models/rc-mixer'

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
    onUpdateAssignment
  } = props

  return (
    <div id="setup-panel-rc-mixer">
      <Panel
        title="RC Option Mixer"
        subtitle="Assign multiple ArduPilot AUX functions per RC channel with independent PWM activation ranges. Preview only — not yet wired to the vehicle."
      >
        <div className="rc-mixer-callout" data-testid="rc-mixer-ardupilot-gap-callout">
          <StatusBadge tone="warning">Not available in ArduPilot</StatusBadge>
          <p>
            ArduPilot's <code>RCn_OPTION</code> binds one AUX function per channel with no PWM window — there's no
            multi-function-per-channel model and no per-function activation range. This view ships the desired UX so
            it can be reviewed alongside ArduPilot development. The day ArduPilot grows that support (a likely
            <code>RC_MIXn_*</code> parameter family or a new MAVLink mapping message), this box turns into a real
            editor instead of staying a preview.
          </p>
        </div>

        <div className="bf-note" data-testid="rc-mixer-scaffold-banner">
          <p>
            <strong>Local-only preview.</strong> Edits below stay in the browser; nothing is sent to the vehicle.
          </p>
        </div>

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
                      data-testid={`rc-mixer-add-channel-${channel}`}
                    >
                      + Add function
                    </button>
                  </div>
                </header>

                <div className="rc-mixer-track" data-testid={`rc-mixer-track-${channel}`}>
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
                          title={`${definition?.label ?? `Function ${assignment.functionId}`} · ${assignment.lowPwm}–${assignment.highPwm} μs${assignment.inverted ? ' (inverted)' : ''}`}
                          data-testid={`rc-mixer-track-band-${assignment.id}`}
                        >
                          <em>{definition?.label ?? `Fn ${assignment.functionId}`}</em>
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

                {assignments.length === 0 ? (
                  <p className="rc-mixer-channel__empty">No functions assigned to this channel.</p>
                ) : (
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
      </Panel>
    </div>
  )
}
