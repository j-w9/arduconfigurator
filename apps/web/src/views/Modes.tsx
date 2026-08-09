import type { ParameterState } from '@arduconfig/ardupilot-core'
import { Panel, StatusBadge, buttonStyle } from '@arduconfig/ui-kit'

import { InfoDot } from './InfoDot'
import { ParamInfoBubble } from './ParamInfoBubble'
import { ScopedSelectField, type ScopedFieldDraftMap } from './ScopedField'

export interface ModesViewSlot {
  position: number
  pwmLabel: string
  modeLabel: string
  paramSynced: boolean
  isActive: boolean
  /**
   * When set, the slot's "Assigned mode" cell renders an editable
   * ScopedSelectField bound to this parameter. Otherwise the slot is
   * read-only with `modeLabel` shown as plain text.
   */
  parameter?: ParameterState
}

export interface ModesViewProps {
  modeChannelLabel: string
  modeChannelParamName: string
  /** RC Mixer (AP_RC_Logic) function labels layered on the mode channel, if any,
   *  so the operator sees the mode switch shares its channel with an RCL term. */
  modeChannelRcLogicClaim?: readonly string[]
  currentSlotLabel: string
  currentSlotSubtext: string
  activeModeLabel: string
  slots: readonly ModesViewSlot[]
  onOpenFlightModeTask: () => void
  /**
   * Edit-in-place plumbing. When provided alongside per-slot `parameter`s,
   * each slot's "Assigned mode" cell becomes an inline ScopedSelectField
   * that stages drafts the global staged-changes bar can apply.
   */
  /** True only when the connected vehicle reports the fork-only Fiber mode. */
  fiberModeAvailable?: boolean
  editedValues?: Record<string, string>
  draftStatusById?: ScopedFieldDraftMap
  onChangeSlot?: (paramId: string, value: string) => void
  /**
   * When set (ArduSub), the vehicle has no RC mode-switch channel — modes are
   * bound to joystick buttons. The mode-channel card, PWM slot table and the
   * Receiver deep-link are all inapplicable, so the view renders only the live
   * heartbeat mode plus this honest note instead.
   */
  joystickModeNote?: string
}

export function ModesView(props: ModesViewProps) {
  const {
    modeChannelLabel,
    modeChannelParamName,
    modeChannelRcLogicClaim,
    currentSlotLabel,
    currentSlotSubtext,
    activeModeLabel,
    slots,
    onOpenFlightModeTask,
    fiberModeAvailable = false,
    editedValues,
    draftStatusById,
    onChangeSlot,
    joystickModeNote
  } = props
  // Edit-in-place is available iff the caller supplied the staged-draft
  // plumbing AND at least one slot has a bound parameter.
  const canEditInPlace =
    editedValues !== undefined &&
    draftStatusById !== undefined &&
    onChangeSlot !== undefined &&
    slots.some((slot) => slot.parameter !== undefined)

  if (joystickModeNote) {
    return (
      <div id="setup-panel-modes">
        <Panel
          title="Modes"
          subtitle="Live flight mode reported by the vehicle heartbeat. This vehicle has no RC mode-switch channel."
        >
          <div className="modes-stack">
            <div className="modes-status">
              <article className="modes-status__card">
                <span>Active mode</span>
                <strong>{activeModeLabel}</strong>
                <small>Mode reported by the vehicle heartbeat.</small>
              </article>
            </div>

            <div className="modes-help">
              <p data-testid="modes-joystick-note">{joystickModeNote}</p>
            </div>
          </div>
        </Panel>
      </div>
    )
  }

  return (
    <div id="setup-panel-modes">
      <Panel
        title="Modes"
        subtitle="Flight-mode assignments for the configured switch channel and a live indicator on the active slot."
      >
        <div className="modes-stack">
          <div className="modes-status">
            <article className="modes-status__card">
              <span>Mode channel</span>
              <strong>{modeChannelLabel}</strong>
              <small>{modeChannelParamName} selects which RC channel switches the flight mode.</small>
              {modeChannelRcLogicClaim?.length ? (
                <small className="modes-mode-channel__rcl-claim" data-testid="modes-mode-channel-rcl-claim">
                  ⚠ This channel also drives an RC Mixer function: {modeChannelRcLogicClaim.join(', ')}
                </small>
              ) : null}
            </article>
            <article className="modes-status__card">
              <span>Current slot</span>
              <strong>{currentSlotLabel}</strong>
              <small>{currentSlotSubtext}</small>
            </article>
            <article className="modes-status__card">
              <span>Active mode</span>
              <strong>{activeModeLabel}</strong>
              <small>Mode reported by the vehicle heartbeat.</small>
            </article>
          </div>

          <div className="modes-table" role="table" aria-label="Flight mode slots" data-testid="modes-slot-table">
            <div className="modes-table__row modes-table__row--head" role="row">
              <span role="columnheader">Slot</span>
              <span role="columnheader">PWM range</span>
              <span role="columnheader">
                Assigned mode
                {/* Fork-only surface: rendered only when the connected vehicle
                    actually reports Fiber, so a stock build never sees a
                    pointer to a mode it cannot fly. */}
                {fiberModeAvailable ? (
                  <InfoDot
                    label="About Fiber mode"
                    testId="modes-fiber-info"
                    wide
                    wikiTopic="flightModesFiber"
                  >
                    <p>
                      This firmware reports <strong>Fiber</strong>, a custom cruise mode that is not part of
                      upstream ArduCopter.
                    </p>
                    <p>
                      It holds barometric altitude like AltHold, but the roll/pitch sticks command the{' '}
                      <em>rate</em> of lean-angle change and that angle is retained when the sticks are
                      centred — so the vehicle keeps its tilt and accelerates until drag balances it, rather
                      than levelling off and stopping. Entering the mode locks onto whatever attitude the
                      vehicle has at that moment.
                    </p>
                    <p>
                      <code>FIBER_TILT_T</code> sets how long a full stick deflection takes to reach{' '}
                      <code>ANGLE_MAX</code>. Because Fiber does not self-level, give it altitude and open
                      space the first time.
                    </p>
                  </InfoDot>
                ) : null}
              </span>
              <span role="columnheader">State</span>
            </div>
            {slots.map((slot) => (
              <div
                key={slot.position}
                className={`modes-table__row${slot.isActive ? ' is-active' : ''}`}
                role="row"
                data-testid={`modes-slot-${slot.position}`}
              >
                <span role="cell"><strong>{slot.position}</strong></span>
                <span role="cell">{slot.pwmLabel}</span>
                <span role="cell">
                  {canEditInPlace && slot.parameter ? (
                    <ScopedSelectField
                      parameter={slot.parameter}
                      liveValue={slot.parameter.value}
                      editedValues={editedValues!}
                      onChange={onChangeSlot!}
                      draftStatusById={draftStatusById!}
                      allowCustomValue
                    />
                  ) : (
                    <span className="modes-table__mode-readonly">
                      {slot.modeLabel}
                      {/* The read-only slot used to trail a bare "FLTMODE3"; the
                          bubble keeps that id one hover away and adds the
                          description and reference link the plain text lacked. */}
                      {slot.parameter ? (
                        <ParamInfoBubble
                          paramId={slot.parameter.id}
                          label={`Flight mode slot ${slot.position}`}
                          description={slot.parameter.definition?.description}
                          testId={`modes-slot-info-${slot.parameter.id}`}
                        />
                      ) : null}
                    </span>
                  )}
                </span>
                <span role="cell">
                  {slot.isActive ? (
                    <StatusBadge tone="success">live</StatusBadge>
                  ) : !slot.paramSynced ? (
                    <StatusBadge tone="warning">not synced</StatusBadge>
                  ) : (
                    <StatusBadge tone="neutral">—</StatusBadge>
                  )}
                </span>
              </div>
            ))}
          </div>

          <div className="modes-help">
            <p>
              {canEditInPlace
                ? 'Edit a slot above, then apply from the staged-changes bar. The Receiver → Flight Mode task is an alternate edit surface with the same fields plus the live mode-switch exerciser.'
                : 'Edit per-slot mode assignments from the Receiver view’s Flight Mode task.'}
            </p>
            <button
              type="button"
              style={buttonStyle()}
              data-testid="modes-go-to-flight-mode-task"
              onClick={onOpenFlightModeTask}
            >
              Open Receiver → Flight Mode
            </button>
          </div>
        </div>
      </Panel>
    </div>
  )
}
