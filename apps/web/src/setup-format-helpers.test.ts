import type { AppViewId } from '@arduconfig/param-metadata'
import type { SetupSectionOutcome } from './app-types'
import { describe, expect, it } from 'vitest'

import {
  formatConfirmationTime,
  formatDegrees,
  formatOrientationLabel,
  formatSetupOutcome,
  missionTitleForView,
  viewMonogram
} from './setup-format-helpers'

describe('formatConfirmationTime', () => {
  it('says "Not confirmed" when there is no timestamp, otherwise a non-empty time', () => {
    expect(formatConfirmationTime(undefined)).toBe('Not confirmed')
    expect(formatConfirmationTime(0)).not.toBe('Not confirmed')
    expect(formatConfirmationTime(1_700_000_000_000).length).toBeGreaterThan(0)
  })
})

describe('formatSetupOutcome', () => {
  it('maps each outcome, with a Resolved fallback', () => {
    expect(formatSetupOutcome('complete')).toBe('Complete')
    expect(formatSetupOutcome('not-applicable')).toBe('Not applicable')
    expect(formatSetupOutcome('already-done')).toBe('Already done')
    expect(formatSetupOutcome('deferred')).toBe('Deferred')
    expect(formatSetupOutcome('something-else' as SetupSectionOutcome)).toBe('Resolved')
  })
})

describe('formatOrientationLabel / formatDegrees', () => {
  it('handles unknown + unmapped orientation values', () => {
    expect(formatOrientationLabel(undefined)).toBe('Unknown orientation')
    expect(formatOrientationLabel(99999)).toBe('Orientation 99999')
    expect(formatOrientationLabel(0).length).toBeGreaterThan(0)
  })

  it('formats degrees to one decimal, Unknown for undefined', () => {
    expect(formatDegrees(undefined)).toBe('Unknown')
    expect(formatDegrees(45)).toBe('45.0°')
  })
})

describe('viewMonogram / missionTitleForView', () => {
  it('gives a short monogram per view, APP for anything unmapped', () => {
    expect(viewMonogram('setup')).toBe('ST')
    expect(viewMonogram('osd')).toBe('OSD')
    expect(viewMonogram('parameters')).toBe('PAR')
    expect(viewMonogram('totally-unknown' as AppViewId)).toBe('APP')
  })

  it('returns a non-empty mission title for a known view', () => {
    expect(missionTitleForView('setup').length).toBeGreaterThan(0)
  })
})
