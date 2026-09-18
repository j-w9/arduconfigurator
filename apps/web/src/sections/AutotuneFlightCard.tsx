// Autotune as a flight you come back from.
//
// Autotune runs in the air and saves on disarm, so the configurator cannot
// watch it happen — the same constraint as hover learning. What it can do is
// remember the gains before the flight, compare them after, and say per axis
// what actually got tuned.
//
// Per axis matters: autotune can finish roll and pitch and give up on yaw, and
// "it didn't work" would be wrong about two thirds of that flight.

import { useState, type ReactElement } from 'react'
import { StatusBadge, buttonStyle } from '@arduconfig/ui-kit'

import type { ConfiguratorSnapshot } from '@arduconfig/ardupilot-core'

import {
  clearAutotuneFlight,
  loadAutotuneFlight,
  saveAutotuneFlight
} from '../autotune-flight-storage'
import { readRoundedParameter } from '../selectors/parameter-read'
import {
  AUTOTUNE_AXES,
  autotuneGainsToReset,
  compareAutotuneGains,
  describeAxisMask,
  readAutotuneGains
} from '../view-models/autotune-flight'

export interface AutotuneFlightCardProps {
  snapshot: ConfiguratorSnapshot
  canApplyDraftParameters: boolean
  busyAction: string | undefined
  setDraft: (paramId: string, value: string) => void
}

export function AutotuneFlightCard({
  snapshot,
  canApplyDraftParameters,
  busyAction,
  setDraft
}: AutotuneFlightCardProps): ReactElement | null {
  const liveMask = readRoundedParameter(snapshot, 'AUTOTUNE_AXES')
  // Without AUTOTUNE_AXES there is no autotune on this build.
  const [pendingMask, setPendingMask] = useState<number | undefined>(undefined)
  const flight = loadAutotuneFlight(snapshot)

  if (liveMask === undefined) {
    return null
  }

  const mask = pendingMask ?? liveMask
  const canStage = canApplyDraftParameters && busyAction === undefined
  const comparison = flight ? compareAutotuneGains(flight.gains, snapshot, flight.axisMask) : undefined
  // Only what would actually change, so an axis already at stock stages nothing
  // and the operator sees the size of what they are undoing before they do it.
  const resettable = autotuneGainsToReset(snapshot, mask)
  const isCopter = snapshot.vehicle?.vehicle === 'ArduCopter'

  const armFlight = (): void => {
    // Stage the axes AND record what the gains are now. The fingerprint is what
    // makes "did it complete" answerable when they plug back in — a flag would
    // only say what was asked for.
    setDraft('AUTOTUNE_AXES', String(mask))
    saveAutotuneFlight(snapshot, {
      axisMask: mask,
      gains: readAutotuneGains(snapshot, mask),
      startedAtMs: Date.now()
    })
    setPendingMask(undefined)
  }

  return (
    <article className="calibration-card" data-testid="calibration-card-autotune-flight">
      <div className="calibration-card__header">
        <strong>Autotune flight</strong>
        <StatusBadge tone={comparison?.complete ? 'success' : flight ? 'warning' : 'neutral'}>
          {comparison?.complete ? 'tuned' : flight ? 'flown?' : 'setup'}
        </StatusBadge>
      </div>

      {!flight ? (
        <>
          <p>
            Pick the axes, fly autotune, then come back and plug in — this remembers the gains you
            started from and tells you which axes actually got tuned.
          </p>
          <div className="autotune-axis-picker" data-testid="autotune-axis-picker">
            {AUTOTUNE_AXES.map((axis) => (
              <label key={axis.bit} className="initial-tune__check">
                <input
                  type="checkbox"
                  data-testid={`autotune-axis-${axis.label.toLowerCase().replace(' ', '-')}`}
                  checked={(mask & axis.bit) !== 0}
                  disabled={!canStage}
                  onChange={(event) =>
                    setPendingMask(event.target.checked ? mask | axis.bit : mask & ~axis.bit)
                  }
                />
                <span>{axis.label}</span>
              </label>
            ))}
          </div>
          <small data-testid="autotune-axis-hint">
            One axis at a time converges faster when you are searching; two is usual once you are close.
            Selected: {describeAxisMask(mask)}.
          </small>
          <button
            type="button"
            style={buttonStyle('primary')}
            data-testid="autotune-arm"
            disabled={!canStage || mask === 0}
            onClick={armFlight}
          >
            Stage autotune for {describeAxisMask(mask)}
          </button>
        </>
      ) : (
        <>
          <p data-testid="autotune-flight-result">
            {comparison?.complete
              ? `Autotune saved new gains for ${comparison.changedAxes.join(', ')}. Was that a good flight?`
              : comparison && comparison.changedAxes.length > 0
                ? `Autotune saved ${comparison.changedAxes.join(', ')}, but ${comparison.unchangedAxes.join(', ')} came back unchanged — that axis did not complete.`
                : `Set up for ${describeAxisMask(flight.axisMask)}. Nothing has changed yet, so either the flight has not happened or autotune did not save.`}
          </p>
          <div className="button-row">
            {comparison && comparison.changedAxes.length > 0 ? (
              <button
                type="button"
                style={buttonStyle('primary')}
                data-testid="autotune-accept"
                disabled={!canStage}
                onClick={() => clearAutotuneFlight(snapshot)}
              >
                Yes — keep these gains
              </button>
            ) : null}
            <button
              type="button"
              style={buttonStyle()}
              data-testid="autotune-restart"
              disabled={!canStage}
              onClick={() => clearAutotuneFlight(snapshot)}
            >
              {comparison && comparison.changedAxes.length > 0 ? 'No — set up another flight' : 'Start over'}
            </button>
          </div>
          <small>
            Accepting or starting over does not change the gains — autotune already saved them on the
            vehicle. Use Zeroize below to put them back to stock.
          </small>
        </>
      )}
      {/* Put the tune back to ArduCopter's own defaults.
        *
        * Multirotor values, so it is Copter-only: writing multi defaults onto a
        * heli or Sub would be worse than leaving a bad tune in place. Staged
        * like everything else, and it lists what it would move so the operator
        * is not undoing a tune blind. */}
      {isCopter ? (
        <div className="button-row">
          <button
            type="button"
            style={buttonStyle()}
            data-testid="autotune-zeroize"
            disabled={!canStage || resettable.length === 0}
            title={
              resettable.length === 0
                ? `${describeAxisMask(mask)} already match the ArduCopter defaults.`
                : `Stage ${resettable.length} gain(s) back to the ArduCopter defaults.`
            }
            onClick={() => {
              for (const gain of resettable) {
                setDraft(gain.id, String(gain.to))
              }
              clearAutotuneFlight(snapshot)
            }}
          >
            Zeroize Tune ({describeAxisMask(mask)})
          </button>
        </div>
      ) : null}
      {isCopter ? (
        <small data-testid="autotune-zeroize-hint">
          {resettable.length === 0
            ? `${describeAxisMask(mask)} are already at the ArduCopter defaults.`
            : `Zeroize stages ${resettable.length} gain(s) back to stock — undoing a tune, so take a snapshot first if you might want it back.`}
        </small>
      ) : null}
    </article>
  )
}
