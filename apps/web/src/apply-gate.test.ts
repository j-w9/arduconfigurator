import type { ConfiguratorSnapshot } from '@arduconfig/ardupilot-core'
import { describe, expect, it } from 'vitest'

import { canApplyParameterChanges, parameterApplyBlockedReason } from './apply-gate'

/**
 * Two functions check the same five conditions in DIFFERENT orders, and until
 * now nothing asserted they agree. That divergence is not hypothetical here:
 * this module's own header records lesson #363, where one of them gained a
 * condition the other did not and "save stopped working" after the first write.
 *
 * The table below is the shared source of truth — each case is fed to both.
 */
function snapshot(overrides: Record<string, unknown> = {}): ConfiguratorSnapshot {
  return {
    connection: { kind: 'connected' },
    vehicle: { firmware: 'ArduPilot', vehicle: 'ArduCopter', systemId: 1, componentId: 1, armed: false, flightMode: 'STABILIZE' },
    parameterStats: { downloaded: 10, total: 10, duplicateFrames: 0, status: 'complete', progress: 1 },
    guidedActions: {},
    // hasRunningGuidedAction also consults the motor test — a spinning motor is
    // as much a reason to refuse a write as a running calibration.
    motorTest: { status: 'idle' },
    ...overrides
  } as unknown as ConfiguratorSnapshot
}

const BLOCKED_CASES: Array<{ name: string; snapshot: ConfiguratorSnapshot; reason: RegExp }> = [
  {
    name: 'disconnected',
    snapshot: snapshot({ connection: { kind: 'disconnected' } }),
    reason: /connect to a vehicle/i
  },
  {
    name: 'no heartbeat yet',
    snapshot: snapshot({ vehicle: undefined }),
    reason: /heartbeat/i
  },
  {
    name: 'parameter sync incomplete',
    snapshot: snapshot({
      parameterStats: { downloaded: 3, total: 10, duplicateFrames: 0, status: 'streaming', progress: 0.3 }
    }),
    reason: /sync is still in progress/i
  },
  {
    name: 'armed',
    snapshot: snapshot({
      vehicle: { firmware: 'ArduPilot', vehicle: 'ArduCopter', systemId: 1, componentId: 1, armed: true, flightMode: 'STABILIZE' }
    }),
    reason: /disarm the vehicle/i
  },
  {
    name: 'a guided action is running',
    snapshot: snapshot({ guidedActions: { 'calibrate-compass': { status: 'running' } } }),
    reason: /calibration or guided action/i
  },
  {
    name: 'a motor test is running',
    snapshot: snapshot({ motorTest: { status: 'running' } }),
    reason: /calibration or guided action/i
  }
]

describe('the apply gate and its reason string agree', () => {
  it('permits an apply when everything is ready', () => {
    expect(canApplyParameterChanges(snapshot())).toBe(true)
    expect(parameterApplyBlockedReason(snapshot())).toBeUndefined()
  })

  for (const testCase of BLOCKED_CASES) {
    it(`blocks and explains: ${testCase.name}`, () => {
      // The pairing is the point. One returning true while the other returns a
      // reason means a button the operator can press that then refuses, or —
      // worse — a disabled button with no explanation.
      expect(canApplyParameterChanges(testCase.snapshot)).toBe(false)
      expect(parameterApplyBlockedReason(testCase.snapshot)).toMatch(testCase.reason)
    })
  }
})

describe('lesson #363', () => {
  it('does NOT block on a pending refresh follow-up', () => {
    // Every write verifies against a live readback and updates the cached
    // snapshot, so a write never depends on a manual pull first. Gating on this
    // meant the SECOND save was silently disabled until the user re-pulled.
    const afterAWrite = snapshot({ parameterFollowUp: { refreshRequired: true, requiresReboot: false, text: 'x' } })
    expect(canApplyParameterChanges(afterAWrite)).toBe(true)
    expect(parameterApplyBlockedReason(afterAWrite)).toBeUndefined()
  })
})
