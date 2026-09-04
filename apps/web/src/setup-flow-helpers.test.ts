import type { SetupFlowCriterion } from './app-types'
import { describe, expect, it } from 'vitest'

import {
  deriveSetupStatusFromCriteria,
  escCalibrationInstructions,
  escCalibrationPathLabel,
  panelAnchorForSetupSection,
  appViewForPanel
} from './setup-flow-helpers'

const criterion = (met: boolean): SetupFlowCriterion => ({ label: 'c', met })

describe('deriveSetupStatusFromCriteria', () => {
  it('is complete only when every criterion is met', () => {
    expect(deriveSetupStatusFromCriteria([criterion(true), criterion(true)])).toBe('complete')
  })

  it('is attention when none are met or the list is empty, in-progress when partial', () => {
    expect(deriveSetupStatusFromCriteria([])).toBe('attention')
    expect(deriveSetupStatusFromCriteria([criterion(false), criterion(false)])).toBe('attention')
    expect(deriveSetupStatusFromCriteria([criterion(true), criterion(false)])).toBe('in-progress')
  })
})

describe('escCalibrationPathLabel / escCalibrationInstructions', () => {
  it('labels each calibration path', () => {
    expect(escCalibrationPathLabel('analog-calibration')).toBe('Analog ESC calibration')
    expect(escCalibrationPathLabel('digital-protocol')).toBe('Digital protocol review')
    expect(escCalibrationPathLabel('manual-review')).toBe('Manual ESC review')
  })

  it('returns a path-appropriate instruction set (digital protocols need none)', () => {
    expect(escCalibrationInstructions({ calibrationPath: 'analog-calibration' } as Parameters<typeof escCalibrationInstructions>[0])[0]).toMatch(/Remove props/)
    // Digital (DShot) protocols don't use ESC endpoint calibration — no steps.
    expect(escCalibrationInstructions({ calibrationPath: 'digital-protocol' } as Parameters<typeof escCalibrationInstructions>[0])).toEqual([])
    expect(escCalibrationInstructions({ calibrationPath: 'manual-review' } as Parameters<typeof escCalibrationInstructions>[0]).length).toBeGreaterThan(0)
  })
})

describe('panelAnchorForSetupSection', () => {
  it('groups related sections onto one setup panel', () => {
    expect(panelAnchorForSetupSection('link').panelId).toBe('setup-panel-link')
    // airframe + outputs share the outputs panel
    expect(panelAnchorForSetupSection('airframe')).toEqual(panelAnchorForSetupSection('outputs'))
    expect(panelAnchorForSetupSection('outputs').panelLabel).toBe('Airframe & Outputs')
    // guided cal trio share the guided panel
    expect(panelAnchorForSetupSection('compass').panelId).toBe('setup-panel-guided')
    // Failsafe and Modes each route to their OWN tab. They used to be folded
    // onto the power panel and the RC panel respectively, which sent the
    // operator to the Config tab's power section and the Receiver view --
    // neither being where those steps' parameters are edited. Both tabs had
    // carried a setup anchor all along that nothing referenced.
    expect(panelAnchorForSetupSection('failsafe').panelId).toBe('setup-panel-failsafe')
    expect(panelAnchorForSetupSection('modes').panelId).toBe('setup-panel-modes')
    expect(panelAnchorForSetupSection('power').panelId).toBe('setup-panel-power')
    // unknown falls back to guided
    expect(panelAnchorForSetupSection('mystery').panelId).toBe('setup-panel-guided')
  })

  it('routes each setup panel to a view that exists', () => {
    expect(appViewForPanel('setup-panel-failsafe')).toBe('failsafe')
    expect(appViewForPanel('setup-panel-modes')).toBe('modes')
    expect(appViewForPanel('setup-panel-rc')).toBe('receiver')
    expect(appViewForPanel('setup-panel-outputs')).toBe('motors')
  })
})
