import type { ConfiguratorSnapshot } from '@arduconfig/ardupilot-core'
import { describe, expect, it } from 'vitest'

import {
  canRunGuidedAction,
  deriveCompassStepSkipReason,
  guidedActionBlockingReason,
  guidedActionButtonLabel,
  hasRunningGuidedAction,
  isGuidedActionBusyKey
} from './guided-action-helpers'

type ActionState = { status: string; ctaLabel?: string; summary?: string; statusTexts?: string[] }

function snap(actions: Record<string, ActionState>, over: Record<string, unknown> = {}): ConfiguratorSnapshot {
  return {
    connection: { kind: 'connected' },
    vehicle: { armed: false, vehicle: 'ArduCopter' },
    parameterStats: { status: 'complete' },
    motorTest: { status: 'idle' },
    parameters: [],
    guidedActions: Object.fromEntries(
      Object.entries(actions).map(([id, state]) => [id, { summary: '', statusTexts: [], ...state }])
    ),
    ...over
  } as unknown as ConfiguratorSnapshot
}

const accel = 'calibrate-accelerometer'

describe('guidedActionBlockingReason', () => {
  it('requires a connection first', () => {
    expect(guidedActionBlockingReason(snap({ [accel]: { status: 'idle' } }, { connection: { kind: 'disconnected' } }), accel)).toBe(
      'Connect to a vehicle first.'
    )
  })

  it('blocks while another guided action is in progress', () => {
    const reason = guidedActionBlockingReason(snap({ [accel]: { status: 'idle' }, 'calibrate-level': { status: 'running' } }), accel)
    expect(reason).toMatch(/already in progress\.$/)
  })

  it('blocks while a motor test is running', () => {
    expect(guidedActionBlockingReason(snap({ [accel]: { status: 'idle' } }, { motorTest: { status: 'running' } }), accel)).toBe(
      'Finish the current motor test first.'
    )
  })

  it('request-parameters is runnable when connected even before a heartbeat', () => {
    expect(
      guidedActionBlockingReason(snap({ 'request-parameters': { status: 'idle' } }, { vehicle: undefined }), 'request-parameters')
    ).toBeUndefined()
  })

  it('walks the heartbeat -> disarm -> param-sync gate for a real action', () => {
    expect(guidedActionBlockingReason(snap({ [accel]: { status: 'idle' } }, { vehicle: undefined }), accel)).toBe(
      'Waiting for vehicle heartbeat.'
    )
    expect(guidedActionBlockingReason(snap({ [accel]: { status: 'idle' } }, { vehicle: { armed: true } }), accel)).toBe(
      'Disarm the vehicle before running this action.'
    )
    expect(
      guidedActionBlockingReason(snap({ [accel]: { status: 'idle' } }, { parameterStats: { status: 'syncing' } }), accel)
    ).toBe('Finish pulling parameters before running this action.')
  })

  it('blocks compass calibration when no compass is enabled', () => {
    expect(guidedActionBlockingReason(snap({ 'calibrate-compass': { status: 'idle' } }), 'calibrate-compass')).toMatch(
      /No enabled compass/
    )
  })

  it('returns undefined (and canRunGuidedAction true) for a fully-ready action', () => {
    const snapshot = snap({ [accel]: { status: 'idle' } })
    expect(guidedActionBlockingReason(snapshot, accel)).toBeUndefined()
    expect(canRunGuidedAction(snapshot, accel)).toBe(true)
  })
})

describe('guidedActionButtonLabel', () => {
  it('shows a sending state while its own busy action runs', () => {
    expect(guidedActionButtonLabel('request-parameters', snap({ 'request-parameters': { status: 'idle' } }), 'request-parameters')).toBe('Requesting…')
    expect(guidedActionButtonLabel(accel, snap({ [accel]: { status: 'idle' } }), accel)).toBe('Sending…')
  })

  it('reflects the action status, preferring a server-provided cta label', () => {
    expect(guidedActionButtonLabel(accel, snap({ [accel]: { status: 'running', ctaLabel: 'Hold still' } }), undefined)).toBe('Hold still')
    expect(guidedActionButtonLabel(accel, snap({ [accel]: { status: 'running' } }), undefined)).toBe('In Progress…')
    expect(guidedActionButtonLabel('request-parameters', snap({ 'request-parameters': { status: 'running' } }), undefined)).toBe('Syncing…')
    expect(guidedActionButtonLabel(accel, snap({ [accel]: { status: 'succeeded' } }), undefined)).toBe('Run Again')
    expect(guidedActionButtonLabel('request-parameters', snap({ 'request-parameters': { status: 'succeeded' } }), undefined)).toBe('Re-sync Parameters')
    expect(guidedActionButtonLabel(accel, snap({ [accel]: { status: 'failed' } }), undefined)).toBe('Retry')
  })
})

describe('deriveCompassStepSkipReason', () => {
  it('flags no-enabled-compass first', () => {
    expect(deriveCompassStepSkipReason(snap({ 'calibrate-compass': { status: 'idle' } }))).toBe('no-enabled-compass')
  })

  it('flags unsupported when a failed run reports an unsupported/no-compass message', () => {
    const snapshot = snap(
      { 'calibrate-compass': { status: 'failed', summary: 'MAG_CAL UNSUPPORTED by firmware', statusTexts: [] } },
      { parameters: [{ id: 'COMPASS_USE', value: 1 }, { id: 'COMPASS_DEV_ID', value: 97 }] }
    )
    expect(deriveCompassStepSkipReason(snapshot)).toBe('unsupported')
  })
})

describe('small guards', () => {
  it('hasRunningGuidedAction detects requested/running states', () => {
    expect(hasRunningGuidedAction(snap({ [accel]: { status: 'idle' } }))).toBe(false)
    expect(hasRunningGuidedAction(snap({ [accel]: { status: 'requested' } }))).toBe(true)
  })

  it('isGuidedActionBusyKey recognizes guided action ids', () => {
    expect(isGuidedActionBusyKey(accel)).toBe(true)
    expect(isGuidedActionBusyKey('connect')).toBe(false)
    expect(isGuidedActionBusyKey(undefined)).toBe(false)
  })
})
