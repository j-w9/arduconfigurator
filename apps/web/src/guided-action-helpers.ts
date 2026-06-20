// Guided-action helpers, extracted from App.tsx as part of its decomposition.
// Pure helpers that gate / label / describe the guided calibration & setup
// actions (running-state, busy-key narrowing, blocking reasons, compass-skip
// detection, button labels, accel pose). No React, no app state.

import { deriveCompassSetupAvailability, type ConfiguratorSnapshot } from '@arduconfig/ardupilot-core'

import { actionLabels, type GuidedActionId } from './guided-action-labels'
import type { AccelerometerPoseId } from './accelerometer-pose-guide'

export function hasRunningGuidedAction(snapshot: ConfiguratorSnapshot): boolean {
  return (
    Object.values(snapshot.guidedActions).some((state) => state.status === 'requested' || state.status === 'running') ||
    snapshot.motorTest.status === 'requested' ||
    snapshot.motorTest.status === 'running'
  )
}

export function isGuidedActionBusyKey(value: string | undefined): value is GuidedActionId {
  return value !== undefined && value in actionLabels
}

export function setupActionBusyReason(busyAction: string | undefined, actionId: GuidedActionId, actionTitle: string): string | undefined {
  if (busyAction === undefined) {
    return undefined
  }

  if (busyAction === actionId) {
    return `${actionTitle} request is being sent.`
  }

  if (busyAction.startsWith('connect')) {
    return 'Finish connecting before running setup actions.'
  }

  if (busyAction === 'disconnect') {
    return 'Finish disconnecting before running setup actions.'
  }

  if (busyAction === 'motor-test') {
    return 'Finish the current motor test request first.'
  }

  if (isGuidedActionBusyKey(busyAction)) {
    return `${actionLabels[busyAction]} request is still in flight.`
  }

  return 'Another request is still in flight.'
}

export function guidedActionBlockingReason(snapshot: ConfiguratorSnapshot, actionId: GuidedActionId): string | undefined {
  if (snapshot.connection.kind !== 'connected') {
    return 'Connect to a vehicle first.'
  }

  const currentAction = snapshot.guidedActions[actionId]
  const canContinueCurrentAction =
    actionId === 'calibrate-accelerometer' &&
    (currentAction.status === 'requested' || currentAction.status === 'running') &&
    currentAction.ctaLabel !== undefined
  const blockingAction = Object.entries(snapshot.guidedActions).find(
    ([candidateActionId, state]) =>
      candidateActionId !== actionId && (state.status === 'requested' || state.status === 'running')
  )

  if (blockingAction) {
    return `${actionLabels[blockingAction[0] as GuidedActionId]} is already in progress.`
  }

  if ((currentAction.status === 'requested' || currentAction.status === 'running') && !canContinueCurrentAction) {
    return `${actionLabels[actionId]} is already in progress.`
  }

  if (snapshot.motorTest.status === 'requested' || snapshot.motorTest.status === 'running') {
    return 'Finish the current motor test first.'
  }

  if (actionId === 'request-parameters') {
    return undefined
  }

  if (snapshot.vehicle === undefined) {
    return 'Waiting for vehicle heartbeat.'
  }

  if (snapshot.vehicle.armed) {
    return 'Disarm the vehicle before running this action.'
  }

  if (snapshot.parameterStats.status !== 'complete') {
    return 'Finish pulling parameters before running this action.'
  }

  if (actionId === 'calibrate-compass' && deriveCompassSetupAvailability(snapshot).enabledCompassCount === 0) {
    return 'No enabled compass detected on this vehicle. Skip this step or enable a compass first.'
  }

  return undefined
}

export type CompassStepSkipReason = 'no-enabled-compass' | 'unsupported'

export function deriveCompassStepSkipReason(snapshot: ConfiguratorSnapshot): CompassStepSkipReason | undefined {
  if (deriveCompassSetupAvailability(snapshot).enabledCompassCount === 0) {
    return 'no-enabled-compass'
  }

  const actionState = snapshot.guidedActions['calibrate-compass']
  if (actionState.status !== 'failed') {
    return undefined
  }

  const normalizedEvidence = [actionState.summary, ...actionState.statusTexts].map((text) => text.toLowerCase())
  if (
    normalizedEvidence.some(
      (text) =>
        text.includes('unsupported') ||
        text.includes('no enabled compass') ||
        text.includes('no usable compass')
    )
  ) {
    return 'unsupported'
  }

  return undefined
}

export function canRunGuidedAction(snapshot: ConfiguratorSnapshot, actionId: GuidedActionId): boolean {
  return guidedActionBlockingReason(snapshot, actionId) === undefined
}

export function guidedActionButtonLabel(
  actionId: GuidedActionId,
  snapshot: ConfiguratorSnapshot,
  busyAction: string | undefined
): string {
  if (busyAction === actionId) {
    return actionId === 'request-parameters' ? 'Requesting…' : 'Sending…'
  }

  const state = snapshot.guidedActions[actionId]
  switch (state.status) {
    case 'requested':
    case 'running':
      if (state.ctaLabel) {
        return state.ctaLabel
      }
      return actionId === 'request-parameters' ? 'Syncing…' : 'In Progress…'
    case 'succeeded':
      return actionId === 'request-parameters' ? 'Re-sync Parameters' : 'Run Again'
    case 'failed':
      return 'Retry'
    default:
      return actionLabels[actionId]
  }
}

export function accelerometerPoseFromAction(snapshot: ConfiguratorSnapshot): AccelerometerPoseId {
  const action = snapshot.guidedActions['calibrate-accelerometer']
  const prompt = `${action.ctaLabel ?? ''} ${action.summary}`.toLowerCase()

  if (prompt.includes('left')) {
    return 'left'
  }
  if (prompt.includes('right')) {
    return 'right'
  }
  if (prompt.includes('nose down')) {
    return 'nose-down'
  }
  if (prompt.includes('nose up')) {
    return 'nose-up'
  }
  if (prompt.includes('back')) {
    return 'back'
  }

  return 'level'
}
