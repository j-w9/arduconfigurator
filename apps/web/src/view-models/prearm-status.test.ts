import type { PreArmStatusState } from '@arduconfig/ardupilot-core'
import { describe, expect, it } from 'vitest'

import { buildPreArmStatusViewModel } from './prearm-status'

const T0 = 1_700_000_000_000

/**
 * A synthetic message timeline, expressed the way the runtime hands it over:
 * `issues` is the latched `PreArm:` STATUSTEXT history, `liveCheck` is the
 * SYS_STATUS pre-arm bit (absent once SYS_STATUS goes stale).
 */
function status(overrides: Partial<PreArmStatusState> = {}): PreArmStatusState {
  return {
    healthy: true,
    issues: [],
    ...overrides
  }
}

function issue(text: string, lastSeenAtMs: number) {
  return { text, severity: 'warning' as const, firstSeenAtMs: lastSeenAtMs, lastSeenAtMs }
}

const liveCheck = (passing: boolean, lastSeenAtMs = T0) => ({
  present: true,
  enabled: true,
  passing,
  lastSeenAtMs
})

describe('buildPreArmStatusViewModel', () => {
  it('reports the live pass verdict as live, not merely "nothing latched"', () => {
    const vm = buildPreArmStatusViewModel({
      preArmStatus: status({ healthy: true, liveCheck: liveCheck(true) }),
      nowMs: T0
    })

    expect(vm.source).toBe('live')
    expect(vm.tone).toBe('success')
    expect(vm.badgeLabel).toBe('Clear')
    expect(vm.summary).toContain('passing')
    expect(vm.issues).toEqual([])
  })

  it('the operator-reported case: a failure reported 45s ago, live bit now passing', () => {
    // The runtime drops the latched issues the moment a usable passing verdict
    // arrives, so the box goes green within one SYS_STATUS period (~0.5s)
    // rather than waiting out ArduPilot's 30s re-report window.
    const vm = buildPreArmStatusViewModel({
      preArmStatus: status({ healthy: true, issues: [], liveCheck: liveCheck(true, T0 + 45_000) }),
      nowMs: T0 + 45_000
    })

    expect(vm.healthy).toBe(true)
    expect(vm.badgeLabel).toBe('Clear')
    expect(vm.source).toBe('live')
  })

  it('shows a live failure that has no reason text yet, instead of an empty green box', () => {
    const vm = buildPreArmStatusViewModel({
      preArmStatus: status({ healthy: false, issues: [], liveCheck: liveCheck(false) }),
      nowMs: T0
    })

    expect(vm.tone).toBe('warning')
    expect(vm.badgeLabel).toBe('Blocked')
    expect(vm.summary).toContain('failing')
    expect(vm.summary).toContain('30s')
  })

  it('ages every latched reason so a stale line cannot read as a live one', () => {
    const vm = buildPreArmStatusViewModel({
      preArmStatus: status({
        healthy: false,
        issues: [issue('PreArm: Compass not calibrated', T0 - 42_000), issue('PreArm: GPS 1 failing', T0 - 3_000)],
        liveCheck: liveCheck(false)
      }),
      nowMs: T0
    })

    expect(vm.badgeLabel).toBe('2 issues')
    expect(vm.issues.map((row) => row.ageLabel)).toEqual(['reported 42s ago', 'reported 3s ago'])
  })

  it('uses the singular for a lone issue', () => {
    const vm = buildPreArmStatusViewModel({
      preArmStatus: status({ healthy: false, issues: [issue('PreArm: Throttle below failsafe', T0)], liveCheck: liveCheck(false) }),
      nowMs: T0
    })

    expect(vm.badgeLabel).toBe('1 issue')
  })

  it('falls back to "reported" and hedges when SYS_STATUS carries no usable verdict', () => {
    // ARMING_CHECK=0: firmware advertises the bit as present but never enables
    // it, so its health value says nothing about the checks.
    const vm = buildPreArmStatusViewModel({
      preArmStatus: status({
        healthy: false,
        issues: [issue('PreArm: Battery below minimum arming voltage', T0 - 20_000)],
        liveCheck: { present: true, enabled: false, passing: false, lastSeenAtMs: T0 }
      }),
      nowMs: T0
    })

    expect(vm.source).toBe('reported')
    expect(vm.summary).toContain('may already be resolved')
  })

  it('does not claim "clear" when there is neither a live verdict nor any report', () => {
    const vm = buildPreArmStatusViewModel({ preArmStatus: status({ healthy: true }), nowMs: T0 })

    expect(vm.source).toBe('reported')
    expect(vm.badgeLabel).toBe('Clear')
    expect(vm.summary).toContain('not being published')
  })

  it('rolls long ages up to minutes and hours', () => {
    const vm = buildPreArmStatusViewModel({
      preArmStatus: status({
        healthy: false,
        issues: [issue('PreArm: A', T0 - 125_000), issue('PreArm: B', T0 - 7_500_000)]
      }),
      nowMs: T0
    })

    expect(vm.issues.map((row) => row.ageLabel)).toEqual(['reported 2m ago', 'reported 2h ago'])
  })
})
