// Apply-gate predicates for the "Apply / Save" parameter write flow.
// Pure functions over a ConfiguratorSnapshot; the App component imports
// both and uses canApplyParameterChanges() for the button-disabled state
// and parameterApplyBlockedReason() for the actionable warning string.
//
// Lesson #363: this MUST NOT block on `parameterFollowUp.refreshRequired`.
// Every write goes through runtime.setParameters, which verifies each
// value against a live readback and updates the cached snapshot — so a
// write never depends on a manual "pull parameters" first. Gating on
// refreshRequired meant that after ONE save (which sets refreshRequired),
// the next save was silently disabled until the user re-pulled — i.e.
// "save doesn't work again". The follow-up is advisory guidance (shown
// as a banner), not a hard gate.

import type { ConfiguratorSnapshot } from '@arduconfig/ardupilot-core'

import { hasRunningGuidedAction } from './guided-action-helpers'

/** True iff a parameter-write batch may be sent to the FC right now. */
export function canApplyParameterChanges(snapshot: ConfiguratorSnapshot): boolean {
  return (
    snapshot.connection.kind === 'connected' &&
    snapshot.parameterStats.status === 'complete' &&
    snapshot.vehicle !== undefined &&
    !snapshot.vehicle.armed &&
    !hasRunningGuidedAction(snapshot)
  )
}

/**
 * Specific reason applies are blocked, for an actionable warning message.
 * Returns `undefined` when applies are permitted — pair with the boolean
 * gate above when the UI needs both the disabled state and a hint.
 */
export function parameterApplyBlockedReason(snapshot: ConfiguratorSnapshot): string | undefined {
  if (snapshot.connection.kind !== 'connected') {
    return 'Connect to a vehicle before applying configuration changes.'
  }
  if (snapshot.vehicle === undefined) {
    return 'Waiting for the vehicle heartbeat before applying changes.'
  }
  if (snapshot.parameterStats.status !== 'complete') {
    return 'Parameter sync is still in progress — wait for it to finish before applying.'
  }
  if (snapshot.vehicle.armed) {
    return 'Disarm the vehicle before applying configuration changes.'
  }
  if (hasRunningGuidedAction(snapshot)) {
    return 'A calibration or guided action is still running — wait for it to finish (or cancel it from its calibration card) before applying.'
  }
  return undefined
}
