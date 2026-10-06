// Flight 1 of hover calibration: the hover throttle the firmware learns in the
// air and saves on disarm.
//
// Its own card, separate from the Z-bias flight that follows it. They are two
// flights with two different outcomes, and bundling them meant one surface
// showed whichever half the vehicle happened to be on.
//
// This half is STOCK ArduCopter -- MOT_THST_HOVER and MOT_HOVER_LEARN exist on
// every copter -- so unlike the Z-bias card it is not gated on the fork.

import type { ReactElement } from 'react'
import { StatusBadge, buttonStyle } from '@arduconfig/ui-kit'

import { flightCalibrationBlockedReason } from '../apply-gate'

import type { ConfiguratorSnapshot } from '@arduconfig/ardupilot-core'

import {
  ACC_ZBIAS_LEARN_SAVE,
  ACC_ZBIAS_LEARN_USE,
  MOT_HOVER_LEARN_AND_SAVE,
  MOT_HOVER_LEARN_DISABLED,
  deriveHoverLearnState,
  zbiasLearnValue
} from '../view-models/hover-learn-stage'

export interface HoverThrottleLearnCardProps {
  snapshot: ConfiguratorSnapshot
  canApplyDraftParameters: boolean
  busyAction: string | undefined
  setDraft: (paramId: string, value: string) => void
  /** Staged drafts, so a click here shows as staged instead of doing nothing visible. */
  editedValues: Record<string, string>
}

// The mode is not a detail. Copter::update_throttle_hover returns early in any
// manual-throttle mode (Stabilize, Acro, SystemID, Turtle) and in Drift, and
// again whenever the climb/descent demand is non-zero — so a perfect hover
// flown in Stabilize, or on a held throttle stick, learns exactly nothing and
// is indistinguishable from never having flown.
//
// VALT is named ONLY when the firmware actually has it: it is a fork mode
// (MODE_VALT_ENABLED), and telling an operator on stock ArduCopter to fly in
// VALT sends them looking for a switch position that does not exist.
export function hoverFlightInstructions(valtSupported: boolean): string {
  const modes = valtSupported ? 'AltHold, Loiter, PosHold or VALT' : 'AltHold, Loiter or PosHold'
  return (
    `Fly this one in a mode that holds altitude — ${modes}. A hover in ` +
    'Stabilize or Acro learns nothing, whatever it looks like. Take off, climb to about 5 m, then ' +
    'centre the throttle stick and let it sit level with as little input as you can. Twenty seconds ' +
    'of steady hover is enough; a steady minute is better. Land and disarm — the value is saved on ' +
    'disarm.'
  )
}

export function HoverThrottleLearnCard({
  snapshot,
  canApplyDraftParameters,
  busyAction,
  setDraft,
  editedValues
}: HoverThrottleLearnCardProps): ReactElement | null {
  const state = deriveHoverLearnState(snapshot)
  const canStage = canApplyDraftParameters && busyAction === undefined
  const rearmStaged = editedValues.MOT_HOVER_LEARN === String(MOT_HOVER_LEARN_AND_SAVE)
  const { stage } = state
  // Accepting flight 1 stages its drafts; the stage only moves once they are
  // applied. Until then the button says so, instead of looking like a button
  // that did nothing when clicked.
  const acceptStaged =
    editedValues.ACC_ZBIAS_LEARN !== undefined &&
    (Number(editedValues.ACC_ZBIAS_LEARN) & ACC_ZBIAS_LEARN_SAVE) !== 0 &&
    editedValues.MOT_HOVER_LEARN === String(MOT_HOVER_LEARN_DISABLED)
  // Past the hover-throttle flight by the Z-bias stage. The stage is read from
  // ACC_ZBIAS_LEARN, which can be set without anyone accepting a hover (by
  // hand, or from a loaded parameter file) -- field report: "once I did my
  // hover, there was no button to confirm hover learned". So "past flight 1"
  // is not "accepted": only a frozen MOT_HOVER_LEARN is, and an unfrozen one
  // keeps its accept button.
  const pastFlight1 = stage === 'flight-2' || stage === 'flight-2-review' || stage === 'complete'
  const accepted = pastFlight1 && !state.hoverLearnArmed
  const unlocked = pastFlight1 && state.hoverLearnArmed && state.hoverThrottle !== undefined
  const lockStaged = editedValues.MOT_HOVER_LEARN === String(MOT_HOVER_LEARN_DISABLED)

  return (
    <article className="calibration-card" data-testid="calibration-card-hover-throttle">
      <div className="calibration-card__header">
        <strong>Hover throttle learning</strong>
        <StatusBadge tone={accepted ? 'success' : stage === 'unknown' ? 'neutral' : 'warning'}>
          {accepted ? 'accepted' : stage === 'unknown' ? 'not read' : unlocked ? 'not accepted' : 'flight 1'}
        </StatusBadge>
      </div>
      <p>
        What throttle this aircraft needs to hold altitude. The firmware learns it in the air and
        saves it on disarm; it is the controller&apos;s vertical feedforward, so nothing that holds
        altitude behaves properly until it is right.
      </p>

      <div className="config-pills">
        <span data-tone={stage === 'flight-1' || stage === 'unknown' ? 'neutral' : 'success'}>
          MOT_THST_HOVER: {state.hoverThrottle !== undefined ? state.hoverThrottle.toFixed(3) : '—'}
        </span>
        <span data-tone={state.hoverLearnArmed ? 'success' : accepted ? 'neutral' : 'warning'}>
          MOT_HOVER_LEARN: {state.hoverLearn ?? '—'}
        </span>
      </div>

      {stage === 'unknown' ? (
        <p data-testid="hover-learn-step">
          <strong>MOT_THST_HOVER has not been read yet.</strong> Nothing can be said about this
          flight until it arrives — wait for the parameter sync to finish, or reconnect if it has
          stalled.
        </p>
      ) : null}

      {stage === 'flight-1' ? (
        <>
          <p data-testid="hover-learn-step">
            <strong>Fly a hover.</strong> {hoverFlightInstructions(state.valtSupported)}
          </p>
          {/* A real step, not a formality. MOT_HOVER_LEARN defaults to 2, but a
              vehicle someone turned it off on looks exactly like a fresh one —
              nothing learned — so telling the operator to "just go fly" would
              send them up for a flight that records nothing. When it is
              already on there is nothing to press: a "Confirm" button that
              stages nothing read as the way to the next step, and did nothing
              when clicked (field report). */}
          {state.hoverLearnArmed ? (
            <small data-testid="hover-learn-start-hint">
              Hover learning is on (MOT_HOVER_LEARN = 2). Once you land and disarm, the learned
              value shows here with a button to accept it.
            </small>
          ) : (
            <>
              <button
                type="button"
                style={buttonStyle('primary')}
                data-testid="hover-learn-start"
                disabled={!canStage}
                onClick={() => setDraft('MOT_HOVER_LEARN', String(MOT_HOVER_LEARN_AND_SAVE))}
              >
                Turn on hover learning
              </button>
              <small data-testid="hover-learn-start-hint">
                Hover learning is OFF on this vehicle, so a flight now would record nothing. This stages
                MOT_HOVER_LEARN = 2.
              </small>
            </>
          )}
        </>
      ) : null}

      {stage === 'flight-1-review' ? (
        <>
          <p data-testid="hover-learn-step">
            <strong>Flight done.</strong> It learned a hover throttle of{' '}
            {state.hoverThrottle?.toFixed(3)}. Was that a good, steady hover?
          </p>
          <div className="button-row">
            <button
              type="button"
              style={buttonStyle(acceptStaged ? undefined : 'primary')}
              data-testid="hover-learn-flight-1-yes"
              disabled={!canStage || acceptStaged}
              onClick={() => {
                // Hands off to the Z-bias card: 3 = learn AND apply. The
                // correction is applied while it is being learned, which is
                // what the firmware's bias maths expects
                // (update_hover_bias_learning adds the already-applied frozen
                // correction back before filtering).
                setDraft('ACC_ZBIAS_LEARN', zbiasLearnValue(state.zbiasLearn, ACC_ZBIAS_LEARN_SAVE | ACC_ZBIAS_LEARN_USE))
                // Start the bias flight from ZERO, not from whatever a previous
                // calibration left behind. The learner filters TOWARDS what it
                // measures (update_hover_bias_learning is a low-pass onto the
                // current value), so an old bias still in INS*_ACC_VRFB_Z is a
                // starting point it has to walk away from — and on a vehicle
                // that arrives with someone else's calibration it is somebody
                // else's number the flight would be refining. The retry path
                // already cleared these for exactly this reason; starting the
                // flight should too.
                for (const id of state.biasParamIds) {
                  setDraft(id, '0')
                }
                // Freeze what was just accepted. Left at Learn-and-Save, the
                // Z-bias flight re-learns and overwrites the hover throttle the
                // operator signed off, and the card would then report a value
                // nobody approved.
                setDraft('MOT_HOVER_LEARN', String(MOT_HOVER_LEARN_DISABLED))
              }}
            >
              {acceptStaged
                ? 'Accepted — apply to write it'
                : state.supported
                  ? 'Yes — accept it, go to the Z-bias flight'
                  : 'Yes — accept it'}
            </button>
            <button
              type="button"
              style={buttonStyle()}
              data-testid="hover-learn-flight-1-no"
              disabled={!canStage}
              // Nothing to undo: MOT_HOVER_LEARN stays at Learn-and-Save, so
              // the next hover overwrites what this one learned. Re-assert it
              // in case a previous session left it disabled.
              onClick={() => setDraft('MOT_HOVER_LEARN', String(MOT_HOVER_LEARN_AND_SAVE))}
            >
              No — fly it again
            </button>
          </div>
          <small data-testid="hover-learn-flight-1-no-hint">
            Flying again simply overwrites it — the vehicle re-learns the hover throttle every flight
            while MOT_HOVER_LEARN is 2.
          </small>
        </>
      ) : null}

      {unlocked ? (
        <>
          {/* Say what MOT_HOVER_LEARN actually is: still learning, so every
              altitude-holding flight -- the Z-bias flight included --
              re-learns this value. Accepting freezes it, the same write the
              flight-1 Yes makes, without touching the Z-bias flight already
              under way. */}
          <p data-testid="hover-learn-unlocked">
            <strong>It learned {state.hoverThrottle?.toFixed(3)}.</strong> Hover learning is still on
            (MOT_HOVER_LEARN = 2), so the next altitude-holding flight re-learns it, the Z-bias flight
            included. Accept it to keep this value.
          </p>
          <button
            type="button"
            style={buttonStyle(lockStaged ? undefined : 'primary')}
            data-testid="hover-learn-lock"
            disabled={!canStage || lockStaged}
            onClick={() => setDraft('MOT_HOVER_LEARN', String(MOT_HOVER_LEARN_DISABLED))}
          >
            {lockStaged ? 'Accepted — apply to write it' : `Accept ${state.hoverThrottle?.toFixed(3)}`}
          </button>
        </>
      ) : null}

      {accepted ? (
        <>
          <p className="success-copy" data-testid="hover-learn-accepted">
            Accepted, and hover learning is off so nothing overwrites it.
          </p>
          {/* Without this the card is a dead end once frozen: re-learning would
              mean clearing the Z-bias calibration, which is a different job. */}
          {state.hoverLearnArmed ? null : (
            <button
              type="button"
              style={buttonStyle(rearmStaged ? undefined : 'primary')}
              data-testid="hover-learn-rearm"
              disabled={!canStage || rearmStaged}
              onClick={() => setDraft('MOT_HOVER_LEARN', String(MOT_HOVER_LEARN_AND_SAVE))}
            >
              {rearmStaged ? 'Re-learn staged — apply to write it' : 'Re-learn on the next hover'}
            </button>
          )}
        </>
      ) : null}

      <small>
        {canStage
          ? 'Staged like any other change — nothing is written until you apply it.'
          : flightCalibrationBlockedReason(snapshot, busyAction)}
      </small>
    </article>
  )
}
