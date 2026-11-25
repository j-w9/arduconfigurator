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
  MOT_HOVER_LEARN_AND_SAVE,
  MOT_HOVER_LEARN_DISABLED,
  deriveHoverLearnState
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
    `Fly in a mode that holds altitude: ${modes}. A hover in Stabilize or Acro learns nothing. ` +
    'Climb to about 5 m, centre the throttle and hold still for 20 s or more. Land and disarm; it saves on disarm.'
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
  const acceptStaged = editedValues.MOT_HOVER_LEARN === String(MOT_HOVER_LEARN_DISABLED)
  const pastFlight1 = stage === 'flight-2' || stage === 'flight-2-review' || stage === 'complete'
  const accepted = pastFlight1 && !state.hoverLearnArmed
  const unlocked = pastFlight1 && state.hoverLearnArmed && state.hoverThrottle !== undefined
  const lockStaged = editedValues.MOT_HOVER_LEARN === String(MOT_HOVER_LEARN_DISABLED)

  // PSC_D_ACC_P/I (or legacy PSC_ACCZ_P/I): stage the proper gains for the
  // learned hover throttle. The rule (copter initial-tuning-flight.rst) is
  // P = hover × 0.1, I = hover × 0.2 on 4.7; ten times that on 4.6.
  const is47 = snapshot.parameters.some((p) => p.id === 'PSC_D_ACC_P')
  const accPId = is47 ? 'PSC_D_ACC_P' : 'PSC_ACCZ_P'
  const accIId = is47 ? 'PSC_D_ACC_I' : 'PSC_ACCZ_I'
  const accScale = is47 ? 0.1 : 1

  return (
    <article className="calibration-card" data-testid="calibration-card-hover-throttle">
      <div className="calibration-card__header">
        <strong>Hover throttle learning</strong>
        <StatusBadge tone={accepted ? 'success' : stage === 'unknown' ? 'neutral' : 'warning'}>
          {accepted ? 'accepted' : stage === 'unknown' ? 'not read' : unlocked ? 'not accepted' : 'flight 1'}
        </StatusBadge>
      </div>
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
          <strong>MOT_THST_HOVER has not been read yet.</strong> Wait for the parameter sync, or
          reconnect.
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
              Hover learning is on (MOT_HOVER_LEARN = 2). After you land and disarm, the value
              shows here to accept.
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
                Hover learning is off, so a flight now would record nothing. This stages
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
                // Freeze what was just accepted. Left at Learn-and-Save, the
                // next flight re-learns and overwrites the hover throttle the
                // operator signed off, and the card would then report a value
                // nobody approved.
                setDraft('MOT_HOVER_LEARN', String(MOT_HOVER_LEARN_DISABLED))
                // Stage the altitude accel gains that match the learned hover
                // throttle. P = hover × scale, I = 2 × P (ArduPilot tuning
                // guide). Without this, a light quad hovers at 0.05 with gains
                // set for 0.35 and bounces in AltHold.
                if (state.hoverThrottle !== undefined) {
                  const p = Math.round(state.hoverThrottle * accScale * 1000) / 1000
                  const i = Math.round(state.hoverThrottle * 2 * accScale * 1000) / 1000
                  setDraft(accPId, String(p))
                  setDraft(accIId, String(i))
                }
              }}
            >
              {acceptStaged ? 'Accepted — apply to write it' : 'Yes — accept it'}
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
            Flying again overwrites it: the hover throttle is re-learned every flight while
            MOT_HOVER_LEARN is 2.
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
            (MOT_HOVER_LEARN = 2), so the next flight re-learns it. Accept it to keep this value.
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

      {canStage ? null : <small>{flightCalibrationBlockedReason(snapshot, busyAction)}</small>}
    </article>
  )
}
