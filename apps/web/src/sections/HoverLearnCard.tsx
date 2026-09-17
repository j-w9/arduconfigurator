// Two-flight hover learning: MOT_HOVER_LEARN, then ACC_ZBIAS_LEARN.
//
// Both parameters learn in the air and save on DISARM, so neither can be driven
// from a bench — the card's job is to stage the right value before a flight and
// then move the operator on afterwards. Nothing here measures anything; the
// firmware does the learning and this only sequences it.
//
// Values are ArduPilot's:
//   MOT_HOVER_LEARN (AP_MotorsMulticopter.cpp): 0 Disabled, 1 Learn,
//     2 Learn and Save. Stage 2 — a learn that is not saved is a wasted flight.
//   ACC_ZBIAS_LEARN (fork, ArduCopter/Parameters.cpp) is a BITMASK, not an
//     enum: bit 0 Learn and Save, bit 1 Use Saved Values, bit 2 Disable Ground
//     Learning. It compensates vibration rectification and is EKF3-only.
//
// So the second flight stages bit 0 alone (learn it), and accepting that flight
// stages bits 0|1 = 3, which keeps learning while also APPLYING the correction.
// Staging 3 up front would apply a bias that has not been measured yet.

import type { ReactElement } from 'react'
import { StatusBadge, buttonStyle } from '@arduconfig/ui-kit'

import type { ConfiguratorSnapshot } from '@arduconfig/ardupilot-core'

import { readRoundedParameter } from '../selectors/parameter-read'

export interface HoverLearnCardProps {
  snapshot: ConfiguratorSnapshot
  canApplyDraftParameters: boolean
  busyAction: string | undefined
  setDraft: (paramId: string, value: string) => void
}

const ACC_ZBIAS_LEARN_SAVE = 1 << 0
const ACC_ZBIAS_LEARN_USE = 1 << 1

/** The hover blurb, used for both flights — the flying is identical. */
const FLIGHT_INSTRUCTIONS =
  'Take off, climb to about 5 m, and let it hover with as little stick input as you can. ' +
  'Give it a steady minute or so, then land and disarm — the value is saved on disarm.'

export function HoverLearnCard({
  snapshot,
  canApplyDraftParameters,
  busyAction,
  setDraft
}: HoverLearnCardProps): ReactElement | null {
  const hoverLearn = readRoundedParameter(snapshot, 'MOT_HOVER_LEARN')
  const zbias = readRoundedParameter(snapshot, 'ACC_ZBIAS_LEARN')
  const ekfType = readRoundedParameter(snapshot, 'AHRS_EKF_TYPE')

  // Fork-only: ACC_ZBIAS_LEARN does not exist on stock ArduPilot, so its
  // absence means this sequence cannot be completed and the card has no
  // business being on screen.
  if (zbias === undefined) {
    return null
  }

  const thrustHover = snapshot.parameters.find((parameter) => parameter.id === 'MOT_THST_HOVER')?.value
  const hoverLearnArmed = (hoverLearn ?? 0) >= 2
  const zbiasLearning = ((zbias ?? 0) & ACC_ZBIAS_LEARN_SAVE) !== 0
  const zbiasApplied = ((zbias ?? 0) & ACC_ZBIAS_LEARN_USE) !== 0
  const canStage = canApplyDraftParameters && busyAction === undefined

  // Stage 1 until hover learning is armed, stage 2 once it is, done once the
  // bias is being applied. Read from the vehicle rather than local state so it
  // survives the reconnect the flow is built around.
  const stage = zbiasApplied ? 'done' : zbiasLearning ? 'zbias' : hoverLearnArmed ? 'hover-flown' : 'hover'

  // EKF3 only — the bias correction is applied inside EKF3, so on any other
  // estimator the second flight learns nothing.
  const ekfWrong = ekfType !== undefined && ekfType !== 3

  return (
    <article className="calibration-card" data-testid="calibration-card-hover-learn">
      <div className="calibration-card__header">
        <strong>Hover learning (two flights)</strong>
        <StatusBadge tone={stage === 'done' ? 'success' : 'warning'}>
          {stage === 'done' ? 'complete' : stage === 'hover' ? 'flight 1' : 'flight 2'}
        </StatusBadge>
      </div>
      <p>
        Learns the hover throttle, then the accelerometer Z-bias that vibration leaves behind. Both are
        learned in the air and saved when you disarm, so each one costs a flight.
      </p>

      <div className="config-pills">
        <span data-tone={hoverLearnArmed ? 'success' : 'neutral'}>
          MOT_HOVER_LEARN: {hoverLearn ?? '—'}
        </span>
        <span data-tone={thrustHover !== undefined ? 'neutral' : 'neutral'}>
          MOT_THST_HOVER: {thrustHover !== undefined ? thrustHover.toFixed(3) : '—'}
        </span>
        <span data-tone={zbiasApplied ? 'success' : zbiasLearning ? 'warning' : 'neutral'}>
          ACC_ZBIAS_LEARN: {zbias ?? '—'}
        </span>
      </div>

      {ekfWrong ? (
        <p className="switch-exercise-warning" data-testid="hover-learn-ekf-warning">
          Z-bias learning only works on EKF3 (AHRS_EKF_TYPE = 3); this vehicle reports {ekfType}. The
          second flight will not learn anything until that is changed.
        </p>
      ) : null}

      {stage === 'hover' ? (
        <>
          <p data-testid="hover-learn-step">
            <strong>Flight 1 — hover throttle.</strong> {FLIGHT_INSTRUCTIONS}
          </p>
          <button
            type="button"
            style={buttonStyle('primary')}
            data-testid="hover-learn-start"
            disabled={!canStage}
            onClick={() => setDraft('MOT_HOVER_LEARN', '2')}
          >
            Stage Flight 1 (learn hover throttle)
          </button>
        </>
      ) : null}

      {stage === 'hover-flown' ? (
        <>
          <p data-testid="hover-learn-step">
            <strong>Flight 1 is armed.</strong> {FLIGHT_INSTRUCTIONS} Come back, plug in, and confirm
            below — MOT_THST_HOVER above is what it learned.
          </p>
          <button
            type="button"
            style={buttonStyle('primary')}
            data-testid="hover-learn-accept-flight-1"
            disabled={!canStage}
            onClick={() => setDraft('ACC_ZBIAS_LEARN', String(ACC_ZBIAS_LEARN_SAVE))}
          >
            Good flight — move on to flight 2
          </button>
        </>
      ) : null}

      {stage === 'zbias' ? (
        <>
          <p data-testid="hover-learn-step">
            <strong>Flight 2 — accelerometer Z-bias.</strong> {FLIGHT_INSTRUCTIONS} Same flight as
            before. Confirm below afterwards and the learned bias starts being applied.
          </p>
          <button
            type="button"
            style={buttonStyle('primary')}
            data-testid="hover-learn-accept-flight-2"
            disabled={!canStage}
            onClick={() =>
              // Keep learning AND start using it: bit 0 stays set so later
              // flights refine the value.
              setDraft('ACC_ZBIAS_LEARN', String(ACC_ZBIAS_LEARN_SAVE | ACC_ZBIAS_LEARN_USE))
            }
          >
            Good flight — apply the learned bias
          </button>
        </>
      ) : null}

      {stage === 'done' ? (
        <p className="success-copy" data-testid="hover-learn-done">
          Both flights are done and the learned Z-bias is being applied. Bit 0 is still set, so further
          hovers keep refining it.
        </p>
      ) : null}

      <small>
        {canStage
          ? 'Staged like any other change — nothing is written until you apply it.'
          : 'Connect and finish parameter sync first.'}
      </small>
    </article>
  )
}
