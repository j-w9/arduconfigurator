import type { ParameterState } from '@arduconfig/ardupilot-core'
import { StatusBadge } from '@arduconfig/ui-kit'

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
  /**
   * The mode-channel parameter itself, so the card can EDIT it rather than only
   * name it.
   *
   * Field request: which channel selects the flight mode is mode setup, and it
   * belonged on this screen rather than only being readable here and settable
   * somewhere else. Absent when the vehicle has not reported it.
   */
  modeChannelParameter?: ParameterState
  /** RC Mixer (AP_RC_Logic) function labels layered on the mode channel, if any,
   *  so the operator sees the mode switch shares its channel with an RCL term. */
  modeChannelRcLogicClaim?: readonly string[]
  currentSlotLabel: string
  currentSlotSubtext: string
  activeModeLabel: string
  slots: readonly ModesViewSlot[]
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
  /** See ScopedSelectField.onEnumOverride: a typed unlisted mode number is written, not left invalid. */
  onEnumOverride?: (paramId: string, overridden: boolean) => void
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
    modeChannelParameter,
    modeChannelRcLogicClaim,
    currentSlotLabel,
    currentSlotSubtext,
    activeModeLabel,
    slots,
    fiberModeAvailable = false,
    editedValues,
    draftStatusById,
    onChangeSlot,
    joystickModeNote,
    onEnumOverride
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
        <div className="modes-stack">
          <div className="modes-status" data-testid="modes-status">
            <span className="modes-status__item">
              <span className="modes-status__label">Active mode</span>
              <strong>{activeModeLabel}</strong>
            </span>
          </div>
          <p className="modes-note" data-testid="modes-joystick-note">{joystickModeNote}</p>
        </div>
      </div>
    )
  }

  const channelEditable = canEditInPlace && modeChannelParameter !== undefined

  return (
    <div id="setup-panel-modes">
      {/* No Panel of its own: this renders inside the Config card already
          headed "Flight modes". The mode channel, the current slot and the
          active mode are one status line over the table -- they were three
          boxes. */}
      <div className="modes-stack">
          <div className="modes-status" data-testid="modes-status">
            <span className="modes-status__item modes-status__item--channel">
              {channelEditable ? (
                <span data-testid="modes-mode-channel-field" className="modes-status__channel-field">
                  <ScopedSelectField
                    parameter={modeChannelParameter}
                    liveValue={modeChannelParameter.value}
                    editedValues={editedValues!}
                    onChange={onChangeSlot!}
                    draftStatusById={draftStatusById!}
                    allowCustomValue
                    onEnumOverride={onEnumOverride}
                  />
                </span>
              ) : (
                <>
                  <span className="modes-status__label">Mode channel</span>
                  <strong>{modeChannelLabel}</strong>
                  <InfoDot label="About the mode channel">
                    {modeChannelParamName} selects which RC channel switches the flight mode.
                  </InfoDot>
                </>
              )}
            </span>
            <span className="modes-status__item" data-testid="modes-current-slot">
              <span className="modes-status__label">Slot</span>
              <strong>{currentSlotLabel}</strong>
              <small>{currentSlotSubtext}</small>
            </span>
            <span className="modes-status__item" data-testid="modes-active-mode">
              <span className="modes-status__label">Active</span>
              <strong>{activeModeLabel}</strong>
            </span>
          </div>
          {modeChannelRcLogicClaim?.length ? (
            <small className="modes-mode-channel__rcl-claim" data-testid="modes-mode-channel-rcl-claim">
              ⚠ This channel also drives an RC Mixer function: {modeChannelRcLogicClaim.join(', ')}
            </small>
          ) : null}

          <div className="modes-table" role="table" aria-label="Flight mode slots" data-testid="modes-slot-table">
            <div className="modes-table__row modes-table__row--head" role="row">
              <span role="columnheader">Slot</span>
              <span role="columnheader">PWM</span>
              <span role="columnheader">
                Mode
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
            </div>
            {slots.map((slot) => (
              <div
                key={slot.position}
                className={`modes-table__row${slot.isActive ? ' is-active' : ''}`}
                role="row"
                aria-current={slot.isActive ? 'true' : undefined}
                data-testid={`modes-slot-${slot.position}`}
              >
                <span role="cell" className="modes-table__slot">{slot.position}</span>
                <span role="cell" className="modes-table__pwm">{slot.pwmLabel}</span>
                <span role="cell" className="modes-table__mode">
                  {canEditInPlace && slot.parameter ? (
                    <ScopedSelectField
                      parameter={slot.parameter}
                      liveValue={slot.parameter.value}
                      editedValues={editedValues!}
                      onChange={onChangeSlot!}
                      draftStatusById={draftStatusById!}
                      allowCustomValue
                      onEnumOverride={onEnumOverride}
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
                  {/* The live slot is the highlighted row; the STATE column of
                      "—" pills is gone. Only a slot the vehicle has not
                      reported still says so. */}
                  {slot.paramSynced ? null : <StatusBadge tone="warning">not synced</StatusBadge>}
                </span>
              </div>
            ))}
          </div>

      </div>
    </div>
  )
}
