// Flight 2 of hover calibration: the accelerometer Z-bias that vibration
// rectification leaves behind, learned in a hover and saved on disarm.
//
// Fork-only (ACC_ZBIAS_LEARN), so the card hides itself entirely on firmware
// that cannot do it rather than offering a flight that would record nothing.
//
// Split out of the combined hover card: this is a separate flight with a
// separate outcome, and it has a real PREREQUISITE — an accepted hover
// throttle. Learning a bias on top of a wrong feedforward measures the
// feedforward's error as much as the accelerometer's.

import type { ReactElement } from 'react'
import { StatusBadge, buttonStyle } from '@arduconfig/ui-kit'

import type { ConfiguratorSnapshot } from '@arduconfig/ardupilot-core'

import {
  ACC_ZBIAS_LEARN_SAVE,
  ACC_ZBIAS_LEARN_USE,
  MOT_HOVER_LEARN_AND_SAVE,
  deriveHoverLearnState
} from '../view-models/hover-learn-stage'
import { hoverFlightInstructions } from './HoverThrottleLearnCard'

export interface AccelZBiasCardProps {
  snapshot: ConfiguratorSnapshot
  canApplyDraftParameters: boolean
  busyAction: string | undefined
  setDraft: (paramId: string, value: string) => void
}

export function AccelZBiasCard({
  snapshot,
  canApplyDraftParameters,
  busyAction,
  setDraft
}: AccelZBiasCardProps): ReactElement | null {
  const state = deriveHoverLearnState(snapshot)

  // Fork-only: without ACC_ZBIAS_LEARN the flight cannot be flown at all.
  if (!state.supported) {
    return null
  }

  const canStage = canApplyDraftParameters && busyAction === undefined
  const { stage } = state
  const ekfWrong = state.ekfType !== undefined && state.ekfType !== 3
  // The hover throttle has not been accepted yet, so this flight is not due.
  const waiting = stage === 'unknown' || stage === 'flight-1' || stage === 'flight-1-review'

  /**
   * Clear the learned Z-BIAS and re-arm learning. Deliberately leaves
   * MOT_THST_HOVER alone.
   *
   * It used to write the 0.35 default back so the sequence would restart from
   * the first flight. That bought a tidy stage machine with a genuinely bad
   * value on the aircraft: MOT_THST_HOVER is the vertical feedforward, so 0.35
   * on a light quad that hovers at 0.118 tells the controller to expect roughly
   * three times the thrust it needs, and the next AltHold takeoff leaps.
   */
  const clearBias = (): void => {
    for (const id of state.biasParamIds) {
      setDraft(id, '0')
    }
    setDraft('ACC_ZBIAS_LEARN', '0')
    // Back to the firmware default rather than 0: 2 is what a stock copter
    // ships with, and it is what makes the next hover learn at all.
    setDraft('MOT_HOVER_LEARN', String(MOT_HOVER_LEARN_AND_SAVE))
  }

  return (
    <article className="calibration-card" data-testid="calibration-card-zbias">
      <div className="calibration-card__header">
        <strong>Accelerometer Z-bias</strong>
        <StatusBadge tone={stage === 'complete' ? 'success' : waiting ? 'neutral' : 'warning'}>
          {stage === 'complete' ? 'complete' : waiting ? 'waiting' : 'flight 2'}
        </StatusBadge>
      </div>
      <p>
        Vibration rectifies through the accelerometer and reads as a steady vertical bias. This
        learns it in a hover and applies the correction inside EKF3.
      </p>

      <div className="config-pills">
        <span data-tone={state.biasLearned ? 'success' : 'neutral'}>
          Z-bias: {state.biasLearned ? 'learned' : 'not learned'}
        </span>
        <span data-tone={stage === 'complete' ? 'success' : waiting ? 'neutral' : 'warning'}>
          ACC_ZBIAS_LEARN: {state.zbiasLearn ?? '—'}
        </span>
      </div>

      {ekfWrong ? (
        <p className="switch-exercise-warning" data-testid="hover-learn-ekf-warning">
          Z-bias learning only works on EKF3 (AHRS_EKF_TYPE = 3); this vehicle reports {state.ekfType}
          . This flight will not learn anything until that is changed.
        </p>
      ) : null}

      {waiting ? (
        <p className="bf-note" data-testid="zbias-prerequisite">
          Accept a hover throttle first, on the card above. A bias learned on top of a wrong vertical
          feedforward measures the feedforward&apos;s error as much as the accelerometer&apos;s.
        </p>
      ) : null}

      {stage === 'flight-2' ? (
        <>
          <p data-testid="hover-learn-step">
            <strong>Fly the same hover again.</strong> {hoverFlightInstructions(state.valtSupported)}
          </p>
          <small data-testid="hover-learn-flight-2-frozen">
            Hover learning is off (MOT_HOVER_LEARN = 0), so this flight cannot overwrite the hover
            throttle you accepted.
          </small>
          <small data-testid="hover-learn-flight-2-hint">
            Z-bias learning is staged and saves on disarm — go and fly it.
          </small>
        </>
      ) : null}

      {stage === 'flight-2-review' ? (
        <>
          <p data-testid="hover-learn-step">
            <strong>Flight done.</strong> A Z-bias was learned. Was that a good, steady hover?
          </p>
          <div className="button-row">
            <button
              type="button"
              style={buttonStyle('primary')}
              data-testid="hover-learn-flight-2-yes"
              disabled={!canStage}
              // 2 = apply, stop learning. Clearing bit 0 FREEZES the accepted
              // bias, the same reasoning as freezing MOT_HOVER_LEARN after the
              // first flight: later hovers would otherwise keep moving a value
              // the operator signed off. Clear Z-Bias Cal re-arms it.
              onClick={() => setDraft('ACC_ZBIAS_LEARN', String(ACC_ZBIAS_LEARN_USE))}
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
                setDraft('ACC_ZBIAS_LEARN', String(ACC_ZBIAS_LEARN_SAVE | ACC_ZBIAS_LEARN_USE))
              }}
            >
              No — fly it again
            </button>
          </div>
        </>
      ) : null}

      {stage === 'complete' ? (
        <p className="success-copy" data-testid="hover-learn-done">
          The learned Z-bias is being applied, and learning is off so nothing moves it.
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
          onClick={clearBias}
          title="Clears the learned Z-bias and re-arms hover learning. The measured hover throttle is left alone."
        >
          Clear Z-Bias Cal
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
