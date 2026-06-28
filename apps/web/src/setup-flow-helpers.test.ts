import type { SetupFlowCriterion } from './app-types'
import { describe, expect, it } from 'vitest'

import {
  deriveSetupStatusFromCriteria,
  escCalibrationInstructions,
  escCalibrationPathLabel,
  panelAnchorForSetupSection
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
    // failsafe + power share the power panel
    expect(panelAnchorForSetupSection('failsafe')).toEqual(panelAnchorForSetupSection('power'))
    // unknown falls back to guided
    expect(panelAnchorForSetupSection('mystery').panelId).toBe('setup-panel-guided')
  })
})
