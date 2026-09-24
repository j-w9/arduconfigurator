// Two-flight hover learning: the hover throttle, then the accelerometer Z-bias
// that vibration leaves behind. Both are learned in the AIR and saved on
// DISARM, so neither can be driven from a bench — this card only sequences
// them and reports what the vehicle came back with.

import type { ReactElement } from 'react'
import { StatusBadge, buttonStyle } from '@arduconfig/ui-kit'

import type { ConfiguratorSnapshot } from '@arduconfig/ardupilot-core'

import {
  ACC_ZBIAS_LEARN_SAVE,
  ACC_ZBIAS_LEARN_USE,
  MOT_HOVER_LEARN_AND_SAVE,
  MOT_THST_HOVER_DEFAULT,
  deriveHoverLearnState
} from '../view-models/hover-learn-stage'

export interface HoverLearnCardProps {
  snapshot: ConfiguratorSnapshot
  canApplyDraftParameters: boolean
  busyAction: string | undefined
  setDraft: (paramId: string, value: string) => void
}

// The mode is not a detail. Copter::update_throttle_hover returns early in any
// manual-throttle mode (Stabilize, Acro, SystemID, Turtle) and in Drift, and
// again whenever the climb/descent demand is non-zero — so a perfect hover
// flown in Stabilize, or on a held throttle stick, learns exactly nothing and
// is indistinguishable from never having flown.
const FLIGHT_INSTRUCTIONS =
  'Fly this one in AltHold or Loiter — a hover in Stabilize or Acro learns nothing, whatever it ' +
  'looks like. Take off, climb to about 5 m, then centre the throttle stick and let it sit level ' +
  'with as little input as you can. Give it a steady minute or so, then land and disarm — the ' +
  'value is saved on disarm.'

export function HoverLearnCard({
  snapshot,
  canApplyDraftParameters,
  busyAction,
  setDraft
}: HoverLearnCardProps): ReactElement | null {
  const state = deriveHoverLearnState(snapshot)

  // Fork-only: without ACC_ZBIAS_LEARN the sequence cannot be completed.
  if (!state.supported) {
    return null
  }

  const canStage = canApplyDraftParameters && busyAction === undefined
  const { stage } = state
  const ekfWrong = state.ekfType !== undefined && state.ekfType !== 3

  /** Put the vehicle back to "never calibrated" and start at flight 1. */
  const zeroize = (): void => {
    // The LEARNED values, not just the enables — a vehicle arriving with a
    // previous calibration is exactly the case this exists for, and leaving
    // MOT_THST_HOVER or the bias in place would leave it reading as done.
    setDraft('MOT_THST_HOVER', String(MOT_THST_HOVER_DEFAULT))
    for (const id of state.biasParamIds) {
      setDraft(id, '0')
    }
    setDraft('ACC_ZBIAS_LEARN', '0')
    // Back to the firmware default rather than 0: 2 is what a stock copter
    // ships with, and it is what makes the next flight learn at all.
    setDraft('MOT_HOVER_LEARN', String(MOT_HOVER_LEARN_AND_SAVE))
  }

  return (
    <article className="calibration-card" data-testid="calibration-card-hover-learn">
      <div className="calibration-card__header">
        <strong>Hover learning (two flights)</strong>
        <StatusBadge tone={stage === 'complete' ? 'success' : 'warning'}>
          {stage === 'complete'
            ? 'complete'
            : stage === 'unknown'
              ? 'not read'
              : stage.startsWith('flight-1')
                ? 'flight 1'
                : 'flight 2'}
        </StatusBadge>
      </div>
      <p>
        Learns the hover throttle, then the accelerometer Z-bias that vibration leaves behind. Each costs
        a flight, and both are saved when you disarm.
      </p>

      <div className="config-pills">
        <span data-tone={stage === 'flight-1' || stage === 'unknown' ? 'neutral' : 'success'}>
          MOT_THST_HOVER: {state.hoverThrottle !== undefined ? state.hoverThrottle.toFixed(3) : '—'}
        </span>
        <span data-tone={state.hoverLearnArmed ? 'success' : 'warning'}>
          MOT_HOVER_LEARN: {state.hoverLearn ?? '—'}
        </span>
        <span data-tone={state.biasLearned ? 'success' : 'neutral'}>
          Z-bias: {state.biasLearned ? 'learned' : 'not learned'}
        </span>
      </div>

      {ekfWrong ? (
        <p className="switch-exercise-warning" data-testid="hover-learn-ekf-warning">
          Z-bias learning only works on EKF3 (AHRS_EKF_TYPE = 3); this vehicle reports {state.ekfType}.
          The second flight will not learn anything until that is changed.
        </p>
      ) : null}

      {state.blindMode !== undefined ? (
        <p className="switch-exercise-warning" data-testid="hover-learn-mode-warning">
          This vehicle is flying in {state.blindMode}, which learns no hover throttle at all. Switch
          to AltHold or Loiter before the hover or the flight records nothing.
        </p>
      ) : null}

      {stage === 'unknown' ? (
        <p data-testid="hover-learn-step">
          <strong>MOT_THST_HOVER has not been read yet.</strong> Nothing can be said about flight 1
          until it arrives — wait for the parameter sync to finish, or reconnect if it has stalled.
        </p>
      ) : null}

      {stage === 'flight-1' ? (
        <>
          <p data-testid="hover-learn-step">
            <strong>Flight 1 — hover throttle.</strong> {FLIGHT_INSTRUCTIONS}
          </p>
          {/* A real step, not a formality. MOT_HOVER_LEARN defaults to 2, but a
              vehicle someone turned it off on looks exactly like a fresh one —
              nothing learned — so telling the operator to "just go fly" would
              send them up for a flight that records nothing. Pressing this
              guarantees learning is on; on a stock copter it stages nothing
              because it is already correct, and the pill above shows that. */}
          <button
            type="button"
            style={buttonStyle('primary')}
            data-testid="hover-learn-start"
            disabled={!canStage}
            onClick={() => setDraft('MOT_HOVER_LEARN', String(MOT_HOVER_LEARN_AND_SAVE))}
          >
            {state.hoverLearnArmed ? 'Confirm hover learning is on' : 'Stage Flight 1 (turn on hover learning)'}
          </button>
          <small data-testid="hover-learn-start-hint">
            {state.hoverLearnArmed
              ? 'MOT_HOVER_LEARN is already Learn-and-Save, so this stages nothing — the vehicle will learn on the next hover.'
              : 'Hover learning is OFF on this vehicle, so a flight now would record nothing. This stages MOT_HOVER_LEARN = 2.'}
          </small>
        </>
      ) : null}

      {stage === 'flight-1-review' ? (
        <>
          <p data-testid="hover-learn-step">
            <strong>Flight 1 done.</strong> It learned a hover throttle of{' '}
            {state.hoverThrottle?.toFixed(3)}. Was that a good, steady hover?
          </p>
          <div className="button-row">
            <button
              type="button"
              style={buttonStyle('primary')}
              data-testid="hover-learn-flight-1-yes"
              disabled={!canStage}
              onClick={() => setDraft('ACC_ZBIAS_LEARN', String(ACC_ZBIAS_LEARN_SAVE))}
            >
              Yes — go to flight 2
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
              No — fly flight 1 again
            </button>
          </div>
          <small data-testid="hover-learn-flight-1-no-hint">
            Flying again simply overwrites it — the vehicle re-learns the hover throttle every flight
            while MOT_HOVER_LEARN is 2.
          </small>
        </>
      ) : null}

      {stage === 'flight-2' ? (
        <>
          <p data-testid="hover-learn-step">
            <strong>Flight 2 — accelerometer Z-bias.</strong> {FLIGHT_INSTRUCTIONS} Same flight as before.
          </p>
          <small data-testid="hover-learn-flight-2-hint">
            Z-bias learning is staged and saves on disarm — go and fly it.
          </small>
        </>
      ) : null}

      {stage === 'flight-2-review' ? (
        <>
          <p data-testid="hover-learn-step">
            <strong>Flight 2 done.</strong> A Z-bias was learned. Was that a good, steady hover?
          </p>
          <div className="button-row">
            <button
              type="button"
              style={buttonStyle('primary')}
              data-testid="hover-learn-flight-2-yes"
              disabled={!canStage}
              // Keep bit 0 set so later hovers keep refining it, and add bit 1
              // so the learned bias is actually applied.
              onClick={() =>
                setDraft('ACC_ZBIAS_LEARN', String(ACC_ZBIAS_LEARN_SAVE | ACC_ZBIAS_LEARN_USE))
              }
            >
              Yes — apply the learned bias
            </button>
            <button
              type="button"
              style={buttonStyle()}
              data-testid="hover-learn-flight-2-no"
              disabled={!canStage}
              // Clear the learned bias so the next flight starts from zero
              // rather than refining a bad measurement.
              onClick={() => {
                for (const id of state.biasParamIds) {
                  setDraft(id, '0')
                }
                setDraft('ACC_ZBIAS_LEARN', String(ACC_ZBIAS_LEARN_SAVE))
              }}
            >
              No — fly flight 2 again
            </button>
          </div>
        </>
      ) : null}

      {stage === 'complete' ? (
        <p className="success-copy" data-testid="hover-learn-done">
          Both flights are done and the learned Z-bias is being applied. Further hovers keep refining it.
        </p>
      ) : null}

      {/* Start over on a vehicle that arrives with someone else's calibration —
          the case that makes a drone read as already finished. */}
      <div className="button-row">
        <button
          type="button"
          style={buttonStyle()}
          data-testid="hover-learn-zeroize"
          disabled={!canStage}
          onClick={zeroize}
          title="Clears the learned hover throttle and Z-bias and returns to flight 1."
        >
          Zeroize Hover Cal
        </button>
      </div>

      <small>
        {canStage
          ? 'Staged like any other change — nothing is written until you apply it.'
          : 'Connect and finish parameter sync first.'}
      </small>
    </article>
  )
}
