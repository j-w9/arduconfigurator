// Setup-flow + ESC-calibration helpers, extracted from App.tsx as part of its
// decomposition. Pure helpers for ESC-calibration labels/instructions, mapping
// a setup section to its panel anchor / nav view / quick action, and deriving a
// setup section's status from its criteria. No React, no app state.

import { deriveEscSetupSummary } from '@arduconfig/ardupilot-core'
import type { AppViewId } from '@arduconfig/param-metadata'

import type { SetupFlowActionDescriptor, SetupFlowCriterion } from './app-types'

// DOM element ids for the Outputs/Setup-wizard scroll + action targets.
export const OUTPUTS_ORIENTATION_TARGET_ID = 'outputs-orientation-check'
export const OUTPUTS_ORIENTATION_BUTTON_ID = 'outputs-orientation-start'
export const OUTPUTS_BENCH_TARGET_ID = 'outputs-bench-lab'
export const OUTPUTS_MOTOR_START_BUTTON_ID = 'outputs-motor-verification-start'
export const OUTPUTS_MOTOR_TEST_BUTTON_ID = 'outputs-motor-test-run'
export const OUTPUTS_MOTOR_CONFIRM_BUTTON_ID = 'outputs-motor-confirm'
export const SETUP_WIZARD_PRIMARY_ACTION_ID = 'setup-wizard-primary-action'
export const SETUP_WIZARD_NEXT_STEP_ID = 'setup-wizard-next-step'

export function escCalibrationPathLabel(path: ReturnType<typeof deriveEscSetupSummary>['calibrationPath']): string {
  switch (path) {
    case 'analog-calibration':
      return 'Analog ESC calibration'
    case 'digital-protocol':
      return 'Digital protocol review'
    default:
      return 'Manual ESC review'
  }
}

export function escCalibrationInstructions(escSetup: ReturnType<typeof deriveEscSetupSummary>): string[] {
  switch (escSetup.calibrationPath) {
    case 'analog-calibration':
      return [
        'Remove props and disconnect USB before running the offline all-at-once ESC calibration flow.',
        'After calibration, reconnect, review the PWM range, and rerun motor-order verification before first flight.'
      ]
    case 'digital-protocol':
      return [
        'DShot-style protocols do not use PWM endpoint calibration.',
        'Review MOT_PWM_TYPE and the spin thresholds, then confirm the digital-protocol setup before flight.'
      ]
    default:
      return [
        'Review the ESC protocol and motor-range values manually because the current snapshot does not match a known path.',
        'Only sign off after the protocol, PWM range, and spin thresholds make sense for this build.'
      ]
  }
}

export function panelAnchorForSetupSection(sectionId: string): { panelId: string; panelLabel: string } {
  switch (sectionId) {
    case 'link':
      return { panelId: 'setup-panel-link', panelLabel: 'Vehicle Link' }
    case 'airframe':
    case 'outputs':
      return { panelId: 'setup-panel-outputs', panelLabel: 'Airframe & Outputs' }
    case 'accelerometer':
    case 'level':
    case 'compass':
      return { panelId: 'setup-panel-guided', panelLabel: 'Guided Setup' }
    case 'radio':
    case 'modes':
      return { panelId: 'setup-panel-rc', panelLabel: 'Live RC Inputs' }
    case 'failsafe':
    case 'power':
      return { panelId: 'setup-panel-power', panelLabel: 'Power & Failsafe' }
    default:
      return { panelId: 'setup-panel-guided', panelLabel: 'Guided Setup' }
  }
}

export function setupPanelActionForSection(
  sectionId: string,
  panel: { panelId: string; panelLabel: string }
): SetupFlowActionDescriptor {
  switch (sectionId) {
    case 'outputs':
      return {
        kind: 'scroll',
        label: 'Open Motor Verification',
        panelId: panel.panelId,
        targetElementId: OUTPUTS_MOTOR_START_BUTTON_ID
      }
    case 'link':
      return {
        kind: 'scroll',
        label: 'Open Vehicle Link',
        panelId: panel.panelId
      }
    case 'radio':
      return {
        kind: 'scroll',
        label: 'Open Receiver Workbench',
        panelId: panel.panelId
      }
    case 'modes':
      return {
        kind: 'scroll',
        label: 'Open Mode Switch Check',
        panelId: panel.panelId
      }
    default:
      return {
        kind: 'scroll',
        label: `Open ${panel.panelLabel}`,
        panelId: panel.panelId
      }
  }
}

export function appViewForPanel(panelId: string): AppViewId {
  switch (panelId) {
    case 'setup-panel-link':
    case 'setup-panel-guided':
      return 'setup'
    case 'setup-panel-ports':
      return 'ports'
    case 'setup-panel-rc':
      return 'receiver'
    case 'setup-panel-outputs':
      // Setup panel "Outputs" focused on motor verification flow; lands
      // on the Motors nav tab. (Servos is a separate nav tab for aux
      // peripheral servo work and isn't part of the setup checklist.)
      return 'motors'
    case 'setup-panel-power':
      return 'power'
    default:
      return 'parameters'
  }
}

export function deriveSetupStatusFromCriteria(criteria: SetupFlowCriterion[]): 'attention' | 'in-progress' | 'complete' {
  if (criteria.length === 0) {
    return 'attention'
  }

  const criteriaMetCount = criteria.filter((criterion) => criterion.met).length
  if (criteriaMetCount === criteria.length) {
    return 'complete'
  }

  return criteriaMetCount === 0 ? 'attention' : 'in-progress'
}
