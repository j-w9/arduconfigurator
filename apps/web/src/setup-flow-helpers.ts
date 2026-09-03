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
/**
 * The single props-off / area-clear acknowledgement on the Motors tab.
 *
 * It used to sit inside the Test panel; on the one-page Motors layout there is
 * one ack for the whole page, pinned at the top, and the Test panel is a
 * sticky column beside it. Anything that tells the operator to acknowledge
 * before spinning needs to be able to put them in front of it.
 */
export const MOTORS_SAFETY_ACK_ID = 'motors-safety-ack'
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
      // Digital protocols (DShot) need no ESC endpoint-calibration steps, so
      // there's nothing actionable to list here.
      return []
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
    case 'ports':
      return { panelId: 'setup-panel-ports', panelLabel: 'Serial Ports' }
    case 'airframe':
    case 'outputs':
      return { panelId: 'setup-panel-outputs', panelLabel: 'Airframe & Outputs' }
    case 'accelerometer':
    case 'level':
    case 'compass':
      return { panelId: 'setup-panel-guided', panelLabel: 'Guided Setup' }
    case 'radio':
      return { panelId: 'setup-panel-rc', panelLabel: 'Live RC Inputs' }
    // Modes and Failsafe each own a tab with its own anchor, and both anchors
    // already existed and were referenced by nothing. Modes sent the operator to
    // the Receiver view and Failsafe to the Config tab's power section -- neither
    // of which is where the step's parameters are edited. Same class of silent
    // breakage the power mapping below documents.
    case 'modes':
      return { panelId: 'setup-panel-modes', panelLabel: 'Flight Modes' }
    case 'failsafe':
      return { panelId: 'setup-panel-failsafe', panelLabel: 'Failsafe' }
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
      return 'setup'
    // The guided wizard lives on its own 'guided-setup' tab now, so a jump to
    // the guided panel routes there (the 'setup' tab is the status dashboard).
    case 'setup-panel-guided':
      return 'guided-setup'
    case 'setup-panel-ports':
      return 'ports'
    case 'setup-panel-rc':
      return 'receiver'
    case 'setup-panel-outputs':
      // Setup panel "Outputs" focused on motor verification flow; lands
      // on the Motors nav tab. (Servos is a separate nav tab for aux
      // peripheral servo work and isn't part of the setup checklist.)
      return 'motors'
    case 'setup-panel-calibration':
      return 'calibration'
    case 'setup-panel-modes':
      return 'modes'
    case 'setup-panel-failsafe':
      return 'failsafe'
    case 'setup-panel-power':
      // Power is a Config category now, not its own tab. This mapping is the
      // one that breaks silently when a surface moves: the guided Power step
      // routes through here, and pointing it at a view that no longer exists
      // strands the step with no visible error.
      return 'config'
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
