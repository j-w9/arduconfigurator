// Two-flight hover learning: the hover throttle, then the accelerometer Z-bias
// that vibration leaves behind. Both are learned in the AIR and saved on
// DISARM, so neither can be driven from a bench — this card only sequences
// them and reports what the vehicle came back with.

import { useCallback, useState, type ReactElement } from 'react'
import { StatusBadge, buttonStyle } from '@arduconfig/ui-kit'
import { analyzeHoverThrottleBuffer, type HoverThrottleResult } from '@arduconfig/log-analysis'

import type { ConfiguratorSnapshot } from '@arduconfig/ardupilot-core'

import {
  ACC_ZBIAS_LEARN_SAVE,
  ACC_ZBIAS_LEARN_USE,
  MOT_HOVER_LEARN_AND_SAVE,
  MOT_HOVER_LEARN_DISABLED,
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
  'Fly this one in a mode that holds altitude — AltHold, Loiter, PosHold or VALT. A hover in ' +
  'Stabilize or Acro learns nothing, whatever it looks like. Take off, climb to about 5 m, then ' +
  'centre the throttle stick and let it sit level with as little input as you can. Twenty seconds ' +
  'of steady hover is enough; a steady minute is better. Land and disarm — the value is saved on ' +
  'disarm. If the firmware did not take it, hand the log from that same flight to the button ' +
  'below and it will be measured from what the aircraft actually flew.'

export function HoverLearnCard({
  snapshot,
  canApplyDraftParameters,
  busyAction,
  setDraft
}: HoverLearnCardProps): ReactElement | null {
  const state = deriveHoverLearnState(snapshot)

  // Measuring the hover throttle from the flight's own log, because the
  // firmware's learner can decline to run and say nothing about it.
  const [logResult, setLogResult] = useState<HoverThrottleResult | null>(null)
  const [logName, setLogName] = useState<string | undefined>()
  const [logError, setLogError] = useState<string | undefined>()
  const [logBusy, setLogBusy] = useState(false)

  const handleLogFile = useCallback(async (file: File) => {
    setLogBusy(true)
    setLogError(undefined)
    setLogResult(null)
    try {
      const buffer = await file.arrayBuffer()
      // Yield once so the button can paint "Reading…" before the parse blocks.
      await new Promise((resolve) => setTimeout(resolve, 0))
      setLogName(file.name)
      setLogResult(analyzeHoverThrottleBuffer(buffer))
    } catch (caught) {
      setLogError(caught instanceof Error ? caught.message : 'Could not read or parse that log.')
    } finally {
      setLogBusy(false)
    }
  }, [])

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
              : stage === 'flight-1'
                ? 'flight 1'
                : stage === 'flight-2'
                  ? 'flight 2'
                  : 'flight 3'}
        </StatusBadge>
      </div>
      <p>
        Three hovers. The first gets a real hover throttle — from the firmware&apos;s own learner, or
        measured from that flight&apos;s log when the learner declined to run. The second flies that
        value to see the aircraft actually hold altitude on it. The third learns the accelerometer
        Z-bias that vibration leaves behind. Nothing downstream means anything until the first number
        is real, which is why it leads.
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
            <strong>Flight 1 — measure the hover throttle.</strong> {FLIGHT_INSTRUCTIONS}
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
          {/* The firmware's learner is not the only route to this number, and
              on a vehicle where a gate stayed shut it is not a route at all:
              it leaves MOT_THST_HOVER at exactly its default, which reads as a
              vehicle that never flew. The flight's own log carries the
              throttle it actually hovered at (CTUN.ThO), so the same 20-second
              hover answers either way. */}
          <div className="log-tuning__upload">
            <label className="log-tuning__file" style={buttonStyle()}>
              {logBusy ? 'Reading…' : 'Measure from a flight log (.bin)'}
              <input
                type="file"
                accept=".bin,application/octet-stream"
                data-testid="hover-learn-log-file"
                style={{ display: 'none' }}
                disabled={logBusy}
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (file) void handleLogFile(file)
                  event.target.value = ''
                }}
              />
            </label>
          </div>

          {logError ? (
            <p className="switch-exercise-warning" data-testid="hover-learn-log-error">
              {logError}
            </p>
          ) : null}

          {logResult ? (
            <div className="bf-note" data-testid="hover-learn-log-result">
              <strong>{logName}</strong>
              {logResult.hoverThrottle === undefined ? (
                <p>No steady hover in this log.</p>
              ) : (
                <>
                  <p>
                    Measured hover throttle <strong>{logResult.hoverThrottle.toFixed(3)}</strong>
                    {logResult.standardDeviation !== undefined
                      ? ` (±${logResult.standardDeviation.toFixed(3)})`
                      : ''}{' '}
                    over {logResult.totalHoverS.toFixed(0)} s of steady hover in{' '}
                    {logResult.windows.length} segment{logResult.windows.length === 1 ? '' : 's'}
                    {logResult.hoverModes.length > 0 ? `, flown in ${logResult.hoverModes.join(' / ')}` : ''}.
                    {logResult.source === 'RATE' ? ' Source: RATE.AOut.' : ''}
                  </p>
                  {logResult.firmwareLearnedLast !== undefined ? (
                    <p data-testid="hover-learn-log-firmware">
                      The firmware&apos;s own MOT_THST_HOVER ended this flight at{' '}
                      {logResult.firmwareLearnedLast.toFixed(3)}
                      {logResult.firmwareLearnerIdle ? ' — it never moved.' : '.'}
                    </p>
                  ) : null}
                  <button
                    type="button"
                    style={buttonStyle('primary')}
                    data-testid="hover-learn-log-stage"
                    disabled={!canStage}
                    onClick={() => setDraft('MOT_THST_HOVER', logResult.hoverThrottle!.toFixed(4))}
                  >
                    Stage MOT_THST_HOVER = {logResult.hoverThrottle.toFixed(3)}
                  </button>
                </>
              )}
              {logResult.warnings.map((warning) => (
                <p key={warning} className="switch-exercise-warning">
                  {warning}
                </p>
              ))}
            </div>
          ) : null}

          <small data-testid="hover-learn-start-hint">
            {state.hoverLearnArmed
              ? 'MOT_HOVER_LEARN is already Learn-and-Save, so this stages nothing — the vehicle will learn on the next hover.'
              : 'Hover learning is OFF on this vehicle, so a flight now would record nothing. This stages MOT_HOVER_LEARN = 2.'}
          </small>
        </>
      ) : null}

      {stage === 'flight-2' ? (
        <>
          <p data-testid="hover-learn-step">
            <strong>Flight 2 — fly it and check.</strong> The hover throttle is{' '}
            {state.hoverThrottle?.toFixed(3)}. Fly the same hover again with that value applied and
            watch what the aircraft does when you centre the throttle: the controller uses
            MOT_THST_HOVER as its feedforward, so a number that is too low sags and one that is too
            high climbs. Did it sit where you put it?
          </p>
          <div className="button-row">
            <button
              type="button"
              style={buttonStyle('primary')}
              data-testid="hover-learn-flight-2-yes"
              disabled={!canStage}
              // Freeze what was just accepted. MOT_HOVER_LEARN left at 2 means
              // flight two -- flown for the Z-bias -- re-learns and overwrites
              // the hover throttle the operator signed off, and the card then
              // reports a value nobody approved. Zeroize puts it back to 2.
              onClick={() => {
                setDraft('ACC_ZBIAS_LEARN', String(ACC_ZBIAS_LEARN_SAVE))
                setDraft('MOT_HOVER_LEARN', String(MOT_HOVER_LEARN_DISABLED))
              }}
            >
              Yes — go to flight 3
            </button>
            <button
              type="button"
              style={buttonStyle()}
              data-testid="hover-learn-flight-2-no"
              disabled={!canStage}
              // Nothing to undo: MOT_HOVER_LEARN stays at Learn-and-Save, so
              // the next hover overwrites what this one learned. Re-assert it
              // in case a previous session left it disabled.
              onClick={() => setDraft('MOT_HOVER_LEARN', String(MOT_HOVER_LEARN_AND_SAVE))}
            >
              No — measure it again
            </button>
          </div>
          <small data-testid="hover-learn-flight-2-no-hint">
            Flying again simply overwrites it — the vehicle re-learns the hover throttle every flight
            while MOT_HOVER_LEARN is 2. Or hand this flight&apos;s log back to Flight 1 and take the
            number from what it actually flew.
          </small>
        </>
      ) : null}

      {stage === 'flight-3' ? (
        <>
          <p data-testid="hover-learn-step">
            <strong>Flight 3 — accelerometer Z-bias.</strong> {FLIGHT_INSTRUCTIONS} Same hover as the
            first two.
          </p>
          <small data-testid="hover-learn-flight-3-frozen">
            Hover learning is off (MOT_HOVER_LEARN = 0), so this flight cannot overwrite the hover
            throttle you accepted. Zeroize Hover Cal turns it back on.
          </small>
          <small data-testid="hover-learn-flight-3-hint">
            Z-bias learning is staged and saves on disarm — go and fly it.
          </small>
        </>
      ) : null}

      {stage === 'flight-3-review' ? (
        <>
          <p data-testid="hover-learn-step">
            <strong>Flight 3 done.</strong> A Z-bias was learned. Was that a good, steady hover?
          </p>
          <div className="button-row">
            <button
              type="button"
              style={buttonStyle('primary')}
              data-testid="hover-learn-flight-3-yes"
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
              data-testid="hover-learn-flight-3-no"
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
              No — fly flight 3 again
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
